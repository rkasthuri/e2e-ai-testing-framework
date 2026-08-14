# FORGE ADR Health Register

---

Document Authority:
E - Reference

Owner:
Architecture Authority

Source of Truth:
Individual ADRs and current executable repository evidence

Refresh Trigger:
An ADR is accepted, amended, superseded, retired, or materially diverges from
implementation

Last Verified:
2026-08-14 at `5432840808d99b34e8a18a01f089054c16ffaec0`

---

This register describes current health without rewriting decision-time history.
`CURRENT WITH IMPLEMENTATION NOTE` means the decision remains governing but a
bounded clarification is required to understand current implementation.
`PARTIALLY SUPERSEDED` means a later ADR governs part of the original scope.
`PROPOSED` preserves the ADR's recorded status even where code uses the
principle; implementation does not silently ratify a proposal.

| ADR | Classification | Current evidence and bounded note |
|---|---|---|
| ADR-001 App Model | CURRENT WITH IMPLEMENTATION NOTE | App Model remains derived application truth; ADR-027 adds exact sealed Observation/Gap support rather than making Observation subordinate facts part of the model |
| ADR-002 Database Strategy | PARTIALLY SUPERSEDED | SQLite is current local Product authority under ADR-022/023; PostgreSQL remains an unimplemented future direction, not current capability |
| ADR-003 Human Review Gate | CURRENT WITH IMPLEMENTATION NOTE | Decision remains accepted; Product promotion/approval workflow is not implemented and must not be claimed |
| ADR-004 Dashboard as View Layer | CURRENT WITH IMPLEMENTATION NOTE | View-only principle governs projections; the original dashboard remains unimplemented and `src/platform` is retired |
| ADR-005 SmartLocator Healing | CURRENT WITH IMPLEMENTATION NOTE | Selector hierarchy remains current for legacy healing; healing is not part of the canonical Product authority spine reviewed in v2 |
| ADR-006 Truth-Telling and Earned Evidence | CURRENT WITH IMPLEMENTATION NOTE | Canonical Observation/execution slices implement the principle; legacy/AI/healing/reporting coverage remains uneven |
| ADR-007 App-Agnostic Design | CURRENT | Framework internals remain app-agnostic; SauceDemo behavior is configuration/test fixture scope |
| ADR-008 AI Provider Abstraction | CURRENT WITH IMPLEMENTATION NOTE | Current implementation uses `aiCall` dispatch rather than the sketched interface; cloud/provider federation is not implied |
| ADR-009 Canonical Run Identity | PARTIALLY SUPERSEDED | Retained for legacy CLI/CI `CURRENT_RUN_ID`; Product Execution/Run/Result identity is governed by ADR-023 through ADR-025 |
| ADR-010 Informational Bug Gate | CURRENT | Informational policy remains until a separately accepted precision gate exists |
| ADR-011 Verify Before Assert | CURRENT | Canonical generation continues to require governed evidence and fails closed |
| ADR-012 Engine Job Architecture | CURRENT WITH IMPLEMENTATION NOTE | Process-local job ownership remains valid for the local Product and is explicitly not cloud-safe |
| ADR-013 Credential Resolution | CURRENT WITH IMPLEMENTATION NOTE | ExecutionContext/provider direction remains; TD-SEC-001 narrows credential material to operation scope and forbids persistence |
| ADR-014 Execution Lifecycle Concurrency | PARTIALLY SUPERSEDED | Product lifecycle/lock/recovery authority moved to ADR-023/024/025 and `ExecutionService`; legacy concurrency behavior remains separate |
| ADR-015 Provenance Follows Evidence | PROPOSED | Principle is implemented across canonical slices but the ADR itself remains recorded as Proposed |
| ADR-016 Map the Gap | PROPOSED | Canonical ObservationGap and execution reason vocabularies implement bounded portions; the ADR remains Proposed |
| ADR-017 What FORGE Observes, FORGE Keeps | PROPOSED | Canonical persistence follows it for adopted paths; the proposal is not silently promoted to Accepted |
| ADR-018 Aggregate to Weakest Truth | CURRENT WITH IMPLEMENTATION NOTE | Product persisted aggregation is canonical in `PersistedEvidenceAggregator`; legacy aggregators are not federated |
| ADR-019 Vocabulary Competence | PROPOSED | Competence gates are implemented in bounded producers; ADR status remains Proposed |
| ADR-020 Evidence-Derived Confidence | PROPOSED | Evidence-derived confidence exists in bounded paths; no claim of complete system-wide adoption |
| ADR-021 Semantic Claim Alignment | PROPOSED | Current contracts use narrower claim-aligned vocabulary; formal ADR status remains Proposed |
| ADR-022 Atomic SQLite Migration Coordination | CURRENT | Migration coordinator owns connection, transaction, history, and postconditions |
| ADR-023 Workspace-Scoped Execution Authority | CURRENT | Selected Product workspace DB is authoritative; legacy runtime is not fallback authority |
| ADR-024 ExecutionService Runner Boundary | CURRENT | `ExecutionService` is sole Product runner caller and preflight owner |
| ADR-025 Execution/Run/Result Authority | CURRENT | Separate immutable identities and persistence relationships are implemented |
| ADR-026 Independent Architecture Review | CURRENT WITH IMPLEMENTATION NOTE | v1/v2 review bodies were unavailable verbatim; immutable reconstructed-from-record artifacts now preserve accepted conclusions and provenance limits |
| ADR-027 Canonical Observation Authority | CURRENT WITH IMPLEMENTATION NOTE | Implemented only for the adopted crawl vertical; correction/conflict/retention and runtime-only methods remain deferred |
| ADR-028 Test Definition v2 and Execution | CURRENT | Sealed support, route/auth semantics, execution revalidation, and v1 quarantine are implemented |

## Health summary

| Classification | Count |
|---|---:|
| CURRENT | 8 |
| CURRENT WITH IMPLEMENTATION NOTE | 11 |
| PARTIALLY SUPERSEDED | 3 |
| PROPOSED | 6 |
| SUPERSEDED | 0 |
| RETIRED | 0 |

The six proposed ADRs are a governance risk because implemented code relies
on parts of their principles without a formal status transition. This task does
not ratify them; the Architecture Authority must disposition them separately.
