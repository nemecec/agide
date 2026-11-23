/**
 * The signals of macOS that a process can catch and whose default action ends it: HUP INT QUIT ILL TRAP ABRT EMT FPE
 * BUS SEGV SYS PIPE ALRM TERM XCPU XFSZ VTALRM PROF USR1 USR2. Node names only some of them: it reports a death by a
 * signal it has no name for (EMT) as exit code 0 with no signal, and `srt`, a Node program, exits 0 for a death by
 * INT or TERM. A signal that ends the launcher would read as a pass, so the launcher handles all of them and only
 * SIGKILL, which cannot be caught and which Node and `srt` report by name, can end it. The list is by number because
 * names differ between shells and platforms. It leaves out the signals that are ignored by default (URG, CHLD, WINCH,
 * INFO, CONT, IO) or stop the process (STOP, TSTP, TTIN, TTOU). The app runs on macOS only; Linux has other numbers.
 */
export const LAUNCHER_HANDLED_SIGNALS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 30, 31];

/**
 * The program runs as the child of a shell that handles those signals (a handled signal goes back to its default
 * action in the child; an ignored one would stay ignored), waits for the child and exits with its status, which is 128
 * plus the number for a death by a signal (no program: status 2, never 0). Nothing the program does ends the shell
 * with a status that reads as 0.
 */
export const LAUNCHER_SCRIPT = [`trap : ${LAUNCHER_HANDLED_SIGNALS.join(' ')}`, '[ "$#" -gt 0 ] || exit 2', '"$@"', 'status=$?', 'exit "$status"'].join('\n');

/** The argv that runs `argv` under the launcher shell: for `srt` and for a check outside it. */
export function launcherArgv(argv: readonly string[]): string[] {
  return ['/bin/sh', '-c', LAUNCHER_SCRIPT, 'check-launcher', ...argv];
}
