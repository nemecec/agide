/**
 * The signals of macOS that a process can catch and whose default action ends it: HUP INT QUIT ILL TRAP ABRT EMT FPE
 * BUS SEGV SYS PIPE ALRM TERM XCPU XFSZ VTALRM PROF USR1 USR2. Node names only some of them: it reports a death by a
 * signal it has no name for (EMT) as exit code 0 with no signal, and `srt`, a Node program, exits 0 for a death by
 * INT or TERM. A signal that ends the launcher would read as a pass, so the launcher handles all of them and only
 * SIGKILL, which cannot be caught and which Node and `srt` report by name, can end it. The list is by number because
 * names differ between shells and platforms. It leaves out the signals that are ignored by default (URG, CHLD, WINCH,
 * INFO, CONT, IO), SIGSTOP, which stops the process, and TSTP, TTIN and TTOU, which the kernel drops for a check because
 * its session has no controlling terminal. The app runs on macOS only; Linux has other numbers.
 */
export const LAUNCHER_HANDLED_SIGNALS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 30, 31];

const TRAP = `trap : ${LAUNCHER_HANDLED_SIGNALS.join(' ')}`;
const NEED_PROGRAM = '[ "$#" -gt 0 ] || exit 2';
/** `env` reads a word with `=` as an assignment; a shell would have taken it as a program name that does not exist. */
const REFUSE_ASSIGNMENT = 'case "$1" in *=*) echo "check-launcher: $1: command not found" >&2; exit 127 ;; esac';
const RUN = ['/usr/bin/env -- "$@"', 'status=$?', 'exit "$status"'];

/**
 * The program runs as the child of a shell that handles those signals (a handled signal goes back to its default
 * action in the child; an ignored one would stay ignored), waits for the child and exits with its status, which is 128
 * plus the number for a death by a signal (no program: status 2, never 0). Nothing the program does ends the shell
 * with a status that reads as 0. The program starts through `env`, an external command: a first word that is a shell
 * builtin (`.`, `source`, `eval`, `exec`) is not found there, so the code of the checkpoint never runs inside the
 * launcher shell, where it could clear the trap or replace the shell.
 */
export const LAUNCHER_SCRIPT = [TRAP, NEED_PROGRAM, REFUSE_ASSIGNMENT, ...RUN].join('\n');

/** The same script after a change into the directory that is its first argument: the sandboxed program starts there. */
export const LAUNCHER_IN_DIRECTORY_SCRIPT = [TRAP, 'cd -- "$1" || exit 2', 'shift', NEED_PROGRAM, REFUSE_ASSIGNMENT, ...RUN].join('\n');

/** The argv that runs `argv` under the launcher shell: for `srt` and for a check outside it. With `directory` the shell changes into it first. */
export function launcherArgv(argv: readonly string[], options: { readonly directory?: string } = {}): string[] {
  if (options.directory === undefined) return ['/bin/sh', '-c', LAUNCHER_SCRIPT, 'check-launcher', ...argv];
  return ['/bin/sh', '-c', LAUNCHER_IN_DIRECTORY_SCRIPT, 'check-launcher', options.directory, ...argv];
}
