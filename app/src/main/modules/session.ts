import { mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { CommandError, requireInScope, type Caller } from '../../core/commands/index';
import type { AppMcpServer } from '../../core/mcp/index';
import { profilePaths, type ProfileService } from '../../core/profile/index';
import {
  claudeArgsFromEnv,
  defaultPermissionModeFromEnv,
  defaultSessionCwd,
  profileLaunchSpec,
  PtySessionService,
  SessionError,
  SqliteSessionStore,
  type SessionService,
} from '../../core/session/index';
import type { SessionInfo } from '../../core/session/index';
import type { NodeId, TreeNode, TreeService } from '../../core/tree/index';
import type { ModuleContext, ModuleHandle } from '../context';

const SURFACE_TYPE = 'claude-session';

const sessionRef = z.object({ sessionId: z.string().min(1) });
const permissionMode = z.enum(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);

/**
 * Claude session module. Owner: session builder.
 * Runs the interactive CLI in a PTY per `claude-session` leaf (0004), registers the `session_*` commands and keeps
 * leaves, sessions and MCP grants in step.
 */
export async function init(
  ctx: ModuleContext,
  deps: { tree: TreeService; mcp: AppMcpServer; profile: ProfileService },
): Promise<ModuleHandle<SessionService>> {
  const { tree, mcp } = deps;
  const launchArgs = claudeArgsFromEnv();
  const { port } = await mcp.start();
  const appRoot = ctx.profile?.root ?? ctx.dataDir;
  const paths = profilePaths(appRoot, deps.profile.id);
  const sessions = new PtySessionService({
    eventsDir: join(ctx.dataDir, 'session-events'),
    sessionFilesDir: join(ctx.dataDir, 'sessions'),
    store: new SqliteSessionStore(ctx.db),
    profileId: deps.profile.id,
    profileLaunch: () => profileLaunchSpec(deps.profile.settings(), paths, process.env),
    appPort: () => port,
    denyPaths: [appRoot],
    onLaunchFailed: (session) => mcp.revoke(session.id),
    defaultPermissionMode: defaultPermissionModeFromEnv(),
    extraArgs: () => launchArgs,
    mcpConfig: (session, endpoint) => mcpConfig(mcp, session, leafOf(session.id), endpoint.url),
  });

  // The leaf each session owns. Only that leaf drives the session: any other leaf with the same surface id is
  // ignored, so a copied or forged leaf cannot move, rescope or close a session.
  const leafIds = new Map<string, NodeId>();
  const leafOf = (sessionId: string): TreeNode | undefined => {
    const leafId = leafIds.get(sessionId);
    return leafId === undefined ? undefined : tree.get(leafId);
  };
  const isSessionLeaf = (node: TreeNode): node is TreeNode & { kind: 'leaf' } =>
    node.kind === 'leaf' && node.surfaceType === SURFACE_TYPE && leafIds.get(node.surfaceId) === node.id;

  // After a restart the first leaf of a session in tree order is its leaf.
  for (const node of tree.list()) {
    if (node.kind === 'leaf' && node.surfaceType === SURFACE_TYPE && sessions.get(node.surfaceId) && !leafIds.has(node.surfaceId)) {
      leafIds.set(node.surfaceId, node.id);
    }
  }

  const closeQuietly = async (sessionId: string): Promise<void> => {
    try {
      await sessions.close(sessionId);
    } catch (error) {
      if (!(error instanceof SessionError && error.code === 'not_found')) throw error;
    }
  };

  const unsubscribers = [
    sessions.subscribe((event) => {
      ctx.events.emit(event);
      if (event.type === 'session.closed') {
        mcp.revoke(event.sessionId);
        leafIds.delete(event.sessionId);
      } else if (event.type === 'session.exited') {
        mcp.revoke(event.session.id);
      }
    }),
    tree.subscribe((event) => {
      if (event.type === 'tree.subtree_removed') {
        for (const node of event.removed) {
          if (isSessionLeaf(node)) void closeQuietly(node.surfaceId).catch(logError);
        }
      } else if (event.type === 'tree.node_moved') {
        const node = event.node;
        if (!isSessionLeaf(node) || !sessions.get(node.surfaceId)) return;
        if (node.parentId === null) {
          // A session is scoped to a folder; a leaf at the top level has none.
          mcp.revoke(node.surfaceId);
        } else {
          sessions.setFolder(node.surfaceId, node.parentId);
          rescope(mcp, node.surfaceId, node.parentId);
        }
      }
    }),
  ];

  // A session whose leaf is gone cannot be opened again.
  for (const session of sessions.list()) if (!leafOf(session.id)) await closeQuietly(session.id);

  const toCommandError = (error: unknown): never => {
    if (error instanceof SessionError) throw new CommandError(error.code === 'not_found' ? 'not_found' : 'failed', error.message);
    throw error;
  };
  const scoped = (caller: Caller, sessionId: string): SessionInfo => {
    const session = sessions.get(sessionId);
    if (!session) throw new CommandError('not_found', `no session ${sessionId}`);
    requireInScope(tree, caller, session.folderId);
    return session;
  };
  const guarded = async <T>(work: () => Promise<T> | T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      return toCommandError(error);
    }
  };

  const unregister = [
    ctx.commands.register({
      id: 'session_create',
      title: 'New Claude session',
      description:
        'Starts a Claude session in a folder of the task tree and adds its leaf. Without cwd the session runs in the default directory. Returns the session and leaf ids.',
      input: z.object({
        folderId: z.string().min(1),
        cwd: z.string().min(1).optional(),
        title: z.string().trim().min(1).optional(),
        prompt: z.string().min(1).optional(),
        permissionMode: permissionMode.optional(),
        confirmBypassPermissions: z.boolean().optional(),
      }),
      ui: { menu: 'tree-node' },
      mcp: false,
      mcpExempt: 'Agents do not start Claude sessions; the user does.',
      run: (input, { caller }) =>
        guarded(async () => {
          const folder = tree.get(input.folderId);
          if (folder?.kind !== 'folder') throw new CommandError('invalid_input', `${input.folderId} is not a folder`);
          requireInScope(tree, caller, folder.id);
          if (input.permissionMode === 'bypassPermissions' && input.confirmBypassPermissions !== true) {
            throw new CommandError('invalid_input', 'bypassPermissions needs confirmBypassPermissions: true');
          }
          const cwd = input.cwd ?? defaultSessionCwd(folder.id);
          if (isWithin(appRoot, cwd)) throw new CommandError('invalid_input', 'a session cannot run inside the data directory of the app');
          if (input.cwd === undefined) mkdirSync(cwd, { recursive: true, mode: 0o700 });
          const session = await sessions.create({
            folderId: folder.id,
            cwd,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
            ...(input.permissionMode === undefined ? {} : { permissionMode: input.permissionMode }),
          });
          try {
            const leaf = tree.createLeaf({ title: session.title, parentId: folder.id, surfaceType: SURFACE_TYPE, surfaceId: session.id });
            leafIds.set(session.id, leaf.id);
            return { sessionId: session.id, leafId: leaf.id, status: session.status };
          } catch (error) {
            await closeQuietly(session.id);
            throw error;
          }
        }),
    }),
    ctx.commands.register({
      id: 'session_resume',
      title: 'Resume Claude session',
      description: 'Starts a new process with --resume for a session whose process has exited.',
      input: sessionRef,
      ui: false,
      mcp: false,
      run: ({ sessionId }) => guarded(async () => ({ status: (await sessions.resume(sessionId)).status })),
    }),
    ctx.commands.register({
      id: 'session_close',
      title: 'Close Claude session',
      description: 'Ends the session process and removes its leaf from the tree.',
      input: sessionRef,
      ui: false,
      mcp: false,
      run: ({ sessionId }) =>
        guarded(async () => {
          const leaf = leafOf(sessionId);
          if (!sessions.get(sessionId) && !leaf) throw new SessionError('not_found', `no session ${sessionId}`);
          if (leaf) tree.remove(leaf.id);
          await closeQuietly(sessionId);
          return { closed: true };
        }),
    }),
    ctx.commands.register({
      id: 'session_send_text',
      title: 'Send text to Claude session',
      description: 'Types the text as a prompt into a running Claude session in the caller\'s folder and submits it.',
      input: z.object({ sessionId: z.string().min(1), text: z.string().min(1) }),
      ui: false,
      mcp: true,
      run: ({ sessionId, text }, { caller }) =>
        guarded(() => {
          scoped(caller, sessionId);
          sessions.sendText(sessionId, text);
          return { sent: true };
        }),
    }),
    ctx.commands.register({
      id: 'session_write',
      title: 'Write terminal input',
      description: 'Passes raw terminal input to a running session.',
      input: z.object({ sessionId: z.string().min(1), data: z.string() }),
      ui: false,
      mcp: false,
      run: ({ sessionId, data }) =>
        guarded(() => {
          sessions.write(sessionId, data);
          return { written: true };
        }),
    }),
    ctx.commands.register({
      id: 'session_resize',
      title: 'Resize terminal',
      description: 'Sets the terminal size of a running session.',
      input: z.object({ sessionId: z.string().min(1), cols: z.number().int().min(1), rows: z.number().int().min(1) }),
      ui: false,
      mcp: false,
      run: ({ sessionId, cols, rows }) =>
        guarded(() => {
          sessions.resize(sessionId, cols, rows);
          return { resized: true };
        }),
    }),
    ctx.commands.register({
      id: 'session_read_output',
      title: 'Read terminal output',
      description: 'Returns the recent raw terminal output of a session, to redraw its terminal.',
      input: sessionRef,
      ui: false,
      mcp: false,
      run: ({ sessionId }) => guarded(() => ({ session: sessions.get(sessionId), data: sessions.readOutput(sessionId) })),
    }),
    ctx.commands.register({
      id: 'session_get',
      title: 'Get Claude session',
      description: 'Returns one Claude session: folder, title, working directory, status.',
      input: sessionRef,
      ui: false,
      mcp: true,
      run: ({ sessionId }, { caller }) => guarded(() => scoped(caller, sessionId)),
    }),
    ctx.commands.register({
      id: 'session_list',
      title: 'List Claude sessions',
      description: 'Lists the Claude sessions the caller can see (all for the user, those in its folder for an agent).',
      input: z.object({}),
      ui: false,
      mcp: true,
      run: (_input, { caller }) =>
        sessions
          .list()
          .filter((session) => caller.kind === 'ui' || tree.isWithin(session.folderId, caller.folderId)),
    }),
  ];

  return {
    service: sessions,
    dispose: async () => {
      for (const off of [...unregister, ...unsubscribers]) off();
      await sessions.shutdown();
    },
  };
}

/**
 * Grants the session access to the app MCP server and returns the config the CLI reads from a file. A session
 * whose leaf left its folder gets no grant, because its scope would name a folder it is no longer in.
 */
function mcpConfig(mcp: AppMcpServer, session: SessionInfo, leaf: TreeNode | undefined, url: string): object | undefined {
  if (leaf && leaf.parentId !== session.folderId) return undefined;
  try {
    mcp.grant(session.id, session.folderId);
    const { app } = mcp.configFor(session.id).mcpServers;
    return { mcpServers: { app: { ...app, url } } };
  } catch (error) {
    console.warn(`session ${session.id} starts without the app MCP server:`, error);
    return undefined;
  }
}

function rescope(mcp: AppMcpServer, sessionId: string, folderId: string): void {
  try {
    mcp.rescope(sessionId, folderId);
  } catch (error) {
    logError(error);
  }
}

function logError(error: unknown): void {
  console.error(error);
}

/** True when `path` is `root` or lies below it. */
function isWithin(root: string, path: string): boolean {
  const from = relative(resolve(root), resolve(path));
  return from === '' || (!from.startsWith('..') && !isAbsolute(from));
}
