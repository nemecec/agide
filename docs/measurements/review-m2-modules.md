# review-m2-modules

Start: 2026-11-17 17:57:47 UTC
End: 2026-11-17 18:06 UTC

Independent review of `src/core/profile`, `src/core/isolation`, `src/core/blocks`, `src/core/inbox`, the layout core they feed, and the main modules `profile.ts`, `layout.ts` and `inbox.ts`.

Work:

- Ran `pnpm typecheck` and `pnpm coverage`. Both pass.
- Ran mutation checks with a helper script outside the repository. The script changes one line, runs the matching tests and puts the file back. A test failed for each of these mutations: staleness check, file and directory modes, schema strictness, the unknown-profile filter, the owner check, the catch-up policies, the scheduler transaction and the zone conversion. No test failed for these mutations: the 60 second timer cap, the re-enable path of a schedule, the active-tab check of a layout and the `chmod` of an existing directory.
- Ran a temporary probe test, then deleted it. The probes confirmed five bugs: a re-enabled schedule posts "missed" items for the time it was disabled; an every-minute rule takes about a second for each tick after a month; a UI apply overwrites an invalid layout file that the user is editing; a task due at the repeated autumn hour gets its reminder an hour early; and editing a task after its due time and before the tick drops the reminder.
- In two of three plain runs, `appModules.test.ts` "revokes the grant when the session closes" failed when it ran with the other module and core tests.

Not finished: no end-to-end run and no real-Claude run. The renderer components were not reviewed.
