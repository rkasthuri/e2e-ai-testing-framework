# TD-UI-068A Evidence-Backed Tests

---

Document Authority:
A — Authoritative

Owner:
Test Architecture Owner

Source of Truth:
The canonical test-definition contract, test-set repository/service, selected-
project Tests API, and focused TD-UI-068A contract tests

Refresh Trigger:
Test-definition schema, generation policy, provenance, persistence, status, or
presentation behavior changes

Last Verified:
2026-08-07

---

## Purpose and boundary

TD-UI-068A answers: what tests can FORGE justify from current evidence, what
would each test establish, and what remains unsafe or unknown?

This slice designs tests. It does not execute them, report an execution result,
or establish application coverage. Test-design readiness, definition validity,
evidence support, model compatibility, runner compatibility, execution
readiness, execution results, coverage, confidence, freshness, and integrity
remain independent dimensions.

## Audited previous wiring

The pre-TD-UI-068A `/tests` page reads `.forge/generation-manifest.json`, opens
generated source files, and submits the legacy `generate` JobRunner operation.
That path emits reviewable Playwright projections into a workspace. Its
manifest is overwritten, its job index is process-memory only, and it lacks the
exact source-observation, model-row/version, and evidence identities required by
the canonical definition contract. It is therefore a generated-code
projection, not a durable test-definition authority.

The new read model must not infer definitions from those files. Existing files
and manifests remain byte-preserved and may be consumed only by their legacy
workflow until an explicitly governed projection adapter is approved.

## Authority and dependency flow

The server composes generation input from existing owners:

1. the decision-specific `design_evidence_backed_tests` readiness projection;
2. the sole active, validated Application Model and its exact source
   observation;
3. project-owned current-support Evidence ledger records; and
4. the immutable source observation referenced by both model and evidence.

The server passes only allowlisted structural facts into the core generation
service. React renders a typed read model and never owns generation,
validation, hashing, provenance, or persistence rules. The transport route is
thin and does not read SQLite directly.

The SQLite-backed test-set store is the sole authority for canonical test
definitions. It does not mutate ObservationStore, App Model history, Evidence
ledger sources, projections, generated files, or credentials.

## Canonical definition contract

Every immutable revision contains stable set and definition identities,
project identity, a human-readable bounded intent, category, exact canonical
subject references, preconditions, typed steps, an expected observable
outcome, exact observation/model/evidence provenance, generation method and
timestamp, validation and runner-compatibility states, confidence limitations,
material unknowns, unobserved scope, and the reason a stronger definition was
not supportable.

The contract is allowlisted and closed over JSON-compatible values. A candidate
is materialized once, validated after materialization, canonically serialized,
hashed, and persisted using that same representation. Unsupported actions,
selectors, or oracles fail before persistence. Credential values or reference
names, session material, raw page/model content, internal diagnostics, paths,
and database details are outside the contract.

Stable definition identities are derived from project, subject, category, and
intent rather than revision time. A new generation creates a new immutable set
revision; it never rewrites a prior revision.

## Deterministic generation policy

Only exact current-support evidence that agrees with the active model and its
source observation can support a definition. Historical support is excluded.
Model flow, element, selector, or business-rule claims are not promoted unless
the current evidence establishes the same canonical subject, action, and
observable oracle.

An observed canonical subject and bounded route may justify a navigation-intent
proposal. Where authentication setup, direct-route preconditions, selectors,
actions, or an executable oracle are not established, the definition remains
valid as a bounded design but runner compatibility is `blocked` with the
missing facts stated explicitly. Deterministic generation is labelled
`deterministic`; unavailable AI enrichment is a limitation, never a hidden
substitute or favorable inference.

Malformed authority data, missing current support, provenance disagreement,
failed integrity, unsupported runtime constructs, or unsupported actions and
oracles fail closed. Partial or blocked generation is represented truthfully;
it is not rewritten as success.

## Persistence and generation lifecycle

Three SQLite structures separate immutable truth from mutable coordination:

- immutable `test_set_revisions` store validated canonical payloads and their
  SHA-256 fingerprints;
- append-only `test_generation_events` store one started and one terminal event
  for restart-durable status; and
- `test_generation_locks` guard one active generation per project. Locks are
  coordination state, not evidence and are never exposed.

A started event and lock acquisition occur atomically. Canonical revision
insertion, terminal completion, and lock release occur in one transaction.
Failure inserts no partial revision. A terminal failure event and lock release
are also atomic. After restart, a started event owned by an earlier process is
reported as `interrupted`; it is never reconstructed as actively running.

