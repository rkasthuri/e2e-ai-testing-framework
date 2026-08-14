# FORGE Reconstruction Manifest

Document authority: configuration-management execution manifest
Owner: Release Configuration Manager
Approved source task: TD-CONFIG-001-B
Prepared: 2026-08-13
Diff base: `main` at `538e8bd35598ca4f1340e0081ab80c4683db764c`

## Purpose and counting rule

This manifest is the self-contained source for reconstructing the current dirty
tree into truthful coarse checkpoints. It does not assert that finer historical
states existed. Do not split an item marked `W` or `I`.

The frozen inventory contains **170 changed paths** and **597 mapping units**:
504 textual tracked hunks, 92 untracked whole-file additions, and one tracked
binary whole-file replacement. `H1-Hn` numbers hunks in `git diff --unified=0`
order against the base above. `W` means the entire untracked file. `B` means the
entire tracked binary change. A path not listed below is outside the approved
reconstruction.

## Governed baseline reauthorization

TD-CONFIG-001-C-R2 records
`BASELINE_REAUTHORIZED_DUE_TO_UNRECOVERABLE_EOL_NORMALIZATION` for
`scripts/verify-td121-generator.test.ts`.

- Prior frozen working-tree SHA-256:
  `C2FB4154DA382E1C14B23089184A738D3BBBCAF8500769B30274F58CA1C74DCA`.
- Reauthorized LF SHA-256:
  `1A2CC0F87BB8BF74D220D9748D2BA37623030A2C052C91C50558D217F314BA6D`.
- Recovery evidence: the reauthorized file is byte-identical to Git blob
  `a31b68ef7d0c21a2783010faeb919cb70be9891b` in safety stash commit
  `3a173c1a03deb3c3e6274cefc915412d4b8f76cd`; its 21 added/deleted source lines
  are identical to the pre-mutation `git diff --binary` capture; it contains
  201 LF terminators and no CRLF terminators.
- Policy basis: `.gitattributes` explicitly governs `*.ts` as text with
  `eol=lf`. The original non-LF byte representation is unavailable and is not
  claimed to have been restored.
- Checkpoint ownership, dependency, mapping-unit count, and inclusion rule are
  unchanged.

The EOF corrections to `docs/templates/ARCHITECTURE_REVIEW_TREND.md` and
`docs/templates/ARCHITECTURE_SCORECARD.md` are `HYGIENE_ONLY`: each removes one
final blank line and changes no prose, heading, structure, decision, checkpoint
ownership, or mapping unit.

TD-CONFIG-001-C-R4 records
`BASELINE_REAUTHORIZED_DUE_TO_EOF_HYGIENE_NORMALIZATION` for:

- `scripts/verify-td-arch-004-b1-test-definition-v2.test.ts`: prior SHA-256
  `A6FABF6E08CD63545C623191B779F3B455591F6115AA4CC95580F7114000964B`;
  reauthorized SHA-256
  `D9AB58FB70E6729EEE760DB0335D712CA9331D62E2E3795E8DCBA578D10C94B0`.
- `src/core/storage/migrations/026_canonical_test_definition_v2.ts`: prior
  SHA-256
  `1B98660C771D882E4F10BC57896A39A8CA6BD81DCA654ED763FDB6B1C5449FDD`;
  reauthorized SHA-256
  `77F87E946057F186ACBB474B210A8AB739D6B6964846058946D8BDBE1E44A7D5`.

For each file, the old and new byte streams are identical after removal of
trailing whitespace; the normalized form removes exactly one terminal LF and
changes no source token, assertion, migration identifier, schema statement,
`up`/`down` behavior, or postcondition. Checkpoint ownership, dependency,
mapping-unit count, migration order, and inclusion rules remain unchanged.

## Checkpoint merge reauthorization

TD-CONFIG-001-C-R3 records
`CHECKPOINT_MERGED_DUE_TO_UNRECOVERABLE_BUILD_DEPENDENCY`.

Checkpoint 1 remains preserved as commit
`cb3ad41f84c3e1922d289d65930e558cdea7add3`. The former Workspace Authority
checkpoint and Atomic Canonical Authority Spine checkpoint are merged into one
Canonical Platform Authority Foundation checkpoint because migrations
012/013/015 require `MigrationContext`, while the inseparable `migrate.ts`
coordinator that supplies that context was assigned to the later checkpoint.
The separate staged C2 tree typechecked but failed 40 of its 54 focused tests;
therefore the former boundary was not independently buildable.

This reauthorization changes historical grouping only. The 170-path and
597-unit inventory, path content, hunk content, migration bodies and hashes,
ADR semantics, and ten inseparable-file dispositions remain unchanged.

TD-CONFIG-001-C-R6 records
`CHECKPOINT_MERGED_DUE_TO_MAJORITY_AUTHORITY_RUNTIME_DEPENDENCY`.

R5 proved that 32 of the 34 former Presentation/API checkpoint paths were
required for the canonical authority checkpoint to compile and satisfy its own
Observation certification. The remaining two visual paths would form a
ceremonial checkpoint rather than a truthful independently meaningful state.
The former C2 and C3 are therefore one Canonical Product Authority &
Presentation Foundation checkpoint. This changes grouping and validation
ownership only; source, test, migration, UI, and ADR content are unchanged.

