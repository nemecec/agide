# d-blocks-design

Start: 2026-11-17 15:05:30 UTC
End: 2026-11-17 15:10:02 UTC

## What was built

- `docs/decisions/0020-block-model-and-layout-design.md`: block kinds and manifest sketch, the communication channels and how the shared context relates to observation scoping (R13) and the inbox (R21), the layout file format with the "Session" and "Pair" presets, the layout engine choice (dockview, MIT, FlexLayout as fallback), versioning and migrations, user blocks in a declarative tier and a code tier, packaging as Claude plugins with an Agide sidecar, security of third-party blocks, the agent tools and their review rungs, and the first milestone 2 slice with what waits.

## Inputs read

0006, 0010, 0012, 0013, 0014, 0015, 0016, 0017, 0018, 0019, parts of 0004 and 0009, `notes/blocks-prior-art.md`, and the command, event bus and surface types in `app/src/core`.

## What took long

- Deciding where the authoritative layout description lives. The survey proposed the engine's serialization as an opaque field; the record keeps Agide's own arrangement tree as the source of truth and the engine state as a cache, because the agent writes layouts.
- Choosing the default sandbox tier: the record uses the iframe tier for blocks that passed the user's own review ladder and a `WebContentsView` for blocks from other marketplaces, because only the latter gives the main process a sender identity that a compromised app renderer cannot forge.

## What could not be finished

- Nothing was built or run: no layout engine install, no plugin install, no capture test. The unverified items are listed at the end of 0020.
