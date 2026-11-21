# 0003 Model tiering and reuse of existing work

Status: accepted
Date: 2026-11-17
Decided by: Neeme

## Context

The spike runs many agents. Token cost should follow the difficulty of each task.

## Decision

- Mechanical work (cloning, collecting metadata, writing files from existing logs) uses a small model at low effort.
- Reading code and research uses a mid-tier model at medium effort.
- Reviews of findings and the review of the decision records use the most capable models at high effort. Reviewers are independent agents that see the report and sources and do not see how the work was done. A reviewer from a different model family cross-checks the decision records.
- Decision-record writing uses a capable model at medium effort, since the inputs are already verified.
- Every piece of work gets an independent review by a different agent (decided by the user on 2026-11-21): probes, designs, contracts, builders' code, integration, quality passes, fixes and the written records. A fix step is reviewed like any other work, and a second fix pass follows when that review finds a blocker or a major problem. The author of the work does not review it.
- Work already on disk is reused. A stopped run's notes, reports and reviews are inputs to the next run; agents extend them and verify what the decision depends on, and do not redo them.
- Probe calls to the Claude CLI use the small model and a per-call budget cap.

## Consequences

- A change in requirements triggers an incremental pass over existing notes, not a full rerun.
- Review cost is the largest share of spend by design.
