# CODEBASE_MAP.md

---

Document Authority:
E — Reference

Owner:
Engineering Documentation Owner

Source of Truth:
Current source tree, imports, package scripts, migrations, tests, and CI
workflow

Refresh Trigger:
Module ownership, entry points, persistence boundaries, UI routes, or validation
paths change

Last Verified:
2026-07-30

---

This is a navigation and ownership map. It does not replace ADRs, executable
code, tests, migrations, or the current validation evidence. Avoid treating
counts and status labels here as permanent.

## Top-Level Boundaries

| Area | Responsibility | Primary authority |
|---|---|---|
| `src/core/` | App-agnostic engine, onboarding, crawling, evidence, storage, triage, and pipeline services | Source modules and applicable ADRs |
| `src/apps/` | Application-specific onboarding configuration and generated test sources | App configuration and generated-source contracts |
| `forge-ui/` | Canonical local UI and transport-only Express API | `forge-ui/server/`, routes, and UI tests |
| `scripts/` | Unit proofs, validation harnesses, and explicit operator rehearsals | Script source and package scripts |
| `evals/` | AI capability evaluations against declared datasets | Eval harnesses and datasets |
| `models/` | Generated App Model JSON artifacts | App Model ownership rules and repository state |
| `docs/` | Governance, architecture rationale, operations, status, and history | `START_HERE.md` and `DOCUMENTATION_INDEX.md` |

## Engine Ownership (`src/core/`)

| Module | Role | Ownership note |
|---|---|---|
| `agent/` | Goal-directed planning and agent memory | Uses evidence contracts; does not become a second App Model writer |
| `ai/` | Provider abstraction, generation context, and budget tracking | AI judgment remains bounded by evidence and provider contracts |
| `crawler/` | BFS, SPA, and hybrid crawl strategies | App-specific behavior belongs in onboarding configuration |
| `healing/` | Selector repair, confidence, and heal persistence | Correctness requires direct assertion verification |
| `onboarding/` | Crawl/verify/generate CLI and app setup | Reads/writes through existing configuration and storage owners |
| `pipeline/` | Triage, result storage, adaptive fixes, trends, coverage, and reporting | CI invokes these through the workflow-defined paths |
| `storage/` | SQLite schema, migrations, repositories, and App Model services | Sole persistence authority for App Model and run data |
| `triage/` | Failure taxonomy and evidence-gated classification | `insufficient-evidence` is a valid outcome |
| `evidence/` | Evidence tiers, confidence, and health semantics | Confidence cannot exceed observed evidence |
| `domain/` | Stable project lifecycle, evidence references, explainable state, and Truth Confidence contracts | Pure domain rules; no UI, persistence, credentials, or AI dependencies |
| `identity/` | Login-surface observations and bounded signals | Observations do not claim facts outside their boundary |
| `workspace/` | Workspace and file-safety utilities | Shared infrastructure, not business ownership |

## Storage and Recovery Boundary

The UI-neutral Truth Board projection is owned by `src/core/domain/tdUi062c.ts`.
It fails closed on cross-project evidence and dangling evidence references and
has no UI, persistence, transport, credential, AI, or engine dependencies.

The first Truth Board presentation slice is owned by
`forge-ui/src/components/truth-board/`. It renders supplied read-model fields
and does not derive domain meaning or import core domain modules.

The Application workspace shell and Overview presentation are owned by
`forge-ui/src/components/application-workspace/`. The shell is incremental;
later tabs are planned placeholders, and Overview consumes a typed read-model
extension without creating a second domain policy.

The Application workspace Observations presentation is owned by
`forge-ui/src/components/application-workspace/ApplicationObservations.tsx`.
It renders the typed immutable history supplied by
`applicationObservationsAdapter.ts`; `applicationObservationSelection.ts` owns
the fail-closed deep-link selection rule, while
`observationHistoryDateFilter.ts` owns deterministic local-calendar boundary
materialization. `ObservationHistoryFilterToolbar.tsx` owns filter controls.
The server presentation allowlist and legacy-safe category mapping are owned by
`forge-ui/server/registry/ObservationHistoryPresenter.ts`. These modules do not
create observations, sort persisted records, or infer freshness and terminal
outcomes.

The Application Model presentation is owned by
`forge-ui/src/components/application-workspace/ApplicationModel.tsx`. It
renders supplied model state, subject provenance, currency, and limitations;
it does not create models or infer completeness from subjects or counts.

The Application workspace unified Evidence ledger is composed by
`forge-ui/server/context/EvidenceLedgerController.ts`,
`forge-ui/server/registry/BootstrapEvidenceReader.ts`, and
`forge-ui/server/registry/EvidenceLedgerPresenter.ts`. They project existing
bootstrap evidence and immutable ObservationStore evidence without becoming a
new persistence authority; App Model history is consulted only for exact usage
references. `forge-ui/src/components/application-workspace/ApplicationEvidence.tsx`
renders the bounded, server-filtered projection without importing persistence or
exposing unrestricted evidence payloads.

