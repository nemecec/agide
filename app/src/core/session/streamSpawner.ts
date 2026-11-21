import type { Unsubscribe } from '../events/EventBus';
import type { AgentEnvironment } from '../isolation/types';
import type { SessionInfo } from './types';

/**
 * A stream-json launch as the session service prepared it (0038): the environment is prepared, the hook inbox,
 * `mcp.json` and the launch contributions are in place, and `args` are those of `buildLaunchArgs`
 * (`--session-id` or `--resume`, `--permission-mode`, `--setting-sources`, `--settings`, `--mcp-config` and the
 * contributed arguments). The stream-json flags and the agent's own arguments, deny rules and variables come
 * from the runtime's launch contributor. The spawner gets the host command from `environment.processCommand`
 * and spawns it with pipes.
 */
export interface StreamSpawnRequest {
  readonly session: SessionInfo;
  readonly resume: boolean;
  readonly environment: AgentEnvironment;
  readonly args: readonly string[];
  /** Launch variables merged from the contributions. */
  readonly env: Readonly<Record<string, string>>;
}

/** The spawned process as the session service sees it. */
export interface StreamProcess {
  readonly pid: number;
  /** `SessionService.sendText` on a stream-json session: a user message, queued while a turn runs. */
  sendText(text: string): void;
  /** Called once when the process has exited. */
  onExit(listener: (exitCode: number | null, signal: string | null) => void): void;
}

export interface StreamSpawner {
  spawn(request: StreamSpawnRequest): Promise<StreamProcess>;
}

/**
 * The spawner slot the session service holds. `modules.ts` creates it before the modules; the swarm module
 * sets the stream-json runtime into it, because it is initialized after the session module.
 */
export class StreamSpawners implements StreamSpawner {
  private current: StreamSpawner | undefined;

  set(spawner: StreamSpawner): Unsubscribe {
    if (this.current !== undefined) throw new Error('a stream-json spawner is already registered');
    this.current = spawner;
    return () => {
      if (this.current === spawner) this.current = undefined;
    };
  }

  spawn(request: StreamSpawnRequest): Promise<StreamProcess> {
    if (this.current === undefined) return Promise.reject(new Error('no stream-json runtime is registered'));
    return this.current.spawn(request);
  }
}
