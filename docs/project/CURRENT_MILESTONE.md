# Current Milestone

---

Document Authority:
C — Status/Snapshot

Owner:
Milestone Owner

Source of Truth:
Approved post-M3 truth-alignment brief, current repository evidence, and the
Post-M3 Product Gap Board

Refresh Trigger:
Truth Alignment closes, approved scope changes, a gate completes, or M4 opens

Last Verified:
2026-08-29

---

## Milestone

**Name:** Post-M3 Product Truth Alignment + Prioritized Gap Board

**Status:** Local implementation and validation in progress

**M4 status:** Proposed only; feature implementation not started

## Objective

Make Product UI, copy, current-state documentation, roadmap, tooling guidance,
and API messaging state only what the certified local Product can demonstrate.
Create one authoritative planning baseline before M4 begins.

## Protected baseline

M1, M2, and M3 are formally closed. This batch must preserve:

- observed App Model and canonical v3 Definition authority;
- immutable manual source/proposal and identity-only Save authority;
- immutable ordered Suite revision and exact historical execution authority;
- Execution, Result, evidence aggregation, and Results projection semantics;
- persistence, migration, recovery, and Certification contracts.

## In scope

- truthful local evidence-first Product positioning;
- hiding placeholder routes from primary navigation while labelling direct
  routes Preview / Coming Soon;
- explicit legacy/deprecated messaging for mounted 501 API stubs;
- post-M3 refresh of state, milestone, roadmap, codebase map, limitations, and
  operational setup guidance;
- the authoritative
  [`POST_M3_PRODUCT_GAP_BOARD.md`](../governance/POST_M3_PRODUCT_GAP_BOARD.md);
- a UI-only M3 Add-to-Suite handoff that preselects the exact canonical
  candidate and leaves explicit Suite Save unchanged.

## Out of scope

- M4 implementation;
- failure classification, Insights aggregation, or healing behavior;
- new API contracts, schemas, migrations, packages, or dependencies;
- external authentication, tenanting, cloud, scheduling, bulk import, or
  cross-project execution;
- removal of legacy routes without a separate consumer audit.

## Completion gates

1. All 12 audit discrepancies are represented and prioritized in the Gap Board.
2. Product navigation and copy no longer present placeholders as shipped
   capability.
3. Current-state documents reflect M1-M3 closure and migration 033.
4. Repository-local launcher guidance covers broken global npm/npx shims.
5. Focused M2/M3 UI regression, root and UI TypeScript, UI build, documentation
   integrity, and diff/whitespace checks pass.
6. Package manifests and lockfiles remain unchanged.
7. Aiden reviews the actual diff before any commit. No push occurs without a
   fresh Rule-9 approval for exact commit SHA(s).

## Next milestone recommendation

**M4 — Evidence-Gated Failure Intelligence**

```text
Immutable Result
-> diagnostic evidence projection
-> evidence-gated classification
-> explanation
-> Result detail
-> Insights aggregation
```

Automatic healing is explicitly excluded. M5 is the earliest recommended home
for human-reviewed Healing / Stability proposals after M4 establishes canonical
diagnostic evidence.
