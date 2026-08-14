<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-018: Aggregate to the Weakest Truth

## Status
Accepted (ratified — Nova + Finn)

## Date
2026-07-15

## Principle
> A composite verdict can be no stronger than its weakest constituent. When
> results combine, aggregate to the weakest truth: **failed > could-not-verify >
> passed.** A demonstrated failure dominates an inability to verify, which
> dominates a clean pass. Never let a part FORGE could not verify — or one that
> failed — be absorbed into a green whole.
> — derived from the Verify LIEs milestone (commit `4a3573c`)

This ADR is **downstream of ADR-015 and ADR-017, and a sibling of ADR-011.**
ADR-017 (What FORGE Observes, FORGE Keeps) guarantees the constituent evidence
survives; ADR-015 (Provenance Follows Evidence) guarantees a record asserts only
what its evidence supports; ADR-011 (Verify Before Assert) guarantees a claim was
actually checked. ADR-018 governs the step those three leave open: **how many
honest constituents combine into one verdict.** The evidence is kept (017), each
part asserts only what it proved (015), each was checked (011) — and the
aggregate must still not over-claim. Aggregation is where the last phantom-green
hides.

## Context
Triggered by the **Verify LIEs milestone (2026-07-15, commit `4a3573c`)** — two
phantom-green defects in `VerificationRunner`, each an aggregation failure:

- **LIE-1** — an API endpoint returning any `status < 500` (all 4xx included)
  recorded `status:'passed'`, feeding `elementsPassed` and lifting
  `confidenceScore`. A `404` (wrong path) and a `401/403` (auth wall FORGE could
  not clear) both read green.
- **LIE-2** — a flow step that executed **no assertion** (missing `elementId`,
  unknown action, empty navigation pattern) did not throw, so the tally counted
  it as a passed step; a flow of only such steps reached `status:'passed'` and
  greened `flowsPassed`.

Both share one shape: **a constituent that was not a proven success was absorbed
into a passing aggregate.** The fix routed each non-success to an explicit
`could-not-verify` state and made the composite take the weakest present verdict.
This is not a Verify-specific patch — the same absorption occurs anywhere FORGE
rolls sub-results into a headline: pages into an app score, checks into a page
verdict, endpoints into an API verdict, runs into a pass-rate. ADR-018 names the
rule so the next aggregation is built honest rather than patched later.

## Decision
Every composite verdict FORGE produces obeys the **truth lattice**, a total order
on outcome by strength of positive claim:

```
passed              — proven success (all evidence affirms it)
  ⊐ could-not-verify — no claim possible (FORGE could not look / execute / decide)
  ⊐ failed           — proven defect (evidence contradicts success)
```

An aggregate's verdict is the **weakest** verdict present among its
constituents — equivalently, evaluated in **lattice order, most-severe first**:
if any constituent **failed**, the aggregate failed; else if any is
**could-not-verify**, the aggregate is could-not-verify; else **passed**. A
demonstrated failure is a harder fact than an inability to verify, so failure
dominates; and you cannot call a whole "passed" while any part is unproven, so
could-not-verify dominates passed.

Three consequences bind the implementation:

1. **`could-not-verify` is a first-class state, not a rounding of pass or fail.**
   It counts in the denominator (so the score drops honestly) but never in the
   pass numerator, and never in the fail count. It blocks readiness/promotion but
   is **labeled distinctly** — never rendered as a failure (a phantom-red is the
   same dishonesty as a phantom-green, inverted).
