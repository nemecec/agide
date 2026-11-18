# fix (milestone 3 review findings)

Start: 2026-11-18 00:27 UTC. End: 2026-11-18 01:07 UTC.

## Built

Every blocker and major finding and most minor ones were fixed with tests; the contract changes are in 0029 under "Changes after review".

- Tasks: pull request guidance read from the base branch; agent cap counts starts in progress; failed start deletes branch and source directory; trust watches cleared on dispose; trust dialog of a user-picked folder is handed to the user (test).
- Shell inspector: parser and classifier gaps from the review, each as an inspector test.
- Browser: navigation grants separate from acting grants; origin recheck after the approval wait; navigate without a tab gets a tab and an answerable inbox item; dismissing the item denies; pending requests end with their session; Stop agent per tab; URLs and console masked; blocked paths normalised; field names passed as data; request policy for agent tabs under srt; allowlist consent limited to hosts of no signed-in service; open in Chrome asks; partition storage check; view eviction, attach and destroy fixes; native views hidden behind stills while dialogs, menus and popovers are open.
- Main: events only to app-page windows; DevTools off in packaged builds; setup login directory outside the app root.
- Isolation: srt denyWrite for Claude configuration entries; container hook declared unavailable, `--mount` with read-only gh directory; bypass refused without an inspector.
- Usage: per-class maximum per message; no borrowed model for subagents.
- Inspector record is a file, sweep handles directories; PTY tests get a longer timeout; `e2e-real-claude.mjs` clicks the new-session dialog button (the script now passes).

## Not fixed, with reasons

- A mutation run was not repeated for every new test; each test was written against the described failure, and the pull-request guidance, cap and cleanup tests were not run against the old code.
- srt's own mandatory deny list was not checked (srt is not installed here). `.claude.json` stays writable because the CLI needs it.
- The session peek takes no view hold: it sits in a pane.
- A session-close test uses `session.exited`; a `session.closed` emit in the module graph leaves the client call hanging.
- The real-Claude browser and srt scripts other than `e2e-real-claude.mjs` were not rerun.

## Results

typecheck clean; coverage: all test files and tests pass, thresholds met; build ok; e2e all pass; parity ok.
