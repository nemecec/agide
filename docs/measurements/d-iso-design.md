# d-iso-design

Start: 2026-11-17 15:05:07 UTC
End: 2026-11-17 15:10:27 UTC

## Work

Wrote `docs/decisions/0022-profiles-and-isolation-design.md` (status proposed) from the survey in `notes/profiles-and-isolation.md`, records 0004, 0013, 0014, 0017, 0018 and 0019, and the session launch code in `app/src/core/session`, `app/src/main/index.ts` and `app/src/main/modules/session.ts`. The record decides the profile model and directory layout, the migration of the milestone 1 data directory into the default profile, the process model and launcher, the registry, profile creation and login, the `IsolationProvider` interface with a table of couplings per provider, the provider roadmap with OpenShell as an experimental provider, the probes, the security properties and threats, and the scope of the first milestone 2 slice.

## What took long

Reading the current launch path to find where the token enters the process arguments and where a provider has to hook in. Choosing how the default profile adopts the existing login without setting `CLAUDE_CONFIG_DIR` to the default path, which the documentation suggests could select a different Keychain entry.

## Not finished

Nothing was run, built or probed. Every probe listed in the record (E1, E2, C1 to C4, G1, D1 to D3, O1 to O7, S1 to S3) is open. No code changed.
