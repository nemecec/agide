// The idle node process that tests start where a real agent would leave a child behind, and the parent watch the
// fake CLIs share. A stand-in ends by itself when the process it watches is gone, which a parent killed with SIGKILL
// or a test runner that died cannot prevent, and at the latest after a fixed lifetime.
import { execFileSync, spawn } from 'node:child_process';

/** Time between two checks of the watched process. */
export const STAND_IN_POLL_MS = 1000;
/** The longest a stand-in lives when the process it watches keeps running and nobody ends it. */
export const STAND_IN_MAX_LIFETIME_MS = 180_000;

/** Whether the process `pid` exists. Stand-ins embed the source of this function, so it uses nothing outside itself. */
export function processRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Ends this process once `parentPid` stops running or `maxLifetimeMs` have passed. The timers keep the process alive. */
export function endWithParent(parentPid, maxLifetimeMs = STAND_IN_MAX_LIFETIME_MS) {
  setInterval(() => {
    if (!processRuns(parentPid)) process.exit(0);
  }, STAND_IN_POLL_MS);
  setTimeout(() => process.exit(0), maxLifetimeMs);
}

/**
 * The script of a stand-in, run as `node -e <script> <watched pid> <lifetime ms>`. It starts with `setInterval` so
 * that `ps` lists it as `node -e setInterval(...)`.
 */
export const STAND_IN_SOURCE = `setInterval(() => { if (!processRuns(Number(process.argv[1]))) process.exit(0); }, ${STAND_IN_POLL_MS}); setTimeout(() => process.exit(0), Number(process.argv[2])); ${processRuns}`;

/**
 * Starts a stand-in as a child of this process. It ends with `parentPid` (default: this process), so a test that
 * checks what survives the end of its direct parent passes the pid of the test runner instead.
 */
export function spawnStandIn({ parentPid = process.pid, maxLifetimeMs = STAND_IN_MAX_LIFETIME_MS, detached = false } = {}) {
  return spawn(process.execPath, ['-e', STAND_IN_SOURCE, String(parentPid), String(maxLifetimeMs)], { stdio: 'ignore', detached });
}

/** Ends the process `pid` when it is a stand-in; a pid that another process has taken over is left alone. */
export function endStandIn(pid) {
  try {
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (command.includes(STAND_IN_SOURCE.slice(0, 40))) process.kill(pid, 'SIGKILL');
  } catch {
    // `ps` fails for a pid that does not run, and `kill` for one that ended meanwhile: nothing left to end.
  }
}

/**
 * SIGKILL for the process group that `leader` leads; a group that is gone needs nothing. Only a real pid above 1 is a
 * leader: 0 would reach the caller's own group, 1 would reach every process of the user, and a negative pid names another process.
 */
export function killGroup(leader) {
  if (!Number.isInteger(leader) || leader <= 1) return;
  try {
    process.kill(-leader, 'SIGKILL');
  } catch {
    // no such group
  }
}
