# Review features in candidate bases (R19)

Date: 2026-11-17. Method: Read and Grep over the shallow clones and the existing triage notes. Nothing was installed, built or run, so every "exists" below means code or docs seen, not behavior observed. superset's row rests on the clone (medium to low confidence). The vscode row rests on `notes/triage-vscode.md` and `notes/reviews/vscode.json`; microsoft/vscode was not cloned.

R19 asks for a risk assessment with reasons per unit of work, an escalation ladder, a per-project policy, views at several levels (goal, agent, changeset, file, hunk), and a recorded, retrievable trail. Decision 0008 caps a base with no review model beyond a plain diff at 1. That cap applies here only to vscode; superset, emdash and nimbalyst have more than a plain diff, so their scores rest on the remaining work.

## Result across bases

No candidate has a per-changeset risk model, a review ladder chosen by policy, or a record of review outcomes per changeset. Every Electron candidate can run reviewer agents on a trigger or schedule, but none from a risk policy. What differs is the quality of the plain review UI that the risk model would attach to, and where the extension point sits.

| Feature | superset | emdash | nimbalyst | vscode (extension) |
|---|---|---|---|---|
| Diff of agent changes | Diff pane, annotations hook | Diff view with changes panel | Monaco diff with approval bar; Lexical tree diff for Markdown | Stock diff editor |
| Line comments on the diff | Yes, tied to PR review threads | Yes, "diff comments" can be mentioned in chat to the agent | Not seen outside PR review | GitHub PR extension provides them |
| Accept or reject of an agent edit | Yes: per-turn changesets (`getTurnChanges`, with a live mode) and per-file undo of a turn (`undoTurnFiles`), wired into the chat session view | Not seen | Yes: per-file accept and reject (pre-edit tagging, file watcher, `DiffApprovalBar`, `MonacoDiffApprovalBar`); for code only Accept All and Reject All per file, no hunk level | Extension must build it |
| PR review threads | Yes: GraphQL query, parse, normalize, navigate, ReviewPanel | Yes: GitHub and GitLab plugin clients, PR list, comments | Yes: PR mode with Conversation, Commits, Checks, Files Changed tabs | PR extension, no data API found |
| CI checks | Yes: check status computation, PR pane | Yes: `checks-list.tsx` in the PR entry | Yes: Checks tab | PR extension |
| Merge or approve actions | Merge methods, async merge, stacks | Create and merge present | Approve and merge with in-app confirm step | PR extension |
| Review agent | Automations triggered by GitHub webhooks (PR opened, synchronize, ready for review, checks completed, review submitted), run through the hosted API; works without Superset cloud not confirmed (low). `review-host` is the App Store review VM, unrelated | Default worktree review prompt and scheduled automation templates (critical bugs, security review, digest of risky changes) | PR review sessions (prompted, not policy-driven); Crew extension (alpha, off by default) with scheduled members such as a QA Skeptic that picks the riskiest finished sessions and an Architect that reviews the day's diffs | Not seen |
| Risk labels | None found | None found | Command-level permission engine with dangerous-pattern detection (per design doc, `design/permissions/security-review-agent-permissions.md`). It rates tool calls, not changesets | None |
| Multi-level summaries | None found. Workspace, PR and diff panes exist as separate views | None found | None found. Session tree and PR panel exist | None |
| Approval policy | Shipped `Decision` items and `respondToApproval` for tool-call approval, with Claude and Codex adapters; no changeset policy | Auto-approve flag per project (triage-emdash) | Permission service with approval scopes and trust per workspace | None; host answers permission callbacks (probes) |
| Record of outcomes | `automation_events` and `automation_runs` tables; approval request items with status and decision; no review outcome per changeset | PR data cached in the app database; tasks get a `review` status while the linked PR is open and not a draft | Sessions, messages and the PR overlay are stored; Crew files findings as tracker items (decision, debt, bug); accept and reject results are not recorded as review outcomes (not found) | None |

## superset

Present: a PR pane (detail, checks, threads, diff, merge methods, async merge, stacked PRs) built on shared packages under `packages/shared/src/pull-request-*`, a right-sidebar ReviewPanel listing PR comments, a workspace ReviewPane that opens comments beside the diff, and `useDiffAnnotations` for annotations on the diff pane. The pane registry (`usePaneRegistry`, package `@superset/panes`) lets new pane kinds be added to a workspace.

Also present: per-turn changesets with per-file undo (`packages/chat/src/protocol/commands.ts`, `packages/host-service/src/chat-v3/gitCheckpoints.ts`), the `Decision` schema and `respondToApproval` command as shipped code (`packages/chat/src/protocol/items.ts`), and GitHub-webhook automations with event and run tables in the hosted backend.

Absent: any risk field, any per-changeset summary, a reviewer run by risk policy, a review outcome log.

Extension points: pane registry for the multi-level views; the shared PR packages for the PR level; the chat protocol `Decision` items and a durable event envelope for recording outcomes. Licence and fork cost are covered elsewhere and not assessed here.

