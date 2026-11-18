import { z } from 'zod';
import { CommandError } from '../../core/commands/index';
import {
  checkClaudeLogin,
  ensureDir,
  DEFAULT_PROFILE_ID,
  FileProfileRegistry,
  FileProfileStore,
  InMemoryProfileRegistry,
  InMemoryProfileStore,
  InMemoryRegistryHub,
  profileEnv,
  profilePaths,
  ProfileError,
  writeToolFiles,
  type ProfileRegistry,
  type ProfileService,
  type ProfileStore,
} from '../../core/profile/index';
import { defaultSessionCwd, resolveClaudeBinary } from '../../core/session/index';
import type { ModuleContext, ModuleHandle } from '../context';
import { profileHost } from '../profileHost';

const PALETTE = ['#5b7fa6', '#b5651d', '#4f8a5b', '#a64f7e', '#7a5fb0', '#b0453a', '#2f8f9d', '#8a7a2f'] as const;
const colour = z.string().regex(/^#[0-9a-f]{6}$/i);

/**
 * Profile module. Owner: w-profiles.
 * With a profile resolved before `ready` (`ctx.profile`) the store and registry are the file implementations
 * under its root. Without one (tests, `AGIDE_USER_DATA`) one in-memory `default` profile runs on `dataDir`.
 * Registers `profile_list`, `profile_open`, `profile_create`, `profile_set_git` and `profile_setup_status`;
 * none is an MCP tool, since 0017 allows no agent action across profiles.
 */
export async function init(ctx: ModuleContext): Promise<ModuleHandle<ProfileService>> {
  const id = ctx.profile?.id ?? DEFAULT_PROFILE_ID;
  const root = ctx.profile?.root;
  let store: ProfileStore;
  let registry: ProfileRegistry;
  if (root) {
    const fileStore = new FileProfileStore({ root, ownerId: id });
    store = fileStore;
    registry = new FileProfileRegistry({ root, profileId: id, isKnownProfile: (other) => fileStore.get(other) !== undefined });
    const settings = store.readSettings(id);
    writeToolFiles(settings, profilePaths(root, id));
  } else {
    const memory = new InMemoryProfileStore({ ownerId: id });
    // The login the app sees today stays the default profile's login, as the migration of 0022 keeps it.
    const inheritedConfigDir = process.env['CLAUDE_CONFIG_DIR'];
    memory.create({
      id,
      name: id === DEFAULT_PROFILE_ID ? 'Default' : id,
      colour: PALETTE[0],
      ...(inheritedConfigDir ? { settings: { claudeConfig: { mode: 'directory', path: inheritedConfigDir } } } : {}),
    });
    store = memory;
    registry = new InMemoryProfileRegistry(new InMemoryRegistryHub(), { profileId: id });
  }

  const service: ProfileService = {
    id,
    definition: () => {
      const definition = store.get(id);
      if (!definition) throw new ProfileError('not_found', `profile ${id} has no definition`);
      return definition;
    },
    settings: () => store.readSettings(id),
    store,
    registry,
  };

  let unread: number | undefined;
  const publish = (): void => registry.publish({ unread: service.settings().shareUnread ? unread : undefined });
  const unsubscribers = [
    registry.subscribe((statuses) => ctx.events.emit({ type: 'profile.statuses_changed', statuses })),
    ctx.events.on('inbox.unread_changed', (event) => {
      unread = event.count;
      publish();
      if (service.settings().showBadge) ctx.desktop?.setBadgeCount(event.count);
    }),
  ];
  publish();

  const failed = (error: unknown): never => {
    if (error instanceof ProfileError) throw new CommandError(error.code === 'not_found' ? 'not_found' : 'invalid_input', error.message);
    throw error;
  };
  const exempt = 'Agents do not manage profiles: 0017 allows no action across profiles.';
  const open = (target: string): void => {
    try {
      profileHost().open(target);
    } catch (error) {
      throw new CommandError('failed', error instanceof Error ? error.message : String(error));
    }
  };

  const unregister = [
    ctx.commands.register({
      id: 'profile_list',
      title: 'List profiles',
      description: 'Lists every profile with its name, colour, running state and unread count, and says which one this process runs.',
      input: z.object({}),
      ui: false,
      mcp: false,
      run: () => {
        const statuses = new Map(registry.statuses().map((status) => [status.profileId, status]));
        return {
          own: id,
          persistent: root !== undefined,
          palette: [...PALETTE],
          profiles: store.list().map((definition) => {
            const status = statuses.get(definition.id);
            return {
              id: definition.id,
              name: definition.name,
              colour: definition.colour,
              running: definition.id === id || (status?.running ?? false),
              ...(status?.unread === undefined ? {} : { unread: status.unread }),
            };
          }),
        };
      },
    }),
    ctx.commands.register({
      id: 'profile_open',
      title: 'Open profile',
      description: 'Focuses the window of a running profile or starts the profile.',
      input: z.object({ id: z.string().min(1) }),
      ui: { menu: 'app' },
      mcp: false,
      mcpExempt: exempt,
      run: (input) => {
        if (!store.get(input.id)) throw new CommandError('not_found', `no profile ${input.id}`);
        open(input.id);
        return { opened: input.id };
      },
    }),
    ctx.commands.register({
      id: 'profile_create',
      title: 'New profile',
      description: 'Creates a profile with its own data, Claude and tool directories and opens it.',
      input: z.object({ name: z.string().trim().min(1).max(40), colour }),
      ui: { menu: 'app' },
      mcp: false,
      mcpExempt: exempt,
      run: (input) => {
        let created;
        try {
          created = store.create({ name: input.name, colour: input.colour });
        } catch (error) {
          return failed(error);
        }
        open(created.id);
        return { id: created.id };
      },
    }),
    ctx.commands.register({
      id: 'profile_set_git',
      title: 'Set git identity',
      description: 'Records the git name and e-mail of this profile and regenerates its git configuration file.',
      input: z.object({ userName: z.string().trim().min(1).max(200), userEmail: z.string().trim().min(3).max(320) }),
      ui: false,
      mcp: false,
      run: (input) => {
        const current = service.settings();
        if (current.tools.mode !== 'isolated') throw new CommandError('invalid_input', 'this profile uses the tool credentials of the environment');
        try {
          store.updateSettings(id, { tools: { ...current.tools, git: { userName: input.userName, userEmail: input.userEmail } } });
        } catch (error) {
          return failed(error);
        }
        return { saved: true };
      },
    }),
    ctx.commands.register({
      id: 'profile_setup_status',
      title: 'Profile setup status',
      description: 'Reports which setup steps of this profile are done: Claude login, git identity, ssh key. Returns the directory for the login terminal.',
      input: z.object({}),
      ui: false,
      mcp: false,
      run: async () => {
        const settings = service.settings();
        const paths = root ? profilePaths(root, id) : undefined;
        // Outside the app root, because a session cannot run inside it.
        const loginDirectory = defaultSessionCwd(`login-${id}`);
        ensureDir(loginDirectory);
        let login: { signedIn: boolean; authMethod?: string } = { signedIn: false };
        if (paths) {
          try {
            login = await checkClaudeLogin(resolveClaudeBinary(), profileEnv(process.env, settings, paths));
          } catch {
            login = { signedIn: false };
          }
        }
        return {
          needed: settings.tools.mode === 'isolated',
          login,
          git: settings.tools.mode === 'isolated' && settings.tools.git !== undefined,
          ssh: settings.tools.mode === 'isolated' && settings.tools.ssh !== undefined,
          loginDirectory,
          agentAccess: 'host-user',
        };
      },
    }),
  ];

  return {
    service,
    dispose: () => {
      for (const off of [...unregister, ...unsubscribers]) off();
      registry.withdraw();
      registry.dispose();
    },
  };
}
