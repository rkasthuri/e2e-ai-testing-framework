<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-015: Provenance Follows Evidence

## Status
Proposed

## Date
2026-07-13

## Principle
> "A document may only assert provenance that is directly supported by the
> evidence it contains. **Provenance follows evidence, never the reverse.**" — Nova

A FORGE artifact (app-model, verification report, generation manifest, run
record, crawl summary) records both *what it found* and *the provenance of the
finding* (timestamps, durations, counts, status, confidence). This ADR governs
the relationship between the two: the provenance may only claim what the evidence
supports. A model that found nothing must not carry a `crawledAt`. A verification
that verified nothing must not report HIGH confidence. A run that executed nothing
must not report `passed`.

## Corollaries

**1. Make the lie unrepresentable, not defended-against. (Finn)**
> "A block of metadata tracking an execution must not exist if the execution's
> side-effects are completely absent from the document."

Wrap execution metadata in an explicit **nullable container** so that reading it
on a no-execution artifact is a **type error**, not a plausible value. Preferred
shape: a never-crawled model has `crawlMetadata: null`, so `model.app.crawlMetadata.crawledAt`
does not type-check — the impossible state cannot be written or read by accident.
This is stronger than a runtime guard: guards can be forgotten by the next
consumer; an unrepresentable state cannot.

**2. An outcome field must never DEFAULT to success.**
Zero evidence must produce **zero confidence** or an explicit **"unknown" /
"insufficient evidence"** — never a passing default. `status`, `score`, and
`confidence` are *derived* from evidence or they are `unknown`; they are never
initialized to a value that reads as healthy. A default that reads as success is
a fabrication (TD-066): it asserts a measurement that was never made.

