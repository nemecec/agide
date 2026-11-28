import { INSIDE_NAMES_ARGUMENT } from './hostLaunch';

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
/**
 * `env` ends with 126 for a word that names a directory (`.`, `..`, `dir/`), which the environment patterns do not read as a missing program; a shell says 127.
 * A bare word with no slash that names a directory is not refused here: `env` finds it only through a relative, empty or `.` entry of the PATH of the profile, and then ends 126
 * (permission denied), which the check reads as failed, not as passed and not as not run.
 */
const REFUSE_DIRECTORY = 'case "$1" in .|..|*/*) if [ -d "$1" ]; then echo "check-launcher: $1: command not found" >&2; exit 127; fi ;; esac';
const STATUS = ['status=$?', 'exit "$status"'];
const RUN = ['/usr/bin/env -- "$@"', ...STATUS];
const ENTER = 'cd -- "$1" || exit 2';

/**
 * The program runs as the child of a shell that handles those signals (a handled signal goes back to its default
 * action in the child; an ignored one would stay ignored), waits for the child and exits with its status, which is 128
 * plus the number for a death by a signal (no program: status 2, never 0). Nothing the program does ends the shell
 * with a status that reads as 0. The program starts through `env`, an external command: a first word that is a shell
 * builtin (`source`, `eval`, `exec`) is not found there, so the code of the checkpoint never runs inside the
 * launcher shell, where it could clear the trap or replace the shell. `.`, `..` and a word with a directory part that
 * names a directory are refused before `env` sees them, as a word with `=` is. A bare word that names a directory in a relative PATH entry ends 126.
 */
export const LAUNCHER_SCRIPT = [TRAP, NEED_PROGRAM, REFUSE_ASSIGNMENT, REFUSE_DIRECTORY, ...RUN].join('\n');

/** The same script after a change into the directory that is its first argument: the sandboxed program starts there. */
export const LAUNCHER_IN_DIRECTORY_SCRIPT = [TRAP, ENTER, 'shift', NEED_PROGRAM, REFUSE_ASSIGNMENT, REFUSE_DIRECTORY, ...RUN].join('\n');

/** Takes the list of names (`AGIDE_INSIDE_NAMES=A,B`) from the next argument into a shell variable that no carried name can replace (`insideRoute` drops names that start with `AGIDE_INSIDE`). */
const TAKE_NAMES = [`AGIDE_INSIDE=\${1#${INSIDE_NAMES_ARGUMENT}}`, 'shift'];
/**
 * Exports each listed name with the value of its carrier and removes the carrier. The name is checked again, with
 * character classes: a range such as `A-Z` follows the collation of the locale, and in `et_EE` it leaves out `T` to
 * `Y`, so `TMPDIR` would be refused. `eval`
 * sees the name and the literal text `${AGIDE_INSIDE_<name>}`, so the value is expanded once inside double quotes and
 * never parsed as shell code (quotes, `$`, backticks, a line break and a leading dash stay as they are). The list is
 * expanded once before the loop, so an exported `IFS` changes nothing. A profile without PATH leaves the program without one.
 */
const IMPORT = [
  'unset PATH',
  'set -f',
  'IFS=,',
  'for AGIDE_INSIDE in $AGIDE_INSIDE; do',
  `  case $AGIDE_INSIDE in ''|[!_[:alpha:]]*|*[!_[:alnum:]]*) exit 2 ;; esac`,
  String.raw`  eval "export $AGIDE_INSIDE=\"\${AGIDE_INSIDE_$AGIDE_INSIDE}\"; unset AGIDE_INSIDE_$AGIDE_INSIDE"`,
  'done',
  'unset AGIDE_INSIDE',
];

/** The launcher of a check under `srt`: the variables are exported in a subshell that then becomes the program, so they change nothing in the launcher, which waits for it. */
export const LAUNCHER_INSIDE_SCRIPT = [TRAP, ENTER, 'shift', ...TAKE_NAMES, NEED_PROGRAM, REFUSE_ASSIGNMENT, REFUSE_DIRECTORY, '(', ...IMPORT, 'exec /usr/bin/env -- "$@"', ')', ...STATUS].join('\n');

/** The start of an agent session under `srt`: the shell exports the variables and replaces itself with the program, so a signal to `srt` reaches the program as before. */
export const INSIDE_SCRIPT = [...TAKE_NAMES, ...IMPORT, 'exec /usr/bin/env -- "$@"'].join('\n');

/** The argv that starts `argv` inside the sandbox with the variables `names` of `insideRoute`. */
export function insideArgv(names: readonly string[], argv: readonly string[]): string[] {
  return ['/bin/sh', '-c', INSIDE_SCRIPT, 'agide-inside', `${INSIDE_NAMES_ARGUMENT}${names.join(',')}`, ...argv];
}

/**
 * The argv that runs `argv` under the launcher shell: for `srt` and for a check outside it. With `directory` the shell
 * changes into it first; with `inside` (only together with `directory`, under `srt`) it also sets those variables of `insideRoute`.
 */
export function launcherArgv(argv: readonly string[], options: { readonly directory?: string; readonly inside?: readonly string[] } = {}): string[] {
  if (options.directory === undefined) return ['/bin/sh', '-c', LAUNCHER_SCRIPT, 'check-launcher', ...argv];
  if (options.inside === undefined) return ['/bin/sh', '-c', LAUNCHER_IN_DIRECTORY_SCRIPT, 'check-launcher', options.directory, ...argv];
  return ['/bin/sh', '-c', LAUNCHER_INSIDE_SCRIPT, 'check-launcher', options.directory, `${INSIDE_NAMES_ARGUMENT}${options.inside.join(',')}`, ...argv];
}
