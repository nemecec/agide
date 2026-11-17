# Agide

Agide is a desktop tool for agentic coding on macOS. A tree of folders holds Claude sessions today, and browser tabs, Slack threads and other surfaces later. The app hosts an MCP server, so an agent can do what the UI does, and the UI is meant to show what agents are doing and when they need the user.

## Status

Early prototype. These parts work:

- The tree (nested folders, drag and drop, persistence).
- Claude sessions in a terminal with resume, launched through an isolation provider that runs `claude` on the host.
- The app MCP server with a UI and MCP parity check.
- A window built from a layout file that the user or an agent edits, with presets, undo and window capture.
- An inbox of items from Claude hooks and from agents, with notifications, a dock badge, tasks and recurring reminders.
- Profiles that run side by side, each with its own data, Claude login and tool credentials, with a switcher rail and unread badges.

Swarm and usage views, layered review, browser and Slack surfaces, task start from a PR or ticket, user-written blocks and isolation providers other than the host are designed in the decision records and not built yet. Nothing has been checked on screen; the tests run the app with a hidden window. `docs/decisions/0014-milestone-1-results.md` and `docs/decisions/0024-milestone-2-results.md` list what exists and what was verified.

Continuous integration runs the typecheck, the unit tests with coverage thresholds, the end-to-end tests and the UI and MCP parity check on every pull request and on every push to `main`.

## Repository

| Path | Content |
|---|---|
| `app/` | The Electron application. `app/README.md` covers install, run and tests. |
| `docs/` | Decision records, the spike plan and an index (`docs/README.md`). |
| `notes/` | Research and review notes behind the records. |
| `probes/` | Scripts that test how the `claude` CLI behaves, and their results. |

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
