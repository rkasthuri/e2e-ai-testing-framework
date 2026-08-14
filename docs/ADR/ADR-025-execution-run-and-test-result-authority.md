<!-- FORGE - Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-025: Execution, Run, and Test Result Authority

## Status
Accepted

## Date
2026-08-10

## Context
Product execution lifecycle and the established `runs`/`test_results` domain
are adjacent but not interchangeable. Durable recovery and future reporting
need to answer what was accepted, which attempt ran, and what each expected
item proved without using executor memory or creating parallel result truth.

## Decision
The canonical relationship is `Execution 1 -> 0..N Runs`, `Run 1 -> 0..N Test
Results`, and `Execution 1 -> 1..N Execution Items`. Current Product policy
admits at most one Run (`attempt_ordinal = 1`); the schema permits later
retries, resumptions, and shards only after separately governed admission work.

`ExecutionId`, `RunId`, and `ResultId` are independent immutable identities.
They are related by explicit foreign keys and must never be substituted for one
another. The immutable Execution root owns acceptance provenance and policy;
the ordered immutable Execution manifest owns expected definition/semantic-plan
identity; lifecycle remains event-derived. Runs own attempt lifecycle and
aggregate outcome. Test Results own terminal per-item evidence. Run and
Execution outcomes will be derived only from persisted Results and the expected
manifest under ADR-018's weakest-truth rule, never from executor memory.

Product Runs reference their Execution and carry an attempt ordinal. Legacy
CLI/CI Runs retain `execution_id = NULL` and `origin = legacy`; historical rows
are never silently reclassified. Product Results carry immutable Result and
manifest identity. The Product manifest relationship is enforced by SQLite
write guards because a direct composite foreign key cannot traverse
`test_results.run_id -> runs.execution_id -> execution_items` safely.

The reporting contract is a read-only derived projection over Execution, Run,
Result, and manifest authorities. It never becomes persistence authority.

## Alternatives

- Reuse one identity for Execution and Run: rejected because acceptance can
  exist before any attempt and future retries require multiple Run identities.
- Let Execution own terminal test outcomes: rejected as duplicate Result truth.
- Leave Product linkage in metadata JSON: rejected because relational identity,
  uniqueness, and provenance would be unenforceable.
- Reclassify legacy rows as Product: rejected because provenance was not
  observed historically.

## Tradeoffs
The model adds joins and requires coordinated transaction boundaries. In
return, recovery can distinguish accepted-without-run, running, completed,
interrupted, and unverified states without inference. Nullable linkage remains
necessary for legacy compatibility.

## Consequences
Migration 021 establishes identity and relationship capacity only. Product Run
admission, Product Result append, cross-repository terminalization,
aggregation, cancellation, and reporting remain later slices. A Migration 020
execution is normalized only when its semantic hash uniquely reconstructs a
historical manifest; insufficient evidence refuses the whole migration.

## Future compatibility
Attempt ordinals and one-to-many relationships permit retries, resumptions, and
shards without equating identities. Enabling any of them requires explicit
admission policy, not merely inserting a higher ordinal. Cancellation remains
an Execution lifecycle event and cannot fabricate Run or Result outcomes.

## Implementation note — 2026-08-10 (TD-UI-069B-C-D)
Product Run admission now commits immediately before runner invocation, and
`ExecutionRunCoordinator` appends one immutable Product Result for each
structured per-definition executor outcome. Run aggregation reads only
persisted Results. Execution aggregation also compares those Results with the
immutable manifest, so absent evidence can weaken an Execution to
`could_not_verify` but can never fabricate a Result.

The coordinated terminal transaction updates only the Run aggregate fields,
appends the terminal Execution event, and releases the lock. Migration 022 adds
write guards that make the entire Product Result row, Product Run admission
facts, and both Product evidence rows' existence immutable. Legacy Run/Result
mutation behavior is unchanged. A crash or persistence failure after Run
admission remains non-terminal and reports recovery-required until the
separately governed recovery slice reconciles the persisted authorities.

## Implementation note - 2026-08-10 (TD-UI-069B-C-E)

`ExecutionRecoveryCoordinator` is the sole on-contact recovery owner. It owns
no persistence table: it reads immutable Execution/manifest/event/lock truth,
the Product Run, and immutable Results through their established repositories,
then coordinates any Run terminalization, terminal Execution event, and lock
release in one transaction.

A missing Result remains absent. Recovery weakens Execution outcome against the
manifest, marks incomplete attempts interrupted, and refuses duplicate Results,
manifest mismatch, conflicting provenance, or invalid lifecycle history. A
complete persisted Result set can complete a running Run after process loss; a
completed Run can supply the missing terminal Execution event. Repeated recovery
is a read-only no-op once the authorities agree.

## Implementation note - 2026-08-10 (TD-UI-069B-C-F)

Migration 023 makes new Execution event lifecycle explicit and permits exactly
one immutable `cancellation_requested` event per Execution. Cancellation is a
terminal lifecycle, not a Result outcome: Product Results already appended are
unchanged, unexecuted manifest items receive no synthetic Result, a cancelled
Run aggregates only persisted Results, and the Execution aggregate additionally
weakens against manifest gaps. Recovery preserves `cancellation_requested`,
`cancelled`, and `interrupted` as distinct truths and never upgrades one into
another.

## Implementation note - 2026-08-10 (TD-UI-069B-C-G)

`ExecutionResultProjectionService` is the canonical read-only Product Results
composition owner. It joins the immutable Execution root and manifest,
lifecycle events, the Product Run, and immutable Product Results through their
existing repositories. It derives the headline with ADR-018, represents an
expected item without evidence as `no_result_observed`, and reports aggregate
or integrity disagreement without repairing source records.

The Product Results APIs are workspace-authoritative views only. They do not
invoke execution or recovery, do not federate legacy repo-root records, and do
not create a reporting persistence authority. Result observation details that
Migration 021/022 did not persist remain explicit nulls rather than inferred
provenance.

## Implementation note - 2026-08-11 (TD-ARCH-002)

`PersistedEvidenceAggregator` is now the only Product owner that interprets the
Execution/manifest/Run/Result authorities as an aggregate. A Run's observed
outcome remains Result-only; if an admitted zero-Result Run terminalizes, its
terminal outcome is `could_not_verify` without creating a Result. Execution
outcome is manifest-aware and failure-first: demonstrated failure dominates
missing evidence, while missing evidence prevents passed.

Run terminalization, Execution terminalization, recovery, cancellation,
Results projection, and status consume byte-identical canonical aggregation.
Stored Run and Execution aggregates remain durable historical facts, but are
checked against canonical evidence and surfaced as disagreement rather than
trusted or repaired silently.

## Related
ADR-006; ADR-009; ADR-014; ADR-015; ADR-017; ADR-018; ADR-023; ADR-024;
TD-UI-069B-C-A; TD-UI-069B-C-B; TD-UI-069B-C-C.

## Canonical v2 clarification - 2026-08-13

[`ADR-028`](ADR-028-canonical-test-definition-v2-and-execution-authority.md)
extends the accepted Execution identity without duplicating Observation
payloads. Migration 027 records the Definition schema version, Test Set content
hash, support-seal hash, route-evidence identity hash, and authentication-
expectation identity hash on the immutable Execution root. Result provenance
continues through `Execution -> manifest -> plan -> Definition`.
