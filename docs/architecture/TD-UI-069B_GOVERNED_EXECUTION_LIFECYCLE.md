# TD-UI-069B Governed Execution Lifecycle

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
ADR-023, ADR-024, Migration 020, `ExecutionRepository`, `ExecutionService`, and
focused TD-UI-069B-B tests

Refresh Trigger:
Product execution authority, lifecycle schema, stale-lock policy, terminal
vocabulary, Start/Status API, or result linkage changes

Last Verified:
2026-08-10

---

## Implemented boundary

Product UI execution follows one governed chain:

`POST/start → live preflight → ExecutionService → ExecutionProjectionService → atomic beginExecution → PlaywrightPlanExecutor → terminal event + lock release → durable status`

The selected workspace database is the sole Product lifecycle authority.
Legacy CLI/CI execution retains its existing database and reporter ownership;
the two authorities are never implicitly merged.

## Migration 020

`execution_events` is append-only coordination truth:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `execution_id VARCHAR(255) NOT NULL`
- `project_id VARCHAR(255) NOT NULL`
- `event_type VARCHAR(20) NOT NULL`
- `outcome VARCHAR(50) NULL`
- `occurred_at VARCHAR(50) NOT NULL`
- `process_instance_id VARCHAR(255) NOT NULL`
- `safe_code VARCHAR(100) NULL`
- `safe_message TEXT NOT NULL`
- `execution_plan_hash VARCHAR(64) NOT NULL`
- unique (`execution_id`, `event_type`)
- index (`project_id`, `execution_id`)

`execution_locks` is current coordination ownership:

- `project_id VARCHAR(255) PRIMARY KEY`
- `execution_id VARCHAR(255) NOT NULL UNIQUE`
- `process_instance_id VARCHAR(255) NOT NULL`
- `acquired_at VARCHAR(50) NOT NULL`
- `last_heartbeat_at VARCHAR(50) NOT NULL`

Migration 020 is ordered after Migration 019. The SQLite migration coordinator
commits schema and history atomically, verifies exact postconditions, refuses
schema/history divergence, and is restart-safe. Certification uses disposable
databases; applying the migration to a live workspace occurs only as part of an
explicitly authorized Product execution.

## Atomic acceptance and repository ownership

`ExecutionRepository` alone writes lifecycle tables. `beginExecution` verifies
the expected current test-set revision and single active App Model, acquires the
project lock, and inserts the started event and semantic plan hash in one
transaction. A current lock returns `EXECUTION_ALREADY_ACTIVE`; no second
identity, event, or lock commits. Database failure rolls back the whole Start.

The repository also owns heartbeat, exact read, completed/failed terminal
transactions, lock release, and stale/orphan reconciliation. Terminal event
insertion and owned-lock deletion are one transaction.

## Liveness and recovery

There is no daemon. `ExecutionService` heartbeats at bounded executor
transitions. Start and status reads reconcile on contact.

The stale threshold is exactly 120 minutes, matching the existing
`ForgeStreamingReporter` on-next-run stale-run precedent. A foreign-process lock
with a recent heartbeat remains `running`. A lock at least 120 minutes stale, a
started execution with no lock, or a same-process lock whose in-memory task no
longer exists is recorded as `interrupted`; none is inferred as completed.

If terminal persistence fails, neither completion nor another substituted
failure is recorded. The started event and lock remain until truthful
on-contact reconciliation is possible.

## APIs

`POST /api/v1/projects/:appName/execution/start` requires a non-empty unique
definition selection and current revision. It performs a fresh preflight and
then the service repeats current definition, compatibility, credential, runner,
projection, test-set, and App Model checks. `202 Accepted` is returned only
after durable atomic acceptance. Refusals retain precise preflight vocabulary
and persist nothing.

`GET /api/v1/projects/:appName/execution/:executionId/status` reads durable
execution truth and applies only legitimate live-process reconciliation. It
returns `running`, `completed`, `authentication_failed`, `navigation_failed`,
`oracle_failed`, `unsupported_plan`, `executor_failure`, or `interrupted`.
Missing identity is `404`; absence of a lock/process and elapsed time never
become success.

## Result and secret boundaries

Migration 020 intentionally has no `runs` linkage. Existing `RunRepository`,
`TestResultRepository`, and Playwright reporter paths remain the result
authority. Linking the Product lifecycle to those legacy records requires a
separate provenance-preserving reconciliation slice; this implementation does
not create a parallel result system.

Lifecycle persistence contains identifiers, timestamps, safe constant codes
and messages, and semantic hashes only. It does not persist usernames,
passwords, tokens, cookies, storage state, or raw browser exceptions.
