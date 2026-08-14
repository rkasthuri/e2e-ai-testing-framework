# Start Here

FORGE is an evidence-driven quality engineering platform. This page is a
navigation entry point for people and AI agents; it does not restate system
architecture, operating procedures, or project status.

## Choose Your Starting Point

### Human readers

- For a product overview, start with [`../README.md`](../README.md).
- For product direction, read
  [`product/PRODUCT_VISION.md`](product/PRODUCT_VISION.md).
- To locate a specific document, use
  [`DOCUMENTATION_INDEX.md`](DOCUMENTATION_INDEX.md).
- For setup and daily commands, use
  [`project/BUILD_AND_RUN.md`](project/BUILD_AND_RUN.md), then verify commands
  against `package.json` and the current CLI.
- For current work, consult the project snapshot documents, then verify their
  claims against Git, CI, code, tests, and the on-disk `TECH_DEBT.md`.
- For current constraints, accepted debt, legacy boundaries, and safe next
  work, read
  [`architecture/CURRENT_LIMITATIONS.md`](architecture/CURRENT_LIMITATIONS.md).

### AI and implementation agents

Begin at [`../AGENTS.md`](../AGENTS.md). It is the active repository instruction
and authority-routing entry point. Follow the onboarding sequence it defines;
this page does not replace that sequence.

Trust sources in this order:

1. [`../AGENTS.md`](../AGENTS.md).
2. [`governance/AI_CONSTITUTION.md`](governance/AI_CONSTITUTION.md),
   [`governance/AI_WORKFLOW.md`](governance/AI_WORKFLOW.md), and the authoritative
   [`governance/AI_ONBOARDING_CHECKLIST.md`](governance/AI_ONBOARDING_CHECKLIST.md).
3. Applicable ADRs and durable architecture documents.
4. Executable evidence: current code, tests, migrations, configuration, CI
   workflows, repository state, and commit-matched validation results.
5. Operational guides, after checking them against executable evidence.

Do not treat archives, old handovers, dated snapshots, comments, console
messages, or unverified counts as proof of current behavior.

## Documentation Authority Classes

- **A — Authoritative:** Defines durable rules, decisions, ownership, or product
  direction. Preserve carefully. For implemented behavior, confirm that code and
  tests still enforce the decision.
- **B — Operational:** Explains how to operate or validate FORGE. Executable
  code, scripts, configuration, and observed CLI behavior outrank it.
- **C — Status/Snapshot:** Describes state at a point in time. Verify every
  volatile claim before acting on it.
- **D — Historical:** Preserves prior context and decisions. It is not current
  operational guidance.
- **E — Reference:** Helps readers find or understand information without
  independently defining system truth.

## Authority Rules

1. Current code, tests, migrations, configuration, and CI workflows outrank
   explanatory documentation when describing implemented behavior.
2. ADRs explain why decisions exist and preserve decision-time rationale.
3. Operational documents explain how to use the system; they do not override
   executable behavior.
4. Snapshot documents describe current state but do not define it.
5. Archive documents preserve history only.
6. AI agents must follow the authority order above and report contradictions
   instead of silently choosing one source.

The complete map, including owners, refresh triggers, and upstream sources of
truth, is [`DOCUMENTATION_INDEX.md`](DOCUMENTATION_INDEX.md).
