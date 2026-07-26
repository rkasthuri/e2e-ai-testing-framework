# FORGE Repository Memory

This document captures historical discoveries, architectural decisions, known pitfalls, and lessons learned from previous sessions.

Purpose:
- Prevent rediscovering known issues.
- Capture non-obvious implementation details.
- Record architectural decisions and rationale.
- Preserve debugging knowledge across sessions.

Only include information that remains valuable across multiple sessions.

---

# Session Log

## Session 1

### Discovery
Initial crawler architecture required BFS/SPA/Hybrid strategies.

### Decision
Implemented Strategy Pattern rather than conditional branching.

### Rationale
Maintain app-agnostic extensibility.

---

# Tooling gotchas

## Git staging — multi-path `git add` can silently skip brand-new untracked files (seen twice)

A multi-path `git add A B C && git commit` can silently skip BRAND-NEW untracked files (stages only
already-tracked paths), producing a commit missing the new file. ALWAYS verify staging before
committing: `git diff --cached --name-only` must show the full intended set. Prefer: stage new files
in their own `git add` call, or `git add <dir>`, then verify. Recovered both times by amending the
local (unpushed) commit.

## Adversarial evidence — never assert a file/diff/test-state from memory (origin of the sharpened Rule 7)

A hallucinated diff was "reviewed" and nearly committed (a drafted commit message asserted a
`?? (last ? 100 : 0)` fix that did NOT exist in the code); it was caught only by re-reading the tree
against the claim. AGENTS.md now demands re-reading the actual file / re-running the actual
command and treating any prior summary as WRONG until fresh evidence proves otherwise. Lesson: a
retained summary is not evidence.

## Filenames with spaces silently drop from `xargs` / bare shell loops

An inventory using `find … | xargs wc -l` silently dropped `docs/ADR/ADR-001_App Model.md` …
`ADR-008_AI Provider Abstraction.md` (spaces in the names) and undercounted the ADRs as 10 instead of
18. Quote paths, or use `find -print0` with `while IFS= read -r -d ''`.

---

# FORGE lessons (TD-064)

## Evidence propagation across dependency boundaries

- **PRINCIPLE (Nova, FC-004a):** "Assertion confidence cannot exceed prerequisite confidence." A
  generator cannot honestly say "I don't know if we reached page X" and then assert "element on X is
  visible." Downstream assertion strength is capped by the confidence of the navigation/prerequisite
  it depends on. Realized as a per-dependency full/downgraded/omit decision.
- **MECHANISM (Aiden):** Generator failures frequently originate from confidence/evidence not
  propagating across DEPENDENCY BOUNDARIES — truth known at one step (cardinality / nav grounding /
  visibility state / prerequisite reachability) is not carried to the dependent step. Confirmed 5x:
  FC-001 cardinality, FC-002 nav grounding, FC-003 visibility state, FC-004a prerequisite confidence,
  FC-004b auth outcome (observed at crawl, then discarded at the auth-failed skip). This is the same
  root defect in five locations, which points to a MISSING LAYER (unified
  evidence/confidence propagation — the TD-082 determineAssertionCapability helper) rather than four
  independent bugs.
- **Grounding is now a TRI-STATE:** observed | inferred | unknown. `null` must never silently behave
  as observed; `null` -> unknown -> downgrade/omit.
