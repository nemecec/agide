# r-fix

Start: 2026-11-21 01:21 UTC. End: 2026-11-21 01:37 UTC.

Fixed Q-01 to Q-04, Q-06 to Q-16 (Q-07 was already mapped to octagon-x in the source; a test now guards it). Q-05 and Q-17 follow records 0027 and 0035 and are left for a decision.

What changed:
- Tree tallies are icon plus count, with the words as accessible name and tooltip; at narrow widths only the worst tally stays. Agent rows no longer repeat the state word; the outcome basis moved to the row tooltip.
- Theme rows use a secondary Use button.
- Profile identity and the temporary-profile tile take focus; the focus check starts from the top of the document.
- The agent outline is drawn on a frame around the browser slot (the slot is 2 px smaller), also while an approval is open; the approval sentence is regular weight with the session name emphasised.
- Inbox card: baseline-aligned header, JSON details as inset code, one read rule and one pair of action names ("Mark as read", "Mark as unread").
- Menus drop the icon gutter when no entry has an icon; tree and tab menu entries have icons.
- Textarea grip hidden, token bullets in isolation lists, UI font in placeholders, scroll fade with intact dividers in dialogs.
- Setup popover hierarchy with a Done chip; empty states start at 30% of the pane height; the empty inbox keeps one message; an unbound surface tab reads "No surface"; title-bar badge and tooltips keep clear of the window edge.

Checks: pnpm typecheck, pnpm coverage twice, pnpm build, pnpm e2e and pnpm parity passed. pnpm visual-check ran hidden into agide-restyle-final and the screenshots for each fix were opened.

What took long: the visual-check run. Not finished: the tree empty state still sits at the top because the tree root has no fixed height; the dock tab accessible name still says "Surface host" in the focus trace.

Temporary files: /tmp/agide-restyle-final, /tmp/agide-final-vc.log, /tmp/rfix-*.log, /tmp/rfix-start.txt. Removal of the screenshot directory was denied by the sandbox, so they remain.
