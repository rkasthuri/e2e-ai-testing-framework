# FORGE Repository Instructions

This is the active repository-level instruction file for implementation agents,
including Codex, Claude Code, and future agents. It is an entry point and routing
map, not a second copy of FORGE governance.

The legacy Claude-specific contract is archived at
[`docs/archive/CLAUDE.md`](docs/archive/CLAUDE.md) and is non-authoritative.

## Start Here

Before contributing in any capacity:

1. Open [`docs/governance/AI_ONBOARDING_CHECKLIST.md`](docs/governance/AI_ONBOARDING_CHECKLIST.md).
2. Follow its required reading order and attestations exactly.
3. Read [`docs/governance/OPERATING_MANUAL.md`](docs/governance/OPERATING_MANUAL.md)
   for the cycle, roles, and pointers to canonical rules.
4. If you are Codex, read the Codex-specific deltas in
   [`docs/governance/CODEX_ONBOARDING.md`](docs/governance/CODEX_ONBOARDING.md)
   after completing the universal checklist.

`AI_ONBOARDING_CHECKLIST.md` is the single authoritative source for
checklist-shaped onboarding governance. The documentation index is a map; this
file does not replace or restate the checklist.

## Non-Negotiable Engineering Posture

FORGE is evidence-first: confidence must be earned from observed evidence and
must never be assumed, inferred, or fabricated. Reliability, truthfulness,
explicit failure modes, and maintainability matter more than speed.

- Re-read files and re-run commands before asserting contents, diffs, test
  results, or repository state. A retained summary is not evidence.
- Architectural honesty is a hard constraint. Persist facts that consumers
  require, preserve provenance, and surface uncertainty or degraded behavior.
  A console message alone is not durable evidence.
- Never claim or design around speculative capability. Distinguish explicitly
  between built behavior, current limitations, historical context, and future
  work. Verify capability in code and tests before relying on it.
- The App Model is the source of truth for application state. Extend existing
  owners; do not create parallel representations that can drift.
- Keep framework internals app-agnostic. Application-specific behavior belongs
  in onboarding configuration.
- Make surgical changes. Every changed line must trace to the approved task.
  Report newly discovered work; do not absorb it.
- Generated tests must include the prerequisite setup required to reach the
  state they test.
- `forge-ui` is the canonical UI surface. `src/platform` is deprecated; do not
  add new UI or dashboard work there.

The current documented pipeline sequence is `ONBOARD → CRAWL/INTROSPECT →
CLASSIFY → APP MODEL → VERIFY → GENERATE → REVIEW → EXECUTE → HEAL → REPORT`.
A canonical enumerated architecture section is still pending under TD-176; do
not treat this routing line as proof that every phase is fully implemented.

The universal, enforceable rules live in
[`docs/governance/AI_CONSTITUTION.md`](docs/governance/AI_CONSTITUTION.md).
The collaboration and authorization protocol lives in
[`docs/governance/AI_WORKFLOW.md`](docs/governance/AI_WORKFLOW.md).

## Task and Checkpoint Workflow

- Work only from an approved, scoped brief.
- Audit and establish root cause before fixing a defect.
- Obtain design approval before structural changes.
- Stop at every scheduled checkpoint and whenever the brief and repository
  diverge. Report evidence; do not reconcile divergence autonomously.
- Do not continue, expand scope, commit, or push without the required approval.
- Aiden reviews the actual diff before commit. Raj alone authorizes a push with
  an explicit Rule-9 "Go."

The exact workflow, brief format, checkpoint rules, and push authorization
semantics are authoritative in
[`docs/governance/AI_WORKFLOW.md`](docs/governance/AI_WORKFLOW.md).

## Architecture and Rule Routing

Read the relevant source before touching the governed area:

