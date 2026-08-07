# TD-UI-067A Application Workspace: Evidence-Backed Readiness

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`forge-ui/server/registry/ApplicationReadinessPresenter.ts`,
`forge-ui/server/context/ApplicationReadinessController.ts`, and focused
TD-UI-067A contract tests

Refresh Trigger:
Readiness decision vocabulary, authority inputs, deterministic derivation,
safe-action policy, or presentation boundary changes

Last Verified:
2026-08-07

---

## Purpose and boundary

TD-UI-067A answers one bounded question at
`/application/readiness?project=<project>`: what can FORGE safely do next for a
specific decision, what prevents a stronger conclusion, and which persisted
evidence supports that conclusion.

Readiness is a read-only projection. It is not Project Status, Truth Confidence,
application health, coverage, freshness, or a release gate. It creates no
persistence, observations, models, evidence, tests, or executions and contains
no mutation control.

## Authority composition

The projection composes existing presentation-safe reads:

- the newest validated project-owned record from immutable ObservationStore
  history, including its terminal and authentication outcomes;
- the active model from the authoritative App Model repository/service read,
  after the existing model-history presenter has validated lifecycle,
  validation, integrity, source-observation, and subject linkage; and
- the current-support slice and authoritative totals from the unified Evidence
  ledger. The ledger remains a projection over persisted evidence authorities,
  not a new store.

The controller uses the established repository/service and registry owners. The
route is transport-only. React receives an allowlisted typed read model and does
not reproduce decision rules.

Project Status and Truth Confidence stay visibly independent. This projection
does not reconstruct lifecycle events or recalculate the TD-UI-062B confidence
policy from partial inputs; it directs the operator to Overview for those
separate conclusions.

## Decision vocabulary

Each decision uses one deterministic state:

- `supported` — every required fact is directly established and no material
  limitation prevents the bounded action;
- `supported_with_constraints` — the bounded action is supported, but named
  freshness, integrity, scope, or provenance limitations prevent an
  unconditional statement;
- `blocked` — established negative evidence prevents the action; or
- `unknown` — the required evidence is absent, incomplete, outside the bounded
  read, or not represented by a current authority.

No state is derived from record counts alone. Every result carries an
explanation, exact supporting references, blockers, material unknowns,
limitations, the reason a stronger state was prevented, a bounded safe next
action when one exists, an as-of value, and source-boundary information.

## Deterministic decision policy

### Observe the application

Authentication failure, missing authentication prerequisites, or a blocked or
failed latest observation produces `blocked`. No latest observation, an
interrupted/unknown outcome, or no observed evidence produces `unknown`.
Completed or partial project-owned observation evidence with successful or
not-required authentication produces `supported_with_constraints` while
freshness and observation coverage remain unevaluated. Historical credential
availability never proves that a future process can resolve credentials.

### Design evidence-backed tests

A missing model or missing exact current-support evidence produces `unknown`.
An invalid model, model-integrity failure, failed current evidence integrity, or
established current-evidence conflict produces `blocked`. A malformed authority
fails closed without presenting any readiness conclusion. A valid active model with exact direct-observation
subject linkage and current support produces `supported_with_constraints`
because freshness, total coverage, unobserved scope, conflict evaluation, and
AI-enrichment sufficiency are not established. Historical evidence never counts
as current support.

### Execute existing tests

The current readiness authority does not include a validated current test
inventory, execution preflight, execution credentials, target availability, or
run configuration. This decision is therefore `unknown`; model existence or
evidence quantity cannot upgrade it. The safe navigation target is the Tests
workflow, where those inputs are owned.

### Interpret results confidently

The current readiness authority does not include a current completed execution,
result-set identity, input-health assessment, or result evidence. This decision
is therefore `unknown`; observation or model success cannot substitute for run
evidence. The safe navigation target is the Results workflow.

`supported` remains part of the contract, but no current decision is promoted to
it while an applicable material dimension is explicitly not evaluated.

## Safety and fail-closed behavior

Unknown projects return structured 404 responses. Multiple active models,
ownership conflicts, malformed records, duplicate identities, invalid
timestamps, invalid model/evidence references, or an incomplete bounded
current-support read fail closed. Dependency failures are mapped to fixed safe
categories; unrestricted internal messages are not forwarded.

The read model never contains credential values or reference names, environment
variables, raw model JSON, raw HTML or page content, target URLs, filesystem
paths, SQL/SQLite diagnostics, stack traces, schema payloads, selectors, request
or response bodies, cookies, tokens, headers, or arbitrary persisted prose.

Freshness is `Not evaluated`; coverage and unobserved application scope are
`Unknown`. Evidence integrity, conflict, accessibility, authentication,
observation outcome, model validity, and lifecycle remain independent.

## Presentation and navigation

The Readiness tab presents an authority snapshot followed by one responsive,
accessible card per decision. Details use native disclosures. Exact observation,
model-row, and evidence identities link to their existing project-scoped views.
Safe next actions are navigation only and retain the selected project. Loading,
no-project, unknown-project, malformed-data, and backend-unavailable states are
explicit.

The UI provides semantic headings, statuses, buttons/disclosures, visible focus,
and keyboard-native Enter/Space behavior. It introduces no score, percentage,
grade, color-only state, completeness claim, or mutation action.

## Certification boundary

Focused tests must prove deterministic states, missing/blocked/partial inputs,
invalid models, current-versus-historical evidence, freshness and integrity
limits, conflict visibility, explanations, redaction, project-preserving links,
responsive semantics, and input immutability. Live certification is read-only
and must compare relevant persisted hashes before and after API reads and a
genuine backend restart. Browser certification is manual when the approved
in-app Browser is unavailable.

## Validation and certification record

On 2026-08-07, the TD-UI-067A focused contract and affected Overview,
Observations, Application Model, Evidence, Crawl, and responsive-header
regressions passed 124/124 assertions. The constitutional header verifier,
root and UI type-checks, UI production build, and diff hygiene checks passed.

Read-only Sauce Demo certification established the latest completed,
authenticated observation `d8006951-5d5c-4715-8b57-7deeacb9aea9`; the four
canonical subjects `inventory-html`, `inventory-item-html`, `cart-html`, and
`checkout-step-one-html`; active model row 7/version 1.0.6; and 10 ledger
records, four of which are exact current support. The deterministic decisions
were `supported_with_constraints` for observation and evidence-backed test
design and `unknown` for existing-test execution and result interpretation.
Freshness was not evaluated; coverage and unobserved scope remained unknown;
AI-enrichment sufficiency was not evaluated.

The complete readiness, model, evidence, and observation read-model hashes were
identical across a genuine backend restart. The SQLite database, compatibility
model projection, bootstrap evidence/manifest, generation manifest, and all 16
immutable observation artifacts were byte-identical at the stopped-process
checkpoint. No crawl, test execution, persistence write, or credential read was
performed.

Automated Browser inspection verified one page-level H1, four responsive
decision cards, collapsed native disclosures, Enter/Space activation, visible
focus, project-preserving observation/model/evidence links, refresh and link
return stability, horizontal containment, and a clean forbidden-content scan.
There were no relevant console errors; only the two known React Router
future-flag warnings appeared. Raj completed final manual browser certification
on 2026-08-07 with no relevant FORGE console errors. TD-UI-067A is therefore
implementation-, API-, restart-, automated-browser-, and manual-browser-certified.
