<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-009: Canonical Run Identity

Date: 2026-06-29
Status: Accepted

## Context

The pipeline persists results across multiple stages (results-store, AI triage, healing,
performance baseline). Originally several stages independently minted their own run identifiers,
and three of them produced ids that did not match runs.run_id — so triage and heal rows could not
be joined back to the run that produced them (TD-069). This made cross-stage history unreliable.

## Decision

A single canonical run id (CURRENT_RUN_ID) is established once at run-start and consumed by every
stage. No stage mints its own run id. If CURRENT_RUN_ID is not set, a stage that needs it throws
loudly rather than fabricating a synthetic id (which would re-fork the non-joinable id problem).

- Local: established in src/run.ts at run-start, before any child process is spawned (inherited via env).
- CI: established as a job-level output and carried into the ai-pipeline job env.

## Alternatives Considered

### Per-stage synthetic ids with a fallback
Rejected. A synthetic fallback silently recreates the non-joinable id that caused TD-069; the failure
becomes hidden rather than surfaced.

## Consequences

Positive:
- ai_triage and heal_events join to runs (TD-069 closed; evidenced in CI 2026-06-29 and a local heal test 2026-06-28).
- Cross-stage run history is reliable.

Negative:
- Running a stage standalone (outside run.ts / CI) without CURRENT_RUN_ID now throws by design.

## Related Documents
TECH_DEBT.md (TD-069 resolved, TD-070 run-identity spine), ARCHITECTURE_NORTH_STAR.md.

## Implementation Note - 2026-08-10

ADR-025 clarifies that this canonical Run identity is not an Execution identity.
Product Runs retain their own immutable `run_id` and relate to an accepted
Execution through nullable `execution_id` plus `attempt_ordinal`; legacy CLI/CI
Runs remain unlinked and keep the identity behavior decided here.