| Trigger | Authoritative source |
|---|---|
| Architecture, module boundaries, or structural design | [`docs/architecture/ARCHITECTURE_NORTH_STAR.md`](docs/architecture/ARCHITECTURE_NORTH_STAR.md), [`docs/architecture/CODEBASE_MAP.md`](docs/architecture/CODEBASE_MAP.md), and [`docs/governance/DECISION_LOG.md`](docs/governance/DECISION_LOG.md) |
| Product goals, branding, or roadmap | [`docs/product/PRODUCT_VISION.md`](docs/product/PRODUCT_VISION.md) and [`docs/project/ROADMAP.md`](docs/project/ROADMAP.md) |
| Current limitations or capability claims | [`docs/architecture/CURRENT_LIMITATIONS.md`](docs/architecture/CURRENT_LIMITATIONS.md), [`TECH_DEBT.md`](TECH_DEBT.md), and observable code/tests |
| Historical limitation context or evolution | [`docs/architecture/KNOWN_LIMITATIONS.md`](docs/architecture/KNOWN_LIMITATIONS.md) (retained snapshot; never current operational truth) |
| App state or App Model ownership | [`docs/ADR/ADR-001_App Model.md`](docs/ADR/ADR-001_App%20Model.md) |
| Database strategy | [`docs/ADR/ADR-002_Database Strategy.md`](docs/ADR/ADR-002_Database%20Strategy.md) |
| Human review and promotion | [`docs/ADR/ADR-003_Human Review Gate.md`](docs/ADR/ADR-003_Human%20Review%20Gate.md) |
| Dashboard or reporting views | [`docs/ADR/ADR-004_Dashboard as View Layer.md`](docs/ADR/ADR-004_Dashboard%20as%20View%20Layer.md) |
| Healing strategy | [`docs/ADR/ADR-005_SmartLocator Healing Strategy.md`](docs/ADR/ADR-005_SmartLocator%20Healing%20Strategy.md) |
| Evidence, reporting, or truth-telling | [`docs/ADR/ADR-006_Truth-Telling and Earned Evidence.md`](docs/ADR/ADR-006_Truth-Telling%20and%20Earned%20Evidence.md) |
| Application-specific behavior | [`docs/ADR/ADR-007_App-Agnostic Framework Design.md`](docs/ADR/ADR-007_App-Agnostic%20Framework%20Design.md) |
| AI-provider abstraction | [`docs/ADR/ADR-008_AI Provider Abstraction.md`](docs/ADR/ADR-008_AI%20Provider%20Abstraction.md) |
| Run identity | [`docs/ADR/ADR-009_Canonical_Run_Identity.md`](docs/ADR/ADR-009_Canonical_Run_Identity.md) |
| Bug-gate behavior | [`docs/ADR/ADR-010_Bug_Gate_Informational.md`](docs/ADR/ADR-010_Bug_Gate_Informational.md) |
| Claiming a fix or behavior works | [`docs/ADR/ADR-011_Verify_Before_Assert.md`](docs/ADR/ADR-011_Verify_Before_Assert.md) |
| Engine/job boundaries | [`docs/ADR/ADR-012_Engine_Job_Architecture.md`](docs/ADR/ADR-012_Engine_Job_Architecture.md) |
| Authentication or credentials | [`docs/ADR/ADR-013_Credential_Resolution_Policy.md`](docs/ADR/ADR-013_Credential_Resolution_Policy.md) |
| Execution lifecycle or concurrency | [`docs/ADR/ADR-014_Execution_Lifecycle_Concurrency.md`](docs/ADR/ADR-014_Execution_Lifecycle_Concurrency.md) |
| Verdict, status, confidence, score, or provenance | [`docs/ADR/ADR-015_Provenance_Follows_Evidence.md`](docs/ADR/ADR-015_Provenance_Follows_Evidence.md) and [`docs/ADR/ADR-018_Aggregate_to_the_Weakest_Truth.md`](docs/ADR/ADR-018_Aggregate_to_the_Weakest_Truth.md) |
| Gaps, failures, or could-not-verify outcomes | [`docs/ADR/ADR-016_Map_the_Gap_Prescribe_the_Remedy.md`](docs/ADR/ADR-016_Map_the_Gap_Prescribe_the_Remedy.md) |
| New persisted type, column, channel, or reader | [`docs/ADR/ADR-017_What_FORGE_Observes_FORGE_Keeps.md`](docs/ADR/ADR-017_What_FORGE_Observes_FORGE_Keeps.md) |
| Generator failure classes | [`docs/td-064/TD-064-Failure-Class-Catalogue.md`](docs/td-064/TD-064-Failure-Class-Catalogue.md) |
| Target evidence-layer work | [`docs/architecture/ARCHITECTURE_TARGET_EVIDENCE_LAYER.md`](docs/architecture/ARCHITECTURE_TARGET_EVIDENCE_LAYER.md) |

ADRs preserve decision-time history. Add dated implementation notes when reality
moves; do not rewrite historical rationale into a false current-state claim.

## Validation

Use the smallest focused proof required by the task, then run the applicable
repository gates before requesting commit approval:

```text
npm run check
npm run test:unit
cd forge-ui && npm run check
npm run validate:baseline -- --profile offline
```

Use `npx tsx --test scripts/<file>.test.ts` for a focused test file. Report
command exit codes and real counts. Existing accepted findings may remain
`BASELINE_DEBT`; any `NEW_REGRESSION` must be reported and blocks a clean result.
Do not mutate the live SQLite database during read-only validation, and compare
its SHA-256 before and after when storage could be touched.

## Documentation and Working Artifacts

- Documentation must move with behavior. Do not encode volatile build status in
  this file; current state belongs in the state, limitation, and debt documents.
- Name the actual file and use a path that resolves from the citing document.
  A bare name that needs prior repository knowledge is not a usable reference.
- Review diffs, audit captures, and other scratch outputs belong in the ignored
  `notes/review-scratch/` directory and must not be committed. Promote an
  artifact to tracked documentation only when a durable consumer depends on it.
- Never use `git add -A` for scoped work. Stage explicit reviewed paths and
  verify the staged file list.

Documentation ownership is defined in
[`docs/governance/AI_WORKFLOW.md`](docs/governance/AI_WORKFLOW.md). In particular:
`AI_CONSTITUTION.md` is Raj-owned and immutable by agents;
`AI_ONBOARDING_CHECKLIST.md` owns onboarding governance;
`DOCUMENTATION_INDEX.md` is a map; ADRs preserve decisions; and this file is the
active repository instruction entry point.

## Expensive-to-Rediscover Pitfalls

Before non-trivial work, inspect [`MEMORY.md`](MEMORY.md) and
[`TECH_DEBT.md`](TECH_DEBT.md). In particular, watch for stale closures,
credential-placeholder mismatches, oversized AI batches, state-mutating SPA
crawl actions, healing that promotes a weaker selector, named helpers inside
`page.evaluate()` under `tsx`, and shell handling of filenames containing spaces.
