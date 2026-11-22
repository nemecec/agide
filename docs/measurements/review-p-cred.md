# review:p-cred

Start: 2026-11-22 11:37 UTC. End: 2026-11-22 11:47 UTC (`date -u`).

Independent review of the P44 credential-proxy probes against srt 0.0.83. Scratch scripts under `/tmp/agide-review-cred/` (removed), fake secrets made per run, a throwaway CA with a random subject, hostname `registry.localhost`. No real credential file or keychain item was read; no model was started; no daemon was started.

Verdict: accept with fixes.

## Reproduced

| Claim | Result |
|---|---|
| `KERN_PROCARGS2` from inside srt reads other same-user processes | reproduced: argument lists of every same-user process; exec-time environment of Node, Electron as Node, Homebrew bash, Xcode Python and the srt CLI process; empty environment for `/usr/bin/perl` |
| Run-time `process.env` value and closure value not visible | reproduced, Node and Electron as Node |
| Working directory, open descriptors, process list | readable (`proc_pidinfo`, `lsof -p`, `KERN_PROC_ALL`); not in the probe notes before this review |
| A Seatbelt rule can block `KERN_PROCARGS2` | no: sysctl-read denies by name and prefix, `(deny sysctl*)` and `(deny process-info*)` left it readable |
| srt offers a hook for extra profile rules | no setting found in 0.0.83 |
| A: Bearer substituted, Basic not | reproduced (curl, npm) |
| B: Basic substituted when the filter decodes | reproduced; without decoding only the placeholder arrives |
| `extraCaCertPaths` does not make the proxy trust the upstream | reproduced (502; 200 with `NODE_EXTRA_CA_CERTS`) |
| Echo returns the real value (A and B), path scoping stops `/echo`, method scoping does not stop a GET echo, `stripResponseHeaders` leaves the body | reproduced |
| srt CA private key readable from the sandbox | reproduced |
| Sandboxed child survives host `reset`, exit, SIGTERM, SIGKILL | reproduced |

## Not reproduced or not checked

Gradle, Maven, cargo, pnpm and uv runs; the s2, s4 to s9 groups; keychain access from the sandbox; Electron crash dumps; Linux and Windows.

## Changes made to the notes

- `notes/probes-m6-credential-proxy.md`: the process-exposure bullet now says that the environment of Apple platform binaries came back empty, that the app's own inherited environment is exposed, and adds the review results (what is and is not readable, what a Seatbelt rule can and cannot block, what breaks). The `task_for_pid` line in "Not verified" now carries the review result, and a keychain line was added.
- `docs/measurements/p-cred.md`: "seven safety properties" replaced by the group names `s1` to `s9`.
