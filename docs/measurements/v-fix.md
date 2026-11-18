# v-fix

Start: 2026-11-18T06:54:56Z. End: 2026-11-18T08:19:30Z.

Work: fixed the defects of the independent review that sit in the renderer, styles, copy and small behaviour. New behaviour has unit tests (`DialogFrame`, `orderItems`, tally, profile identity, approval bar, observation badge, context menu clamp, tab title numbering, leaf title following the page title) and one Playwright spec (`e2e/onscreenFixes.spec.ts`). Ran `pnpm visual-check --hidden` again and opened the after screenshots; the table is in `notes/onscreen-check.md` under "Fixes".

Scripts changed to follow renamed labels: `visual-check` phases, `e2e-real-claude*.mjs`, e2e specs (menu entry "New Claude session…", tab titles, tree leaf title).

Gates: typecheck, coverage, build, parity pass. The full `pnpm e2e` ran once with failures (a session start click in `permissions.spec.ts` and a window that did not appear in `profiles.spec.ts`) during a slow run; both files pass when run again on their own.

Disk: free space stayed above 5 GiB. Removed the intermediate visual-check directories this run created; the directory of the final run is kept for comparison.
