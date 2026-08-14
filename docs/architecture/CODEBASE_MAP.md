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
2026-08-14

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

### Canonical local Product chain

The implemented, adopted Product authority chain is:

`Crawl -> ObservationRun/Observation/Gap -> App Model + support seal -> CanonicalTestDefinition v2 -> ExecutablePlan v2 -> Execution -> Run/Result -> Results Projection -> API/UI`

Each arrow crosses an explicit contract. Observation truth commits before App
Model derivation; Test Definition v2 references exact sealed support; execution
revalidates Definition, support, route, and authentication identities; Results
projection reads persisted Execution/Run/Result truth without recovery or
writes.

| Classification | Current paths | Authority rule |
|---|---|---|
| CANONICAL | Core Observation, App Model support, Test Definition v2, Execution v2, Run/Result, and read projections | May create or interpret active Product truth |
| COMPATIBILITY | Legacy Observation readers/endpoints and v1 Test Definition presentation | Readable and explicitly labelled; never fallback canonical authority |
| LEGACY | CLI/CI run identity, result storage, healing, reporting, and generated-source manifests | Retains its own historical/runtime contract; never merged into Product authority |
| EXPERIMENTAL | Agent memory and bounded AI/agentic paths not adopted into the Product authority chain | No authority over canonical Product facts |

Deployment assumptions for this chain are documented in
[`LOCAL_PRODUCT_CONSTRAINTS.md`](LOCAL_PRODUCT_CONSTRAINTS.md). It is a local,
single-host architecture and is not evidence of cloud readiness.

Database selection is governed by explicit `PRODUCT_WORKSPACE`,
`LEGACY_RUNTIME`, and `DISPOSABLE_CERTIFICATION` modes in
`src/core/storage/DatabaseAuthority.ts`; a path or `DB_URL` alone cannot confer
Product authority. Migration behavior receives the same operation-scoped
provenance. See [`DATABASE_AUTHORITY.md`](DATABASE_AUTHORITY.md) before adding a
database caller, migration path, or persistence factory.

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

Canonical Observation read truth is owned by
`src/core/observation/ObservationReadProjectionService.ts`. The Application
workspace Observations surface in
`forge-ui/src/components/application-workspace/ApplicationObservations.tsx`
renders the typed immutable history supplied by
`applicationObservationsAdapter.ts`; `applicationObservationSelection.ts` owns
the fail-closed deep-link selection rule, while
`observationHistoryDateFilter.ts` owns deterministic local-calendar boundary
materialization. `ObservationHistoryFilterToolbar.tsx` owns filter controls.
The UI does not join repositories, reconstruct provenance, or infer terminal
Observation truth for the adopted crawl path.

The Application Model presentation is owned by
`forge-ui/src/components/application-workspace/ApplicationModel.tsx`. It
renders supplied model state, subject provenance, currency, and limitations;
it does not create models or infer completeness from subjects or counts.

The Application workspace canonical evidence inventory is owned by
`ApplicationEvidenceInventoryProjection` in
`src/core/observation/ObservationReadProjectionService.ts` and transported by
`forge-ui/server/context/ApplicationEvidenceInventoryController.ts`.
`forge-ui/server/context/EvidenceLedgerController.ts` is isolated compatibility
code reachable only through an explicitly labelled compatibility endpoint; no
canonical Product consumer falls back to it.
`forge-ui/src/components/application-workspace/ApplicationEvidence.tsx` renders
the bounded projection without importing persistence or
exposing unrestricted evidence payloads.

Historical Observation intake is owned solely by
`src/core/observation/ObservationImportService.ts`. It inventories workspace-
scoped legacy files, classifies uncertainty, performs dry runs, and writes a
transactional immutable import ledger. Only exact hash-verified import packages
with original identity and the adopted canonical crawl contract may be promoted;
bootstrap evidence and agent memory remain separate compatibility metadata.
`scripts/observation-import.ts` is the explicit operator entry point. The read
projection exposes safe import metadata without source paths and never merges
compatibility records into canonical Observation facts.

