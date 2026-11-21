import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { InMemoryInboxService } from '../../inbox/InMemoryInboxService';
import { InMemoryTreeService } from '../../tree/InMemoryTreeService';
import { openStore, type Database } from '../../store/Store';
import { InMemoryAgentRuntime } from '../runtime/InMemoryAgentRuntime';
import { Git } from '../workspace/git';
import { SwarmWorkspaces } from '../workspace/SwarmWorkspaces';
import { InMemorySwarmFolders } from './InMemorySwarmManager';
import { PersistentSwarmManager, type PersistentSwarmManagerDeps, type ProcessControl } from './PersistentSwarmManager';
import { SwarmStore } from './SwarmStore';
import { ManualClock } from './timers';

/** Stand-in for the tree's table, which `swarms.folder_id` refers to. */
class RigFolders extends InMemorySwarmFolders {
  constructor(
    private readonly db: Database,
    private readonly tree: InMemoryTreeService,
  ) {
    super();
  }

  override create(title: string, parentId: string | null): string {
    const id = this.tree.createFolder({ title }).id;
    this.add(id, parentId);
    this.db.prepare('INSERT INTO tree_nodes (id) VALUES (?)').run(id);
    return id;
  }
}

export const gitTestEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

export interface ManagerRig {
  readonly root: string;
  readonly db: Database;
  readonly runtime: InMemoryAgentRuntime;
  readonly inbox: InMemoryInboxService;
  readonly folders: InMemorySwarmFolders;
  readonly workspaces: SwarmWorkspaces;
  readonly clock: ManualClock;
  readonly manager: PersistentSwarmManager;
  cap: number;
  /** A second manager over the same database and runtime, as after a restart. */
  restart(overrides?: Partial<PersistentSwarmManagerDeps>): PersistentSwarmManager;
  close(): Promise<void>;
}

export interface RigOptions {
  readonly overrides?: Partial<PersistentSwarmManagerDeps>;
  /** Share an existing root and database, as a restart does. */
  readonly timers?: 'system' | 'manual';
}

/** A persistent manager over an in-memory database, the in-memory runtime and real temporary directories. */
export function createRig(options: RigOptions = {}): ManagerRig {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'swarm-rig-')));
  mkdirSync(join(root, 'worktrees'));
  const db = openStore(':memory:');
  db.exec('CREATE TABLE tree_nodes (id TEXT PRIMARY KEY)');
  const runtime = new InMemoryAgentRuntime();
  const tree = new InMemoryTreeService();
  const inbox = new InMemoryInboxService(tree);
  const folders = new RigFolders(db, tree);
  const clock = new ManualClock();
  const workspaces = new SwarmWorkspaces({
    git: new Git(undefined, gitTestEnv),
    dataRoot: join(root, 'data', 'swarms'),
    agentRoot: join(root, 'agents'),
    worktreeBase: join(root, 'worktrees'),
    appRoot: join(root, 'data'),
  });
  const rig = { cap: 4 } as { cap: number };
  const build = (overrides: Partial<PersistentSwarmManagerDeps> = {}): PersistentSwarmManager =>
    new PersistentSwarmManager({
      runtime,
      store: new SwarmStore(db),
      inbox,
      workspaces,
      folders,
      cap: () => rig.cap,
      retryDelayMs: false,
      processes: noProcesses,
      ...(options.timers === 'manual' ? { timers: clock, now: clock.now } : {}),
      ...options.overrides,
      ...overrides,
    });
  const manager = build();
  const managers = [manager];
  return Object.assign(rig, {
    root,
    db,
    runtime,
    inbox,
    folders,
    workspaces,
    clock,
    manager,
    restart: (overrides?: Partial<PersistentSwarmManagerDeps>) => {
      const next = build(overrides);
      managers.push(next);
      return next;
    },
    close: async () => {
      for (const next of managers) await next.shutdown();
      await runtime.dispose();
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  });
}

export const noProcesses: ProcessControl = { alive: () => false, commandLine: () => undefined, terminate: () => undefined };

/** A temporary git repository with the given files committed on `main`; the caller removes `dir`. */
export function makeRepo(files: Record<string, string> = { 'README.md': 'readme\n', 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' }): {
  dir: string;
  commit: string;
  git: (...args: string[]) => string;
} {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'swarm-repo-')));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, env: gitTestEnv(), encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '.');
  git('commit', '-m', 'first');
  return { dir, commit: git('rev-parse', 'HEAD'), git };
}
