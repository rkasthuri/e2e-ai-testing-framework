# TD-UI-062B Domain Contract

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`src/core/domain/tdUi062b.ts` and its contract tests

Refresh Trigger:
Lifecycle, evidence, confidence, or project-identity policy changes

Last Verified:
2026-07-30

---

## Purpose

TD-UI-062B establishes the vocabulary and deterministic domain rules that a
future Truth Board read model may consume. It is not a UI layout, API route, or
persistence schema.

## Canonical vocabulary

Project lifecycle states are:

`created` → `configuring` → `ready_to_observe` → `observing` → `understood`

with explicit `needs_attention`, `stale`, and `archived` states. An archived
project can only become active through an explicit `restore` event.

Truth Confidence is separate from application health:

`unknown`, `low`, `medium`, `high`.

It is derived from currency, coverage, access, integrity, and agreement. It does
not assert that the observed application is healthy.

## Evidence contract

Every evidence record identifies:

- stable project ID
- observation context
- source and subject
- human-readable observation
- capture time
- provenance kind and reference
- integrity and freshness

Credential material is not part of evidence records. Stale or integrity-failed
evidence may remain historical, but cannot support a current high-confidence
claim.

## Explainable state contract

Project Status, Truth Confidence, Crawl, App Model, Test Readiness, Execution,
Results, and Insights should share the same explainability shape:

- meaning
- why
- impact
- evidence references
- unknowns
- blockers
- the higher state prevented by current limitations
- recommended next step

A conclusion without an evidence reference is invalid.

## Lifecycle validation

Lifecycle transitions are append-only events containing project ID, event type,
timestamp, expected revision, reason, and evidence references. Accepted changes
increment `stateRevision` exactly once. Invalid transitions report the current
state, attempted event, and required next action. Revision mismatches fail
closed. The domain helper returns a new event log and never mutates the prior
log.

## Confidence policy implemented by this contract

- No usable evidence produces `unknown`.
- Stale or expired evidence cannot support a current claim.
- Integrity failure cannot produce `high` confidence.
- A critical unknown prevents `high` confidence.
- All five dimensions must be current/complete/verified/valid/agreed, with
  usable evidence and no critical unknown, for `high`.
- Partial but usable evidence produces `medium` unless a hard blocker reduces it
  to `low`.

This is a deterministic first contract, not a permanent product policy for
every domain-specific signal.

## Unresolved policy decisions

The following remain intentionally open and must be decided before persistence
or Truth Board read-model work:

1. Whether evidence freshness thresholds are global, project-specific, or
   subject-specific.
2. Which unknowns are critical for each surface (crawl, model, readiness, run,
   results, and insights).
3. The authoritative registry and persistence schema for stable `project_id`.
4. Whether `needs_attention` and `stale` are derived states, manually entered
   states, or both.
5. The policy-exception process, if any, for historical evidence in a current
   claim.
6. The exact aggregation rules when evidence sources conflict.
7. Whether recommendations are persisted domain records or read-model outputs.

No default is invented for these questions by this implementation.
