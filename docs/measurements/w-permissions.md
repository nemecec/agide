# w-permissions

Start: 2026-11-17T22:11Z
End: 2026-11-17T22:51Z

## Built

- Permission mode per profile and per session. `src/core/permissions/modeRules.ts` resolves the mode: the new-session choice, then the test override `AGIDE_PERMISSION_MODE`, then the profile default (auto without saved settings). Bypass is refused unless the provider reports an enforced filesystem and a process-wide allowlist, and then needs the confirmation; a session cannot start looser than its caller. The `local` provider never qualifies.
- `classTable.ts` (the table of 0028 section 2 with the connector tool lists and ask rules), `policyBuilder.ts` (ask and deny rules by class mode, sandbox settings with `strictAllowlist`, the HTTPS GitHub rewrite as `GIT_CONFIG_*`, the gate file content, the network policy), `launchContributor.ts` (writes `gate.json`, adds rules, sandbox and the inspector `PreToolUse` hook with timeout 10, replaces the base hook).
- Inspector: `shell/parse.ts` (quotes, escapes, substitutions, backticks, process substitution, heredocs, redirections, dynamic words), `shell/classify.ts` (wrappers, git options and aliases, gh including `gh api` methods, fields and GraphQL mutations, curl and wget write flags, publishers, ssh family, `sh -c`, `find -exec`), `inspector.ts` (tool-level classification, strictest class, hard floor for force pushes, deny under bypass), `gateRun.ts` and `inspectEntry.ts` (the script). It never answers allow. The build config has a second main entry, `out/main/inspect.js`.
- Inbox: `HookItemMapper` handles `PreToolUse` records with `agide_gate`: `gate:deny` status items, `gate:notify` low-urgency items coalesced per class, the class and audience on approval cards, `gate:sandbox` items from `<sandbox_violations>`.
- UI and persistence: `PermissionsSection` in the settings panel (default mode with a sentence per mode, sandbox and host lists, folder trust, class modes, the statement that agents run as the user), `NewSessionDialog` (title, directory, mode, bypass only when offered), a sentence in the setup pane. Commands `permissions_options` and `permissions_set` (not MCP tools: an agent does not change its own limits); the settings are stored in the profile's `settings.json`.
- Tests: Vitest for the parser, the inspector (many bypass attempts: quoting, variables, subshells, wrappers, option placement, `sh -c`, brace and glob words), policy per mode and class (contract suites now unskipped), mode rules and bypass, launch contribution, the mapper, the settings UI. Playwright `e2e/permissions.spec.ts` with a fake claude (`src/core/permissions/fixtures/fake-claude-gate.mjs`): the mode in the dialog and in the profile changes `--permission-mode`, launch carries rules, hook and sandbox, a denial reaches the inbox, a push asks and a read leaves the decision open.
- Mutation checks, each failed a test and was reverted: no split at `;`, no handling of `-c` git options, no skipping of the `-C` value, a widened read prefix list, `ask` turned into no decision, no deny under bypass.
- Real CLI 2.1.326 (Haiku, auto mode, local bare origin, empty temporary directory): `scripts/real-claude-gate.mjs`. `git push origin HEAD` was blocked (static ask rule, unanswered in `-p`), `git -C . push origin HEAD` was blocked with the inspector's reason, `git status` ran. Nothing reached the origin. Cost under 0.02 USD for the three runs.

## Measurements

- Inspector start as Node through the Electron binary: about 70 ms per call (five runs 0.07 to 0.08 s). Below the 300 ms limit of 0028, so the `http` transport is not needed.

## Edits outside the owned files

- `src/main/modules/permissions.ts` is new content; the session module is unchanged. `electron.vite.config.ts` gained the second main entry. `e2e/integration.spec.ts` clicks Start in the dialog. `appModules.test.ts` and `m3Modules.test.ts`: the bypass and default-mode expectations changed. `docs/parity.md` was regenerated for the two new commands. The README gained a Permissions section.
- Without `inspect.js` beside the main bundle (unit tests run the sources) the contributor logs a warning and omits the hook; the rules still apply.

## Not finished

- Q1, Q2 and Q4 to Q7 of 0028 were not probed. The static ask rules stay for every draft and approve class because of Q1.
- Session header (mode reported by the payloads, mode change by restart) and `setPermissionMode` from payloads: needs a seam to the session service from the permissions module, which initializes before it.
- `LocalProvider.capabilities.network` stays `none` with the sandbox on; the provider file belongs to another builder. `permissionOptions` decides the bypass offer from the provider id; the launch check uses the real capabilities.
- Draft editing, own-branch notify, per-server overrides, the sandbox block actions and the project policy file wait as 0028 lists.
- Failures seen in the full runs that are not in this slice: usage tests (`src/core/usage`), the agents event in `m3Modules.test.ts`, type errors in `isolation` and `agents` test files, and one tree rename end-to-end test that passed on rerun.
