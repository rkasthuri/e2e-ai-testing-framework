# FORGE Project State

---

Document Authority:
C — Status/Snapshot

Owner:
Milestone Owner

Source of Truth:
Git state, commit-matched CI evidence, executable code and tests, completed
milestone records, and root `TECH_DEBT.md`

Refresh Trigger:
A major milestone completes or repository, validation, blocker, or strategic
priority state changes materially

Last Verified:
2026-08-29

---

This snapshot records the post-M3 baseline. Verify volatile claims against Git,
CI, code, tests, migrations, and root [`TECH_DEBT.md`](../../TECH_DEBT.md).

## Repository snapshot

| Item | Verified state |
|---|---|
| Branch | `main` |
| Local / remote baseline | `2e7851ad8ea294d23fb958d88d4d4a06df7de14b`; local `main` and `origin/main` matched at audit start |
| Certified M3 Product SHA | `917023a816ce7aa984f80874a5973045fe36ffe4` |
| Current phase | Post-M3 Product Truth Alignment; M4 feature implementation not started |
| Canonical UI | `forge-ui` through `forge ui` or the repository launcher |
| Product topology | Local, single-user, single-host, workspace SQLite |
| Technical-debt authority | Root `TECH_DEBT.md` |
| Product planning baseline | [`POST_M3_PRODUCT_GAP_BOARD.md`](../governance/POST_M3_PRODUCT_GAP_BOARD.md) |

Unrelated local artifacts existed before this phase and remain outside its
scope: modified `Forge-Tool.png`, untracked `Forge-Tool.ico`, and untracked
`reports/validation/`.

## Certified Product capabilities

- **M1 closed:** observed application intent becomes a canonical v3 Test
  Definition, executes through the Product authority chain, and produces an
  immutable Result.
- **M2 closed:** an immutable ordered Sanity Suite revision can be reopened,
  revised, and executed by exact historical authority to immutable Results.
- **M3 closed:** immutable manual source receives deterministic proposal or
  refusal, identity-only Save, atomic v3 promotion, execution, and Result
  provenance.

The shared certified spine is:

```text
Observed or admitted source
-> canonical Test Definition v3
-> optional immutable Suite revision
-> local Product Execution
-> immutable Result
-> Results projection
```

These closures do not establish general AI authoring, canonical Product failure
triage, automatic healing, Insights aggregation, scheduling, bulk import,
cross-project execution, external-user packaging, cloud persistence, or
multi-tenancy.

## Product maturity boundary

- The M1-M3 local vertical is mature and trustworthy within its certified
  grammar and topology.
- The broader local-product vision remains incomplete.
- External-user beta and cloud/enterprise readiness require separate Product,
  security, deployment, and operational work.

Do not extrapolate local workspace isolation, process registries, or environment
credential resolution into remote, shared, or tenant-safe claims.

## Current work

The active batch aligns Product copy, navigation, legacy API messaging, current
documentation, tooling guidance, and the post-M3 planning baseline. It may carry
the promoted M3 Definition into the existing M2 Suite draft as a preselection,
but it does not change Definition, Suite, Execution, Result, persistence, or
Certification authority.

The proposed next milestone is **M4 — Evidence-Gated Failure Intelligence**.
Its scope and dependencies are defined in the Gap Board; implementation has not
begun.

## Validation context

The deep audit reported 1,869 passing tests, zero failures, and zero skips on the
post-M3 baseline, with root/eval and forge-ui TypeScript checks passing. Those
counts belong to that audited source state and must not be copied forward as
evidence for this working tree. Fresh local validation is required before review.
