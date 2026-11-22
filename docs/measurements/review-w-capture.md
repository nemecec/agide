# review:w-capture

Start: 2026-11-21T16:43:53Z (`date -u`). End: 2026-11-21T16:54:22Z.

## What was done

Independent review of the w-capture slice (`app/src/core/review/capture`, `rules`, `policy`, `toolCommand` in `app/src/core/isolation`) against 0010, 0040 and 0041. No product code or test was changed.

- Ran the slice tests: all pass (the skips are the runtime-dependent isolation tests).
- Ran probe tests from a scratch directory under `/tmp` against the slice modules. Confirmed: a capture after a merge falls back to the swarm base once a later unmerged changeset exists; a base policy can lower its own `policy.base_differs` reason to A; a `package.json` hunk that changes `"test": "jest"` to `"test": "true"` without its `scripts` opener in view gives no reason; the user overlay can lower a default rung for an id the project policy does not name; `acceptRepoChange` drops a moved branch together with the accepted configuration change; the check output tail loses most of the output when the output is just over the kept head.
- Ran mutation checks one at a time with a script that copied each file first and restored it afterwards; every restored file compared identical (`filecmp`, and a checksum list of the slice files taken before and after). Survivors: the repository comparison moved after `add -A`, and the check that a worktree `.git` file points into `<common>/worktrees`. The other mutations were killed.

## What took long

Reading 0040 sections 4 to 8 and 17 against the code, and the mutation run.

## Not done

- No real `srt` or container run of a check.
- No review of w-manager's use of these services (the classes are not wired yet).

## Cleanup

Scratch files under `/tmp/agide-review-w-capture/` were removed at the end.
