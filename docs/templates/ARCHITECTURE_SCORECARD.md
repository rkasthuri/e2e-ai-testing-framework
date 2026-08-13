# FORGE Architecture Scorecard Template

This scorecard is governed by
[`ADR-026`](../ADR/ADR-026-independent-architecture-review-governance.md).
Complete it from current evidence before reading prior-review scores.

## Scoring anchors

| Score | Meaning |
|---:|---|
| 0 | Authority or capability is absent, deceptive, or fundamentally unsafe |
| 2 | Critical structural defects dominate; normal expansion is unsafe |
| 4 | Material defects and ambiguity require correction before the stated milestone |
| 6 | Workable within explicit constraints, with significant known debt |
| 8 | Strong and evidence-backed, with contained limitations |
| 10 | Exceptional coherence across implementation, failure paths, operations, and scale |

Scores may use one decimal place. Every score below 9 requires an
evidence-backed explanation. Do not move the anchors, category definitions, or
weights after examining results.

## Scorecard

| Category | Score | Evidence | Explanation / limiting condition |
|---|---:|---|---|
| Ownership clarity | [0-10] | [references] | [single vs competing authorities] |
| Domain coherence | [0-10] | [references] | [identity, terminology, orthogonality] |
| Layering | [0-10] | [references] | [dependency and responsibility boundaries] |
| Persistence integrity | [0-10] | [references] | [constraints, writers, migration safety] |
| Failure honesty | [0-10] | [references] | [weakest truth and non-fabrication] |
| Recovery design | [0-10] | [references] | [restart, reconciliation, idempotency] |
| Security boundary | [0-10] | [references] | [trust, secrets, tenants, disclosure] |
| Test/certification architecture | [0-10] | [references] | [proof quality and blind spots] |
| Scalability | [0-10] | [references] | [first capacity/concurrency boundaries] |
| Maintainability | [0-10] | [references] | [complexity and change safety] |
| Extensibility | [0-10] | [references] | [real extension seams vs hardcoding] |
| Technical-debt health | [0-10] | [references] | [visibility, containment, resolution discipline] |

**Overall score:** [unweighted arithmetic mean]

**Alternative weighting approved before evidence collection:** [none / exact
weights and approving decision]

## Score challenge

- Strongest evidence that the overall score is too high: [evidence]
- Strongest evidence that the overall score is too low: [evidence]
- Category with the greatest uncertainty: [category and why]
- Critical finding not represented by the average: [finding]

The verdict is recorded separately. A high average cannot neutralize a critical
RED finding.
