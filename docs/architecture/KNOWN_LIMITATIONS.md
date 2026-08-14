# KNOWN_LIMITATIONS.md
<!-- version: 1.0 | status: RETAINED SNAPSHOT | owner: Raj Kasthuri (AnvilQ Technologies LLC) -->

> **Current authority:**
> [`CURRENT_LIMITATIONS.md`](CURRENT_LIMITATIONS.md) is the single current
> limitations register. This older detailed catalog is retained for dated
> feature-level context and must not be used as a second current-status source.

> This document preserves the earlier feature-level limitation catalog. Verify
> every entry against the current authority before acting on it.
>
> Limitations are not failures — many are deliberate sequencing decisions.
> Every entry states: what the limitation is, why it exists, and what (if
> anything) is planned to address it.
>
> ⚠️ Verify TD numbers and current status against on-disk TECH_DEBT.md.
> The project-file copy is stale and must not be cited for TD status.

---

## 1. Crawl Limitations

---

### L-001 — No Stateful Page Setup Before Verification (TD-013)

**What it means:**
`VerificationRunner` navigates directly to a page URL with no prerequisite state
setup. If a page requires prior state to be meaningful — a populated cart, a
completed form, a logged-in session with specific data — FORGE visits it in its
default empty state.

**Concrete example:**
SauceDemo's `cart.html` fails every cart-item element check when visited directly,
because the cart is empty. The selectors and the test logic are correct — the
page simply has no items to find.

**Why it exists:**
Stateful page setup requires the crawler to know which actions must precede a
page visit — and to execute them reliably before verification. This is a non-
trivial orchestration problem that the current scripted crawler cannot solve.

**What it means in practice:**
- Tests for stateful pages (cart, checkout, profile after edit, dashboard after
  data entry) may have lower coverage than their selector correctness would suggest
- Verification results for stateful pages should be interpreted with this constraint
  in mind

**Resolution path:**
Agentic crawl (Phase 5) — the agent will execute prerequisite steps (add to cart,
complete a form, etc.) before visiting the target page. This is the primary
motivation for the agentic architecture.

**Priority:** High

---

### L-002 — Single-Hop Discovery in SPAStrategy (TD-014)

**What it means:**
`SPAStrategy.crawl()` discovers pages one hop from the start URL but does not
recurse into links found on those discovered pages. Second-hop pages are missed.

**Concrete example:**
OrangeHRM misses second-hop pages such as `recruitment/viewCandidates`,
`pim/viewPersonalDetails/empNumber/7`, and
`performance/searchEvaluatePerformanceReview`. Page count varies 18–21 depending
on crawl timing.

**Why it exists:**
Recursive multi-hop discovery with a depth budget has real AI-budget and crawl-
time tradeoffs. The decision was made deliberately — this is not a bug that
slipped through, it is a deferred design decision.

**What it means in practice:**
- OrangeHRM coverage is incomplete — some pages are not modelled or tested
- Any SPA with deep navigation hierarchies will have similar gaps
- Page count metrics for SPA targets are underestimates

**Resolution path:**
Needs a design conversation before implementation. Recursive/multi-hop discovery
with a configurable depth budget. Nova consultation required before any code.

**Priority:** Medium

---

### L-003 — No Bootstrap Mode (In Progress)

**What it means:**
Onboarding a new application requires manual creation of an onboarding config
file before any FORGE command can run. There is no way to point FORGE at a URL
and have it figure out the app type, auth requirements, and crawl strategy
automatically.

**Current required sequence:**
```
1. Manually create: src/apps/<platform>/<type>/<appname>/onboarding.<appname>.config.ts
2. npm run onboard -- --app=<name>
```

**What it means in practice:**
- New app onboarding has a manual setup step that requires understanding the
  config schema
- The experience is not "point and shoot" — it requires upfront configuration

**Resolution path:**
Bootstrap Mode (🔄 in progress) — auto-detects app type, auth, and crawl
strategy from the live page, generates the config file, and proceeds to crawl.

**Priority:** Medium (in progress)

---

### L-004 — lockedUser Role Auth Occasionally Fails (TD-015)

**What it means:**
The `lockedUser` role on SauceDemo occasionally reports auth failure
(`Auth may have failed for role lockedUser`).

**Why it exists:**
Untriaged. Unclear whether this is a FORGE framework bug or the live SauceDemo
`lockedUser` account genuinely being in a locked state on the demo site.

