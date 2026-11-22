# Credential-masking proxy probes P44

Date: 2026-11-22. `srt --version` prints 0.0.83 (package `@anthropic-ai/sandbox-runtime`, experimental `network.tlsTerminate`). macOS (Darwin 27, Apple silicon), Node 22.22.3 for the probes, Electron 45.3.3 (its Node 24.22.3, run with `ELECTRON_RUN_AS_NODE=1`) for the library probes. Tools: npm 10.9.8, pnpm 11.21.0, cargo 1.99.0, Gradle 9.5.1 (Homebrew, launcher JVM Temurin 24), Maven 3.9.16 (Homebrew), uv 0.11.17, curl 8.7.1. No model was started and no real credential file was read; every secret is a random string made per run. The machine was shared and busy (load average between 14 and 30), so timings are indicative.

## Question

The proposal: the sandbox gets a placeholder in the places where a build tool expects a secret, the srt proxy terminates TLS and swaps the placeholder for the real secret on the way out, only for hosts the user names. The sandboxed code is meant never to hold the real secret. The mechanisms below were tested.

- A: srt's own `credentials` block (`credentials.envVars` with `mode: "mask"` and `injectHosts`), configured in the CLI settings file.
- B: a placeholder of our own in a sanitized config file, swapped by `network.filterRequest` (allow decision with `setHeaders`), with `SandboxManager` used as a library. `allowPlaintextHeaderSet` stays off.

A third variant, A2, is A with a prebuilt header: the masked variable holds the whole base64 blob of a Basic header.

## Method

`probes/p_cred_lib.mjs` has the helpers: a throwaway CA made with `openssl` (a random common name per CA), a local HTTPS test registry on 127.0.0.1 with a plain-HTTP twin, runners for the srt CLI and for `SandboxManager`, and a scanner that looks for a secret (raw and as base64) in files. The registry serves one package for each tool: an npm registry (metadata and tarball, `Authorization: Bearer`), a Maven layout (pom, jar and checksums, Basic), a Cargo sparse registry (`config.json`, index file, `.crate`, token as the raw header value, `auth-required`), and a PyPI simple index with a wheel (Basic). It logs every `Authorization` header and classifies it as `real`, `placeholder`, `srt-sentinel`, `other` or `none`, answers 401 on a wrong secret, and has `/echo` (reflects the request in the body, in `x-echo-authorization` and in `set-cookie`), `/redirect?to=` and `/ok`. Host names are `registry.localhost` (inject host), `other.localhost`, `excl.localhost` (excluded from termination) and `a.registry.localhost`.

Scripts and evidence (`probes/out/`, not tracked):

| Script | Content | Evidence |
|---|---|---|
| `p44_calibrate.mjs` | host names, loopback, trust, proxy variables, masked variable | `p44_calibrate.json` |
| `p44_tools.mjs <tool> <A\|A2\|B\|N>` | one tool, one mechanism (N is the unsandboxed baseline); env switches `P44_SHAPE`, `P44_JPROPS`, `P44_NOPROXYSET`, `P44_VERBOSE_TOOL`, `P44_NO_ENV_PROXY` | `p44_tool_<tool>_<mech>[_variant].json` |
| `p44_safety.mjs <group>` | hostile commands, groups s1 to s9 | `p44_safety_<group>.json` |
| `p44_embed.mjs` | library cost, sockets, quit behaviour, violation output, CLI cost | `p44_embed_node.json`, `p44_embed_electron-node.json` |

Every tool ran inside `srt` with `allowedDomains` limited to the test hosts (Maven also had `repo.maven.apache.org` and `repo1.maven.org` for its plugin), writes limited to a temporary directory, a temporary HOME or tool home, and `denyRead` on the user's real credential files (absolute paths, see below). Mechanism A ran through `srt --settings`; mechanism B ran in the probe's own Node process with `SandboxManager.initialize`, `wrapWithSandbox` and a `spawn` of the wrapped string.

## Setup facts

