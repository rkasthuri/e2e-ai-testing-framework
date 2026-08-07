# TD-UI-063D / TD-UI-066A Application Workspace: Unified Evidence Ledger

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
Persisted evidence authorities, `forge-ui/server/registry/EvidenceLedgerPresenter.ts`,
and the focused TD-UI-066A contract tests

Refresh Trigger:
Evidence ledger fields, provenance, freshness, integrity, conflict, or context-boundary presentation changes

Last Verified:
2026-08-06

---

## Purpose and boundary

TD-UI-063D established the Evidence presentation vocabulary. TD-UI-066A wires
`/application/evidence?project=<project>` to a bounded, read-only projection of
existing persisted evidence authorities. The ledger is not a new database and
does not copy, rewrite, repair, or generate evidence. It does not calculate
sufficiency, completeness, coverage, health, quality, freshness, or confidence.

## Authority and projection boundaries

The ledger composes two kinds of actual persisted evidence:

- bootstrap evidence records from `.forge/bootstrap-evidence.json`, read through
  `BootstrapEvidenceReader`; and
- immutable crawl evidence records embedded in ObservationStore terminal
  observation artifacts.

SQLite App Model versions, recovery provenance, Overview state, Truth Cards,
diagnostics, recommendations, summaries, and counts are not promoted into new
evidence. Model history is read through the existing ExecutionContext/service
boundary only to establish exact usage references from model subject identity to
immutable observation evidence identity. Overview usage is reported only when
that exact evidence supports the active model. Missing or conflicting exact
references fail closed.

The route `GET /api/v1/projects/:appName/evidence` transports the projection.
Every request re-reads the authorities; no process-memory ledger exists.

## Evidence identity and ownership

Observation evidence retains its exact persisted evidence ID, project ID,
observation ID, and canonical subject ID. A friendly route path is a separate
validated field and never substitutes for canonical subject identity.

The bootstrap package schema has no record ID. The projection therefore derives
a deterministic project-scoped SHA-256 identity from allowlisted structural
fields and exposes `identityOrigin: projection_derived`. It does not claim that
this derived identity was persisted. Bootstrap values, source strings, notes,
and target URLs never enter the presentation projection.

Duplicate identities, cross-project ownership, malformed timestamps, broken
observation-to-subject references, and broken active-model evidence references
fail closed. Historical invalid models with no established evidence link do not
fabricate one.

## Ordering, filtering, and pagination

Ordering is deterministic newest-first by persisted `capturedAt`, with ascending
canonical evidence ID as the stable tie-breaker (`captured-desc-id-asc-v1`).
Filtering occurs before pagination. Supported filters are source class,
current/historical support, integrity, source observation, and inclusive local
calendar From/Through dates. The UI materializes local calendar boundaries into
exact ISO timestamps and displays the applicable timezone.

The default page size is 25 and the maximum is 50. Cursors are opaque and bound
to project, filter set, and ordering. The server supplies project, filtered,
current-support, and historical-support totals from the complete validated
projection; page length is never used as an authoritative total.

## Presentation contract

The compact responsive table presents canonical identity, capture time, source
class, canonical subject, source observation, support position, integrity,
freshness, and availability status. Selecting a row opens zero or one inline
detail immediately below that row. The detail exposes only allowlisted
provenance, exact observation/model links, usage, integrity/freshness, conflict,
limitations, and unknowns. Mouse row selection and semantic buttons coexist;
the buttons provide `aria-expanded`, `aria-controls`, visible focus, and a polite
selection announcement. Filters, cursor, and expanded identity are URL state.

Current support means that an exact current certified view or active-model
reference was established. It does not mean recent, valid, complete,
high-confidence, accessible, or conflict-free. Historical support does not
erase or weaken the original evidence. Source-observation outcome, model
lifecycle, usage position, integrity, freshness, access, and conflict remain
independent dimensions.

Freshness is always presented as `Not evaluated` until an approved policy
exists. Unknown persisted integrity is presented as `Not evaluated`, not as
valid. Coverage remains `Unknown`.

## Boundary extension

The server projection uses allowlisted fields and fixed category summaries. It
does not serialize arbitrary persisted summaries, reasons, errors, diagnostics,
recommendations, bootstrap values, or model payloads. Credential values and
reference names, environment-variable names, raw request/response bodies, raw
model JSON, HTML/page content, sensitive target URLs, cookies, tokens, headers,
form values, captured-value selectors, filesystem paths, SQL/SQLite diagnostics,
stack traces, and schema-validation payloads are outside the read model.

