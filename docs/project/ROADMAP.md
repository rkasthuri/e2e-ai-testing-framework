# ROADMAP.md

---

Document Authority:
C — Status/Snapshot

Owner:
Product Owner

Source of Truth:
Approved product direction, completed commits, current milestone evidence, and
root `TECH_DEBT.md`

Refresh Trigger:
Milestone transition, capability completion, approved priority change, or
product-direction decision

Last Verified:
2026-07-30

---

This roadmap describes sequencing and status; it does not define architecture
or prove implementation. Verify shipped claims against code, tests, CI, and
commit-matched evidence. Use [PROJECT_STATE.md](PROJECT_STATE.md) for the
current snapshot and [START_HERE.md](../START_HERE.md) for authority routing.

## Current Phase

**Stabilization and product-readiness preparation**

The core evidence-first engine and the canonical forge-ui control surface are
established. The current focus is to preserve stabilization gains, complete UI
parity, and prepare product-readiness work without weakening evidence or local
security boundaries.

## Completed

- TD-184A durable recovery provenance and Migration 018.
- TD-184B guarded invalid-active recovery, focused tests, and disposable
  rehearsal.
- Legacy platform-server retirement containment; `forge ui` is canonical.
- Local-only server binding and browser-origin enforcement.
- Documentation authority foundation: `START_HERE.md`, the documentation index,
  and the authority metadata template.
- Operational truth modernization for build/run, CI, onboarding, validation,
  project state, and milestone tracking.

## Active

### TD-UI-062 and UI parity

Complete the remaining forge-ui product surfaces and align their behavior with
the established engine and validation contracts. The current work is product
readiness, not a reason to revive the retired `src/platform` server.

### Product readiness

Define and validate the gates needed for a trustworthy product-facing release:
current-run evidence, local security boundaries, UI parity, storage ownership,
and human/operator validation where required.

### Technical-debt reconciliation

Use root `TECH_DEBT.md` as the debt authority. Summaries and snapshots should be
refreshed from it rather than becoming competing status ledgers.

## Future Direction

These are future directions, not current commitments:

- broader API testing and surface coverage beyond the existing REST reference
  validation;
- an Expert FORGE Agent with evidence-bounded planning and execution; and
- cloud/SaaS readiness, including an explicitly designed remote security and
  tenancy model.

Remote access must not be inferred from local development behavior. It requires
separate architecture, authentication, tenancy, and operational decisions.

## Sequencing Principles

1. Preserve the evidence-first and fail-closed foundation before expanding
   automation or agent autonomy.
2. Complete UI parity on top of the canonical forge-ui and existing service
   ownership boundaries.
3. Validate product claims against executable evidence, not roadmap prose.
4. Treat broader API, Expert Agent, and cloud/SaaS work as future until their
   scope and gates are approved.

## Status Vocabulary

- **Completed:** implemented and supported by the required evidence for its
  milestone.
- **Active:** approved work currently being pursued.
- **Future:** directional work not yet committed to the current milestone.

The roadmap intentionally avoids permanent test counts and detailed TD status;
those belong to validation evidence and the technical-debt authority.
