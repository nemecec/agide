# Review of the e2e title race fix

Start: 2026-11-21 13:55:17 UTC
End: 2026-11-21 14:03:15 UTC

Scope: the uncommitted change to `app/e2e/browser.spec.ts` that lets `openLeaf` and `item` take a RegExp and adds `fixtureTab()`.

## What was run

All runs used hidden windows and wrote their output outside the repository. Scratch spec copies were created next to the real spec and deleted afterwards. The real spec was not edited, and it matched a backup byte for byte at the end.

1. The spec from the last commit, with one line added to the "blocks navigation to a disallowed scheme" test that waits until the tree row is named "Fixture page" before the click. The click by host name failed with the same message as CI: it waited for a tree item named `127.0.0.1` and never found one. The page snapshot of the failure shows the row named "Fixture page".
2. The working tree spec with the same added line. The test passed in 2.3 seconds.
3. The seven tests that use `fixtureTab()`, with the row already renamed before the click. All seven passed.
4. The same seven tests with a fixture server that answers after 2.5 seconds, so the row is still named by the host at the click. All seven passed. The old helper also passes in this setting, which shows the host name branch was the one that ran.
5. The whole unmodified `browser.spec.ts`: 13 tests passed.
6. The node typecheck project (`tsc -p tsconfig.node.json --noEmit`) reported no errors.

## Findings

The race is real and the change fixes it. Each of the seven tests has one tab row at the time of the click, plus folder rows named "Work" or "Other", so the regexp matches one row. The two `New tab` rows belong to tabs that are never loaded, so their names do not change. Tabs renamed by the user (`Fixture tab`, `Docs`) keep their names. The two other places that click a loaded tab by name, one in `milestone3.spec.ts` and one in the visual check scripts, already use a regexp that accepts both names.

The regexp is `^(127\.0\.0\.1|Fixture page)$`. It matches the host and the title, and rejects the folder names, `New tab`, a title with a suffix and a host with a port. Only the dot is escaped, which is enough for the fixed IPv4 host of the test server. Playwright ignores `exact: true` when the name is a RegExp.
