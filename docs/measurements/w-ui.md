# w-ui: swarm renderer

Start: 2026-11-21T05:38Z (date -u). End: see the last line.

## What was built

- Run-state glyphs `queued`, `interrupted`, `stopped` in `renderer/ui/icons.ts` (statuses and tones), actions `pause`, `resume`, `send-message`, `results`.
- `renderer/panes/swarm`: view model (`swarmModel.ts`), shared feed over `swarm_list` and `swarm_status` (`useSwarms.ts`), budget meter, swarm pane with Agents and Results tabs, group controls, Banner for paused and stopped swarms, dialogs for stop confirmation, message to one agent and the definition (`SwarmActionDialogs.tsx`), and a layout patch that opens the pane (`openSwarmPane.ts`).
- Tree: swarm folder chip, budget bar, waiting marker, "N of M agents running" label on a folder that holds swarms, agent run-state chips, context menu entries for folders and agent leaves.
- Start dialog: Form and JSON tabs that round-trip (keys without a field survive), templates, agents table, preview, schema validation while editing, the manager's answer above the footer.
- Inbox card: Deny and Allow through `swarm_approval_answer`, the agent, mode and automatic-denial time, the raw request in a disclosure.
- Tests: unit tests for the view model, form, pane, tree hooks, menu, dialogs, approval actions and the layout patch; `e2e/swarm.spec.ts`; visual-check phase `swarm`.

## Changes to shared files (smallest possible)

- `src/renderer/App.tsx`: mounts `SwarmActionDialogs` (the confirm, message and definition dialogs have no host in `DialogHost`).
- `src/renderer/panes/inbox/ItemCard.tsx`: the "session is waiting, this card cannot answer" note is hidden for `swarm:can_use_tool` items, which the card now answers.
- `src/main/modules/swarm.ts` was replaced by w-manager while this ran. A first version of this work added an in-memory backend behind `AGIDE_SWARM_FAKE`; it is removed. The end-to-end test and the visual check now run the persistent manager with `fake-claude-stream.mjs` as `AGIDE_CLAUDE_BIN`.
- `swarm_list` answers `{ swarms }`; the feed reads that shape.
- `scripts/visual-check.mjs`: phase `swarm` in `scripts/lib/visual/phaseSwarm.mjs`.

## Contract gaps for the integration step

- "Always": the command `swarm_approval_answer` takes `allow` and `deny` only, so the button is built, sends `decision: 'always'`, and stays hidden (`ALWAYS_ANSWER_SUPPORTED` is false) until the command and manager accept it (0037 section 7.2 also waits for the real-Claude check).
- No `swarm_remove` command exists, so the "Remove swarm…" entry is not built.
- `SwarmAgentStatus` has no changed-files figure; the Agents table leaves that column out and the Results tab shows the numstat.
- A queued agent has no session and so no tree leaf in the fake; where the persistent manager creates leaves at start, the chip shows at once.
- A swarm started by a session is not drawn nested under that session's leaf: that needs `TreePane`.
- Bypass is not offered in the dialog (needs the provider check and confirmation).
- "Open transcript" on an agent leaf is replaced by "Open swarm".
- Coverage thresholds in `vitest.config.ts` do not list the new files.

## Time

Most time went to reading the contracts, the first pass of the dialog, and the fake backend for the end-to-end test. Visual check found a nearly invisible budget track, a wrapping segmented control and an overflowing agents table; all fixed. Tests found a floating-point error at 80 percent in the meter and an array accepted as a definition in the JSON tab; both fixed.

End: 2026-11-21T08:02Z. `pnpm typecheck` failed once on a type error in `PersistentSwarmManager.test.ts` (w-manager's file, not edited). Full `pnpm coverage` showed failures only in `core/swarm/runtime` tests (w-runtime's, slow under load).
