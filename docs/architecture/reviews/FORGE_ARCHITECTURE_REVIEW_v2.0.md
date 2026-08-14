# FORGE Architecture Review v2.0

> Immutable review artifact governed by
> [ADR-026](../../ADR/ADR-026-independent-architecture-review-governance.md).
>
> **Provenance notice:** the independent v2 review was delivered outside the
> repository and its verbatim body is unavailable. This publication is
> `RECONSTRUCTED_FROM_ACCEPTED_REVIEW_RECORD`. It preserves the accepted
> `7.4/10` score, `CONDITIONAL GO` verdict, conclusions, and recommendation.
> Category scores and prose are bounded reconstruction, not claimed transcript.

**Review date:** 2026-08-13
**Repository revision:** certified implementation later reconstructed as C2
tree `9df53cc06c10d66247bd83d0a583541ee54764b4`; documentation alignment followed
in C3
**Trigger:** completion of the Architecture Hardening Program
**Scope:** whole local Product architecture
**Reviewer:** independent Principal Engineer posture
**Personas:** architecture, scalability, security, reliability, product
**Prior-review exposure:** comparison occurred only after the v2 conclusion was
formed, per the accepted review brief

## 1. Executive verdict

**Overall score:** 7.4/10
**Verdict:** CONDITIONAL GO

The hardening program materially improved FORGE. The adopted Product vertical
now has coherent, core-owned canonical authority from Observation through
Results presentation. Remaining blockers were configuration/history integrity
and repository-local architecture governance, not a failure of the new Product
authority spine. Local Product development could resume only after those
configuration conditions were closed. Cloud and distributed work remained
gated.

## 2. Evidence baseline and unknowns

The review covered Observation, App Model, Test Definition v2, execution,
Run/Result, recovery, cancellation, route evidence, authentication expectation,
Results projection, security, legacy compatibility, storage, migrations, UI,
controllers, ADRs, AI, healing, and reporting.

Unknowns retained here:

- exact original review prose and per-category scoring;
- cloud behavior, because no cloud implementation existed to review; and
- future tenant, worker, queue, and distributed-lock contracts.

## 3. Reconstructed scorecard

These category values preserve the accepted 7.4 arithmetic mean and the
review's relative conclusions. They are not represented as verbatim original
category scores.

| Category | Score | Current evidence / limiting condition |
|---|---:|---|
| Ownership clarity | 8.5 | Canonical services/repositories own Product truth; legacy remains isolated |
| Domain coherence | 8.0 | Observation, support, Definition, Execution, Run, and Result identities are explicit |
| Layering | 8.0 | Core owns semantics; controllers transport; UI renders |
| Persistence integrity | 8.5 | Atomic migrations, immutable support, and repository constraints are strong |
| Failure honesty | 8.5 | Gaps, indeterminate outcomes, refusal codes, and weakest-truth aggregation are explicit |
| Recovery design | 8.0 | Evidence-based local recovery is coherent but process-local |
| Security boundary | 8.5 | Credential lifetime and structured/artifact redaction are governed |
| Test/certification architecture | 8.5 | Focused, adversarial, migration, persistence, and real proofs are extensive |
| Scalability | 4.3 | Single-host SQLite and process-local coordination are not cloud-safe |
| Maintainability | 6.5 | Canonical spine is coherent but large and compatibility surface remains |
| Extensibility | 6.0 | Local seams are credible; distributed/plugin contracts are not designed |
| Technical-debt health | 5.5 | Debt is visible, but malformed App Models and unversioned review/configuration artifacts remained |
| **Overall** | **7.4** | Unweighted arithmetic mean, rounded to one decimal |

## 4. Current architecture map

The canonical adopted Product path is:

`Crawl -> ObservationRun/Observation/Gap -> sealed App Model support -> Test Definition v2 -> ExecutablePlan v2 -> Execution -> Run/Result -> Results projection -> API/UI`

Core services own semantics and persistence. Controllers supply identity and
intent. UI surfaces consume typed projections. Legacy paths are separately
labelled and cannot silently substitute for canonical authority.

## 5. Authority assessment

The review found one active Product authority for each of the critical domains:

- `ObservationService` and `ObservationRepository` for Observation truth;
- `AppModelRepository` for App Model revisions and sealed support;
- `CanonicalTestDefinitionGenerationService` and `TestSetRepository` for v2
  Definition authority;
- `ExecutionService`, `ExecutionRepository`, Run/Result repositories, and
  `PersistedEvidenceAggregator` for Product execution truth; and
- core read projections for Observation and Results presentation.

## 6. Domain and vocabulary assessment

