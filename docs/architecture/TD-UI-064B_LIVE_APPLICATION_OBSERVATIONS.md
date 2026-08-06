# TD-UI-064B Live Application Observations Vertical Slice

---

Document Authority:
A â€” Authoritative

Owner:
Architecture Authority

Source of Truth:
`forge-ui/server/registry/ObservationStore.ts`,
`forge-ui/server/registry/ObservationHistoryPresenter.ts`,
`forge-ui/server/routes/crawl.ts`,
`forge-ui/src/components/application-workspace/applicationObservationsAdapter.ts`,
and focused contract tests

Refresh Trigger:
Observation-history validation, ordering, pagination, safe projection, or
Application Observations presentation changes

Last Verified:
2026-08-06

---

## Authority and read flow

ObservationStore is the sole history authority. The Application Observations
tab does not read the mutable App Model, JobRunner memory, logs, fixtures, or a
second persistence format. The live path is:

`GET /api/v1/crawl/projects/:appName/observations?limit=<n>&cursor=<opaque>&startedFrom=<iso>&startedThrough=<iso>`

The default page contains at most 20 records and the accepted maximum is 50.
The UI requests 25. ObservationStore validates the entire project collection,
computes `projectTotal`, applies inclusive persisted-`startedAt` bounds, computes
`filteredTotal`, and only then slices one page. Neither count is inferred from
the returned array, and pagination does not change either count.

Cursors are opaque and bind the project, ordering contract, inclusive ISO date
bounds, and page anchor. Reusing one with another project or filter fails
closed. The response supplies bounded Previous/Next state; the client never
appends pages or keeps more than one page in the DOM. Unknown projects return
404; invalid limits, exact timestamps, ranges, and cursors return structured
400 responses. Malformed, cross-project, duplicate-identity,
timestamp-invalid, or evidence-invalid persisted collections return the
structured fail-closed `OBSERVATION_HISTORY_INVALID` response.

No read rewrites a start or terminal artifact. A valid start without a terminal
artifact is returned as `interrupted`: it is not reconstructed as active and no
authentication or terminal result is invented.

## Ordering and independent truth dimensions

Records are newest first by persisted `completedAt`, or by persisted `startedAt`
for an interrupted record. Equal timestamps use ascending observation ID as the
stable tie-breaker. The first position is `latest`; later positions are
`historical`. Position never implies success, application truth, or a particular
terminal outcome.

The read model keeps these axes independent:

- position: latest or historical;
- terminal outcome: completed, partially completed, blocked, failed, unknown,
  or interrupted;
- freshness: not evaluated, because no approved threshold exists;
- evidence integrity: the persisted valid, failed, or unknown value on each
  evidence record.

Authentication credential availability and authentication outcome are also
separate. A start-only record has persisted availability but no invented
outcome.

## Safe projection

`ObservationHistoryPresenter.ts` is the authoritative presentation boundary.
It derives an explicit, bounded allowlist from validated records. Producer-authored
legacy prose is never serialized directly: state, authentication, unknown,
blocker, limitation, evidence-summary, and recommendation text is classified
from structured fields into stable safe categories. Information that has no
safe classification fails closed to a bounded generic explanation.

Bounded route paths such as `/inventory.html` may be shown. Origins, query
strings, context target URLs, credential reference names, unrestricted terminal
errors, persistence cause chains, validation payloads, raw model JSON, HTML,
page content, filesystem paths, workspace paths, and SQLite details are not
projected. Recovery provenance exposes only sanitized versions and canonical
fingerprints, row identities, timestamps, phase outcomes, and a safe processing
stage; it never exposes the repository diagnostic payload.

## Presentation

`ApplicationObservationsPage.tsx` owns loading, no-project, unknown-project,
empty-history, no-filter-match, malformed-history, backend-unavailable,
date-filter, cursor, and deep-link-selection states. Local calendar dates are
materialized into inclusive ISO bounds before a request; the applicable browser
timezone is visible. Invalid or reversed draft dates issue no request. Applying
or clearing a filter removes the prior cursor and selection.

The URL persists `project`, optional `observation`, local `startedFrom` and
`startedThrough` dates, and the current opaque cursor. Back, Forward, and
refresh therefore restore a valid bounded result. A requested observation is
classified by ObservationStore as on-page, outside-page, outside-filter, or
not-found. The UI never loads every preceding page to satisfy a deep link and
never bypasses an active filter.

The presentation is an inline master-detail view. One responsive native table
uses compact rows on desktop and card-like rows on narrow layouts. The newest
matching observation on a page is selected by default. Its single full-width
detail row is immediately adjacent to its master row; selecting another row
moves it, and selecting the same row collapses it. No selection causes zero
detail rows. Each row includes a native control named `View observation
<observation-id>` with `aria-expanded` and `aria-controls`; row-wide pointer
activation is additive. Selected state is semantic and visible without color,
and a polite announcement reports expansion or collapse without scrolling.

Summary stays compact; native `details`/`summary` controls keep authentication,
subjects, evidence, limitations/unknowns, and recovery provenance collapsed
until requested. Previous/Next controls keep one bounded page rendered.
Visible run totals are authoritative persisted-record counts and are never
described as coverage, completeness, quality, health, or success.
The tab has no observation mutation controls and does not create health scores,
coverage percentages, freshness claims, or application completeness claims.

## Live certification

On 2026-08-06, Raj manually certified the TD-UI-064B-UXR2 browser surface
against the existing Sauce Demo observation history. All 12 requested manual
checkpoints passed, including inline detail movement and collapse, date
filtering, bounded pagination, URL and refresh restoration, responsive
presentation, forbidden-pattern review, and the relevant browser-console check.
No relevant console errors were observed. In-app browser automation was
unavailable, so this record is manual browser certification and does not claim
automated browser certification.
