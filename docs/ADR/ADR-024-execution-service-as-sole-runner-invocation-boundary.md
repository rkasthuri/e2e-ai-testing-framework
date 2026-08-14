<!-- FORGE - Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-024: Execution Service as Sole Runner Invocation Boundary

## Status
Accepted

## Date
2026-08-10

## Context
TD-UI-069C established a certified
CanonicalTestDefinition-to-ExecutablePlan-to-Playwright path. Product routes
still need durable acceptance, concurrency control, terminal truth, and status
without becoming a second execution owner or bypassing current authority.

## Decision
`src/core/execution/ExecutionService.ts` is the sole Product execution owner and
the only Product boundary permitted to invoke `PlaywrightPlanExecutor`.

For every Start request it re-reads the current definition revision,
re-evaluates compatibility through `ExecutionProjectionService`, re-resolves
governed credentials, checks current runner readiness, projects the semantic
ExecutablePlan, and then asks `ExecutionRepository` for atomic acceptance. Only
after the project lock and `started` event commit may it invoke the runner.

HTTP routes and UI controllers are transport and authority-composition layers.
They must not invoke Playwright, write execution coordination tables, or infer
terminal success. `ExecutionRepository` alone writes `execution_events` and
`execution_locks`.

Terminal persistence uses the weakest supported truth. If a terminal write
fails, the service does not substitute another outcome or release the lock
outside that transaction. The durable start and retained lock remain for
on-contact reconciliation to `interrupted` when live ownership can no longer be
supported.

## Consequences

- Every accepted Product execution has one durable identity before runner work.
- Pre-acceptance refusal creates no lifecycle row or lock.
- Precise runner outcomes remain precise durable terminal outcomes.
- Product routes cannot create an ungoverned Playwright path.
- Streaming, cancellation, autonomous healing, and legacy result integration
  remain outside this decision.

## Implementation Note - 2026-08-10

Under ADR-025 and Migration 021, atomic Start now persists the immutable
Execution root and ordered manifest in the same transaction as the lock and
started event. `ExecutionService` remains the sole Product owner that supplies
the freshly projected manifest. Product Run admission and Result recording are
still excluded and require the next governed slice.

## Implementation Note - 2026-08-10 (TD-UI-069B-C-F)

`ExecutionService` also owns Product cancellation. The HTTP controller requests
cancellation only through that service. The service persists one immutable
`cancellation_requested` event before raising its execution-scoped in-memory
token; `PlaywrightPlanExecutor` can observe the token but cannot persist intent
or mutate lifecycle state. Already-observed Result evidence completes its
atomic append before cancellation is evaluated at the next safe boundary.

## Related
ADR-006 Truth-Telling and Earned Evidence; ADR-013 Credential Resolution Policy;
ADR-014 Execution Lifecycle Concurrency; ADR-015 Provenance Follows Evidence;
ADR-018 Aggregate to the Weakest Truth; ADR-023 Execution Authority and
Workspace Scoping; TD-UI-069B-B; TD-UI-069C.

## Canonical v2 clarification - 2026-08-13

Under [`ADR-028`](ADR-028-canonical-test-definition-v2-and-execution-authority.md),
`ExecutionService` also owns authoritative v2 preflight. It re-reads and
revalidates the current Definition revision, support seal, route identity,
authentication expectation, runner availability, and runtime credential
availability before acceptance. The earlier phrase "authority-composition
layers" no longer describes Product controllers: routes and controllers are
transport only, while core services compose execution authority.
