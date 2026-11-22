import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry } from '../core/commands/index';
import { createAppEventBus } from '../core/events/index';
import type { ResolvedProfile } from '../core/profile/index';
import { openStore } from '../core/store/index';
import { initModules } from './modules';

/**
 * The real module graph (tree, MCP server, sessions) on a database and data directory of the caller's choice,
 * without Electron. Tests and `pnpm parity` use it so they see the commands the app registers.
 */
export async function startAppModules(options: { dbPath?: string; dataDir?: string; profile?: ResolvedProfile } = {}) {
  const ownedDir = options.dataDir === undefined ? mkdtempSync(join(tmpdir(), 'agide-app-')) : undefined;
  const dataDir = options.dataDir ?? ownedDir ?? '';
  const db = openStore(options.dbPath ?? ':memory:');
  const events = createAppEventBus();
  const commands = new CommandRegistry();
  const modules = await initModules({ events, commands, db, dataDir, ...(options.profile === undefined ? {} : { profile: options.profile }) });
  return {
    services: modules.services,
    commands,
    events,
    dataDir,
    async close(): Promise<void> {
      await modules.dispose();
      db.close();
      if (ownedDir) rmSync(ownedDir, { recursive: true, force: true });
    },
  };
}

export type AppModules = Awaited<ReturnType<typeof startAppModules>>;
