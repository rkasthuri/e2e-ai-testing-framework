# TD-UI-063B Application Workspace: Observations

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`forge-ui/src/components/application-workspace/ApplicationObservations.tsx` and its contract tests

Refresh Trigger:
Observation fields, history ordering, provenance, or limitation presentation changes

Last Verified:
2026-07-30

---

## Purpose and boundary

TD-UI-063B adds the Observations tab to the Application workspace at
`/application/observations`. It presents the supplied current observation and
chronological history transparently. It does not create observations, sort or
reinterpret domain states, call APIs, or change persistence and engine behavior.

## Presentation contract

Each observation may show its identity, context, start and completion times,
state, reason, prevented stronger state, source, observed subject and scope,
unobserved scope, evidence references and states, limitations, unknowns,
blockers, and an evidence-backed safe recommendation.

Current and historical observations are distinct. Stale, failed, blocked,
incomplete, unknown, missing, conflicting, and integrity-failed conditions stay
visible. No observations means no claim about application completeness or
health.

## Boundary extension

`observationsTypes.ts` is a structural UI-side extension of the existing
read-model boundary. Observation ordering, freshness, state, evidence meaning,
and recommendation safety are supplied by its adapter; the UI does not rebuild
those rules. No persistence, migration, API, crawl, or engine behavior is
part of this task.
