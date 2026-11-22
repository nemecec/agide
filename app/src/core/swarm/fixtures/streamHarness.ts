import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import { PtySessionService } from '../../session/PtySessionService';
import { StreamSpawners } from '../../session/streamSpawner';
import type { RuntimeHarness } from '../runtime/agentRuntimeContract';
import { StreamAgentRuntime, type StreamAgentRuntimeOptions } from '../runtime/StreamAgentRuntime';
import { endStandIn } from './standIn.mjs';

export const FAKE_CLAUDE_STREAM = join(import.meta.dirname, 'fake-claude-stream.mjs');
export const FAKE_CLAUDE_SCRIPT = join(import.meta.dirname, 'fake-claude-script.mjs');

export interface StreamHarness extends RuntimeHarness {
  readonly runtime: StreamAgentRuntime;
  readonly sessions: PtySessionService;
  /** A temporary directory the test may use; removed by `close`. */
  readonly dir: string;
  /** One JSON line per process start: arguments, working directory and selected variables. */
  readonly recordFile: string;
  /** Where the fake CLI writes the pid of its stand-in child when the harness was started with `children`. */
  readonly childPidFile: string;
  /** Ends every agent, the session service and the stand-in, and removes `dir`. Runs once; the harness also runs it when the test ends. */
  close(): Promise<void>;
}

export interface StreamHarnessOptions {
  /** The executable the local provider runs. Defaults to the stream-json fake. */
  readonly binary?: string;
  /**
   * The fake CLI starts a stand-in in its process group; its pid is in `childPidFile`. The stand-in ends with the
   * test runner, not with the fake CLI, so it survives the fake CLI unless the runtime ends the group.
   */
  readonly children?: boolean;
  /** Variables for the fake CLI, such as `FAKE_CLAUDE_NOISE`. */
  readonly env?: Record<string, string>;
  readonly runtime?: Partial<Omit<StreamAgentRuntimeOptions, 'sessions'>>;
}

/**
 * The stream-json runtime over a real session service, the local provider and the fake CLI. Call it from a test or a
 * `beforeEach` hook: the harness registers `close` for the end of that test, which runs after `afterEach` hooks even
 * when the test failed or timed out, so no process or directory outlives the test.
 */
export async function streamHarness(options: StreamHarnessOptions = {}): Promise<StreamHarness> {
  const dir = mkdtempSync(join(tmpdir(), 'stream-runtime-'));
  const cwd = join(dir, 'work');
  mkdirSync(cwd);
  const recordFile = join(dir, 'record.jsonl');
  const childPidFile = join(dir, 'child.pid');
  const slot = new StreamSpawners();
  const sessions = new PtySessionService({
    eventsDir: join(dir, 'events'),
    claudeBinary: options.binary ?? FAKE_CLAUDE_STREAM,
    baseEnv: {
      ...process.env,
      FAKE_CLAUDE_STATE: join(dir, 'state'),
      FAKE_CLAUDE_RECORD: recordFile,
      ...(options.children === true ? { FAKE_CLAUDE_CHILD_PID_FILE: childPidFile, FAKE_CLAUDE_CHILD_WATCH_PID: String(process.pid) } : {}),
      ...options.env,
    },
    streamSpawner: slot,
    contributors: () => [runtime.contributor],
    killTimeoutMs: 300,
  });
  const runtime = new StreamAgentRuntime({ sessions, ...options.runtime });
  slot.set(runtime);
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => (closing ??= endAll());
  async function endAll(): Promise<void> {
    try {
      await runtime.dispose();
    } finally {
      try {
        await sessions.shutdown();
      } finally {
        if (existsSync(childPidFile)) endStandIn(Number(readFileSync(childPidFile, 'utf8')));
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  onTestFinished(close);
  return {
    runtime,
    sessions,
    dir,
    cwd,
    folderId: 'folder-1',
    recordFile,
    childPidFile,
    close,
  };
}
