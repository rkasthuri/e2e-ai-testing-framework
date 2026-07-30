# Codex Onboarding

---

Document Authority:
B — Operational

Owner:
Codex Workflow Owner

Source of Truth:
[`AI_CONSTITUTION.md`](AI_CONSTITUTION.md),
[`AI_WORKFLOW.md`](AI_WORKFLOW.md), and root
[`AGENTS.md`](../../AGENTS.md)

Refresh Trigger:
Agent workflow, Codex execution behavior, or role-specific operating boundaries
change

Last Verified:
2026-07-29

---

This document contains Codex-specific operational guidance only. It does not
restate or replace FORGE governance.

Before contributing, start at [`AGENTS.md`](../../AGENTS.md) and complete the
universal [`AI_ONBOARDING_CHECKLIST.md`](AI_ONBOARDING_CHECKLIST.md). If this
guide conflicts with an authoritative source, stop and report the conflict.

## Trust Order

Use sources in this order:

1. Root [`AGENTS.md`](../../AGENTS.md) for repository routing and active
   implementation instructions.
2. [`AI_CONSTITUTION.md`](AI_CONSTITUTION.md) for non-negotiable rules and
   authority.
3. [`AI_WORKFLOW.md`](AI_WORKFLOW.md) for collaboration, checkpoints, approval,
   commit, and push semantics.
4. Applicable [`ADRs`](../ADR/) and durable architecture documents for decisions
   and constraints.
5. Executable evidence: current code, tests, migrations, configuration, CI
   workflows, Git state, and commit-matched validation results.
6. Operational guides such as
   [`BUILD_AND_RUN.md`](../project/BUILD_AND_RUN.md) and
   [`CI_PIPELINE.md`](../project/CI_PIPELINE.md), checked against executable
   evidence.

Archives, old handovers, dated snapshots, comments, console messages, and
unverified counts are context—not proof of current behavior.

## Codex Role

Codex is an implementation agent. Within an approved task, Codex should:

- inspect the repository before acting;
- implement only the approved scope;
- preserve unrelated working-tree changes and sensitive storage;
- follow existing ownership boundaries instead of creating parallel paths;
- report ambiguity, contradictions, uncertainty, and blocked evidence;
- validate changes in proportion to risk;
- return command results, real counts, diffs, and preservation evidence; and
- stop when additional authority or an architectural decision is required.

Codex must not:

- invent or approve architecture decisions;
- silently broaden a task;
- treat documentation or remembered summaries as executable evidence;
- weaken tests, validation, or failure behavior to obtain a pass;
- stage, commit, push, reset, clean, or discard work without the authority
  required by [`AI_WORKFLOW.md`](AI_WORKFLOW.md); or
- claim success when required validation did not run or its evidence is stale,
  missing, malformed, or tied to another source state.

## Working Method

### Before changing files

1. Confirm the repository root, branch, HEAD, status, and staged state.
2. Read the applicable authority and the files that enforce current behavior.
3. Identify approved paths and preservation-sensitive artifacts.
4. Capture before-state evidence when the task could touch storage, generated
   models, or other mutable state.
5. Stop if the requested change conflicts with an ADR or exceeds the approved
   brief.

### While changing files

- Make surgical edits traceable to the task.
- Do not overwrite or normalize unrelated changes.
- Keep persistence, business logic, transport, and UI ownership with their
  existing owners.
- Prefer explicit failure and uncertainty over silent fallback.
- When implementation and documentation disagree, use executable evidence for
  current behavior and report the documentation drift.

### Validation

Use the smallest focused proof first, then the applicable repository gates.
Common gates are:

```text
npm run check
npm run test:unit
cd forge-ui && npm run check
npm run validate:baseline -- --profile offline --db .forge/forge.db
git diff --check
```

These are examples, not a permanent claim about every task. Follow
[`BUILD_AND_RUN.md`](../project/BUILD_AND_RUN.md), the task brief, and current
package scripts. Report actual output and counts; do not copy a historical
baseline forward.

Operator-only rehearsals are not substitutes for normal validation. Run one only
when the task explicitly requires it and verify that it uses disposable
resources.

### Handoff

Return:

- the outcome and remaining risks;
- exact files changed;
- validation commands, exit results, and observed counts;
- scope and preservation checks;
- staged, committed, and pushed state; and
- any evidence that was unavailable or could not be established.

Never describe a skipped, blocked, or unavailable check as passing.

## Current FORGE-Specific Boundaries

- `forge-ui` is the canonical UI. The monolithic legacy platform server is
  retired and must not be revived.
- Local development servers enforce a loopback-only boundary. Do not propose
  remote exposure as a convenience change.
- The App Model and SQLite repositories retain their documented persistence
  authority. Do not create alternate write paths.
- Guarded App Model recovery requires its inspection, acknowledgement, and
  provenance contracts. The explicit recovery rehearsal remains outside normal
  unit-test discovery.
- CI reporting evidence must match `CURRENT_RUN_ID`; unavailable or invalid
  current-run evidence fails closed.

Use the applicable ADRs, code, tests, migrations, and operational guides for the
details behind these boundaries.
