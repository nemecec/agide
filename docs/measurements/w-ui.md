# w-ui: primitives and shared components (0035 step 2)

Start: 2026-11-20 23:04 UTC. End: about 2026-11-20 23:50 UTC (the machine was under heavy load for part of the run).

## Built

- `radix-ui` 1.8.1 and `lucide-react` 1.77.0 added. Neither package has an install script, so the pnpm allowlist is unchanged. pnpm added `lucide-react@1.77.0` to `minimumReleaseAgeExclude` in `app/pnpm-workspace.yaml` because the release is younger than the age gate.
- `app/src/renderer/ui/`: Button, IconButton, Chip and StatusChip, Badge, Field with TextField and TextArea, Hint, Select, Checkbox, RadioGroup, Switch, SegmentedControl, Tabs, Disclosure, Table, Card, Dialog, Menu, Popover, Tooltip, Banner, Notice, EmptyState, Toolbar, Icon, `icons.ts`, one stylesheet per component, all against `--agide-*` tokens. Radix portals render into `#agide-overlays`, created by `overlayRoot()`.
- `DialogFrame` and `DialogHost` on Radix Dialog. Escape presses the element marked `data-dialog-cancel`, as before.
- `ContextMenu.tsx` on Radix DropdownMenu anchored at the pointer; the browser tab menu on `Menu`.
- New session, new task and settings dialogs, the permissions and isolation sections and the trust banner use the components.
- NOTICE entry for Lucide and the Feather MIT notice.

## What took long

Radix Select in jsdom needs polyfills (`testing/polyfills.ts`). Radix Dialog does not return focus without a trigger, so `DialogContent` restores it. A context menu closed when the tree moved focus, so the menu ignores focus-outside.

## Not finished or open

- `styles.css` still holds `.btn-primary`, `.chip` and `.muted`, which other panes use until step 4.
- Tooltips work without a provider; mounting `TooltipProvider` at the app root is left to step 3.
- Secondary buttons keep `shadow.1` in dark themes too.
- The tree has no keyboard route to open its context menu (pane work, step 4).
- `pnpm coverage` reported `src/main/**` functions at 75.68% against 76%, from main files outside this task.
- Temporary files under `/tmp` (`w-ui-shots`, `w-ui-e2e.log`) could not be removed; deletion was denied.