## The correct existing pattern (converge on this)
**HealStore is already correct** and every fix under this ADR should converge on
its two behaviours:
- `HealStore.ts:112-160` — `save()` is gated by `if (!this.dirty) return`
  (`:113`); `dirty` is set true *only* by a real `recordHeal()`/`retireHeal()`.
  No mutation → no timestamped record is written. (Corollary 1: the artifact does
  not exist when the execution's side-effects are absent.)
- `HealStore.ts:33` — `UNVERIFIED_HEAL_CONFIDENCE = -1`, written (`:143`) instead
  of a plausible `1.0` when no correctness signal exists. (Corollary 2: it refuses
  to assert a confidence it did not earn.)

## Context
Triggered by the **TC-04 finding (2026-07-13)**: onboard's bootstrap persists an
`app-model.json` with `crawledAt`, `crawlDurationMs`, and `classificationRunId`
all set but 0 pages / 0 flows / 0 endpoints — a model asserting a crawl produced
evidence when it produced none. The consumer-side `EmptyModelError` guard
(GeneratorRunner + VerificationRunner) fixed the immediate symptom, but a
follow-on audit (2026-07-13, CC) found the pattern is **systemic** across FORGE's
provenance-bearing artifacts.

## Implicated artifacts (audit 2026-07-13, file:line)

| Artifact | Writer | Violation | Verdict |
|---|---|---|---|
| **app-model.json + crawl-summary + DB `app_models` row** | `CrawlRunner.ts:217, 229-243, 251-258` | No `modelHasContent` guard on the crawl path — persists `crawledAt`/`classificationRunId` + `page_count:0/flow_count:0` when the crawl found nothing. The **origin** of the pattern. | GUILTY |
| **Verification report** | `VerificationRunner.ts:890-895` (score), `942-980` (write) | Score defaults `elementsTotal>0 ? … : 0.6` and `flowsTotal>0 ? … : 0.4` sum to **1.0 → HIGH / "Model is ready"** when 0 elements and 0 flows were verified; DB `runs` row `status:'passed'`. Empty-*result* is unguarded (the `:143` guard covers an empty *model*). | GUILTY — highest severity |
| **Streaming run row** | `ForgeStreamingReporter.ts:193-234`, default `:209` | `outcomeStatus = this.failed > 0 ? 'failed' : 'passed'` — a run reaching `onEnd` with `total_tests:0` is reported `passed`. No "did anything run?" check. (Abort-before-`onEnd` is honest: `running` → `interrupted`.) | GUILTY (partial) |
| **run-history.json + DB run row** | `results-store.ts:230-314, 444`; outcome `:364` | Zero-spec results file → `status:'passed'` + zero stats. True abort refuses to write (`:186-189`). Partially mitigated by the TD-067 `inputHealth`/`inputHealthReason` verdict stamped alongside. | PARTIAL |
| **GenerationManifest** | `GeneratorRunner.ts:315-340`, guard `:152` | Fully-empty model guarded (`EmptyModelError`), but a *partially* empty model (pages > 0, flows = 0) still stamps `generatedAt`/`durationMs`/`classificationRunId` next to `specCount:0`/`observedFlows:0`. No per-category guard. | PARTIAL |
| **HealStore** | `HealStore.ts:112-160, 33` | — | **CLEAN — the reference pattern** |

## Decision
1. Execution metadata is wrapped in an explicit **nullable container** (e.g.
   `app.crawlMetadata: CrawlMetadata | null`); a no-execution artifact carries
   `null`, and the crawl-execution fields (`crawledAt`, `crawledBy`,
   `crawlDurationMs`, `pagesDiscovered`, `pagesSkipped`, `aiBudgetStatus`) live
   *only* inside it. `classificationRunId` is a distinct event (classification,
   not crawl) and is tracked separately, not inside `crawlMetadata`.
2. An explicit `evidenceState` (`'onboarded' | 'crawled' | 'crawled-empty'`)
   records that a crawl ran and whether it found evidence. **An empty crawl is a
   successful execution with a diagnostic result (auth wall, SPA hydration
   timeout, bot blocker) — record it, never erase it.**
3. Every derived-outcome field (verification confidence, run status) is derived
   from evidence or is `unknown`/`insufficient-evidence`. No passing defaults.

## Consequences
- Producer-side fix at the source (`CrawlRunner`) rather than downstream
  consumer guards.
- Schema + SQLite migration required (`app.required` currently hard-requires the
  crawl fields; `app_models.crawled_at` is `NOT NULL`). See the follow-up TDs.
- The verification confidence default (`VerificationRunner.ts:890-895`) and the
  run-outcome default (`ForgeStreamingReporter.ts:209`) are their own fixes, not
  folded into the model work.

## Follow-ups
- **TD-UI-029** (CRITICAL) — VerificationRunner zero-evidence → 1.0/HIGH.
- **TD-UI-030** (High) — ForgeStreamingReporter zero-spec → `passed`.
- **TD-UI-031** (High) — CrawlRunner is the origin; fix the producer. Absorbs the
  original TD-UI-028 scope.
- **TD-UI-032** (Medium) — GenerationManifest partial-empty case.

## Related
TD-066 (earned confidence, never a fabricated score), ADR-006 (Truth-Telling and
Earned Evidence), TD-067 (input freshness / self-health), TC-04 (2026-07-13).

## Clarification Note — 2026-08-11 (TD-ARCH-003-B0)

For App Model provenance, "evidence" now has the exact canonical meaning in
[`ADR-027`](ADR-027-canonical-observation-authority-and-evidence-semantics.md):
immutable support relationships to committed Observation IDs and, for
coverage limits, exact ObservationGap IDs. An operation ID, UI reconstruction,
projection-derived ID, log message, or copied fact payload cannot substitute for
that support. The App Model row and all support relationships for its revision
are committed atomically after their source Observations and gaps are durable.

## Status Audit Note — 2026-08-14 (TD-CONFIG-003)

This ADR remains **Proposed**. Canonical Observation, App Model, Definition,
Execution, Run, and Result paths implement its principle and have contract
tests, but ratification requires no material contradiction across its declared
artifact scope. Open legacy and generation findings still include the
partial-empty GenerationManifest provenance case (TD-UI-032), the legacy
verification/run separation (TD-UI-037), and sentinel/coverage-state follow-ups
(TD-UI-035 and TD-UI-054). Bounded implementation is real; system-wide
ratification would overstate it.
