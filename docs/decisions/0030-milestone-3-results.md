# 0030 Milestone 3 results

Status: accepted
Date: 2026-11-18
Decided by: spike agents
Inputs: 0004, 0006, 0009 to 0013, 0019, 0022 to 0029; `probes/RESULTS.md`, `notes/probes-m3-permissions.md`, `notes/probes-m3-isolation.md`, `notes/browser-tools-mapping.md`; `docs/measurements/*.md`; `docs/parity.md`, `docs/blocks.md`; the design, review, builder, integration, quality, verification and fix reports of the milestone 3 run (summarized here, not stored as files)

## Context

0024 closed milestone 2. 0025 records the user's answers: the permission mode is selectable per profile and per session with auto as the default, ask rules for outward-facing tools, a hook on every tool call and a network policy; local agents run as the user; third-party software may be installed for the isolation probes under stated precautions; the repository is public on purpose. 0025 also set the scope: the browser surface with observation, the permission model with the outward-action gate, task start, agent nodes with usage views, and the srt and container providers. The review slice and the OpenShell provider moved to milestone 4.

Milestone 3 ran in these steps:

1. Surveys and probes in parallel: the browser tool mapping (`notes/browser-tools-mapping.md`), the isolation probes I1 to I3 (`notes/probes-m3-isolation.md`), the permission probes P20 to P24 (`notes/probes-m3-permissions.md`). Each probe report had an independent review and partial re-run.
2. Designs, each with an independent review that edited it: 0026 (browser surface and observation, with probe PB1), 0027 (agent nodes and usage), 0028 (permission model and task start).
3. Contracts and stubs (0029).
4. Builders in parallel on disjoint files: w-browser, w-agents, w-permissions, w-tasks, w-iso.
5. Integration, then a test-quality step (extraction of Electron-bound decisions, unit tests, a mutation script).
6. Independent code reviews of the core modules and of the main process, renderer and e2e tests, and a verification from a clean copy.
7. A fix step that applied the review findings and added "Changes after review" to 0029.
8. This record, then a cross-review of 0026 to 0030, the READMEs and the probe notes against the code, the test runs, the probe logs and the host state. Its corrections are in the text below; `docs/measurements/cross-review.md` lists them.

The steps were told not to commit, push or open pull requests. The milestone 3 changes were committed afterwards in two commits, the application code and then the records, notes and probes. The verification found HEAD equal to `origin/main` with no agent commits before that, and no agent push reached the remote.

## Decision

### What milestone 3 built

| Part | Built | Shown by |
|---|---|---|
| Browser surface (w-browser, 0026) | `browser-tab` leaves with a `WebContentsView` per tab placed by the layout host, parking in a hidden `BaseWindow`, stills during drags and while dialogs, menus and popovers are open; tab chrome drawn by the app (navigation, address field without search, service badge, observation control, Open in Chrome, menu); a persistent partition per service under the profile data directory with a storage path check; address, navigation, `window.open`, permission and download guards; the `agide-browser` MCP endpoint (`/mcp/<session>/browser`) with the Claude in Chrome tool names and a CDP page session; the site table for acting calls; `slack-thread` registered as a surface type in `SurfaceTypeRegistry` | `src/core/browser`, `src/main/browser` tests; `e2e/browser.spec.ts`; `scripts/browser-checks.mjs` (first-slice Electron checks, table in `probes/RESULTS.md`) |
| Observation (w-browser, 0026) | `surfaces_observe`, the per-tab switch (off, on demand, live) that only the user changes, the tree row indicator, the access log `observation_log` (no content) with a per-tab popover, redaction of URLs, headers, cookies, sensitive fields and console text, blocked addresses from `browser-blocked.json`, the "not shared" mask in `ui_capture_window`, the `UserPromptSubmit` digest from `digest.json` | same, plus `e2e/milestone3.spec.ts` |
| Agent nodes and usage (w-agents, 0027) | Hook, stream-json and transcript adapters into `AgentFact`; a SQLite agent store with repair at start; tree rows with state, running count, waiting marker, finished tally and removal timers; history and read-only transcript panes with gzip copies under a size cap; the status line command writing `status.snapshot`; `UsageEngine` with message-id dedupe, 10-second rate buckets, ranking, heat markers, folder rollups, own-profile plan usage with a forecast; usage alerts as inbox items with pause and stop on a click | `src/core/agents`, `src/core/usage` tests; `e2e/agents.spec.ts` |
| Permission model and gate (w-permissions, 0028 part 1) | `PermissionSettings` per profile with the Permissions section in a profile settings panel; a new-session dialog with the mode; mode resolution (session request, then `AGIDE_PERMISSION_MODE` as a test override, then the profile default, auto when unset); bypass only on a provider with an enforced filesystem and a process-wide allowlist, with confirmation and a working inspector; the action class table; the policy builder (ask and deny rules, Bash sandbox with `strictAllowlist` and `allowUnsandboxedCommands: false`, `GIT_CONFIG_COUNT` rewrite of GitHub SSH remotes to HTTPS); the shell parser and classifier; the `PreToolUse` inspector run as `ELECTRON_RUN_AS_NODE` with `out/main/inspect.js`; class on approval items and `gate:deny`, `gate:notify` and sandbox-block status items | `src/core/permissions` tests; `e2e/permissions.spec.ts`; `scripts/real-claude-gate.mjs` |
| Task start (w-tasks, 0028 part 2) | Sources: prompt, GitHub pull request URL or `owner/repo#n`, Jira key or URL; the new-task dialog and `task_start` (UI and MCP); a plain folder or a git worktree under `~/Agide/worktrees`; pull requests fetched as `pull/<n>/head` from the remote that matches `owner/repo`; `task-source.md` with the pull request data under `~/Agide/sources/<folder id>`, passed with `--add-dir`; the composed prompt with untrusted-data framing; `task_starts` rows and a 0021 task row; folder-trust handling with a banner and an inbox `input` item | `src/core/tasks` tests (temporary repositories with a local bare remote carrying `refs/pull/1/head`, a fake `gh`); `src/main/modules/tasks.test.ts`; `e2e/tasks.spec.ts` |
| Isolation providers (w-iso, 0029) | `SrtProvider` (`srt -s <settings> -- claude`, generated settings per session) and `ContainerProvider` (`docker run -it --rm --init` per launch, mounts at the same path, `docker kill` on SIGKILL, orphan removal by an owner label); `HostEnvironment` as the shared base of local, srt and container; provider choice per profile with capability statements in the settings panel (`isolation_status`, `isolation_set_provider`, both not MCP tools) | the shared provider contract suite unskipped on local, fake, srt (real srt from the probe prefix) and container (Docker with local alpine); `e2e/isolation.spec.ts` |
| Integration | Network policy from the profile allowlist; browser navigation consent from that allowlist; browser permission requests as inbox approval items; `core/permissions/hosts.ts`; `e2e/milestone3.spec.ts` with a fake claude and a fake srt; `scripts/e2e-real-claude-m3.mjs` | the full suites below |
| Test quality | Pure modules extracted from Electron-bound and e2e-only code (`viewPlacement.ts`, `inspectCommand.ts`, `blocked.ts`, `alertAction.ts`, and smaller functions); `ElectronViews` tested against a mocked `electron`; `pnpm mutation` (`scripts/mutation-checks.mjs`); a race in the trust-dialog fixture fixed; thresholds raised | `pnpm mutation`: every mutation killed after the tests it led to |
| Probes | P20 to P24 (ask rules in auto mode, `PreToolUse` hook, modes, sandbox settings, folder trust), I1 to I3 (srt, container, OpenShell), PB1 (MCP server names), the browser first-slice checks | `probes/RESULTS.md`, the two milestone 3 notes, `probes/out/` with reviewer re-runs in `probes/out/m3-review/` |

