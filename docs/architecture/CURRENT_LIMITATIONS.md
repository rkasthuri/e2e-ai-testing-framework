# FORGE Current Limitations

---

Document Authority:
A - Authoritative

Owner:
Architecture Authority

Source of Truth:
Current executable repository evidence, accepted ADRs, root `TECH_DEBT.md`,
registered baseline debt, and certified validation

Refresh Trigger:
A local-product constraint, accepted debt fingerprint, compatibility surface,
deployment claim, deferred capability, or migration ceiling changes

Last Verified:
2026-08-14 at `5b85bcb2aab3199c5799d3b68697ccd2c81594d6`

---

This is the single current limitations register. It separates constraints that
are acceptable for today's local Product from debt and future capability. A
deferred capability is not a Product defect unless a current requirement
depends on it.

## Accepted local Product constraints

- FORGE is a single-host local Product.
- Product persistence is the selected workspace SQLite database.
- Observation producer ownership, execution control, and service composition
  are process-local.
- Cancellation combines durable local lifecycle intent with process-local
  signalling to the matching execution.
- The control plane has process-global registries and service composition.
- Credential material is resolved for one local operation and is never
  Definition, plan, Result, or persisted Observation truth.

These are accepted constraints for the current Product. The detailed authority
and rationale are in
[`LOCAL_PRODUCT_CONSTRAINTS.md`](LOCAL_PRODUCT_CONSTRAINTS.md) and
[`DATABASE_AUTHORITY.md`](DATABASE_AUTHORITY.md).

## Known baseline debt

The offline baseline has two accepted App Model findings. Acceptance makes them
comparable; it does not make the malformed rows valid.

| Gate | Accepted fingerprint | Classification |
|---|---|---|
| Active App Model JSON | `3c75df891801910b9d335109b05b37db867489b3aefe5ffc015fe352c4cfc3ef` | `BASELINE_DEBT` |
| Historical App Model JSON | `10a95e848d17bc97956635ec0ce38b957dbcf3c6b14ff30052cfc579e600cdd1` | `BASELINE_DEBT` |

Any changed fingerprint or additional failing gate is `NEW_REGRESSION`, not
accepted debt. Use the governed comparison procedure in
[`../configuration/ACCEPTED_BASELINE_DEBT.md`](../configuration/ACCEPTED_BASELINE_DEBT.md).

## Legacy and compatibility debt

- Canonical Test Definition v1 remains readable historical provenance. New
  Product execution fails closed rather than fabricating a v2 support seal.
- Legacy Observation files and `ObservationStore` remain read-only
  compatibility. Canonical Product paths neither write them nor use them as
  fallback authority.
- Legacy CLI/CI Run and result handling remains a separate legacy authority and
  is not silently merged with Product Execution, Run, or Result.
- Legacy healing and reporting remain outside the canonical Product authority
  spine.
- Bootstrap evidence and agent memory remain compatibility or experimental
  evidence and are not auto-promoted into canonical Observation authority.
- The retired `src/platform` surface is not a supported Product UI; `forge-ui`
  is canonical.

The exact KEEP / RETIRE NEXT / RETIRE LATER disposition is in
[`TD-ARCH-003-B4_LEGACY_OBSERVATION_RETIREMENT.md`](TD-ARCH-003-B4_LEGACY_OBSERVATION_RETIREMENT.md).

## Not cloud-safe

The current architecture does not provide distributed locks or leases, remote
worker identity/attestation, tenant authorization, PostgreSQL Product parity,
durable distributed commands, exactly-once delivery, distributed cancellation,
multi-host recovery, or cloud secret distribution. SQLite workspace authority,
local ownership evidence, and process registries must not be extrapolated into
those claims.

Cloud, multi-tenant, multi-process, distributed-worker, or horizontally scaled
work requires a separately approved architecture decision before Product work.

## Deferred Product capability

The following are future or incomplete capabilities, not defects in the current
certified local Product vertical:

- historical v1 upgrade or deletion;
- Observation correction, supersession, invalidation, conflict sets,
  reconciliation, and retention-event authority;
- acquisition kinds and runtime Observation methods outside the adopted crawl
  slice;
- distributed execution, retries, shards, and cloud workers;
- complete legacy healing/reporting migration;
- multi-tenant authorization and cloud secret management;
- mobile and IoT Product support; and
- complete operator remedy coverage for every gap-producing subsystem.

Detailed older feature limitations remain in
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md), but that dated catalog is not a
second current authority.

## Current canonical path and migration ceiling

The implemented Product path is:

```text
Crawl
-> ObservationRun / Observation / ObservationGap
-> App Model + immutable support seal
-> Canonical Test Definition v2
-> ExecutablePlan v2
-> Execution
-> Run / immutable Result
-> Results Projection
-> API / forge-ui
```

For SQLite Product and disposable-certification authorities, the current
migration ceiling is `027_canonical_v2_execution_authority`. Legacy PostgreSQL
remains capped at `020_execution_lifecycle` and is not Product authority.

## Safe next work

Product development may resume on the certified local authority spine when it
preserves the canonical owners, fail-closed boundaries, and registered debt
comparison. Work that changes deployment topology, authority ownership,
persistence identity, or legacy retirement requires its own approved TD and
architecture review. The highest-value governance follow-up after this closure
is release-candidate configuration and CI evidence alignment; cloud design and
historical data repair remain separate.
