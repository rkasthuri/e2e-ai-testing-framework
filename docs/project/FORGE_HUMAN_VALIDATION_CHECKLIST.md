# FORGE Human Validation Checklist

Use this checklist only for the `full` validation profile. Perform it against the
exact commit in the automated report and against a disposable FORGE workspace and
database. Do not use the live project database for any action that can write.

Record `PASS`, `FAIL`, or `BLOCKED` for every item. A check that was not performed
is not a pass. Attach a screenshot, log, or other inspectable artifact for each
claim.

## Preconditions

- [ ] Record the Git commit and confirm it matches the automated report.
- [ ] Record the validator's name and validation environment.
- [ ] Confirm the workspace and database are disposable.
- [ ] Confirm SauceDemo credentials are available without recording their values.
- [ ] Confirm the canonical forge-ui surface is being used, not `src/platform`.

## Product walkthrough

- [ ] Launch FORGE through the supported forge-ui launcher and record readiness
      evidence.
- [ ] Start onboarding for the disposable reference project.
- [ ] Confirm detected values show their confidence, source, raw evidence, and
      reason; no result is presented as observed when it is inferred or unknown.
- [ ] Run the permitted crawl and confirm progress, pages, diagnostics, and
      remedies remain visible and attributable to the same run.
- [ ] Confirm the Tests surface shows the manifest and generated-file evidence for
      the selected project.
- [ ] Confirm the three SauceDemo primary-reference smoke cases are represented by
      the automated product report.

## Negative and honesty paths

- [ ] Exercise an invalid-credential path and confirm it is visibly rejected.
- [ ] Exercise an unavailable or unreachable target in the disposable project and
      confirm it is `BLOCKED`/could-not-verify rather than green.
- [ ] Confirm a zero-evidence or not-run state is not displayed as passing.
- [ ] Confirm every surfaced gap carries a specific remedy.
- [ ] Confirm errors remain visible after navigation or refresh where the product
      claims persistence.

## Storage isolation

- [ ] Record the live database hash or use the automated report's read-only proof.
- [ ] Confirm all walkthrough writes went only to the disposable workspace.
- [ ] Confirm no migration, repair, supersede, merge, or deletion was performed on
      the live database.

## Attestation

Create a JSON file outside the source tree using this exact contract:

```json
{
  "schemaVersion": "forge-human-validation/v1",
  "status": "PASS",
  "validator": "Full human name",
  "commit": "full-git-commit-hash",
  "completedChecks": [
    "preconditions",
    "product-walkthrough",
    "negative-and-honesty-paths",
    "storage-isolation"
  ],
  "evidence": [
    "absolute-or-reviewable-reference-to-evidence"
  ]
}
```

Allowed `status` values are `PASS`, `FAIL`, and `BLOCKED`. Use `PASS` only when
every checklist item passed. Use `FAIL` when observed evidence contradicts the
expected behavior. Use `BLOCKED` when the required observation could not be made.

The full profile validates the schema, requires a non-empty validator and evidence
arrays, and rejects an attestation whose `commit` differs from the repository
commit. It does not infer that a human performed work from file presence alone.
