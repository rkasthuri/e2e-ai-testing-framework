# TD-UI-062C Truth Board Read Model

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`src/core/domain/tdUi062c.ts` and its contract tests

Refresh Trigger:
Truth Board section vocabulary, projection rules, or evidence-reference policy changes

Last Verified:
2026-07-30

---

## Purpose and boundary

TD-UI-062C defines a deterministic, UI-neutral read model for a Truth Board.
It projects project identity, evidence references, Truth Confidence, and
explainable section states. It is not a UI component, route, API response
handler, persistence schema, or engine behavior.

## Projection contract

`buildTruthBoardReadModel` returns Project Status, Truth Confidence, Crawl, App
Model, Test Readiness, Execution, Results, and Insights in that fixed order.
Each section uses the TD-UI-062B explainability shape. A section without
section-specific input is explicitly `unknown`; the projection never invents
a conclusion or supporting evidence.

## Fail-closed rules

- Evidence must belong to the projected project and have unique IDs.
- Cross-project evidence and dangling evidence references are rejected.
- Truth Confidence is delegated to the TD-UI-062B deterministic policy.
- Stale, expired, failed-integrity, or absent evidence cannot be upgraded.
- The input project, evidence, and caller-owned arrays are not mutated.
- `asOf` is caller-supplied or derived from the latest captured evidence or
  project update time.

## Ownership boundary

The read model contains no credentials, persistence handles, transport types,
UI types, or engine calls. Adapters must preserve its evidence references and
unknown-state behavior.
