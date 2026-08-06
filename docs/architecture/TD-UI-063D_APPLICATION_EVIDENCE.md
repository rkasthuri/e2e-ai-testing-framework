# TD-UI-063D Application Workspace: Evidence

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`forge-ui/src/components/application-workspace/ApplicationEvidence.tsx` and its contract tests

Refresh Trigger:
Evidence ledger fields, provenance, freshness, integrity, conflict, or context-boundary presentation changes

Last Verified:
2026-07-30

---

## Purpose and boundary

TD-UI-063D adds the Evidence tab at `/application/evidence`. It provides a
unified, readable ledger for the evidence behind FORGE's current understanding.
It does not create evidence, validate evidence, merge contexts, or calculate
sufficiency, completeness, freshness, integrity, or confidence.

## Presentation contract

The ledger presents evidence identity, source and run provenance, subject,
display-safe observation summary, project and observation context, timestamps,
freshness, integrity, current-versus-historical support, claim and model usage,
access limitations, and credential-material omission. A simple current versus
historical filter is provided over supplied freshness states.

Conflicts are grouped only when the read model supplies a group. Sources and
observation contexts remain visible and conflicts remain unresolved. Evidence
from incompatible contexts is not silently merged. Missing provenance,
stale/expired/superseded evidence, failed or limited integrity, blocked access,
and evidence that cannot support current claims remain visible.

## Boundary extension

`evidenceTypes.ts` is a structural UI-side extension of the existing read-model
boundary. It accepts display-safe evidence summaries and never includes raw
credential fields. No persistence, migration, API, crawl, engine, or evidence
generation behavior changes are part of TD-UI-063D.