2. **The default under absent evidence is the weakest truth, never the
   strongest.** Absence of a success signal is not success: `status < 500` is not
   proof of a correct response; a step that ran no assertion is not a passed step.
   (This is ADR-015's honest floor applied to aggregation.)
3. **The rule composes.** It is applied identically at every level of rollup —
   step → flow → run, element/endpoint → page → app — with no per-level
   redefinition.

### Corollaries

**Corollary 1 — Reading legacy / mixed records (failed-first).**
When reading a record that carries both a legacy binary status and the newer
non-passing signals, the signals override a stale `'passed'`: a row marked
`status:'passed'` that also carries `failedAtStep` is **failed**; one that carries
`unverifiedAtStep` (and no `failedAtStep`) is **could-not-verify**. The evaluation
order is the lattice order — check `failedAtStep` **first**, then
`unverifiedAtStep`, then default to `passed`. (A genuine failure **dominates** an
unverified step; do **not** let could-not-verify override failed.)

This precedence matches the shipped `finalizeFlowStatus()` **exactly** — the
written law and the running code must not diverge. If either changes, both change
together.

**Corollary 2 — could-not-verify is excluded from both tallies.**
A composite's pass ratio is `passed / total`; a could-not-verify constituent is in
`total` but not in `passed`, and is **not** added to the failed count. The
readiness gate treats a could-not-verify the way it treats a failure — it blocks
"ready" — while the surfaced message names it as could-not-verify, not failed.
(Shipped: `assessReadiness()` mirrors this on the element and flow axes, adjacent
and identical.)

**Corollary 3 — every rollup is an aggregation site.**
Any place FORGE reduces a set of outcomes to one headline is governed by this
ADR: element/endpoint checks → page/API verdict; flow steps → flow verdict; page
verdicts → app `confidenceScore`; run outcomes → pass-rate/trend. A new rollup
that only knows `passed`/`failed` is a defect the first time a constituent is
genuinely unverifiable.

**Corollary 4 — refinement invariance (migration safety).**
Introducing a finer observation (e.g. per-step outcomes beneath a flow) does not
change any existing aggregate's meaning; it only supplies more precise
constituents to the same rule. This migration is safe because the truth lattice
is invariant across levels of abstraction: refining observation granularity
(flow→step) does **NOT** redefine the aggregation semantics. The same rule
composes at every level — we refine observations, we never redefine truth.

## What this ADR does NOT mandate
ADR-018 does **NOT** mandate tri-state modeling everywhere. Some domains are
genuinely binary — if `fs.stat()` succeeds, the file exists; there is no
meaningful could-not-verify. Manufacturing uncertainty where the evidence
contains none is its own dishonesty. The mandate is narrower and precise: **WHEN
evidence admits a distinct unverified state, PRESERVE it** rather than collapsing
it into pass or fail. Represent the distinctions reality requires — no more, no
fewer.

## Reference implementation
`src/core/onboarding/VerificationRunner.ts` (commit `4a3573c`):
- **`finalizeFlowStatus(failedAtStep, unverifiedAtStep)`** — the lattice
  precedence in code (failed → could-not-verify → passed); the canonical form of
  Corollary 1.
- **`assessReadiness(...)`** — the aggregation of element and flow axes into the
  readiness verdict + gap messages: could-not-verify excluded from the failed
  count, blocks `modelReady`, labeled distinctly (Corollary 2).
- Supporting: `classifyEndpointResult()` (LIE-1 routing — non-2xx → the weakest
  honest state) and the three-way `verifyFlow` tally that produces
  `unverifiedAtStep` (LIE-2). Proven by `scripts/verify-phantom-green.test.ts`
  V1–V13. CI-witnessed on run `29436813523`.

## Consequences
1. **Reviews gain an aggregation question.** Beyond correct / honest /
   remedy-bearing / evidence-kept: *"When this code combines sub-results, does the
   aggregate take the weakest present verdict — and is a could-not-verify kept
   distinct from both pass and fail?"*
2. **Rollup types may need a third state.** Where a composite today is
   `'passed' | 'failed'`, satisfying this ADR where evidence warrants it means
   widening to include `'could-not-verify'` — a type/schema change, the same
   boundary ADR-017 widens. (Bounded by "What this ADR does NOT mandate": only
   where the evidence admits the distinction.)
3. **The written law tracks the code.** `finalizeFlowStatus()` is the reference;
   this ADR and that function are edited together (Corollary 1).
4. **Phantom-green and phantom-red are both closed at the aggregation boundary.**
   A part FORGE could not verify no longer inflates a green score, and is never
   punished as a red failure it did not earn.

## Implementation note - 2026-08-11 (TD-ARCH-002)

Product Execution/Run/Result truth now has one implementation owner:
`src/core/execution/PersistedEvidenceAggregator.ts`. The owner reads only
persisted Execution, manifest, lifecycle, Product Run, and immutable Product
Result evidence. Terminalization, recovery, cancellation, Results projection,
and status all consume its typed result; none may independently derive Product
truth.

The Product tie-break is explicit and deterministic: failed Results dominate
all missing or unverified evidence; otherwise persisted `could_not_verify`
dominates a manifest gap; otherwise a manifest gap yields
`expected_result_missing`; only a complete all-pass manifest yields passed.
Reasons come from the first applicable Result in immutable manifest order. A
missing Result remains absent and is never manufactured for aggregation.

`VerificationRunner` remains the reference implementation for its onboarding
domain. It is no longer a claim that one function owns every FORGE aggregation
domain. Product execution's canonical owner and permanent cross-path invariant
are documented in
`docs/architecture/CANONICAL_PERSISTED_EVIDENCE_AGGREGATION.md`.

## Relationship to other ADRs
- **ADR-017 (What FORGE Observes, FORGE Keeps)** — supplies the honest
  constituents. ADR-018 governs how they combine. Without 017 there is nothing
  truthful to aggregate; without 018 truthful parts can still sum to a lie.
- **ADR-015 (Provenance Follows Evidence)** — a record asserts only what its
  evidence supports. ADR-018 is 015 at the composite: the aggregate asserts only
  as much as its weakest constituent supports.
- **ADR-011 (Verify Before Assert)** — a claim must be checked before it is made.
  ADR-018 handles the case 011 exposes: a step that could **not** be checked is
  `could-not-verify`, not a silent pass.
- **ADR-016 (Map the Gap, Prescribe the Remedy)** — a could-not-verify constituent
  is a gap; it carries the remedy that names the input which would let FORGE
  verify it (endpoint `responses` contract for LIE-1; a reachable selector /
  agentic exploration for LIE-2).

## Follow-ups
- **Crawl LIEs milestone** — the next aggregation sites (App Model rollups:
  `pagesSkipped`, stubbed `diff[]`, `aiBudgetStatus`, `crawled_by` on a no-crawl
  stub) audited against this ADR. This ADR is docs-only and batches with that
  milestone's push, not solo.
- **TD-UI-053** — a dedicated machine-readable `remedy` field on
  `ElementResult`/`FlowResult` (today the could-not-verify remedy lives in
  `error`); the ADR-016 home for Corollary-2 gaps.
- **Ingestion P1 (Baseline #1 / TD-UI-047)** — `getPassRateSince` computes
  `passed/rows.length` on `status` alone; the pass-rate rollup must apply this
  lattice (a no-run / could-not-verify run is not a pass).

## Related
ADR-017 (What FORGE Observes, FORGE Keeps), ADR-015 (Provenance Follows Evidence),
ADR-016 (Map the Gap, Prescribe the Remedy), ADR-011 (Verify Before Assert),
ADR-006 (Truth-Telling and Earned Evidence). Verify LIEs milestone (commit
`4a3573c`, CI run `29436813523`), `scripts/verify-phantom-green.test.ts` (V1–V13),
TD-UI-047 (Ingestion P1 pass-rate), TD-UI-053 (dedicated remedy field).
