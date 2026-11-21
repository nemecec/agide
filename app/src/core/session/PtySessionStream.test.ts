import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PtySessionService } from './PtySessionService';
import { StreamSpawners, type StreamSpawnRequest } from './streamSpawner';
import type { SessionEvent } from './types';

const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');
let dir: string;
let workdir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stream-session-'));
  workdir = join(dir, 'work');
  mkdirSync(workdir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A spawner that starts an idle node process and records what the session service handed it. */
function idleSpawner() {
  const requests: StreamSpawnRequest[] = [];
  const texts: string[] = [];
  const spawner = {
    spawn: async (request: StreamSpawnRequest) => {
      requests.push(request);
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      await new Promise((resolve) => child.once('spawn', resolve));
      return {
        pid: child.pid!,
        sendText: (text: string) => texts.push(text),
        onExit: (listener: (code: number | null, signal: string | null) => void) => void child.once('exit', listener),
      };
    },
  };
  return { spawner, requests, texts };
}

describe('stream-json sessions in the session service', () => {
  it('prepares the launch, hands the spawn to the stream spawner with the app-chosen id, and stops the process', async () => {
    const { spawner, requests, texts } = idleSpawner();
    const slot = new StreamSpawners();
    slot.set(spawner);
    const service = new PtySessionService({ eventsDir: join(dir, 'events'), claudeBinary: FAKE_CLAUDE, streamSpawner: slot, killTimeoutMs: 300 });
    const events: SessionEvent[] = [];
    service.subscribe((event) => events.push(event));
    const session = await service.create({ id: 'agent-session-1', folderId: 'f1', cwd: workdir, launchPath: 'stream-json', permissionMode: 'default' });
    expect(session, 'the session row').toMatchObject({ id: 'agent-session-1', launchPath: 'stream-json', status: 'starting' });
    expect(requests[0]?.args, 'base arguments of buildLaunchArgs').toEqual(expect.arrayContaining(['--session-id', 'agent-session-1', '--permission-mode', 'manual', '--setting-sources', 'user', '--settings']));
    expect(requests[0]?.resume, 'a create is not a resume').toBe(false);
    service.sendText(session.id, 'hello');
    expect(texts, 'sendText goes to the stream process').toEqual(['hello']);
    expect(() => service.write(session.id, 'x'), 'no terminal to write to').toThrow(expect.objectContaining({ code: 'not_running' }));
    await service.stop(session.id);
    expect(service.get(session.id)?.status, 'exited after stop').toBe('exited');
    expect(events.some((event) => event.type === 'session.exited' && event.session.id === session.id), 'exit event').toBe(true);
    await service.resume(session.id);
    expect(requests[1]?.args, 'resume passes --resume').toEqual(expect.arrayContaining(['--resume', 'agent-session-1']));
    await service.shutdown();
  });

  it('fails a stream-json launch without a spawner and refuses an id in use', async () => {
    const service = new PtySessionService({ eventsDir: join(dir, 'events'), claudeBinary: FAKE_CLAUDE });
    await expect(service.create({ folderId: 'f1', cwd: workdir, launchPath: 'stream-json' }), 'no spawner').rejects.toMatchObject({ code: 'launch_failed' });
    const { spawner } = idleSpawner();
    const slot = new StreamSpawners();
    const unset = slot.set(spawner);
    expect(() => slot.set(spawner), 'one spawner at a time').toThrow();
    const withSpawner = new PtySessionService({ eventsDir: join(dir, 'events2'), claudeBinary: FAKE_CLAUDE, streamSpawner: slot, killTimeoutMs: 300 });
    await withSpawner.create({ id: 'dup', folderId: 'f1', cwd: workdir, launchPath: 'stream-json' });
    await expect(withSpawner.create({ id: 'dup', folderId: 'f1', cwd: workdir, launchPath: 'stream-json' }), 'the id is in use').rejects.toMatchObject({ code: 'launch_failed' });
    await withSpawner.shutdown();
    unset();
    await expect(slot.spawn({} as StreamSpawnRequest), 'an unset slot refuses').rejects.toThrow('no stream-json runtime');
  });
});
