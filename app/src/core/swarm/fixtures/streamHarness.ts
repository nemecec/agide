import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PtySessionService } from '../../session/PtySessionService';
import { StreamSpawners } from '../../session/streamSpawner';
import type { RuntimeHarness } from '../runtime/agentRuntimeContract';
import { StreamAgentRuntime, type StreamAgentRuntimeOptions } from '../runtime/StreamAgentRuntime';

export const FAKE_CLAUDE_STREAM = join(import.meta.dirname, 'fake-claude-stream.mjs');
export const FAKE_CLAUDE_SCRIPT = join(import.meta.dirname, 'fake-claude-script.mjs');

export interface StreamHarness extends RuntimeHarness {
  readonly runtime: StreamAgentRuntime;
  readonly sessions: PtySessionService;
  /** A temporary directory the test may use; removed by `close`. */
  readonly dir: string;
  /** One JSON line per process start: arguments, working directory and selected variables. */
  readonly recordFile: string;
  /** Where the fake CLI writes the pid of its child when the harness was started with `children`. */
  readonly childPidFile: string;
}

export interface StreamHarnessOptions {
  /** The executable the local provider runs. Defaults to the stream-json fake. */
  readonly binary?: string;
  /** The fake CLI starts a child process in its process group; its pid is in `childPidFile`. */
  readonly children?: boolean;
  /** Variables for the fake CLI, such as `FAKE_CLAUDE_NOISE`. */
  readonly env?: Record<string, string>;
  readonly runtime?: Partial<Omit<StreamAgentRuntimeOptions, 'sessions'>>;
}

/** The stream-json runtime over a real session service, the local provider and the fake CLI. */
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
      ...(options.children === true ? { FAKE_CLAUDE_CHILD_PID_FILE: childPidFile } : {}),
      ...options.env,
    },
    streamSpawner: slot,
    contributors: () => [runtime.contributor],
    killTimeoutMs: 300,
  });
  const runtime = new StreamAgentRuntime({ sessions, ...options.runtime });
  slot.set(runtime);
  return {
    runtime,
    sessions,
    dir,
    cwd,
    folderId: 'folder-1',
    recordFile,
    childPidFile,
    close: async () => {
      await sessions.shutdown();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
