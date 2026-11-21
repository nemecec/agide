# 0037 Swarm orchestration: design

Status: proposed
Date: 2026-11-21
Decided by: spike agents, pending user confirmation
Inputs: 0003, 0004 (amended by 0014 and 0024), 0008 (R18), 0009, 0010, 0011, 0012, 0013, 0021, 0022, 0023, 0025, 0027, 0028, 0029, 0035, 0036; `notes/probes-m4-swarm.md` (P30 to P37, reviewed), `notes/swarm-orchestration.md`, `notes/swarm-visibility.md`, `probes/RESULTS.md`, `probes/out/p30_stream_agent.jsonl`; the code in `app/src/core/agents` (`AgentsController.ts`, `normalise/streamAdapter.ts`, `settings.ts`, `agentMigrations.ts`), `app/src/core/session` (`types.ts`, `launchArgs.ts`), `app/src/core/isolation` (`types.ts`, the providers), `app/src/core/tasks/GitWorkingDirectoryManager.ts`, `app/src/core/permissions/modes.ts`, `app/src/core/mcp/grants.ts`, `app/src/core/commands/parity.ts`, `app/src/core/inbox/inboxCommands.ts`, `app/src/main/modules/agents.ts`
Refines: 0011 sections 2 to 4 (R18)
Amends: 0027 section 5 and section 11 (the cap row), 0021 section 3 (stream-json approvals and swarm alerts), 0022 (`AgentEnvironment` gains a process command)

## Context

R18 (0008) asks that the user, or an agent through the app's MCP server, can start a group of agents for a goal, each with a model and effort tier, a budget, steering and stopping per agent and per group, and isolated workspaces. 0011 chose one `claude -p` stream-json process per agent, sketched a swarm definition, MCP tools and a tier table, and left the runtime unprobed. 0012 and 0025 fix the frame: swarms run on the user's subscription login, a configurable cap of 4 concurrent app-started agents applies, the permission mode is selectable with auto as default, bypass only inside an isolating provider.

The milestone 4 probes P30 to P37 (`notes/probes-m4-swarm.md`, Claude Code 2.1.330, reviewed) settle the runtime:

| Fact | Probe |
|---|---|
| One process takes several user messages over stdin as NDJSON and keeps one session id; each turn ends with its own `result` and re-emits `system/init`. Nothing is emitted before the first user message | P30, P33 |
| `--permission-mode manual --permission-prompt-tool stdio` turns approvals into `can_use_tool` control requests with `request_id`, `tool_name`, `display_name`, `input`, `description`, `permission_suggestions`, `tool_use_id`. Allow with `updatedInput` runs the call (a changed input runs as changed, and the agent is not told); deny with a message makes an error tool result and a `permission_denials` entry | P30 |
| An unanswered request stays pending; after 60 s the process was alive and a late allow completed the turn. The SDK docs say a request can stay pending indefinitely | P30 |
| The `interrupt` control request ends the turn in about 20 ms with `error_during_execution` (`aborted_streaming` or `aborted_tools`), cancels a pending `can_use_tool` with `control_cancel_request`, and keeps the process ready for the next message. SIGINT ends the turn and the process; SIGTERM leaves the turn without a result and exits 143 | P31, P37 docs |
| Control requests `set_permission_mode`, `set_model`, `get_workspace_diff`, `get_session_cost`, `stop_task`, `end_session`, `mcp_status`, `initialize` and others answer; `set_model` with an unknown id answers `Model '<id>' not found` | P32 |
| `--resume <id>` after SIGKILL continues the context in the same file; `--session-id` of an existing session fails at start; two live processes can hold one session; the first `result` of a resumed process counts cost from zero (`p33_*_resume.jsonl` report less than the run before) | P33 |
| Three parallel haiku agents ran without retries; `result.total_cost_usd` and `modelUsage` are cumulative per process; `rate_limit_event` carries `status` and the five-hour and seven-day windows | P34 |
| `--max-turns` counts model turns per user message; `--max-budget-usd` is cumulative per process, checked after a response (the crossing response still streams), and the process stays alive answering every later message with `error_max_budget_usd` | P35 |
| An agent in a git worktree edits only that worktree; `git add -N .` then `git diff HEAD` (or `get_workspace_diff`) shows new files; `git worktree remove` refuses with changes, `--force` loses them | P36 |
| `--bare` ignores the OAuth login, so the subscription excludes it; without `--permission-mode` the user's `defaultMode` applies | P37 |
| Stream `assistant` messages carry `message.usage` per message id, like transcript lines | `probes/out/p30_stream_agent.jsonl` |
| The `initialize` answer lists the aliases `fable`, `opus`, `sonnet` and `haiku` on this login; `--permission-mode` accepts `manual`, not `default`; `--effort` accepts `low` to `max` | `probes/out/p32_control_requests.jsonl`, `claude --help` (2.1.330) |
| Auto requested where auto is unavailable starts the session in manual mode | permission-modes docs |

The code already has the stream-json adapter (`StreamNormaliser`), the agent store with app-started rows (`agent_key` `session`, `swarm_id`, `parent_session_id`), the cap check `beginAppStarted` that refuses at `agents.maxConcurrentAppStarted` and posts a `swarm:cap` alert (not yet called by any launcher; `TaskStartService` counts agent-started tasks against its own `AGENT_START_CAP`), the mode order `plan`, `default`, `acceptEdits`, `auto`, `bypassPermissions` (`permissions/modes.ts`), the worktree manager of task start, the per-session MCP grants with a folder scope, the parity check with `mcpExempt`, and the launch contributors (ask rules, the `PreToolUse` inspector, sandbox settings) of 0028. No process manager for stream-json exists, and `AgentEnvironment` offers only `ptyCommand`, whose container form passes `-it`.

## Decision

### 1. The swarm definition

A swarm is a JSON document validated by one zod schema (`core/swarm/definition.ts`). The user writes it in the start dialog (section 10) or an agent passes it to `swarm_start`. The app stores the validated copy with the swarm.

