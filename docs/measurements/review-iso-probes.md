# review-iso-probes: review of the isolation probes I1 to I3

Start: 2026-11-17T20:54Z. End: 2026-11-17T21:03Z (date -u).

Work: read `notes/probes-m3-isolation.md`, the milestone 3 section of `probes/RESULTS.md`, the probe scripts and the reports in `probes/out/`. Checked the host against the recorded installs and removals (srt 0.0.83 prefix, no OpenShell binaries, configuration, images, containers, volumes or networks left, the Claude project directories named in the notes). Re-ran I2 (`p17_container.py`, output in `probes/out/m3-review/`), the Host header refusal of `mcp_host.mjs` from a container, and the srt filesystem, proxy and latency checks with a shell command. Read the srt 0.0.83 README and source in the kept prefix and the OpenShell 0.1.9 source archive (installer, Docker driver, gateway auth check, provider profile, policy schema docs).

Changes: Docker Desktop version corrected; the pnpm content store entries for srt added to the host changes; the scripted network policy result of I3 separated from the unlogged manual step; manual steps marked as such; the srt loopback explanation and Keychain source reference added; counts removed from prose; the fake claude README corrected.

What took long: telling the scripted evidence from manual steps in I3. Not finished: the reviewer's temporary directory under `/tmp/agide-review-m3` (OpenShell source archive, about 57 MB) remains because its removal was denied.
