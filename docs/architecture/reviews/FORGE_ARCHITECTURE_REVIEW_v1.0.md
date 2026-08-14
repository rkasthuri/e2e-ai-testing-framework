# FORGE Architecture Review v1.0

> Immutable historical artifact governed by
> [ADR-026](../../ADR/ADR-026-independent-architecture-review-governance.md).
>
> **Provenance notice:** the original chat-delivered review was not persisted in
> the repository. This file is `RECONSTRUCTED_FROM_ACCEPTED_REVIEW_RECORD`, not a
> verbatim transcript. The accepted overall score (`5.5/10`), verdict
> (`CONDITIONAL GO`), severity of the recorded findings, and remediation
> direction are preserved. Narrative detail and category scores below are a
> bounded reconstruction from the review-triggered ADR and TD sequence. Unknown
> original wording and the exact reviewed Git tree are not invented.

**Review date:** 2026-08-11
**Repository revision:** pre-hardening working tree; exact tree identity was not
retained in a governed artifact
**Trigger:** first whole-system independent architecture review
**Scope:** whole local Product architecture
**Reviewer:** independent Principal Engineer posture
**Personas:** architecture, scalability, security, reliability, product

## 1. Executive verdict

**Overall score:** 5.5/10
**Verdict:** CONDITIONAL GO

FORGE had a strong evidence-first philosophy and several credible components,
but its assembled Product path did not yet have one coherent authority chain.
Only architecture-hardening work could proceed. Product expansion, cloud work,
and additional autonomous behavior remained gated.

## 2. Evidence baseline and unknowns

The retained record shows that the review examined current code, storage,
controllers, UI composition, execution, evidence, security, migrations, ADRs,
and tests. Slice certifications were treated as scoped evidence rather than
whole-system proof.

Unknowns retained by this recovery:

- the exact Git tree and dirty-worktree inventory reviewed;
- the original prose and ordering inside each finding;
- the original per-category scorecard; and
- any observation that was not carried into ADR-026 or the corrective TD chain.

## 3. Reconstructed scorecard

The category scores are reconstructed to preserve the accepted 5.5 arithmetic
mean. They are not represented as original score values.

| Category | Score | Review-time limiting condition |
|---|---:|---|
| Ownership clarity | 4.0 | Product and compatibility authorities overlapped |
| Domain coherence | 5.0 | Observation, evidence, execution, Run, and Result identities were not fully separated |
| Layering | 5.0 | Controllers and UI still composed domain truth |
| Persistence integrity | 4.0 | Authority, migration, and immutable-support boundaries were incomplete |
| Failure honesty | 7.0 | Evidence-first vocabulary was strong but not consistently enforced end to end |
| Recovery design | 4.0 | Process ownership and recovery evidence were under-governed |
| Security boundary | 5.0 | Credential and artifact containment required hardening |
| Test/certification architecture | 7.0 | Strong focused tests existed, but integrated proof and baseline classification were weak |
| Scalability | 4.0 | Process-local and SQLite assumptions were implicit |
| Maintainability | 6.0 | Useful modules existed amid compatibility-era duplication |
| Extensibility | 7.0 | App-agnostic direction and provider seams were credible |
| Technical-debt health | 8.0 | Debt was visible and actively governed |
| **Overall** | **5.5** | Unweighted arithmetic mean |

## 4. Review-time architecture assessment

The intended flow was recognizable, but current authority was fragmented:

`crawl -> evidence/Observation-like records -> App Model -> generated tests -> execution -> reports`

Legacy files, controller composition, operation-era provenance, and separate
execution/result interpretations prevented this from being a single sealed
Product authority chain.

## 5. Original RED findings preserved from the accepted record

1. **No single canonical Observation authority.** Active paths could create or
   reconstruct Observation truth outside core, and exact App Model support was
   not sealed.
2. **Execution authority was fragmented.** Execution acceptance, Run attempts,
   Results, aggregation, recovery, and cancellation did not share one immutable
   identity and persistence boundary.
3. **Credential and sensitive-evidence boundaries were incomplete.** Runtime
   credential lifetime, safe messages, structured values, and artifacts needed
   one fail-closed containment contract.
