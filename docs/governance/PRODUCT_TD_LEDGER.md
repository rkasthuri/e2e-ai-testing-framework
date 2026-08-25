# FORGE Product and Technical-Debt History Ledger

---

Document Authority:
D - Historical Record

Owner:
Engineering Documentation Owner

Source of Truth:
Git history, committed code and tests, migrations, CI run evidence, accepted
architecture-review artifacts, and explicitly identified local working-tree
certification evidence

Refresh Trigger:
A meaningful Product, CI, architecture, or governance milestone is planned,
certified, committed, superseded, or receives commit-matched CI evidence

---

## Policy

This file is the canonical historical ledger for meaningful FORGE technical-
debt, Product, architecture, CI, and governance milestones. It records why a
milestone existed, what changed, how it was certified, where it landed, and
what remained. It does not replace root [`TECH_DEBT.md`](../../TECH_DEBT.md) as
the current debt-status authority.

- Add a meaningful task ID when work is planned; finalize its entry when the
  work is certified, committed, or receives commit-matched CI evidence.
- Record milestone-level work only. Do not log every review micro-iteration.
- Never fabricate dates, SHAs, CI results, scores, or certification status.
  Preserve uncertainty and distinguish direct evidence from reconstruction.
- Architecture documents and ADRs remain the source of current design truth.
  This ledger records historical evolution and certification state.
- The Definition of Done for every meaningful future milestone includes an
  accurate update to this ledger.
- `Certified` without `Committed` or `CI-Green` means local evidence only. A
  later green descendant proves that the earlier commit was present in the
  tested tree; it is not represented as a direct run against the earlier SHA.

## Status vocabulary

| Status | Meaning in this ledger |
|---|---|
| **Planned** | Approved next work; no implementation or certification claimed. |
| **In Progress** | Work exists but its required certification is incomplete. |
| **Conditional** | A review permits bounded continuation subject to named conditions. |
| **Certified** | Scope-specific evidence passed; locality and source state are stated. |
| **Committed** | The milestone exists in Git at the recorded SHA. |
| **CI-Green** | A successful CI run is tied to the milestone commit or an explicitly named descendant. |
| **Superseded** | Later work replaced or corrected part of the milestone. |

## Architecture and governance checkpoints

These checkpoint artifacts are included because repository evidence preserves
their accepted scores and verdicts. Their original chat bodies were not
retained; the repository publications explicitly identify themselves as bounded
reconstructions rather than verbatim reviews.

| Checkpoint | Date | Status | Score / verdict | Repository landing | Evidence and remaining condition |
|---|---|---|---|---|---|
| Architecture Review v1.0 | 2026-08-11 | **Conditional** | 5.5/10; CONDITIONAL GO | Published later in `5b85bcb2aab3199c5799d3b68697ccd2c81594d6` | Exact reviewed tree and original category scores were not retained. Only architecture hardening could proceed. |
| Architecture Review v2.0 | 2026-08-13 | **Conditional** | 7.4/10; CONDITIONAL GO | Certified implementation reconstructed as C2 tree `9df53cc06c10d66247bd83d0a583541ee54764b4`; artifact published in `5b85bcb2aab3199c5799d3b68697ccd2c81594d6` | Canonical local Product authority materially improved; configuration/history closure remained, and cloud/distributed work stayed gated. |
| Versioned review and accepted-baseline publication | 2026-08-14 | **Committed** | v1 to v2: +1.9; CONDITIONAL GO to CONDITIONAL GO | `5b85bcb2aab3199c5799d3b68697ccd2c81594d6` | Published reconstructed reviews, trend, scorecard, ADR health, local constraints, and accepted baseline fingerprints. No commit-matched CI run was found for this docs/configuration commit. |

Canonical review detail remains in
[`docs/architecture/reviews/`](../architecture/reviews/README.md) and the
governing decision remains
[`ADR-026`](../ADR/ADR-026-independent-architecture-review-governance.md).

## Milestone ledger

### TD-PRODUCT-001-A - Canonical Results transport