| Question | Finding |
|---|---|
| Host name srt accepts for a local registry | `localhost` and `registry.localhost` style names work with no loopback entry in `allowedDomains` (the README says these names resolve to loopback and nothing else). An IP literal is refused (`403` on the CONNECT) until `127.0.0.1:<port>` is listed, then it works. `network.strictAllowlist` changed nothing for listed hosts, and `deniedResolvedAddresses` with the loopback ranges did not block a `*.localhost` name. `allowLocalBinding` is not needed except for Gradle (below). |
| `NO_PROXY` | srt sets `NO_PROXY=localhost,127.0.0.1,::1,169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`. curl matches `localhost` as a suffix and skips the proxy for every `*.localhost` name, then fails to connect directly. The probes clear it in the command (`NO_PROXY= no_proxy=`). A registry reached by a remote host name is not on that list; one addressed by a private IP literal matches the CIDR entries in tools that read them. |
| Proxy CA trust by the sandboxed client | srt writes a bundle (its CA, the Node roots, `NODE_EXTRA_CA_CERTS` of its own process, `extraCaCertPaths`) and points `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `CURL_CA_BUNDLE`, `REQUESTS_CA_BUNDLE`, `PIP_CERT`, `GIT_SSL_CAINFO`, `AWS_CA_BUNDLE`, `CARGO_HTTP_CAINFO`, `DENO_CERT` and others at it. The JVM reads none of these. |
| Proxy trust of the upstream | `tlsTerminate.extraCaCertPaths` only extends the bundle the sandbox sees. The proxy verifies the upstream with Node's default roots plus `NODE_EXTRA_CA_CERTS` of the srt or host process. With only `extraCaCertPaths` the request got a 502. For the library, `NODE_EXTRA_CA_CERTS` at launch or `tls.setDefaultCACertificates([...tls.getCACertificates('default'), ca])` at run time works. A runtime-added CA whose subject equals one already in the default store fails with "certificate signature failure", so it needs a unique subject. A registry with a public certificate needs none of this. |
| `~` in srt paths | Expands from `HOME` of the srt process. With `HOME` pointed at a temporary directory, `denyRead: ["~/.npmrc"]` denied the temporary `.npmrc` instead. The probes use absolute paths. |
| Plain Node `fetch` and `https` | Ignore the proxy variables, the connection fails at name resolution. `NODE_USE_ENV_PROXY=1` (Node 22.21 and later) makes `fetch` use them. npm, pnpm and cargo need nothing extra. |
| JVM | srt injects `-javaagent` through `JAVA_TOOL_OPTIONS`; every JVM prints `Picked up JAVA_TOOL_OPTIONS: ...` on stderr. |

## Tool by mechanism

Verdict is whether the tool fetched the package and the registry saw the real secret in the form it expects, while the sandboxed process saw only the placeholder.

| Tool | A (`credentials.envVars`) | A2 (prebuilt header) | B (own placeholder, `filterRequest`) |
|---|---|---|---|
| npm | pass | not applicable | pass |
| pnpm | pass, with the reference in the user-level `.npmrc` | not applicable | pass |
| cargo | pass | not applicable | pass |
| Gradle | fail, 401 | pass | pass |
| Maven | fail, 401 | pass | pass |
| uv | fail, 401 | `not_run`, no custom header option used | pass |

Evidence: `p44_tool_<tool>_<mech>.json`. Every run also scanned the run directory and `/tmp/claude` for the real secret (raw and base64 of `user:secret`) and the tool output: no hit (`leaks` in the JSON); the unsandboxed baseline runs (mechanism N) hold the real secret in their config file on purpose and show it there.

Header form and substitution:

| Tool | What the tool sends | A | B |
|---|---|---|---|
| npm, pnpm | `Authorization: Bearer <token>` on every request | substituted | substituted |
| cargo | `Authorization: <token>`, first an unauthenticated request that gets 401, then the token | substituted | substituted |
| Gradle `authentication { basic }` | `Basic base64(user:password)`, preemptive | not substituted (the sentinel sits inside base64) | substituted (the callback decodes, replaces, encodes) |
| Gradle `HttpHeaderCredentials`, Maven `httpHeaders` | prebuilt header from the masked variable | substituted (A2) | not needed |
| Maven server `username` and `password` | Basic after the 401 challenge | not substituted | substituted |
| uv, index URL with userinfo | Basic, preemptive | not substituted | substituted |

The srt substitution is a plain substring replacement in every header value and in request bodies. It never decodes base64, so Basic works only when the whole blob is the masked value.

What each tool needed in the sandbox:

| Tool | Trust of the proxy CA | Other requirements |
|---|---|---|
| npm, pnpm | `NODE_EXTRA_CA_CERTS`, set by srt | npm: `.npmrc` with `//host:port/path/:_authToken=<placeholder or ${VAR}>`. pnpm 11 ignores `${VAR}` in registry credentials of a project `.npmrc`; the user-level file works. The pnpm on PATH is a corepack shim, so the sandbox needs a corepack home with the release already cached. |
| cargo | `CARGO_HTTP_CAINFO`, set by srt | A registry with `auth-required` needs a credential provider: `CARGO_REGISTRIES_<NAME>_CREDENTIAL_PROVIDER=cargo:token`, otherwise cargo stops with "authenticated registries require a credential-provider". Token from `CARGO_REGISTRIES_<NAME>_TOKEN` or `credentials.toml` in a temporary `CARGO_HOME`. |
| Gradle | A truststore with the proxy CA: `keytool -importcert` of the first certificate of `$SSL_CERT_FILE`, then `-Djavax.net.ssl.trustStore` in `GRADLE_OPTS` | `network.allowLocalBinding: true` (Gradle opens a loopback server socket for lock contention; without it the build stops with `SocketException: Operation not permitted`). The srt Java agent alone handles the proxy and its credential, also in the forked single-use daemon (the run with only trust properties passed). `--no-daemon` still forks a single-use daemon when JVM arguments are set; it ends with the build. |
| Maven | Same truststore, passed in `MAVEN_OPTS` | The Maven HTTP transport takes its proxy from `settings.xml`; the agent is not enough (the plugin download failed). The probe writes a `<proxies>` entry from `HTTPS_PROXY` inside the sandbox. Central is reachable through the same proxy, and the registry secret is not sent there. With `-Djava.io.tmpdir` set to the temporary directory the jansi lock-file message (a write outside the allowed paths) did not appear. |
| uv | `SSL_CERT_FILE`, set by srt | Proxy from the environment. |