4. **Persistence and migration authority were not sufficiently atomic.**
   Workspace selection, migration context, history, schema, and restart behavior
   could drift.
5. **UI/controller layers still manufactured or reconstructed Product truth.**
   Transport, projection, and authority ownership were not cleanly separated.

## 6. Original AMBER findings preserved from the accepted record

- Test Definition provenance assumed a singular source Observation and could
  not express sealed multi-Observation support.
- Route and authentication semantics were not governed strongly enough for
  truthful executable generation.
- Legacy Observation, execution, healing, and reporting paths were not clearly
  quarantined from Product authority.
- Process-local ownership, cancellation, and recovery were not cloud-safe.
- ADRs and architecture maps did not provide a complete current-state view.
- Certification proved slices but did not yet register accepted baseline debt
  or immutable whole-system review artifacts.

## 7. Strengths recorded by the review

- Evidence-first and weakest-truth principles were materially better than a
  conventional success-defaulting automation stack.
- The App Model supplied a viable domain center.
- Repository/service boundaries and SQLite constraints provided a foundation
  that could be hardened rather than replaced.
- Focused test coverage and technical-debt discipline made architectural repair
  measurable.
- The app-agnostic engine direction and separate UI package were sound goals.

## 8. Principal risks

- A consumer could accept plausible but non-canonical provenance.
- Failure or restart could create lifecycle disagreement across stores.
- Compatibility code could silently regain authority through convenience use.
- Security controls could protect obvious fields while leaking values through
  messages, artifacts, URLs, or runtime state.
- Scaling beyond one host would amplify process-local assumptions before they
  were explicitly designed.

## 9. Persistence, recovery, and security assessment

The review required one workspace-scoped database authority, atomic migrations,
immutable semantic support sets, evidence-based recovery ownership, bounded
credential lifetime, and redacted artifact admission. These were corrective
conditions, not review-time capabilities.

## 10. ADR health assessment

The early ADR set expressed valuable principles, but current-state coverage was
incomplete for execution authority, Observation authority, independent review,
and canonical Test Definition provenance. New governing decisions and dated
implementation notes were required; historical rationale was not to be
rewritten.

## 11. Legacy and compatibility assessment

Legacy paths remained necessary for historical access, but required explicit
labels and one-way quarantine. They could not be treated as fallback Product
authority or silently upgraded into canonical truth.

## 12. Technical-debt assessment

Debt visibility was a strength. The architectural defect was that accepted and
unresolved debt was not always coupled to a machine-comparable baseline or a
single current architecture register.

## 13. Scalability assessment

The reviewed system was a local Product architecture. SQLite workspaces,
process-local coordinators, local cancellation, and process-global registries
were not evidence of multi-process, multi-tenant, distributed-worker, or cloud
readiness.

## 14. Certification assessment

Focused tests were meaningful, but the review called for migration rehearsals,
persistence hashes, secret scans, process-leak checks, real end-to-end proofs,
and immutable architecture-review artifacts at milestone boundaries.

## 15. Simplification direction

The review recommended one authority per truth, read-only projections, transport
only controllers, and explicit compatibility boundaries rather than additional
parallel abstractions.

## What surprised the reviewer?

The strongest surprise retained in the review record was that FORGE's honesty
principles and focused proofs were substantially stronger than its integrated
authority model. The project did not need a new product thesis; it needed the
implementation to obey the thesis consistently.

## 16. Original roadmap

1. Establish independent architecture-review governance.
2. Make workspace database and migration coordination explicit and atomic.
3. Establish canonical Execution, Run, Result, recovery, cancellation, and
   credential boundaries.
4. Establish canonical Observation authority, sealed App Model support,
   read projection, historical import, and legacy quarantine.
5. Introduce Test Definition v2 with sealed support, governed route/auth truth,
   execution-v2 revalidation, and presentation cutover.
6. Reconstruct the resulting architecture into truthful versioned checkpoints.
7. Publish immutable review artifacts and register accepted debt before Product
   expansion.

## 17. Final decision

**CONDITIONAL GO**

Proceed only with the architecture-hardening roadmap. Do not treat the reviewed
state as ready for cloud architecture, broad Product expansion, or autonomous
capability growth.
