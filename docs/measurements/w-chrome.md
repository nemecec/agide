# w-chrome: title bar and profile identity (0035 step 3)

Start: 2026-11-20 23:55 UTC. End: 2026-11-21 00:25 UTC.

## Built

- `main/window.ts`: `titleBarStyle: 'hiddenInset'` and `trafficLightPosition` { x: 14, y: 13 } (exported as `TRAFFIC_LIGHT_POSITION`).
- `layout/TitleBar.tsx` (new): one 38 px row in `surface.window` with a 2 px bottom border in the profile mark colour and no tint. It holds the profile identity (the trigger of the setup popover), the layout switcher (quiet Button and Menu of the presets), the usage meter, the inbox IconButton with the unread Badge, and the settings IconButton. The bar drags; buttons and the meter do not. Full screen drops the 80 px inset for the lights.
- `layout/UsageMeter.tsx`, `meterModel.ts`, `useUnread.ts`, `useFullScreen.ts`, `inboxInstance.ts` (new) with tests.
- `panes/ProfileIdentity.tsx` (new): tile and name; a temporary profile shows the dashed tile and a "Temporary" chip with the tooltip "This profile is not saved".
- `panes/ProfileTile.tsx` (new), `core/theme/profileColour.ts` (new): tile colour darkened until the white letter reaches 4.5 to 1, mark colour moved until 3 to 1 against `surface.window`. The unit test checks the values of the table in 0035 section 1.8.
- `panes/ProfileRail.tsx` and `.css`: 32 px tiles, a 4 by 20 px current bar, Badge dots and counts, Tooltip and `aria-label` with name, state and unread count, Popover with `NewProfileForm` on the plus tile. A temporary profile shows its dashed tile alone.
- `panes/NewProfileForm.tsx`, `panes/SetupPane.tsx` (now a Card in a Popover anchored to the profile identity; opens by itself while setup is needed, closes with Later or Escape).
- `ProfileStrip.tsx` and the Layout bar are removed. `PlanUsage` is no longer mounted (see open items).
- `scripts/colour-literal-allowlist.json`: `NewProfileForm.tsx` and `ProfileRail.css` removed.
- Tests: new and updated unit tests for the identity, rail, new profile form, setup card, title bar, meter model, inbox lookup and colours; new `e2e/titleBar.spec.ts`; `e2e/profiles.spec.ts` and `e2e/onscreenFixes.spec.ts` read the title bar identity and the Badge count.

## Shared files touched

`layout/LayoutHost.tsx` (mounts `TitleBar`, removes the strip and Layout bar, hands the dock API ref to the inbox button), `App.tsx` (mounts `TooltipProvider`, drops the floating `SetupPane`), the two e2e specs above.

## Results

- `pnpm typecheck`: the web project passes. The node project fails in `core/theme/vscode/clamp.ts` (w-import, not mine).
- `pnpm coverage`: all test files pass; the run exits 1 on the `src/core/**` thresholds because `core/theme/vscode` has no tests yet (w-import).
- `pnpm e2e`: all pass; the title bar spec and the two edited specs pass again after the last CSS change.
- `pnpm visual-check --hidden`: every phase ok, written under `agide-restyle-stage-b`.
- `pnpm check:colours` passes with the shrunk allowlist.

## What the screenshots show

Populated session window: the 38 px bar shows the profile tile and name, the Session switcher, "5 h 1%", the inbox with a red count and the gear. The border under the bar is the profile colour (blue for the default profile, green for Work). The rail shows 32 px tiles with a green running dot, a red unread count and a white current bar at the left edge. The Temporary profile shows a dashed tile, "Default" and a Temporary chip, and a dashed tile in the rail. The setup card opens under the identity with the title, both steps, fields and Later.

## Open items

- The traffic light offsets cannot be checked: hidden windows are captured from the page, which does not contain the native lights. 14 and 13 are unverified, as is double-click zoom of the drag region.
- "Edit layout file" is not in the layout menu: no command reveals or opens the layout file. A command under the parity rule is needed first.
- `PlanUsage` and its tests in `agentsPanes.test.ts` are unused by the shell; remove them in the integration step.
- The rail pane is about 100 px wide in the Session preset (preset width, not set by this task); 0035 asks for 52 px.
- The setup popover opens over the tree at start and closes on any press outside it.
- A run of `pnpm visual-check --only profiles` alone timed out waiting for the tree; the full run passes. Not investigated.
- Temporary files: none left; `agide-restyle-stage-b` under the OS temporary directory holds the screenshots on purpose.