```ts
const tier = z.enum(['strong', 'mid', 'small']);
const mode = z.enum(['plan', 'default', 'acceptEdits', 'auto']);   // bypass only through the dialog, section 7
const name = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

const agentSpec = z.object({
  name,
  role: z.enum(['worker', 'reviewer', 'mechanical']).default('worker'),
  prompt: z.string().min(1).max(20_000),
  tier: tier.optional(),                               // default from the role, section 5
  effort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(), // overrides the tier's effort, never above the swarm's maxTier
  stage: z.number().int().min(0).max(9).default(0),
  dependsOn: z.array(name).max(16).default([]),
  workspace: z.enum(['worktree', 'readonly', 'scratch']).default('worktree'),
  owns: z.array(z.string().min(1).max(200)).max(32).default([]),  // globs relative to the repository root
  tools: z.object({
    available: z.array(z.string().max(64)).max(64).optional(),   // becomes --tools; absent keeps the CLI default set
    deny: z.array(z.string().max(200)).max(64).default([]),      // becomes permissions.deny entries
  }).strict().default({ deny: [] }),                   // zod 4 returns a default without parsing it
  permissionMode: mode.optional(),                     // capped, section 7
  connectors: z.boolean().default(false),              // false adds --strict-mcp-config
  mayStartSwarms: z.boolean().default(false),          // section 9
  budget: z.object({
    usd: z.number().positive().max(100).optional(),
    maxTurnsPerMessage: z.number().int().min(1).max(200).optional(),
  }).strict().default({}),
}).strict();

export const swarmDefinition = z.object({
  version: z.literal(1),
  goal: z.string().min(1).max(2_000),
  repository: z.object({ path: z.string().min(1), base: z.string().min(1).max(200).optional() }).strict().optional(),
  permissionMode: mode.default('auto'),
  maxTier: tier.default('strong'),
  failurePolicy: z.enum(['continue', 'stop-dependents', 'stop-swarm']).default('stop-dependents'),
  budget: z.object({
    usdTotal: z.number().positive().max(500),
    usdPerAgent: z.number().positive().max(100).optional(),     // default: min(usdTotal, 1.00)
    maxTurnsPerMessage: z.number().int().min(1).max(200).default(40),
    wallClockMinutes: z.number().int().min(1).max(1_440).default(60),
    reviewShare: z.number().min(0).max(0.8).default(0),         // reserved for reviewer agents
  }).strict(),
  agents: z.array(agentSpec).min(1).max(16),
}).strict();
```

Validation beyond the schema, before anything starts:

- Names are unique; `dependsOn` names exist; the graph of `dependsOn` plus the stage order (every agent depends on every agent of a lower stage) has no cycle.
- A `worktree` or `readonly` agent needs `repository`. The repository must be one the user already used in a task start or a swarm of this profile when the caller is an agent (0028 section 13). `base` is resolved once to a commit id with `rev-parse --verify --end-of-options`; a value starting with `-` is refused.
- Two `worktree` agents that can run at the same time (neither depends on the other) must have disjoint `owns` sets, checked by matching each glob against the other's literal prefix and against the tracked files of the base commit. Overlap is refused with the pair named. Empty `owns` means "no claim" and is allowed only for one concurrently runnable `worktree` agent.
- The sum of per-agent budgets that can run at the same time is not checked against the total; the reservation in section 6 handles it.
- Tool names in `tools` are matched against the CLI's tool list from the first `initialize` answer; an unknown name is a warning, not a refusal, since tool lists change between releases.

A definition grants nothing by itself: there is no allow list, `permissionMode` is capped (section 7), and an agent-written definition passes the approval of section 9.

Example:

```json
{
  "version": 1,
  "goal": "Add input validation to the signup form, with tests, and review it",
  "repository": { "path": "~/src/shop", "base": "main" },
  "budget": { "usdTotal": 3, "reviewShare": 0.3 },
  "agents": [
    { "name": "impl", "prompt": "Add validation for email and password in src/signup. Commit when done.", "tier": "mid", "owns": ["src/signup/**"] },
    { "name": "tests", "role": "mechanical", "prompt": "Write tests for the validation rules in test/signup.", "owns": ["test/signup/**"] },
    { "name": "review", "role": "reviewer", "stage": 1, "workspace": "readonly", "prompt": "Review the changes of impl and tests. Report findings; do not edit." }
  ]
}
```

### 2. Agent runtime on stream-json

#### 2.1 Launch

Each agent is a session row (`sessions.launch_path = 'stream-json'`) with its own app-chosen session id, MCP grant and events directory, so the tree, the hook inbox, the gate and the agent store treat it like any session. A new `StreamSessionService` in `core/session` sits beside `PtySessionService`; `SessionService.create` dispatches on `launchPath`. Both share `SessionStore`, `GrantStore`, `HookInbox` and the launch contributors.

The process goes through the isolation provider. `AgentEnvironment` gains:

```ts
/** The host command for a process without a terminal (stream-json). Secrets never appear in `args`. */
processCommand(launch: ProcessLaunch): Promise<PtyCommand>;
interface ProcessLaunch { readonly sessionId: SessionId; readonly cwd: string; readonly args: readonly string[]; readonly env?: Readonly<Record<string, string>> }
```

`local` and `srt` return what `ptyCommand` returns; `container` passes `-i` without `-t`. A provider that cannot run without a terminal throws `IsolationError('unsupported')`, and a swarm agent on it is refused at validation. The app spawns the command with `child_process.spawn`, stdio pipes, and calls `attach` with the pid so `terminate` works as for PTY sessions.

Arguments, built by `buildStreamLaunchArgs` from `buildLaunchArgs` (so the hooks, ask rules, inspector, deny rules and sandbox settings of 0028 come with every agent):

```
-p --input-format stream-json --output-format stream-json --verbose
--session-id <uuid> | --resume <uuid>
--permission-mode <effective mode, section 7>          # always passed (P37); `default` goes out as `manual` (cliPermissionMode)
--permission-prompt-tool stdio
--model <tier model> --effort <tier effort>
--max-budget-usd <reserved amount, section 6> --max-turns <maxTurnsPerMessage>
--setting-sources user --settings <app settings JSON> --mcp-config <session mcp.json>
[--strict-mcp-config]                                  # unless connectors: true
[--tools <available>]
--add-dir <the agent's inputs directory>               # section 4
```

`--bare` is never passed (P37). `--include-partial-messages` is not passed: the node shows the last tool and the result, and the transcript viewer of 0027 reads the transcript. The environment is the profile's launch environment with the 0013 scrub of inherited `CLAUDE_CODE*` variables, keeping `CLAUDE_CONFIG_DIR`. `CLAUDE_CODE_SUBAGENT_MODEL` is set to the agent's model with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, so native subagents of a swarm agent do not move to a larger model (env-vars docs, 2.1.257 or later; not probed, checked in the slice).

At start-up the app writes the first user message at once, without waiting for an event (P33: nothing comes before it). Every `system/init` is checked, and there is one per turn (P30): a `permissionMode` stricter than the requested one (auto unavailable starts the session in manual, permission-modes docs) is kept with a warning on the swarm card, since it only adds approvals; a looser one ends the agent at once with reason `mode-mismatch`. The app also records the init's `apiKeySource`, so a future CLI that turns `-p` bare shows up as a login failure with a clear message (P37).

#### 2.2 NDJSON channel

`StreamChannel` (one per process) owns stdin and stdout:

| Direction | Message |
|---|---|
| to the CLI | user message `{ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }` |
| to the CLI | control request `{ type: 'control_request', request_id, request: { subtype, ... } }`, answered by a `control_response` with the same `request_id`; a 20 s timeout per request |
| to the CLI | control response for `can_use_tool`: `{ type: 'control_response', response: { subtype: 'success', request_id, response: { behavior: 'allow', updatedInput } } }` or `{ behavior: 'deny', message }` |
| from the CLI | one JSON value per line; lines over 4 MiB are dropped with a debug record; a parse error is logged and skipped |

