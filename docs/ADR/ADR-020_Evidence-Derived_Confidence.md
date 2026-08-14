<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-020: Evidence-Derived Confidence

## Status
Proposed

## Date
2026-07-20

## Principle
> "Confidence shall be derived from the strength and boundary of supporting evidence.
> No producer may assign confidence stronger than its observation can justify." — Nova

## Relationship to its siblings — a new decision, not an amendment
Three laws now govern a claim, at three distinct layers. They are siblings; this ADR
amends neither.

- **ADR-015 — provenance.** A claim requires evidence. (*Does a claim have a basis at all?*)
- **ADR-019 — sufficiency.** The evidence must both express the claim and uniquely support
  it. (*Does the evidence justify THIS claim over its competitors?*)
- **ADR-020 — grade (this ADR).** Given a claim that has evidence (015) which is sufficient
  (019), *how strongly may the claim be held?* Confidence is that grade.

A value can satisfy 015 and 019 and still be over-graded: a real observation, uniquely
supporting a real conclusion, stamped `high` when the observation only warrants `medium`.
That over-grading is what this ADR forbids. Cite ADR-015 and ADR-019 as siblings; this is
a new decision at a layer neither covers.

## The rule, unpacked

### 1. Confidence is a property of the OBSERVATION, not of the implementation
A confidence value describes how strongly the *evidence* supports the claim. It is therefore
a function of what was observed and how. A **constant literal is an assertion, not a
derivation** — it encodes the author's belief about the general case, not this run's
evidence. `confidence: 'high'` written into the source is a claim FORGE makes before it has
looked. No producer may assign confidence as a constant where the evidence varies run to run.

### 2. Asymmetry — the substance of the rule
**Positive evidence and absence of evidence must never produce mirror-image confidence.**
Finding a framework marker is *positive evidence* for an SPA. **Not** finding one is *absence
of evidence* — not evidence of absence. The two are not symmetric and must not be graded as
if they were.

> **Worked example (OrangeHRM).** OrangeHRM is a genuine SPA. FORGE's framework-fingerprint
> detector finds **no sufficient fingerprint** on it — the signals it observes fall below the
> accumulation threshold the detector requires — and therefore reads it as **non-SPA**. (This
> states only what the detector *observed*; FORGE has not independently verified OrangeHRM's
> bundle internals, and this ADR asserts no mechanism inside the page — asserting an unverified
> in-page mechanism would be the very defect this ADR is about.) If "found a marker → confident
> SPA" and "found no marker → confident non-SPA" are graded symmetrically, the detector returns
> a **confident wrong answer** for a whole class of real applications. The asymmetry is the fix:
> found → positive grade; not-found → a *default* at the floor, never a confident negative.

### 3. Ceilings are a property of the OBSERVATION METHOD — and only of what it observes
A confidence ceiling is justified by what a method can actually observe, and by nothing else.
It is **not** a property of the detector, the pipeline stage, the newness of the code, or its
sophistication.

> **Nova's caution (normative):** a stronger or more sophisticated method does **not** earn a
> higher ceiling merely by being sophisticated. **Complexity is not evidence; observation
> capability is.** Every ceiling must be justified by what the method actually observes — an
> elaborate heuristic over a single weak sample earns exactly what the single weak sample
> earns, no more.

A method that observes more (a second timepoint, a post-auth state, agreement across pages)
may justify a higher ceiling **because it observed more** — never because it is cleverer.

### 4. `high` is unreachable from a single pre-auth sample
One observation context, at one point in time, before authentication, cannot establish a
durable characteristic of an application. A single pre-auth sample therefore cannot warrant
`high`, regardless of what the sample contained (§2 and §3 together: a positive signal is
still one page, one moment, one pre-auth surface).

This is **not a downgrade** — it is an honest statement of current observation capability.
And it is **not a ceiling baked into the rule**: `high` becomes attainable *without changing
this ADR* the moment a producer gathers corroboration that reaches beyond the single sample
— a second timepoint, a post-auth confirmation, or agreement across multiple pages. The rule
grades what was observed; when more is observed, more may be graded.

