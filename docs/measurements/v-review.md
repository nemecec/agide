# v-review

Start: 2026-11-18T06:45:03Z. End: 2026-11-18T06:52:19Z.

Work: independent visual review of the screenshots from the on-screen check (`$TMPDIR/agide-visual-4zqSBi/shots`) and of `docs/images/agide-overview.png`. Grouped identical files by checksum, opened every distinct PNG with the image reader and wrote a defect list before reading `notes/onscreen-check.md`. Then compared the two lists and read `focus-order.json`, `sources.json` and `ProfileStrip.tsx` to explain the dialog focus order and the missing profile strip. No app instance was started, no code or notes were changed, and no temporary files were created.

Findings in short: the capture list is confirmed with corrections. The review adds defects the capture missed. The main ones are that the approval card in the inbox offers Done but no answer, that an approval loses its unread marker once viewed, that unread items sink to the bottom of the list, that the failed agent is counted as "finished" in the session tally, that the live observation state looks almost the same as on demand, and that the profile strip and rail are missing in most captures. The capture also has gaps: some files that should show different states are identical, the scroll and many-node states never scroll, and the provider-missing capture shows the claude error and not the srt state.

Free disk stayed above 5 GiB.
