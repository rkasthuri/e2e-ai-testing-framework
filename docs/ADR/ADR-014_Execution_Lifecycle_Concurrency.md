<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-014: Execution Lifecycle & Concurrency — ExecutionContext execution lock

## Status
Accepted

## Date
2026-07-10

## Context
forge-ui is a long-lived server that runs the FORGE engine **in-process** via
`ExecutionContext`. The engine's project database is a **single global singleton**
(TD-114, `src/core/storage/db.ts`), scoped per-app by `openProjectDatabase` →
`initDb(workspace.dbPath())` at the start of every crawl (`CrawlRunner.ts:88`).

`initDb` **throws** when the singleton is already open at a *different* path
(`db.ts:50–56`). The CLI one-shot model never closed the DB between runs (the
process exits), but the long-lived server does not — so crawling app B after app A
in one session throws (TD-UI-020):

> `[DatabaseFactory] DB already open at …/saucedemo/… Cannot re-initialize for
> …/orangehrm/… Call closeDb() first.`

Same-app re-crawls are unaffected (same path → idempotent). Separately, nothing
serializes overlapping runs, so two concurrent different-app runs would race the
global handle.

## Decision
`ExecutionContext` owns a single **execution lock** and a **DB close-on-switch**:

1. **Execution lock (serial queue).** Every `submit()` runs under one serial
   queue: the whole sequence — credential pre-flight → DB close-on-switch →
   engine run → release — executes without overlap. This serializes **all
   DB-touching runs** (crawl, authenticated bootstrap, …). One active execution
   engine per local FORGE instance.

2. **DB close-on-switch.** `ExecutionContext` tracks the last opened `dbPath`.
   Before a run, if the target `dbPath` differs, it calls the engine's already
   exported **`closeDb()`** (via dynamic import — **engine untouched**); the
   engine's `openProjectDatabase` then re-scopes to the target. The decision is a
   pure function `shouldCloseDb(lastPath, targetPath)`.

3. **Framing.** This is **"one active execution engine per local FORGE
   instance"** — a deliberate single-writer model (the console-hijack Mission
   Timeline is already single-writer), **NOT a SQLite limitation**.

## Engine invariant
`src/` gets **zero** edits — `closeDb()` is already exported from
`src/core/storage/db.ts`. If a fix ever needs a `src/` change, stop and escalate.

## Phase 2 upgrade path
Isolated execution contexts — `worker_threads` (ADR-012 Phase 2) and/or a
per-connection DB (a path→connection map replacing the single global) — enable
true concurrent multi-app execution. The `submit()` / JobResult contract is
unchanged, so the UI and routes are untouched by that swap.

## Consequences
- Multi-app use works: the DB switches cleanly between apps in one session.
- Runs are serialized (sequential) — acceptable for single-user Phase 1; the
  crawl path already blocks the event loop and the console hijack is already a
  single-writer.
- No engine change; forge-ui-only.

## Implementation Note - 2026-08-10

ADR-025 and Migration 021 add a distinct Product Execution root and manifest.
This does not rewrite the historical `ExecutionContext` decision: its in-process
engine serialization remains separate from the durable per-project Product
execution lock. Current Product policy permits one Run attempt per Execution;
schema capacity for later attempts does not enable concurrency or retries.

## Implementation Note - 2026-08-10 (TD-UI-069B-C-F)

Cooperative cancellation does not weaken either lock. `ExecutionService` first
appends durable operator intent, then signals only the matching in-process
Execution token. The executor polls at bounded safe transitions and is never
hard-killed. A healthy foreign owner retains its lock while cancellation is
pending; on-contact recovery terminalizes a missing or stale owner from the
durable request and releases the lock atomically.

## References
TD-UI-020 (the blocker); TD-114 (per-app DB singleton); ADR-012 (worker_threads
Phase 2); ADR-013 (credential provider — the other ExecutionContext pre-flight).
