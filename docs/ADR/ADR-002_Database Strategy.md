<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-002: SQLite + PostgreSQL Database Strategy

Date: 2026-06-29
Status: Accepted

## Context

FORGE targets both local developer usage and enterprise deployments.

Local users require frictionless setup while enterprises require scalable, managed persistence.

## Decision

FORGE shall support:

- SQLite as the default local database.
- PostgreSQL for enterprise deployments.

Kysely shall provide dialect abstraction.

## Alternatives Considered

### PostgreSQL only

Rejected.

Creates unnecessary onboarding friction.

### SQLite only

Rejected.

Insufficient for enterprise scaling requirements.

### NoSQL databases

Rejected.

Relational structure better matches App Model requirements.

## Consequences

Positive:

- Zero-config local onboarding.
- Enterprise scalability.
- Unified query abstraction.

Negative:

- Must maintain multiple dialects.

## Implementation Note — 2026-08-11 (TD-ARCH-001)

The original dialect decision did not define database authority. Repository
evidence showed that location discovery, `DB_URL`, and Migration 004 could
silently mix Product workspace and legacy history. FORGE now requires one of
three explicit runtime authorities: `PRODUCT_WORKSPACE`, `LEGACY_RUNTIME`, or
`DISPOSABLE_CERTIFICATION`.

Product authority resolves only the selected workspace SQLite path, ignores
`DB_URL`, forbids external legacy import, and fails closed when not explicitly
selected. Legacy runtime retains its governed SQLite/PostgreSQL compatibility
and Migration 004 behavior without gaining Product eligibility. Disposable
certification requires an explicit SQLite path and is hermetic. See
[`../architecture/DATABASE_AUTHORITY.md`](../architecture/DATABASE_AUTHORITY.md).

## Clarification Note — 2026-08-11 (TD-ARCH-003-B0)

[`ADR-027`](ADR-027-canonical-observation-authority-and-evidence-semantics.md)
selects hybrid persistence for canonical Observation authority because
the data has two different storage characteristics. Bounded structured runs,
Observations, gaps, corrections, conflicts, artifact metadata, and App Model
support relationships belong in the explicitly selected Product workspace
database. Large or sensitive screenshots, DOM snapshots, bodies, and traces
belong in an immutable workspace artifact store referenced by hash and metadata.
This note does not change the SQLite/PostgreSQL dialect decision or grant
Product authority to legacy runtime databases.
