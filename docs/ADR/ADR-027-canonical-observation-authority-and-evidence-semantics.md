<!-- FORGE - Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-027: Canonical Observation Authority and Evidence Semantics

## Status

Accepted

## Date

2026-08-11

## Context

FORGE currently persists Product App Model authority in the selected workspace
database while its crawl Observation authority is implemented by
`forge-ui/server` as immutable files. UI/controller code creates Observation
identity, reconstructs terminal page evidence from an already-created App
Model, and joins those files back to model history. Other subsystems use the
word `evidence` for bootstrap records, agent memory, Product execution results,
triage inputs, generic aspirational types, and read projections.

This creates an authority inversion and an overloaded vocabulary. A derived App
Model cannot be the producer of the observations claimed as its basis, a UI
package cannot own core domain truth, and a generic Evidence store would copy
rather than clarify the facts FORGE observed.

TD-ARCH-003-A selected a core-owned Observation authority, Evidence as exact
support/provenance over Observations, and hybrid workspace persistence. This ADR
freezes the contracts required for TD-ARCH-003-B1.

## Decision

### Authority and canonical flow

The canonical flow is:

```text
Producer
  -> ObservationService
  -> ObservationRepository / ObservationArtifactStore
  -> AppModelCharacterizationService
  -> AppModelRepository + immutable support relationships
  -> downstream canonical definitions
```

`ObservationService` in core owns admission, validation, redaction enforcement,
idempotency, correction relationships, and producer/method policy. The
workspace-scoped `ObservationRepository` is the sole structured writer. The
`ObservationArtifactStore` is the sole owner of large or sensitive acquisition
artifacts.

The UI is a caller and projection consumer only. A route or presenter may not
mint Observation outcomes, infer absence, reconstruct support relationships, or
scan projects to locate Observation authority.

### Evidence semantics

Evidence is the provenance/support relationship between a derived claim and
exact immutable Observation IDs. Evidence is not a second fact payload, a
generic persisted object, or an independently writable ledger.

The governed nouns are:

- **Observation:** a persisted fact or indeterminate result established by one
  governed method within one declared boundary.
- **ObservationGap:** an intended observation that did not establish a fact.
- **Evidence support:** an immutable relationship from an App Model claim to an
  exact Observation.
- **Evidence inventory:** a derived read projection over Observations, gaps,
  artifacts, conflicts, corrections, and support relationships.
- **ArtifactReference:** durable metadata identifying an immutable payload
  owned by the ObservationArtifactStore.

There is no generic `EvidenceRepository`.

## Canonical contracts

### Common identity and encoding rules

- New run, Observation, gap, artifact, relationship, and conflict IDs are
  lowercase UUID v4 strings.
- `projectId`, producer IDs, policy IDs, reason codes, predicates, and subject
  IDs are non-empty safe opaque identifiers, at most 255 characters, using
  `[A-Za-z0-9._:-]` after the first alphanumeric character.
- Timestamps are UTC ISO-8601 strings that round-trip exactly.
- Hashes are lowercase SHA-256 hex strings.
- Version fields are immutable non-empty strings identifying the executable or
  governed policy version; they are not floating labels such as `latest`.
- JSON fields use deterministic canonical serialization. Object key order and
  artifact-reference order therefore cannot change an integrity hash.
- Safe messages are optional, redacted, operator-facing text of at most 500
  characters. They are never the only location of a machine-readable reason.

An Observation or gap `integrityHash` covers its canonical semantic content:
schema, owning run/project, producer and method versions, subject/predicate,
outcome or gap reason, bounded value, boundary, capture time, provenance class,
safe reason code, and ordered artifact IDs plus artifact hashes. It excludes the
record UUID, idempotency key, the hash field itself, and database-generated
metadata. Independent records may therefore have matching semantic hashes while
remaining independent because their replay keys differ.

### ObservationRun

An ObservationRun is the lifecycle envelope for one bounded acquisition. Its
lifecycle is not an Observation outcome.

```text
schemaVersion          required  constant "forge-observation-run/v1"
observationRunId       required  UUID v4
projectId              required  Product project identity
workspaceAuthority     required  constant "PRODUCT_WORKSPACE"
producer               required  registered producer identity
producerVersion        required  immutable producer build/version
acquisitionKind        required  governed acquisition vocabulary
startedAt              required  exact UTC timestamp
terminalAt             terminal  exact UTC timestamp, null while running
lifecycle              required  running | completed | blocked | failed | interrupted
completeness           terminal  complete | partial | unobserved; null while running
safeReasonCode         conditional machine-readable safe code
safeMessage            optional  redacted operator explanation
policyId               required  acquisition policy identity
policyVersion          required  acquisition policy version
acquisitionPlanHash    required  SHA-256 of the immutable bounded plan
```

