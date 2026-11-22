# p-cred: credential-masking proxy probes P44

Start: 2026-11-22 10:52 UTC. End: 2026-11-22 11:35 UTC (`date -u`).

## What was built

Scripts in `probes/`, a notes file `notes/probes-m6-credential-proxy.md` and a dated section in `probes/RESULTS.md`:

- `p_cred_lib.mjs`: a throwaway CA, a local HTTPS test registry (npm, Maven, Cargo sparse and PyPI layouts, `/echo`, `/redirect`, an Authorization log that classifies what arrived), runners for the srt CLI and for `SandboxManager`, and a secret scanner.
- `p44_calibrate.mjs`: host names, loopback rules, trust variables, the masked variable.
- `p44_tools.mjs`: one tool and one mechanism per run (npm, pnpm, cargo, Gradle, Maven, uv; mechanisms A, A2, B and an unsandboxed baseline).
- `p44_safety.mjs`: hostile commands in groups `s1` to `s9` (the safety properties, write requests, credential file modes and the in-process variants).
- `p44_embed.mjs`: library cost, sockets, quit behaviour, violation output and CLI cost, under Node and under Electron's Node.

srt 0.0.83, macOS, Node 22.22.3, Electron 45.3.3 as Node. No model was started, no real credential file was read, nothing was committed. Every secret in a log is a random string made per run.

## What took long

- The first runs failed before any credential logic ran: curl skipped the proxy for every `*.localhost` name because srt sets `NO_PROXY=localhost,...`, and `~` in `denyRead` expanded from the temporary `HOME` and denied the tool's own config file. Both are noted as setup facts.
- The proxy rejected the test registry's certificate until `NODE_EXTRA_CA_CERTS` was set for the srt process; `tlsTerminate.extraCaCertPaths` only changes the bundle the sandbox sees. Later, CAs with the same subject in one process produced "certificate signature failure" that looked like a flaky 502; a random subject per CA fixed the probe.
- Tool setup took iterations: cargo needs a credential provider for an authenticated registry, Gradle needs `allowLocalBinding`, Maven needs a proxy entry in `settings.xml` and a truststore, pnpm is a corepack shim and ignores `${VAR}` in a project `.npmrc`.
- The process list showed nothing: `ps` is refused inside the sandbox. The finding that the real secret is readable came from a second look through `sysctl(KERN_PROCARGS2)`, which led to the in-process variants that keep it out.
- One command that wrote a throwaway script with a long heredoc was refused by the permission system; the check went into `p44_embed.mjs` instead. Removing the temporary directory with `rm -rf` was refused once; `rm -r` of the same directory was accepted.

## What could not be finished

See the "Not verified" section of the notes: a real private registry, Linux and Windows, the real Electron main process, pip, go, git over HTTPS, Docker, `credentials.sigv4`, host memory access from the sandbox, an unsandboxed Maven baseline.

## Measurements

| Item | Value |
|---|---|
| `srt -c true` against `bash -c true` | 224 ms against 11 ms |
| `SandboxManager.initialize` median, Node and Electron's Node | 62 ms and 89 ms |
| `wrapWithSandbox` | 7 ms |
| `reset` | 2 ms |
| Gradle `compileJava` unsandboxed, library, CLI (A2) | 4300 to 6300 ms, 4600 to 5600 ms, 4400 to 4500 ms |
| Maven resolve with plugin download, library and CLI (A2) | 13 to 15 s and 13 s |
| Free space on the data volume, start and end | 10 GiB and 10 GiB |

## Cleanup

The temporary directory `/tmp/agide-p44/` was removed completely. No registry, proxy, Gradle daemon or loop process of this probe was left; `ps` showed none. The srt temp entries of the probe runs were removed by the runs themselves or by the probe; the four old `srt-mux-*.sock` files in the user temp directory date from 2026-11-17 and belong to earlier sessions, so they were left.

After the independent review the coordinator removed three unsafe commands from `p44_safety.mjs` (the reads of the real credential files, the dumps of process environments, the arguments of other processes in the scan result), redacted two local evidence files and reran group `s1` once. Its run directory under `/tmp` is not removed by the script and is left for removal by hand.
