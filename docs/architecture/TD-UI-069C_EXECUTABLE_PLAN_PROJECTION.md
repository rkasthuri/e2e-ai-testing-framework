# TD-UI-069C Executable Plan Projection

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`src/core/execution/ExecutablePlanContract.ts`,
`src/core/execution/ExecutionProjectionService.ts`, and focused
TD-UI-069C-B contract tests

Refresh Trigger:
Executable-plan schema, supported step/oracle vocabulary, projection failure
vocabulary, or `runnerCompatibility` semantics change

Last Verified:
2026-08-07

---

## Purpose and boundary

TD-UI-069C-B implements the first slice of the projection architecture
designed in TD-UI-069C-A: a pure, deterministic function from an immutable
`CanonicalTestDefinition` (TD-UI-068A) to a typed `CanonicalExecutablePlan`,
or a precise `ProjectionFailure`. It performs no persistence, no ambient
database reads, no clock reads, and no runner invocation. Scope is limited to
today's shipped vocabulary — one step kind, one oracle kind — deliberately;
adding a new kind is a contract change, not a runtime branch.

## ExecutablePlan contract

`CanonicalExecutablePlan` mirrors `CanonicalTestSet`'s own discipline exactly:
construction, validation, canonicalization, and hashing all use one returned
JSON representation (`materializeExecutablePlan`), reparsed and revalidated
after serialization so no downstream layer can rebuild the payload from a
looser runtime object. Supported vocabulary:

- Step: `navigate_to_observed_route` — carries the subject ID and route path
  copied verbatim from the source definition, never computed.
- Oracle: `subject_observable` — resolves to exactly one fixed, bounded
  assertion, `final_url_matches_route_no_navigation_error`. It establishes
  only that navigation reached the observed route with no navigation-level
  failure. It never asserts page completeness, business success, element
  correctness, or data correctness — those are not observed by this oracle
  kind and the contract structurally has no field to invent them from.

Content is SHA-256 hashed — but the hash is computed only from **semantic
execution content** (`schemaVersion`, `planId`, `definitionId`, `title`,
`category`, `steps`, `oracle`, `provenance`), explicitly excluding
`projectedAt` (TD-UI-069C-B-R). `projectedAt` is projection *event* metadata
— it is retained on the full materialized `value`/`json` as useful audit
information, but two projections of the same definition against the same
authority produce an identical `fingerprint` regardless of when each ran.
This is the same "cacheable but never authoritative" separation the
observation model already applies to characterization timestamps, restated
for plan hashing.

The plan is never persisted as its own table: it is reproducibly regenerated
from the immutable definition plus the current authority snapshot, and only
its semantic fingerprint is intended to travel forward as provenance on a
future execution record (TD-UI-069B-A's design). Same definition and same
authority state always yields the same semantic hash; any meaningful change
to steps, oracle, or provenance changes it.

## Projection ownership

`ExecutionProjectionService.projectExecutablePlan(request, authority,
projectedAt)` sits strictly between the immutable `CanonicalTestDefinition`
and the (not-yet-built) `ExecutionService`. It never runs at preflight time —
preflight (TD-UI-069A-C) remains scoped to its own read path. `authority` and
`projectedAt` are caller-supplied so the function is pure and independently
reproducible; there is no ambient database read or clock read inside it.

`runnerCompatibility` on the source definition is not consulted as a gate —
the projector re-derives its own verdict from the definition and the current
authority, so the reason is never staler than the moment of projection.

## runnerCompatibility correction

The generator's stored `runnerCompatibility.explanation`
(`src/core/test-design/TestDefinitionContract.ts`) previously conflated two
orthogonal facts — missing authentication setup and the absence of an
approved runner adapter — in one sentence. It has been corrected to describe
only the definition-level fact: reusable authentication setup is not
established. Runner/adapter availability remains, as already shipped in
TD-UI-069A-C's preflight, an entirely separate, environment-scoped concern
(`runner_unavailable`), never mixed into a definition's own compatibility
reason. This changes only the explanation text future generations produce;
existing immutable revisions 1 and 2 are byte-preserved and unaffected.

## Projection failure vocabulary

`unsupported_action`, `unresolved_selector` (reserved — no code path produces
it until a selector-dependent kind exists), `missing_oracle`,
`missing_auth_setup`, `conflicting_evidence`, `stale_definition`,
`projection_failure`. Never collapsed into a generic `blocked`.

## Current authentication limitation

`missing_auth_setup` is evaluated today from a proxy — whether the
definition's own `preconditions` array is non-empty (its only current
producer is the authentication warning) combined with whether the current
authority expects authentication for the definition's source context. The
content of `preconditions` strings is never inspected, only their presence.
This proxy is expected to be replaced once TD-UI-069C-C adds a structured,
evidence-backed authentication-setup field to the contract.