**What it means in practice:**
- `lockedUser` role tests may produce intermittent auth failures
- Do not assume the cause without checking the live SauceDemo account state first

**Resolution path:**
Triage required — check whether the SauceDemo account is genuinely locked before
assuming a framework bug.

**Priority:** Low

---

## 2. Verification Limitations

---

### L-005 — Confidence Cannot Exceed Prerequisite Confidence

**What it means:**
This is an intentional architectural constraint, not a bug. If a page requires
a login to reach, and the login evidence has a medium confidence tier, then all
assertions about that page are capped at medium confidence — regardless of how
stable the selectors are.

**What it means in practice:**
- Pages behind auth will have assertion confidence capped by the auth flow
  confidence tier
- This is the correct behaviour — the evidence chain is only as strong as its
  weakest link

**Resolution path:**
None — this is by design. Improving auth flow confidence (more stable selectors
in the auth steps) will raise the cap for downstream pages.

---

### L-006 — Text-Type Selectors Are Fragile

**What it means:**
FORGE's lowest-confidence selector strategy is text content matching. Text
content changes with copy updates, localisation, and A/B tests. Tests that rely
on text selectors are more likely to break than tests using `data-test` or `id`.

**What it means in practice:**
- Elements without `data-test`, `id`, or `aria-label` will be selected by text
- These tests are more fragile than the rest of the suite
- The application owner (not FORGE) controls how stable these selectors are

**Resolution path:**
The application should add `data-test` attributes to interactive elements.
FORGE can flag elements that only have text selectors as lower-confidence.

---

## 3. Triage Limitations

---

### L-007 — Triage Cannot Exceed Input Quality

**What it means:**
The AI triage classifier is evidence-gated. If the failure context does not
contain enough information to distinguish between two or more categories, the
output is `insufficient-evidence`. The classifier will not guess.

**What it means in practice:**
- Some failures will be classified as `insufficient-evidence` — this is correct
- `insufficient-evidence` is not a triage failure; it is an honest boundary
- Improving the quality of failure context (richer logs, DOM snapshots, error
  traces) will reduce `insufficient-evidence` rates

**Resolution path:**
Richer failure context collection during Phase 5 (Execute) — more DOM state,
more console output, more network context captured at failure time.

---

### L-008 — Identity Divergence Detection Retired

**What it means:**
FORGE no longer classifies failures as identity-divergence events. This
capability was retired (TD-148) because the detector could not satisfy
discriminative competence (ADR-019 Axis 2) — every conclusion it drew was
about the application behind the login wall, which it had never observed.

**What it means in practice:**
- Failures that might have previously been labelled identity-divergence will
  now be classified by the evidence that is actually available
- The login-surface observer produces scoped, honest observations with explicit
  non-implications rather than overreaching conclusions

**Resolution path:**
None — this is the correct state. "Narrower, not weaker."

---

## 4. Healing Limitations

---

### L-009 — Healing Cannot Promote a Lower-Confidence Selector

**What it means:**
FORGE's self-healing will never replace a `data-test` or `id` selector with a
`text` selector, even if the text selector successfully locates the element.
Healing always moves up the confidence hierarchy, never down.

**What it means in practice:**
- If an element loses its `data-test` attribute and the only remaining strategy
  is text matching, FORGE will log the heal event but will not promote the text
  match to primary
- The test will remain at the previous confidence tier until a better selector
  is available

**Resolution path:**
The application should restore the `data-test` attribute. FORGE will detect it
and re-promote the selector on next verification.

---

### L-010 — Healing Is Scoped to Selector Changes

**What it means:**
FORGE's self-healing repairs broken selectors — it detects that an element
moved or changed and re-points the test to it. It does not heal:
- Changes to application logic or business rules
- New required fields or form steps added to a flow
- Structural page changes (a page split into two pages)
- API contract changes beyond field-level drift

**What it means in practice:**
- Non-selector changes will still produce test failures that require human review
- FORGE classifies these correctly as `app-bug` or `test-defect` rather than
  attempting to heal them
- This is the correct scope for automated healing

**Resolution path:**
None — this is by design. Healing beyond selector repair would require FORGE
to understand business intent, which it does not claim.

---

## 5. Platform UI Limitations

---

### L-011 — Three Tabs Are Stubs

**What it means:**
Results, Insights, and Settings tabs in forge-ui are currently stubs —
placeholders with no functional content.

