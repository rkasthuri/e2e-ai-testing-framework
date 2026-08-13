# FORGE Architecture Review Template

Use this template for the immutable review artifact governed by
[`ADR-026`](../ADR/ADR-026-independent-architecture-review-governance.md). Do
not use it for routine design-fork reviews.

---

## FORGE ARCHITECTURE REVIEW v[MAJOR.MINOR]

**Review date:** [YYYY-MM-DD]
**Repository revision:** [commit hash or explicit uncommitted-state description]
**Trigger:** [milestone or risk]
**Scope:** [whole system or bounded scope]
**Excluded:** [explicit exclusions]
**Next milestone being gated:** [milestone]
**Reviewer(s):** [names/roles]
**Personas covered:** [personas]
**Prior-review exposure before evidence pass:** [none / describe]
**Material reviewer involvement:** [none / describe]

### 1. Executive verdict

**Overall score:** [0.0-10.0]
**Verdict:** [GO / CONDITIONAL GO / NO-GO]

[State the architecture's strongest current property, its principal limiting
condition, what may proceed, and what is gated.]

### 2. Evidence baseline and unknowns

| Evidence | Observation | Date/revision | Limitation |
|---|---|---|---|
| [code/test/schema/command] | [what it proves] | [reference] | [what it does not prove] |

**Unknowns:**

- [Unknown that evidence did not resolve]

### 3. Architecture scorecard

[Insert the completed `ARCHITECTURE_SCORECARD.md` table.]

### 4. Current architecture map

[Show major owners, data flow, and dependency direction.]

Classify every material path:

| Path | Classification | Evidence | Recommendation |
|---|---|---|---|
| [path] | [CURRENT / LEGACY / COMPATIBILITY / DEAD-OBSOLETE] | [reference] | [keep/isolate/deprecate/etc.] |

### 5. Authority and ownership matrix

| Concept | Health | Authority owner | Producers | Consumers | Persistence owner | Presentation owner | Finding |
|---|---|---|---|---|---|---|---|
| [concept] | [RED/AMBER/GREEN] | [owner] | [producer] | [consumer] | [owner] | [owner] | [assessment] |

### 6. Domain and vocabulary assessment

[Assess identity, orthogonality, names, lifecycle/outcome/reason separation,
and contributor ambiguity.]

### 7. Layering and dependency assessment

[Assess route/controller/service/repository boundaries, UI-engine direction,
business logic, persistence leakage, adapters, cycles, and type escapes.]

### 8. Repository, persistence, and migration assessment

[Assess writers, immutability, constraints, transactions, idempotency,
restart behavior, migration safety, and structures likely to fail at scale.]

### 9. ADR health matrix

| ADR | Health | Current evidence | Required action |
|---|---|---|---|
| [ADR] | [CURRENT/HEALTHY, NEEDS CLARIFICATION, SUPERSEDED, CONFLICTING, MISSING IMPLEMENTATION, IMPLEMENTATION DRIFT] | [reference] | [action] |

### 10. Transaction, failure, recovery, and security assessment

| Boundary | Atomic scope | Weakest truth after failure | Restart/retry behavior | Risk |
|---|---|---|---|---|
| [boundary] | [scope] | [truth] | [behavior] | [finding] |

[Add structural secret and trust-boundary findings.]

### 11. Legacy and compatibility assessment

| Path | Classification | Containment/retirement recommendation | Trigger |
|---|---|---|---|
| [path] | [KEEP / ISOLATE / DEPRECATE / MIGRATE LATER / REMOVE] | [recommendation] | [when] |

### 12. Technical-debt register

**RED - blocks the stated milestone**

- [Finding, evidence, required condition]

**AMBER - fix before named future gate**

- [Finding, evidence, gate]

**GREEN - explicitly accepted debt**

- [Tradeoff, containment, revisit trigger]

### 13. Scalability assessment

| Future condition | First boundary likely to fail | Evidence | Low-cost decision now |
|---|---|---|---|
| [condition] | [boundary] | [reference] | [decision/defer] |

### 14. Test and certification architecture

[Assess test layers, migration certification, persistence checks, live proofs,
process-leak checks, CI, baseline-debt handling, and blind spots.]

### 15. Simplification opportunities

[Identify abstractions to delete, merge, narrow, or defer. Do not recommend
complexity solely for hypothetical demand.]

### 16. Top strengths

1. [Meaningful evidence-backed strength]

### 17. Top risks

1. [Meaningful evidence-backed risk]

### What surprised the reviewer?

[Describe evidence that materially contradicted the reviewer's initial model,
including unexpected strengths or risks. If there was no surprising finding,
state explicitly: "Nothing surprised the reviewer in this review."]

### 18. Recommendations and sequenced roadmap

**FIX NOW**

1. [Exact corrective slice]

**FIX BEFORE [MILESTONE]**

1. [Exact corrective slice]

**ACCEPTED DEBT**

1. [Tradeoff and revisit trigger]

### 19. Trend comparison

[Complete `ARCHITECTURE_REVIEW_TREND.md` after current findings and scores are
frozen.]

### 20. Final decision

**[GO / CONDITIONAL GO / NO-GO]**

[State exactly what may proceed, what remains gated, and the evidence required
to lift each condition.]

### NOVA relay

- Overall architecture score: [score]
- Verdict: [GO / CONDITIONAL GO / NO-GO]
- RED findings: [concise list]
- AMBER findings: [concise list]
- Accepted GREEN debt: [concise list]
- Top 5 strengths: [concise list]
- Top 5 risks: [concise list]
- Exact recommended next TDs: [ordered list]