`acquisitionKind` is closed to `web_onboarding`, `web_crawl`, `api_crawl`,
`web_verification`, and `agent_exploration`. `legacy_import` is reserved for a
future compatibility importer and is not a B1 production acquisition kind.

Lifecycle meanings:

- `running`: acquisition was admitted and has no terminal decision.
- `completed`: the producer reached its governed normal terminal boundary.
- `blocked`: a declared prerequisite prevented acquisition from proceeding.
- `failed`: acquisition encountered a governed failure after admission.
- `interrupted`: process or producer continuity ended before a normal terminal
  decision; restart reconciliation uses this value rather than `unknown`.

Completeness meanings:

- `complete`: every intended boundary in the acquisition plan was inspected
  and no coverage-limiting gap remains.
- `partial`: at least one intended fact was established, but a declared boundary
  was incomplete or a coverage-limiting gap remains.
- `unobserved`: no intended fact was established.

`safeReasonCode` is required unless lifecycle is `completed` and completeness
is `complete`. Start fields are immutable. Terminal fields are single-assignment:
one transition from `running` to one terminal lifecycle is permitted; no second
terminalization or reversal is allowed.

The physical workspace path is not persisted as identity. `projectId` plus the
repository's explicit `PRODUCT_WORKSPACE` database authority identifies the
workspace. This prevents a persisted path or parallel workspace ID from
drifting from TD-ARCH-001 authority.

### Observation

An Observation is an immutable record of what one registered producer
established about one subject and predicate, using one governed method, at one
time, inside one declared boundary.

```text
schemaVersion          required  constant "forge-observation/v1"
observationId          required  UUID v4
observationRunId       required  owning run
projectId              required  same project as owning run
producer               required  registered producer identity
producerVersion        required  immutable producer build/version
method                  required  governed Observation method
methodVersion           required  immutable method/policy implementation version
subjectId               required  canonical subject identity
predicate               required  governed fact/claim key
outcome                 required  present | absent | indeterminate
observedValue           optional  bounded safe canonical JSON, maximum 16 KiB
boundary                required  governed ObservationBoundary
capturedAt              required  exact UTC timestamp inside the run interval
idempotencyKey          required  producer-issued opaque replay key
integrityHash           required  SHA-256 over all immutable semantic fields
artifactIds             required  ordered array; empty only when method permits
provenanceClass         required  native | legacy_direct | legacy_reconstructed
safeReasonCode          conditional machine-readable safe code
safeMessage             optional  redacted operator explanation
```

`observedValue` may contain only allowlisted structured values. Raw HTML,
bodies, headers, screenshots, traces, cookies, tokens, and arbitrary runtime
dumps are forbidden inline. It is absent for `absent`; it is normally absent
for `indeterminate`. `safeReasonCode` is required for `indeterminate`.

`provenanceClass` is `native` for all B1 producers. Compatibility import is the
only boundary allowed to admit either legacy value.

An Observation is authoritative only after ObservationService validation and
repository commit. Logs, process memory, App Model contents, and UI projections
are not Observation authority.

#### Field governance

| Field group | Mutable | Sensitive | Indexed in B1 | Forensic purpose |
|---|---|---|---|---|
| IDs, project, producer, method | No | No | IDs/run/producer key | ownership and reproducibility |
| subjectId, predicate, outcome | No | No after validation | subject + predicate | exact fact and query boundary |
| observedValue | No | rejected if sensitive | No | bounded established value |
| boundary, policy versions | No | safe metadata only | No | competence and coverage proof |
| capturedAt | No | No | Yes | temporal ordering without newest-wins |
| idempotencyKey, integrityHash | No | No secrets allowed | unique key; hash not indexed | replay and tamper detection |
| artifact IDs | No | IDs are safe; payload may be sensitive | relationship index | payload provenance |
| safe reason/message | No | must be redacted | reason code only if later proven necessary | failure explanation |

### Observation outcome vocabulary

- `present`: the governed method positively established the predicate, with an
  optional bounded value.
- `absent`: the governed method completed a boundary it is competent to inspect
  and established that the predicate was absent throughout that boundary.
- `indeterminate`: the method ran and produced a durable result, but that result
  cannot determine present or absent within its declared limits.

`unknown`, `missing`, and `none` are not Observation outcomes. UI copy may say
that truth is unknown only when projecting an `indeterminate` Observation, a
gap, a conflict, or the absence of any applicable Observation; it must retain
which of those conditions caused the statement.

