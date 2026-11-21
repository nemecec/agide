# Review of the swarm renderer, inbox approvals and end-to-end tests

Start: 2026-11-21T09:22:30Z. End: 2026-11-21T09:29:46Z.

Scope: the swarm pane, the start dialog, the tree decorations and menu, the group controls, the approval answer in the inbox card, the IPC exposure of `swarm_approval_answer`, the agent node and usage integration, and the swarm end-to-end specs. Read-only review; no source file changed.

Commands run: `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm check:colours` and `pnpm visual-check --hidden --only swarm,inbox`. All passed. The swarm screenshots were opened and read.

Main findings: group Resume on a stopped swarm does nothing while the banner says it continues the stopped agents; the approval card shows the tool input only as a 140-character summary with the full request in a collapsed disclosure, and does not name the swarm; the approval answer state of the card carries over to the next selected item because the card is not keyed by item; some unit tests assert calls the command would refuse, or nothing at all.

What took long: the end-to-end run (about three minutes) and the visual check of the inbox phase.

Not finished: the temporary directory of this review under the system temporary folder (`rev-swarm-ui`) could not be removed because the removal command was denied; it holds logs and screenshots only.
