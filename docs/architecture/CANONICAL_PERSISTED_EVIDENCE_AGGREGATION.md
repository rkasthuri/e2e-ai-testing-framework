# Canonical Persisted-Evidence Aggregation

---

Document Authority:
A - Authoritative

Owner:
Architecture Authority

Source of Truth:
ADR-018, ADR-025, `PersistedEvidenceAggregator`, and the permanent TD-ARCH-002
cross-path invariant test

Refresh Trigger:
Product Execution, Run, Result, manifest, lifecycle, outcome, reason, or
integrity-warning semantics change

Last Verified:
2026-08-11

---

## Authority

`src/core/execution/PersistedEvidenceAggregator.ts` is the sole owner of Product
Run aggregation, Execution aggregation, ADR-018 weakest-truth interpretation,
manifest reconciliation, missing-evidence meaning, and persisted-evidence
integrity warnings.

It reads only the immutable Execution root, ordered Execution Items, Execution
events and lock, Product Run, and immutable Product Results. It accepts no
executor memory, cached state, runtime outcome, or temporary execution value.
It writes nothing and never repairs persistence.

`ExecutionRunCoordinator`, `ExecutionRecoveryCoordinator`,
`ExecutionResultProjectionService`, Execution status, and cancellation consume
this owner. Those callers retain orchestration or presentation policy, but may
not reinterpret persisted Product evidence.

## Canonical contract

The typed output contains:

- Run lifecycle, observed outcome, terminal outcome, reason, identity, and
  persisted-evidence duration;
- Execution lifecycle, outcome, reason, durable event facts, and terminality;
- expected and observed manifest counts, completeness, and missing ordinals;
- passed, failed, and could-not-verify counts; and
- deterministic, safe integrity warnings and overall integrity state.

Lifecycle, outcome, and reason remain orthogonal. A cancelled Execution may
therefore retain a failed outcome while its reason records operator intent.

## Dominance and tie-breaks

The only Product outcome order is:

`failed > could_not_verify > passed`

For identical persisted evidence the algorithm applies these rules in order:

1. Any persisted failed Result makes Run and Execution failure truth dominant.
   The first failure in immutable manifest order supplies the evidence reason.
2. Otherwise, any persisted `could_not_verify` Result supplies
   `could_not_verify`; the first such Result in manifest order supplies the
   reason.
3. Otherwise, any missing manifest Result makes the Execution
   `could_not_verify` with `expected_result_missing`.
4. Only a complete manifest containing exclusively persisted passed Results can
   produce a passed Execution.

A Product Run's observed outcome is derived only from Results that exist. A Run
with no Result has no observed outcome. If that admitted Run must terminalize,
its terminal outcome is `could_not_verify`; this is a lifecycle terminalization
rule, not a fabricated Result. The Execution aggregate is always manifest-aware.

The important mixed case is unambiguous: one failed Result plus any number of
missing Results remains `failed`. Missing evidence cannot weaken demonstrated
failure to `could_not_verify`.

## Manifest and integrity rules

Execution Items are the expected-work authority. A missing Result remains an
absent row, appears as `expected_result_missing` in the aggregation/projection,
and prevents a passed Execution. No synthetic Result is written.

The aggregator reports safely and deterministically:

- missing expected Result;
- duplicate or conflicting Result identity;
- manifest mismatch;
- conflicting provenance;
- impossible lifecycle/outcome evidence;
- missing linked Run where a completed lifecycle requires one;
- stored Run or Execution aggregate disagreement; and
- unsupported legacy-only evidence in Product linkage.

Warnings do not mutate source records. Structural ambiguity makes the aggregate
integrity-invalid so recovery/status can fail closed; recoverable missing
evidence remains explicit weaker truth.

Legacy event vocabulary is translated once at the aggregator input boundary.
The aggregation contract itself speaks canonical Product vocabulary only.

## Permanent invariant

`scripts/verify-td-arch-002-persisted-evidence-aggregation.test.ts` proves that,
given identical persistence, terminalization, recovery, projection, status, and
cancellation receive byte-identical canonical aggregation. It also proves
failure dominance, missing-evidence behavior, integrity detection, read-only
operation, and absence of runtime/secret input channels.

Adding a Product truth caller with independent aggregation logic is an
architectural defect, even if its current outputs happen to agree.