### ObservationBoundary

Every Observation carries this immutable bounded object:

```text
schemaVersion       constant "forge-observation-boundary/v1"
kind                document | navigation_attempt | runtime_window | http_exchange
scope               method-specific safe canonical JSON, maximum 8 KiB
startedAt           exact UTC timestamp
endedAt             exact UTC timestamp, not earlier than startedAt
completion          complete | partial
policyId            boundary/settling policy identity
policyVersion       immutable policy version
```

`scope` is validated by the selected method. Unknown fields or an unknown
method/boundary pairing fail closed.

### ObservationGap

An ObservationGap records that an intended observation did not establish a
fact. It is not a negative Observation and cannot support an `absent` claim.

```text
schemaVersion          required  constant "forge-observation-gap/v1"
gapId                   required  UUID v4
observationRunId        required  owning run
projectId               required  same project as owning run
producer                 required  registered producer identity
producerVersion          required  immutable producer build/version
intendedMethod           required  requested method identifier
intendedMethodVersion    required  requested method version
intendedSubjectId        required  intended canonical subject
intendedPredicate        required  intended fact/claim key
boundary                 required  intended/partially inspected boundary
reason                   required  closed gap reason
occurredAt               required  exact UTC timestamp
idempotencyKey           required  producer-issued opaque replay key
integrityHash            required  SHA-256 over immutable semantic fields
artifactIds              required  ordered array, possibly empty
safeMessage              optional  redacted explanation
```

The closed reason vocabulary is:

- `not_reached`
- `acquisition_failed`
- `boundary_incomplete`
- `producer_interrupted`
- `unsupported_method`
- `prerequisite_blocked`
- `redaction_failed`
- `artifact_persistence_failed`

Gaps are immutable. A later successful attempt creates a new Observation; it
does not erase the earlier gap.

### Governed Observation methods

The minimum method registry covers current crawl, onboarding, browser
verification, agent exploration, and API crawl producers without encoding
pipeline-specific method names.

Current producer inventory and governed mapping:

| Current producer | Governed methods | B1 status |
|---|---|---|
| Bootstrap strategy, rendering, auth-surface, and login-surface probes | `browser_dom_inspection`, `browser_runtime_signal` | Contract frozen; producer adoption follows the crawl vertical slice |
| BFS, SPA, and Hybrid crawl strategies | `browser_dom_inspection`, `browser_navigation_attempt`, `browser_runtime_signal` | Required B1 producer path |
| API crawler | `http_response_inspection` | Required B1 producer path |
| VerificationRunner browser checks | `browser_dom_inspection`, `browser_navigation_attempt` | Contract frozen; later producer-adoption slice |
| Supervised agent exploration | `browser_dom_inspection`, `browser_navigation_attempt`, `browser_runtime_signal` | Experimental producer; no B1 authority adoption |
| Product execution results, AI triage, healing, and persisted execution aggregation | None | Separate domain authorities/projections; not Observation producers by relabeling |

| Method | Can establish | Boundary | Can prove absence? | Required provenance/artifacts |
|---|---|---|---|---|
| `browser_dom_inspection` | DOM element/attribute/text-presence facts in one loaded document or declared subtree | `document` after named settling policy | Yes, only for an exhaustive declared query over a `complete` boundary | DOM artifact is mandatory for `absent`; present requires query plan and document digest, with artifact when value is not safely inline |
| `browser_navigation_attempt` | action attempted, resulting document/route/response and observed transition | `navigation_attempt` | No; failed navigation produces a gap or indeterminate result | action identity, start/end subjects, time ceiling; trace required for indeterminate failure diagnosis |
| `browser_runtime_signal` | allowlisted runtime property, counter, or event inside a bounded window | `runtime_window` | Only when the registered method version explicitly declares a closed signal universe and the boundary completed | runtime trace/digest; full trace artifact mandatory for `absent` |
| `http_response_inspection` | status, allowlisted header, or structured body fact for one complete exchange | `http_exchange` | Yes for an exact header or body predicate only when the entire relevant response section was captured and inspected | response metadata; redacted body artifact mandatory for body-level absence; raw authorization/cookie headers prohibited |

Method versions register their allowed predicate families, boundary schema,
absence competence, and artifact requirements. An unknown method, unknown
version, unsupported predicate, or invalid boundary pairing is refused. When
the producer intended such an attempt, the producer may submit an
`unsupported_method` gap through a known gap-admission contract; the unknown
method never becomes an Observation merely because a string was supplied.

Configuration intake is not an Observation method. Product configuration is a
declared structural input with its own provenance. Product execution results,
AI triage records, and healing records retain their domain authorities and are
not silently reclassified as Observations.