Placeholder shape. Mechanism A uses `fake_value_<uuid4>` (47 characters, padded to the real value's length when that is longer); every A run accepted it, so no tool validated the token format. For mechanism B the same-shape placeholders (`npm_` plus 36 characters, `cio` plus 32, 28 alphanumerics) passed. The shape experiment changed the placeholder text and found only config-syntax limits, not token validation:

| Placeholder text | npm `.npmrc` | cargo `credentials.toml` | Gradle `gradle.properties` |
|---|---|---|---|
| short (`p1`) or with `/ + =` | pass | pass | not run |
| contains `#`, `;` and a space | fail: the ini parser cuts the value at the comment | pass | pass |
| contains `${HOME}` | fail: npm expands it | pass | not run |
| contains `"` and `'` | pass | fail: invalid TOML string | pass |

Use letters, digits, `_` and `-`.

## Safety properties

Each case ran with a hostile command inside the sandbox, for A and B, against the registry log. Evidence: `p44_safety_<group>.json`.

### 1. The real secret nowhere the sandbox can read (s1, s1b, s1c)

| Place | A through the CLI | A through the CLI with a wrapper | A through the library | B |
|---|---|---|---|---|
| sandbox environment | sentinel only | sentinel only | sentinel only | placeholder only |
| `ps` argument list | `ps` cannot run in the sandbox (`Operation not permitted`) | same | same | same |
| `sysctl(KERN_PROCARGS2)` of other processes | **real secret read** from the environment of the srt process | not found | not found | not found |
| files, temp, caches, tool logs (host-side exact scan, verbose tool logs) | no hit | no hit | no hit | no hit |

- `ps` is refused, but the kernel call behind it is open: a Python `ctypes` call to `sysctl` with `KERN_PROCARGS2` returned the arguments and the environment of the processes of the same user (every other process gave `EPERM`; the number of readable processes is in `p44_safety_s1.json`). With mechanism A through the plain CLI, the real value sits in the srt process environment from exec time, and the probe read it from there; the hash of the string matched the real secret and the process was `node .../cli.js --settings ...`. Mechanism A therefore fails the "never holds" test as the CLI is normally started.
- The secret stays out of reach in these variants: a wrapper script that receives the secret on stdin, sets `process.env` at run time and then imports `dist/cli.js` (s1c), and the library with `process.env.X = value` set at run time (s1b): the run-time `setenv` is not part of what `KERN_PROCARGS2` returns, so the scan found only the sentinel. The child gets an explicit environment without the variable. The srt session needs the variable in `process.env` for the whole session, because a later `wrapWithSandbox` with the variable unset passes nothing into the sandbox (the second command saw an empty `TOK`). Every other child the host spawns must also get an explicit environment, or the real value is in its exec-time environment.
- B keeps the real value in a JavaScript closure of the host. It is in no process environment and no argument list.
- Any secret in the arguments of any process of the same user, and in the exec-time environment of most of them, is readable by sandboxed code through this call (a token passed to any tool as a command-line argument is exposed the same way). This is a property of the macOS profile, outside this proposal, and sets the rule that the app never puts a real secret in an environment or argument list. It also covers secrets the app does not control: the exec-time environment of the app itself (inherited from the shell when the app is started from a terminal) and of the user's other shells, editors and tools.
- Review (2026-11-22, separate scratch scripts, srt CLI with default settings and the library under Node and Electron as Node): from inside the sandbox, `KERN_PROC_ALL` lists every process (pid, parent, user, name); `KERN_PROCARGS2` returns the argument list of every process of the same user and the exec-time environment of a Homebrew `bash`, Node, Electron and the Xcode Python, while the environment of an Apple platform binary (`/usr/bin/perl`) came back empty; `proc_pidinfo` returns the executable path, the working directory and the open descriptors, and `lsof -p` works. `ps` and `pgrep` fail, `task_for_pid` returns `KERN_FAILURE`, and processes of other users are refused. A value set with `process.env.X = ...` at run time and a value held in a closure were not found.
- No Seatbelt rule tried with `sandbox-exec` blocks `KERN_PROCARGS2`: `(deny sysctl-read (sysctl-name "kern.procargs2"))`, a `kern.procargs` prefix, `(deny sysctl*)` and `(deny process-info*)` all left it readable. An explicit `(deny process-info-pidinfo process-info-pidfdinfo)` blocks the path, working directory and descriptor list (`lsof` then prints nothing); srt's own `(deny default)` does not. srt 0.0.83 has no setting or hook that adds rules to its profile. Denying `process-info*` broke the Xcode `python3` shim (exit 133) and not node, git, npm, java, cargo or uv.
- The ephemeral proxy CA key is written to the srt temp directory (`ca.key`, mode 600, same user) and the sandbox read it. It cannot reveal the secret, but a CA key that the sandbox can read is avoidable: pass `caCertPath` and `caKeyPath` of a CA stored outside the readable area.
- `credentials.files` on macOS (s8): a masked file, with or without `extract`, becomes unreadable (`Operation not permitted`), so a tool cannot read a sanitized copy; `mode: "deny"` on an environment variable leaves it unset.

### 2. A host outside `injectHosts` (s2)

Only the placeholder or sentinel arrives at `other.localhost`, at a subdomain of the inject host, and at the IP literal of the same server. Host names are canonicalized before matching: `REGISTRY.LOCALHOST` and `registry.localhost.` match the inject host and are substituted (both mechanisms). With `injectHosts` omitted, mechanism A defaults to `network.allowedDomains` and the real secret went to `other.localhost` as well. A per-credential list works: the sentinel of credential one sent to the host of credential two stays a sentinel, and credential two is substituted there.

### 3. The echo endpoint on an inject host (s3): fail

The reflected header, `set-cookie` and the body all carried the real value back into the sandbox, for both mechanisms. Mitigations:

| Mitigation | Result |
|---|---|
| `network.stripResponseHeaders` (`x-echo-authorization`, `set-cookie`) | removes the headers; the body still holds the value |
| `onResponse` observer in the filter | receives `(status, headers)` only, a copy; no body argument; changes have no effect; the value stayed in the response |
| path scoping inside `filterRequest` (substitute only below `/npm/`, `/maven/`, `/cargo/`) | `/echo` gets the placeholder only |

Not covered by anything: a body reflection on an allowed path. The credential itself stays usable (s9): a `PUT` with the placeholder reached the registry with the real value in A and B; method scoping in the filter (substitute only for `GET` and `HEAD`) sends the placeholder, and the write gets 401. Substituting only on a path and method allow-list is the only measure that shrinks this; it exists only with `filterRequest`.

### 4. Plain HTTP with the placeholder (s4)

By default the placeholder or sentinel travels in cleartext and is not substituted (A and B). A filter that sets headers without checking `scheme` gets `403` (`the allow decision sets headers, and headers are not set on plain-HTTP requests unless plaintext header sets are enabled; nothing was forwarded`), so a filter bug fails closed. The opt-ins `credentials.allowPlaintextInject` (A) and `network.allowPlaintextHeaderSet` (B) send the real value in cleartext; both stay off. An absolute-URI request through the proxy listener behaves like plain HTTP.

### 5. `refuseOpaqueTunnels` and `requireHostMatch` (s5)

| Case | Default | With the option |
|---|---|---|
| CONNECT to a host in `excludeDomains` | tunnel opens, the client talks TLS to the registry, the registry sees the placeholder or sentinel | `refuseOpaqueTunnels`: `403` on the CONNECT |
| SOCKS5 to the inject host | end-to-end TLS, placeholder only | `refuseOpaqueTunnels`: SOCKS error |
| CONNECT carrying plain HTTP | tunnel, placeholder only | `refuseOpaqueTunnels`: empty reply |
| CONNECT to `other`, SNI and Host name the inject host | proxy keys substitution on the CONNECT target: no substitution at `other` | `requireHostMatch`: the client rejects the certificate minted for the target |
| `Host` header differs from the CONNECT target | the proxy rewrites Host to the target and substitutes for the target | `requireHostMatch`: `421` |

Without the options nothing leaks in these cases; the options turn silent opaque paths and ambiguous requests into refusals, which a policy that wants to see all traffic needs. Both settings are accepted in the CLI settings file.

### 6. Other routes to the substitution (s6)

| Route | A | B (filter as written: `Authorization` only) |
|---|---|---|
| placeholder in the URL query or path | not substituted | not substituted |
| placeholder in a request body | substituted (the registry saw the real value in the body, and the echo returned it) | not substituted |
| placeholder in another header (`X-Api-Key`) | substituted | not substituted |
| placeholder inside base64 (Basic) | not substituted | not substituted by this filter, which has no Basic decoding; the filter of the tool matrix decodes Basic |
| redirect from the inject host to another host, client resends the header | other host sees the sentinel or placeholder | same |
| redirect from another host to the inject host, client resends | substituted at the inject host, by design | same |
| `TRACE` to the inject host | forwarded with the real value | `405` (`the TRACE method is not forwarded`) before the callback |
| credential one's sentinel at credential two's host | not substituted | not applicable |

The proxy does not sign or echo anything on its own. AWS SigV4 re-signing exists only for `credentials.sigv4` pairs and was not configured.

### 7. Derived values and tool output (s7, verbose runs)

An HMAC over the placeholder is sent as computed, the registry classifies it `other`, and nothing substitutes it. The sentinel is visible inside the sandbox in `env` and in tool output that prints the variable; the verbose runs of npm (`--loglevel silly`), cargo (`-vv` with `CARGO_HTTP_DEBUG`), Gradle (`--debug`) and Maven (`-X`) printed neither the placeholder nor the real value (cargo prints `Authorization: [REDACTED]`).

## CLI settings file compared with the library

| Feature | CLI settings file | Library |
|---|---|---|
| `credentials` (envVars, files, awsPairs, sigv4, allowPlaintextInject) | yes | yes |
| `network.tlsTerminate` (excludeDomains, extraCaCertPaths, caCertPath and caKeyPath, limits) | yes | yes |
| `stripResponseHeaders`, `refuseOpaqueTunnels`, `requireHostMatch`, `ambiguousRequestTarget` | yes (tested) | yes |
| `network.filterRequest`, `onResponse`, ask callback, per-command allow lists, `annotateStderrWithSandboxFailures`, violation store | no: `network.filterRequest: filterRequest must be a function` | yes |
| Where the real value for A comes from | environment of the srt process at exec time (readable) unless wrapped | `process.env` at wrap time (set at run time, not readable) |
| Header substitution scope | every header and body, fixed | whatever the callback does |

## Embedding SandboxManager in a long-running host (p44_embed)

| Measure | Node 22 | Electron 45 Node 24 |
|---|---|---|
| `initialize` (median) | 62 ms | 89 ms |
| `wrapWithSandbox` | 7 ms | 6 ms |
| first wrapped curl through terminated TLS, including spawn | 97 ms | 150 ms |
| `reset` | 2 ms | 2 ms |

- One `initialize` opens one TCP listener on 127.0.0.1 (the mux proxy for HTTP and SOCKS), a few Unix sockets, a CA directory and a bundle directory in the temp directory. `reset` closes the listener; descriptors and temp entries did not grow over repeated initialize and reset rounds. `initialize` and `reset` repeat without problems in one process.
- B's TLS termination, the filter and `setDefaultCACertificates` work under Electron's Node (BoringSSL build); the real Electron main process was not started, only its Node through `ELECTRON_RUN_AS_NODE=1`.
- When the host quits, the listener goes in every case. Sandboxed children keep running as orphans and their requests fail (the proxy is gone), so the app has to end its sandboxed process groups itself.

| Host exit | Proxy listener | Sandboxed child | srt temp entries left |
|---|---|---|---|
| `reset()`, then exit | closed | still running | none |
| plain exit | closed | still running | none |
| SIGTERM with a handler that exits | closed | still running | none |
| SIGKILL | closed | still running | CA directory with `ca.key`, bundle directory, mux socket |

- Violations: the library records `deny network-outbound <host>:443 (host is not on the allow list)` in the violation store, and `annotateStderrWithSandboxFailures(commandId, stderr)` appends a `<sandbox_violations>` block to the tool's stderr when the `commandId` is passed to `wrapWithSandbox`. The CLI prints only the tool's own error (`CONNECT tunnel failed, response 403`) and the shell's `Operation not permitted`; `--debug` adds `Connection blocked to <host>:443`.

## Cost per run

| Command | Unsandboxed | Library (B) | CLI (A or A2) |
|---|---|---|---|
| `true` | 11 ms | wrap 7 ms | 224 ms (214 ms with a `credentials` block) |
| curl to the registry | 14 ms | 97 ms, first run | 297 ms |
| npm install, one package | 380 to 460 ms | 500 to 830 ms | 720 to 990 ms |
| cargo fetch | 170 to 430 ms | 180 to 220 ms | 360 to 400 ms |
| Gradle `compileJava` | 4300 to 6300 ms | 4600 to 5600 ms | 4400 to 4500 ms (A2) |
| Maven plugin and dependency resolve | not measured (a clean baseline needs Central trust) | 13 to 15 s | 13 s (A2) |

The library adds little after one initialize. The CLI adds about 0.2 to 0.3 s per command for the proxy start and the seatbelt profile. Maven's time is the plugin download from Central through the proxy.

## Recommendation for the app

Use mechanism B, the library with `filterRequest`, for all tools of the first slice; use A only where the tool is configured with a prebuilt header or a bearer token and the secret reaches srt without an exec-time environment entry.

Reasons: B is the only mechanism that covers Basic auth (Gradle, Maven, uv) with a normal tool configuration; it keeps the real value out of every environment and argument list by construction; it scopes substitution by host, path and method, which is the only way to shrink the echo and write risks; it fails closed on plaintext; and it has no fixed placeholder shape. A is simpler for Bearer and token headers (npm, pnpm, cargo) and has per-credential host lists, but its default `injectHosts` is every allowed host, it substitutes in every header and body, it is not path-scoped, it cannot do Basic, and as the CLI is started it hands the secret to any sandboxed code through `KERN_PROCARGS2`.

| Tool | Mechanism | Sanitized config the app writes (temporary home, outside the checkout) |
|---|---|---|
| npm, pnpm | B | user-level `.npmrc` with `registry` and `_authToken=<placeholder>` |
| cargo | B | `credentials.toml` with the placeholder, `CARGO_REGISTRIES_<NAME>_INDEX`, `_CREDENTIAL_PROVIDER=cargo:token` |
| Gradle | B | `gradle.properties` in a temporary `GRADLE_USER_HOME`, truststore, `allowLocalBinding` |
| Maven | B | `settings.xml` with the placeholder password and `<proxies>`, truststore |
| uv | B | index URL with the placeholder in the userinfo |

What the user configures: a registry entry with the exact host (no wildcard), the secret (kept in the OS keychain, loaded into the host process memory only), the header form (Bearer, Basic or raw), the allowed path prefixes and the allowed methods (default `GET` and `HEAD`), and which tool configs to generate. The app generates the placeholder (letters, digits, `_`, `-`; the real secret's prefix and length) and the config files for each run, and sets up the Java truststore and proxy entries. Defaults to keep: `injectHosts` never empty, TLS only, `refuseOpaqueTunnels`, `requireHostMatch`, `allowPlaintextHeaderSet` off, a stable app-owned CA outside the readable area, `NODE_EXTRA_CA_CERTS` or `setDefaultCACertificates` for registries on a private CA, a clean explicit environment for every child of the host, and process-group cleanup of sandboxed children at quit.

Stays unsupported and ends `not_run` with a reason in the app:

| Case | Reason |
|---|---|
| tools that compute the credential (HMAC, Digest, NTLM, Kerberos, AWS SigV4 without `credentials.sigv4`) | the proxy substitutes text, it cannot repair a signature made over the placeholder |
| registries that need a client certificate | the host must stay in `excludeDomains`, so no termination and no injection |
| clients that compare the server certificate with a fixed value | the minted certificate is refused |
| token-exchange flows (Docker registry token endpoint, OIDC) | the exchanged token is a second credential that reaches the sandbox |
| a registry host that reflects the request body or headers on an allowed path | the secret returns in the response, and nothing in 0.0.83 can scan a response body |
| registries that redirect to another host (CDN, pre-signed storage) | each host needs its own entry; the signed URL itself reaches the sandbox |
| tools not run here (pip, go, git over HTTPS, bundler, Docker) | not probed |

Rough effort for a first slice: about 8 days (6 to 10). Host module with initialize, reset, process-group cleanup and CA handling 2 days; registry model, keychain storage and the filter (host, path, method, header form, Basic decoding) 2 days; config writers for npm, pnpm, cargo, Gradle and Maven with the Java truststore and proxy settings 2.5 days; defaults, hostile-command regression tests (these probes become the base) 1 day; settings screen and docs 0.5 day. Each further tool is 0.5 to 1 day. The independent review put the estimate at 12 to 15 days for macOS alone, for the reasons in the next section.

### Findings of the independent review that change the recommendation

The review (`docs/measurements/review-p-cred.md`) reproduced the claims that decide the design and added these points.

- **What the sandbox can learn about other processes.** Sandboxed code reads the process list, the full argument list and the exec-time environment of every process of the same user, and the working directory and open files through `proc_pidinfo`. It does not read the environment of Apple platform binaries, a value set at run time with `process.env`, or a value held in a closure; `task_for_pid` is refused. No Seatbelt rule tried blocks the arguments and environment (`sysctl-read` of `kern.procargs2`, a `kern.procargs` prefix, `sysctl*`, `process-info*`), and srt 0.0.83 has no setting that adds a rule. An explicit `process-info-pidinfo` deny blocks the working directory and open files. The consequence goes beyond this feature: any token that the user exports in a shell, an editor or the app's own inherited environment is readable by sandboxed code, so the app starts its host with a clean environment and the documentation says so.
- **Path scoping needs normalization.** A plain prefix check let a percent-encoded `..` through (`%2F`, `%2E`, `%5C`). The filter rejects those and dot segments and compares the decoded path. Every registry entry has an explicit allowed path prefix and no default of `/`: some GET endpoints of registries return credentials themselves.
- **More defaults.** The srt profile allows `file-read*`, so the app's data directory, its logs and its crash dumps belong in `denyRead`. Keychain access from the sandbox is untested (srt allows the Mach lookups of the security services).
- **The credential names belong to the project.** The config writers assume that the app chooses them, but a Gradle build script chooses the property or environment names, a Maven `server` id must match the one in the pom, and npm scopes registries. Each project needs its own mapping from registry to tool configuration.
- **Caches.** The probes used empty Maven and Gradle caches. A real run must either start cold every time or let the sandbox write to the user's `~/.m2` or `~/.gradle`, which allows cache poisoning. The throwaway APFS clone per run, described for the review ladder's check in record 0042, answers this.
- **Effort.** The additional work (path normalization, denyRead defaults, per-project mapping, per-run JVM truststores, the Maven `<proxies>` entry, a corepack home for pnpm, uv, and cleanup of process groups and of the files a SIGKILL leaves behind) raises the first slice to 12 to 15 days for macOS alone.

## Not verified

- A real private registry (Artifactory, Nexus, GitHub Packages, CodeArtifact, a corporate CA): redirects to storage, tarballs on another host, token exchange, HTTP/2, large downloads, and idle-connection behaviour (srt closes idle terminated tunnels after a few seconds).
- Linux and Windows. The `KERN_PROCARGS2` finding, the `ps` refusal, the masked-file behaviour and the Gradle loopback requirement are macOS results; bubblewrap has its own process and file rules.
- The real Electron main process (app lifecycle, `app.quit`, renderer crashes); Electron's Node was run only through `ELECTRON_RUN_AS_NODE=1`.
- Host process memory: the review found `task_for_pid` refused from inside srt for one Node process outside the sandbox; other routes (core files, Electron crash dumps under the app data directory, which the default `file-read*` leaves readable) were not tried.
- Keychain access from the sandbox: srt allows `mach-lookup` of `com.apple.SecurityServer` and `com.apple.securityd.xpc`; whether a sandboxed `security find-generic-password` reaches the app's item, or only raises a prompt the user could accept, was not tried.
- Gradle with a long-lived daemon, configuration cache, Maven wrapper, pip, go, git credential helpers, Docker, uv with a header option, AWS `credentials.sigv4`.
- `strictAllowlist`, `deniedResolvedAddresses` and `registerCommandNetworkLists` with real remote names; concurrent commands with their own `commandId`.
- Maven unsandboxed baseline time.
- Later srt versions: `tlsTerminate` is experimental and the substitution rules may change; this is 0.0.83.
- The `srt proxy` mode with an external decider process, which could host B outside the Electron main process.
