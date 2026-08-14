# Release Readiness Prompt
<!-- FORGE prompt template — version 1.0 -->
<!-- Use: At the end of a milestone before declaring it complete -->
<!-- Rule: GREEN requires both HONEST and CORRECT — standing rule 2026-07-20 -->

---

## FORGE Release Readiness Review

**Milestone:** [Name]
**Date:** [YYYY-MM-DD]
**Reviewer:** Aiden

---

## 1. CI Gate

```
□ Last CI run is green
□ Commit hash: [hash]
□ CI run: [number / URL]
□ npm run check:  ✅ passes
□ test:unit:      ✅ [N]/[N]
□ Playwright:     ✅ [N]/[N]
□ Job 2:          ✅ completed without crash
□ forge-ui build: ✅ exit 0 (verified locally — not in CI)
```

---

## 2. TECH_DEBT.md Reconciliation

```
□ All TDs resolved in this milestone are in the Resolved table
□ All resolved TDs have real commit hashes (no "this commit" placeholders)
□ All resolved TDs have CI confirmation
□ No new TDs were opened and left unaddressed in this milestone
   (or: new TDs are logged with documented reason for deferral)
```

Open TDs from this milestone still unresolved:
| TD | Priority | Decision |
|---|---|---|
| [TD-XXX] | [H/M/L] | [Deferred to next milestone — reason] |

---

## 3. GREEN Verification — HONEST Dimension

*Does each capability report truthfully?*

For each capability shipped in this milestone:

| Capability | Reports errors? | Can return insufficient-evidence? | No fabricated output? | Honest? |
|---|---|---|---|---|
| [Capability] | [Y/N] | [Y/N/N/A] | [Y/N] | [✅/❌] |

---

## 4. GREEN Verification — CORRECT Dimension

*Does each capability measure accurately?*

For each AI capability shipped in this milestone:

| Capability | Eval harness exists? | Last result | Pass threshold met? | Correct? |
|---|---|---|---|---|
| [Capability] | [Y/N] | [result] | [Y/N] | [✅/❌] |

> Standing rule (2026-07-20): No capability may be called GREEN on the
> HONEST dimension alone. The CORRECT dimension requires eval harness evidence.

---

## 5. Documentation

```
□ CODEBASE_MAP.md reflects any new or changed components/modules
□ ROADMAP.md updated — shipped items marked ✅
□ ../architecture/CURRENT_LIMITATIONS.md updated — any new current limitations documented
□ ../architecture/KNOWN_LIMITATIONS.md consulted only when historical evolution is relevant;
  no new current-state claim is written there
□ GLOSSARY.md updated — any new terms added
□ PROJECT_STATE.md will be updated after this review
□ CURRENT_MILESTONE.md will be updated to reflect completion
```

---

## 6. Regression Check

```
□ No previously-green capabilities are now failing
□ No test count decreased unexpectedly
□ No architectural boundary violations introduced
□ No hardcoded paths introduced
□ All copyright headers present on new files
```

---

## 7. Outstanding Items

[Anything that was descoped, deferred, or left incomplete with documented reason.]

| Item | Status | Reason for deferral | Next milestone? |
|---|---|---|---|
| [Item] | Deferred | [Reason] | [Y/N] |

---

## 8. Release Decision

```
MILESTONE: [Name]
DATE: [YYYY-MM-DD]

CI:               ✅ / ❌
TD reconciliation: ✅ / ❌
HONEST dimension: ✅ / ❌ (N capabilities reviewed)
CORRECT dimension: ✅ / ❌ (N eval harnesses verified)
Regressions:      ✅ none / ❌ [N found]

VERDICT: [COMPLETE — milestone is GREEN / NOT COMPLETE — blockers listed below]

Blockers (if not complete):
1. [Blocker]
2. [Blocker]
```