TD-CONFIG-001-C-R7 records
`BASELINE_REAUTHORIZED_DUE_TO_EOF_HYGIENE_NORMALIZATION` for
`forge-ui/server/registry/LegacyObservationCompatibilityProjection.ts`.

- Prior SHA-256:
  `CDC124A72E74FDF8AB7E93A8A3DFAF7B26AEE125B30508FDD932D0B4BA45FAD3`.
- Reauthorized SHA-256:
  `F8D4D919AA23C3874FE679F81B196D08E5E6C4E3CBE897F76640CEB55D445D99`.
- Equivalence evidence: the normalized file removes exactly one terminal LF;
  all non-trailing source bytes, TypeScript tokens, imports, exports, and
  canonical/legacy compatibility behavior are unchanged.

Checkpoint ownership, dependency, path/unit counts, migration ownership, and
inclusion rules remain unchanged.

## Checkpoints

| Code | Checkpoint | Dependency | Inclusion rule |
|---|---|---|---|
| C1 | Governance foundation | base | Governance ADR/process/templates only |
| C2 | Canonical Product Authority & Presentation Foundation | C1 | Workspace authority through canonical Product presentation, API transport, and legacy quarantine as one indivisible checkpoint |
| C3 | Configuration/documentation alignment | C2 | Maps, indexes, decision log, and this manifest |
| C4 | Optional branding | C3 | Binary brand assets only; omission must omit both files |
| EX | Excluded working artifacts | none | Never include in repository history |

Every checkpoint requires an actual-diff review. C1 and C3 additionally require
configuration review; C2 requires architecture, security, and presentation
diff review; C4 requires brand-owner review. A checkpoint is not buildable merely because its paths can
be staged: the certification gate below must also pass.

## Validation and certification bundles

| Code | Required evidence |
|---|---|
| V1 | Governance/header checks, documentation-link check, `git diff --check` |
| V2 | Root/UI typechecks; production build; `npm run test:unit`; focused TD-ARCH-001/002/003/004 and TD-SEC-001 suites; Observation, Test Definition v2, execution lifecycle/recovery/cancellation/Results projection regressions; TD-ARCH-003-B2/B4 and TD-ARCH-004-B5 presentation tests; readiness/Test Inventory/Run/Results API regressions; migration coordinator and M020-M027 tests; fresh disposable migration plus restart/idempotency and FK/integrity checks; offline baseline and DB SHA before/after; governance/header checks; secret, persistence, no-read-path-write, and orphan-process audits; `git diff --check`; one governed real proof where required by the owning TDs |
| V3 | Documentation links, ADR/index consistency, manifest coverage verifier, governance/header checks, `git diff --check` |
| V4 | Asset provenance, format/open test, UI build if referenced |

Focused test files travel with the checkpoint shown in the path map. Generated
reports are evidence presented to review, not committed certification state.

## ADR and migration keys

`A2`, `A13`, `A22`-`A28` mean ADR-002, ADR-013, and ADR-022 through ADR-028.
`M020`-`M027` mean the correspondingly numbered migrations. `-` means no
dedicated ADR or migration beyond the checkpoint's governing set.

## Path and hunk manifest

Columns are: path; mapping unit; owner; dependency; ADR/migration; validation;
inclusion. `I` marks one of the ten inseparable C2 files.

### C1 - Governance foundation

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `docs/ADR/ADR-026-independent-architecture-review-governance.md` | W | C1 | base | A26 | V1 | mandatory |
| `docs/governance/INDEPENDENT_ARCHITECTURE_REVIEW_PROCESS.md` | W | C1 | base | A26 | V1 | mandatory |
| `docs/templates/ARCHITECTURE_REVIEW.md` | W | C1 | base | A26 | V1 | mandatory |
| `docs/templates/ARCHITECTURE_REVIEW_TREND.md` | W | C1 | base | A26 | V1 | mandatory |
| `docs/templates/ARCHITECTURE_SCORECARD.md` | W | C1 | base | A26 | V1 | mandatory |