The store uses deterministic newest-first revision ordering and bounded cursor
pagination. Reads return authoritative totals, never totals inferred from page
length. Unknown projects, malformed identities, invalid cursors, duplicate
active generation, and malformed persisted payloads fail closed with bounded
safe errors.

## API and presentation boundary

The selected-project Tests API provides bounded inventory/history reads, a
specific definition read, one evidence-backed generation start, and durable
generation status. Responses contain only validated presentation fields and
safe error categories.

The `/tests?project=<project>` page presents design readiness, the current
revision, a compact inventory with zero or one inline detail, immutable revision
history, exact provenance links, and one generation action only when the
readiness projection declares generation supportable. It always states that
generation neither executes tests nor establishes coverage. Loading, empty,
blocked, partial, failed, malformed, unknown-project, and backend-unavailable
states remain distinct.

## Sauce Demo audit finding

The certified active model has four exact canonical subjects with four exact
current-support evidence records. Its inferred flow contains shorter internal
page references that do not match those canonical subject identities. The flow
is therefore excluded from generation. No selector, authentication acceptance,
business rule, or multi-page workflow is inferred from it. Live acceptance must
derive its definition count from the four exact support relationships rather
than a prescribed favorable count.

## Certification record

On 2026-08-07, focused disposable validation established deterministic
generation, stable identities, exact provenance, historical-evidence exclusion,
unsupported-action/oracle rejection, duplicate-active protection, atomic
rollback, restart-durable reads, bounded cursors, redaction, and responsive
single-detail accessibility semantics. Root/UI type-checks and the UI production
build passed. The infrastructure-unstable full unit suite was not run.

Exactly one authorized Sauce Demo generation was performed. It created revision
1 with four deterministic navigation-intent definitions for `cart-html`,
`checkout-step-one-html`, `inventory-html`, and `inventory-item-html`, each
linked to its exact evidence record, source observation
`d8006951-5d5c-4715-8b57-7deeacb9aea9`, and active model row 7/version 1.0.6.
All four definitions validated; all four remain runner-blocked. Coverage is
unknown and freshness is not evaluated. No test was executed.

The revision and its terminal event committed atomically and survived a genuine
backend restart. Certification also found that the terminal event timestamp was
115 milliseconds earlier than its started event. The immutable live record was
not rewritten and the generation was not retried. Root cause was split clock
ownership: the controller prepared the candidate timestamp before the service
recorded the started event, then persistence reused that earlier value for the
terminal event. The service now owns one lifecycle timestamp at the durable
boundary, and focused regression coverage proves future records cannot reproduce
the ordering defect. Status reads expose `temporalIntegrity: failed` and a
bounded safe category for the preserved live record.

Automated desktop browser checks passed for inventory, a single inline detail,
URL/refresh restoration, exact provenance links, unique element identities,
absence of document overflow, and rendered forbidden-pattern scans. The
available browser controller could not change viewport size or reliably dispatch
native keyboard focus/Enter/Space, so 768 px, 390 px, keyboard focus/activation,
Back/Forward, and console inspection remain manual certification checkpoints.
TD-UI-068A-R now carries revision-level temporal integrity through the
authoritative inventory read model. Revision 1 is explicitly presented as
partially completed with `GENERATION_TIMESTAMP_INCONSISTENT`; its exact
started/completed timestamps remain visible, the immutable record is stated to
be preserved, and it is not treated as temporally reliable. The safe category
and explanation are allowlisted; raw event diagnostics are never returned.

One authorized post-correction generation created revision 2 (row 2) with the
same four bounded definitions and exact observation/model/evidence provenance.
Its service-owned started and completed timestamps are equal, temporal
integrity is verified, and it is the sole current revision. Revision 1 remains
historical and byte-preserved with content hash
`f1096b4d6e6f998e0f755bc110c12c50d55a21881f38eee4a56ef2fade01206c`.
Status, inventory, and history reads returned the same result after a genuine
backend restart; no test was executed and no retry was performed.

The available browser controller still cannot change viewport size or reliably
dispatch native keyboard focus/Enter/Space. Exact manual final checks remain:
open `/tests?project=saucedemo`, verify revision 1 shows failed temporal
integrity and the bounded reason while revision 2 shows verified integrity;
select/collapse a definition with mouse and Enter/Space; verify URL, refresh,
Back/Forward, provenance links, 390 px/768 px/desktop containment, no sensitive
or internal diagnostics, and no relevant FORGE console errors. Until those
manual checks are recorded, API/persistence and restart certification are
complete but browser certification remains pending.