Observation IDs no longer stand in for operation IDs. Execution, Run, and
Result have separate identities. Authentication expectation, credential
availability, and authentication execution result are different truths.
Intrinsic compatibility is definition-scoped; execution eligibility is live.

## 7. Layering assessment

The adopted Product path now follows service/repository/projection ownership.
UI and controllers no longer assemble Observation support, route evidence,
authentication authority, or execution provenance. Compatibility controllers
remain explicitly labelled and isolated.

## 8. Repository, persistence, and migration assessment

Migrations 020-027 form an ordered authority chain. M021 is forward-only for
populated Product workspaces. Immutable support sets, manifests, results, and
artifact relationships are enforced by transactions and database constraints.
At review time, however, the implementation still lived in a large dirty tree,
which made release history and reviewability a RED configuration risk.

## 9. ADR health assessment

ADRs 022-028 governed the reconstructed authority spine. Earlier principle ADRs
remained useful but required a current health register because several had been
narrowed or partially superseded by later authority decisions.

## 10. Failure, recovery, and security assessment

Absence proof is fail-closed; unresolved evidence remains indeterminate or a
Gap. Recovery requires governed evidence of lost ownership. Cancellation and
Results consume persisted lifecycle truth. Credentials remain operation-scoped,
and artifact/text admission rejects secret-bearing content.

## 11. Legacy and compatibility assessment

Legacy Observation files, v1 Test Definitions, CLI/CI result/healing/reporting,
and compatibility presenters remain readable but are not Product authority.
Their continued size is maintainability debt, not an active dual-authority
defect in the adopted vertical.

## 12. Technical-debt register

### RED at the v2 review boundary

1. **Configuration/history integrity:** the certified architecture was not yet
   represented by truthful reviewable commits.
2. **Missing repository-local review governance evidence:** v1/v2 artifacts,
   trend, ADR health, and accepted baseline comparison were absent.

### AMBER

- Historical malformed App Model rows remain accepted baseline debt.
- Compatibility-era Observation, v1 Definition, CLI/CI, healing, and reporting
  surfaces still require staged retirement decisions.
- Local process-global coordination and SQLite constrain scale.
- AI, healing, and reporting have not all been brought under the same canonical
  Product authority program.

### GREEN / accepted

- Local single-host deployment is an explicit Product constraint.
- Historical compatibility remains read-only and labelled until retention and
  consumer requirements permit retirement.

## 13. Scalability assessment

The architecture is coherent for a local Product. It is not cloud-safe:
workspace SQLite, process-local ownership and cancellation, and process-global
control-plane state would fail before a distributed worker model could be
trusted. The review recommended documenting this boundary, not prematurely
building distributed coordination.

## 14. Test and certification assessment

Certification materially improved through focused adversarial tests, migration
rehearsals, immutable persistence checks, secret scans, no-orphan audits, and
real SauceDemo proofs. The remaining defect was configuration registration:
accepted baseline fingerprints and immutable review artifacts were not yet
repository-local.

## 15. Simplification opportunities

- Retire compatibility readers only after supported consumers reach zero.
- Keep one projection owner per read truth.
- Avoid cloud abstractions until a cloud architecture TD defines tenant and
  worker authority.

## 16. Top strengths

1. A single canonical Product authority chain now spans Observation to Results.
2. Persisted identities and immutable support make provenance forensic.
3. Failure and uncertainty semantics are explicit and fail closed.
4. Credential and artifact boundaries are materially stronger.
5. Certification tests architecture rather than only happy-path behavior.

## 17. Top risks

1. Unversioned configuration/history could invalidate otherwise sound work.
2. Cloud expansion would break process-local assumptions.
3. Legacy surface area could regain authority if fallback behavior returns.
4. Accepted malformed App Models can obscure new persistence regressions unless
   fingerprints are compared.
5. AI/healing/reporting remain outside parts of the canonical Product program.

## What surprised the reviewer?

The reconstructed authority spine was substantially more coherent than the
earlier review predicted, particularly across immutable support, execution
revalidation, and failure semantics. The largest remaining release blocker was
repository configuration integrity rather than Product-domain ownership.

## 18. Recommendations and roadmap

1. Reconstruct the certified working tree into truthful coarse commits.
2. Publish immutable v1/v2 reviews, trend, scorecard, and ADR health.
3. Register accepted App Model debt as machine-comparable baseline metadata.
4. Resume bounded local Product development after configuration closure.
5. Require a separate architecture review before cloud, multi-process,
   multi-tenant, autonomous, or public extension work.

## 19. Final decision

**CONDITIONAL GO**

Continue architecture/configuration closure only. Resume local Product work
after the reconstruction and documentation conditions pass. Do not begin cloud
or distributed architecture from this verdict.