### C2 - Canonical Platform Authority Foundation: workspace authority

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `docs/ADR/ADR-022-atomic-sqlite-migration-coordination.md` | H1 | C2 | C1 | A22 | V2 | mandatory |
| `docs/architecture/DATABASE_AUTHORITY.md` | W | C2 | C1 | A2,A22,A23 | V2 | mandatory |
| `scripts/purge.ts` | H1-H2 | C2 | C1 | A2 | V2 | mandatory |
| `scripts/verify-sqlite-app-model.test.ts` | H1-H3 | C2 | C1 | A2,A22 | V2 | mandatory |
| `scripts/verify-td-arch-001-database-authority.test.ts` | W | C2 | C1 | A2,A22,A23 | V2 | mandatory |
| `scripts/verify-td114-117-118.test.ts` | H1-H6 | C2 | C1 | A2,A22 | V2 | mandatory |
| `scripts/verify-td181-sqlite-authority.test.ts` | H1-H4 | C2 | C1 | A2,A22 | V2 | mandatory |
| `scripts/verify-td184a-recovery-provenance.test.ts` | H1 | C2 | C1 | A2,A22 | V2 | mandatory |
| `src/core/onboarding/cli.ts` | H1-H6 | C2 | C1 | A2,A23 | V2 | mandatory |
| `src/core/storage/DatabaseAuthority.ts` | W | C2 | C1 | A2,A23 | V2 | mandatory |
| `src/core/storage/DatabaseFactory.ts` | H1-H7 | C2 | C1 | A2,A22 | V2 | mandatory |
| `src/core/storage/MigrationContext.ts` | W | C2 | C1 | A2,A22 | V2 | mandatory |
| `src/core/storage/db.ts` | H1-H24 | C2 | C1 | A2,A22,A23 | V2 | mandatory |
| `src/core/storage/index.ts` | H1 | C2 | C1 | A2 | V2 | mandatory |
| `src/core/storage/migrations/012_run_lifecycle.ts` | H1-H3 | C2 | C1 | A22 | V2 | mandatory |
| `src/core/storage/migrations/013_app_model_evidence.ts` | H1-H3 | C2 | C1 | A22 | V2 | mandatory |
| `src/core/storage/migrations/015_app_models_crawled_by_nullable.ts` | H1-H3 | C2 | C1 | A22 | V2 | mandatory |
| `src/pipeline/ForgeStreamingReporter.ts` | H1-H5 | C2 | C1 | A2,A23 | V2 | mandatory |
| `src/pipeline/results-store.ts` | H1-H2 | C2 | C1 | A2,A23 | V2 | mandatory |

### C2 - Canonical Platform Authority Foundation: governing documents

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `docs/ADR/ADR-001_App Model.md` | H1 | C2 | C1 | A27 | V2 | mandatory |
| `docs/ADR/ADR-002_Database Strategy.md` | H1 | C2 | C1 | A2,A27 | V2 | mandatory shared hunk |
| `docs/ADR/ADR-009_Canonical_Run_Identity.md` | H1 | C2 | C1 | A23,A25 | V2 | mandatory |
| `docs/ADR/ADR-013_Credential_Resolution_Policy.md` | H1 | C2 | C1 | A13,A28 | V2 | mandatory |
| `docs/ADR/ADR-014_Execution_Lifecycle_Concurrency.md` | H1 | C2 | C1 | A23-A25 | V2 | mandatory |
| `docs/ADR/ADR-015_Provenance_Follows_Evidence.md` | H1 | C2 | C1 | A27,A28 | V2 | mandatory |
| `docs/ADR/ADR-017_What_FORGE_Observes_FORGE_Keeps.md` | H1 | C2 | C1 | A25,A27,A28 | V2 | mandatory |
| `docs/ADR/ADR-018_Aggregate_to_the_Weakest_Truth.md` | H1 | C2 | C1 | A25,A27 | V2 | mandatory |
| `docs/ADR/ADR-020_Evidence-Derived_Confidence.md` | H1 | C2 | C1 | A27 | V2 | mandatory |
| `docs/ADR/ADR-023-execution-authority-and-workspace-scoping.md` | W | C2 | C1 | A23,A27,A28 | V2 | mandatory |
| `docs/ADR/ADR-024-execution-service-as-sole-runner-invocation-boundary.md` | W | C2 | C1 | A24,A28 | V2 | mandatory |
| `docs/ADR/ADR-025-execution-run-and-test-result-authority.md` | W | C2 | C1 | A25,A28 | V2 | mandatory |
| `docs/ADR/ADR-027-canonical-observation-authority-and-evidence-semantics.md` | W | C2 | C1 | A27,A28 | V2 | mandatory |
| `docs/ADR/ADR-028-canonical-test-definition-v2-and-execution-authority.md` | W | C2 | C1 | A28 | V2 | mandatory |
| `docs/architecture/CANONICAL_PERSISTED_EVIDENCE_AGGREGATION.md` | W | C2 | C1 | A18,A25 | V2 | mandatory |
| `docs/architecture/TD-UI-069A_RUN_EXECUTION_PREFLIGHT.md` | W | C2 | C1 | A24,A28 | V2 | mandatory |
| `docs/architecture/TD-UI-069B_GOVERNED_EXECUTION_LIFECYCLE.md` | W | C2 | C1 | A23-A25 | V2 | mandatory |
| `docs/architecture/TD-UI-069C_EXECUTABLE_PLAN_PROJECTION.md` | W | C2 | C1 | A24,A28 | V2 | mandatory |