## emdash

Present: PR plugin capability (`packages/plugins/src/pull-requests`) with GitHub and GitLab implementations, PR store and list in the desktop app, checks list inside the diff view's changes panel, and a diff-comments mention (`context:diff-comments`) that pipes line comments into an agent prompt. That last item is the most agent-oriented review feature found: a human comments on lines, and the agent receives them.

Also present: a default worktree review prompt and scheduled automation templates for bug and security review; whether the prompt is wired to a button is not checked.

Absent: risk, summaries, a reviewer run by policy, outcome record. Auto-approve per project exists for permissions (triage-emdash) and is a binary switch.

Extension points: `definePluginCapability` plugin system for a review capability; the source-control feature folder for the changeset and file levels; SQLite store for the record. Upstream activity was low at the time of reading (triage-emdash).

## nimbalyst

Present: the broadest set. Accept and reject of agent edits in Monaco and in the Markdown editor, a PR mode with Conversation, Commits, Checks and Files Changed tabs, approve and merge with a confirm step, PR review sessions, a permission engine with approval scopes and dangerous-pattern detection, a session tree, and an extension SDK with custom editors that support diff mode, backend sessions and a tracker system.

Also present: the Crew extension (`packages/extensions/crew`, alpha, off by default): long-lived members on schedules with token budgets, a journal, a notification ladder (note, flag, page, ask) capped per member, and tracker items as a record of findings. The ladder governs notifications to the user, not review routing.

Absent: risk on changesets, a review ladder, a summary hierarchy, recorded review outcomes, a reviewer that runs by policy. The PR review session is a manual prompt that starts a normal agent session.

Extension points: extension manifest contributions (custom editors, panels), `ctx.services.sessions.create` for spawning a reviewer session, trackers as a store for risk and outcome records, and the app MCP server for exposing review tools to agents. The permission engine is the natural home for the per-project policy format, though it works on tool calls.

## vscode (as an extension)

Present: stock diff editor, comments API, SCM view, GitHub PR extension, MCP provider registration, `globalState` and files for storage. Views for the multi-level hierarchy map to tree views and webviews; a reviewer agent maps to a spawned CLI session.

Absent: all R19 semantics. Everything beyond the diff editor and PR review is a new build, with the diff and comment UI free. The marketplace licence limits to VS Code builds are not assessed here.

## Not verified

- Behavior of any listed feature; no app was run.
- Whether nimbalyst records accept and reject results anywhere in its database. Not found by search, but not exhaustively searched.
- Whether superset's webhook automations work for a local-only install without Superset cloud.
- Whether Crew reviewer members wake on session completion or only on schedule; whether nimbalyst's Markdown diff accepts per change.
- The vscode PR extension feature set comes from the triage note, not from reading its code.

## Scores

Scoring rule: 3 works today, 2 moderate work, 1 major work, 0 absent or infeasible. No base has a risk model or a review ladder, so the real work is similar in kind: risk model, ladder and policy, reviewer agent, multi-level views, record. Differences come from the review UI, the reviewer runs and the extension surface that exist.

| Base | R19 | Effort days | Reason |
|---|---|---|---|
| nimbalyst | 1 | 20 | Best starting UI: accept and reject, PR tabs, permission engine, trackers for records, MCP and extension SDK; Crew gives scheduled reviewers, a notification ladder and a tracker record (alpha). Core risk and review ladder missing. Low confidence |
| emdash | 1 | 25 | Diff comments reach the agent; plugin system and DB, review prompt and automation templates exist. No accept or reject; no summary layer. |
| superset | 1 | 23 | Strong PR and thread UI, pane registry, per-turn changesets with undo, webhook-triggered agent runs and an approval decision record. The triggers depend on the hosted backend, which may cancel part of the gain. Low confidence |
| vscode | 1 | 28 | Stock diff and PR tooling; all semantic layers and storage are new webview and tree work. The 0008 cap applies. |

Effort days are estimates for one engineer plus agents, reaching 3 on the full R19 text. They are totals; no split across work items exists, so they cannot be checked item by item. The spread is smaller than the estimate error. The greenfield figure on the same scope is in `review-ladder-design.md` (about 29 after its review); every fork figure is below it.

## Review corrections

An independent review checked this note against the clones. Changes made:

- Superset has per-turn changesets with per-file undo (a reject path and a changeset view level); the `Decision` and `respondToApproval` approval items are shipped code; `review-host` is the App Store review VM. Effort 26 to 23.
- Every Electron candidate can run reviewer agents on a trigger or schedule (superset webhook automations, emdash review prompt and automation templates, nimbalyst PR review sessions and Crew); none runs one from a risk policy.
- Nimbalyst Crew (alpha, off by default) adds scheduled reviewers, a notification ladder and a tracker record. Effort 22 to 20.
- The 0008 cap applies only to vscode; fork scores of 1 rest on remaining work.
- Nimbalyst code accept and reject is per file only, no hunk level.
- Emdash tasks have a `review` status while the PR is open.
- Counts removed from the prose.
