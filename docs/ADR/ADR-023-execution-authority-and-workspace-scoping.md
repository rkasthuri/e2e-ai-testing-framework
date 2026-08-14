<!-- FORGE - Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-023: Execution Authority and Workspace Scoping

## Status
Accepted

## Date
2026-08-10

## Context
FORGE has two execution entry-point families with different established storage
authorities. Product UI requests resolve a selected project workspace under
`~/.forge-projects/<appName>/.forge/forge.db`. Legacy CLI and CI paths retain
their existing repository-root authority and reporter-owned `runs` and
`test_results` writes. Treating either location as an implicit fallback for the
other would make an execution appear under the wrong project and make durable
status untrustworthy.

## Decision
Product UI execution lifecycle state is resolved from, accepted into, and read
from the selected project's workspace database. The workspace database is the
sole authority for Product UI `execution_events` and `execution_locks`.

Legacy CLI and CI execution continue to use their existing authority. This ADR
does not migrate them, redirect them, or merge their data with Product UI
execution. A future bridge must be explicit, provenance-preserving, and
separately approved; absence in one authority is never evidence about the
other.

The UI bridge prevents a workspace database switch while Product execution is
active in the current process. Product acceptance also rechecks the current
test-set revision and active App Model inside the atomic database transaction.

## Consequences

- Product status survives route/request completion and is scoped by project.
- The repository-root database cannot accidentally receive Product UI
  lifecycle rows through the governed path.
- Legacy `runs` and `test_results` remain unchanged in this slice.
- Cross-authority reporting remains a deliberate future integration, not an
  inferred join.

## Implementation Note - 2026-08-10

ADR-025 and Migration 021 make the authority boundary relational: Product
Executions and their manifests live in the workspace database, Product Runs
explicitly reference that Execution, and legacy Runs retain null linkage. The
presence of compatible columns never authorizes implicit cross-database merging
or Product classification of historical rows.

## Implementation Note — 2026-08-11 (TD-ARCH-001)

Workspace scoping is now enforced below `ExecutionContext` by explicit database
authority. Product execution repositories require Product-eligible provenance;
they cannot use an implicit legacy handle even if that database happens to
contain compatible Product tables. Product authority ignores `DB_URL`, resolves
exactly to the selected workspace, and suppresses Migration 004 external import.
The process-local singleton refuses cross-authority selection until closed, so
global state can fail closed but cannot silently redirect Product execution.

## Related
ADR-002 Database Strategy; ADR-009 Canonical Run Identity; ADR-012 Engine/Job
Architecture; ADR-014 Execution Lifecycle Concurrency; ADR-017 What FORGE
Observes FORGE Keeps; ADR-024 Execution Service as Sole Runner Invocation
Boundary; TD-UI-069B-B.

## Clarification Note — 2026-08-11 (TD-ARCH-003-B0)

[`ADR-027`](ADR-027-canonical-observation-authority-and-evidence-semantics.md)
applies the same explicit Product workspace authority to Observation
rows, gaps, artifact metadata/content, correction and conflict records, and App
Model support relationships. `projectId` plus the repository's selected
`PRODUCT_WORKSPACE` authority identifies ownership; no cwd lookup,
repository-root fallback, persisted alternate workspace path, global project
scan, or legacy database fallback is permitted. This does not merge Product
Observation authority with Product execution authority; their records retain
separate domain ownership inside the same governed workspace database.

## Clarification Note - 2026-08-13 (TD-CONFIG-001-B)

[`ADR-028`](ADR-028-canonical-test-definition-v2-and-execution-authority.md)
adds v2 Test Set, Definition, and accepted Execution authority to this same
explicit Product workspace boundary. Sharing a workspace database does not
merge Observation, App Model, Definition, Execution, Run, or Result ownership;
their immutable identities and relationships remain distinct.
