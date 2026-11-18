# p-perm

Start: 2026-11-17T20:27:04Z. End: 2026-11-17T21:08Z (from `date -u`).

## Work

Built a shared Node helper (`probes/p_perm_lib.mjs`) that runs one `-p` stream-json session per case in a fresh directory with the stdio permission prompt tool, and a Python PTY runner (`probes/p_perm_pty.py`) that uses the `PermissionRequest` hook as the dialog signal. A decision hook (`probes/hooks/pretool_decide.py`) covers allow, deny, ask, `updatedInput`, exit codes and sleeps. Scripts for P20 to P24 run in both launch paths where the task asked for both. Notes are in `notes/probes-m3-permissions.md`, the dated section is in `probes/RESULTS.md`.

## What took long

- Reading the CLI behaviour for the folder-trust check: the TUI dialog did not appear under `probes/work/` any more, so the cases moved to the OS temp directory, and the trust lookup was read from the installed binary's strings.
- Sandbox cases: the model's own retry with a per-command `allowed_domains` input was unexpected and needed extra cases (manual mode, deniedDomains, an explicit-parameter prompt with a hook logging the payload).
- Cleaning the evidence files of absolute paths, the plugin marketplace name, and streamed partial text that split paths across events.

## Not finished or not tested

- `bypassPermissions` in the TUI and Shift+Tab mode cycling.
- Effect of `allowUnsandboxedCommands: false` (the model never tried to leave the sandbox).
- A second connector in the TUI beyond the one ask-rule dialog; the connector call that ran was a single read-only call in `-p`.
- Why the milestone 2 run saw the trust dialog under `probes/work/` while these runs did not.

## Host changes

Two project entries (one trust true, one trust false) for removed temporary directories whose names start with `p24-` remain in the login's `.claude.json`. Temporary run directories under `probes/work/` were removed. Nothing was installed.