`evidenceTypes.ts` aliases only the typed API presentation contract. UI modules
do not import repository, SQLite, hashing, validation, credential, or persistence
logic. TD-UI-066A does not change persistence, migration, crawl, model,
projection, observation, or evidence-generation behavior and adds no mutation,
retry, repair, crawl, export, or credential control.

## Validation and certification record

Focused TD-UI-066A tests cover authority composition, exact identity joins,
deterministic ordering, totals, filtering before pagination, project/filter-bound
cursors, inclusive date semantics, invalid input, duplicate/ownership/reference
fail-closed behavior, bootstrap redaction, serialized/rendered forbidden-content
scans, inline details, navigation links, responsive semantics, accessibility,
no mutation/completeness claims, and input immutability. TD-UI-063D remains a
regression contract.

On 2026-08-06, focused validation passed 13/13 TD-UI-066A assertions and 6/6
updated TD-UI-063D assertions; the affected TD-UI-064A-S, TD-UI-064B,
TD-UI-065A, and Overview regressions also passed. Root/UI type-checks, the UI
production build, and `git diff --check` passed.

Read-only Sauce Demo API certification established 10 total evidence records:
8 immutable crawl evidence records and 2 bootstrap evidence records. Four are
exact current support for active App Model row 7/version 1.0.6; six are
historical support. The latest completed observation contributes exactly the
canonical subjects `inventory-html`, `inventory-item-html`, `cart-html`, and
`checkout-step-one-html`, with route paths remaining separate. Filtering,
totals, cursor rejection, project ownership, exact observation/model links, and
forbidden-content scans passed. The complete ledger data hash was identical
before and after a genuine backend restart.

All 16 immutable observation artifacts, bootstrap artifacts, and the
compatibility projection remained byte-identical. SQLite performed a normal WAL
checkpoint during restart; logical integrity remained `ok`, all seven App Model
rows remained identical, and every model payload hash was unchanged.

The in-app Browser runtime reported no available browser on 2026-08-06. No
substitute browser was used. Raj completed manual browser certification on
2026-08-07; this record does not claim automated browser certification.

## TD-UI-066A-R shared-header correction

Manual certification at a 390×844 viewport found that the Evidence ledger had
correctly changed to compact rows, but the shared single-line primary navigation
forced the document to 904 pixels wide. TD-UI-066A-R corrects that shell-level
defect without changing Evidence data or behavior.

At widths below Tailwind's `xl` breakpoint, the shared Header now retains the
bounded selected-project disclosure and theme control in its top row and
replaces the full nine-link row with an accessible primary-navigation
disclosure. The compact menu is composed from the same `TABS` route authority as
desktop navigation, so project-scoped destinations retain the selected project
query parameter. Native buttons provide Enter/Space behavior; disclosure state,
controls, labels, visible focus, Escape close, and focus return are explicit.
Normal desktop navigation remains unchanged at widths where the full route set
fits.

The application shell now establishes `min-width: 0`, maximum viewport width,
and overflow containment; its main region remains independently scrollable and
the status footer may wrap at narrow widths. Evidence responsive rows and their
zero-or-one inline detail contract are unchanged. Focused responsive-header
tests passed 8/8. Raj's manual checkpoint confirmed document containment at
390px, 768px, and 1440px, accessible compact navigation, route reachability,
and unchanged inline Evidence detail behavior. That checkpoint also identified
the Evidence-only 768px breakpoint mismatch addressed below.

### TD-UI-066A-R2 breakpoint alignment

The TD-UI-066A-R manual checkpoint confirmed horizontal containment at 390px,
768px, and 1440px, but found that Evidence alone changed from compact rows to a
semantic desktop table at Tailwind's `md` breakpoint. TD-UI-066A-R2 aligns the
Evidence structural table/card breakpoint with the shared Header at `xl`.
Consequently, 390px and 768px retain compact card-like table rows with their
single inline detail, while 1440px retains the full semantic table and header.
Only responsive display classes changed; filtering, URL state, identity,
selection, detail semantics, APIs, persistence, and other Application tabs are
unchanged. Raj's final manual R2 certification passed the responsive,
keyboard, and date-filter checkpoints with no relevant FORGE console errors.