### C2 - Canonical Platform Authority Foundation: implementation

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `forge-ui/server/context/ExecutionContext.ts` | I:H1-H21 | C2 | C1 | A13,A23-A25,A27,A28 | V2 | mandatory inseparable |
| `forge-ui/server/context/credentials/AuthenticationContext.ts` | W | C2 | C1 | A13,A28 | V2 | mandatory |
| `forge-ui/server/context/credentials/CredentialPlanner.ts` | H1-H3 | C2 | C1 | A13 | V2 | mandatory |
| `forge-ui/server/context/credentials/CredentialResolver.ts` | H1-H5 | C2 | C1 | A13 | V2 | mandatory |
| `forge-ui/server/context/credentials/CredentialTypes.ts` | H1-H3 | C2 | C1 | A13 | V2 | mandatory |
| `src/core/execution/DefinitionCompatibilityEvaluator.ts` | I:W | C2 | C1 | A28 | V2 | mandatory inseparable |
| `src/core/execution/ExecutablePlanContract.ts` | I:W | C2 | C1 | A24,A28,M027 | V2 | mandatory inseparable |
| `src/core/execution/ExecutionCancellationToken.ts` | W | C2 | C1 | A24,A25,M023 | V2 | mandatory |
| `src/core/execution/ExecutionProjectionService.ts` | I:W | C2 | C1 | A24,A28,M027 | V2 | mandatory inseparable |
| `src/core/execution/ExecutionRecoveryCoordinator.ts` | W | C2 | C1 | A24,A25,M020-M023 | V2 | mandatory |
| `src/core/execution/ExecutionResultProjectionService.ts` | W | C2 | C1 | A25 | V2 | mandatory |
| `src/core/execution/ExecutionRunCoordinator.ts` | W | C2 | C1 | A24,A25,M021-M023 | V2 | mandatory |
| `src/core/execution/ExecutionService.ts` | I:W | C2 | C1 | A13,A23-A25,A28,M020-M023,M027 | V2 | mandatory inseparable |
| `src/core/execution/PersistedEvidenceAggregator.ts` | W | C2 | C1 | A18,A25 | V2 | mandatory |
| `src/core/execution/PlaywrightPlanExecutor.ts` | I:W | C2 | C1 | A13,A24,A28 | V2 | mandatory inseparable |
| `src/core/observation/CrawlObservationProducer.ts` | W | C2 | C1 | A27,M024 | V2 | mandatory |
| `src/core/observation/ObservationArtifactStore.ts` | W | C2 | C1 | A27,M024 | V2 | mandatory |
| `src/core/observation/ObservationErrors.ts` | W | C2 | C1 | A27 | V2 | mandatory |
| `src/core/observation/ObservationImportService.ts` | W | C2 | C1 | A27,M025 | V2 | mandatory |
| `src/core/observation/ObservationIntegrity.ts` | W | C2 | C1 | A27 | V2 | mandatory |
| `src/core/observation/ObservationReadProjectionService.ts` | W | C2 | C1 | A27 | V2 | mandatory |
| `src/core/observation/ObservationService.ts` | W | C2 | C1 | A27,M024 | V2 | mandatory |
| `src/core/observation/ObservationSubjectIdentity.ts` | W | C2 | C1 | A27 | V2 | mandatory |
| `src/core/observation/ObservationTypes.ts` | W | C2 | C1 | A27 | V2 | mandatory |
| `src/core/onboarding/AuthManager.ts` | H1-H9 | C2 | C1 | A13,A27 | V2 | mandatory |
| `src/core/onboarding/BFSStrategy.ts` | H1-H3 | C2 | C1 | A27 | V2 | mandatory |
| `src/core/onboarding/Crawler.ts` | H1-H15 | C2 | C1 | A13,A27 | V2 | mandatory shared source |
| `src/core/onboarding/HybridStrategy.ts` | H1-H4 | C2 | C1 | A27 | V2 | mandatory |
| `src/core/onboarding/SPAStrategy.ts` | H1-H5 | C2 | C1 | A27 | V2 | mandatory |
| `src/core/runner/CrawlRunner.ts` | I:H1-H19 | C2 | C1 | A13,A27 | V2 | mandatory inseparable |
| `src/core/security/CredentialExecutionScope.ts` | W | C2 | C1 | A13,A28 | V2 | mandatory |
| `src/core/storage/AppModelRecoveryOrchestrator.ts` | H1-H3 | C2 | C1 | A27 | V2 | mandatory |
| `src/core/storage/AppModelService.ts` | H1-H4 | C2 | C1 | A27 | V2 | mandatory |
| `src/core/storage/AppModelSupportIdentity.ts` | W | C2 | C1 | A27,A28 | V2 | mandatory |
| `src/core/storage/TestSetService.ts` | H1-H2 | C2 | C1 | A28,M026 | V2 | mandatory |
| `src/core/storage/migrate.ts` | I:H1-H17 | C2 | C1 | A22-A25,A27,A28,M020-M027 | V2 | mandatory inseparable shared coordinator |
| `src/core/storage/migrations/020_execution_lifecycle.ts` | W | C2 | C1 | A23,A24 | M020,V2 | mandatory |
| `src/core/storage/migrations/021_execution_identity_manifest_run_linkage.ts` | W | C2 | C1 | A25 | M021,V2 | mandatory; one-way |
| `src/core/storage/migrations/022_product_execution_evidence_guards.ts` | W | C2 | C1 | A25 | M022,V2 | mandatory |
| `src/core/storage/migrations/023_product_execution_cancellation.ts` | W | C2 | C1 | A24,A25 | M023,V2 | mandatory |
| `src/core/storage/migrations/024_canonical_observation_authority.ts` | W | C2 | C1 | A27 | M024,V2 | mandatory |
| `src/core/storage/migrations/025_historical_observation_import.ts` | W | C2 | C1 | A27 | M025,V2 | mandatory |
| `src/core/storage/migrations/026_canonical_test_definition_v2.ts` | W | C2 | C1 | A28 | M026,V2 | mandatory |
| `src/core/storage/migrations/027_canonical_v2_execution_authority.ts` | W | C2 | C1 | A25,A28 | M027,V2 | mandatory |
| `src/core/storage/repositories/AppModelRepository.ts` | H1-H19 | C2 | C1 | A27,A28,M024 | V2 | mandatory shared source |
| `src/core/storage/repositories/ExecutionRepository.ts` | I:W | C2 | C1 | A23-A25,A28,M020-M023,M027 | V2 | mandatory inseparable |
| `src/core/storage/repositories/ObservationRepository.ts` | W | C2 | C1 | A27,M024-M025 | V2 | mandatory |
| `src/core/storage/repositories/RunRepository.ts` | H1-H3 | C2 | C1 | A25,M021-M023 | V2 | mandatory |
| `src/core/storage/repositories/TestResultRepository.ts` | H1-H2 | C2 | C1 | A25,M021-M022 | V2 | mandatory |
| `src/core/storage/repositories/TestSetRepository.ts` | H1-H16 | C2 | C1 | A28,M026 | V2 | mandatory shared source |
| `src/core/storage/types.ts` | I:H1-H7 | C2 | C1 | A23-A25,A27,A28,M020-M027 | V2 | mandatory inseparable shared schema |
| `src/core/test-design/AuthenticationExpectationProjection.ts` | W | C2 | C1 | A13,A28 | V2 | mandatory |
| `src/core/test-design/CanonicalRouteEvidenceProjection.ts` | W | C2 | C1 | A27,A28 | V2 | mandatory |
| `src/core/test-design/CanonicalTestDefinitionGenerationService.ts` | W | C2 | C1 | A28,M026 | V2 | mandatory |
| `src/core/test-design/TestDefinitionAuthorityProjectionService.ts` | W | C2 | C1 | A27,A28 | V2 | mandatory |
| `src/core/test-design/TestDefinitionContract.ts` | H1-H26 | C2 | C1 | A28,M026 | V2 | mandatory shared v1/v2 contract |
| `src/core/types/runs.ts` | H1-H2 | C2 | C1 | A25 | V2 | mandatory |
| `scripts/observation-import.ts` | W | C2 | C1 | A27,M025 | V2 | mandatory |

