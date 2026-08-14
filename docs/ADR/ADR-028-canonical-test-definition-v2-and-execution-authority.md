<!-- FORGE - Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-028: Canonical Test Definition v2 and Execution Authority

## Status

Accepted

## Date

2026-08-13

## Context

ADR-027 established exact, sealed, many-Observation App Model support. The
historical Test Definition v1 contract instead names one
`sourceObservationId`, carries route and authentication setup through that
singular provenance, and predates the support seal. Treating one Observation
as representative of a sealed support set would fabricate provenance.

The implemented Product path now has versioned Test Set and Definition
contracts, governed route and authentication projections, and a v2 execution
projection. This ADR records that implemented authority without redesigning
it. It governs only the adopted deterministic navigation slice.

## Decision

### Versioned Test Definition authority

Canonical Test Sets are discriminated by `schemaVersion`.

- Version 1 is immutable historical compatibility. It retains its original
  singular `sourceObservationId` representation and is never silently
  upgraded.
- Version 2 is the active Product generation authority. It contains no
  `sourceObservationId` and identifies its source through the exact sealed App
  Model support package.

A v2 Test Set persists `modelRowId`, `modelVersion`, `observationRunId`,
`supportSealHash`, characterization policy identity, and canonically sorted,
unique Observation and Gap IDs. Each Definition persists the exact
per-subject Observation/Gap subset admitted from that sealed package. It does
not copy full Observation payloads.

`TestDefinitionAuthorityProjectionService` is the read-only core owner that
reconstructs the support package from Product persistence, verifies the seal,
and refuses missing, extra, duplicate, cross-authority, or mismatched support.
It owns no persistence.

### Route evidence authority

`CanonicalRouteEvidenceProjection` is the core route interpretation boundary.
For the adopted crawl slice it accepts only integrity-verified, sealed subject
support from a `browser_dom_inspection` Observation using the supported method
version, predicate `page.discovered`, outcome `present`, and a complete
document boundary.

The projection emits only an origin-independent normalized pathname. It strips
origin, query, and fragment and refuses malformed encodings, userinfo,
network-path forms, backslashes, control characters, traversal segments, and
other unsafe path forms. Its normalization policy ID and version are part of
route identity. Equal routes combine exact supporting Observation IDs;
different routes conflict and are refused. Route evidence must agree with the
active App Model subject. No controller or UI fallback may invent a route.

### Authentication expectation authority

Authentication expectation, credential availability, and authentication
execution result are different truths.

The immutable Definition semantic is `required`, `not_required`, `unknown`, or
`conflicted`. The current implemented basis is governed workspace
configuration under a versioned declaration policy and a safe configuration
digest. It does not persist credentials, credential values, credential
environment-variable names, tokens, or usernames. Configuration is labelled
declared, never observed. No new authentication Observation method is created
by this decision.

Unknown or conflicting expectation remains unknown or conflicted. A v2
Definition may preserve otherwise-valid semantics in a blocked state, but it
is not executable. Credential availability is evaluated only by live
execution preflight and never changes Definition identity or compatibility.
Authentication success or failure belongs to Run/Result evidence.

### Generation admission

`CanonicalTestDefinitionGenerationService` is the core orchestration owner for
new Product v2 generation. A caller supplies project identity and generation
intent, not Observation arrays, Gap arrays, support hashes, routes, or
authentication claims.

Before persistence the service reads sealed authority, route evidence, and
authentication expectation. After obtaining the generation lock it re-reads
all three identities. Any change refuses with stale authority; no revision is
committed from a mixed snapshot. Generated action and oracle semantics are
limited to the current supported deterministic navigation vocabulary.

### Intrinsic compatibility and live eligibility

`DefinitionCompatibilityEvaluator` is the sole owner of intrinsic
compatibility. It evaluates immutable Definition shape: supported action,
oracle, route/authentication semantics, and supported authentication
mechanism. It does not inspect runner or credential availability.

Execution eligibility is live truth owned by `ExecutionService` preflight. It
re-reads current Test Set revision, sealed App Model support, route evidence,
authentication expectation, runner readiness, workspace authority, and, when
authentication is required, runtime credential availability. A Definition may
therefore be intrinsically compatible while live execution is ineligible.

### Execution v2 projection and revalidation

`ExecutionProjectionService` explicitly discriminates v1 and v2. For v2 it
requires the current immutable Test Set revision and content hash, exact model
and support-seal identity, exact per-subject support, current route evidence,
and current authentication expectation. Any mismatch refuses; it is never
normalized or repaired.