### Negative Observation rule

`outcome = absent` is admissible only when all conditions are true:

1. acquisition for this method completed;
2. `boundary.completion` is `complete`;
3. the registered method version is competent to prove absence for the exact
   predicate and boundary kind;
4. every artifact required by that method is durably stored and hash-matched;
5. the query or inspection covered the declared subject universe rather than a
   sample or first match;
6. no unresolved contradictory Observation of equal or stronger competence is
   applicable; and
7. if a contradiction was reconciled, the approved reconciliation policy and
   selected support are persisted with the derived App Model revision.

`No match returned`, an empty collection, a timeout, an unhydrated page, an
unreached route, or an incomplete response fails this rule. It produces
`indeterminate` or an ObservationGap according to whether the method completed
and returned a durable non-factual result.

### ArtifactReference

Large or sensitive acquisition payloads are immutable artifacts. The reference
metadata is:

```text
schemaVersion       required  constant "forge-observation-artifact/v1"
artifactId          required  UUID v4
observationRunId    required  owning run
projectId           required  same Product workspace project
storageKey          required  opaque workspace-relative store key
sha256              required  lowercase SHA-256 of persisted bytes
mediaType           required  allowlisted media type
byteSize            required  non-negative integer
sensitivityClass    required  internal | sensitive | restricted
redactionState      required  not_required | redacted
capturedAt          required  exact UTC timestamp
retentionClass      required  diagnostic_7d | diagnostic_14d | diagnostic_30d | forensic_pinned
expiresAt           conditional exact UTC timestamp; null for forensic_pinned
retentionState      derived   active | expired | tombstoned | purged
```

`storageKey` is generated by ObservationArtifactStore, is never an absolute
path, contains no traversal segment, and is not accepted from a UI caller.
Artifact content is immutable. Retention state is derived from append-only
artifact-retention events: `active`, `expired`, `tombstoned`, and `purged`.
Expiry and purge retain artifact ID, hash, media type, size, reason, policy, and
timestamps as a tombstone.

Each retention event contains an event UUID, artifact ID, project ID, event type
(`expired`, `tombstoned`, `purged`, `pin_applied`, or `pin_released`), safe
reason code, actor identity, occurred-at timestamp, and retention policy
ID/version. Event order must form a valid state transition. `purged` is terminal
for the original payload; restoring equivalent bytes creates a new artifact
identity rather than reversing the event.

Restricted artifacts are refused in B1 unless an approved encrypted-at-rest
store is available. Secrets are prohibited rather than classified as
restricted.

Payloads that must be artifacts instead of inline Observation values include
screenshots, DOM/HTML snapshots, response bodies, browser/network traces,
videos, console/network dumps, and any payload exceeding 16 KiB.

### Redaction and retention

Redaction occurs before bytes cross the artifact persistence boundary.

Prohibited in structured rows and artifacts:

- credentials and credential values;
- authorization/proxy-authorization headers;
- cookies, session identifiers, bearer/API tokens, and refresh tokens; and
- secret form values or populated password fields.

URL query strings and fragments are stripped by default. A policy requiring a
raw URL must store it only in a protected artifact after field-level redaction;
raw URLs are never inline Observation values.

Default retention:

| Data | Retention |
|---|---|
| Structured runs, Observations, gaps, corrections, support, hashes, and tombstones | workspace lifetime; no automatic expiry |
| Screenshots | `diagnostic_30d` |
| DOM/HTML snapshots | `diagnostic_30d`, reduced to `diagnostic_7d` when sensitive |
| Response bodies | `diagnostic_7d` |
| Browser/network traces | `diagnostic_14d` |
| Other diagnostic artifacts | `diagnostic_30d` |
| Artifact supporting an active model/test definition or placed under forensic hold | `forensic_pinned` |

An artifact cannot be purged while an active canonical revision requires it.
Pin release is an explicit governed action. Expiry never silently deletes the
reference: the retention event and tombstone remain queryable.

### Correction, supersession, and invalidation

Observation content never changes. ObservationService owns immutable
relationships with this contract:

```text
relationshipId            UUID v4
projectId                  Product project identity
targetObservationId        required original Observation
replacementObservationId   required for corrects/supersedes; optional for invalidates
relationshipType           corrects | supersedes | invalidates
reasonCode                 required safe machine-readable reason
safeMessage                optional redacted explanation
actorKind                  producer | operator | compatibility_importer
actorId                    required safe actor/producer identity
actorVersion               optional immutable version
occurredAt                 exact UTC timestamp
policyId                   required correction policy identity
policyVersion              required correction policy version
integrityHash              SHA-256 over the relationship
```