### C2 - Canonical Platform Authority Foundation: focused and regression tests

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `scripts/verify-td-arch-002-persisted-evidence-aggregation.test.ts` | W | C2 | C1 | A18,A25 | V2 | mandatory |
| `scripts/verify-td-arch-003-b1-observation-authority.test.ts` | W | C2 | C1 | A27,M024 | V2 | mandatory |
| `scripts/verify-td-arch-003-b1-r-truth-immutability.test.ts` | W | C2 | C1 | A27,M024 | V2 | mandatory |
| `scripts/verify-td-arch-003-b2-observation-read-projection.test.ts` | W | C2 | C1 | A27 | V2 | mandatory |
| `scripts/verify-td-arch-003-b3-historical-import.test.ts` | W | C2 | C1 | A27,M025 | V2 | mandatory |
| `scripts/verify-td-arch-003-b4-authority-retirement.test.ts` | W | C2 | C1 | A27 | V2 | mandatory |
| `scripts/verify-td-arch-004-b1-test-definition-v2.test.ts` | W | C2 | C1 | A28,M026 | V2 | mandatory |
| `scripts/verify-td-arch-004-b2-test-definition-authority.test.ts` | W | C2 | C1 | A27,A28 | V2 | mandatory |
| `scripts/verify-td-arch-004-b3-route-auth-generation.test.ts` | W | C2 | C1 | A13,A27,A28 | V2 | mandatory |
| `scripts/verify-td-arch-004-b4-v2-execution-cutover.test.ts` | W | C2 | C1 | A24,A25,A28,M027 | V2 | mandatory |
| `scripts/verify-td-sec-001-credential-boundary.test.ts` | W | C2 | C1 | A13,A27,A28 | V2 | mandatory |
| `scripts/verify-td-ui-069a-c-run-preflight.test.ts` | W | C2 | C1 | A24,A28 | V2 | mandatory |
| `scripts/verify-td-ui-069b-b-execution-lifecycle.test.ts` | W | C2 | C1 | A23,A24,M020 | V2 | mandatory |
| `scripts/verify-td-ui-069b-b-migration020.test.ts` | W | C2 | C1 | A23,A24,M020 | V2 | mandatory |
| `scripts/verify-td-ui-069b-c-c-migration021.test.ts` | W | C2 | C1 | A25,M021 | V2 | mandatory |
| `scripts/verify-td-ui-069b-c-d-migration022.test.ts` | W | C2 | C1 | A25,M022 | V2 | mandatory |
| `scripts/verify-td-ui-069b-c-d-product-evidence.test.ts` | W | C2 | C1 | A25,M021-M022 | V2 | mandatory |
| `scripts/verify-td-ui-069b-c-e-execution-recovery.test.ts` | W | C2 | C1 | A24,A25,M020-M022 | V2 | mandatory |
| `scripts/verify-td-ui-069b-c-f-execution-cancellation.test.ts` | W | C2 | C1 | A24,A25,M023 | V2 | mandatory |
| `scripts/verify-td-ui-069b-c-f-migration023.test.ts` | W | C2 | C1 | A24,A25,M023 | V2 | mandatory |
| `scripts/verify-td-ui-069b-c-g-execution-results.test.ts` | W | C2 | C1 | A25 | V2 | mandatory |
| `scripts/verify-td-ui-069c-b-execution-projection.test.ts` | W | C2 | C1 | A24,A28 | V2 | mandatory |
| `scripts/verify-td-ui-069c-c-r-runner-compatibility-unification.test.ts` | W | C2 | C1 | A24,A28 | V2 | mandatory |
| `scripts/verify-td-ui-069c-c-structured-auth-setup.test.ts` | W | C2 | C1 | A13,A24,A28 | V2 | mandatory |
| `scripts/verify-td-ui-069c-d-playwright-plan-executor.test.ts` | W | C2 | C1 | A13,A24,A28 | V2 | mandatory |
| `scripts/verify-td066.test.ts` | H1-H2 | C2 | C1 | A18 | V2 | mandatory regression |
| `scripts/verify-td121-generator.test.ts` | H1-H8 | C2 | C1 | A13,A27 | V2 | mandatory regression |
| `scripts/verify-ui-authenticate.test.ts` | H1 | C2 | C1 | A13 | V2 | mandatory regression |
| `scripts/verify-ui-credentials.test.ts` | H1-H5 | C2 | C1 | A13 | V2 | mandatory regression |

