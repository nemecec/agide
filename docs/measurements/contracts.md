# Milestone 2 contracts

Start: 2026-11-17T15:38:39Z
End: 2026-11-17T15:58:42Z

## Work

- Read 0013, 0014, 0020, 0021, 0022, `notes/probes-m2.md` and the milestone 1 code in `app/src`.
- Updated 0021 with the P13, P14 and P15 results: new fact rows (waiting permission hook, background subagents and `<task-notification>` prompts, the `Elicitation` hook in form mode, OSC 9 output), the verification column of the hook table (`elicitation_dialog` and `elicitation_response` probed, the card answer probed with a transport to build, `UserPromptSubmit` split for task notifications, the interrupt row after Esc on a dialog), the first slice, the waits table and the consequences.
- Wrote 0023 with the slices, modules, contracts, init order, ownership, test strategy and choices.
- Wrote the contracts and stubs: `src/core/profile`, `src/core/isolation`, `src/core/blocks`, `src/core/inbox` with shared contract suites and reference implementations; `LocalProvider` and `FakeProvider`; the main module stubs `profile.ts`, `layout.ts`, `inbox.ts`; `src/main/desktop.ts` with the `Desktop` seam; the renderer stubs `InboxPane.tsx`, `ProfileRail.tsx`, `paneTypes.ts`, `paneComponents.tsx`.
- Checked in `node:sqlite` (Node 22, SQLite 3.51) that a `BEFORE DELETE` trigger on `tree_nodes` marks inbox items of a deleted folder and its deleted child before the foreign key action sets `folder_id` to NULL.

## Commands run

- `pnpm typecheck`: pass.
- `pnpm test`: pass (the run before the changes passed as well).
- `pnpm e2e`: pass, run during the step and again after the last change.
- `docs/parity.md` is unchanged; the parity test in `appModules.test.ts` passes.

## What took long

- zod optional keys against `exactOptionalPropertyTypes`: the schemas no longer claim to satisfy the interfaces, and parsed values are cast once at the store boundary.
- The order of bus handlers: a typed handler runs before `onAny`, so a nested emit shows first to an `onAny` listener. The stub test compares the event set.

## Not done

- No real-Claude run; nothing in this step needs one.
- `Desktop` was run only in its quiet mode under the hidden e2e runs; real notifications and the dock badge were not shown.
- The relayed user request asks for a commit of the README changes. This step forbids commits, so none was made; `git status` at the start showed no uncommitted README change.
