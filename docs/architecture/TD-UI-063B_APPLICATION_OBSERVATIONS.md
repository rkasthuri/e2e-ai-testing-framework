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
2026-08-06

---

## Purpose and boundary

TD-UI-063B adds the Observations presentation to the Application workspace at
`/application/observations`. TD-UI-064B supplies its live read model from the
immutable ObservationStore history. The component does not create observations,
sort persisted records, call APIs, or change persistence and engine behavior.

## Presentation contract

The component renders one compact master row per loaded observation and zero or
one full-width detail row immediately after its selected master. The newest row
on a bounded page is selected by default; selecting it again collapses it. A
project-owned deep link may select a historical row only when it belongs to the
active filter and page. Desktop retains native table semantics; the same table
uses compact card-like rows on narrow layouts rather than expanded history.

The selected detail may show its identity, context, start and completion times,
terminal outcome and safe categorized explanation, source, authentication
availability and outcome, observed subjects, unobserved scope, evidence records
and integrity, limitations, unknowns, blockers, and an evidence-backed safe
recommendation. It never renders producer-authored legacy diagnostic prose.

Latest and historical position is distinct from terminal outcome. Completed,
partially completed, blocked, failed, unknown, and interrupted outcomes stay
visible. Freshness is not evaluated because no approved threshold exists.
No observations means no application conclusion is presented.

## Boundary extension

`observationsTypes.ts` is the UI-side read-model boundary. Observation ordering,
freshness, terminal state, evidence meaning, and recommendation safety are
supplied by ObservationStore, the bounded API projection, and
`applicationObservationsAdapter.ts`; the component does not rebuild those rules.
The live read path is documented by
[`TD-UI-064B_LIVE_APPLICATION_OBSERVATIONS.md`](TD-UI-064B_LIVE_APPLICATION_OBSERVATIONS.md).
