# Agide

Agide is a desktop tool for agentic coding on macOS. A tree of folders holds Claude sessions today, and browser tabs, Slack threads and other surfaces later. The app hosts an MCP server, so an agent can do what the UI does, and the UI is meant to show what agents are doing and when they need the user.

## Status

Early prototype. Today the tree (nested folders, drag and drop, persistence), Claude sessions in a terminal with resume, and the app MCP server with a UI and MCP parity check work. The inbox, swarm and usage views, layered review, browser and Slack surfaces, profiles, isolation providers and a composable layout are designed in the decision records and not built yet. `docs/decisions/0014-milestone-1-results.md` lists what exists and what was verified.

Continuous integration runs the typecheck, the unit tests with coverage thresholds and the end-to-end tests on every push and pull request.

## Repository

| Path | Content |
|---|---|
| `app/` | The Electron application. `app/README.md` covers install, run and tests. |
| `docs/` | Decision records, the spike plan and an index (`docs/README.md`). |
| `notes/` | Research and review notes behind the records. |
| `probes/` | Scripts that test how the `claude` CLI behaves, and their results. |

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