The C2 validation bundle also runs unchanged tests discovered by
`npm run test:unit`; those files are not changed paths and therefore are not
manifest entries.

### C2 - Canonical Product Authority & Presentation Foundation: API and presentation

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `docs/architecture/TD-ARCH-003-B4_LEGACY_OBSERVATION_RETIREMENT.md` | W | C2 | C1 | A27 | V2 | mandatory |
| `forge-ui/server/context/ApplicationEvidenceInventoryController.ts` | W | C2 | C1 | A27 | V2 | mandatory |
| `forge-ui/server/context/ApplicationModelHistoryController.ts` | H1-H2 | C2 | C1 | A27 | V2 | mandatory |
| `forge-ui/server/context/ApplicationReadinessController.ts` | H1-H16 | C2 | C1 | A27,A28 | V2 | mandatory shared presentation boundary |
| `forge-ui/server/context/EvidenceLedgerController.ts` | H1 | C2 | C1 | A27 | V2 | mandatory compatibility only |
| `forge-ui/server/context/ExecutionLifecycleController.ts` | W | C2 | C1 | A24,A25,A28 | V2 | mandatory |
| `forge-ui/server/context/ExecutionPreflightController.ts` | W | C2 | C1 | A24,A28 | V2 | mandatory |
| `forge-ui/server/context/ExecutionResultsController.ts` | W | C2 | C1 | A25 | V2 | mandatory |
| `forge-ui/server/context/TestInventoryController.ts` | H1-H16 | C2 | C1 | A28 | V2 | mandatory |
| `forge-ui/server/jobs/JobRunner.ts` | H1-H7 | C2 | C1 | A13,A27 | V2 | mandatory |
| `forge-ui/server/registry/ApplicationModelHistoryPresenter.ts` | H1-H16 | C2 | C1 | A27 | V2 | mandatory |
| `forge-ui/server/registry/ApplicationReadinessPresenter.ts` | H1-H8 | C2 | C1 | A27,A28 | V2 | mandatory |
| `forge-ui/server/registry/ExecutionPreflightPresenter.ts` | W | C2 | C1 | A24,A28 | V2 | mandatory compatibility presentation |
| `forge-ui/server/registry/LegacyObservationCompatibilityProjection.ts` | W | C2 | C1 | A27 | V2 | mandatory compatibility only |
| `forge-ui/server/registry/ObservationStore.ts` | H1-H4 | C2 | C1 | A27 | V2 | mandatory compatibility only |
| `forge-ui/server/routes/crawl.ts` | H1-H26 | C2 | C1 | A13,A27 | V2 | mandatory shared API cutover |
| `forge-ui/server/routes/projects.ts` | H1-H11 | C2 | C1 | A24,A25,A27,A28 | V2 | mandatory shared API cutover |
| `forge-ui/src/api/types.ts` | H1-H12 | C2 | C1 | A25,A27,A28 | V2 | mandatory |
| `forge-ui/src/hooks/useApi.ts` | H1-H2 | C2 | C1 | A24,A28 | V2 | mandatory |
| `forge-ui/src/pages/RunPage.tsx` | H1-H2 | C2 | C1 | A24,A28 | V2 | mandatory |
| `forge-ui/src/pages/TestCasesPage.tsx` | H1-H16 | C2 | C1 | A28 | V2 | mandatory |
| `src/core/test-design/TestCasePresentationService.ts` | W | C2 | C1 | A28 | V2 | mandatory |