- **Parent / related:** TD-PRODUCT-001; prerequisite to TD-PRODUCT-001-B and
  TD-PRODUCT-001-C.
- **Category:** Product / Architecture.
- **Status:** **Committed**; **CI-Green via descendant**.
- **Purpose:** Establish one typed, project-scoped Results transport contract
  from the canonical core projection to the API client without legacy fallback
  or invented empty-success behavior.
- **Key invariants:** Execution lifecycle, Run evidence, and Result outcome stay
  distinct; weakest-truth and integrity-invalid states fail closed; list and
  detail payloads are runtime-decoded; canonical endpoints do not federate
  legacy repo-root Runs.
- **Scope:** `ExecutionResultProjectionService`,
  `ExecutionResultsController`, `ExecutionContext`, `resultsContract.ts`,
  `resultsClient.ts`, typed hooks, and
  `scripts/verify-td-product-001-a-results-transport.test.ts`.
- **Validation / certification:** Focused transport tests cover aggregation,
  identity, missing evidence, malformed payloads, endpoint scoping, and absence
  of fallback. Direct CI run #296 failed before the CI follow-on work. CI run
  #298 succeeded against descendant `30c6c6f26df4092280ebd4ef564449ad437d32fa`,
  which contains this commit.
- **Commit:** `c8b6b7b4048c6744201f6de97bafc25f52d6ab44`.
- **CI / workflow child:** Direct run #296: failure. First verified succeeding
  descendant run: #298, success; workflow child
  `bad0789e58a8425c43362555060fea234d56ebd0`.
- **Remaining / follow-on:** Results UI (TD-PRODUCT-001-B) and bounded canonical
  Result detail evidence (TD-PRODUCT-001-C).
- **Evidence note:** Commit, files, ancestry, and CI outcomes are directly
  verified. The task-to-commit label is reconstructed from focused test names
  and the commit contents because the commit subject omits the TD ID.

### TD-CI-001 - Hermetic readiness and reports handling

- **Parent / related:** CI readiness closure following TD-PRODUCT-001-A;
  corrected by TD-CI-002.
- **Category:** CI / Governance.
- **Status:** **Committed**; direct CI failed; timestamp semantics
  **Superseded** by TD-CI-002.
- **Purpose:** Keep readiness validation hermetic and prevent repository report
  state from contaminating the CI decision.
- **Key invariants:** Readiness checks use isolated report handling; current-run
  evidence must not be inferred from stale repository artifacts.
- **Scope:** `.github/workflows/e2e-pipeline.yml` and
  `scripts/verify-td-arch-003-b4-authority-retirement.test.ts`.
- **Validation / certification:** Commit-local focused coverage was added. Direct
  CI run #297 failed; repository history shows TD-CI-002 then corrected the
  remaining provenance timestamp semantics, and CI #298 succeeded on the
  descendant tree.
- **Commit:** `8ae97f25f06128ea2b8e55ec2120fb613e2a5252`.
- **CI / workflow child:** Run #297: failure; workflow child
  `0bc97003ce3a8311c51d262f954f72754020f182` records that run. Do not cite this
  milestone alone as CI-green.
- **Remaining / follow-on:** TD-CI-002.
- **Evidence note:** Directly verified from Git and GitHub Actions; no success is
  inferred from the failed direct run.

### TD-CI-002 - Provenance semantics and timestamp health

- **Parent / related:** Follow-on to TD-CI-001 and the canonical Results
  transport CI failures.
- **Category:** CI / Architecture.
- **Status:** **Committed** / **CI-Green**.
- **Purpose:** Make current-run provenance and timestamp health truthful so
  readiness cannot accept future, stale, malformed, or mismatched evidence.
- **Key invariants:** Timestamp health is evaluated with bounded semantics;
  current run identity and Git provenance must match; missing or invalid
  evidence fails closed.
- **Scope:** `.github/workflows/e2e-pipeline.yml`,
  `src/core/identity/inputHealth.ts`, `src/pipeline/ai-triage.ts`, and
  `scripts/verify-td067.test.ts`.