The v2 ExecutablePlan references immutable Definition/Test Set identity and
persists model identity, Test Set content hash, support-seal hash, route
evidence identity hash, and authentication expectation identity hash. It does
not duplicate complete Observation support arrays. Semantic plan hashing
excludes projection time; changing Definition semantics, seal, route, or
authentication identity changes the hash.

`ExecutionService` remains the sole Product preflight and runner invocation
owner under ADR-024. Migration 027 extends the immutable Execution root with
the accepted v2 schema and authority hashes. Run and Result provenance remains
the chain `Execution -> manifest -> plan -> Definition`; Observation payloads
are not copied into Run or Result rows.

### V1 compatibility policy

V1 Test Sets and Definitions remain byte-for-byte readable and may be
presented only as legacy provenance. New Product execution refuses v1 with
`legacy_provenance_unsupported` by default. A dependency-injected historical
compatibility policy exists only for governed compatibility tests or an
explicitly approved caller that can supply exact historical authority. It does
not fabricate a seal or convert v1 to v2.

### Controller and presentation boundary

Controllers and routes are transport only. They may identify a project,
selected Definition IDs/revision, and execution or generation intent. They may
not compose support authority, recompute a seal, inject a route, declare
authentication semantics, resolve compatibility, or invoke the runner.

Presentation discriminates v1 from v2 once at its governed boundary. V2 is
shown as sealed canonical support; v1 is labelled legacy provenance. Route
presentation exposes only normalized path evidence. Authentication
expectation, credential availability, and execution result remain separate.

## Implemented drift recorded by this ADR

Current executable evidence differs from several compatibility-era words that
remain in source or earlier documents:

1. `TestDefinitionContract.ts` still exports compatibility aliases named
   `CanonicalTestDefinition` and contains a stale comment saying v1 remains the
   active generation/execution contract. New Product generation and default
   Product execution are v2; the alias exists for v1 compatibility callers.
2. ADR-024 originally called controllers "authority-composition layers."
   Current Product composition is core-owned. Controllers are transport only.
3. `ExecutionPreflightPresenter.ts` retains a compatibility-era v1 projection,
   but the active Product preflight controller delegates authoritative
   preflight to `ExecutionService`.
4. Early schema-v2 revisions may lack route/authentication fields because
   Migration 026 established support identity before those semantics were
   added. They remain readable but execution refuses them; no historical row
   is rewritten.
5. Authentication expectation currently uses declared configuration only.
   Observation-based authentication expectation remains unimplemented and is
   not implied by this ADR.

These are recorded facts and compatibility constraints, not approval to create
new parallel authorities.

## Consequences

- Multiple canonical Observations are never collapsed into a fictional
  primary Observation.
- Route and authentication semantics are independently governed and hashed.
- Stale Definition, support, route, or authentication authority fails closed
  both before generation commit and before execution acceptance.
- Runtime credential and runner state cannot mutate Definition truth.
- Historical v1 remains forensically readable without becoming current
  Product authority.
- Supporting a new action, oracle, authentication mechanism, route policy, or
  Observation method requires a separately governed change.

## Rejected alternatives

- Select the first or newest supporting Observation as v2 provenance.
- Reconstruct route truth from App Model or controller data.
- Coerce unknown authentication to `not_required`.
- Persist credential bindings in a v2 Definition.
- Trust stored intrinsic compatibility as live execution eligibility.
- Execute v1 by fabricating a support seal.
- Repair stale authority during projection or preflight.

## Related

- [`ADR-013_Credential_Resolution_Policy.md`](ADR-013_Credential_Resolution_Policy.md)
- [`ADR-023-execution-authority-and-workspace-scoping.md`](ADR-023-execution-authority-and-workspace-scoping.md)
- [`ADR-024-execution-service-as-sole-runner-invocation-boundary.md`](ADR-024-execution-service-as-sole-runner-invocation-boundary.md)
- [`ADR-025-execution-run-and-test-result-authority.md`](ADR-025-execution-run-and-test-result-authority.md)
- [`ADR-027-canonical-observation-authority-and-evidence-semantics.md`](ADR-027-canonical-observation-authority-and-evidence-semantics.md)
- TD-ARCH-004-A, TD-ARCH-004-B1, TD-ARCH-004-B2, TD-ARCH-004-B3,
  TD-ARCH-004-B4, and TD-ARCH-004-B5