### C2 - Canonical Product Authority & Presentation Foundation: API and presentation tests

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `scripts/verify-empty-model-guard.test.ts` | H1-H2 | C2 | C1 | A27 | V2 | mandatory regression |
| `scripts/verify-operator-facing-error.test.ts` | H1-H2 | C2 | C1 | A13,A27 | V2 | mandatory regression |
| `scripts/verify-td-arch-004-b5-test-case-presentation.test.ts` | W | C2 | C1 | A28 | V2 | mandatory |
| `scripts/verify-td-ui-064a-crawl-observation.test.ts` | H1-H9 | C2 | C1 | A27 | V2 | mandatory regression |
| `scripts/verify-td-ui-064a-r-guarded-recovery.test.ts` | H1-H3 | C2 | C1 | A27 | V2 | mandatory regression |
| `scripts/verify-td-ui-064a-s-durable-status-auth-diagnostics.test.ts` | H1-H9 | C2 | C1 | A13,A27 | V2 | mandatory regression |
| `scripts/verify-td-ui-064b-application-observations.test.ts` | H1-H7 | C2 | C1 | A27 | V2 | mandatory regression |
| `scripts/verify-td-ui-064b-uxr2-filtered-inline-history.test.ts` | H1-H4 | C2 | C1 | A27 | V2 | mandatory regression |
| `scripts/verify-td-ui-065a-application-model.test.ts` | H1-H5 | C2 | C1 | A27 | V2 | mandatory regression |
| `scripts/verify-td-ui-067a-readiness.test.ts` | H1-H12 | C2 | C1 | A27,A28 | V2 | mandatory regression |
| `scripts/verify-td-ui-068a-evidence-backed-tests.test.ts` | H1-H10 | C2 | C1 | A28 | V2 | mandatory regression |
| `scripts/verify-ui-td022-resume.test.ts` | H1-H3 | C2 | C1 | A27 | V2 | mandatory regression |

### C3 - Configuration/documentation alignment

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `docs/DOCUMENTATION_INDEX.md` | H1-H7 | C3 | C2 | A23-A28 | V3 | mandatory |
| `docs/architecture/CODEBASE_MAP.md` | H1-H7 | C3 | C2 | A23-A28 | V3 | mandatory |
| `docs/configuration/FORGE_RECONSTRUCTION_MANIFEST.md` | W | C3 | C2 | A22-A28,M020-M027 | V3 | mandatory |
| `docs/governance/DECISION_LOG.md` | H1 | C3 | C2 | A23-A28 | V3 | mandatory inseparable decision-index hunk |

### C4 - Optional branding

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `Forge-Tool.png` | B | C4 | C3 | - | V4 | optional, paired |
| `Forge-Tool.ico` | W | C4 | C3 | - | V4 | optional, paired |

### EX - Explicit exclusions

| Path | Unit | Owner | Dep | ADR/Migration | Validation | Rule |
|---|---:|---|---|---|---|---|
| `reports/validation/offline-baseline.json` | W | EX | none | - | evidence only | exclude |

The following classes have no currently changed path but are pre-classified to
prevent accidental capture during reconstruction:

- `notes/review-scratch/**`: **EXCLUDE**.
- temporary databases, backups, logs, screenshots, process files, and proof
  harness output: **EXCLUDE**.
- ad hoc local validation captures: **EXCLUDE**.
- a temporary proof harness is **EXCLUDE** unless it is one of the explicitly
  listed focused test files above; listed focused tests are **INCLUDE**.
- generated validation reports are **EXCLUDE** unless a later governance task
  creates an explicit durable consumer and adds the exact path to a reviewed
  manifest revision.
- branding is **OPTIONAL** only as the paired C5 checkpoint.

## Inseparable-file disposition

The following ten files belong wholly to C2. Their current source state spans
multiple underlying TDs, and no repository evidence preserves a truthful
compiling intermediate version. They must not be interactively split:

1. `forge-ui/server/context/ExecutionContext.ts`
2. `src/core/runner/CrawlRunner.ts`
3. `src/core/storage/migrate.ts`
4. `src/core/storage/types.ts`
5. `src/core/execution/DefinitionCompatibilityEvaluator.ts`
6. `src/core/execution/ExecutablePlanContract.ts`
7. `src/core/execution/ExecutionProjectionService.ts`
8. `src/core/execution/ExecutionService.ts`
9. `src/core/execution/PlaywrightPlanExecutor.ts`
10. `src/core/storage/repositories/ExecutionRepository.ts`

`migrate.ts` and `types.ts` contain shared contiguous hunks for M020-M027.
Whole-file execution additions contain both lifecycle-era and v2 behavior.
Assigning those lines to fabricated earlier commits is prohibited.

## Migration ownership and release order

All eight migrations are mandatory C2 content and are released atomically in
strict lexical/dependency order:

