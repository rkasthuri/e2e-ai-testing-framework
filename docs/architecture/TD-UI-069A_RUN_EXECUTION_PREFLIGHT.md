# TD-UI-069A Run Execution Preflight

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`forge-ui/server/registry/ExecutionPreflightPresenter.ts`,
`forge-ui/server/context/ExecutionPreflightController.ts`, and focused
TD-UI-069A-C contract tests

Refresh Trigger:
Execution preflight vocabulary, authority composition, deterministic
derivation, or presentation boundary changes

Last Verified:
2026-08-07

---

## Purpose and boundary

TD-UI-069A-C answers one bounded question at `/run?project=<project>`: given
the current, authoritative evidence-backed test-set revision, could FORGE
safely begin controlled execution of the selected definitions right now, and
exactly what prevents that.

Preflight is read-only and non-persistent. It creates no execution identity,
acquires no execution lock, and writes no `runs`/`test_results` row or any new
table. It does not execute a test, invoke a runner, or produce a pass/fail
result, coverage figure, health score, or completeness claim. Execution
identity and lifecycle persistence are deferred to a future, explicitly
accepted execution request — a separate, later slice.

## Authority composition

The controller composes two existing, unmodified authorities:

- the current evidence-backed test-set revision and its definitions, including
  each definition's authoritative `runnerCompatibility` state, from the
  TD-UI-068A test-definition inventory read; and
- the `design_evidence_backed_tests` decision from the TD-UI-067A Readiness
  projection, used to re-verify that the model/evidence provenance a
  definition was generated against still agrees with the current authorities.

A non-secret credential-reference availability check (ADR-013) — recorded vs.
default-derived reference, and whether its environment-variable pair currently
resolves — is computed the same way Crawl's context endpoint already computes
it. No credential value crosses this boundary.

Preflight consumes `runnerCompatibility` from the authoritative
`TestDefinitionContract`; it never promotes or re-derives compatibility. A
declared runner-adapter identity (`playwright-cli`) is checked for
availability independently of definition compatibility — `unavailable` today,
because no FORGE execution authority currently wires a runner adapter to
controlled test-definition execution (TD-UI-004 remains open).

## Decision vocabulary

```
malformed_request | integrity_failure | conflicting_provenance |
stale_or_unknown_inputs | incompatible_definition | runner_unavailable |
credentials_unavailable | unsupported | blocked | ready
```

States are evaluated in a fixed, worst-first precedence matching the order
above. `active_duplicate_execution` is deliberately excluded from this
read-only slice — duplicate-execution locking belongs to accepted execution
lifecycle, which is out of scope here.

Per-definition and aggregate states are independent facts: an aggregate is
`ready` only when every selected definition independently reaches `ready`.
One `blocked` or `unknown` definition prevents the aggregate from reaching
`ready`. The aggregate never collapses a more specific state into the generic
`blocked` — the four current Sauce Demo definitions read `incompatible_definition`,
not `blocked`, and the UI presents that precise reason alongside a generic
"Execution blocked" heading.

**An explicitly empty `definitionIds` selection is invalid input, not a
zero-definition evaluation (TD-UI-069A-C-R).** The controller rejects it with
a structured HTTP 400 (`PREFLIGHT_EMPTY_SELECTION`) before any authority read —
no test-definition or readiness lookup, no execution identity, no lock, no
persistence write. The presenter's own input validation independently rejects
it too, so no caller can reach a `ready` or `blocked` result for an empty
selection through either layer. It is never reinterpreted as "zero tests
passed" or "no failures."

## Deterministic policy

1. A structurally invalid request (non-canonical IDs, out-of-range revision,
   or an empty `definitionIds` array) fails to `malformed_request` — a
   structured HTTP 400 — before any authority read.
2. A requested revision that is not the current revision fails to
   `stale_or_unknown_inputs` — only the current test-set revision may be
   considered for execution; historical revisions remain visible but are not
   executable.
3. A requested definition identity absent from the current revision fails to
   `stale_or_unknown_inputs`.
4. A `blocked` `design_evidence_backed_tests` decision fails to
   `conflicting_provenance`; an `unknown` decision fails to
   `stale_or_unknown_inputs`.
5. Per definition, in order: `runnerCompatibility.state === 'blocked'` →
   `incompatible_definition`; an unsupported step/oracle kind → `unsupported`;
   runner adapter unavailable → `runner_unavailable`; missing credential
   availability → `credentials_unavailable`; otherwise `ready`.