- `corrects`: the replacement establishes that a factual or provenance detail
  in the target was erroneous.
- `supersedes`: the replacement is a later applicable observation under a
  changed boundary or time, without asserting the target was erroneous.
- `invalidates`: the target cannot be used as current support; a replacement
  may be absent.

Targets and replacements must belong to the same Product project.
`corrects`/`supersedes` require compatible subject and predicate families.
Relationships never delete the target. A relationship is itself immutable; a
later decision appends another relationship.

### App Model Observation support

App Model revisions own one-way support relationships. Observations never
reference App Models.

Both support contracts are many-to-many: one model revision has one or more
supporting/bounding source records, and one immutable Observation may support
multiple later model revisions. Subject support is additionally scoped to one
canonical subject and one exact `claimKey`; it is not a duplicate copy of the
Observation.

`app_model_observation_support` conceptually contains:

```text
modelRowId                  FK -> app_models.id
observationId              FK -> observations.observation_id
claimKey                   exact model-level claim identifier
supportRole                basis | corroborates | contradicts | bounds
conflictSetId              nullable FK to immutable conflict set
characterizationPolicyId   required
characterizationPolicyVersion required
linkedAt                   exact UTC timestamp
```

Its primary key is `(modelRowId, observationId, claimKey, supportRole)`.

`app_model_subject_support` conceptually contains the same fields plus
`canonicalSubjectId`. Its primary key is
`(modelRowId, canonicalSubjectId, observationId, claimKey, supportRole)`.
`canonicalSubjectId` must exist in the exact persisted model revision; B1 must
validate this before commit even where model subjects remain encoded in
`model_json`.

Support roles mean:

- `basis`: selected direct input that permits the claim;
- `corroborates`: independent compatible support not required as the sole basis;
- `contradicts`: applicable disagreement preserved with the revision; and
- `bounds`: an indeterminate or narrower Observation that limits coverage,
  confidence, or claim strength.

Only `basis` represents selected support. Selection never removes contradictory
or bounding records. A model-level companion `app_model_gap_support` relates a
model row, claim key, and exact gap ID using role `bounds`; this is required so
partial acquisition cannot disappear between Observation and App Model.

The App Model row, every Observation/subject/gap support row, and every conflict
set used by that revision are inserted in one database transaction. All source
Observations and gaps must already be durable. Missing or cross-project foreign
keys refuse the transaction. Support rows are immutable and cascade-restricted:
neither an Observation nor support row can be deleted while referenced.

### Conflict model

A conflict exists when applicable Observations for the same governed subject,
predicate, and comparable boundary cannot simultaneously be true. Different
timepoints or non-comparable boundaries are not automatically conflicts.

Characterization uses an explicit conflict-detection policy. An immutable
conflict set records:

```text
conflictSetId             UUID v4
projectId                 Product project identity
subjectId                 governed subject
predicate                 governed predicate
boundaryEquivalenceKey    policy-derived stable key
memberObservationIds      two or more exact Observation IDs
state                     unresolved | resolved
selectedObservationIds    empty when unresolved; exact selected set when resolved
detectionPolicyId/version required
reconciliationPolicyId/version required only when resolved
safeReasonCode            required when resolved
createdAt                 exact UTC timestamp
integrityHash             SHA-256 over the immutable assessment
```

No newest-wins rule exists. Resolution may consider method competence,
boundary completeness, artifact integrity, explicit invalidation, and an
approved reconciliation policy. It may not use recency alone.

An unresolved conflict forces the affected App Model claim to an explicit
conflicted/indeterminate representation and prevents stronger confidence. A
resolved conflict retains every member and records selected `basis` plus
unselected `contradicts` support. A later assessment creates a new conflict set
for a new model revision; it does not mutate the earlier set.

### Idempotency

The uniqueness scope is `(projectId, producer, idempotencyKey)` separately for
Observations and gaps.

- Same key plus same integrity hash: safe replay; return the existing identity
  without a second row.
- Same key plus different integrity hash: producer conflict; refuse both
  mutation and silent overwrite.
- Different keys: independent observations, even when semantic content and hash
  match.

Artifact admission is idempotent by `(projectId, artifactId)` and requires the
same hash on replay. Content-address deduplication is optional and is not B1
authority.

### Workspace authority

Every structured write, artifact write, and read resolves through explicit
`PRODUCT_WORKSPACE` database authority. Repository construction requires the
selected workspace and exact project identity.