- **FC-004a PRINCIPLE 2 (Nova, layer boundary):** "Generation emits evidence and constraints; Triage
  emits classifications." The generator emits/omits/downgrades/annotates + records omissionReason; it
  never assigns TD-063 categories (app-bug / test-defect / infra-defect / flaky / insufficient-evidence).
  Prevents the taxonomy living in two layers and drifting. (Principle 1 = "assertion confidence cannot
  exceed prerequisite confidence" above.)
- **FC-004b PRINCIPLE (Nova):** "Authentication failure is itself evidence." A role whose auth fails at
  crawl is an OBSERVED negative outcome, not merely an absence. Today the crawler skips the role; the
  honest move is to PERSIST the outcome (RoleDefinition.authOutcome) rather than let downstream code
  re-infer it from side-effects (e.g. empty reachablePageIds — the rejected proxy).
- **FC-004b PRINCIPLE (Nova, general):** "If FORGE observed something important, it should persist it."
  Evidence observed at crawl must not be discarded before the consumer needs it — the dominant TD-064
  theme across FC-001/002/003/004a/004b (truth observed at crawl, discarded before generation).
  Persisting observed evidence is consistent with "generator consumes evidence"; NOT persisting it is
  the architectural inconsistency.
- **Negative-path modeling (deferred, NOT TD-064):** representing "login expected to be blocked" and
  asserting the lockout UX is a real future capability, gated on the lockout actually being OBSERVED
  (TD-013 / agentic crawl). Deferred.

## Measurement/evaluation identity

- **PRINCIPLE (Nova, TD-080):** "Evaluation artifacts must use the same identity model as production
  artifacts." Measurement must be at least as disciplined as the thing it measures. The eval harness
  keyed on title-only while production keyed on file::title::browser; a shared makeResultKey
  (src/core/identity) now serves both so the measurement layer cannot silently diverge from — or
  mis-attribute against — production identity.

## Input health / verdict quality (TD-067)

- **PRINCIPLE (Nova, TD-067):** "Verdict quality cannot exceed input quality." A triage verdict derived
  from stale, partial, or unverifiable input must be marked accordingly. InputHealth
  (healthy|stale|degraded|invalid|unknown) is assessed before classification; `input_health !== 'healthy'`
  forces `confidenceSource='fallback'` on all results and emits an honest health banner replacing the
  fabricated `new Date()` timestamp. The CI provenance sidecar (runId+timestamp+gitSha) enables exact
  run-identity verification; missing sidecar -> `unknown`, never assumed healthy.
- **PATTERN:** The honesty principle now spans 3 TD layers: TD-064 (assertion confidence cannot exceed
  prerequisite confidence), TD-066 (FlowConfidence derived from evidence, not source-type constants),
  TD-067 (verdict quality cannot exceed input quality). All three resolved by the same mechanism: derive
  confidence from real evidence; admit `unknown` when evidence is absent; never invent certainty.

## Heal correctness (TD-065)

- **PRINCIPLE (Nova, TD-065):** "Recovery success cannot exceed verification success." A healed locator is
  not correct because it resolves — it is correct because the original intent (assertion/action) still
  holds on the healed element. Post-heal re-run is the correctness signal; HealConfidence
  (observed|partial|unknown|failed) is derived from evidence, not resolvability.
- **TD-065 closes TD-065b:** the first real production heals on SauceDemo are exercised and verified in
  `experiments/td-065-healing/harness.ts` (S2 assertion-verified/observed; S3 resolvability-only/unknown —
  fake-green eliminated on a real app).
- **HONESTY FLOOR COMPLETE (TD-065+066+067):** all three honesty-floor items resolved. FORGE no longer
  fabricates confidence (TD-066), no longer presents stale input as current truth (TD-067), and no longer
  records resolvability as heal success (TD-065). The evidence layer is trustworthy; agentic-crawl and
  learning loops are now properly gated.
- **HEAL IMPLEMENTATION PARAMETERS (moved from CLAUDE.md's deleted status list, 2026-07):** Smart Locator
  Healing = strategy-chain + Vision escalation, correctness-verified via post-heal assertion re-run
  (TD-065 Tiers 1+2), at the POM action layer; spec-body assertion healing deferred → TD-094. Vision
  Healer uses a real Claude Vision `aiCall` at a 0.8 confidence threshold, invoked by `SmartLocator` as
  the heal escalation (not standalone).
- **ADR-018 RED-SIDE heal outcome (shipped `a0c57e2`/`c96e3eb`):** a heal that cannot confidently
  resolve throws `HealUnresolvedError` + emits a `forge:could-not-verify` Playwright annotation, and
  persists the failed heal via `recordUnresolved` (distinct from the promotion-shaped `recordHeal` —
  closes the archetype-4 winners-only gap). Ingestion re-grades such a test to could-not-verify, not
  failed. (TD-UI-058 / TD-UI-061.)

## Assertion decision axes (TD-082)

- **PRINCIPLE (Nova, TD-082):** "TD-064 wasn't discovering failure classes — it was discovering independent
  decision axes." Step capability, click capability, and element form are reusable concepts; the FCs merely
  exposed them. FC-001 (multiplicity) is orthogonal to strength and cannot be subsumed into the
  `full|downgraded|omit` enum — two helpers > one overloaded abstraction when axes are genuinely independent.
- **TD-082 consolidates** the four FC assertion-capability decisions into `assertionHelpers.ts`
  (`src/core/onboarding/generators/`). Semantic-preservation proven both ways: byte-identical regen + unit
  tests vs old inline logic. Nav-assert precedence divergence (`thisInferred`-first vs `priorBroken`-first)
  deliberately preserved — logged as **TD-095** for design-first reconciliation.

## /evals eval framework (TD-085)

- **TD-085 (FORGE eval framework):** `/evals` established as the first-class measurement layer. One harness
  per AI capability — no exceptions (Nova). Capabilities: triage (97.4% accuracy), generation (100%
  behavioral pass rate, 6/6 SauceDemo specs), healing (100% correct heal rate, 5 scenarios), vision (Phase 2
  placeholder). Shared contract: `EvalRecord` -> `runEval` -> `EvalRunSummary` -> reporter. Compile-gated
  (`evals/tsconfig.json` in `npm run check`). Phase 2: cost/latency/regression + scored healing corpus +
  vision harness.

## Bootstrap Mode (TD-093)

- **PRINCIPLE (TD-093 Bootstrap Mode):** FORGE can onboard a new app from just a URL + credentials — no
  hand-authored config required. Detection uses only OBSERVED DOM signals (StrategyDetector,
  password-field-count, SPA-framework fingerprints); every detected value carries `DetectionConfidence`
  (`high`/`medium`/`low`) + `source`. It NEVER invents config values — conservative defaults +
  `AUTO-DETECTED` annotations when uncertain. Overwrite guard protects curated configs (`--force`
  required). `--dry-run` previews config + manifest without writing. appType detection is the only net-new
  inference (was config-only). Portable per [[td-097]] (all paths from `__dirname`/REPO_ROOT). Phase 2
  (goal-directed exploration, multi-step auth, SSO/OAuth) alongside **TD-013** agentic crawl.

## Agentic crawl (TD-013)

- **TD-013 AGENTIC CRAWL (Nova 9.9/10):** Goal model (4 levels: Business/Capability/State/Action; 4 states:
  PENDING|ACHIEVED|BLOCKED|UNREACHABLE). Loop: Goal→Required State→Observed State→Action→Evidence→Next
  Goal. Key principle: **BLOCKED ≠ UNREACHABLE** (blocked = a different plan may work; unreachable = no plan
  can, and only concluded after exhausting attempts with prerequisites achieved). Evidence tiers:
  direct_observation > indirect > inference > assumption. AgentMemory is cross-session (persists across runs
  via [[td-103]] repository seam). ExecutionEnvironment swappable (web-ui=Playwright, api=HTTP, mobile/IoT
  deferred [[td-100]]). Supervised/autonomous: CLI flag (default=supervised) + UI toggle when Dashboard
  ships. The agent owns intelligence; the app model owns application knowledge — clean separation.
  DecisionLog deferred ([[td-101]]). **Note:** the number TD-013 is reused — the agentic-crawl item is
  distinct from the historical resolved VerificationRunner-prerequisites TD-013.

---

# UI surface & build state (2026-07)

## forge-ui is the canonical UI; src/platform is deprecated

- **DECISION:** `forge-ui` is the canonical UI surface (DB-backed, branded). The file-based
  `src/platform` dashboard is DEPRECATED and being retired — no new UI/Dashboard work there. The shipped
  launcher `forgeUI.bat` → `cli.ts ui` already launches forge-ui, NOT src/platform; src/platform is
  reachable only via the raw `npm run platform`/`dashboard` dev scripts.
- **LESSON — never encode build-state in CLAUDE.md.** CLAUDE.md's deleted "Current Implementation State"
  list mislabeled the dashboard ("Not Yet Implemented") — it drifted and lied. The honest source of what
  exists is the code + TECH_DEBT.md. Genuinely-not-built areas (NL Query, Coverage Gap Analysis,
  User-Story→Test, Manual-Test Conversion, Mobile/IoT/Cloud crawling) live in TECH_DEBT + placeholder
  READMEs, not a doc list.
- The honest forge-ui health/pass-rate view = **TD-UI-062** (HIGH); the deprecated src/platform
  green-on-empty health lie was surgically bridged = **TD-UI-061** (badge → honest "Insufficient
  Evidence").