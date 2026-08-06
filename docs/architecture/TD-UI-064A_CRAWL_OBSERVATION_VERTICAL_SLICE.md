# TD-UI-064A Crawl and Observation Vertical Slice

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`forge-ui/server/routes/crawl.ts`, `forge-ui/server/registry/ObservationStore.ts`,
`forge-ui/src/pages/CrawlPage.tsx`, and focused contract tests

Refresh Trigger:
Crawl request, observation persistence, credential-status, progress, or result
contracts change

Last Verified:
2026-08-05

---

## Request and data flow

The selected project is carried by `?project=<project-id>`. The Crawl page first
loads read-only pre-observation truth from:

`GET /api/v1/crawl/projects/:appName/context`

That response contains the persisted target, declared observation boundary,
authentication expectation, credential availability as a non-secret state,
configured strategy, limits, and blockers. It never contains credential
material, credential values, or workspace paths.

Starting an observation calls:

`POST /api/v1/crawl`

The control plane rejects unknown projects, unreachable targets, and duplicate
active observations. On acceptance it generates one stable observation ID,
writes an immutable start record, and submits the crawl through `JobRunner` and
`ExecutionContext`. `ExecutionContext` remains the only bridge to the crawl
engine and resolves credential material in memory through the existing
credential-reference mechanism.

The UI polls:

`GET /api/v1/crawl/:observationId/status`

Only real queued, starting, running, and terminal states are returned. Terminal
classification uses the engine result, producer-authored authentication outcome,
App Model subjects, and diagnostics. No percentage or completeness KPI is
created.

After engine termination, the control plane writes one immutable terminal
record under:

`<project workspace>/.forge/observations/<observationId>/terminal.json`

The corresponding immutable start record is `started.json`. Both use
create-only writes; a prior run is never overwritten. Refresh recovery reads:

`GET /api/v1/crawl/projects/:appName/latest`

## Observation truth boundary

A terminal `completed` state means the crawl operation completed and produced
persisted subject evidence. It does not mean the application was completely
covered. Diagnostics produce partial or blocked states, missing subject evidence
fails closed to unknown, and malformed or unreadable engine output fails.

Every terminal record includes run and project identity, observation context,
source kind, target and declared scope, timestamps, terminal state, observed
subjects, unknowns, blockers, evidence references, provenance, and integrity
state. Evidence integrity remains `unknown` unless an explicit integrity
evaluation exists.

Authentication availability and authentication outcome are separate. Credential
presence never proves authenticated coverage, and login-form detection never
proves authentication success.

## Credential-reference lifecycle

ADR-013 persists only a reference to an environment-variable pair in the
project-owned credential sidecar. The reference survives backend and engine
restarts; credential material does not enter project files and must be available
in the backend service environment on every start. The Crawl context exposes
only whether the reference is recorded or default-derived, which resolver owns
it, and whether the pair resolves. When unresolved, the UI instructs the
operator to configure both variables named by the local sidecar for the backend
service account, restart the backend, and verify the non-secret state before
starting an observation.

Concurrent starts are reserved before asynchronous reachability checks. One
request may be accepted for a project; competing requests receive
`OBSERVATION_ALREADY_ACTIVE` and cannot create a second start record.

## Guarded legacy App Model recovery

A normal crawl reads the active SQLite App Model before constructing the
crawler, because the crawler uses a valid prior snapshot for bounded comparison.
If that row is schema-invalid, the read fails before crawler authentication or
observation begins. Force re-crawl is the explicit operator acknowledgement for
the guarded exception: FORGE fingerprints and validates the raw active row,
passes `previousModel: null` to a fresh crawler, validates the fresh candidate
against the current schema, then atomically supersedes the invalid row and
inserts the validated replacement. The transaction rechecks source identity,
active status, raw-payload fingerprint, and incompatibility before activation.

The source row and payload are never deleted, rewritten, parsed as a trusted
model, or presented as current evidence. The replacement row records source row
identity and fingerprint. The observation terminal record additionally preserves
source version, validation diagnostics, detection time, recovery decision, and
validated replacement identity. A failed candidate or transaction leaves the
source active and produces no replacement evidence.

Recovery terminal truth is phase-specific. A guarded-recovery failure records
crawl execution, producer-authored authentication outcome, replacement-model
validation, guarded SQLite persistence, and compatibility projection as separate
outcomes. Authentication or crawl work that occurred is not reclassified as “did
not begin” merely because a later model transition failed. Subjects observed by
the failed run remain bounded run evidence; they are not presented as an active
replacement App Model or as complete application coverage.