### 5. The levels — for single-pre-auth-sample detectors
| level | meaning |
|---|---|
| `high` | **not reachable** from a single pre-auth sample; requires corroboration not gathered today |
| `medium` | a **positive signal was found**; single-sample, so capped here |
| `low` | **no positive signal found**; a fallback value was chosen from a *successful* zero-signal observation |
| `unknown` | the **observation itself failed** — the probe could not run, the page did not load |

The **`low` / `unknown` distinction is load-bearing**: *"I looked and saw nothing"* (`low`)
is not *"I could not look"* (`unknown`). Collapsing them re-creates the §2 defect from the
other side — a failed observation masquerading as a confident-enough default. A `low` follows
a successful observation that found no positive signal; an `unknown` follows an observation
that did not complete.

### 6. Provenance fields — confidence must travel with its basis
A confidence value carries, alongside the grade:

- **`source`** — `evidence-matched` (a positive signal was observed) or `default-fallback`
  (no signal; a safe default was chosen). `default-fallback` MUST pair with the floor
  confidence for that method.
- **`reason`** — names the **specific** evidence (which marker, which count, under which
  settling policy), so the confidence is **auditable rather than asserted**.
- **a stated blind spot** wherever a value was chosen from a zero-signal observation — the
  same mechanism/blind-spot discipline the login-surface observation surface uses (e.g. "a
  signal rendered after the settling window would not be seen here").

> **Nova's risk 4 (why this is mandatory, not optional):** confidence without provenance
> drifts back toward assertion. A bare grade with no `source`/`reason` is indistinguishable
> from a literal within one release; the provenance is what keeps the grade honest over time.

### 7. Reference implementations — ILLUSTRATIVE, not normative
The following implementations currently satisfy this rule and serve as reference examples.
They are described by their **mechanics**, not by file paths or line numbers: if any of them
regresses, this ADR remains the authority — **the rule is normative, the code is not**.

- **Heal-confidence derivation** — grades a healed locator by *aggregating to the weakest*
  constituent: a low-tier strategy that verifies is graded lower than a high-tier one, and a
  low-vision-confidence heal is graded down regardless of resolution. The grade never exceeds
  the weakest input.
- **Verification confidence** — a weighted ratio of passed-over-applicable evidence, returning
  **`null` on insufficient evidence rather than a sentinel** (never `0` or a fake number when
  nothing was measured).
- **Flow-confidence derivation** — grades a flow `observed` **only when every step is a real
  crawled edge** with no grounding warnings; any inferred step or warning caps it at `partial`;
  no steps → `unknown`.
- **AI triage confidence** — uses the model's confidence when the model provides one, records
  an honest fallback with an explicit `confidenceSource` when it does not, and **caps the grade
  at input health** so a verdict about degraded input is never model-graded.

Each earns its grade from what it observed or verified — none assigns a constant.

### 8. Standing review guidance — the risks Nova named
Reviewers of any confidence-producing or confidence-changing code must actively guard against:

- **`medium` as the new reflexive default.** Review must keep asking *"what observation
  justifies this level?"* — never *"which bucket feels appropriate?"* Substituting `medium`
  for `high` by reflex is the same defect one notch down.
- **Observation-method inflation.** A future method must not claim a higher ceiling for being
  newer, larger, or more complex. The ceiling follows what it *observes* (§3).
- **Overfitting the ADR to today's code.** The reference implementations (§7) are examples,
  not the definition. The rule is the authority even when every current implementation changes.
- **Confidence detaching from provenance.** A grade that loses its `source`/`reason` (§6) has
  regressed toward assertion, whatever its numeric value.

## Provenance of this ADR — recorded honestly
This decision was produced by the TD-148 audit sequence (the discriminative-competence audit
of detector→conclusion surfaces). An earlier end-of-day audit had already **seen** the
Bootstrap `confidence: 'high'` literals and **dismissed** them — "pre-existing detector
labels, not a new lie." That dismissal was wrong, and it survived both an audit and a code
review before the dedicated TD-148 sweep named the defect class.

What made it visible was naming it: once "a constant literal is an assertion, not a
derivation" is stated as a rule, the defect is not hard to see — it was hard to see only
*before* it had a name. That is the standing lesson this ADR encodes: the confidence layer had
no law, so over-grading read as ordinary detector code rather than as the ADR-015-adjacent
honesty defect it is.

## Consequences

**Positive.** The confidence layer gains an explicit law it lacked; over-graded literals become
reviewable against a rule rather than defensible as "pre-existing"; `high` becomes an honest
capability target (gather corroboration) instead of a lie; provenance fields make every grade
auditable.

**Costs.** Deriving confidence and carrying `source`/`reason` widens producer output shapes and
their consumers (detection UI, persisted config, reports). Distinguishing `low` (successful
zero-signal) from `unknown` (failed observation) is new work some paths do not do today.
Grading honestly means FORGE will report `medium` where it previously reported `high` — read as
weaker, but true.

**Governed surfaces (per the TD-158 Part-2 audit).** The rule spans at least two subsystems —
the Bootstrap detector cluster (strategy, authType, appType, loginUrl) and the ModuleClassifier
keyword table — which is why this is an ADR rather than a local clarification. Implementation is
sequenced separately (TD-156, TD-157, TD-158) and does not begin until this ADR is cleared.

## Amendment — 2026-07-21 (SCOPE)
This ADR governs confidence attached to **observations** and **evidence-derived
characterizations**. Structural configuration, execution context, and other non-observational
facts are outside its scope and shall not be represented as evidence-bearing detector outputs.

Context: the original "Governed surfaces" note above lists `appType` in the Bootstrap detector
cluster. That was superseded by the TD-163/ADR-021 ownership correction — `appType` is the
**platform**, a structural fact established by the execution context (Bootstrap runs only on a
browser-loaded page), never an observation. It therefore carries no `confidence`/`source`, is not
a `DetectedField`, and left the detection payload and the ground-truth answer-key entirely. The
original decision text above is preserved as written; this amendment is the forward-pointer.

## Implementation note — 2026-07-23 (TD-166: the authType absence-floor is `unknown`, not `low`)
§5's `low` / `unknown` distinction is preserved as written and still governs detectors whose
zero-signal observation is genuinely informative. **For `authType` specifically, the
absence-floor is now `unknown`, not `low`** (auth-settling package). The §5 `low` level assumes
*"I looked and saw nothing"* is a meaningful negative — but for auth a **zero password-field
count carries no information**: an SSO/redirect login presents no password field, and a
framework login that has not hydrated within the observation ceiling reads zero identically
(the TD-173 asymmetry). There is therefore no *successful zero-signal observation* to grade
`low`; the absence is genuinely uninformative, so the floor is `unknown`/`unknown` — never a
false `none`. The detector now records the auth-surface observation (elapsed / ceiling /
provisional-threshold / exceeded-flag) as machine-readable `signals` so the grade stays
auditable (§6). This is a scoped application of §2/§5 to one field, not a change to the levels
themselves; §5's text above stands, and this note is the forward-pointer. Test `A4`
(`verify-adr020-confidence.test.ts`) was updated accordingly. Related: TD-166, TD-173, TD-110.

## Related
ADR-015 (provenance — sibling), ADR-019 (sufficiency — sibling), ADR-016 (carry the
machine-readable evidence/remedy), ADR-018 (aggregate to the weakest truth).
TD-158 (this rule), TD-156 (strategy — decision kept, false confidence removed), TD-157
(appType — honest `low` default is the reference), TD-159 (the positive detector-design
heuristic: verify directly, or preserve uncertainty explicitly).

## Clarification Note — 2026-08-11 (TD-ARCH-003-B0)

[`ADR-027`](ADR-027-canonical-observation-authority-and-evidence-semantics.md)
makes observation method, method version, inspected boundary,
completion, artifacts, conflicts, and correction state durable inputs to any
confidence derivation. `present`, `absent`, and `indeterminate` are Observation
outcomes; `unknown` remains a projected truth/confidence state, not an outcome
stored in place of method results. A gap, partial boundary, unresolved conflict,
or lower-integrity legacy provenance constrains the derived grade and can never
be erased by a newer timestamp or a stronger literal.
