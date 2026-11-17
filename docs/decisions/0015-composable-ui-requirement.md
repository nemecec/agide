# 0015 Composable, user-assembled UI

Status: proposed (requirement stated by the user; weight and design await confirmation)
Date: 2026-11-17
Decided by: Neeme (idea); the design direction is an agent proposal
Amends: 0002, 0008 (adds R20)

## Context

The user wants the GUI to be highly configurable: users assemble their own UI from building blocks to fit their workflow, agents help build and change the UI, the blocks and the way they talk to each other are defined, a way to assemble them exists, pre-assembled examples ship with the tool, and users can add their own blocks.

The records already hold the substrate: the surface interface and the single command registry (0006), the typed event bus and module contracts (0013), and the app's MCP server with UI parity (0004, 0006). Claude Code mods (https://code.claude.com/docs/en/plugins/mods/overview) are prior art for agent-written interface extensions: event handlers inside the host, a listing of a mod's hooks and calls before install, a skill that has Claude write a mod, distribution as plugins through marketplaces, and no sandbox.

## Decision

- R20 Composable UI. Weight 3 is proposed.
  - The building block kinds are few and defined: surface types, panes, commands, data sources and policies.
  - Blocks communicate through three channels only: the command registry, the typed event bus, and a shared context (current node, selected object). Each block declares in a manifest the commands it provides, the events it emits and consumes, and the context it reads.
  - A declarative, versioned layout file assembles panes, block references, properties and bindings. Direct manipulation in the UI writes the same file.
  - Pre-assembled layouts ship as examples. Users add blocks as compositions and templates without code, or as code blocks in a sandboxed webview with a declared permission manifest.
  - The agent assists through tools on the app's MCP server: block and layout listing, validation, applying a layout with a diff and undo, and scaffolding a block. It can capture the app window to check its result.
  - Agent-written code blocks go through the review ladder of 0010; declarative changes follow the policy's lower rungs.
- First-party features (tree, terminal, browser, review views, agent roster) are built as blocks, so the block API is exercised from the start.

## Consequences

- Milestone 1 keeps its fixed two-pane layout. Milestone 2 starts with the block model and layout format in a design record before the browser surface and review views.
- The greenfield estimate grows. A rough guess is 15 to 25 working days, partly replacing surface plumbing already estimated; low confidence until the design record exists.
- The base decision is unchanged: the greenfield base was chosen for the same reason, a fork's core would have to carry this model.
- Open questions for the design record: block API stability and layout migrations, sandbox and permission model for code blocks, whether blocks can ship as Claude plugins and reuse the marketplace (R7), and how the shared context relates to observation scoping (R13).