The canonical path has no cwd discovery, repository-root fallback, `DB_URL`
fallback, global store, or cross-project scan. A caller supplying a project ID
that disagrees with the selected workspace is refused before persistence.

### Historical compatibility

Legacy import is a separate future boundary. Each imported source requires:

```text
originalId                  original source identity
sourcePath                  normalized source-relative path, never authority
sourceSchema                exact legacy schema/version label
contentHash                 SHA-256 of original source bytes
legacyProvenanceClass       clean_direct | reconstructed | ambiguous
importedAt                  exact UTC timestamp
importPolicyId/version      approved importer policy
```

An original UUID may become the canonical ID only when valid, collision-free,
and unambiguous. Otherwise the importer refuses the record; it does not
fabricate replacement identity.

Legacy crawl page evidence reconstructed by UI/controller logic is classified
`reconstructed` and maps only to `provenanceClass: legacy_reconstructed`. It
cannot receive native provenance integrity or prove absence without independent
method artifacts.

Bootstrap evidence remains compatibility-only because its source records lack
canonical identities. Projection-derived hashes are not original IDs. Agent
memory remains experimental/ambiguous and is not automatically imported. Old
files remain read-only and are never silently deleted. This ADR performs no
import or migration.

## TD-ARCH-003-B1 schema-level brief

No SQL is approved by this ADR. B1 implements these conceptual tables:

1. `observation_runs`
   - PK `observation_run_id`.
   - Immutable start/authority/policy fields.
   - Nullable single-assignment terminal fields with lifecycle/completeness
     consistency checks.
2. `observations`
   - PK `observation_id`.
   - FK run, exact project equality enforced by repository and composite key/FK
     where supported.
   - Closed outcome and provenance classes.
   - Unique `(project_id, producer, idempotency_key)`.
   - Immutable after insert.
3. `observation_gaps`
   - PK `gap_id`; FK run; closed reason vocabulary.
   - Unique `(project_id, producer, idempotency_key)`.
   - Immutable after insert.
4. `observation_artifacts`
   - PK `artifact_id`; FK run; unique workspace storage key.
   - Hash/media/size/redaction/retention constraints.
   - Immutable content metadata.
5. `observation_artifact_links`
   - Fields: artifact ID, nullable Observation ID, nullable gap ID, and required
     non-negative ordinal.
   - FK to exactly one Observation or gap through separate nullable columns and
     an exclusive-target check.
   - Unique `(observation_id, ordinal)` and `(gap_id, ordinal)` constraints
     preserve the canonical artifact order.
   - Unique `(observation_id, artifact_id)` and `(gap_id, artifact_id)`
     constraints refuse duplicate artifact links to the same owner.
6. `observation_artifact_retention_events`
   - Append-only events deriving active/expired/tombstoned/purged state.
7. `observation_relationships`
   - PK relationship ID; FKs target/replacement; relationship-specific null and
     same-project constraints; immutable.
8. `observation_conflict_sets` and `observation_conflict_members`
   - Immutable assessment and exact member identities; at least two distinct
     members validated before commit.
9. `app_model_observation_support`
   - Composite PK and FKs defined above; immutable.
10. `app_model_subject_support`
    - Composite PK and FKs defined above; immutable; subject existence checked
      against the committed model candidate before insert.
11. `app_model_gap_support`
    - Composite PK `(model_row_id, gap_id, claim_key)`; immutable `bounds` role.

Cheap B1 indexes:

- Observations by `(observation_run_id, captured_at, observation_id)`.
- Observations by `(project_id, subject_id, predicate, captured_at,
  observation_id)`.
- Unique Observation replay key `(project_id, producer, idempotency_key)`.
- Gaps by `(observation_run_id, occurred_at, gap_id)` and their unique replay
  key.
- Artifacts by `(observation_run_id, captured_at, artifact_id)`.
- Relationships by target and replacement Observation ID.
- Conflict members by Observation ID.
- Model-level support by model row and by Observation ID.
- Subject support by `(model_row_id, canonical_subject_id)` and Observation ID.
- Gap support by model row and gap ID.

No full-text, cross-workspace, generic JSON-value, or content-deduplication index
is approved for B1.

Immutability is enforced below service code. B1 uses database constraints and
mutation-refusal guards/triggers appropriate to the supported SQLite migration
boundary. Foreign-key deletion is restrictive, not cascading, for
Observations, gaps, artifacts, conflict members, and model support.

Transaction boundaries:

- admit the run in one short transaction;
- persist and hash artifact bytes, then admit each Observation/gap and its links
  to already-durable artifact metadata in a short idempotent transaction;
- terminalize the run once in a short transaction;
- create the App Model row, conflict sets, and all model/subject/gap support in
  one transaction after sources are durable; and
