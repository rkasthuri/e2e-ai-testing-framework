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

Implementation Baseline:
`2e7851ad8ea294d23fb958d88d4d4a06df7de14b`

Current Verification Context:
Reverified by the post-M3 deep audit on 2026-08-29 against committed `main`,
including certified M1-M3 Product behavior and migrations through 033.
Uncommitted truth-alignment work is not Product capability evidence.

---

This is the single current limitations register. It separates constraints that
are acceptable for today's local Product from debt and future capability. A
deferred capability is not a Product defect unless a current requirement
depends on it.

All authorized onboarding and repository routing must lead here for current
Product limitations. [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) preserves a
dated historical catalog only. It may explain evolution, but it cannot establish
or override current operational truth.

## Accepted local Product constraints

- FORGE is a single-host local Product.
- Product persistence is the selected workspace SQLite database.
- Observation producer ownership, execution control, and service composition
  are process-local.
- Cancellation combines durable local lifecycle intent with process-local
  signalling to the matching execution.
- Canonical execution Start replay is durable and project-scoped: one opaque
  client intent key maps immutably to one accepted Execution and its semantic
  request fingerprint for the lifetime of that Execution row.
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

The canonical offline profile therefore has overall status `FAIL`: both
required malformed-model gates fail. Governed comparison classifies those two
failures as exact `BASELINE_DEBT`, with `NEW_REGRESSION = 0`. This is not an
overall baseline pass.

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
- Top-level `/api/v1/tests`, `/runs`, `/results`, `/insights`, `/settings`, and
  run-stream routes remain mounted 501 compatibility stubs. They are not
  supported Product contracts; canonical M1-M3 transport is project-scoped.
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
- canonical Result diagnostics, evidence-gated failure classification, and
  Insights aggregation;
- automatic healing or human-reviewed repair promotion;
- Product Settings and reusable environment profiles;
- bulk import, scheduling, and cross-project orchestration;
- multi-tenant authorization and cloud secret management;
- mobile and IoT Product support; and
- complete operator remedy coverage for every gap-producing subsystem.

Detailed older feature statements remain in
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) as historical snapshot material.
Its resolved or unverified entries are not current capability claims.

## Current canonical path and migration ceiling

The implemented Product path is:

```text
Crawl / admitted manual source
-> Observation and App Model authority / immutable manual source authority
-> Canonical Test Definition v2 or v3
-> optional immutable ordered Suite revision
-> ExecutablePlan v2
-> Execution
-> Run / immutable Result
-> Results Projection
-> project-scoped API / forge-ui
```

For SQLite Product and disposable-certification authorities, the current
migration ceiling is `033_manual_test_source_promotion_authority`. Migrations
031-033 add canonical v3 Definition, Suite revision, and manual-source promotion
authority. Legacy PostgreSQL remains capped at `020_execution_lifecycle` and is
not Product authority.

## Safe next work

Product development may resume on the certified local M1-M3 authority spine when
it preserves canonical owners, fail-closed boundaries, and registered debt
comparison. The proposed next milestone is evidence-gated failure intelligence,
not healing. Work that changes deployment topology, authority ownership,
persistence identity, or legacy retirement requires its own approved design and
architecture review. See
[`POST_M3_PRODUCT_GAP_BOARD.md`](../governance/POST_M3_PRODUCT_GAP_BOARD.md).
