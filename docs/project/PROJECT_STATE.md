# FORGE Project State

---

Document Authority:
C — Status/Snapshot

Owner:
Milestone Owner

Source of Truth:
Git state, commit-matched CI evidence, executable code and tests, completed
milestone records, and root `TECH_DEBT.md`

Refresh Trigger:
A major milestone completes or repository, validation, blocker, or strategic
priority state changes materially

Last Verified:
2026-07-29

---

This is a dated orientation snapshot, not an authority. Verify every volatile
claim against Git, CI, code, tests, migrations, and the on-disk
[`TECH_DEBT.md`](../../TECH_DEBT.md) before acting on it.

## Snapshot

| Item | Verified state |
|---|---|
| Repository | `github.com/rkasthuri/forge-framework` |
| Branch | `main` |
| Stabilization HEAD | `3a1022f35992378d96cb273452042c5585f98ccc` |
| Remote relationship | Stabilization HEAD matched `origin/main` when this snapshot was verified |
| Current phase | Stabilization and product-readiness preparation |
| Canonical UI | `forge ui` / `forgeUI.bat` → `forge-ui` |
| Technical-debt authority | Root `TECH_DEBT.md` |

Documentation truth-foundation work is present in the working tree and is not
yet committed. Pre-existing local image changes remain separate. Run
`git status`, `git diff`, and `git diff --cached` before using this paragraph as
current repository evidence.

## Stabilization Milestone

The pushed stabilization milestone contains:

| Area | State | Evidence |
|---|---|---|
| CI missing-evidence enforcement | Completed | `aaab02e` — current-run evidence is required; missing, stale, malformed, unhealthy, or unavailable evidence fails closed |
| TD-184A durable recovery provenance | Completed | `ee504ed` — Migration 018 and paired nullable recovery provenance |
| Legacy platform retirement | Completed | `5e1df13` — legacy launch commands and direct server execution fail closed |
| TD-184B guarded recovery | Completed | `97ae96b` — inspection, guarded execution, focused tests, and explicit disposable rehearsal |
| Local-only server boundary | Completed | `3a1022f` — loopback binding and local browser-origin enforcement |

The canonical UI remains `forge-ui`. The retired monolithic legacy platform
server is retained only for history and cannot be used as an alternate launch
path.

## Validated Baseline

The following is milestone evidence, not a permanent count:

| Gate | Stabilization evidence |
|---|---|
| Automated unit suite | 684/684 passing at the stabilization milestone |
| Root/eval TypeScript | Passing |
| forge-ui TypeScript | Passing locally |
| E2E AI Testing Pipeline | Run `30492630035` completed successfully |
| CI tested SHA | `3a1022f35992378d96cb273452042c5585f98ccc` |
| Current-run evidence checks | Passed in the milestone workflow |

The CI run is available at
[GitHub Actions run 30492630035](https://github.com/rkasthuri/forge-framework/actions/runs/30492630035).
Re-run applicable validation for a later source state; do not copy these results
forward.

## Current Architecture Boundaries

- The App Model remains the application-state authority defined by ADR-001.
- SQLite repositories retain persistence ownership; guarded recovery does not
  introduce a parallel writer.
- Migration 018 records recovery source row identity and fingerprint as a paired
  nullable contract.
- Invalid stored JSON remains raw evidence and is not returned as a valid
  App Model.
- Guarded recovery requires explicit acknowledgement and matching provenance.
- The TD-184B SauceDemo rehearsal is explicit, disposable, and outside normal
  unit discovery.
- CI reporting evidence must match `CURRENT_RUN_ID`.
- FORGE development servers enforce local-only binding and browser-origin
  boundaries; remote mode is unsupported.

Refer to the applicable ADRs, implementation, migrations, and tests for binding
details. This snapshot does not create architecture.

## Active Work

### Documentation truth modernization

Active:

- establish navigation and authority metadata;
- align high-value operational and onboarding documents with executable truth;
- refresh milestone and state snapshots; and
- preserve historical documents without treating them as current guidance.

Remaining documentation work should update or consolidate stale architecture
maps, limitations, roadmap, testing strategy, glossary, and handover material
under separately approved scope.

### Product and UI readiness

Planned or remaining:

- TD-UI-062 UI parity/completion work;
- product-facing validation of remaining forge-ui surfaces;
- clear capability/non-capability communication; and
- production-readiness review after the documentation and UI truth gaps close.

### Technical debt

Open and deferred work remains. Root
[`TECH_DEBT.md`](../../TECH_DEBT.md), not this snapshot or a summary document,
owns TD status and priority.

## Next Verification

At the next major milestone:

1. Re-read Git status, HEAD, branch divergence, and recent commits.
2. Run the applicable typechecks, unit suite, focused tests, and validation
   profile.
3. Confirm CI against the exact intended SHA and inspect the reporting decision.
4. Verify storage and App Model preservation where relevant.
5. Reconcile active and completed work against root `TECH_DEBT.md`.
6. Update this snapshot with evidence from that source state.
