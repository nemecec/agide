import type { ChildProcess } from 'node:child_process';

export const STAND_IN_POLL_MS: number;
export const STAND_IN_MAX_LIFETIME_MS: number;
export const STAND_IN_SOURCE: string;

export interface StandInOptions {
  /** The process the stand-in watches. Defaults to the process that starts it. */
  readonly parentPid?: number;
  readonly maxLifetimeMs?: number;
  /** Starts the stand-in as the leader of its own process group. */
  readonly detached?: boolean;
}

export function processRuns(pid: number): boolean;
export function endWithParent(parentPid: number, maxLifetimeMs?: number): void;
export function spawnStandIn(options?: StandInOptions): ChildProcess;
export function endStandIn(pid: number): void;
export function killGroup(leader: number | undefined): void;
