import { spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { NoticeDeliveryKind } from '../../core/inbox/index';
import { PtySessionService } from '../../core/session/PtySessionService';
import { StreamSpawners, type StreamSpawnRequest } from '../../core/session/streamSpawner';
import type { SessionEvent } from '../../core/session/types';
import { spawnStandIn } from '../../core/swarm/fixtures/standIn.mjs';
import { createNoticeDelivery } from './ask';

vi.setConfig({ testTimeout: 20_000 });

const FAKE_CLAUDE = join(import.meta.dirname, '..', '..', 'core', 'session', 'fixtures', 'fake-claude.mjs');
let dir: string;
let workdir: string;
let service: PtySessionService;
const events: SessionEvent[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ask-delivery-'));
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'ask-delivery-cwd-')));
  mkdirSync(join(dir, 'events'));
  events.length = 0;
});
afterEach(async () => {
  await service?.shutdown();
  rmSync(dir, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

const output = (id: string): string => events.flatMap((event) => (event.type === 'session.output' && event.sessionId === id ? [event.data] : [])).join('');

async function until(what: string, probe: () => boolean): Promise<void> {
  const end = Date.now() + 8000;
  while (!probe()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Runs the `SessionStart` hook commands of the launch settings, as the CLI does when it is ready. */
function sessionStarted(request: StreamSpawnRequest): void {
  const settings = JSON.parse(request.args[request.args.indexOf('--settings') + 1] ?? '{}') as { hooks?: { SessionStart?: { hooks: { command: string }[] }[] } };
  const payload = JSON.stringify({ session_id: request.session.id, hook_event_name: 'SessionStart' });
  for (const group of settings.hooks?.SessionStart ?? []) for (const hook of group.hooks) spawnSync('/bin/sh', ['-c', hook.command], { input: payload });
}

const notice = (sessionId: string, onDelivered: (how: NoticeDeliveryKind) => void) => ({
  recordId: 'r1',
  sessionId,
  noticeLine: 'Inbox answer ready for question r1. Read it with inbox_ask_result.',
  contextLine: 'c',
  onDelivered,
});

describe('the notice delivery of the ask module over the session service', () => {
  it('types the line into an idle PTY session and submits it', async () => {
    service = new PtySessionService({ eventsDir: join(dir, 'events'), claudeBinary: FAKE_CLAUDE, baseEnv: { PATH: process.env['PATH'], FAKE_CLAUDE_RECORD: join(dir, 'launches.jsonl') }, submitDelayMs: 20, firstPromptDelayMs: 20, killTimeoutMs: 300 });
    service.subscribe((event) => events.push(event));
    const session = await service.create({ folderId: 'f1', cwd: workdir });
    await until('idle status', () => service.get(session.id)?.status === 'idle');
    const delivered: NoticeDeliveryKind[] = [];
    createNoticeDelivery(service).enqueue(notice(session.id, (how) => delivered.push(how)));
    await until('the echo of the submitted line', () => output(session.id).includes('echo: Inbox answer ready for question r1. Read it with inbox_ask_result.'));
    expect(delivered, 'a PTY session is told through the typed notice').toEqual(['notice']);
  });

  it('writes the line as a user message to an idle stream-json session', async () => {
    const texts: string[] = [];
    const children: ChildProcess[] = [];
    onTestFinished(() => void children.forEach((child) => child.kill('SIGKILL')));
    const slot = new StreamSpawners();
    slot.set({
      spawn: async (request: StreamSpawnRequest) => {
        const child = spawnStandIn();
        children.push(child);
        await new Promise((resolve) => child.once('spawn', resolve));
        sessionStarted(request);
        return { pid: child.pid!, sendText: (text: string) => texts.push(text), onExit: (listener) => void child.once('exit', listener) };
      },
    });
    service = new PtySessionService({ eventsDir: join(dir, 'events'), claudeBinary: FAKE_CLAUDE, streamSpawner: slot, killTimeoutMs: 300 });
    const session = await service.create({ id: 'agent-1', folderId: 'f1', cwd: workdir, launchPath: 'stream-json', permissionMode: 'default' });
    const delivery = createNoticeDelivery(service);
    const delivered: NoticeDeliveryKind[] = [];
    await until('the stream session to be idle', () => service.get(session.id)?.status === 'idle');
    delivery.enqueue(notice(session.id, (how) => delivered.push(how)));
    expect(texts, 'the stream process gets the line as its user message').toEqual(['Inbox answer ready for question r1. Read it with inbox_ask_result.']);
    expect(delivered, 'a stream-json session is told through stdin').toEqual(['stdin']);
  });
});
