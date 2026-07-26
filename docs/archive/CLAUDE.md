# Archived — Non-Authoritative

> This file is the preserved legacy repository contract formerly used by Claude Code.
> It is retained for historical reference only and must not be used as current guidance.
> The active repository-level instructions are in [`../../AGENTS.md`](../../AGENTS.md).
> Universal governance remains in the authoritative documents linked from that file.

---

# FORGE — Autonomous Quality Engineering

FORGE is an AI-augmented, app-agnostic, enterprise-grade Quality Engineering platform:
it discovers apps, models them, verifies, generates tests, executes, heals, and learns.
Reliability, truthfulness, explicit failure modes, and maintainability matter more than speed.

This file is the behavioral contract, re-read every turn. It holds **rules only** — not
status, not history, not roadmap. **If a rule here conflicts with the code, surface the
conflict explicitly; never silently pick one side.**

---

# What Is Built — read the code, not this file

Do **not** trust any "implemented / not-yet" list in a doc; it goes stale and lies.
The honest source of what exists is **the code + `TECH_DEBT.md`**. Verify a capability
in code before using or claiming it. (Proof-testing targets: SauceDemo, OrangeHRM,
Restful Booker.)

**forge-ui is THE canonical UI surface** (DB-backed, branded). The file-based
`src/platform` dashboard is **DEPRECATED and being retired** — do no new UI work there.
All UI/UX and Dashboard work builds on `forge-ui`.

---

# Read Before You Work (routing)

Before non-trivial work, read the relevant source of truth — and there is a *trigger*
for each; a doc with no trigger is not read.

| Before you… | Read |
|---|---|
| any non-trivial change | `MEMORY.md` (prior findings/decisions) + `TECH_DEBT.md` (open/resolved) |
| architectural / structural design | `docs/architecture/ARCHITECTURE_NORTH_STAR.md` |
| anything touching product goals/branding/roadmap | `docs/product/PRODUCT_VISION.md` |
| touching a subsystem with an ADR (see ADR triggers below) | that ADR |

The App Model is the system source of truth (ADR-001). Downstream systems consume and
improve it — they never fork a parallel representation.

Pipeline: ONBOARD → CRAWL/INTROSPECT → CLASSIFY → APP MODEL → VERIFY → GENERATE →
REVIEW → EXECUTE → HEAL → REPORT.

---

# Build & Verify Commands

One canonical command per task. The local CI-equivalent gate is the first three.

| Task | Command |
|---|---|
| Typecheck (root — the CI gate) | `npm run check` (= `tsc --noEmit` + evals tsc) |
| Unit tests (all) | `npm run test:unit` |
| Single unit test file | `npx tsx --test scripts/<file>.test.ts` |
| forge-ui typecheck (**local only** — NOT in CI, TD-UI-052) | `cd forge-ui && npm run check` |
| forge-ui build | `cd forge-ui && npm run build` |
| Launch the canonical UI (forge-ui) | `forgeUI.bat` (→ `cli.ts ui` → forge-ui server) |

Before committing non-trivial work, run: `npm run check` · `npm run test:unit` ·
`cd forge-ui && npm run check`. CI (`e2e-pipeline.yml`) does **not** typecheck forge-ui —
prove it locally.

---

# Standing Rules

Ordered by importance and how often they get violated.

1. **Evidence over claims — adversarially.** Never state "fixed", "working", "passing",
   or assert a file's contents, a diff, a test outcome, or a code state **from memory or a
   retained summary.** Re-read the actual file / re-run the actual command and compare the
   real output against your claim, assuming your prior summary is WRONG until fresh evidence
   proves otherwise. Run commands; inspect outputs; present results.

2. **Silent failures are unacceptable.** Every failure, escalation, budget exhaustion, or
   degraded mode is explicitly logged AND persisted where a consumer can see it. Errors are
   never swallowed; `console.*` is never the only home for a fact FORGE established.

3. **Design before patching; no known bug beneath new work; prove foundations first.**
   Prefer structural fixes over local patches; don't bypass existing architecture. Do not
   stack work on an unresolved defect in the same area — fix it or explicitly defer it first.
   **New UI/Dashboard work does NOT start while open verification/crawl correctness issues
   remain unresolved** (the TD-013/014 → Dashboard gate): a UI built on unreliable
   crawler/verification/modeling signal surfaces that unreliability as UI noise.

4. **App-agnostic by design.** Never hardcode application-specific behavior in framework
   internals; app-specific logic lives only in onboarding configuration (ADR-007).

5. **One source of truth.** Before adding storage, state, or a computed value, ask: does
   this duplicate existing information? can an existing subsystem provide it? will two
   sources drift? Extend existing systems; do not create a parallel representation.

6. **Surgical changes.** Change only what the task requires. Match existing style. No
   unrelated refactors. Remove only dead code your change introduced. Every changed line
   traces to the requested work. Keep commits cohesive.

7. **Generated tests are self-contained.** They include the prerequisite steps/setup to
   reach the tested state.

8. **Flag scope expansion.** Do not silently absorb unrelated work; surface newly
   discovered issues separately (a new TD row), don't fold them in.

9. **Confirm before pushing.** CI triggers live external systems, Claude API usage, Slack
   + email notifications, and automated commits. Understand the consequences before pushing;
   on the default branch, confirm intent.

10. **forge-ui is canonical; `src/platform` is deprecated.** No new UI/Dashboard work on the
    file-based `src/platform` surface — it is being retired. Build on forge-ui (DB-backed).

---

# Standard Workflow

The operational sequence for non-trivial work (the order, not a rule restatement):