## Current Sauce Demo result

Applying the projector to the four real, current-revision Sauce Demo
definitions (cart-html, checkout-step-one-html, inventory-html,
inventory-item-html) produces `missing_auth_setup` for all four — expected
and correct. All four pass their navigation-mapping and oracle-mapping checks
(both are fully supported today); none carry structured authentication setup,
and all four require it. This is the precise, single reason replacing the
prior conflated explanation, and it is the concrete target TD-UI-069C-C must
close before any real execution becomes possible.

## Validation and certification record

On 2026-08-07, 12/12 focused TD-UI-069C-B tests passed, covering deterministic
materialization and hashing, each precise failure state, immutability of a
previously returned plan under regeneration, and the structural absence of
any runner/adapter-availability input. The affected TD-UI-068A (12/12),
TD-UI-067A (14/14), and TD-UI-069A-C (12/12) regressions passed unchanged.
The source-header verifier (458/458), root/eval TypeScript check, forge-ui
TypeScript check, forge-ui production build, and `git diff --check` all
passed clean; a forbidden-content scan of the diff found nothing. The
workspace database, repository-root legacy database, 16-artifact observation
set, and both preserved brand-asset hashes were unchanged before and after —
this slice performs no persistence and no runner invocation.

### TD-UI-069C-B-R correction

On 2026-08-07, review found `projectedAt` participated in the plan's content
hash, so two projections of the identical executable fact produced different
fingerprints depending solely on when projection ran. Corrected:
`MaterializedExecutablePlan` now carries `semanticJson` (the canonical
serialization of every field except `projectedAt`) alongside the existing
`json`/`value`; `fingerprint` is computed from `semanticJson`, never `json`.
`projectedAt` remains on `value`/`json` as retained audit metadata — nothing
was removed to solve the hash problem, per TD-UI-069C-B-R's explicit
instruction.

16/16 focused tests passed (12 prior plus 4 added/updated: identical
semantic content hashes identically regardless of `projectedAt`; a route
change, an oracle-affecting subject change, and a provenance change each
still change the hash). The TD-UI-068A (12/12), TD-UI-069A-C (12/12), and
TD-UI-067A (14/14) regressions, the header verifier (458/458), both
TypeScript checks, the production build, and `git diff --check` all passed
clean. No persistence artifact changed — this correction touches only the
hash computation inside a pure, DB-free module.

### TD-UI-069C-C — structured authentication setup

`CanonicalTestDefinition` now carries an optional `authenticationRequired:
boolean` and `authenticationSetup?: { required: true; mechanism;
credentialReference: { usernameEnv; passwordEnv }; provenance:
{ sourceObservationId } }` — a governed mechanism name and a non-secret
credential *reference* (env var names only; never resolved, never a value).
Both fields are optional at the reader/validation layer for backward
compatibility with revisions 1 and 2, which remain byte-preserved and
readable without retroactively inventing a value; new generations always set
`authenticationRequired` explicitly. The generator derives both fields solely
from the existing observation authority's `authenticationOutcome` (already
governed) and the project's existing `authType`/credential-reference sidecar
(read via the new shared `readAuthenticationContext` helper — the same
canonical source Crawl and Preflight already read, not a parallel
representation) — never inventing a mechanism or reference that current
evidence does not establish.