At the end of the fix step `pnpm typecheck`, `pnpm coverage`, `pnpm build`, `pnpm e2e` and `pnpm parity` pass, and `scripts/e2e-real-claude.mjs` passes against the real CLI on Haiku. `pnpm typecheck` and `pnpm coverage` were run again for this record and pass. The cross-review ran `pnpm typecheck`, `pnpm coverage`, `pnpm e2e`, `pnpm parity`, `pnpm blocks-docs`, `pnpm mutation`, `pnpm coverage:e2e`, `real-claude-gate.mjs` and `e2e-real-claude-m3.mjs` in the working tree after the fixes. All pass except `pnpm mutation`, which failed until the entries that the fix step's edits had left without a matching source line were corrected (see "Tests and coverage").

### What each slice shows against the requirements

| Requirement | What is shown | What is not shown |
|---|---|---|
| R12 surfaces (0002, design 0026) | A browser tab is a tree leaf with a native view that follows the layout: placed in its slot, hidden behind stills during drags and under in-app dialogs and menus, closed when the leaf is removed (e2e through `app.evaluate`: bounds against the slot, visibility, view count). Each service has its own partition under the profile, and a link to another service opens a tab of that service. Pages get no permissions except fullscreen and sanitized clipboard writes; only `http`, `https` and `about:blank` load, also for CDP navigation. `slack-thread` exists as a type. | A Slack surface with content (the Slack tab is a `browser-tab` with service `slack`, observation ids only). On-screen stacking in a visible window, zoom and other scale factors. Sign-in pop-ups, downloads during an acting call, certificate errors, crashed renderers, JavaScript dialogs and the eviction at the view limit ran in no test. Page shortcuts (Cmd+L and others), zoom keys, a leaf in two panes. Slack and Notion URL formats against real URLs. |
| R13 shared awareness (0002, design 0026) | An agent reads a tab of its own folder only while observation is on; a tab of another folder answers like an unknown id, a forged leaf is refused, and observation off refuses the page tools, `surfaces_observe` and the window capture (pixel sampled for the mask). Page content carries an "Untrusted page content" line; secrets in URLs, cookies, fields and console text are masked. The access log keeps origin, kind, size and outcome, never content. The digest reaches the session through a `UserPromptSubmit` hook (fake claude). | The observation log pane (the block is a placeholder). The digest in a real session. Masking cannot stop an agent that encodes a secret in `javascript_tool` before returning it; the site table asks on signed-in sites for that reason. |
| R15 Claude in Chrome tools (0002, design 0026) | The `agide-browser` server serves `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `computer`, `read_page`, `find`, `form_input`, `get_page_text`, `javascript_tool`, `read_console_messages`, `read_network_requests` and `browser_batch`; sessions start with `--no-chrome`. In the integration real-Claude run (Haiku, auto mode) the agent called `tabs_context_mcp`, `find`, `computer` and `get_page_text` with no permission dialog, and the click reached the local page's server. Acting calls follow the site table: loopback runs, other web origins ask once per session, Jira, GitHub and Notion ask on every call, Slack and Discord refuse; navigation answers never grant acting calls. | `resize_window`, file and image upload, GIF recording, cross-origin iframes in `read_page`. The `--chrome` profile setting ("Also use Claude in Chrome"). P16: how long the CLI keeps an MCP call open (approval wait 115 s, entry timeout 150 s, not probed). The effect of `--no-chrome` on the tool list in a real session. |
| R16 visible swarms (0009, design 0027) | Subagent hook events become agent nodes under the session leaf with state, count and waiting marker; finished nodes leave after the delay and appear in the history; the transcript opens read-only, only after `realpath` shows it below the session's projects directory or the transcript copies. | App-started agents: there is no `-p` stream-json launch path, so the stream adapter, the cap of 4 and the cap alert run on fixtures only, and app-started agents are not drawn under their caller. Workflow groups and phase headings. Probes U1 to U7. Any real subagent run through the app. |
| R17 collaboration tooling: the permission gate (0010, 0011, design 0028) | Every launch carries ask rules for outward classes (GitHub writes, pushes, publishing, ssh, connector writes, unknown connector and MCP tools) and the inspector hook. The inspector reads compound commands, substitutions, quoting, `sh -c`, wrappers and git options, answers `deny` or `ask` with the class or no decision, never `allow`, and asks about commands it cannot read. With the real CLI in auto mode (`real-claude-gate.mjs`), `git push origin HEAD` met the static ask rule, `git -C . push origin HEAD` was stopped by the inspector, `git status` ran, and nothing reached the origin. In the integration real-Claude run the push showed "Rule Bash(git push *) from command line arguments overrides auto mode"; Escape refused it and the inbox held "Approve: git.push to origin HEAD". The inspector starts in about 70 ms per call. | Probes Q1 to Q7 (`onFailure: block`, ask under bypass, gh keyring in the sandbox, wildcard hosts, resume with another mode, Slack and Notion ask rules). The session header with the mode the payloads report. Draft editing, notify for pushes to the task's own branch, per-server overrides. The inspector in a real interactive session beyond the gate script, and in the packaged app. The inspector does not see programs called by path, scripts, user aliases, `npx`, `direnv exec` or package scripts (0028 known gaps). |
| R24 usage visibility (0019, design 0027) | The status line command delivers cost and plan windows per session; the ranking orders sessions by recent rate; plan usage from the status line shows in the rail for the own profile; a plan threshold alert reaches the inbox; pause (Esc in the PTY) and stop act only on a user click. Per-message usage counts the largest value per token class, so repeated transcript lines never subtract. | Real CLI payloads through the app: the status line, `cost-state` (the integration real run left no `cost-state` row, so its cost is unknown), the price table values. Plan usage of other profiles. Behaviour over hours of use. Whether a user-level `statusLine` is replaced. |
| S2 task start (R6, design 0028) | A pull request task from the dialog with a fake `gh` creates a folder, a worktree as the session directory, `task-source.md` passed with `--add-dir`, a composed prompt without the pull request text, a `github` tab in the folder and a task row; the launch carries auto mode, the ask rules, the inspector, the status line, the digest hook, `--no-chrome` and both MCP servers (`e2e/milestone3.spec.ts`). Guidance is read from `CLAUDE.md` at `<remote>/<base branch>`, never at the pull request head. `task_start` from an agent is capped at the caller's mode, refused for bypass, limited to repositories the user already used, and counted against the cap of 4 including starts in progress. The trust dialog is answered only for a directory the app created in that start and only with the profile setting on. | A start against a real public pull request with a real `gh`; a Jira start with a real connector call (connectors next to the app's `--mcp-config` are not checked). The trust dialog against the real CLI. The worktree removal question on folder deletion, the Cmd+Shift+N binding, a native directory picker, "Sign in to gh". Slack and Notion sources. A real-Claude task start script. |

### What the isolation providers show

| Provider | Shown | Not shown |
|---|---|---|
| srt 0.0.83 (I1, `SrtProvider`) | The real claude runs in a PTY under srt with the subscription login from the host Keychain; writes outside `allowWrite` and requests to hosts outside `allowedDomains` are refused, an allowed host works. The TUI needs `allowPty`, the loopback MCP server needs `allowLocalBinding` (which opens every loopback port), the Bash tool needs `/private/tmp/claude-<uid>`. srt forwards SIGTERM to the inner process; SIGKILL goes to the process group, because killing srt alone left claude running. srt adds about 0.1 to 0.2 s per start (fake claude through the app: create to idle 257 and 315 ms under srt against 165 and 110 ms local). The profile allowlist becomes srt's allowed domains; `denyWrite` covers the Claude settings, `CLAUDE.md`, commands, agents, skills, plugins and hooks; under srt 0.0.83 with a shell stand-in these entries hold inside the writable configuration directory (overwriting, creating, renaming and linking a protected name fail, other entries and `.claude.json` stay writable; cross-review, no test keeps this). Bypass is offered only on srt. | A real claude through the app under srt (the e2e uses a fake srt; the srt real-Claude script of 0029 was not written). srt on Linux. srt's own mandatory deny list. Whether the Anthropic host list is complete. `.claude.json` stays writable, so a sandboxed agent can still add user-scope MCP servers there. The Keychain stays readable, so the agent can read its own login. |
| Container (I2, `ContainerProvider`) | With the fake claude on alpine: PTY, resize, Ctrl-C, SIGTERM through the docker client, the events directory, host MCP through `host.docker.internal` with a per-grant `Host` allowance, bind-mount ownership and teardown. Start to first output about 150 ms. The gh directory is mounted read-only, mounts use `--mount`. | Any real claude in a container (no Linux build was available, and a usable image would exceed the 100 MB pull limit), the login inside it (D3). No network policy. The inspector hook cannot run inside the container (`inspectorHook: 'unavailable'`), so only the ask rules apply. The provider is listed with its statement and is not selectable. |
| OpenShell 0.1.9 (I3, probe only) | Installs from checksummed release archives without administrator rights or Homebrew; runs on local images with about 33 MB of runtime images; filesystem and per-binary network policy, host MCP through the policy, a PTY through `sandbox exec --tty` and `sandbox connect`, a credential placeholder. Create to Ready 1 to 2 s. Events leave only through `sandbox download` or HTTP. The gateway needed `supervisor_network_mode = "bridge"`, plaintext loopback, `allow_unauthenticated_users = true` and launch-signing certificates. | A real claude and any login inside; no provider was built (milestone 4). The live policy reload, the provider placeholder and the Keychain test were manual steps without logs. |

### Probe and build results that change earlier records

0029 lists the probe amendments of 0010, 0011, 0019 and 0022 ("Probe results that change earlier records"); they are not repeated here. The tables below add the statements of 0004 and 0028 and what the build, the integration and the reviews add to 0010, 0011, 0019 and 0022. None of these records is rewritten; the amendments apply when each is next revised.

0004:

| 0004 statement | Finding | Amendment |
|---|---|---|
| Decision 2: "`--permission-mode` set by the app" | P22: `--permission-mode` accepts `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`; `manual` is reported as `default` in `system/init` and hook payloads; `defaultMode` in `--settings` works and the flag overrides it. The build sets the mode from the session, then the profile default (auto). | The mode comes from the session or the profile, auto by default; `dontAsk` is not offered; bypass only on a provider that limits files and the whole network, with a working inspector. Map `default` to manual. |
| Decision 2: "`--mcp-config` with the app server entry" | PB1: the CLI accepts `browser` and `agide-browser` as server names and drops `claude-in-chrome` without an error. The build adds the `agide-browser` entry with `timeout` and launches with `--no-chrome`. | Two entries, `app` and `agide-browser`; `--no-chrome` unless the profile turns Claude in Chrome on (not built). |
| Decision 1: status from hooks in `--settings` | The launch settings now also carry ask and deny rules, the sandbox, the inspector as the `PreToolUse` command (replacing the app's base hook), `statusLine`, and a second `UserPromptSubmit` command for the browser digest; task starts add `--add-dir`. Contributions merge with one owner per key (0029). | List these keys as part of every launch. |
| Decision 7: PR tasks run with `--strict-mcp-config` and have no Atlassian connector | Every app launch uses `--setting-sources user` and no `--strict-mcp-config`, PR tasks included (0028). Whether claude.ai connectors stay available next to `--mcp-config`, and whether a PR worktree's `.mcp.json` stays out in the TUI, were not checked. | PR tasks launch without `--strict-mcp-config`; both checks stay open. |
| The folder-trust prompt (added by 0014 and 0024) | P24: the TUI looks up the directory and its ancestors (bounded by the git root) in `.claude.json`; `-p` never shows the dialog; `CLAUDE_CODE_SANDBOXED=1` skips it and writes nothing (undocumented); `--settings` keys and `--dangerously-skip-permissions` do not. Down then Enter answers Yes and stores trust. The build answers only for a directory the app created in that start and only with `trustAppCreatedFolders` on (default off); otherwise a banner and an inbox `input` item. | The app detects the dialog by the latest frame and answers under that rule; `CLAUDE_CODE_SANDBOXED` is not used. |
| Context table, row "Approval"; risk "PTY deny path untested" | P21 in the TUI: hook deny, ask, allow and `updatedInput` work as in `-p`; a hook allow does not lift an ask rule; exit 1 and a timeout hand the call to the mode. Integration: Escape on an ask-rule dialog interrupts the turn and fires no hook, so the session stays `waiting` and the hook approval item stays open. | PTY deny through the hook is shown. A refusal in the TUI needs another signal to clear the waiting state. |
| Decision 2: the launched command is `claude` | With the srt provider the command is `srt -s <settings> -- claude <args>`; the `--` is required (I1). | The provider owns the command. |

0010 (in addition to 0029):

| 0010 statement | Build or review finding | Amendment |
|---|---|---|
| Section 6: the outward-action gate covers CLI tool calls through rules, a hook and the sandbox | Clicks, typing and scripts in a signed-in browser tab are outward actions the CLI gate does not see. The browser module enforces a site table in the main process on every acting call (0026). A navigation can carry data out; under srt the tabs an agent opened or drives are held to the allowlist through a request policy (review fix). | Add browser acting calls and agent navigation as gate classes enforced by the app. |
| Section 8: "a `PreToolUse` hook that runs for every call, maps it to a class and records it" | Built as the inspector. It never answers `allow`, writes its record into the session's inbox directory, and turns an ask into a deny under bypass. It cannot run in the container provider. | Record the never-allow rule and the provider dependency. |
| Approval from the inbox card waits for the `http` hook transport (0024) | Browser approvals are held by the app, so their inbox card offers Deny and Allow once and dismissing denies. Hook approvals are still answered only in the TUI. | Split: app-held approvals from the card now; hook approvals with the `http` transport. |

0011 (in addition to 0029):

| 0011 statement | Build or review finding | Amendment |
|---|---|---|
| Section 1 table: PR start with "PR text, threads and failing checks as context" | The pull request context is title, author, state, head branch, description and changed files in `task-source.md`, read by the agent as a tool result; threads and failing checks wait. | Narrow the first slice. |
| Section 3: agents started by an agent | `task_start` from an agent needs its folder scope, cannot use a looser mode than its caller, cannot use bypass and counts against the cap of 4 including starts in progress (review fix). App-started stream-json agents are not built. | Record these rules; the stream-json path stays open. |
| Section 1 table: Jira start "the prompt tells the agent to read the issue" | Built; the read relies on the connector being present next to `--mcp-config`, not checked. | Mark as unverified until a real Jira start runs. |

0019 (in addition to 0029):

| 0019 statement | Build or review finding | Amendment |
|---|---|---|
| The status line command "writes the received JSON to the session's events directory" | It writes `status.snapshot` (no `.json` suffix, so the hook reader neither delivers nor deletes it); only identifiers and numeric fields are kept, never the absolute paths of the payload. | Record the file name and the kept fields. |
| Session totals from `cost-state` at exit (0024) | The integration real-Claude run ended after an interrupted turn and its transcript held no `cost-state` row. The first status line cost of a session is a baseline, so a resumed session does not spike the rate; a lower cost starts a new segment. | `cost-state` at exit is unverified for sessions the app ends; the status line baseline rule applies. |
| Plan usage per profile | The rail shows the own profile only. | Other profiles stay a question for the user (0025). |

0022 (in addition to 0029):

| 0022 statement | Build or review finding | Amendment |
|---|---|---|
| srt `terminate` (0029: not probed) | SIGTERM to srt reaches claude; SIGKILL must go to the process group. | Settled. |
| srt network policy | srt accepts no allow-everything entry. "Unrestricted" maps to the Anthropic hosts, loopback and a short development host list; the profile allowlist replaces that list. | Record the mapping. |
| srt filesystem policy | The whole Claude configuration directory was writable, so a sandboxed agent could add hooks or settings that run later outside the sandbox (review). `denyWrite` now covers the settings files, `CLAUDE.md`, `keybindings.json`, commands, agents, skills, plugins and hooks; `.claude.json` stays writable. | Record the deny list and the remaining `.claude.json` gap. |
| Container provider | The gh directory is mounted read-only; mounts use `--mount type=bind`; paths with a comma or line break are refused; the inspector hook is unavailable; orphan containers are removed by an owner label from the data directory, never from `prepare`. | Record these rules. |
| Setup pane: the login terminal in `data/login` (0024) | `session_create` refuses a working directory inside the app root, so the login terminal always failed (review). It now runs in `Agide/login-<profile id>` below the home directory; `ProfilePaths.login` is removed. | Move the login directory. |

0028:

| 0028 statement | Build or review finding | Amendment |
|---|---|---|
| Section 1: the session header shows the mode from payloads, and the `permission_mode` column follows the payload mode | Not built. Hook payload files sit in a directory the agent can write, so a forged payload could change the mode of the next launch; the stored mode is the mode of the latest launch. | Wait for a mode source the agent cannot write (the `http` hook transport). |
| Section 3: the inspector moves to the `http` hook transport if start-up is above 300 ms | Measured about 70 ms per call as `ELECTRON_RUN_AS_NODE`. | The command hook stays. |
| Section 3: the inspector runs for every launch | The container cannot run the host's Electron binary; it declares `inspectorHook: 'unavailable'` and only the ask rules apply there. When `inspect.js` is missing, the hook is left out with a warning. | The inspector depends on the provider. |
| Section 5: with the sandbox on, `LocalProvider` reports `network: 'bash-allowlist'` | It still reports `none`. | Open. |
| Section 5: the network allowlist | It also becomes srt's allowed domains, and counts as consent for agent browser navigation only to `https` hosts that belong to no signed-in service (review fix). | Record both uses. |
| Section 6: bypass when the provider reports an enforced filesystem and an allowlist | Bypass also requires a working inspector (review fix); only srt qualifies. Q2 is not probed, so the inspector turns ask into deny under bypass, as section 6 allows. | Add the inspector condition. |
| Section 10: worktree removal only on the user's answer when deleting the folder | `removeWorktree` exists and is tested; the dialog is not built. A failed start removes its own worktree, deletes its branch with `-D` and removes the source directory. Remotes are read with `git config --get-regexp`, since `insteadOf` rewriting changes `git remote -v`; an existing `agide` branch gets a suffix from the folder id. | Record these rules; the removal dialog stays open. |
| Section 12: `task-source.md` in a per-session source directory | The directory is `~/Agide/sources/<folder id>`, outside the app root, because the launch denies reads under the app root. A Read of it without a prompt in auto mode is not checked with the real CLI. | Record the location. |
| Section 12: `CLAUDE.md` at the base commit | The first build read it at the pull request head and labelled it as the base (review). It is now read at `<remote>/<base branch>` after `--end-of-options`. | Record the revision. |
| Section 8: probes Q1 to Q7 in the first slice | None ran. | Move them to milestone 4. |

### Review findings and what was fixed

The code reviews accepted the integrated code with fixes; the verification found a failing real-Claude script and stale statements in 0029. The fix step addressed the findings below. Contract changes are in 0029 under "Changes after review".

| Finding | Severity | Status |
|---|---|---|
| A pull request start put the pull request head's `CLAUDE.md` into the prompt as trusted guidance from the base branch | major | Fixed: read at `<remote>/<base branch>`; test with a head that changes `CLAUDE.md`. |
| The shell parser read several bash forms differently from bash (`$"..."`, `$(( $(...) ))`, backticks and quotes inside `${...}`, `time -p`, `function f { }`, `env -S`, git aliases, dynamic `gh api graphql`), so pushes passed unclassified | major | Fixed, each form as an inspector test. The CLI's own matching of these forms against the ask rules is not checked. |
| The embedded browser was a network path around the srt allowlist (loopback pages, redirects and page requests unchecked) | major | Fixed under srt with a request policy for agent tabs. Outside srt the browser is still not limited by the Bash sandbox list. |
| An answer to a navigation request also granted clicks, typing and `javascript_tool` on that origin | major | Fixed: navigation grants kept apart. |
| srt sessions could write the whole Claude configuration that unsandboxed sessions load | major | Fixed with `denyWrite`; `.claude.json` stays writable. The unit test checks the generated settings; the cross-review ran the same deny list under the real srt once. |
| The inspector hook named the host's Electron executable inside the container, so it failed open there | major | Fixed by declaring the inspector unavailable in the container; the `http` transport would restore it. |
| Native browser views covered in-app dialogs, menus and popovers, including the observation control | major | Fixed with view holds; an e2e test checks visibility through Electron. On-screen stacking not seen. |
| `navigate` without a tab produced a question nobody could answer; the inbox item had no answer actions | major | Fixed: a tab is created first; the card offers Deny and Allow once. |
| App events, including terminal output, were sent to sign-in pop-up windows | major | Fixed: events only to app-page windows. |
| "Open login terminal" always failed (working directory inside the app root) | major | Fixed: login directory outside the app root. |
| `scripts/e2e-real-claude.mjs` failed on every run (verification) | major | Fixed: the script clicks the new-session dialog button; passes on Haiku. |
| Bypass did not check that the inspector was present | minor | Fixed. |
| Each tool call left an empty temporary directory, and the sweep stopped at the first directory | minor | Fixed. |
| Observation leaks: blocked paths matched raw, full URLs and console text returned, field names put into a regex unescaped, cookies of the current URL only, missing query keys | minor | Fixed; blocked paths match decoded, lower-case prefixes. |
| An acting call acted on whatever origin the tab showed after the approval wait | minor | Fixed: origin checked again before the CDP call. |
| The agent-start cap could be exceeded by concurrent starts | minor | Fixed: starts in progress count. |
| Stop agent revoked grants of other tabs | minor | Fixed: per tab. |
| The container mounted the gh directory read-write; `-v` broke on paths with `:` | minor | Fixed. |
| A failed start left the `agide/pr-<n>` branch and the source directory | minor | Fixed. |
| Usage deltas could go negative; a subagent was priced with the session's model | minor | Fixed. |
| Hidden placement re-created evicted views; a failed debugger attach left a dead page session; timers not cleared | minor | Fixed. |
| Pending browser approvals and trust watches outlived their session or module | minor | Fixed. |
| App window DevTools available in packaged builds | minor | Fixed. |
| The profile allowlist (`github.com`) counted as consent to load signed-in GitHub; `browser_open_in_chrome` ran without asking | minor | Fixed. |
| Tests that passed without checking their behaviour (drag test, partition path, setup pane fake path) | minor | Fixed with checks through Electron and a module-level test. |
| PTY tests timed out under full-suite load | minor | Longer per-test timeouts; no flake in later runs. |
| 0029 stale on stubs, the recognizer and `setPermissionMode` | minor | Corrected. |

The quality step's first mutation run left survivors (`requireInScope` at the top level, a class missing from the profile table defaulting to allow, a Bash call without a readable command passing, shorter secrets replaced first, a blocked host matched by substring); each led to a test. As in milestones 1 and 2, the reviews found defects that the builders' green suites did not, most of them on trust boundaries: untrusted text presented as trusted, a grant wider than the question, a network path around the sandbox, and a hook that fails open in one provider.

Not fixed: the observation log pane stays a placeholder; not every new test from the fix step was run against the old code; srt's own mandatory deny list was not read (the fix step did not find srt on the host; the unit suite does run the srt tests against the srt of the probe prefix and the container tests against Docker on this host, and no real-srt test covers the `denyWrite` entries); a `session.closed` emit in the module-graph test leaves an MCP client call hanging, so that test uses `session.exited`.

### Tests and coverage

| Suite | Result |
|---|---|
| `pnpm typecheck` | passes at the end of the fix step, for this record and in the cross-review. |
| `pnpm test` / `pnpm coverage` | 131 files, 1413 tests pass, thresholds met (fix step; same result for this record and in the cross-review, where the srt and container suites ran against the real srt and Docker). The quality step had 1356 tests; the verification from a clean copy had 1356 as well. |
| `pnpm e2e` | 55 tests pass with hidden windows (fix step; again in the cross-review). The verification ran the suite of 54 tests from a clean copy in repeated runs with no flake, before the fix step added the native-view test. |
| `pnpm mutation` | 52 mutations, all killed (quality step). The cross-review ran it after the fixes: 50 killed, 2 skipped and exit code 1, because the fix step had changed the source lines of the fragment redaction and of the blocked path comparison. With those entries corrected and one added for the normalised path comparison, 53 mutations are all killed. |
| `pnpm parity`, `pnpm blocks-docs` | ok; the verification regenerated both and found them current, and the cross-review regenerated both with unchanged checksums. |
| `pnpm coverage:e2e` | 54 tests pass (quality step); 55 pass in the cross-review after the fixes. |
| Real-Claude scripts | Verification: `smoke-real-claude.mjs` (0.0039 USD), `e2e-claude-mcp.mjs` (0.0042 USD), `e2e-real-claude-inbox.mjs` (0.0047 USD) and `e2e-real-claude-m3.mjs` pass; `e2e-real-claude.mjs` failed and passes after the fix. `real-claude-gate.mjs` passed in the w-permissions step (under 0.02 USD). The m3 script reports no cost (no `cost-state` row). The cross-review ran the gate and m3 scripts after the fixes: the gate script passes with the same outcomes (0.0040 USD per run), and the m3 script passes in 19 s with the same tool calls, the refused push, nothing at the origin and the approval item "Approve: git.push to origin HEAD". Not re-run after the fixes: the smoke, MCP and inbox scripts. |

CLI version: the CLI updated itself during the run. The link `~/.local/bin/claude` moved from 2.1.326 to 2.1.327 at 23:52 UTC, between the integration and the verification (found by the cross-review from the time stamp of the link; `claude --version` now prints 2.1.327). The probes P20 to P24, I1 and PB1, the gate script of the w-permissions step and the integration real-Claude run used 2.1.326. The real-Claude scripts of the verification, the fix step and the cross-review ran on 2.1.327. No probe was repeated on 2.1.327; the gate and m3 scripts show that the `Bash(git push *)` ask rule in auto mode, the inspector's ask for `git -C . push` and the `agide-browser` tool calls behave the same there.

Unit coverage after the fix step (`pnpm coverage` in the cross-review, 1413 tests, with srt and Docker present; computed per area from `coverage/coverage-summary.json`). The quality step's figures before the fixes are in `docs/measurements/w-quality.md`. The run made for this record gave the same figures within 0.1 outside `src/core/isolation`, except the branch figures of `src/main` (64.7) and `src/main/modules` (66.1), which move between runs with the timing of the PTY tests.

| Area | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `src/core` | 92.9 | 83.3 | 94.2 | 95.8 |
| `src/core/browser` | 89.1 | 78.6 | 90.0 | 91.3 |
| `src/core/permissions` | 92.3 | 88.7 | 95.5 | 95.8 |
| `src/core/tasks` | 96.8 | 85.1 | 96.5 | 97.0 |
| `src/core/agents` | 92.7 | 82.0 | 94.8 | 95.9 |
| `src/core/usage` | 95.0 | 80.8 | 91.6 | 96.5 |
| `src/core/isolation` | 96.0 | 82.7 | 97.0 | 99.1 |
| `src/main` | 78.5 | 65.0 | 77.0 | 82.3 |
| `src/main/browser` | 92.4 | 87.6 | 85.1 | 98.1 |
| `src/main/modules` | 82.1 | 66.5 | 81.2 | 85.3 |
| `src/shared` | 100 | - | 100 | 100 |
| renderer logic files (the threshold list) | 95.6 | 90.2 | 92.3 | 96.7 |
| all `src/renderer` files | 59.9 | 59.3 | 57.7 | 60.4 |
| all files | 86.1 | 77.7 | 84.5 | 88.7 |

Coverage without the runtimes: the continuous integration runner (`macos-latest`) has no srt and no Docker, so the srt and container tests are skipped there. The cross-review ran `pnpm coverage` with Docker off the `PATH` and `AGIDE_SRT_BIN` pointing at a missing file: 1382 tests pass, 31 are skipped, and the run failed the `src/core` functions threshold (93.7 against 94). The cause was that `src/core/isolation/ptyHarness.ts` and `testRuntimes.ts`, helpers that only those tests use, were measured as source. They are now excluded like the other test helpers; the same run then passes with `src/core` at 92.7 / 83.2 / 94.2 / 95.6, and `src/core/isolation` at 92.6 / 77.9 / 96.0 / 96.2. The margin on the `src/core` functions threshold is 0.2 with and without the runtimes. `pnpm e2e` with Docker off the `PATH` passes (55 tests; the host's `gh` and `claude` stayed reachable, which the runner lacks). No run on the real runner checked this.

Thresholds now: `src/core` 92 / 82 / 94 / 95, `src/main` 77 / 62 / 76 / 81, `src/main/modules` 81 / 63 / 79 / 85, `src/shared` 98, renderer logic files 95 / 89 / 91 / 96 (statements / branches / functions / lines). Before the quality step the thresholds of milestone 2 already failed on `src/core` and `src/main`, because `ElectronViews`, the agents module and the browser module had little or no unit coverage.

End-to-end coverage (quality step, `pnpm coverage:e2e`, 54 tests; functions / branches / lines): renderer `src/renderer` 77.6 / 69.8 / 83.8, renderer `src/shared` 83.3 / - / 97.1, main `src/core` 73.8 / 47.3 / 73.0, main `src/main` 70.3 / 59.3 / 81.1. After the fixes (cross-review, 55 tests): renderer `src/renderer` 78.6 / 69.9 / 84.4, renderer `src/shared` 83.3 / - / 97.1, main `src/core` 74.0 / 47.0 / 72.8, main `src/main` 69.9 / 60.2 / 80.4.

Gaps: `src/main/index.ts` and `desktop.ts` are reached only by e2e; `BrowserPane`, `TreePane`, `LayoutHost`, `SessionPeek`, `ProfileRail`, `NewSessionDialog` and `ContextMenu` have no component test; `ElectronViews.page()` dialog events and the cookie callback run only in e2e. During the builder steps, full runs failed now and then in `PtySessionService`, `appModules` and `tasks` tests while other agents edited the tree; the quality step traced one cause to a race in the trust-dialog fixture and fixed it, and the fix step gave the PTY tests longer timeouts.

### Measured effort

Wall times as recorded with `date -u` by each agent in `docs/measurements/`. Token spend is not recorded by the agents; the column stays empty until the totals of the workflow notification are added. User hours are not measured.

| Step | Measurement file | Start (UTC) | End (UTC) | Wall time | Tokens |
|---|---|---|---|---|---|
| Survey: browser tool mapping | `d-browser-survey.md` | 20:27:06 | 20:29:59 | about 3 min | to be added |
| Isolation probes I1 to I3 | `p-iso.md` | 20:27 | 20:56 | about 29 min | to be added |
| Permission probes P20 to P24 | `p-perm.md` | 20:27:04 | 21:08 | about 41 min | to be added |
| Design 0027 agent nodes and usage | `d-agents.md` | 20:27:06 | 20:33:46 | about 7 min | to be added |
| Design 0026 browser and observation, probe PB1 | `d-browser-design.md` | 20:30:21 | 20:37:21 | about 7 min | to be added |
| Review of 0027 | `review-agents-usage-design.md` | 20:34 | 20:44 | about 10 min | to be added |
| Review of 0026 | `review-browser-design.md` | 20:38:14 | 20:47:30 | about 9 min | to be added |
| Review of I1 to I3 | `review-iso-probes.md` | 20:54 | 21:03 | about 9 min | to be added |
| Review of P20 to P24 | `review-perm-probes.md` | 21:08 | 21:23 | about 15 min | to be added |
| Design 0028 permission model and task start | `d-perm-tasks.md` | 21:22:56 | 21:31 | about 8 min | to be added |
| Review of 0028 | `review-perm-tasks-design.md` | 21:31 | 21:41 | about 10 min | to be added |
| Contracts and stubs (0029) | `contracts.md` (milestone 3 section) | 21:41:23 | 22:09:49 | about 28 min | to be added |
| Browser and observation, R12, R13, R15 | `w-browser.md` | 22:11:14 | 23:23:00 | about 72 min | to be added |
| Agent nodes and usage, R16, R24 | `w-agents.md` | 22:11:16 | 22:58:17 | about 47 min | to be added |
| Permission model and gate, R17 | `w-permissions.md` | 22:11 | 22:51 | about 40 min | to be added |
| Task start, S2 | `w-tasks.md` | 22:11 | 22:48 | about 37 min | to be added |
| Isolation providers, R23 | `w-iso.md` | 22:11 | 22:48 | about 37 min | to be added |
| Integration | `integrate.md` (milestone 3 section) | 23:23:53 | 23:43:15 | about 19 min | to be added |
| Test quality | `w-quality.md` (milestone 3 section) | 23:43:57 | 00:11:56 | about 28 min | to be added |
| Review: core modules | `review-m3-core.md` | 00:12 | 00:26 | about 14 min | to be added |
| Review: main, renderer, e2e | `review-m3-main-renderer.md` | 00:12:31 | 00:22:30 | about 10 min | to be added |
| Verification from a clean copy | none (the step was told not to change docs; times from its report) | 00:12 | 00:20 | about 8 min | to be added |
| Fixes | `fix-m3-review.md` | 00:27 | 01:07 | about 40 min | to be added |
| This record | `record.md` (milestone 3 section) | 01:07:20 | 01:16:30 | about 9 min | to be added |
| Cross-review of the records | `cross-review.md` (milestone 3 section) | 01:17:07 | 01:36 | about 19 min | to be added |

Milestone 3 from the first survey to the end of the fixes took about 280 minutes elapsed (20:27 to 01:07). The sum of agent wall times over the same steps is about 528 minutes: about 148 for surveys, probes, designs and their reviews, and about 380 for contracts, builders, integration, quality, code reviews, verification and fixes. The build steps ran about 206 minutes elapsed (21:41 to 01:07).

What took long, from the measurement files: the srt settings the docs do not name (`allowPty`, `allowLocalBinding`) and the OpenShell gateway start (probes); the folder-trust lookup, which the probes read from the CLI binary, and the model's own retry with a per-command host list (permission probes); separating scripted evidence from manual steps (probe reviews); placing every setting where related state already lives, and which mechanism guarantees each action class (design 0028); a launch seam every module can add to without editing the session code (contracts); the parking window, which kept the app from quitting, and `setVisible(false)` stopping frames (browser); the renderer parts and the e2e setup with collapsed folders (agents); a fake claude that counts a bracketed paste as one prompt (integration); Playwright and Node coverage formats and the fixture race (quality); full test runs while other agents edited and restored files in the same tree (every builder and both reviews).

### Re-estimate

Judged share of the estimates built in milestone 3, in 0005 units (working days for one engineer plus agents, greenfield column). The shares are a judgement by this step from the slice reports; no measurement gives them.

| Requirement | Estimate | Built in milestone 3 | Judged share |
|---|---|---|---|
| R12 surfaces | 8 days (0005) | `browser-tab` surface with views, partitions, guards; `slack-thread` type only | about 3 days |
| R13 shared awareness | 9 days (0005) | switch, indicator, access log, redaction, capture mask, digest; no Slack content, no log pane | about 3 days |
| R15 Claude in Chrome tools | 9 days (0005) | the `agide-browser` tools of the first slice with the site table; no upload, GIF or resize | about 4 days |
| R16 visible swarms | 7 days (0009) | normaliser, store, tree rows, timers, history, viewer; no stream-json path | about 4 days |
| R24 usage visibility | 5 to 8 days (0019) | collector, rates, ranking, heat, plan usage and forecast, alerts; own profile only | about 3 days |
| R17 collaboration tooling, gate part | 17 days (0005); gate about 3 to 4 (0010, 0028) | modes, settings, class table, rules, inspector, inbox items; no Q probes, no header | about 3 days |
| R6 task start (S2) | 6 of 10 days left after milestone 1 (0014); about 4 (0028) | prompt, pull request and Jira starts, worktrees, trust handling; no removal dialog, no Slack or Notion | about 3 days |
| R23 isolation | 13 to 22 days (0018) minus about 3 built (0024) | srt and container providers with provider choice; no real claude in a container | about 3 days |
| Total | | | about 26 days |

| Basis | Agent minutes | Minutes per estimated day |
|---|---|---|
| Build steps (contracts to fixes), summed | about 380 | about 14.6 |
| Build steps, elapsed (21:41 to 01:07) | about 206 | about 7.9 |
| All steps including surveys, probes and designs, summed | about 528 | about 20.3 |
| Milestone 2 for comparison (0024: about 16 days built), summed build / all | about 344 / 440 | about 21.5 / 27.5 |
| Milestone 1 for comparison (0014: about 14 days built), summed | about 132 | about 9.4 |

Both sides of each rate carry a judgement. With 22 judged days instead of 26 the build rate is about 17 minutes per day, with 30 about 13. Within that range milestone 3 took less agent time per estimated day than milestone 2 and more than milestone 1. Reasons visible in the reports: the contract seams of 0029 kept the builders out of each other's files, so integration took no longer than in milestone 2 with more slices; the designs were reviewed before the build and the probes had settled the CLI behaviour the gate relies on. The review and fix steps stayed large: the fix step took 40 minutes, as long as a builder step (37 to 72 minutes), against 32 minutes in milestone 2.

Remaining work in 0005 units: about 184 to 214 estimated days after milestone 2 (0024) minus about 26 days built, about 158 to 188 days.

| Rate | Summed agent time | Elapsed with the same parallelism |
|---|---|---|
| Milestone 3 build rate | about 38 to 46 hours | about 21 to 25 hours |
| Milestone 3 rate with designs and probes | about 53 to 64 hours | not derived |
| Milestone 2 build rate | about 57 to 67 hours | not derived |

The hours are the remaining days times the unrounded rates above, as 0014 and 0024 computed them. The projection is an extrapolation, not a plan. It leaves out the cross-review steps and every hour of the user. The points of 0014 and 0024 still hold: later slices need verification outside tests (a visible window, real srt and containers, connector writes, Slack, swarms), user time for decisions becomes the limit, and review cost grows with the attack surface. Milestone 3 adds this point: each provider multiplies the places where a security rule can fail open (the inspector in the container, the browser outside the srt allowlist), so the review of every later slice needs a pass per provider.

0007 reopens if the greenfield total reaches 192 days on R1 to R19. Nothing in milestone 3 suggests that the 0005 rows for R12, R13, R15, R16 and R17 are too low. R20 to R24 stay outside that comparison (0024, 0025).

### What remains open

| Item | Where |
|---|---|
| Probes Q1 to Q7 (0028), U1 to U7 (0027), P16 (MCP call wait), P17; the effect of `--no-chrome` on the tool list. The probe results hold for 2.1.326 and the host now runs 2.1.327; none was repeated there | probes |
| No `-p` stream-json launch path: app-started agents, the cap of 4 for them, `rate_limit_event` as their plan source | agents; 0014 |
| The session header and the mode reported by payloads; refusing an ask-rule dialog with Escape leaves the session `waiting` and the approval item open | permissions; `http` hook transport |
| Hook approvals answered only in the TUI; `inbox_ask`; elicitation forms | inbox; `http` hook transport |
| `--chrome` profile setting; the observation log pane; page shortcuts and zoom; a leaf in two panes; Slack and Notion URL formats; sign-in pop-ups, downloads, dialogs, crashes and eviction untested | browser |
| `javascript_tool` on loopback pages runs without asking, and outside srt page script can reach any host | browser; user |
| Worktree removal dialog; Cmd+Shift+N; directory picker; "Sign in to gh"; Slack and Notion sources; real `gh` and Jira starts; a real-Claude task start script | tasks |
| `LocalProvider` reports `network: 'none'` with the Bash sandbox on | permissions, isolation |
| Real claude under srt through the app; real claude and login in a container (Linux build, image size above the pull limit); srt's own deny list; `.claude.json` writable under srt; Keychain readable from srt; loopback open under `allowLocalBinding`; container without a network policy | isolation |
| `cost-state` at exit for sessions the app ends; price table values; a user-level `statusLine`; plan usage of other profiles | usage |
| No on-screen check of any milestone 3 UI: settings panel, new-session and new-task dialogs, browser views and their stacking, agent rows, usage panes; no packaged-app run (the `inspect.js` path differs there) | visible-window run |
| 0020, 0021, 0022, 0026, 0027 and 0028 have status `proposed`; the build followed them | user |
| Continuous integration passed on the milestone 3 commits on the macOS runner, which has neither srt nor Docker. The unit coverage there passes by a margin of 0.2 on the `src/core` functions threshold, so a small drop in coverage can fail the job | user |
| Token spend per step and user hours | measurements |
| Host changes kept from the isolation probes: srt 0.0.83 under `/tmp/agide-srt.*` (about 19 MB, used by the srt tests through `/tmp/agide-srt-prefix.txt`, lost at reboot); the srt packages and a project link in the user's pnpm store (`~/Library/pnpm/store/v11`). The store's `projects` directory also holds links to verification copies under `/tmp` that are removed | user |
| Claude project directories whose names contain `agide-i1` in the Claude configuration directory, and folder-trust entries for those directories and for removed `p24-` directories in the login's `.claude.json`; the integration script uses the fixed `agide-smoke-cwd` to add no new entry. The gate script leaves a Claude project directory per run, named after its removed `agide-gate-` temporary directory (runs of w-permissions and of the cross-review), with no trust entry | user (removal was denied to the agents) |
| Leftovers in the OS temporary directory that the agents could not remove or did not create: `/tmp/agide-review-m3` (OpenShell source, about 57 MB), `/tmp/rev0027`, `agide-orphan`, the contracts and layout e2e logs, review backup and mutation files, empty `playwright-artifacts-*` directories; possibly test directories from failed vitest runs of the tasks builder (not confirmed). Found by the cross-review in the per-user temporary directory: `agide-i1run.*` (working directories of I1, a few KB), `agide-checks-*` (data directories of `browser-checks.mjs`), `agide-app-*` and, from milestone 2, `agide-dbg-*`, about 25 MB together; and `/tmp/verify-app.b3ZC4d`, a copy of the app with `node_modules` from the milestone 1 verification (about 965 MB), with `/tmp/verify-dir.txt`. The cross-review's logs are in `/tmp/agide-xreview` (under 1 MB; their removal was denied) | user |
| Removed by the probes: OpenShell binaries, state, images, sandboxes and containers; the test Keychain item | none |

## Consequences

### Recommendations for milestone 4

Keep the milestone 3 process: surveys and probes, designs with an independent review, contracts with seams that give each builder its own files, parallel builders, integration, a test-quality pass with the mutation script, code reviews that run probes and mutations, then fixes. Add a review pass per isolation provider for every security rule, and run `pnpm dev` with a visible window once, with the user present if the user wants.

1. `http` hook transport and approvals from the inbox card (0022, 0024). Hooks post to the app instead of writing files the agent can write. This gives a mode source the agent cannot forge (the session header and `setPermissionMode`), approval and denial of hook requests from the inbox card (P14: the first answer wins), elicitation forms (P15, P17), `inbox_ask` with P16, a signal that clears the waiting state after a refusal in the TUI, and an inspector that runs in the container and in OpenShell. Run Q1 (`onFailure: block`) with it.
2. Review slice (0010). The first slice of the ladder: changeset capture at turn end, rung A checks and a rung B reviewer through `report_review`, review items in the inbox, the project policy file read from the base commit. It builds on the gate classes and the inspector records of milestone 3.
3. OpenShell provider (0018, 0022, I3) for API-key profiles: the gateway as a managed process with authentication (not the plaintext, unauthenticated loopback setup of the probe), per-binary network policy for `claude`, events and the status line over HTTP (no host mount), and a real claude with an API key in a test profile. Decide first whether an image above the 100 MB pull limit may be pulled; the same decision unblocks a real claude in the container provider.
4. Slack surface (R12, R13, R17). A `slack-thread` surface that shows the conversation through the connector (reads only, with the 0021 untrusted-text rules), observation of thread ids and visible messages, Slack task sources, and Q7 for the Slack connector's ask rules. Check the Slack URL formats against real URLs with the user.
5. The `-p` stream-json launch path with app-started agents under the cap (0011, 0027), so the stream adapter and `rate_limit_event` run against the real CLI, and the probes U1 to U7.
6. Remaining items of milestone 3: the worktree removal dialog, the observation log pane, the `--chrome` setting, `LocalProvider` network capability with the sandbox on, real-Claude scripts under srt and for task start, a real `gh` and Jira start, and the open probes Q2 to Q6.
7. Record user hours and tokens per step next to wall time.

### Questions for the user

- 0026, 0027 and 0028 are `proposed`, as are 0020 to 0022. Do you confirm them, with the amendments listed above?
- The default network allowlist (GitHub hosts and the npm, PyPI and Maven Central registries): approve, or change?
- Should the default profile's Bash sandbox be on? Its git remotes may use SSH, which then fails for agents (GitHub remotes are rewritten to HTTPS).
- May the app answer Claude's folder-trust question for folders it creates (the setting is off by default)? Each answer adds an entry to the login's `.claude.json`.
- Unknown tools on your own MCP servers, including claude-in-chrome, default to draft (ask). Is that number of prompts acceptable?
- Browser: Jira, GitHub and Notion ask on every action. Keep that, or allow for the session after the first approval? Should `javascript_tool` on loopback pages ask?
- srt opens every loopback port to the agent (`allowLocalBinding`) and leaves the Keychain readable. Acceptable for an isolating provider?
- I1 ran the real claude under srt with your subscription login. Does srt count as a "test environment" under the 0025 rule "no subscription login inside a test environment"?
- May a run pull an image above 100 MB (a Linux `claude` for the container provider and OpenShell)?
- Does the claude.ai login belong to an organization with managed settings or connector controls? A mod you install can approve tool calls past ask rules and hooks when none exist (0028).
- Plan usage of other profiles in the rail (0019, 0025)?
- The cost and threshold defaults of 0027 (alert at 0.50 USD per minute, plan thresholds 80 and 95 percent, transcript copies up to 200 MB): confirm or change?
- 0019 and 0025 name you by first name in "Decided by". Keep that in the public repository, or replace it with "the user"?
- The leftovers above (Claude project directories, trust entries, temporary directories, the srt prefix and its pnpm store entries) need your removal. Which should go?
- Milestone 4 order: the list above starts with the `http` hook transport because several open items wait on it. Should the review slice or the Slack surface come first?
- Do you want to try the app with a visible window (`pnpm dev`) before milestone 4, including the settings panel, a browser tab and a task start?
