# TESTING_STRATEGY.md
<!-- version: 1.0 | status: ACTIVE | owner: Raj Kasthuri (AnvilQ Technologies LLC) -->

> This document describes FORGE's testing philosophy, frameworks, execution
> strategy, and validation process — both for the applications FORGE tests,
> and for FORGE itself.
>
> FORGE is simultaneously a testing tool and a tested system. Both dimensions
> are covered here.
>
> ⚠️ Test counts and CI baselines should be verified against the live repo
> with CC before being cited externally.

---

## 1. The Core Philosophy

FORGE's testing philosophy is the same as its product philosophy:

> **Confidence must be earned from observed evidence. It can never be assumed,
> inferred, or fabricated.**

This applies in both directions:

- When FORGE tests an application, it earns confidence through observation —
  crawling, verifying, and measuring against real behaviour in a real browser.
- When FORGE tests itself, it earns confidence through evaluation harnesses —
  measurable, reproducible, ground-truth-anchored tests of its own AI capabilities.

A test that passes without evidence of correctness is not a passing test.
It is an untested assumption wearing a green checkmark.

---

## 2. Two Testing Contexts

FORGE operates in two distinct testing contexts that must be kept conceptually
separate:

### Context A — FORGE Testing Applications

FORGE crawls, models, verifies, and generates tests for target applications
(SauceDemo, OrangeHRM, Restful Booker). This is the product's primary purpose.

### Context B — FORGE Testing Itself

FORGE's own codebase is tested through:
- Unit tests for pipeline scripts and utilities
- Playwright integration tests for generated specs against live apps
- Evaluation harnesses for AI capability validation

Context B is this document's primary focus. Context A (how FORGE tests apps) is
the FORGE pipeline — see the `ONBOARD → … → REPORT` line in root `AGENTS.md` and the
engine modules in `docs/architecture/CODEBASE_MAP.md` §2 (a canonical enumerated
pipeline section is pending — TD-176).

---

## 3. The Testing Stack

| Layer | Tool | What It Tests |
|---|---|---|
| Type checking | TypeScript compiler (`tsc --noEmit`) | Static correctness of all `.ts` / `.tsx` |
| Unit tests | Node.js built-in test runner via `tsx` | Pipeline scripts, utilities, storage layer |
| Integration tests | Playwright (`@playwright/test`) | Generated specs against live apps |
| AI evaluation | Custom eval harnesses in `evals/` | Triage accuracy, generation correctness, healing integrity |
| UI build validation | Vite production build | forge-ui builds without error |

All layers must pass on every push to `main`. A red gate in any layer blocks
the milestone from being called GREEN.

---

## 4. The Test Execution Hierarchy

Tests are organised by speed and scope. Faster gates run first.

```
Level 1 — Type Check (fastest)
  npm run check
  └── tsc --noEmit across src/ and forge-ui/
  └── Must pass before any test runs

Level 2 — Unit Tests
  npm run test:unit
  └── tsx --test scripts/*.test.ts
  └── Pipeline scripts, storage layer, utility functions
  └── Last known baseline: 241/241 passing*

Level 3 — Playwright Integration Suite
  npm run test:all
  └── Full suite excluding @slow / @flaky tagged tests
  └── Runs against live SauceDemo, OrangeHRM, Restful Booker
  └── Last known baseline: 316/316 passing*

Level 4 — AI Evaluation Harnesses
  npm run evals (verify exact command with CC)
  └── Triage eval: ground-truth classification accuracy
  └── Generation eval: behavioural correctness of generated specs
  └── Healing eval: selector repair correctness

Level 5 — forge-ui Production Build
  npm run build (within forge-ui/)
  └── Vite build must exit 0
  └── Catches type errors and import failures that tsc may miss
```

*Verify current counts with CC before citing.

---

## 5. Execution Modes

FORGE supports several test execution modes depending on the need:

| Command | Mode | When to use |
|---|---|---|
| `npm run test` | Smoke (`--smoke`) | Fast sanity check — critical paths only |
| `npm run test:all` | Stable | Daily CI — excludes `@slow` / `@flaky` |
| `npm run test:full` | Full | Pre-release — everything including slow tests |
| `npm run test:flaky` | Flaky isolation | Debugging non-deterministic tests |
| `npm run test:unit` | Unit only | Fast feedback during development |
| `npm run test:api` | API suite | Restful Booker endpoint tests |
| `npm run test:smoke` | Smoke (UI) | Login + e2e journey — fastest coverage check |

