<!-- FORGE - Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-022: Atomic SQLite Migration Coordination

## Status
Accepted

## Date
2026-07-28

## Context
FORGE records completed migrations in `kysely_migration`. Under Kysely's standard SQLite migrator, migration bodies execute before their history rows, but the SQLite adapter does not place those operations in one transaction. A multi-statement migration can therefore leave physical schema changes behind while history still reports the migration as pending.

Schema and migration history are one operational truth. Either both advance or neither advances.

## Decision
The SQLite migration coordinator in `src/core/storage/migrate.ts` owns migration ordering, connection scope, transaction boundaries, history bookkeeping, postcondition verification, backup policy, and failure reporting.

For each pending SQLite migration it reserves one connection and executes:

1. `BEGIN IMMEDIATE` to acquire the SQLite write boundary.
2. The existing migration `up()` body.
3. The matching `kysely_migration` insertion.
4. Migration-specific postcondition checks where defined.
5. `COMMIT`.

Any failure executes `ROLLBACK`, reports the exact migration failure, and prevents later migrations from running.

Before Migration 016 or 017, the coordinator compares physical schema with migration history. Schema-ahead and history-ahead states are refused. FORGE does not infer completion, suppress duplicate-object errors, or repair partial schema automatically. The operational response is restoration from a verified backup followed by a clean retry.

Migration 016 postconditions verify its duplicate-active precondition, exact case-sensitive unique partial active-row index, and history row. Migration 017 postconditions verify both nullable operation-identity columns, its exact case-sensitive partial unique index, and history row.

PostgreSQL behavior is unchanged by this decision.

## Rejected alternatives

- **Migration-owned transactions:** rejected because an individual `up()` cannot include the coordinator's subsequent history insertion in the same ownership boundary.
- **Overriding Kysely's SQLite capability flag:** rejected because FORGE must not patch or assume unsupported dependency behavior.
- **`IF NOT EXISTS` or duplicate-column suppression:** rejected because it can convert partial or incorrect schema into a false success.
- **Automatic partial-state repair:** rejected because it guesses historical execution and can destroy evidence.
- **Backup without atomic execution:** rejected because recoverability does not make schema and history consistent.

## Consequences

- SQLite DDL, history insertion, and defined postconditions now commit or roll back together.
- A failed migration is deterministically retryable after rollback.
- Existing mismatches block with an explicit verified-backup restoration remedy.
- Individual migration files remain transaction-free and focused on schema intent.
- Guarded invalid-App-Model recovery is explicitly outside this ADR and remains separately governed.

## Related

ADR-001 App Model as the Single Source of Truth; ADR-002 SQLite + PostgreSQL Database Strategy; ADR-006 Truth-Telling and Earned Evidence; TD-183.
