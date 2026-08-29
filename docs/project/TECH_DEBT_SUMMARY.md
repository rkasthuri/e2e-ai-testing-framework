# Technical Debt Summary

---

Document Authority:
C — Status/Snapshot

Owner:
Technical Debt Owner

Source of Truth:
Root `TECH_DEBT.md` and the Post-M3 Product Gap Board

Refresh Trigger:
An active high-priority debt item changes status or the Product Gap Board changes

Last Verified:
2026-08-29

---

This file is a routing summary, not a second debt ledger. Root
[`TECH_DEBT.md`](../../TECH_DEBT.md) is the only authority for TD identity,
priority, and evidence-backed closure.

## Active Product planning

The authoritative prioritized post-M3 view is
[`POST_M3_PRODUCT_GAP_BOARD.md`](../governance/POST_M3_PRODUCT_GAP_BOARD.md).
Its active work is deliberately separated into:

- **M4:** AUDIT-003 and AUDIT-011 — failure intelligence and actionable Result
  diagnostics;
- **Parallel:** AUDIT-005, AUDIT-009, and AUDIT-012 — crawl completeness,
  bounded architecture decomposition, and tooling cleanup;
- **Deferred platform:** AUDIT-004 and AUDIT-008 — external-beta security and
  deeper Settings/environment profiles.

Use root `TECH_DEBT.md` before assigning an existing TD number or changing TD
status. The Gap Board is milestone planning, not permission to reclassify a TD.

## Closed Product milestone history

M1, M2, and M3 are closed. Their closure evidence belongs in
[`PRODUCT_TD_LEDGER.md`](../governance/PRODUCT_TD_LEDGER.md), not in the active
planning list.

The prior version of this summary mixed rows described as open with rows later
annotated as resolved and carried stale pre-M1 priorities. That mixed snapshot
has been retired rather than copied forward. Full historical TD detail remains
preserved in root `TECH_DEBT.md`.

## Status discipline

A TD is resolved only when the root ledger records its required implementation
and CI evidence. A local Product Gap Board status does not satisfy that rule.
Before review or implementation, read the live ledger entry and linked evidence;
do not infer current status from an old summary or milestone narrative.