The Application workspace Readiness projection is owned by
`forge-ui/server/context/ApplicationReadinessController.ts` and
`forge-ui/server/registry/ApplicationReadinessPresenter.ts`. The controller
composes existing presentation-safe Observation, App Model, and Evidence reads;
the presenter alone evaluates the four decision-specific states. The projection
is never persisted, and the React surface renders typed conclusions without
recreating domain policy or deriving a score from inventory counts.

Canonical v2 Test Definition authority is owned by
`src/core/test-design/TestDefinitionAuthorityProjectionService.ts`,
`CanonicalRouteEvidenceProjection.ts`,
`AuthenticationExpectationProjection.ts`,
`CanonicalTestDefinitionGenerationService.ts`, and
`TestDefinitionContract.ts`. `src/core/storage/repositories/TestSetRepository.ts`
owns immutable SQLite Test Set revisions and append-only generation events.
`forge-ui/server/context/TestInventoryController.ts` transports project identity
and generation intent to core and consumes the canonical presentation; it does
not assemble support, route, or authentication authority. The pre-existing
generated-source manifest remains compatibility-only.

The pure CanonicalTestDefinition-to-ExecutablePlan projection is owned by
`src/core/execution/ExecutablePlanContract.ts` and
`src/core/execution/ExecutionProjectionService.ts`. It performs no
persistence and no runner invocation; it re-derives a definition's precise
executability from the definition and current authority state on demand,
never trusting the definition's own stored `runnerCompatibility` as a gate.
Runner and credential availability are structurally absent from intrinsic
Definition compatibility. They remain environment-scoped preflight concerns
owned by `ExecutionService`.

The durable Product execution lifecycle is owned by
`src/core/execution/ExecutionService.ts`,
`src/core/execution/ExecutionRecoveryCoordinator.ts`, and
`src/core/storage/repositories/ExecutionRepository.ts`. The service is the sole
Product caller of `PlaywrightPlanExecutor`; the recovery coordinator is the sole
cross-repository recovery owner and owns no tables; the repository is the sole
writer of Migration 020's `execution_events` and `execution_locks`. Product requests
resolve the selected workspace database through
`forge-ui/server/context/ExecutionContext.ts`. Legacy CLI/CI execution retains
its existing authority and is not implicitly joined to Product lifecycle state.
`ExecutionLifecycleController.ts` and the project routes are transport only.

Canonical Product persisted-evidence interpretation is owned solely by
`src/core/execution/PersistedEvidenceAggregator.ts`. It reads the Execution
root, manifest, events/lock, Product Run, and immutable Product Results and
returns deterministic Run/Execution aggregation plus integrity findings under
ADR-018. Terminalization, recovery, cancellation, status, and Results
projection consume this owner and do not implement parallel weakest-truth or
manifest algorithms.

The canonical Product Results read model is owned by
`src/core/execution/ExecutionResultProjectionService.ts`. It reads the existing
Execution, manifest, event, Product Run, and immutable Product Result
authorities through `PersistedEvidenceAggregator`, maps its canonical headline,
and surfaces missing evidence or integrity disagreement without writes or
automatic recovery. `ExecutionResultsController.ts` exposes bounded list and
detail views from the selected workspace only; legacy repo-root Runs are not
federated.

Authoritative Product execution preflight is owned by
`src/core/execution/ExecutionService.ts`.
`forge-ui/server/context/ExecutionPreflightController.ts` validates transport
identity and delegates to core; it does not compose execution authority.
`forge-ui/server/registry/ExecutionPreflightPresenter.ts` remains a
compatibility-era read presenter and is not the active Product authority.
`forge-ui/src/pages/RunPage.tsx` renders v2 eligibility only and has no runner
invocation or persistence path.

For the canonical crawl path, `forge-ui/server/routes/crawl.ts` owns transport
identity and orchestration only. `src/core/observation/ObservationService.ts`,
`ObservationArtifactStore.ts`, and
`src/core/storage/repositories/ObservationRepository.ts` own canonical
workspace-scoped Observation admission and persistence. Crawl facts and gaps
commit before App Model enrichment; the App Model revision and its Observation,
subject, and gap support rows then commit atomically. The legacy
`forge-ui/server/registry/ObservationStore.ts` is a read-only compatibility
reader for historical files. It exposes no writer API; fresh crawl starts use
only `ObservationService`, and active Product reads use only
`ObservationReadProjectionService`.

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