| Migration | Authority introduced | Depends on | Rollback constraint | Certification |
|---|---|---|---|---|
| M020 | Execution events and project lock lifecycle | C2 migration coordinator | Has `down`; use only on disposable certification DB | migration020 + lifecycle/recovery tests |
| M021 | Execution root, immutable manifest, Run/Result linkage | M020 | **One-way: no `down` export**; requires backup/forward recovery | migration021 + Product evidence tests |
| M022 | Product Run/Result and evidence immutability guards | M021 | Has `down`; cannot make M021 reversible | migration022 + Product evidence/aggregation tests |
| M023 | Cancellation event contract | M022 | Has `down`; only after dependent data disposal in a disposable DB | migration023 + cancellation/recovery tests |
| M024 | Canonical Observation, Gap, artifact, and App Model support authority | M023 | Has `down`; destructive to canonical authority, disposable DB only | B1/B1-R + migration contract tests |
| M025 | Historical import ledger | M024 | Has `down`; imported ledger loss, disposable DB only | B3 import/dry-run/idempotency tests |
| M026 | Versioned Test Definition v2 support identity | M025 | Has `down`; historical v2 revisions prevent release rollback | B1 Test Definition v2 migration tests |
| M027 | Accepted Execution v2 authority hashes | M026 | Has `down`; accepted v2 Executions prevent release rollback | B4 v2 execution and provenance tests |

The release rollback policy is forward recovery from M021 onward. The presence
of `down` functions in later migrations does not authorize rolling a populated
Product workspace behind M021. C2 requires a verified backup and disposable
migration rehearsal before review approval.

## Build and review dependency graph

```text
C1 Governance
  -> C2 Canonical Product Authority & Presentation Foundation (M020 -> ... -> M027)
       -> C3 Configuration/documentation alignment
            -> C4 Branding (optional)
```

- C1 is documentation-buildable by itself.
- C2 is one build checkpoint. Workspace authority, migration coordination, and
  its canonical architecture, API, presentation, and compatibility
  sub-milestones are review lenses, not commit boundaries.
- C3 cannot be reviewed as accurate before C1-C2 are frozen.
- C4 is independent of runtime behavior but depends on brand-owner approval.

## Reconstruction procedure and stop conditions

For each checkpoint, select only the exact listed units, verify the staged path
and hunk manifest without using `git add -A`, run its validation bundle, and
obtain the required actual-diff reviews before a commit is authorized. This
document does not authorize staging or committing.

### Git-aware exact staged-tree certification harness

TD-CONFIG-001-C-R8 governs the reusable certification method for checkpoints
whose tests require both root dependencies and real Git inventory semantics:

1. Capture the candidate index identity with `git write-tree` in the source
   reconstruction repository.
2. Create an ignored, shared, no-checkout clone under
   `notes/review-scratch/`; the shared object database makes the candidate tree
   available without creating a checkpoint commit or changing any branch.
3. Load the captured tree into the clone index with `git read-tree`, then
   materialize it with `git checkout-index --all --force`.
4. Only after the index is fixed, add ignored directory junctions from the
   certification root and `forge-ui/node_modules` to the existing installed
   dependencies. Dependency directories remain outside Git inventory and
   repository history.
5. Before testing, require the clone's `git write-tree` to equal the captured
   source tree, require `git ls-files` to match `git ls-tree -r --name-only`
   with zero missing or extra paths, and require `git diff-files` to report
   zero worktree mismatches.
6. Run checkpoint gates from the Git-aware certification root. Reports and
   other generated output remain inside ignored scratch space.

This harness exposes no unstaged later-checkpoint content, supplies genuine
`git ls-files` behavior, and does not authorize a synthetic or real checkpoint
commit before certification passes.

Known reconstruction risks that do not create an orphan mapping are:

- C2 is necessarily a large review unit. Review fatigue must be managed with
  the ADR, migration, security, and test lenses in V2, not by inventing smaller
  commits.
- M021 makes release rollback forward-only even though later migrations expose
  disposable-database `down` functions.
- No accepted `docs/architecture/reviews/FORGE_ARCHITECTURE_REVIEW_v*.md`
  artifact exists in the current tree. C1 can truthfully establish the review
  mechanism, but its commit and certification must not claim that an earlier
  review artifact was persisted. Creating that historical artifact from memory
  is prohibited and is outside this reconstruction.
- Compatibility-era names/comments remain in source, including the v1 alias in
  `TestDefinitionContract.ts` and `ExecutionPreflightPresenter.ts`. ADR-028
  records their actual role. Removing them requires a later approved code TD,
  not configuration reconstruction.
- Hunk identities are valid only against the frozen base. Any rebase or
  overlapping edit requires regeneration and review of this manifest.

Stop reconstruction immediately if:

1. the reconstruction branch no longer descends from the frozen base, or its
   current HEAD is not the last certified checkpoint commit;
2. any changed path or textual hunk is unmapped or mapped twice;
3. an `I` file would need splitting;
4. M020-M027 cannot remain ordered in one C2 checkpoint;
5. Migration 021 is treated as reversible;
6. ADR-028 or another governing ADR is separated from its C2 implementation;
7. a checkpoint fails its focused tests, typecheck/build, governance, security,
   persistence, or secret boundary;
8. generated reports, scratch output, local databases, or proof artifacts enter
   the candidate diff; or
9. unrelated user changes appear after this manifest is frozen.

At the time this manifest was prepared, no known path-level or hunk-level
orphan remained. Reconstruction readiness still depends on a fresh coverage
audit and checkpoint validation at staging time.