- **Validation / certification:** GitHub Actions run #298 succeeded against the
  exact commit.
- **Commit:** `30c6c6f26df4092280ebd4ef564449ad437d32fa`.
- **CI / workflow child:** Run #298: success; workflow child
  `bad0789e58a8425c43362555060fea234d56ebd0`.
- **Remaining / follow-on:** Continue requiring exact current-run provenance;
  no further item is established by this ledger entry.
- **Evidence note:** Directly verified from commit contents and GitHub Actions.

### TD-PRODUCT-001-C - Canonical Result detail evidence and Migration 029

- **Parent / related:** TD-PRODUCT-001-A; complements TD-PRODUCT-001-B.
- **Category:** Product / Architecture.
- **Status:** **Committed** / **CI-Green**.
- **Purpose:** Persist and expose bounded native Product Result oracle detail
  without allowing malformed, legacy, or ownership-mismatched detail to become
  canonical evidence.
- **Key invariants:** Performed-oracle detail is paired with immutable execution-
  item authority; subject ownership is enforced; malformed and legacy detail
  fails closed; Migration 029 is SQLite-governed and forward-only.
- **Scope:** Migration
  `029_canonical_result_detail_evidence.ts`, storage migration inspection and
  types, execution persistence/aggregation/projection, Results transport
  contract, and focused adversarial migration and evidence tests.
- **Validation / certification:** GitHub Actions run #300 succeeded against the
  exact commit. Focused tests cover direct-SQL rejection, immutable pairing,
  bounded projection, restart mutation families, cleanup failure, and the
  irreversible migration boundary.
- **Commit:** `23cf83707de5352ce617ae2b903f252cef0cb869`.
- **Migration SHA-256:**
  `0D2D5E44E902A607961FD1F7760E0D277A2CB8E6E051C3FEE1142D9F00DFE88C`.
- **CI / workflow child:** Run #300: success; workflow child
  `3d72181a6fe3401c345f6f8a4dab708a707f1c12`.
- **Remaining / follow-on:** Historical rows may legitimately retain absent
  detail; no upgrade or fabricated backfill is claimed.
- **Evidence note:** Commit, migration identity/hash, focused tests, and CI are
  directly verified.

### TD-PRODUCT-001-B - Results UI MVP

- **Parent / related:** TD-PRODUCT-001-A; consumes TD-PRODUCT-001-C detail when
  present.
- **Category:** Product.
- **Status:** **Committed** / **CI-Green**.
- **Purpose:** Deliver the first canonical Results experience in `forge-ui`
  using only the typed Results transport.
- **Key invariants:** The UI renders persisted canonical truth, preserves
  lifecycle/evidence/outcome distinctions, exposes integrity and unavailable
  states, and does not fall back to legacy results.
- **Scope:** `forge-ui/src/pages/ResultsPage.tsx` and
  `scripts/verify-td-product-001-b-results-ui.test.ts`.
- **Validation / certification:** GitHub Actions run #302 succeeded against the
  exact commit; focused UI source/behavior certification landed with the page.
- **Commit:** `6e7cd2c613c8ab732f12dfb6c061ba06ea6bdb95`.
- **CI / workflow child:** Run #302: success; workflow child
  `c52172dd7551f997d46af8e275d1dd32371650bd`.
- **Remaining / follow-on:** Connect governed canonical Start and live
  lifecycle orchestration without moving authority into the UI.
- **Evidence note:** Directly verified from commit contents and GitHub Actions.

### TD-PRODUCT-004-A - Canonical Execution Start idempotency and Migration 030

- **Parent / related:** TD-PRODUCT-004; prerequisite to
  TD-PRODUCT-004-R17.
- **Category:** Product / Architecture.
- **Status:** **Committed** / **CI-Green**.
- **Purpose:** Give canonical Product Start a durable, project-scoped,
  idempotent intent identity so retries cannot create a second Execution or
  silently change the accepted semantic request.
- **Key invariants:** One opaque client intent key maps immutably to one
  Execution and versioned semantic fingerprint; identical concurrent/replayed
  requests return one backend identity; conflicting reuse is rejected;
  cancelled acceptance remains replayable; failed acceptance leaves no claim;
  historical rows retain null authority.