The Application workspace Readiness projection is owned by
`forge-ui/server/context/ApplicationReadinessController.ts` and
`forge-ui/server/registry/ApplicationReadinessPresenter.ts`. The controller
composes existing presentation-safe Observation, App Model, and Evidence reads;
the presenter alone evaluates the four decision-specific states. The projection
is never persisted, and the React surface renders typed conclusions without
recreating domain policy or deriving a score from inventory counts.

The Crawl observation vertical slice is owned by
`forge-ui/src/pages/CrawlPage.tsx`, `forge-ui/server/routes/crawl.ts`, and
`forge-ui/server/registry/ObservationStore.ts`. The route supplies pre-crawl
truth, submits engine work through `ExecutionContext`, and projects terminal
engine/App Model output into append-only observation start and terminal records.
These records are run-scoped provenance artifacts; they do not replace or write
the SQLite App Model. TD-UI-064B extends `ObservationStore` with the sole
validated project-history reader and exposes it through the bounded read-only
crawl API. The UI consumes that projection without consulting JobRunner memory
or the mutable App Model.

`src/core/storage/` owns schema evolution and App Model persistence. Repository
operations remain the only durable App Model write authority.

- Migration 018 adds paired nullable `recovery_source_row_id` and
  `recovery_source_fingerprint` fields.
- Normal and historical rows retain `NULL`/`NULL`; guarded recovery rows carry
  both provenance values.
- Invalid stored JSON remains raw evidence and is not returned as a valid
  App Model.
- `AppModelService` exposes the contract; `AppModelRecoveryOrchestrator` handles
  guarded recovery flow; `AppModelRepository` performs persistence and
  provenance/conflict checks.
- Focused TD-184A/TD-184B tests and the explicit disposable rehearsal prove the
  contract. The rehearsal is not normal unit discovery.

Read [ADR-001](<../ADR/ADR-001_App Model.md>), [ADR-002](<../ADR/ADR-002_Database Strategy.md>),
[ADR-017](../ADR/ADR-017_What_FORGE_Observes_FORGE_Keeps.md), and the storage
source before changing this boundary.

## Platform UI and Retired Platform Code

`forge-ui/` is the canonical UI surface. Its Express API is transport-only and
delegates business behavior to engine contexts. The server binds to loopback and
rejects unsafe browser origins by design.

`src/platform/` is deprecated historical code. The monolithic
`platform-server.ts` is retired and fails closed before dotenv loading or
`server.listen`. Do not add UI, dashboard, or recovery behavior there. The
contained auxiliary dashboard/query scripts are local-only legacy tools, not the
canonical UI path.

## Validation and CI Paths

| Evidence | Entry point | Ownership |
|---|---|---|
| Root/eval typecheck | `npm run check` | TypeScript configuration and CI workflow |
| UI typecheck | `cd forge-ui && npm run check` | forge-ui package; local gate in current CI |
| Unit suite | `npm run test:unit` | `scripts/*.test.ts` discovery |
| Source-header governance | `npx tsx scripts/add-headers.ts --check` and `scripts/verify-td-gov-001-source-headers.test.ts` | Constitutional wording, Git-inventory applicability, safe placement, and exclusions |
| Validation profiles | `npm run validate:baseline ...` | `scripts/forge-validation-baseline.ts` |
| Recovery rehearsal | `npm run test:rehearsal:td184b3` | Explicit disposable operator workflow |
| CI | `.github/workflows/e2e-pipeline.yml` | Current-run provenance and evidence decision |

Executable validation outranks this map. See
[FORGE_VALIDATION_BASELINE.md](../project/FORGE_VALIDATION_BASELINE.md) and
[CI_PIPELINE.md](../project/CI_PIPELINE.md).

## Supporting Areas

- `fixtures/ground-truth/` contains evaluation datasets.
- `docs/ADR/` contains decision-time architecture rationale.
- `docs/project/` contains operations and dated status snapshots.
- `notes/review-scratch/`, `reports/`, `logs/`, and build output are working
  artifacts and are not durable architecture sources.

## Ownership Rules

1. Extend an existing owner before introducing a new representation or writer.
2. Keep application-specific behavior in app configuration, not framework core.
3. Keep UI routes transport-only; business logic belongs in engine services.
4. Treat SQLite repositories as the persistence authority.
5. Verify claims from code, tests, migrations, and CI rather than comments or
   status prose.
6. When this map conflicts with implementation, report the drift and follow the
   executable source for current behavior.
