# TD-UI-062D Truth Board Presentation Slice

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`forge-ui/src/components/truth-board/` and its contract tests

Refresh Trigger:
Truth Card fields, presentation boundaries, or Truth Board navigation changes

Last Verified:
2026-07-30

---

## Purpose and boundary

TD-UI-062D is the first presentation slice for the TD-UI-062C Truth Board
read model. It maps read-model fields to decision-oriented Truth Cards. The UI
renders supplied observations, explanations, impacts, recommendations, evidence
references, unknowns, and blockers. It does not calculate domain state.

The presentation code mirrors the read-model types structurally because
`forge-ui` has a one-directional boundary and must not statically import core
domain modules. An adapter may later supply the model; the page does not
reconstruct one from legacy API fields.

## Presentation rules

- Project Status and Truth Confidence are separate prominent cards.
- Crawl, App Model, Test Readiness, Execution, Results, and Insights render as
  decision cards.
- Missing, unknown, stale, blocked, and integrity-failed conditions remain
  visible through the supplied state, blockers, unknowns, and evidence IDs.
- Every card shows observation, why, impact, evidence, and any recommendation.
- No health score, opaque KPI, or synthetic confidence is introduced.

## Current integration boundary

The `/truth-board` navigation entry exposes the presentation slice while the
read-model adapter remains intentionally separate. Adding an API or changing
legacy routes is outside TD-UI-062D.
