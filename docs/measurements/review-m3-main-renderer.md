# Review: milestone 3 main process, preload, renderer and end-to-end tests

Start: 2026-11-18T00:12:31Z
End: 2026-11-18T00:22:30Z

Independent review of `app/src/main` (modules, window and view placement, IPC, profile launcher), `app/src/preload`, the milestone 3 renderer parts (browser pane, new-task dialog, usage pane, agent nodes, setup pane, layout host with native views) and the end-to-end tests.

Work:

- Read the view registry, guards, partitions, IPC policy, preload, the browser, session, tasks, agents and permissions modules, the browser pane with its drag suspension, the dialog host, the setup pane, the trust automation and the milestone 3 e2e spec, and compared the view stacking with 0026 section 1.
- Ran `pnpm typecheck` (clean), `pnpm test` twice and `pnpm e2e` once (all e2e tests passed with hidden windows).
- Confirmed two findings with throwaway vitest probes over the real module graph, removed afterwards: an agent `navigate` with no tab posts no inbox item and shows no question, and the setup pane's login directory is refused by `session_create`.

What took long: each `pnpm test` run had one failure, a different test each time. Other review agents were editing and restoring source files in the same tree during the run (mutation probes). The failing tests passed when run alone.

Not done: no real-Claude run and no visible-window check of view stacking. The IPC broadcast to sign-in pop-ups was found by reading the code; no Electron run checked it.
