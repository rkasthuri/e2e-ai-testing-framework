# TD-UI-063C / TD-UI-065A Application Workspace: Application Model

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`src/core/storage/repositories/AppModelRepository.ts`,
`forge-ui/server/context/ApplicationModelHistoryController.ts`,
`forge-ui/server/registry/ApplicationModelHistoryPresenter.ts`, and
`forge-ui/src/components/application-workspace/ApplicationModel.tsx`

Refresh Trigger:
Application Model authority, history pagination, provenance, integrity,
projection, or presentation-safety behavior changes

Last Verified:
2026-08-06

---

## Purpose and boundary

TD-UI-063C established the presentation vocabulary. TD-UI-065A connects
`/application/model?project=<project>` to authoritative SQLite App Model
history without turning compatibility JSON, observation history, or UI state
into a competing model authority.

The tab is read-only. It does not create, activate, supersede, repair, recover,
rebuild, validate for persistence, hash for persistence, crawl, or project a
model. The UI imports no repository or persistence logic.

## Authority and transport

`AppModelRepository.readHistory()` is the bounded authority read. It validates
model payloads internally and emits only allowlisted presentation metadata;
raw `model_json` and schema-validation diagnostics do not cross the repository
boundary. `AppModelService.readHistory()` preserves the existing service owner,
and `ExecutionContext.readAppModelHistory()` is the dynamic engine/UI bridge.

The compatibility file is read only to classify its relationship to the
active SQLite row as current, unavailable, invalid, or mismatched. It never
supplies a model or repairs SQLite. The project endpoint is:

`GET /api/v1/projects/:appName/model?limit=25&cursor=<opaque>&model=<row-id>`

Limits are bounded to 50, with 25 as the UI default. Opaque cursors are bound
to project identity and deterministic row-identity-descending ordering. Totals
and active counts are computed by the repository, not from the current page.

## Presentation contract

The active model is presented separately from the newest-first model-history
table. Each version reports its database row and semantic version, lifecycle,
model creation time, source observation identity and outcome, validation,
canonical integrity, projection state, evidence state, safe observed subjects,
direct-observation linkage, derived classification, limitations, blockers,
unknowns, recommendation, and guarded-recovery provenance when recorded.

The following meanings remain independent:

- active lifecycle position versus freshness;
- model validity versus evidence coverage;
- persistence integrity versus compatibility projection;
- model creation time versus source-observation time;
- current model versus latest observation;
- observed subject evidence versus derived classification.

Subject identity is also distinct from its route path and from informal labels
used in acceptance prose. The read model preserves each canonical persisted
page `id` exactly and presents its bounded route path separately. For the
certified Sauce Demo model and source observation, the authoritative identities
are `inventory-html`, `inventory-item-html`, `cart-html`, and
`checkout-step-one-html`; their corresponding paths are `/inventory.html`,
`/inventory-item.html`, `/cart.html`, and `/checkout-step-one.html`. The shorter
names `inventory`, `inventory-item`, `cart`, and `checkout-step-one` in the
acceptance expectation were descriptive shorthand, not a second canonical
subject namespace. Direct-observation linkage requires an exact persisted
subject-ID match, so the presentation layer does not strip the `-html` suffix or
manufacture display identities.

No approved freshness policy exists, so the UI says `Freshness: Not evaluated`.
The persisted model does not establish application coverage, so the UI says
`Coverage: Unknown`. Model existence, version, subject count, history count,
and active status never imply completeness, health, quality, readiness, or
currency.

## Fail-closed behavior

Unknown projects, malformed query identities, foreign cursors, malformed
history, missing active authority, and multiple active authorities return
structured errors. A malformed or schema-invalid historical model remains
discoverable by safe lifecycle metadata, but its subjects are not projected.
Missing source observations remain explicit and are not substituted with the
latest observation.

The API does not expose raw model JSON, arbitrary validation or persistence
errors, SQL or SQLite diagnostics, filesystem paths, credentials, environment
references, page content, raw HTML, or unrestricted internal messages.

## Interaction and responsive behavior

History exposes one semantic selection control per row, mouse row selection,
native Enter/Space activation, `aria-expanded`, `aria-controls`,
`aria-selected`, visible focus, and a polite selection announcement. Zero or
one detail region is inserted immediately below its selected row. Selecting the
same row collapses it. URL `cursor` and `model` state supports refresh and
Back/Forward restoration. A single semantic table becomes compact card-like
rows at narrow widths, so no duplicate hidden detail region is rendered.

## Verification status

TD-UI-065A focused disposable-database coverage verifies bounded authority
reads, validation and integrity classification, project-bound pagination,
requested-row handling, source-observation linkage, recovery provenance,
redaction, fail-closed authority states, responsive accessible presentation,
and restart-stable reads. Live API, genuine backend-restart, and browser
certification completed on 2026-08-06 against the existing Sauce Demo authority.
The API and presentation data remained identical across a genuine backend
restart, and all model, observation, and compatibility-projection artifacts
remained unchanged. Raj manually certified the browser surface because the
in-app automated browser was unavailable. The manual pass found no relevant
FORGE console errors; only the known React Router future-flag warnings appeared.
A browser-extension `runtime.lastError` observed during refresh was attributed
to a closed extension message port and was not emitted by the FORGE application.
Manual certification displayed the four canonical subject identities listed in
the presentation contract above; those values accurately match both the active
model and its immutable source observation.