Every parsed stdout message goes to `AgentsController.streamMessage` (the existing `StreamNormaliser`, which yields the `started`, `waiting`, `answered`, `ended`, `session-cost` and `plan` facts of 0027) and to the swarm manager, which reads `result`, `control_request` (`can_use_tool`), `control_cancel_request`, `assistant` usage and `rate_limit_event`. Every control response the app sends for `can_use_tool` goes through `AgentsController.streamResponse` (which calls the normaliser's `controlResponse`), so a deny shows as outcome `denied`.

Messages sent while a turn runs are queued by the app and written after the turn's `result`, so each message starts its own turn and the turn count of `--max-turns` stays per message (P35). A steering message marked `now` (section 8) is written at once after an interrupt.

#### 2.3 Interrupt, resume, stop

| Operation | Mechanism | Agent state after |
|---|---|---|
| Interrupt one agent | `interrupt` control request; the turn's `result` (`error_during_execution`, `aborted_*`) is not a failure; a pending `can_use_tool` is cancelled by the CLI | `interrupted`, process alive for `swarm.interruptedKeepSeconds` (default 300), then stdin closed and the process ends |
| Continue an interrupted or finished agent | a user message on stdin when the process is alive; otherwise a new process with `--resume <session id>` and the message as its first input | `running` |
| Stop one agent | `interrupt`, wait for its `result` up to 2 s, close stdin, SIGTERM through `terminate` after 5 s, SIGKILL after the kill timeout | `stopped` |
| Agent finished | a `result` with `subtype: 'success'`, `is_error: false` and nothing queued: the app closes stdin, the process exits 0 | `done` |
| End of allowance | a `result` with `is_error` or a subtype other than `success` that the app did not cause (P35 host rule; P37 shows a login failure as `subtype: success` with `is_error: true`) | `failed`, process ended as in "Stop" |

One live process per session (P33): the manager holds a lock per session id and refuses a resume while a process for that id runs.

#### 2.4 App quit and restart

- Quit: the manager stops taking starts, sends `interrupt` to every running agent, waits up to 3 s for their `result` events, then closes stdin and ends the processes as in "Stop". Rows become `interrupted` with `interrupted_by = 'quit'`; queued rows stay `queued`; the swarm becomes `paused`. Pending approval items resolve `expired` with "Agide was closed". The agent rows of 0027 end `done` with outcome `stopped`, basis `reported`.
- Crash: stdout and stdin close with the app. Whether the CLI finishes the running turn before it exits when its stdin closes is not probed. On the next start, rows still `running` or `waiting` become `interrupted` with `interrupted_by = 'crash'`, their swarms become `paused`, and open `swarm:can_use_tool` approval items resolve `expired` with "Agide stopped unexpectedly", since no process can take the answer. When the recorded pid is alive and its command line holds the agent's session id, the app sends SIGTERM to it, so a resumed process never shares the session with an orphan (P33).
- Restart: nothing resumes by itself, since each resume costs money. A paused swarm shows a Banner on its node and pane: "Paused when Agide closed. Resume", and `swarm_send` without an agent resumes it (section 8). A resumed agent whose last turn ended inside a tool call gets this first message: "Agide was closed during your last turn. Check the state of your working directory before you continue." (P33: the agent cannot know the command's outcome). `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` is not used until probed.
- Wall clock: the swarm's clock pauses while the swarm is `paused`.

### 3. The manager

`SwarmManager` (`core/swarm/SwarmManager.ts`) owns the swarm and agent run states, the queue, the cap, the stages, the budget ledger and the failure policy. It is pure apart from the injected `StreamSessionService`, worktree manager, inbox and clock, so its rules run in unit tests with a fake clock and fake processes.

#### 3.1 States

Agent run states:

| State | Meaning | Holds a cap slot |
|---|---|---|
| `queued` | waiting for its dependencies, a free slot, a budget reservation, or an unpaused swarm | no |
| `running` | its process runs a turn or holds queued messages | yes |
| `waiting` | a `can_use_tool` request of this process is open (overrides `running`) | yes |
| `interrupted` | its turn was interrupted by the user, the caller, a pause or app quit; the process may still be alive (section 2.3) | while the process is alive |
| `done` | ended after a successful turn with nothing queued | no |
| `failed` | ended on an error result, a process exit without a result, a spawn error, a mode mismatch, a budget or turn limit, or a dependency failure under `stop-dependents` | no |
| `stopped` | ended by stop (user, caller, `stop-swarm` policy, the swarm budget, the wall clock) | no |

`failed` and `stopped` carry a reason: `error-result`, `exit`, `spawn`, `mode-mismatch`, `agent-budget`, `turns`, `dependency`, `user`, `caller`, `swarm-budget`, `wall-clock`, `policy`. The 0027 agent store keeps its states; the run state lives in `swarm_agents` and the tree shows it (section 10). Mapping into the agent store: `queued` has no agent row; `interrupted` with a live process is `running` (the `session` row stays `running` until the process exits); `interrupted` after its process ended is `done` with outcome `stopped`; the ended states map to `done` (outcome `completed` or `stopped`) and `failed`.

Swarm states: `running` (at least one agent not ended), `paused` (no starts and no messages; agents that were running are interrupted as in section 8, `swarm_interrupt` without an agent), `done` (every agent ended and none `failed`), `failed` (every agent ended, at least one `failed`), `stopped` (stopped by the user, the caller, the budget or the wall clock).

#### 3.2 Cap and queue

- The cap is `agents.maxConcurrentAppStarted` (default 4, range 1 to 16, 0012). It counts app-started processes that are alive across the whole profile: swarm agents of every swarm, agent-started tasks (0028) and nested swarms alike. `beginAppStarted` becomes the one place that counts. It counts agent rows with origin `app-started` in `running` or `waiting`, which already covers every live swarm agent process (section 3.1 mapping); counting `swarm_agents` as well would count each process twice. Today `TaskStartService` keeps its own count against `AGENT_START_CAP` (4, not read from the setting); the slice moves that count into `beginAppStarted`, so agent-started tasks and swarm agents share one cap.
- A swarm agent whose turn to start comes while the cap is full stays `queued`; it never fails for the cap. `task_start` from an agent keeps refusing at the cap (0028). The queue is ordered by swarm start time, then stage, then position in the definition. Freed slots go to the head of the queue, so an older swarm is not starved by a newer one.
- Steering a finished or interrupted agent whose process ended needs a slot like a start, and waits in the same queue.
- A cap lowered below the number of live processes stops nothing; new starts wait until the count falls below it. A raised cap releases the head of the queue at once.
- An agent queued for more than 5 minutes because of the cap raises the low-urgency `alert` `swarm:cap:<swarm id>` (0027 section 11 row, now for waits).

#### 3.3 Stages and parallel agents

An agent is ready when every agent of a lower stage and every agent in its `dependsOn` has ended `done`, or has ended in any state under the `continue` policy (section 3.4). Ready agents of a swarm start in parallel up to the free slots. A `readonly` reviewer in a later stage sees the work of the earlier stages through its inputs (section 4).

#### 3.4 Failure policy

| Policy | When an agent fails |
|---|---|
| `continue` | dependents still start; their inputs say that the dependency failed and include its error |
| `stop-dependents` (default) | every agent that depends on it, directly or through a stage, becomes `failed` with reason `dependency` without starting; independent agents go on |
| `stop-swarm` | every running agent is stopped (reason `policy`) and queued agents become `stopped`; the swarm is `stopped` |

Retries: an agent that fails with reason `exit` or `spawn`, or with `error-result` whose `terminal_reason` is `api_error`, is resumed once after 30 s with "Your last turn ended on an error. Continue the task." The failure policy applies only when no retry is left, so dependents are not failed while a retry is pending. Budget, turn, denial and mode failures are never retried. A failed agent creates a `failure` item (0021 section 3) with the result's `errors` text as app text; the `[ede_diagnostic]` lines (P31) are not shown.

### 4. Inputs, results and isolation

#### 4.1 Workspaces

| `workspace` | Working directory | Edits |
|---|---|---|
| `worktree` | `git worktree add -b agide/swarm-<swarm short id>/<name> -- <path> <base commit>` at `~/Agide/worktrees/<repo name>-<swarm short id>-<name>`, created by the app outside the sandbox (0028 section 10) | allowed; collected at the end |
| `readonly` | `git worktree add --detach -- <path> <base commit>`, or, for a reviewer in a later stage, a detached worktree at the merge preview of section 4.3 | deny rules `Edit(**)`, `Write(**)`, `NotebookEdit(**)` in `--settings`; Bash is not covered, so any change found at the end is stored as a patch and reported as a warning |
| `scratch` | an empty directory under the swarm's data directory | allowed; nothing is collected |

All agents of a swarm branch from the same base commit. The worktree manager of task start (`GitWorkingDirectoryManager`) gains a detached variant and a swarm branch name; branch names pass `git check-ref-format --branch`, and an existing branch or path is never overwritten.

#### 4.2 Inputs

Agent prompts are the definition's text, so for the classifier they are user messages (0028 section 12). Data produced by other agents is not typed into a prompt: the app writes `inputs.md` into the agent's inputs directory (passed with `--add-dir`) and the first message tells the agent to read it. The file holds, per finished dependency, its name, outcome, branch, changed files with line counts, and its final result text capped at 4,000 characters, wrapped in `<untrusted-data-<nonce> source="swarm-agent" name="impl">` as 0028 does for pull request text, cleaned with `cleanText`.

#### 4.3 Results

When an agent ends (any end state), the app collects, with a 60 s timeout:

1. `git -C <worktree> add -N .`, then `git diff --binary <base commit>` and `--numstat`; the patch is written to `swarms/<swarm id>/<name>.patch` in the profile data directory (0700 directory, 0600 file).
2. `git log --format=%H%x00%s <base commit>..HEAD` for the agent's own commits.
3. The final `result` text (capped at 8,000 characters), `num_turns`, the cost of section 6, `permission_denials`, and whether the user edited any tool input of this agent (P30: the agent is not told).
4. Checks against the definition: files outside `owns` (`outsideOwns`), files also changed by another agent of the swarm (`overlapsWith`), changes in a `readonly` workspace.

For a later-stage `readonly` agent the app builds a merge preview: a detached worktree at the base with the earlier agents' patches applied in stage and definition order (`git apply --3way`). A patch that does not apply marks the swarm result with `conflict` naming the agents and files, and the reviewer gets the patches as separate files in its inputs. The applied preview is committed on the detached HEAD before the reviewer starts, and the reviewer's own collection diffs against that commit, so the earlier agents' changes are not reported as edits in a `readonly` workspace. Merging into a user branch stays outside this record: it is `swarm_merge` of 0011 and waits for the review slice of 0010.

#### 4.4 Cleanup

- A `worktree` workspace is kept until the user removes the swarm. Removal (the swarm's context menu "Remove swarm…", a Dialog) lists each worktree with its state and branch. `git worktree remove` runs without `--force` when the worktree is clean; with changes it runs with `--force` only after a patch taken at that moment (step 1 of section 4.3) is stored, since the user or a resumed agent may have changed the worktree after the agent's end (P36 host rule). Files that git ignores are not in the patch and go with the worktree; the Dialog says so. Branches are deleted only when merged into the base or when the user ticks them. `git worktree prune` is never run.
- `readonly` worktrees and merge previews are removed by the app when the swarm ends, after their patches are stored.
- `scratch` directories are removed with the swarm.
- Patches and results follow the inbox retention setting (default 90 days, 0021).

### 5. Tiers

The tier table of 0003 and 0011 is one table in `core/swarm/tiers.ts`, read at each launch:

| Tier | `--model` | `--effort` | Default for role |
|---|---|---|---|
| strong | `fable` | `high`; `xhigh` for a reviewer when the swarm's policy says rung C or above (0010) | `reviewer` |
| mid | `sonnet` | `medium` | `worker` |
| small | `haiku` | `low` | `mechanical` |

- Aliases resolve in the CLI (P32: `sonnet` to `claude-sonnet-5-5`, `haiku` to `claude-haiku-5-5`). At the first start of a profile session the app sends `initialize` and keeps its `models` list; a tier whose alias is missing there is refused at validation with the alias named. `fable` is in the model-config docs and in the `initialize` models list of this login (P32 log), and is still checked this way per profile.
- `maxTier` caps every agent of the swarm: an agent asking for a higher tier runs on `maxTier`, and the start card shows the change. An agent's `effort` cannot raise its tier's effort above the `maxTier` tier's.
- The profile settings hold the table (`swarm.tiers`), so a model change touches one place; a reviewer is never below the highest worker tier of its swarm (0010).

### 6. Budgets

#### 6.1 What is counted

- Reported cost of a process: the latest `result.total_cost_usd` (cumulative per process, P34). A resumed process starts a new segment; the agent's reported cost is the sum of its segments' last values (0027 section 7).
- Estimate between results: for each `assistant` message id seen since the latest `result`, its `message.usage` (last copy per id) times the price table of 0027 (`core/usage/prices.json`). A model without a price gives no estimate, only tokens.
- Agent spend = reported + estimate since the last result. Swarm spend = the sum over its agents.
- Labels follow 0027 section 12: a dollar figure is "estimated, list price", and under a subscription, which is how swarms run (0012), "list-price equivalent, not billed"; the part between results is "estimated from tokens". Plan windows come from `rate_limit_event` and the status line as in 0027.

#### 6.2 Reservations and caps

- Before an agent starts (or resumes), the manager reserves `min((agent budget.usd ?? usdPerAgent) − agent spend so far, unreserved remainder)` from the swarm total, from the review allowance (`usdTotal × reviewShare`) for `reviewer` agents and from the rest for the others. The agent's spend so far is zero at the first start; subtracting it on a resume matters because `--max-budget-usd` counts per process and a resumed process counts from zero (P33, P35), so passing the full budget again would let each resume spend it anew. An agent whose reservation would be below 0.05 USD stays `queued` with "waiting for budget" when the swarm remainder is short, and ends `failed` with reason `agent-budget` when its own budget is spent. The reservation is passed as `--max-budget-usd`, so the CLI's own check is the cap of that process.
- The CLI checks after a response, so one response can cross the cap (P35). The app checks the agent's spend after every `assistant` message and sends `interrupt` once it reaches the reservation; the agent then ends `failed` with reason `agent-budget`. Any later message to it is refused by the app (the CLI would answer `error_max_budget_usd` without a model call, P35).
- When an agent ends, its reservation is released and replaced by its spend.
- Swarm cap: when the swarm spend reaches `usdTotal`, the manager refuses further starts and messages, interrupts every running agent, then stops them (reason `swarm-budget`). The overshoot is bounded by the responses in flight at that moment.
- Wall clock: at `wallClockMinutes` of running time the swarm stops with reason `wall-clock`.
- Raising a budget: the user edits it on the swarm pane or from the alert; agents stopped for the budget stay stopped until resumed with `swarm_send`.

#### 6.3 Alerts

`alert` items (0021, source `app`, origin `swarm`), all with actions that need a click (0027 section 11):

| Condition | Urgency | Dedupe key | Actions |
|---|---|---|---|
| swarm spend crosses 80 percent of `usdTotal` | `normal` | `swarm:budget:<swarm>:80` | open, raise budget, pause |
| swarm stopped at its budget or wall clock | `high` | `swarm:budget:<swarm>:stop` | open, raise budget and resume |
| an agent ended at its own budget or turn limit | `normal` | `swarm:agent-limit:<swarm>:<name>` | open, raise and resume, leave |
| a `rate_limit_event` with a `status` other than `allowed` (payload not yet seen, P34) | `normal` | `swarm:rate:<window>:<resetsAt>` | open, resume |
| an agent queued more than 5 minutes for the cap | `low` | `swarm:cap:<swarm>` | open |

A `rate_limit_event` other than `allowed` pauses every running swarm of the profile; the 0027 plan-window alerts offer "pause all app-started agents", which pauses every swarm. Rate alerts per subject (0027 section 11) include swarms through the existing rollup by `swarm_id`.

### 7. Approvals and the permission cap

#### 7.1 Effective mode

Effective mode of an agent = the strictest of: the agent's `permissionMode`, the swarm's `permissionMode`, and the caller's cap, in the order of `permissions/modes.ts`. The caller's cap is:

| Caller | Cap |
|---|---|
| the user in the start dialog | the profile's offered modes (0028); `bypassPermissions` only when the provider reports `filesystem: 'enforced'` and `network: 'allowlist'` and the user confirms in the dialog |
| a session through MCP | that session's current mode as its payloads report it (0028 section 1); never `bypassPermissions` |
| a swarm agent with `mayStartSwarms` | its own effective mode |

The schema leaves bypass out, so only the dialog path can ask for it. The effective mode is stored per agent and passed on every launch and resume. `set_permission_mode` is never sent to a swarm agent, since mid-turn effects are not probed (P32).

#### 7.2 Approval items

With `--permission-prompt-tool stdio`, every call that would prompt reaches the app as `can_use_tool`. Under auto mode these are the calls matched by the ask rules of 0028 (P20 showed them in `-p`) and calls the classifier sends to a prompt; which other calls reach `can_use_tool` in auto mode is open (P30 to P37 ran approvals in manual mode).

Each request becomes an `approval` item:

- origin `swarm:can_use_tool`, folder the swarm's folder, `session_id` the agent's session, `link_node_id` the agent's node, dedupe `swarm:perm:<session>:<request_id>`;
- message "<agent name> wants to run <display_name>: <first line of the input>" (agent text);
- payload: the raw control request as received (`request_id`, `tool_name`, `display_name`, `input`, `description`, `permission_suggestions`, `tool_use_id`, any `agent_id`, `decision_reason*`, `matched_ask_rule`), plus the class, mode and audience of the inspector record for the same tool name and input hash when one exists (0028 section 4);
- the card shows the raw request in the Details disclosure, always (0021 section 1).

The base hooks of `buildLaunchArgs` include `PermissionRequest`, and that hook fires in `-p` too (P1c), so `HookItemMapper` would also turn the same call into a `hook:PermissionRequest` approval item that cannot answer it. For sessions with `launchPath` `stream-json` the mapper skips `PermissionRequest` and `Notification` `permission_prompt` items; `can_use_tool` is the only approval source there.

Answers, from the inbox card or the agent's node only:

| Button | Control response | Shown when |
|---|---|---|
| Allow | `{ behavior: 'allow', updatedInput: <input as received> }` | always |
| Deny | `{ behavior: 'deny', message: 'The user denied this call in Agide.' }` | always |
| Always | `{ behavior: 'allow', updatedInput, updatedPermissions }` with the request's own `permission_suggestions` of type `addRules` with behaviour `allow` and destination `session`; other destinations are dropped, so no user or project settings file is written, and other types (`setMode`, directory changes, rule replacement or removal) are dropped, since P30 shows a Write request suggesting `setMode` `acceptEdits` for the session, which would loosen the effective mode of section 7.1 | the request carries such an `addRules` suggestion and the call has no draft or approve class |
| Edit and allow | `{ behavior: 'allow', updatedInput: <edited input> }`; the edit is recorded on the agent's result, since the agent is not told (P30) | the call has a draft class (0028) |

`updatedPermissions` in a control response is documented in the SDK reference and not probed; "Always" stays hidden until the slice's real-Claude script shows that the next identical call does not prompt.

Timeouts and endings:

- The CLI keeps a request pending (P30: at least 60 s; SDK docs: indefinitely). The app answers deny with "No answer from the user within <n> minutes; the call was not run." after `swarm.approvalTimeoutMinutes` (default 60, range 1 to 1,440), and the item resolves `expired`.
- A `control_cancel_request` for the request id (after an interrupt, P31), the process ending, or the agent being stopped resolve the item `superseded`; a click on a superseded item does nothing and says why.
- While a request is open the agent is `waiting`, keeps its slot and reservation, and its wall clock runs.

The answer command `swarm_approval_answer` has a UI binding and `mcpExempt: 'agents never answer approvals'`, so no agent, including the swarm's caller, can approve a call (parity check, 0013).

### 8. Steering

| Action | Command | Effect |
|---|---|---|
| Message to one agent | `swarm_send { swarmId, agent, message, now? }` | queued until the current turn's `result`; with `now: true` the app interrupts the turn first and writes the message after the interrupt's `result`. To an agent whose process ended (done, interrupted, stopped, failed for a retryable reason), it resumes the session with the message (needs a slot and a reservation) |
| Resume a group | `swarm_send { swarmId, message? }` without `agent` | unpauses the swarm, resumes every `interrupted` agent with the message (default "Continue where you stopped.") and releases the queue |
| Interrupt one agent | `swarm_interrupt { swarmId, agent }` | section 2.3 |
| Pause a group | `swarm_interrupt { swarmId }` | the swarm becomes `paused`; every running agent is interrupted; queued agents wait |
| Stop one agent | `swarm_stop { swarmId, agent }` | section 2.3; dependents follow the failure policy as if it failed |
| Stop the group | `swarm_stop { swarmId }` | every running agent is stopped, queued agents become `stopped`, the swarm is `stopped`; worktrees stay |

Messages from agents (`swarm_send` by a caller session) are agent text: the app prefixes them with "Message from agent session <title>:" and cleans them with `cleanText`. They carry no user consent (`notes/swarm-orchestration.md` section 1); approvals stay in section 7.

### 9. MCP tools

Each tool is a registry command (0013) with `mcp: true` and a UI binding on the swarm node or pane, so the parity check holds without exemptions apart from the approval answer. Inputs in zod:

```ts
const swarmRef = z.object({ swarmId: z.string().min(1).max(64) }).strict();
const agentName = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

swarm_start:     z.object({ definition: swarmDefinition, parentFolderId: z.string().max(64).optional() }).strict()
                 // result: { swarmId, folderId, agents: { name, state, sessionId?, branch? }[], warnings: string[] }
swarm_list:      z.object({ states: z.array(z.enum(['running', 'paused', 'done', 'failed', 'stopped'])).optional(),
                            limit: z.number().int().min(1).max(100).default(20) }).strict()
swarm_status:    swarmRef  // per agent: state, reason, tier, model, turns, spend and basis, reservation, changed files, open approvals
swarm_send:      swarmRef.extend({ agent: agentName.optional(), message: z.string().min(1).max(8_000).optional(), now: z.boolean().default(false) })
swarm_interrupt: swarmRef.extend({ agent: agentName.optional() })
swarm_stop:      swarmRef.extend({ agent: agentName.optional() })
swarm_results:   swarmRef.extend({ agent: agentName.optional(), patch: z.boolean().default(false) })
                 // per agent: outcome, result text in an untrusted-data block, branch, worktree path, commits, numstat,
                 // outsideOwns, overlapsWith, editedInputs, conflict; the patch text only with patch: true, capped at 100 KB
```

Scope and roles:

| Caller | Sees | May start | May send, interrupt, stop |
|---|---|---|---|
| the user (UI) | every swarm of the profile | yes | every swarm |
| a session (PTY or stream-json, not a swarm agent) | swarms whose folder is within its folder scope | yes, with approval (below) | swarms it started |
| a swarm agent | its own swarm (status and results) and swarms it started | only with `mayStartSwarms` and within the depth limit | swarms it started; never its own swarm or its siblings |

- `swarm_start` creates a folder for the swarm under `parentFolderId` (default: the caller's folder; it must be within the caller's scope) titled with the goal's first line, and stores the caller's session id. The swarm's agents get grants scoped to that folder.
- Approval: `mcp__app__swarm_start` joins `mcp__app__task_start` in the class `app.agent_start` (approve) with an ask rule, so a start from any session prompts the user: the TUI dialog in a PTY session (until the `http` hook transport), an inbox card in a stream-json session. The card renders the definition as the app parsed it (agents, tiers after `maxTier`, effective modes, budgets, workspaces) above the raw JSON.
- Spawn depth: a user session has depth 0; a swarm agent, and a session started by `task_start` from an agent, has its caller's depth plus 1, so a hop through `task_start` does not reset the depth. `swarm_start` is refused when the caller's depth is at or above `swarm.maxSpawnDepth` (default 1, range 0 to 2), so by default swarm agents cannot start swarms; a depth of 2 also needs `mayStartSwarms` on the calling agent. Native subagents inside an agent follow the CLI's own limits (depth 3, 20 concurrent, `notes/swarm-orchestration.md`) and the agent's budget, since their spend counts in its `result` (P5).
- Per caller session, at most `swarm.maxActivePerSession` (default 2) swarms may be `running` or `paused` at once.
- Errors use the command error codes: the existing `invalid_input` (schema and validation, with the field named), `out_of_scope` and `not_found`, and the new `limit_reached` (depth, active swarms) and `refused` (mode, bypass), which the slice adds to `CommandErrorCode` (today `not_found`, `invalid_input`, `out_of_scope`, `failed`; `limit_reached` exists only as a `SessionErrorCode`).

### 10. User interface

Built from the `ui` components and tokens of 0035; no colour literals (`pnpm check:colours`).

- **Tree.** A swarm is a folder node with the `network` icon and the goal as title; its agents are session leaves inside it, ordered by stage then definition order. A swarm started by a session is rendered nested under that session's leaf (0027 section 3) while its folder stays where scoping puts it. Agent rows use the agent row of 0035 section 3.5 with the run-state chip; new chips: `queued` (neutral, `clock`), `interrupted` (neutral, `pause`), `stopped` (neutral, `circle-stop`); `square` already means `exited` in `STATUS_ICONS`, and one glyph keeps one meaning. `network`, `clock`, `pause` and `circle-stop` are added to `icons.ts`. `waiting`, `failed`, `done` and busy reuse the existing chips. The swarm row's trailing area shows the swarm chip, the budget meter (below) and, when agents wait, the waiting marker. The project folder keeps the "N of 4" label of 0027 for app-started processes, and a swarm row's Tooltip says "N running, M queued".
- **Group controls.** The swarm row's context Menu and the swarm pane's Toolbar: Pause (`swarm_interrupt`), Resume (`swarm_send`), Stop (`swarm_stop`, confirmed in a Dialog with the Danger variant), Results, Show definition, Remove swarm…. Agent rows: Send message…, Interrupt, Stop, Open transcript.
- **Start-swarm dialog.** A 640 px Dialog from the tree's "New swarm…" menu item and `Cmd+Shift+S`. Tabs "Form" and "JSON". Form: Goal (textarea Field), Repository (Select of recent repositories, "Choose…", "No repository") and Base (Field), Permission mode (Select, capped as in section 7), Budget (USD total, per agent, wall clock, review share as Fields), Connectors (Switch), and an agents Table with name, role (Select), tier (Select), workspace (SegmentedControl), stage (Field) and a Disclosure per row for prompt, `owns`, tools and per-agent budget. JSON: a monospace textarea that round-trips with the form. Validation errors show on the field (Invalid state) or as a danger Notice above the footer. A collapsed preview Disclosure lists the commands the app will run and each agent's effective model, effort and mode. Footer: Cancel, Start (primary).
- **Swarm pane.** Block `agide/swarm` with property `swarmId`: a header with the goal, state chip, budget meter and plan windows; Tabs "Agents" (Table: name, state with reason, tier, turns, spend, changed files, open approvals, actions) and "Results" (per agent: outcome, result text as plain text, branch, numstat, warnings for `outsideOwns`, `overlapsWith`, `conflict` and readonly changes as warning Notices). A Banner shows paused and stopped states with Resume.
- **Budget meter.** An SVG bar: the reported part in `accent`, the estimated part in `accent.subtle` with a 1 px `accent.text` outline, the reserved part as an outline only; the fill turns `warning.fg` from 80 percent and `danger.fg` at the cap. A text label always follows ("1.20 of 3.00 USD, list-price equivalent, not billed" under a subscription, section 6.1), so the state does not depend on colour; `aria-label` carries the same text.
- **Approvals.** The inbox card of 0035 section 3.9 for `approval` items of origin `swarm:can_use_tool`: kind label, title "<agent> wants to run <tool>", meta line with swarm, agent, effective mode and "denied automatically in 47 minutes", the raw request in the Details disclosure, and the buttons of section 7.2 (Deny secondary, Always secondary, Allow primary). The same buttons appear on the agent's node Popover while it is `waiting`.

### 11. Usage and alerts

- Agent rows of 0027 carry `swarm_id`; app-started sessions roll up to their swarm and folder, never into the caller's own figure (0027 section 7). The ranking and heat markers of 0027 cover swarm agents unchanged.
- The ledger of section 6 is the swarm's budget source; the 0027 `UsageEngine` stays the source for rates. Both read the same `result` and `assistant` messages; the ledger keeps its own per-message-id dedupe so a budget never depends on the 10-second rate buckets.
- 0027 section 11 rows apply to swarms as subjects; the cap row changes to the queue wait of section 3.2. The pause action on a swarm alert calls `swarm_interrupt` without an agent.

### 12. Persistence

Module `swarm`, migration 1, initialized after `agents` and `inbox` (checked against `node:sqlite` in Node 22 with stand-in `tree_nodes` and `sessions` tables):

```sql
CREATE TABLE swarms (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  caller_session_id TEXT,                 -- NULL when the user started it
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 2),
  definition TEXT NOT NULL,               -- the validated JSON
  repo_path TEXT,
  base_commit TEXT,
  state TEXT NOT NULL CHECK (state IN ('running', 'paused', 'done', 'failed', 'stopped')),
  stop_reason TEXT,
  usd_total REAL NOT NULL CHECK (usd_total > 0),
  wall_clock_ms INTEGER NOT NULL DEFAULT 0 CHECK (wall_clock_ms >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK ((state IN ('done', 'failed', 'stopped')) = (ended_at IS NOT NULL))
);
CREATE INDEX swarms_by_state ON swarms (state, created_at);

CREATE TABLE swarm_agents (
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  session_id TEXT UNIQUE,                 -- NULL until first launch
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'waiting', 'interrupted', 'done', 'failed', 'stopped')),
  reason TEXT,
  interrupted_by TEXT CHECK (interrupted_by IN ('user', 'caller', 'pause', 'quit', 'crash')),
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  permission_mode TEXT NOT NULL CHECK (permission_mode IN ('plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions')),
  workspace TEXT NOT NULL CHECK (workspace IN ('worktree', 'readonly', 'scratch')),
  cwd TEXT,
  branch TEXT,
  pid INTEGER,
  reserved_usd REAL NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  reported_usd REAL NOT NULL DEFAULT 0 CHECK (reported_usd >= 0),
  estimated_usd REAL NOT NULL DEFAULT 0 CHECK (estimated_usd >= 0),
  turns INTEGER NOT NULL DEFAULT 0 CHECK (turns >= 0),
  retries INTEGER NOT NULL DEFAULT 0 CHECK (retries BETWEEN 0 AND 1),
  result_text TEXT CHECK (result_text IS NULL OR length(result_text) <= 8000),
  result_meta TEXT,                       -- JSON: commits, numstat, outsideOwns, overlapsWith, editedInputs, conflict
  patch_path TEXT,                        -- relative to the profile data directory
  queued_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (swarm_id, name),
  CHECK ((state IN ('done', 'failed', 'stopped')) = (ended_at IS NOT NULL)),
  CHECK ((state = 'interrupted') = (interrupted_by IS NOT NULL)),
  CHECK (state IN ('queued', 'failed', 'stopped') OR session_id IS NOT NULL)  -- dependency failures and stops from the queue never launch
);
CREATE INDEX swarm_agents_live ON swarm_agents (state, queued_at);
```

The check showed that a running agent without a session, an ended row without an end time, an interrupted row without its cause, a repeated name or session id and a depth above 2 are refused; that a queued row and a dependency failure without a session are accepted; that deleting the folder keeps the swarm with no folder; and that deleting a swarm removes its agent rows. The definition schema of section 1, run with the app's zod, accepts the example and refuses `bypassPermissions` and unknown keys.

Rows are written at every state change and the spend columns every 10 seconds while an agent runs. Paths stay in the profile database and never reach MCP results except the worktree path and branch of the caller's own swarms.

### 13. Threats

| Threat | Rule |
|---|---|
| Untrusted agent output reaches another agent or the user | results, messages and summaries are agent text: plain-text rendering, `cleanText`, length caps (0021 section 9); between agents only as files in `--add-dir` inside nonce-tagged untrusted-data blocks or as MCP tool results, never typed into a prompt; the caller gets results as tool results |
| Prompt injection through results ("approve the next call", "start a swarm with bypass") | no agent can answer approvals (`mcpExempt`); `swarm_start` from any agent asks the user; modes are capped by the caller; the definition has no allow list; workers cannot message siblings |
| Escalation of permissions | effective mode = strictest of definition and caller; bypass only from the dialog on a qualifying provider; `set_permission_mode` never sent; "Always" writes only `session` scope rules; ask rules and the inspector of 0028 come with every launch |
| Runaway spawning | the profile-wide cap with a queue; `swarm.maxSpawnDepth` default 1; `mayStartSwarms` off by default; `swarm.maxActivePerSession`; native subagents bounded by the CLI and the agent's budget |
| Cost | per-agent reservation passed as `--max-budget-usd`, the app's own check after each response, the swarm cap with interrupt and stop, wall clock, rate-limit pause, no automatic resume after quit or crash, retry at most once |
| Conflicting or stray edits | worktree per editing agent; `owns` checked before start; `outsideOwns`, `overlapsWith`, readonly changes and merge-preview conflicts reported; no merge into user branches |
| Lost work at cleanup | patches stored before any forced removal; branches kept unless merged or ticked; nothing removed without the user |
| Orphan or duplicate processes | one live process per session; the crash path ends a recorded pid that still names the session before any resume |
| A swarm hogs the plan | the cap, the queue order by age, the plan alerts of 0027 with "pause all app-started agents" |
| Forged events | stream-json comes from processes the app spawned; budget decisions use only those; hook files remain view-only (0027 section 13) |

### 14. Tests

- **Fake CLI.** `core/swarm/fixtures/fake-claude-stream.mjs`: reads NDJSON from stdin and writes stream-json to stdout. It records its arguments and environment to `$FAKE_CLAUDE_RECORD`; refuses `--session-id` of a session it already created and accepts `--resume` (P33); emits `system/init` with the requested `permissionMode` (or `FAKE_CLAUDE_MODE`) per turn. Prompt directives: `/text <s>` (an assistant message with usage), `/tool <name> <json>` (a `can_use_tool` request, then waits for the response and emits the tool result or the error), `/cost <usd>` (sets the cumulative cost of the next result), `/sleep <ms>`, `/fail <terminal_reason>` (an error result), `/exit <code>`, `/write <file> <text>` (writes in the working directory). It answers `interrupt` with an `error_during_execution` result and a `control_cancel_request` for a pending request, `initialize` with a models list, and stops model work after the result that crosses `--max-budget-usd`, answering later messages with `error_max_budget_usd` (P35). Fixture lines for init, `can_use_tool`, `result` and `rate_limit_event` are copied from `probes/out/p30_*` to `p35_*` with paths and personal values replaced.
- **Unit tests.** Definition schema and graph validation (cycle, unknown dependency, overlapping `owns`, missing repository); the effective-mode function over every pair of modes and callers; the reservation and release ledger; the queue order; stage readiness; each failure policy; retry rules; the alert thresholds; argument building per tier and workspace.
- **Integration tests** with the fake CLI and temporary repositories: a two-stage swarm with a readonly reviewer and a merge preview; an approval answered Allow, Deny, by timeout with a fake clock, and superseded by an interrupt; steering queued during a turn and with `now`; interrupt and resume of one agent and of the group; stop of one agent under each failure policy; quit with running agents and a restart that leaves them `interrupted`; a crash with a recorded live pid; the swarm budget stop with two running agents; collection of a new and a changed file; removal refused without a stored patch.
- **MCP tests.** Scope per caller role; depth refusal; `swarm_approval_answer` absent from the tool list and the parity check passing; error codes.
- **Mutation checks** in the review step: the cap comparison (`>=` to `>`, and counting only swarm agents) fails a test; picking the looser mode in the effective-mode function fails a test; dropping the reservation fails the budget test; removing `mcpExempt` from the approval answer fails the parity and MCP tests; dropping the depth check fails the depth test; skipping the patch before a forced removal fails the cleanup test.
- **UI.** Playwright with hidden windows: the start dialog (form and JSON round trip, a validation error), swarm and agent rows with chips, the budget meter label, an approval card answered from the inbox, Pause and Resume.
- **Real Claude**, a script outside `pnpm test` (`scripts/real-swarm.mjs`): haiku, `--max-budget-usd 0.25` per agent, a temporary repository with an empty working tree, `--setting-sources user`, `--strict-mcp-config`, the environment scrub of `probes/lib.mjs`, at most 3 processes. Two worktree agents and a readonly reviewer; one `can_use_tool` answered by the script through the approval command; an interrupt and a resume; results with patches; then cleanup. The same script checks "Always" (`updatedPermissions` with a `session` suggestion) and which calls reach `can_use_tool` under auto mode with the app's ask rules. A run costs a few cents.

## Consequences

### First slice for this milestone

1. `AgentEnvironment.processCommand` in the providers (container without `-t`), `StreamSessionService` with `StreamChannel`, launch arguments, the init check, interrupt, stop, resume and the one-process-per-session lock; the stream messages wired to `AgentsController.streamMessage` and `streamResponse`; `HookItemMapper` skipping permission items for stream-json sessions.
2. Module `swarm`: definition schema and validation, tiers, the manager with states, cap queue (with the task-start count moved into `beginAppStarted`), stages, failure policy and retries, the budget ledger with reservations and the swarm cap, quit and restart handling, migration 1.
3. Worktree and readonly workspaces through `GitWorkingDirectoryManager`, inputs files, result collection with stored patches, merge previews for later-stage reviewers, cleanup dialog.
4. Approval items from `can_use_tool` with Allow and Deny (Always and Edit wait, below), the app timeout, supersession; `swarm_approval_answer` UI-only.
5. MCP tools `swarm_start`, `swarm_list`, `swarm_status`, `swarm_send`, `swarm_interrupt`, `swarm_stop`, `swarm_results` with scope, roles, the `app.agent_start` ask rule for `swarm_start`, depth 1.
6. UI: swarm and agent rows with the new chips, group controls, the start dialog, the swarm pane with the budget meter, the approval card.
7. Alerts of section 6.3, tests of section 14, the real-Claude script.

About 9 to 12 working days in 0005 units, one engineer plus agents, low confidence; 0011 put R18 at 14 days with merge excluded, and the stream-json adapter, agent store, cap check, worktree manager and gate already exist.

### What waits

| Item | Waits for |
|---|---|
| "Always" on approval cards | the real-Claude check of `updatedPermissions` with a `session` suggestion |
| "Edit and allow" for draft classes | the stream-json class cards of 0028 |
| `swarm_merge` and merging into user branches | the review slice of 0010 (rung assessment before a change reaches the user's branch) |
| `xhigh` reviewers tied to rungs | the 0010 policy parser |
| Spawn depth 2 | a run of the depth-1 slice and a review of the queue-behind-caller case |
| A PTY view attached to a swarm agent | 0027 "What waits" |
| Resuming an interrupted turn with `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` | a probe |
| Swarms in background sessions (`claude --bg`) | a probe under the subscription; no budget cap there (0011) |
| Swarm templates stored with a project | user demand after the slice |
| Switching an agent to a cheaper tier from an alert | `set_model` mid-run is answered (P32) but its effect on a running turn is not probed |

### Other consequences

- 0011 is refined: the YAML sketch becomes the JSON schema above; `role` `merger` waits with `swarm_merge`; `swarm_budget` folds into `swarm_status`; `swarm_result` becomes `swarm_results`, and `swarm_list` and `swarm_interrupt` are added; `shared-readonly` becomes `readonly` on a detached worktree.
- 0027 is amended: app-started swarm agents queue at the cap and alert after a wait; `task_start` still refuses at the cap. A stream-json agent's stop follows section 2.3. The agent store keeps its states; run states live in `swarm_agents`.
- 0021 is amended: stream-json `can_use_tool` requests become approval items answered from the card with the app timeout; origin `swarm` alerts are those of section 6.3.
- 0022 is amended: `AgentEnvironment.processCommand`.
- `SessionService` gains stream-json sessions; `sendText` writes a user message to them, and `write` and `resize` answer `not_running` for them.
- The swarm on the subscription shares the plan's limits with the user's own sessions; the cap, the queue and the rate-limit pause are the protection (0012).
- Not verified: which calls reach `can_use_tool` in auto mode with `--permission-prompt-tool stdio`; `updatedPermissions` in a control response; a pending request beyond 60 s; the payload of a rejected or warning `rate_limit_event`; the CLI's behaviour when its stdin closes mid-turn; `CLAUDE_CODE_SUBAGENT_MODEL` with `_FORCE=1` in `-p`; a model call on the `fable` alias (it is listed by `initialize`, P32); `processCommand` under `srt` and `container` without a terminal; `git apply --3way` merge previews on real swarm output; plan limits under several parallel agents of mid and strong tiers.