`ExecutionProjectionService` now consumes this structured field exclusively.
The prior proxy (`preconditions.length > 0` combined with the current
authority's expectation) has been fully removed — there is no longer any
code path where free-text preconditions influence compatibility. A
definition with `authenticationRequired === undefined` (predating this
change) is treated as `missing_auth_setup`, never silently promoted. A
supported-mechanism allowlist (`form-login` only — the sole mechanism any
part of FORGE actually implements) prevents a structurally complete but
practically inexecutable mechanism (e.g. a hypothetical SSO app) from being
mistaken for compatibility. Authentication setup is part of execution
meaning: it participates in `CanonicalTestDefinition`'s content hash and
`ExecutablePlan`'s semantic hash exactly like steps and oracle do.

Applying the updated generator to the real Sauce Demo project's actual
current authority (`authType: "form-login"`, a recorded credential reference
`SAUCEDEMO_USERNAME`/`SAUCEDEMO_PASSWORD`, and `authenticationOutcome:
"succeeded"` on the certified source observation) is sufficient: a
deterministic reproduction using these exact real values, verified
independently against the live project configuration, shows the four real
Sauce Demo definitions now project successfully — `runnerCompatibility`'s
stored field itself remains the type-locked literal `'blocked'` (a residual,
explicitly out-of-scope inconsistency — see the certification record below),
but `ExecutionProjectionService`, which never consults that field, returns
`ok`. This was proven by deterministic reproduction of the real authority
values rather than a live mutating regeneration, since the generator is a
pure function and no additional confidence would be gained by mutating the
persisted revision history to demonstrate it.

#### Validation and certification record

On 2026-08-07, 19 new focused tests plus 17 updated TD-UI-069C-B tests
passed (36/36 combined), covering: auth-not-required generation, complete
structured-setup generation, the real Sauce-Demo-shaped success case,
rejection of an inconsistent authority rather than fabrication, all four
required projection states (not required / complete setup / missing setup /
unsupported mechanism), conflicting and stale auth provenance, full removal
of the preconditions proxy (both directions — a definition with unrelated
non-empty preconditions is not blocked, and one with empty preconditions but
genuinely unestablished auth is not promoted), an undefined-shape legacy
definition, the secret boundary (definition JSON and plan JSON/semantic
hash contain only env-var-name references, never values), deterministic
materialization, auth setup's effect on the semantic hash, and runner/adapter
independence. The TD-UI-068A (12/12, with one test corrected — see below),
TD-UI-069A-C (12/12), and TD-UI-067A (14/14) regressions passed. The header
verifier (460/460), both TypeScript checks, the production build, and `git
diff --check` all passed clean.

TD-UI-068A's own forbidden-content test previously forbade the literal
strings `SAUCEDEMO_USERNAME`/`SAUCEDEMO_PASSWORD` outright — written before
a legitimate, non-secret reference to those names was ever expected to
appear. It was corrected to forbid the real SauceDemo demo credential
*values* (`standard_user`/`secret_sauce`) instead, and to assert the
reference names now appear as intended. This is the precise distinction the
architectural rule draws — a reference is not a secret — verified rather
than merely asserted.

**Residual, explicitly out-of-scope inconsistency:** a definition's own
stored `runnerCompatibility.state` remains the type-locked literal
`'blocked'` even when `ExecutionProjectionService` independently returns
`ok` for the same definition, because `runnerCompatibility`'s type was not
widened in this task. `ExecutionProjectionService` never reads that field, so
this does not affect projection correctness, but it is a real, visible
mismatch for any future UI that displays `runnerCompatibility` directly.
Reconciling it (or widening the type) is future work.

No persistence artifact changed: the workspace database, repository-root
legacy database, 16-artifact observation set, both preserved brand-asset
hashes, and the project's `config.json`/credential-reference sidecar were
byte-identical before and after. No secret value was read or written at any
point.

### TD-UI-069C-C-R — runner-compatibility truth unification

The "residual inconsistency" flagged above was resolved, and review found a
second, more serious instance of the same problem: `ExecutionPreflightPresenter.ts`
(TD-UI-069A-C, already shipped) independently read `definition.runnerCompatibility.state
=== 'blocked'` as its own compatibility gate and declared its own
`SUPPORTED_STEP_KINDS`/`SUPPORTED_ORACLE_KINDS` constants — a third,
undiscovered compatibility evaluator, live in the certified Run preflight
surface, silently trusting a field that could (once `runnerCompatibility`
became genuinely truthful) diverge from `ExecutionProjectionService`'s live
verdict.

**New: `src/core/execution/DefinitionCompatibilityEvaluator.ts`** — the
single shared owner of intrinsic definition-compatibility truth
(`evaluateIntrinsicCompatibility`), deliberately standalone (no imports from
`test-design/` or elsewhere in `execution/`, to keep the cross-directory
dependency one-directional and cycle-free). `SUPPORTED_STEP_KINDS`,
`SUPPORTED_ORACLE_KINDS`, `SUPPORTED_AUTH_MECHANISMS`, and
`ProjectionFailureCode` now live here as the canonical definitions;
`ExecutionProjectionService.ts` imports and re-exports rather than
redeclaring them.

**`CanonicalTestDefinition.runnerCompatibility`** is widened from the
literal `{ state: 'blocked'; explanation }` to
`{ state: 'compatible'; explanation } | { state: 'blocked'; reason?: ProjectionFailureCode; explanation }`.
`reason` is optional specifically for backward compatibility: revisions 1
and 2 persisted the field with no `reason` at all, before the concept
existed, and remain byte-preserved and readable exactly as persisted under
the widened (lenient-on-`reason`) validator. New generations always include
`reason` when blocked. The generator now stamps this field by calling
`evaluateIntrinsicCompatibility` directly — the exact same function
`ExecutionProjectionService` re-verifies with live — never independently
inferring it.

**`ExecutionPreflightController.ts`** no longer maps `d.runnerCompatibility`
straight from the test-definitions API response. It calls a new
`ExecutionContext.evaluateDefinitionCompatibility()` bridge (the sanctioned
dynamic-import engine edge, mirroring `readTestInventory`, but not routed
through the serial queue since the evaluator is pure and DB-free) to get a
LIVE verdict from the same shared evaluator, and only that live verdict
feeds `ExecutionPreflightPresenter`. The presenter's own decision logic
needed no change — it already only branches on `state === 'blocked'`, so
widening the type to admit `'compatible'` was sufficient. Its now-redundant
local `SUPPORTED_STEP_KINDS`/`SUPPORTED_ORACLE_KINDS` constants and the dead
`'unsupported'`-producing branch were removed — TypeScript itself proved the
branch unreachable once the duplicate check was deleted.

**Sauce Demo result:** verified directly — a deterministic reproduction
using the real project's actual authority (form-login, the recorded
`SAUCEDEMO_USERNAME`/`PASSWORD` reference, `authenticationOutcome:
"succeeded"` on the certified source observation) now stamps
`runnerCompatibility.state: 'compatible'` at generation time, and
`ExecutionProjectionService`'s live re-verification against the same
authority agrees (`kind: 'ok'`). All four real Sauce Demo definitions share
one `sourceObservation`, so this single-subject proof extends uniformly —
the intrinsic evaluation inputs (auth setup, step kind, oracle kind) are
identical across all four.