Persistence diagnostics cross the repository, service, execution, and
observation boundaries only as an allowlisted stage plus a redacted cause chain.
SQLite error codes and safe constraint identities may be shown. Raw model JSON,
arbitrary driver text, connection details, workspace paths, and credential
material are excluded. A persistence failure recommends inspecting and resolving
that diagnostic before another recovery attempt; it does not prescribe an
unexplained repeated Force re-crawl.

### Canonical candidate boundary

Runtime builders should omit unobserved optional values, but builder discipline
is not the trust boundary. `AppModelRepository` materializes every runtime
candidate exactly once through `AppModelCanonicalCandidate` before it reads or
changes SQLite state. The policy is explicit:

- an object property whose value is `undefined` is omitted, then schema
  validation determines whether that property was genuinely optional;
- an omitted schema-required property is rejected as
  `undefined-required-property`;
- an array hole or `undefined` array element is rejected without shifting or
  replacing array content;
- functions, symbols, bigint values, non-finite numbers, cycles, accessors,
  symbol-keyed or non-enumerable state, and non-plain runtime objects are
  rejected;
- finite scalar values, array order, and meaningful object values are not
  altered. Negative zero is serialized as JSON zero because JSON has no
  distinct negative-zero representation.

The builder audit corrected four concrete optional-property producers:
`ElementClassifier` now conditionally emits repeated-cardinality `hint` and
role-strategy `accessibleName`; `Crawler` conditionally emits prerequisite
`roleId`; and `ApiSpecCrawler` conditionally emits endpoint `parameters`.
`scripts/fixtures/td-ui-064a-rd2-nine-page-candidate.ts` is the synthetic
structural analogue used to exercise the authenticated nine-page shape without
copying live page content, raw model JSON, or credential material.

The successful boundary result is a recursively key-sorted, JSON-compatible,
schema-valid candidate with its exact canonical serialization and SHA-256.
Validation and hashing consume that materialized candidate, never the raw
builder object. Inside the transaction, the repository adds only its allocated
`modelVersion`, validates the resulting snapshot, and writes that exact
canonical serialization to `model_json`. Thus persisted candidate content is
the hashed representation plus the single repository-owned durable identity;
no independent serializer can reintroduce or discard candidate fields.

Failures expose only JSON-pointer-like structural paths, categories, and runtime
types. Values, raw model JSON, page content, paths, connection details, and
credential material remain excluded. Replay lookup, source and active-row
checks, version history, supersession, replacement insertion, and commit remain
separately identified while retaining all-or-nothing rollback.

## Restart-stable status and authentication diagnostics

Implementation note (2026-08-05): live `JobRunner` state remains authoritative
while a job exists in the current backend process. When that state is absent,
the status lookup resolves the project-owned immutable observation pair from
`ObservationStore`; it does not infer lifecycle state from the mutable App
Model. A valid terminal pair returns its persisted terminal vocabulary and the
exact immutable observation evidence. A valid start without a terminal is
classified `unknown` with an explicit interrupted limitation and is never
reported as active. Unknown identities remain not found, ownership mismatches
are rejected, and malformed or duplicate persisted identities fail closed.

Form authentication now records a nine-stage structural trace: credential
reference resolution, login-surface detection, username-control discovery,
password-control discovery, value-entry completion, submit-control discovery,
submission attempt, navigation or page-state change, and post-submit
login-surface evaluation. The trace may contain only stage/outcome, selector
strategy category, counts, booleans, same/different origin and path
classification, and a safe error type. It never contains selector text,
credential or field values, raw URLs, page text, HTML, screenshots, or request
payloads.

Credential-reference resolution and target acceptance are independent facts.
A resolved reference followed by a retained login surface establishes that
discovery, entry, and submission occurred, but it does not establish that the
credentials were incorrect. Recommendations therefore direct the operator to
review target-side acceptance, policy, and anti-automation evidence before
another observation instead of encouraging an unexplained retry.

## Previous wiring gaps

Before TD-UI-064A, Crawl exposed only an in-memory job and a mutable post-run App
Model read. It discarded the engine result, did not persist run-scoped
observation provenance, did not recover terminal results after refresh, did not
guard duplicate starts, and did not expose pre-crawl credential/access truth.
Failures from App Model reads could also leave polling without a durable terminal
record.

TD-UI-064A did not wire the Application Observations tab. TD-UI-064B now reads
these immutable artifacts through a separate bounded, read-only history path;
it does not change this task's writers or status behavior.