6. The aggregate state is the worst (per the fixed precedence) among the
   selected definitions' states.

Credential availability never implies authentication will succeed. Runner
availability never implies a definition is compatible, and definition
compatibility never implies runner availability — both are independently
computed and independently presented.

## Safety and fail-closed behavior

Unknown projects return 404. A malformed request body returns 400. A
dependency (test-definition or readiness authority) that cannot be validated
safely returns a structured 422/503 rather than a plausible preflight
conclusion. The read model never contains credential values or reference
names, cookies or tokens, raw HTML or page content, raw runner payloads,
unrestricted error text, stack traces, filesystem or workspace paths, or
SQL/SQLite diagnostics.

## Presentation

`/run?project=<project>` presents: the current test-set revision identity,
each current-revision definition's individual preflight state and blockers
with links to its Observation/Model/Evidence/Tests provenance, an aggregate
preflight banner with an explicit "no execution occurred" statement, runner
adapter availability and credential-reference availability as two separate
facts, and a `Start execution` control that is always disabled while the
aggregate state is not `ready`, with no Force, retry, or bypass control. No
score, percentage, color-only state, coverage claim, health claim, or
completeness claim is introduced.

## Certification boundary

Focused tests must prove deterministic per-definition and aggregate states,
the empty-selection fail-closed behavior, stale/unknown-input handling,
conflicting-provenance detection via the readiness decision, malformed-input
rejection, and the absence of pass/fail/coverage/health/completeness claims
and forbidden content in the serialized projection. Live certification is
read-only and must compare relevant persisted hashes and counts before and
after API reads and page loads.

## Validation and certification record

On 2026-08-07, focused TD-UI-069A-C contract tests passed 12/12, covering
deterministic aggregation, the empty-selection and stale-input fail-closed
paths, conflicting-provenance detection, malformed-input rejection, and the
absence of forbidden content or fabricated claims. The affected TD-UI-067A
(14/14) and TD-UI-068A (12/12) regressions passed unchanged. The constitutional
source-header verifier (455/455), root/eval TypeScript check, forge-ui
TypeScript check, forge-ui production build, and `git diff --check` all passed
clean, and a forbidden-content scan of the diff found no credential, path, or
secret material.

Live Sauce Demo certification, persistence-preservation verification, and
browser/responsive/keyboard checkpoints are recorded in the TD-UI-069A-C NOVA
Relay delivered alongside this record.

### TD-UI-069A-C-R correction

On 2026-08-07, review found the original implementation evaluated an
explicitly empty `definitionIds` selection as a full authority-consulting
`blocked` result rather than rejecting it as invalid input, and presented the
aggregate heading as the raw state label rather than a stable "Execution
blocked"/"Execution ready" heading paired with the precise state as a
secondary reason. Both were corrected: the controller now rejects an empty
selection with a structured HTTP 400 (`PREFLIGHT_EMPTY_SELECTION`) before any
authority read, and the presenter's own validation independently rejects it
too; the Run UI now calls preflight only when at least one current-revision
definition exists, and presents "Execution blocked" with `incompatible_definition`
retained verbatim as the precise reason.

Updated focused tests passed 12/12; the affected TD-UI-067A (14/14) and
TD-UI-068A (12/12) regressions, the source-header verifier (455/455), root/UI
TypeScript checks, the production build, `git diff --check`, and a
forbidden-content scan of the diff all passed clean.

An isolated backend process on a non-conflicting port (owned by this task
only — the pre-existing processes on ports 3000 and 5173 were left untouched)
was stopped and restarted to verify both the correction and restart-durability
together: pre-restart, the empty-selection request still returned the old
200/`blocked` behavior (proving the running process had not picked up the fix
until restarted, as expected for a non-watch server); post-restart, the same
request returned HTTP 400/`PREFLIGHT_EMPTY_SELECTION`, and the real
four-definition request returned a data payload identical to its pre-restart
capture (only the response envelope's wall-clock timestamp differed). The
workspace database hash, the repository-root legacy database hash, the
16-artifact observation-file-set hash, both preserved brand-asset hashes, and
the `test_set_revisions`/`app_models`/`runs`/`test_results` row counts were
identical before and after the entire correction-and-restart cycle. No
execution occurred at any point.