- **Scope:** Migration
  `030_canonical_execution_start_idempotency.ts`, `ExecutionRepository`,
  `ExecutionService`, `ExecutionLifecycleController`, storage migration
  inspection/types, API types, limitations/database-authority documentation,
  and `scripts/verify-td-product-004-a-execution-start-idempotency.test.ts`.
- **Validation / certification:** GitHub Actions run #303 succeeded against the
  exact commit. Focused tests cover fingerprinting, concurrency, replay,
  cancellation, transaction failure, controller refusal, restart stability,
  migration guards, and irreversibility.
- **Commit:** `c3445e4f11217fa3044b35238232668cf2446345`.
- **Migration SHA-256:**
  `5E2FA63A79975B9390403ED8DDDD4FBCD1D1FB526B1BD37FA6B9B26390790259`.
- **CI / workflow child:** Run #303: success; workflow child
  `44f140bab0b1dd5a11b4cf1dcf4c22373f628e02`.
- **Remaining / follow-on:** Controller-owned UI orchestration and certification
  tail under TD-PRODUCT-004-R17.
- **Evidence note:** Commit, migration identity/hash, focused tests, and CI are
  directly verified.

### TD-PRODUCT-004-R17 - Controller-owned no-argument Start architecture

- **Parent / related:** TD-PRODUCT-004-A; parent of TC1, TC2, TC3, and TC4.
- **Category:** Product / Architecture.
- **Status:** **Committed** / **CI-Green**.
- **Purpose:** Make the per-project `RunIntentController` the sole owner of
  Start semantics so UI hooks and callers cannot inject a request, intent key,
  project, or transferable authority token.
- **Key invariants:** Public `start()` has no arguments; the controller builds
  the exact immutable request from private intent state; Start is single-flight;
  ambiguous transport preserves the same key and selection; validated refusal
  retires only the exact intent; accepted intent retirement requires fresh,
  matching terminal lifecycle authority; legacy execution fallback is absent.
- **Scope:** The committed Product milestone includes `RunPage.tsx`, `useApi.ts`,
  the typed execution client/contracts, `runIntentState.ts`, focused Product
  certification, and the approved architecture-document alignment.
- **Validation / certification:** Exact-SHA CI run #306 (run ID
  `32400778413`) of `E2E AI Testing Pipeline` triggered on Product commit
  `d690bb5ca802583ff4445c7c04401dea5e817ab5` and concluded `SUCCESS`. Unit
  tests, typechecks, AI/reporting evidence enforcement, and input health passed;
  input health was `healthy`; the stable Playwright suite was 316/316 PASS with
  zero failed, flaky, or skipped.
- **Commit / CI:** Product commit
  `d690bb5ca802583ff4445c7c04401dea5e817ab5`; **Committed** / **CI-Green**.
  Workflow child `9e08d25e67ee3278d2f74ea51d6db97f179c852c` has the Product commit as its
  parent and changes only `reports/run-history.json`.
- **Remaining / follow-on:** No remaining Product certification tail for this
  milestone. TD-GOV-BASELINE-001 remains separate, locally certified, and
  uncommitted.
- **Evidence note:** The original locally certified commit
  `546df002e56d189d9efb8e83f3f33d45f7834714` was safely recreated onto the
  intervening workflow-generated run-history commits as `d690bb5...`. Both
  commits have the identical stable patch ID
  `d5d5f0fb8c8416a523731e857d73def77c9e3948`; Product patch content is
  unchanged. Final certification: TD-PRODUCT-004, R1-R17, and TC1-TC4 are safe,
  committed, and exact-SHA CI-green.

### TD-PRODUCT-004-R17-TC1 - Black-box certification expansion

- **Parent / related:** TD-PRODUCT-004-R17.
- **Category:** Product / Certification.
- **Status:** **Committed** / **CI-Green** as part of the TD-PRODUCT-004 Product
  commit.
