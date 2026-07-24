# FORGE Validation Baseline

The validation baseline is a thin orchestrator over existing FORGE checks. It
does not replace their logic, repair failures, apply migrations, generate tests,
or invoke the adaptive execution pipeline.

Its purpose is to answer one bounded question honestly:

> What evidence passed, failed, could not run, or was outside this validation
> profile for this exact repository and database state?

## Profiles

| Profile | Blocking automated evidence |
|---|---|
| `offline` | Root/eval TypeScript, all unit tests, forge-ui TypeScript, read-only SQLite integrity |
| `product` | Everything in `offline`, plus the SauceDemo primary-reference smoke |
| `full` | Everything in `product`, plus the release-only forge-ui production build and commit-matched human attestation |

The forge-ui production build is deliberately release-only. It does not run in
the routine `offline` or `product` profiles.

## Status vocabulary

- `PASS` — the gate ran and its evidence supports success.
- `FAIL` — the gate ran and demonstrated a defect.
- `BLOCKED` — the gate could not obtain the required evidence, for example
  because credentials, the external application, or a readable database were
  unavailable.
- `NOT_RUN` — the gate was not executed. An optional out-of-profile gate does
  not weaken the profile; a required `NOT_RUN` makes the aggregate `BLOCKED`.

Aggregation follows ADR-018: required `FAIL` dominates `BLOCKED`, which dominates
`PASS`. A known failure is never converted into a pass.

## Baseline debt and new regressions

Failure classification is evidence-based rather than a permanent allowlist:

1. `--establish-baseline` labels each observed `FAIL` as `BASELINE_DEBT` and
   persists its deterministic fingerprint. The overall result remains `FAIL`.
2. A later run with `--baseline <report>` labels a failure `BASELINE_DEBT` only
   when the same gate has the exact same failure fingerprint.
3. A new failure, or changed evidence on an existing failed gate, is
   `NEW_REGRESSION`.
4. Recovered, blocked, and not-run gates carry `NONE`; they are not falsely
   described as either debt or regression.

This means worsening an already-red storage gate cannot hide under its old debt
label.

## Primary reference application

SauceDemo is the primary UI reference. The product smoke invokes Playwright
directly, not `src/run.ts`, and selects exactly:

- `Standard user login`
- `Invalid credentials`
- `TC033 - Complete user journey: Login → Browse → Cart → Checkout → Complete`

The selector uses explicit source paths, Chromium, one worker, zero retries, and
the line reporter. Overriding the repository reporter prevents the streaming
reporter from writing product-smoke results into a FORGE database. `USER_STANDARD`
and `PASSWORD` must be present. Missing credentials or an unreachable SauceDemo
preflight is `BLOCKED`, not `PASS` or product failure.

## Storage integrity

The live SQLite database is opened with `readonly=true` and `fileMustExist=true`.
The baseline does not use the Kysely singleton, enable WAL, or invoke migrations.
It checks:

- database availability and SQLite `quick_check`
- foreign-key integrity
- migration-history readability and Migration 016 status
- the Migration 016 unique partial index
- duplicate active rows using exact, case-sensitive `app_name`
- parsing and current-schema validity of active and historical `model_json`
- before/after table row counts and database-file SHA-256

Storage mutation behavior is tested only against disposable databases created by
`scripts/verify-forge-validation-baseline.test.ts`.

## Deterministic report

The machine report uses schema `forge-validation-baseline/v1`. Object keys are
canonicalized, arrays retain their declared order, and volatile timestamps and
durations are excluded. Given the same observed gate evidence, serialization is
byte-identical.

Raw command output remains in the terminal. The persisted report records the
command, working directory, exit code, gate evidence, remedy, and failure
fingerprint. Credentials are represented only by presence/absence and are never
written to the report.

## Commands

```powershell
# Routine local baseline
npm run validate:baseline -- --profile offline --db .forge/forge.db

# Establish the first explicit debt snapshot (still exits non-zero if failures exist)
npm run validate:baseline -- --profile offline --db .forge/forge.db `
  --establish-baseline --report reports/validation/offline-baseline.json

# Compare a later run with that snapshot
npm run validate:baseline -- --profile offline --db .forge/forge.db `
  --baseline reports/validation/offline-baseline.json

# Live primary-reference validation
npm run validate:baseline -- --profile product --db .forge/forge.db

# Release-equivalent validation, including human attestation
npm run validate:baseline -- --profile full --db .forge/forge.db `
  --human-attestation C:\path\to\human-attestation.json
```

Default reports are written beneath `reports/validation/`. Exit codes are `0`
for `PASS`, `1` for `FAIL`, and `2` for `BLOCKED` or a command-level inability to
produce a report.

## Boundaries

- Validation never repairs or normalizes evidence.
- The live database is never opened write-capable.
- Duplicate active App Models are reported, never selected, merged, superseded,
  or deleted.
- A failed external product assertion is a `FAIL`; lack of prerequisites is a
  distinct `BLOCKED` result.
- The report is the persisted system of record. Console output is supporting
  evidence, not the only home for a result.
- Human evidence is governed by
  `docs/project/FORGE_HUMAN_VALIDATION_CHECKLIST.md` and must match the exact Git
  commit under validation.