Area-specific execution (SauceDemo only):

| Command | Scope |
|---|---|
| `npm run test:login` | Login flow |
| `npm run test:inventory` | Product listing |
| `npm run test:cart` | Cart operations |
| `npm run test:checkout` | Checkout flow |
| `npm run test:e2e` | Full user journey |
| `npm run test:edge` | Edge cases (locked user, empty cart) |

---

## 6. The Evaluation Harness System

The evaluation harness system is what separates FORGE from traditional automation
frameworks. Every AI capability in FORGE has a measurable eval — not a manual
spot-check, not a qualitative assessment, but a reproducible test with a
ground-truth dataset and a defined pass threshold.

### Why Evals Matter

The HONEST / CORRECT distinction (see `GLOSSARY.md`) requires two independent
verification dimensions:

- **Runtime honesty signals** (confidence tiers, `insufficient-evidence` outputs)
  verify that FORGE reports truthfully — the HONEST dimension
- **Evaluation harnesses** verify that FORGE measures accurately — the CORRECT
  dimension

Neither alone is sufficient. A system that reports honestly but measures wrong
gives users accurate reports of incorrect results. Evals provide the CORRECT
dimension that honesty signals alone cannot.

### Eval Harness Structure

Each eval harness contains:
```
Ground-truth dataset    — labelled examples with known correct answers
Harness runner          — executes FORGE's AI component against the dataset
Scorer                  — compares output to ground truth
Reporter                — produces accuracy metrics and failure analysis
Pass threshold          — minimum accuracy required for the capability to be GREEN
```

### Current Eval Harnesses

| Harness | What it measures | Last known result |
|---|---|---|
| Triage eval | Accuracy of 5-category failure classification | 97.4% accuracy · 0% false app-bug rate* |
| Generation eval | Behavioural correctness of generated Playwright specs | 100% pass rate on SauceDemo suite* |
| Healing eval | Correctness of automated selector repair | 100% correct heal rate on validation set* |

*Verify current figures by running the eval harnesses with CC.

### The No-Eval Rule

**No AI capability is considered shipped without an evaluation harness.**

This is non-negotiable. A new AI feature without an eval has no CORRECT
dimension — it may report honestly about incorrect behaviour, and nobody
would know. The eval harness is not optional documentation; it is the
evidence that the capability does what it claims.

---

## 7. Test Tagging Strategy

Tests are tagged to support selective execution:

| Tag | Meaning | Included in `test:all`? |
|---|---|---|
| *(no tag)* | Standard stable test | ✅ Yes |
| `@slow` | Takes significantly longer than average | ❌ No — `test:full` only |
| `@flaky` | Known non-deterministic behaviour | ❌ No — `test:flaky` isolation only |

**Tagging discipline:**
- Do not tag a test `@flaky` as a permanent state. A flaky test is a defect
  signal — tag it, investigate it, fix it or retire it.
- `FlakyPredictor` (Phase 8) provides risk scores from historical run data.
  Tests above threshold are candidates for `@flaky` tagging.
- `@slow` is acceptable for tests that require real wait times (e.g. file uploads,
  page loads with real network latency).

---

## 8. Live App Testing — Constraints and Honesty

FORGE's integration suite runs against live applications on the public internet.
This introduces constraints that must be understood:

### L-001 Constraint (TD-013)
Stateful pages are visited in their default empty state. Cart, checkout, and
post-action states are not pre-populated. Tests for these pages have reduced
coverage proportional to the state they require. See `KNOWN_LIMITATIONS.md` L-001.

### Network Dependency
Tests that rely on live applications are subject to network conditions, demo
site availability, and demo site state changes. Failures classified as
`infra-defect` by the triage engine are frequently caused by this dependency.

### Demo Site Changes
SauceDemo, OrangeHRM, and Restful Booker are third-party demo applications.
Their operators may change structure, content, or behaviour at any time.
Such changes will produce `app-bug` triage classifications — which is correct,
since from FORGE's perspective, the application changed.