- **Purpose:** Expand adversarial black-box proof that only controller-owned
  intent can reach canonical Start and that lifecycle/retirement authority
  cannot be substituted, replayed across identities, or bypassed.
- **Key invariants:** Zero HTTP without exact authority; no semantic injection
  into `start()`; no transferable Start authority surface; duplicate Start is
  single-flight; mismatched project/execution and nonterminal lifecycle cannot
  retire accepted intent; storage failures remain fail-closed.
- **Scope:** `scripts/verify-td-product-004-run-orchestration.test.ts` against
  the committed execution client/controller/Run UI surface.
- **Validation / certification:** Included in exact-SHA CI run #306 (run ID
  `32400778413`) on `d690bb5ca802583ff4445c7c04401dea5e817ab5`;
  `E2E AI Testing Pipeline` concluded `SUCCESS`.
- **Commit / CI:** `d690bb5ca802583ff4445c7c04401dea5e817ab5`;
  **Committed** / **CI-Green**.
- **Remaining / follow-on:** None within TC1; TC2-TC4 are also certified in the
  same Product commit and exact-SHA run.
- **Evidence note:** The black-box purpose is reconstructed from the focused
  assertions; the repository does not preserve a separate TC1 brief or
  checkpoint report.

### TD-PRODUCT-004-R17-TC2 - Finite preflight freshness closure

- **Parent / related:** TD-PRODUCT-004-R17; follows TC1.
- **Category:** Product / Certification.
- **Status:** **Committed** / **CI-Green** as part of the TD-PRODUCT-004 Product
  commit.
- **Purpose:** Close the Start preflight freshness boundary without inventing a
  wall-clock expiry policy that the repository does not define.
- **Key invariants:** `dataUpdatedAt` must be finite and positive; `NaN`, positive
  or negative infinity, zero, and negative values block Start before HTTP;
  finite positive values, including the minimum and `Number.MAX_VALUE`, permit
  the exact controller-owned Start when every other authority check passes.
- **Scope:** Focused cases in
  `scripts/verify-td-product-004-run-orchestration.test.ts` and the private
  preflight gate in `runIntentState.ts`.
- **Validation / certification:** Included in exact-SHA CI run #306 (run ID
  `32400778413`) on `d690bb5ca802583ff4445c7c04401dea5e817ab5`;
  `E2E AI Testing Pipeline` concluded `SUCCESS`.
- **Commit / CI:** `d690bb5ca802583ff4445c7c04401dea5e817ab5`;
  **Committed** / **CI-Green**.
- **Remaining / follow-on:** None within TC2; TC3-TC4 are also certified in the
  same Product commit and exact-SHA run.
- **Evidence note:** Exact acceptance cases are directly present in the focused
  test file. The TC2 label is reconstructed because no separate durable task
  brief exists in the repository.

### TD-PRODUCT-004-R17-TC3 - Certification tail

- **Parent / related:** TD-PRODUCT-004-R17; follows TC2.
- **Category:** Product / Certification.
- **Status:** **Committed** / **CI-Green** as part of the TD-PRODUCT-004 Product
  commit.
- **Purpose:** Close the final focused proof gaps for project, Execution,
  deep-link presentation, lifecycle revalidation, K1-to-K2 eligibility, and
  durable retirement failure handling without changing the R17 architecture.
- **Key invariants / acceptance criteria:** Wrong project and wrong Execution
  lifecycle evidence independently cannot retire accepted K1; project-scoped
  controllers sharing storage cannot mutate one another; RunPage presentation
  Execution B cannot authorize retirement of K1/A; stale lifecycle authority is
  restored only by fresh exact canonical revalidation; K2 is unavailable before
  exact retirement and available afterward; tombstone-write failure remains
  blocked while cleanup failure preserves the correct persisted retired record.
- **Scope / validation:** Test-only expansion in
  `scripts/verify-td-product-004-run-orchestration.test.ts`. Focused Product
  certification is 56/56 PASS. Governed unit discovery is 1273/1273 PASS; root
  and `forge-ui` typechecks, `forge-ui` production build, and `git diff --check`
  are PASS. No Product defect or Product-code fix was required.