**What it means in practice:**
- Run results, trend charts, coverage insights, and settings cannot be accessed
  via the UI yet
- All these data exist in SQLite and are accessible via CLI commands
- The UI surface for them has not been built

**Resolution path:**
Phase 4 roadmap — after Tests tab (TD-UI-003) is complete.

---

### L-012 — crawlDiagnostics Not Rendered in forge-ui (TD-UI-064)

**What it means:**
The crawl phase produces diagnostic data (`crawlDiagnostics`) that is written
to the data store but not rendered anywhere in the forge-ui interface.

**What it means in practice:**
- Crawl diagnostic information is only accessible via CLI or direct DB query
- "An honest observation nobody can read has not finished shipping"

**Resolution path:**
TD-UI-064 — logged, not yet scheduled.

---

## 6. Pipeline Scope Limitations

---

### L-013 — Mobile and IoT Testing Not Built

**What it means:**
FORGE's onboarding config supports `appType` values of `mobile-android`,
`mobile-ios`, and `iot` — but these produce stub models only. No actual
crawl, model, or test generation capability exists for these surfaces.

**What it means in practice:**
- Do not attempt to onboard a mobile or IoT application — it will produce
  an empty stub, not a real model
- These are future directions, not current capabilities

**Resolution path:**
Phase 10 (Extended Surface Coverage) — planned, not yet started.

---

### L-014 — No Governance / Approval Stage

**What it means:**
FORGE has no review or approval workflow between test generation and test
execution. Generated tests are promoted directly to the execution suite without
a human or policy gate.

**What it means in practice:**
- Generated tests run immediately — there is no holding area for review
- Quality of generated tests depends entirely on model quality and generator
  correctness
- Teams that need a review gate before tests run must implement it externally

**Resolution path:**
Phase 6 (Governance) — Review/Approval workflow and policy engine. Planned.

---

### L-015 — No Multi-Model Cost Routing

**What it means:**
All AI calls in FORGE use the same Claude Sonnet model regardless of task
complexity or stakes. There is no tiered routing that directs lower-stakes tasks
to a cheaper/faster model.

**What it means in practice:**
- AI costs are higher than necessary for lower-stakes tasks (e.g. element naming
  on simple pages)
- Local Ollama is in the stack but not wired to any production pipeline path

**Resolution path:**
Phase 7 (Multi-Model Cost Routing) — exploratory. Gate: TD-080 must be resolved
first so the eval harness can measure the A/B comparison accurately.

---

## 7. CI and Infrastructure Limitations

---

### L-016 — CI Trend Dashboard Always Shows 1 Run (TD-003)

**What it means:**
The CI trend dashboard always shows only one run due to a Docker container
path mismatch with the cache approach. Trend persistence across CI runs is broken.

**Status:** Unconfirmed — verify whether this still reproduces after later
CI fixes (Microsoft Playwright Docker image switch). Check before working on it.

**Priority:** Low

---

### L-017 — Firefox Not a CI Target (TD-LOW-002)

**What it means:**
FORGE's CI pipeline runs tests against Chromium only. WebKit is installed
locally but excluded from CI browser installs to reduce CI install time.
Firefox is not configured as an execution target at all.

**What it means in practice:**
- Cross-browser coverage is Chromium-only in CI
- WebKit coverage is local-only
- Firefox failures would not be caught in CI

**Resolution path:**
Deferred. When tackled, decide explicitly whether Firefox runs in CI or stays
local-only. Do not default to "add everywhere."

**Priority:** Low

---

## 8. What FORGE Does Not Claim

These are explicit non-claims. FORGE does not assert capability in these areas:

| Non-claim | Notes |
|---|---|
| Business risk prioritisation | FORGE applies consistent rules — it does not understand business risk |
| Edge case discovery | FORGE tests what it observes — it does not invent edge cases |
| Defining "correct" for a feature | Correctness is a human judgment — FORGE verifies against observed behaviour |
| Performance testing | No performance measurement capability beyond basic page load timing |
| Security testing | No security scanning, vulnerability detection, or penetration testing |
| Accessibility testing | No WCAG or accessibility standard validation |
| Visual pixel comparison | VisionHealer uses visual similarity for healing only — not a visual regression test suite |
| 100% application coverage | Coverage is proportional to what was discovered and verified |

---

*FORGE™ — AI-Augmented Quality Engineering Platform*
*AnvilQ Technologies LLC — Copyright © 2026 Raj Kasthuri*
