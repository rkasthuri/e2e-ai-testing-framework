# M2 Suite Certification Package

This package is an independent semantic and black-box contract for the frozen
M2 sanity-Suite outcome. It imports no Core implementation types or hashing
helpers and does not modify Product or UI code.

## Authority boundary

`M2CertificationDriver` is the only future Product binding point. It exposes
observable Suite operations: candidate listing, Suite create/read/revise,
preflight, Start, Execution, and Results reads. A real adapter must declare
`authorityClass: 'product'`; `ReferenceM2Driver` declares
`authorityClass: 'reference'` and can prove only fixture/oracle mechanics.

The reference driver can never issue Product PASS. A Product adapter must drive
real Product boundaries, use the current canonical Test Set, and return observed
Product Suite, Execution, and Results authority. It must not calculate missing
Product authority inside the adapter or translate Product member ordinals;
Core `1..N` output must pass through directly.

## Frozen authority rules

- Suite schemaVersion is `1`; purpose is exactly `sanity`.
- Each member contains only its ordinal and exact Definition authority. Ordinals
  are contiguous positive integers exactly `1..N` in semantic member order.
- Every member shares one exact Test Set ID, revision, Definition schema, and
  content hash.
- Definition schema v1, missing Definitions, mixed authority, ordinal `0`,
  ordinal gaps (for example `[1, 3]`), duplicate ordinals, duplicate members,
  empty Suites, and Suites over 50 members refuse.
- Saved revisions are immutable. Reorder and rename append revisions; historical
  revisions do not change.
- Historical Test Set execution is forbidden. A Suite remains readable after
  authority advances, but preflight and Start refuse `stale_suite_authority`.
- `stale_suite_authority` is evaluated only after the exact Suite revision is
  available and integrity-valid with known pinned Test Set authority.
- A malformed, corrupt, hash-inconsistent, internally inconsistent, or otherwise
  untrustworthy Suite revision refuses `suite_integrity_invalid`; it can never be
  relabelled as stale authority.
- Start selects `{ kind: "suite_revision", suiteId, suiteRevision }`; no member,
  Definition, or Test Set payload enters Start from the client.
- Execution and Results bind the accepted immutable Suite revision, its hash,
  opaque provenance, singular Test Set authority, and ordered manifest.
- `test_results.suite` is legacy data and cannot satisfy canonical Suite
  authority.

`provenance` is intentionally treated as opaque JSON because the frozen brief
does not define its internal shape. Certification checks exact preservation and
binding without inventing fields. The only exact Suite refusal codes asserted
are the frozen `stale_suite_authority` and `suite_integrity_invalid` values;
other hostile cases require refusal without inventing new M2 refusal names.

## Opaque Product hash authority

Certification does not define Product Suite serialization or derive an expected
`contentHash` from Suite fields. It observes the Product-provided opaque hash and
checks only the frozen guarantees: Sha256Hex shape, stability for the same
immutable revision, change across semantic revisions, and exact preservation in
read, preflight, Execution, and Results.

The reference harness mints deterministic Sha256Hex-shaped tokens for mechanics
only. Those tokens are not derived from Suite content and are not an algorithm a
Product adapter must reproduce. Reference request fingerprints likewise serve
only reference idempotency mechanics and are not Product Suite authority.

Every remaining serialization or hash-related use is classified as follows:

- `referenceOnlyRequestFingerprint`: **REFERENCE-ONLY** request replay mechanics;
  its JSON serialization and SHA-256 call are private to `ReferenceM2Driver`.
- `referenceOnlyOpaqueSha256`: **REFERENCE-ONLY** deterministic token minting;
  it hashes a reference label, never Suite fields, and is not exported.
- `cloneValue` and fixture-loader JSON parsing/diagnostics: serialization for
  copying, loading, or error text only; none produces or validates Suite hash
  authority.
- the stale-case JSON comparison: exact historical-observation comparison only;
  it does not calculate or validate `contentHash`.
- the certification oracle: shape checks plus equality/inequality relationships
  among Product-observed hashes only. It imports and calls no reference helper.

No Product oracle computes expected hash bytes or compares Product output with a
reference-generated token.

## UI acceptance semantics

`cases/ui-contract.json` freezes saved-list, create/reopen, visible identity,
ordered membership, stale-read/non-run, stale-edit, whole-Suite eligibility,
Start-payload, and immutable Results provenance requirements. No React or
`forge-ui` implementation is imported.

## Focused validation

```text
npx tsx --test scripts/verify-m2-certification-contract.test.ts scripts/verify-m2-certification-self-falsification.test.ts
npx tsc -p scripts/m2-certification/tsconfig.json
npm run check
git diff --check
```

The Product driver is implemented in `scripts/m2-certification/product-driver.ts`.
Product certification requires that driver to pass with
`authorityClass: 'product'`; mechanics-only results do not establish Product
certification.