- **Commit / CI:** `d690bb5ca802583ff4445c7c04401dea5e817ab5`;
  exact-SHA CI run #306 (run ID `32400778413`) concluded `SUCCESS`.
- **Remaining / follow-on:** None within TC3; TC4 and the full TD-PRODUCT-004
  milestone are certified by the same Product commit and exact-SHA run.
- **Evidence note:** Local focused, full-unit, typecheck, production-build,
  baseline-classification, migration-hash, and database-hash evidence was
  established against the pre-commit working tree and was subsequently carried
  unchanged into the certified Product commit.

### TD-PRODUCT-004-R17-TC4 - Router-Level Deep-Link Proof Closure

- **Parent / related:** TD-PRODUCT-004-R17; follows TC3.
- **Category:** Product / Certification.
- **Status:** **Committed** / **CI-Green** as part of the TD-PRODUCT-004 Product
  commit.
- **Purpose:** Close the final mounted-component proof gap by exercising the
  production `RunPage` router/query-string path with an unrelated presentation
  Execution.
- **Key invariant / acceptance evidence:** A mounted `RunPage` at
  `/run?project=P1&execution=B`, with durable accepted authority `K1 -> A`,
  fetched terminal lifecycle for B as display context but kept Prepare Another
  Run disabled and inert, rendered the truthful monitor link back to A, issued
  no mutation request, generated no K2, and preserved the persisted K1/A record
  byte-for-byte.
- **Scope / validation:** Test-only component harness expansion in
  `scripts/verify-td-product-004-run-orchestration.test.ts`, plus matching React
  18 test-renderer development dependencies. Focused Product certification is
  57/57 PASS; targeted Product regressions are 126/126 PASS; governed unit
  discovery is 1274/1274 PASS; root and `forge-ui` typechecks, `forge-ui`
  production build, and `git diff --check` are PASS. No Product defect or
  Product-code fix was required.
- **Commit / CI:** `d690bb5ca802583ff4445c7c04401dea5e817ab5`;
  exact-SHA CI run #306 (run ID `32400778413`) concluded `SUCCESS` with stable
  Playwright 316/316 PASS and zero failed, flaky, or skipped. Workflow child
  `9e08d25e67ee3278d2f74ea51d6db97f179c852c` changes only
  `reports/run-history.json`.
- **Remaining / follow-on:** None. TD-PRODUCT-004 + R1-R17 + TC1-TC4 are safe,
  committed, and exact-SHA CI-green.

### M1 - Canonical observed-flow vertical slice and Test Definition v3 Product integration

- **Parent / related:** Builds on the canonical Observation/App Model, Test
  Definition v2, Execution/Run, and Results authority spine; introduces the
  richer observed-flow v3 slice without replacing v2 navigation semantics.
- **Category:** Product / Architecture / Certification.
- **Status:** **Committed** / **CI-Green** for this M1 milestone only.
- **Purpose:** Deliver one evidence-backed Product vertical from Observation
  and persisted App Model classification through `NormalizedTestIntentV1`, an
  immutable Test Definition v3, `ExecutablePlan`, canonical Product Execution
  and Run, and an immutable Result.
- **Key invariants:** Application-area authority comes from persisted App Model
  `PageDefinition.module` classification. The positive v3 semantic sequence is
  exactly `navigate_to_observed_route` then `click_observed_data_test`, followed
  by the final `subject_observable` oracle. Generate is ephemeral; Save accepts
  only the exact reviewed intent and establishes canonical v3 inventory. Run
  requires current inventory and preflight revalidation against the current App
  Model authority. Test Definition v1 remains readable and quarantined; v2
  navigation behavior is unchanged; only v3 carries the richer flow.
- **Scope:** Core normalization, immutable v3 Definition persistence and
  Migration 031, plan projection, preflight and execution, canonical Run/Result
  projection, v3 Results transport, production UI adapter/routes/controller and
  Generate-review-Save-inventory-preflight-Run flow, plus the real Product M1
  certification driver and adversarial certification package.