- never hold a database transaction open during browser or network acquisition.

## Compatibility and projection boundary

Legacy Observation files, bootstrap evidence, and agent memory do not become
parallel authority. Until a separately approved importer exists, they remain
explicit compatibility sources. An Evidence inventory may display them only
with their compatibility provenance and may not mint native Observation IDs.

The existing Product execution persisted-evidence aggregator remains a
domain-qualified projection over Execution, Run, and Result authority. This ADR
does not rename those domain records or merge them into Observation authority.

## Consequences

Positive:

- Observation authority moves to core and becomes explicitly workspace-scoped.
- App Model and test-definition provenance can use exact immutable support.
- Absence, indeterminate truth, gaps, and conflicts become non-interchangeable.
- Large sensitive payloads receive a governed storage and retention boundary.
- Replay, restart, correction, and historical import behavior fail closed.

Costs:

- B1 requires new structured tables and an artifact store boundary.
- Producers must declare methods, boundaries, policies, and idempotency keys.
- Negative claims require stronger artifacts and may become gaps or
  indeterminate results.
- Existing UI projections and historical files require later compatibility and
  cutover slices.

## Rejected alternatives

- **Keep UI-owned Observation files authoritative:** rejects core ownership,
  relational provenance, and safe cross-restart reconstruction.
- **Persist a generic EvidenceObject:** creates a second fact store and copies
  Observation truth.
- **Store all artifacts inline in SQLite:** creates avoidable database growth,
  disclosure, retention, and backup coupling.
- **Keep all structured authority in files:** weakens atomic support,
  idempotency, querying, and workspace constraints.
- **Newest Observation wins:** discards method competence, boundaries, and
  contradictory evidence.
- **Mutate incorrect Observations:** destroys forensic explainability.
- **Persist workspace filesystem paths as identity:** duplicates and can drift
  from explicit Product database authority.

## Related

- [`ADR-001_App Model.md`](ADR-001_App%20Model.md)
- [`ADR-002_Database Strategy.md`](ADR-002_Database%20Strategy.md)
- [`ADR-006_Truth-Telling and Earned Evidence.md`](ADR-006_Truth-Telling%20and%20Earned%20Evidence.md)
- [`ADR-015_Provenance_Follows_Evidence.md`](ADR-015_Provenance_Follows_Evidence.md)
- [`ADR-016_Map_the_Gap_Prescribe_the_Remedy.md`](ADR-016_Map_the_Gap_Prescribe_the_Remedy.md)
- [`ADR-017_What_FORGE_Observes_FORGE_Keeps.md`](ADR-017_What_FORGE_Observes_FORGE_Keeps.md)
- [`ADR-018_Aggregate_to_the_Weakest_Truth.md`](ADR-018_Aggregate_to_the_Weakest_Truth.md)
- [`ADR-019_Vocabulary_Competence_Boundary.md`](ADR-019_Vocabulary_Competence_Boundary.md)
- [`ADR-020_Evidence-Derived_Confidence.md`](ADR-020_Evidence-Derived_Confidence.md)
- [`ADR-023-execution-authority-and-workspace-scoping.md`](ADR-023-execution-authority-and-workspace-scoping.md)
- [`../architecture/DATABASE_AUTHORITY.md`](../architecture/DATABASE_AUTHORITY.md)
- TD-ARCH-001, TD-ARCH-002, TD-ARCH-003-A, TD-ARCH-003-B0

## Implementation clarification — 2026-08-11

Retention classes are architectural classifications. Numeric durations such as
7, 14, or 30 days in the decision-time defaults above are policy defaults, not
immutable domain or schema truth. TD-ARCH-003-B1 therefore persists
duration-independent classes (`short_lived_diagnostic`, `standard_diagnostic`,
and `forensic_pinned`) together with an explicit retention policy ID/version and
optional expiry timestamp. Policy may change durations without a schema or
domain-contract change.

## B1 scope and recovery clarification — 2026-08-12

TD-ARCH-003-B1 intentionally implements only the exercised canonical crawl
vertical. Configuration, inline API specifications, and local specification
parsing are planning inputs; they do not establish an HTTP exchange and cannot
produce `http_response_inspection` Observations. Only an actual governed HTTP
exchange may do so.

The B1 SQLite implementation therefore includes only Observation runs,
Observations, gaps, artifacts and their immutable links, plus immutable App
Model Observation/subject/gap support. Retention-event authority,
correction/supersession/invalidation, conflict sets and reconciliation,
`corroborates`/`contradicts` roles, runtime-only methods, and acquisition
kinds outside the adopted crawl slice remain deferred. The broader contracts
above preserve the decision history; they are not claims that B1 implements
those deferred capabilities.