**Cleanup performed:** the presenter's dead duplicate step/oracle-support
check (above); `TestCasesPage.tsx`'s three hardcoded `"Blocked"`/`"Runner
blocked"` UI strings, which never read `definition.runnerCompatibility` at
all, replaced with a shared `runnerCompatibilityLabel()` helper reading the
real field; the client-side `EvidenceBackedTestDefinition` type in
`api/types.ts` widened to match, with `authenticationRequired`/
`authenticationSetup` also mirrored (previously absent from the client type
entirely).

15 new focused tests passed, covering: the generator/evaluator agreement
(executable proof, not asserted), a genuinely compatible real-shaped
definition, all five required blocked-reason codes, runner-availability
independence, two backward-compatibility cases (a hand-built legacy payload
and a disk-shaped revision-1 payload, both parsed under the widened
validator without modification), and three static-source-scan tests proving
no duplicate evaluator remains in the three previously-independent files.
Combined with the touched regression suites: 89/89 pass (TD-UI-068A 12/12
with one assertion corrected from `'blocked'` to the now-truthful
`'compatible'`; TD-UI-069C-B 17/17; TD-UI-069C-C 19/19; TD-UI-069C-C-R 15/15;
TD-UI-069A-C 12/12; TD-UI-067A 14/14). Header verifier (462/462), both
TypeScript checks, the production build, and `git diff --check` all passed
clean. No persistence artifact changed — the workspace database, repo-root
legacy database, 16-artifact observation set, both brand-asset hashes, and
the project's config/credential-reference sidecar were byte-identical
before and after.
