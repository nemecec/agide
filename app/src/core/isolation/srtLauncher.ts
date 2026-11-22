/**
 * `srt` 0.0.83 exits with status 0 when the program it runs ends by SIGINT or SIGTERM, and it forwards both signals to
 * the program. A check that prints a failure and then signals itself, its process group or its parent shell would end
 * with 0. The program therefore runs as the child of a shell that handles INT, TERM and HUP (a handled signal goes
 * back to its default action in the child; an ignored one would stay ignored), waits for the child and exits with
 * its status, which is 128 plus the number for a death by a signal. The shell is the child of `srt`: the signals it
 * handles cannot end it, and a SIGKILL, SIGQUIT or SIGABRT that reaches it ends `srt` with status 1.
 */
export const SRT_LAUNCHER_SCRIPT = ['trap : INT TERM HUP', '"$@"', 'status=$?', 'exit "$status"'].join('\n');

/** The argv that `srt` runs for `argv`: the launcher shell with the program as its arguments. */
export function srtLauncherArgv(argv: readonly string[]): string[] {
  return ['/bin/sh', '-c', SRT_LAUNCHER_SCRIPT, 'srt-launcher', ...argv];
}