B1 recovery explicitly enforces one active crawl Observation producer process
per Product workspace. A different producer instance is not evidence of
failure. A new producer refuses to recover or start while the persisted owner
PID is alive; it may mark a running ObservationRun interrupted only after the
operating system affirmatively reports that PID absent. This is a bounded
single-host policy, not distributed coordination.

## B6 ObservationGap artifact-set correction — 2026-08-14

Architecture Review v3.0 found that the implemented B1 guard closed late
artifact-link insertion only for Observations. Gap integrity hashes already
included the ordered artifact IDs and hashes, Gap/link admission was already
transactional, and link UPDATE/DELETE were already blocked, but a direct late
Gap-link INSERT could still diverge durable membership from the committed hash.

TD-ARCH-003-B6 corrects that implementation defect without changing this
decision's scope. Migration 028 gives native ObservationGaps the same explicit
two-phase persistence discipline: the repository inserts the Gap in an unsealed
transactional state, inserts the complete canonically ordered artifact set, and
performs the sole permitted `unsealed -> sealed` transition before commit.
SQLite guards thereafter reject link INSERT, UPDATE, and DELETE. Existing Gap
rows are preserved and sealed with their current membership; the read projection
recomputes the committed Gap identity and emits a safe integrity warning rather
than repairing any disagreement. The v3.0 finding remains historical evidence
of the defect that existed when that review ran.

## B2 read-projection clarification â€” 2026-08-12

TD-ARCH-003-B2 introduces one core-owned, SELECT-only canonical Observation
read projection for the adopted crawl vertical. It projects ObservationRuns,
Observations, Gaps, immutable App Model support, and artifact metadata without
opening artifact payloads or exposing storage paths. Product UI routes consume
that projection and do not interpret `operation_id` as Observation provenance.

Legacy Observation files remain read-only compatibility evidence and are not
merged with canonical Product authority. Historical import, producer migration,
legacy deletion, correction/conflict authority, and raw artifact reads remain
outside B2.

## B3 historical-import clarification — 2026-08-12

TD-ARCH-003-B3 adds a core-owned historical import service and immutable source
ledger. Import is workspace-scoped, dry-run capable, transactional, restart
safe, and keyed by the exact source kind, relative path, and content hash.
Original identifiers, source schema, hashes, capture time, producer availability,
classification, reason, and legacy provenance class remain explicit.

Canonical promotion is fail closed. It is limited to hash-sidecar-verified,
artifact-free packages that preserve an exact original Observation UUID and
producer identity and satisfy the adopted B1 crawl method, boundary, value, and
integrity contracts. Eligible imports are marked `legacy_direct` or
`legacy_reconstructed`, never `native`. Ambiguous, compatibility-only, and
unsupported sources are recorded without canonical Observation creation.

Bootstrap evidence remains compatibility-only, agent memory remains experimental
compatibility, and `operation_id` is never treated as exact Observation support.
Historical artifact mismatches are refused; matching historical artifacts remain
external references in this slice, so no ArtifactReference row is invented.
Existing legacy files are neither rewritten nor deleted. Producer migration,
legacy deletion, correction/conflict authority, and runtime authority remain
outside B3.

## B4 authority-retirement clarification â€” 2026-08-12

TD-ARCH-003-B4 establishes `ObservationService` as the only active Product
Observation producer and `ObservationReadProjectionService` as the only active
Product read authority. Readiness, test-design, execution, App Model history,
evidence inventory, crawl history, and Product UI routes consume canonical
projection output. `operation_id` remains operation correlation only and is not
Observation identity, provenance, or support.

`ObservationStore` is now a read-only historical compatibility reader and has
no writer API. Legacy Observation and Evidence Ledger projections are available
only through explicitly labelled compatibility endpoints; canonical endpoints
never fall back to them or merge them with Product truth. The files remain
unchanged and readable pending the B5 deletion decision. Historical import,
legacy-file deletion, Results UI, AI, healing, cloud, and conflict authority are
outside B4.

## Canonical Test Definition v2 clarification - 2026-08-13

[`ADR-028`](ADR-028-canonical-test-definition-v2-and-execution-authority.md)
governs the downstream use of ADR-027 support. V2 Test Sets reference the exact
sealed App Model Observation/Gap support and characterization policy; each v2
Definition retains its exact subject-support subset. Route evidence is a safe
projection of qualifying sealed canonical Observations. Authentication declared
by configuration remains declaration provenance and is never relabelled as an
Observation.