1. Read the relevant code.
2. Review `MEMORY.md`.
3. Review `TECH_DEBT.md`.
4. Establish the root cause.
5. Design before code.
6. Implement surgically.
7. Verify (`npm run check` + `npm run test:unit`; forge-ui → `cd forge-ui && npm run check`).
8. Capture real evidence (terminal/CI output — not summaries).
9. Check side-effects / blast radius.

---

# ADR Triggers (read the law before you touch the thing it governs)

The ADRs are reachable in `docs/ADR/`, but read the *right* one at the *right* moment.
The honesty laws (006 → 015/016/017/018) are load-bearing and frequently in play.

| Before you… | Read ADR |
|---|---|
| write/aggregate ANY verdict, status, pass-rate, confidence, or score | **ADR-018** (aggregate to the weakest truth: failed > could-not-verify > passed) + **ADR-015** (assert only what evidence supports) |
| add a new type, DB column, channel, or reader | **ADR-017** (no declared channel without a producer; observed facts must reach a persisted artifact) |
| emit a gap / failure / could-not-verify | **ADR-016** (carry a machine-readable remedy) |
| assert a claim or fix "works" | **ADR-011** (verify before assert) |
| any reporting/evidence/truth-telling work (the parent law) | **ADR-006** (truth-telling and earned evidence) |
| build any dashboard / health / pass-rate view | **ADR-004** (dashboard is a VIEW LAYER on existing data — read the DB, never a parallel pipeline) |
| create/represent app state | **ADR-001** (App Model is the source of truth) |
| add app-specific logic | **ADR-007** (app-agnostic; config-only) |
| heal-strategy work | **ADR-005** (SmartLocator healing strategy) |
| auth / credential work | **ADR-013** (credential resolution policy) |
| mint or consume a run id | **ADR-009** (canonical run identity) |
| run-status / lifecycle / concurrency work | **ADR-014** (execution lifecycle) |
| engine-vs-job boundaries | **ADR-012** · bug-gate behavior → **ADR-010** · DB strategy → **ADR-002** · review/promotion → **ADR-003** · AI provider → **ADR-008** |
| generator failure-class work / when a new generation defect surfaces | `docs/td-064/TD-064-Failure-Class-Catalogue.md` (living, three-way-maintained taxonomy — re-audit against it) |
| evidence-layer work (TD-UI-060 / TD-UI-062) | `docs/architecture/ARCHITECTURE_TARGET_EVIDENCE_LAYER.md` (the target evidence layer — NOT yet fully built; the measured gap, not a done state) |

Rule: no reference file without a trigger; no trigger pointing at a nonexistent file.

### ADR authoring
ADRs are dated history, not current-state docs. Preserve the decision-time rationale;
append dated Implementation/Update notes for what shipped afterward. An ADR must never
contradict itself — when reality moves past a claim, reword the stale line into a dated
forward-pointer, never leave it asserting a falsehood. This applies to UNDER-claims
(capability shipped but the doc still calls it unbuilt) as much as OVER-claims: a doc out
of sync with reality is the same defect in either direction.

---

# Instruction Priority

When instructions conflict, obey in this order — and never resolve a conflict silently:

1. Explicit user request. 2. Observable repository code and tests. 3. Standing Rules
here. 4. `MEMORY.md`. 5. Architecture docs. 6. Product Vision.

---

# Think Before Coding

State assumptions explicitly. Surface tradeoffs and alternatives. Push back on unnecessary
complexity. Ask when requirements are ambiguous — never silently guess. Prefer the simple
solution when it satisfies the requirement.

Before changing code, ask: symptom or root cause? does an abstraction already exist? still
app-agnostic? does this create a second source of truth? can it fail silently? how will
success be proven? Prefer architectural improvement over tactical patch; avoid speculative
abstractions (an empty aspirational type/channel is the ADR-017 anti-pattern).

If you cannot find a documented capability in code: say so, verify, ask. Never invent
missing functionality.

---

# Gotchas (hard to spot, expensive to rediscover — symptom → cause)

* Stale closures reading captured state instead of live values.
* Credential placeholder mismatches.
* Oversized AI batches → truncation (cap batch size).
* SPA crawl actions mutating application state mid-crawl.
* Healing routines promoting a WEAKER selector than the original.
* Named functions inside `page.evaluate()` failing under `tsx`.
* `xargs`/shell splitting on filenames with spaces (e.g. `docs/ADR/ADR-001_App Model.md`) —
  quote or `-print0`, or you silently drop files.

Check `MEMORY.md` and historical findings before assuming a problem is new.

---

# Review/scratch artifacts (ephemeral — never tracked)

Review diffs and audit reports are EPHEMERAL working artifacts. Write them to the ignored scratch
location `notes/review-scratch/` (gitignored) — never into the tracked tree, and never commit them.
The ONLY audit outputs that get tracked are ones DELIBERATELY promoted to a durable doc because
something depends on them (e.g. `docs/architecture/spikes/`, whose spike outputs a design rests on).
Default is ignored; tracking is the deliberate exception. Never `git add -A` — stage explicit paths
so a stray artifact cannot ride in.

---

# Document references (name the real file)

Document references name the actual file that exists — full correct filename, path resolvable from
the citing location. No shorthand (`NORTH_STAR` for `ARCHITECTURE_NORTH_STAR`), no bare filenames
that only resolve with prior repo knowledge. A reference a reader cannot follow is broken even if
the target exists.

---

# Environment

TypeScript · Playwright · Node.js · Claude API · SQLite/PostgreSQL · Kysely · GitHub
Actions. Local dev: Windows PowerShell. Repo: `github.com/rkasthuri/forge-framework`,
branch `main`.
