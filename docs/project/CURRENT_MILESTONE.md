# Current Milestone

---

Document Authority:
C — Status/Snapshot

Owner:
Milestone Owner

Source of Truth:
Roadmap decisions, completed commits, commit-matched validation evidence, and
the current approved milestone scope

Refresh Trigger:
Milestone transition, approved scope change, gate completion, or material
blocker change

Last Verified:
2026-07-29

---

This document tracks the current milestone. It does not define architecture,
governance, or technical-debt status. Verify implementation claims against Git,
CI, code, tests, and root [`TECH_DEBT.md`](../../TECH_DEBT.md).

## Milestone

**Name:** Stabilization and Product-Readiness Preparation

**Phase:** Stabilization and product-readiness preparation

**Status:** Active

The stabilization implementation has landed and passed its milestone CI run.
The current objective is to convert that technical reality into trustworthy
operational knowledge, close documentation authority gaps, and prepare the next
product/UI work without beginning feature implementation in this milestone.

## Current Objective

Establish a documentation and validation surface that lets a human or future
FORGE Expert Agent determine:

- where to start;
- which source governs a decision or workflow;
- which behavior must be verified from executable evidence;
- which current-state claims are dated snapshots; and
- which material is historical only.

This work is documentation alignment. It must not change application behavior,
tests, CI configuration, package scripts, or architectural decisions.

## Completed Gates

### Stabilization implementation

- **CI evidence enforcement:** current-run identity is required; missing, stale,
  malformed, unhealthy, or unavailable reporting evidence fails closed.
- **TD-184A:** Migration 018 and durable paired recovery provenance shipped.
- **TD-184B:** invalid-active inspection, guarded recovery execution, repository
  persistence ownership, focused tests, and disposable rehearsal shipped.
- **Legacy platform containment:** legacy launch commands and direct server
  execution fail closed; `forge ui` is canonical.
- **Local-only boundary:** forge-ui and relevant auxiliary servers enforce
  loopback binding and local browser-origin restrictions.

### Stabilization validation

- Automated unit suite passed at the milestone's dated 684/684 baseline.
- Root/eval TypeScript passed.
- forge-ui TypeScript passed locally.
- E2E AI Testing Pipeline run `30492630035` succeeded against
  `3a1022f35992378d96cb273452042c5585f98ccc`.
- The workflow's current-run evidence evaluation and reporting-completeness
  checks passed.

These results belong to that source state. Later changes require fresh evidence.

### Documentation truth foundation

- `START_HERE.md` establishes human and AI navigation and trust order.
- `DOCUMENTATION_INDEX.md` maps authority class, owner, refresh trigger, and
  source of truth.
- The document-authority metadata template exists.
- Primary build/run and CI operational guides have been aligned with executable
  behavior.
- Codex onboarding has been reduced to role-specific operational guidance.
- The validation contract reflects Migration 018 and guarded-recovery
  ownership.
- Project-state and milestone snapshots reflect the stabilization milestone.

## Active Gates

- Validate documentation links, whitespace, scope, and preservation.
- Review the resulting documentation diff before any commit decision.

## Remaining Gates

### Documentation readiness

- Modernize remaining high-value architecture and reference maps under approved
  scope.
- Reconcile known limitations and technical-debt summaries with root
  `TECH_DEBT.md`.
- Decide whether the dated handover should be archived; do not use it as current
  operational guidance.
- Remove or derive remaining fragile counts and duplicated status claims.

### Product readiness

- Scope and complete TD-UI-062 UI parity work.
- Validate remaining forge-ui surfaces against current product claims.
- Define the production-readiness gate after UI parity and documentation truth
  are established.

### Repository milestone

- Keep documentation changes isolated from pre-existing image changes.
- Obtain the required review and commit authority.
- Push only when explicitly authorized, then verify CI behavior for the exact
  committed SHA if the workflow is triggered.

## Next Strategic Priorities

1. Complete and review the documentation truth modernization.
2. Reconcile remaining limitation and debt summaries with their authorities.
3. Scope TD-UI-062 using current architecture and operational boundaries.
4. Execute UI parity work with focused product validation.
5. Perform a production-readiness assessment using commit-matched evidence.

## Out of Scope for This Milestone

- New product features or TD-UI-062 implementation.
- Authentication or remote-access design.
- Recovery architecture changes.
- Migration changes.
- CI workflow changes.
- Legacy platform deletion or modernization.
- Reclassification of technical debt without ledger authority.

## Completion Criteria

This milestone is complete when:

1. The approved documentation-truth scope is internally consistent and
   link-valid.
2. Operational guides identify executable sources of truth and avoid stale
   success assumptions.
3. Agent guidance routes to governance instead of duplicating it.
4. Snapshot documents clearly separate completed, active, and planned work.
5. No code, tests, CI workflow, storage, App Model, or unrelated working-tree
   state was changed by documentation work.
6. The documentation diff receives the required review and repository action is
   explicitly authorized.