- **Validation / certification:** Pre-commit local validation recorded focused
  M1 certification 202/202 PASS, persistence/governance regressions 217/217
  PASS, full unit discovery 1464/1464 PASS, root and `forge-ui` typechecks PASS,
  and `forge-ui` production build PASS. `E2E AI Testing Pipeline` run #315 (run
  ID `32869714495`) triggered on exact M1 Product SHA
  `1b73e26858d5c101d75059c32ff74ab758fa804a` and concluded `success`: CI unit
  discovery was 1464/1464 PASS, typechecks PASS, and stable Playwright completed
  with 315 passed plus 1 flaky test that passed on retry; the job succeeded. AI
  reporting decision and reporting-evidence completeness both passed, with no
  classified Product, test, infrastructure, flaky, or needs-review findings.
- **Commit / CI:** M1 Product commit
  `1b73e26858d5c101d75059c32ff74ab758fa804a`; direct exact-SHA run #315,
  **success**; **Committed** / **CI-Green**. Workflow child
  `c367ac9c45f7a2f75a064223b320044b10074f64` has the M1 Product commit as its
  parent and changes only `reports/run-history.json`; it is not the M1 Product
  SHA.
- **Remaining / follow-on:** Live proof against an external application in a
  real browser session has not been performed. The integrated Product test uses
  a deterministic execution session behind the real governed
  `PlaywrightPlanExecutor`; it does not establish full external-user readiness.
  Complete manual or natural-language intent production, richer semantics,
  healing migration, and broader Product readiness remain outside this M1
  claim. The accepted fixed-disk, SQLite, process-local, single-host Product
  constraints continue to apply.
- **Evidence note:** Commit identity and scope, exact-SHA CI result, workflow
  child ancestry/scope, Product certification fixtures/driver, and current
  limitation boundaries were directly checked. Closure applies only to the M1
  canonical observed-flow vertical slice, not to the full FORGE roadmap.

### TD-GOV-BASELINE-001 - Permission-stable governed baseline harness

- **Parent / related:** Separate governance scope; not part of
  TD-PRODUCT-004-R17.
- **Category:** Governance / CI.
- **Status:** **Certified locally**; **uncommitted**; CI status not established.
- **Purpose:** Make validation child processes permission-stable and invocation-
  scoped without mutating the parent shell environment or hiding real child
  failures.
- **Key invariants:** Concurrent validation contexts use distinct temporary
  roots; child `HOME`, `USERPROFILE`, `TMP`, and `TEMP` are invocation-scoped;
  parent environment values are restored/unchanged; real non-zero child exits
  remain observable; cleanup is independent.
- **Scope:** Current working-tree changes in
  `scripts/forge-validation-baseline.ts` and untracked
  `scripts/verify-td-gov-baseline-001.test.ts`.
- **Validation / certification:** The current offline report records root
  typecheck and unit discovery as PASS. The governed offline baseline itself
  remains overall FAIL solely because the two exact accepted malformed App
  Model fingerprints are `BASELINE_DEBT`; the report contains 0
  `NEW_REGRESSION` findings and confirms the database SHA-256 was unchanged.
- **Commit / CI:** None. Do not describe TD-GOV-BASELINE-001 as committed or
  CI-green.
- **Remaining / follow-on:** Review separately from Product scope; preserve the
  two registered debt fingerprints and fail closed on any changed or additional
  finding.
- **Evidence note:** Local source, focused tests, and the untracked deterministic
  report are directly verified. The report's overall FAIL is intentionally not
  relabelled as PASS.

## Closure checklist for future milestones

Before finalizing a meaningful entry:

1. Record the approved ID, purpose, scope, invariants, and follow-on when the
   work is planned.
2. Replace planned language only with evidence from the actual diff, tests,
   migration, database-preservation proof, or review artifact.
3. Add the exact commit SHA after review and commit; never copy a proposed SHA.
4. Add CI run/result and workflow-child SHA only after verifying them against
   the milestone commit. Distinguish a direct run from a green descendant.
5. Re-read the final entry and repository status as part of Definition of Done.