---

## 9. CI/CD Testing Gates

Every push to `main` triggers the full CI gate sequence:

```
1. tsc --noEmit          (root)          ← must pass
2. tsc --noEmit          (forge-ui/)     ← must pass
3. npm run test:unit                     ← must pass (241/241)*
4. Playwright suite      (test:all)      ← must pass (316/316)*
5. forge-ui build        (vite build)    ← must exit 0
```

**One CI run per logical milestone.** CI runs cost real API calls and time.
Do not push docs-only changes or single-file changes that belong to a larger
logical unit — batch them into the milestone commit.

**A red CI run means:**
- The milestone is not GREEN
- No Rule 9 will be issued until CI is green
- The implementation agent investigates and fixes before anything else proceeds

---

## 10. Flaky Test Management

Flakiness is a first-class concern in FORGE — not because FORGE produces
flaky tests, but because the applications it tests are subject to timing,
network, and state variability.

### Detection
`FlakyPredictor` (Phase 8) risk-scores every test from historical run data.
Tests that fail intermittently without a consistent cause accumulate flakiness
score over time.

### Classification
The triage engine classifies non-deterministic failures as `flaky` — distinct
from `app-bug`, `test-defect`, and `infra-defect`. This prevents flaky failures
from inflating app-bug counts.

### Handling
```
Flakiness detected
      │
      ├── Score below threshold → monitor, log in FlakyPredictor
      │
      ├── Score above threshold → tag @flaky, exclude from test:all
      │
      └── Persistent flakiness → investigate root cause
                │
                ├── Timing issue → add wait strategy
                ├── State dependency → address via agentic prereq (Phase 5)
                └── External dependency → document in KNOWN_LIMITATIONS.md
```

---

## 11. Visual and Performance Testing

### Visual Regression
FORGE has visual baseline and comparison capabilities for SauceDemo:

| Command | Purpose |
|---|---|
| `npm run visual:baseline` | Capture baseline screenshots |
| `npm run visual:compare` | Compare current against baseline |
| `npm run visual:cross-browser` | Cross-browser visual comparison |

**Scope:** SauceDemo only at present. Not part of the core CI gate.

### Performance Baseline
| Command | Purpose |
|---|---|
| `npm run perf:baseline` | Record performance metrics baseline |
| `npm run perf:compare` | Compare current against baseline |

**Scope:** SauceDemo only. Not part of the core CI gate.

**Important distinction:** `VisionHealer` uses visual similarity for healing
selector failures — it is not a visual regression test suite. These are
different capabilities.

---

## 12. What "GREEN" Means for a Test or Capability

A test or capability is GREEN only when both dimensions are satisfied:

| Dimension | How it is verified |
|---|---|
| **Honest** | The test reports truthfully — surfaces errors, does not fabricate passes |
| **Correct** | The test measures accurately — the assertion is grounded in observed behaviour |

**Common failure modes to avoid:**

- A test that always passes because its assertion is too weak (correct but not honest
  about coverage)
- A test that passes against a stub instead of the live app (honest about the stub,
  not correct about the app)
- An eval that produces good numbers on a dataset that does not represent real
  failures (honest about the dataset, not correct about production)
- A triage result that correctly classifies a failure but the underlying run data
  is wrong (correct classification, wrong input)

---

## 13. Adding New Tests — Checklist

When adding tests to the FORGE codebase — whether for the framework itself or
as generated tests for a new application:

```
□ Test is grounded in observed behaviour — not in assumed behaviour
□ Assertion confidence matches evidence quality
□ Test does not assert things the app model did not verify
□ New AI capability has an evaluation harness before it is called shipped
□ Flaky tests are tagged @flaky — not left untagged in the stable suite
□ Slow tests are tagged @slow — not left to slow down test:all
□ Copyright header present on any new .ts / .tsx test file
□ npm run check passes after the new test is added
□ npm run test:unit passes (if unit test added)
□ CI green before milestone is called complete
```

---

*FORGE™ — AI-Augmented Quality Engineering Platform*
*AnvilQ Technologies LLC — Copyright © 2026 Raj Kasthuri*
