# p-iso: isolation probes I1 to I3

Start: 2026-11-17T20:27Z. End: 2026-11-17T20:56Z (date -u).

Built: `probes/p16_srt.py` (real claude in a PTY under srt), `probes/p17_container.py` and `probes/p17_container_lib.py` (fake claude in Docker on alpine through a PTY), `probes/p18_openshell.py` (fake claude in an OpenShell sandbox), `probes/fixtures/fake_claude.sh`, `probes/fixtures/hook_events.sh`, `probes/hooks/srt_claude.sh`; `--allow-host` and `--bind` options for `probes/mcp_host.mjs`. Results are in `notes/probes-m3-isolation.md` and `probes/RESULTS.md`.

What took long: finding why the TUI ignored Enter under srt (`allowPty`), why the loopback MCP server failed (`allowLocalBinding`), and the OpenShell gateway start (user-auth choice, launch signing, Docker Desktop host-network mode, a CLI argument quirk). The fake claude needed a fix for interrupted reads in busybox ash.

Not finished: the real claude inside a container or an OpenShell sandbox (no Linux build, no login inside a test environment); the Keychain read of the Claude credential item from inside srt (deliberately not attempted). The deletion of the Claude project directories created by the srt runs was denied; they remain in the configuration directory, with folder-trust entries.
