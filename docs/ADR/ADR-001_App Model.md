<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-001: App Model as the Single Source of Truth

Date: 2026-06-29
Status: Accepted

## Context

FORGE consists of multiple subsystems:

- Discovery
- Classification
- Verification
- Generation
- Healing
- Reporting
- Intelligence

Allowing each subsystem to maintain independent models introduces drift, inconsistent behavior, and duplicate logic.

## Decision

(This records the decision moment; the standing principle lives in ARCHITECTURE_NORTH_STAR.md — this
ADR does not redefine it.)

The App Model shall be the single logical source of truth for the platform.

All downstream systems must consume and improve the App Model rather than maintain parallel representations.

## Alternatives Considered

### Independent subsystem models

Rejected.

Creates multiple sources of truth and long-term divergence.

### Event-sourced architecture

Rejected.

Adds complexity without sufficient benefit at current scale.

## Consequences

Positive:

- Consistent behavior across subsystems.
- Simplified healing and verification.
- Easier dashboard drill-down.
- Reduced duplication.

Negative:

- Requires strong schema governance.
- Risk of App Model becoming overly large.

## Related Documents

ARCHITECTURE_NORTH_STAR.md

## Clarification Note — 2026-08-11 (TD-ARCH-003-B0)

The App Model remains FORGE's canonical application understanding and the sole
model consumed by downstream systems. It is derived authority, not raw
Observation authority. [`ADR-027`](ADR-027-canonical-observation-authority-and-evidence-semantics.md)
places immutable Observations upstream in core
and requires each App Model revision to own exact one-way support relationships
to its Observation and gap inputs. This clarification does not authorize a
parallel application model and does not change the original rejection of a
platform-wide event-sourced App Model architecture.
