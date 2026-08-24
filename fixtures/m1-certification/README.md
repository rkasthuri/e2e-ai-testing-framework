# M1 Certification Package

This package is an independent semantic and black-box contract for the frozen M1
outcome. It does not import Product/Core implementation types, generate Product
behavior, or treat test-source text as canonical Product authority.

## Authority boundary

`M1CertificationDriver` is the only Product binding point. A future integration
adapter must drive observable Product boundaries and return their identities,
provenance, refusal, execution, run, result, and UI projections. The adapter must
declare `authorityClass: 'product'` before its observations are eligible for a
certification verdict.

The driver DTO is a certification normalization boundary, not a request for new
Product columns with matching names. Definition and Result fingerprints may be
calculated by the adapter from repeated black-box reads. ExecutablePlan's
`semanticHash`, by contrast, must be the existing Product authority and must not
be synthesized by the adapter.

`ReferenceHarnessDriver` exists only to prove fixture loading and oracle
mechanics. It declares `authorityClass: 'reference_harness'`, and the suite
always rejects it when Product authority is required.

## Frozen M1 success semantics

Every positive v3 case uses exactly this executable scope:

1. Authentication is established by governed setup.
2. `navigate_to_observed_route` opens `/cart.html`.
3. `click_observed_data_test` clicks the directly observed, single-cardinality
   `data-test="checkout"` control.
4. The final `subject_observable` oracle observes
   `/checkout-step-one.html`.

The final oracle is carried separately from the two ordered executable steps.
`fill`, `select`, `assert_text`, drag, and all other richer semantics are not M1
success requirements; an adapter that proposes them must refuse with
`unsupported_semantics`.

## Frozen version behavior

- The frozen observed flow normalizes into `NormalizedTestIntentV1` and produces
  a canonical Test Definition v3.
- An accepted intent snapshot and `intentId` are embedded in the immutable v3
  Definition revision; M1 creates no standalone intent authority record.
- Existing Test Definition v2 retains the legacy
  `navigate_to_observed_route` meaning and remains executable without a
  synthetic v3 intent stage.
- Test Definition v1 remains readable, quarantined, non-executable, and never
  silently upgrades.
- ExecutablePlan has no certification-invented revision or version authority;
  its existing semantic hash is the immutable authority observed by the driver.

## App-area and refusal behavior

The only accepted app-area source is persisted App Model
`PageDefinition.module`, produced by `ModuleClassifier`. The v3 intent,
Definition, plan, and UI projection carry the value and provenance unchanged.
Mixed areas refuse as `ambiguous_evidence`; a missing module refuses as
`app_area_unknown`.

The complete M1 refusal vocabulary is:

- `insufficient_evidence`
- `ambiguous_evidence`
- `unsupported_semantics`
- `app_area_unknown`

A refusal cannot produce Definition, plan, Execution, Run, or Result authority,
and its UI projection cannot enable Run.

## Running the focused package

From the repository root:

```text
npx tsx --test scripts/verify-m1-certification-contract.test.ts scripts/verify-m1-certification-self-falsification.test.ts
```

On the affected Windows host, run Node under the established task-owned writable
OS-temp profile workaround and remove that profile after the command.

The end-to-end binding fixture is `cases/end-to-end-case.json`. It is prepared
for a future Product adapter to drive the exact observed cart flow through
crawl/App Model evidence, normalization, v3 Definition generation, plan
projection, actual Execution, canonical Product Run, immutable Product Result,
and the backend-compatible UI review projection. No fill, selection, second
click, or text assertion is required by that binding.
