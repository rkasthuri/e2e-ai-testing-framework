# CI_PIPELINE.md

---

Document Authority:
B — Operational

Owner:
CI Owner

Source of Truth:
`.github/workflows/e2e-pipeline.yml`, CI validation scripts, and execution
evidence from the exact workflow run

Refresh Trigger:
Workflow triggers, jobs, gates, run identity, evidence validation, artifacts,
or reporting-decision behavior change

Last Verified:
2026-07-29

---

This document explains the current E2E AI Testing Pipeline. The executable
workflow remains the source of truth:
[`../../.github/workflows/e2e-pipeline.yml`](../../.github/workflows/e2e-pipeline.yml).

Do not infer CI behavior from old run summaries, job names, comments, or test
counts. Verify the workflow file and the run attached to the exact commit.

## 1. Triggers and Execution Model

The workflow is named **E2E AI Testing Pipeline**. It runs for:

- pushes to `main` and `develop`;
- pull requests targeting `main`;
- the nightly `06:00 UTC` schedule; and
- manual dispatch with `stable`, `full`, `flaky`, or `smoke` suite selection.

Markdown-only and `reports/**` changes are ignored for push and pull-request
triggers. A newer run for the same workflow and Git ref cancels an in-progress
older run.

The workflow has three jobs:

```text
test
  -> ai-pipeline (always evaluates after test)
       -> notify-on-failure (main only, when the workflow fails)
```

## 2. Job 1 — Test (Playwright suite)

The `test` job runs in the pinned Playwright container on `ubuntu-latest`.
Its current sequence is:

1. Check out the repository.
2. Establish one canonical run ID and export it as `CURRENT_RUN_ID`.
3. Set up Node.js and install dependencies with `npm ci`.
4. Apply database migrations to the job's ephemeral database.
5. Run `npm run test:unit`.
6. Run `npm run check` for root/core and eval TypeScript.
7. Select and run the requested Playwright suite.
8. Write `reports/provenance.json` with the canonical run ID and Git SHA.
9. Upload the Playwright report and the `reports/` handoff artifact.

The unit suite and root/eval typechecks are blocking steps. The Playwright step
currently uses `continue-on-error: true` so its evidence can reach the AI
pipeline for classification. That setting does not turn a failed test into a
pass; it defers interpretation to the current-run evidence decision.

The routine CI job does not run the forge-ui TypeScript check. Run it locally
when validating forge-ui work:

```bash
cd forge-ui && npm run check
```

The operator-only TD-184B recovery rehearsal is also not part of automated unit
discovery or this workflow.

## 3. Canonical Run Identity and Provenance

Job 1 creates `CURRENT_RUN_ID` once. It exposes the same value as a job output,
writes it into the provenance sidecar, and passes it to Job 2.

All CI reporting decisions must be tied to this identity. A report from a prior
run cannot establish the health of the current run, even if its contents appear
otherwise successful.

The provenance sidecar also records the tested Git SHA. When reporting CI status,
confirm both:

- the workflow run's tested SHA matches the intended commit; and
- the evidence run ID matches `CURRENT_RUN_ID`.

## 4. Job 2 — AI Pipeline

The `ai-pipeline` job runs on a bare `ubuntu-latest` runner and has
`if: always()`. The bare runner is intentional: AI network calls were not
reliable in the hardened Playwright container.

The job:

1. Checks out the repository, installs dependencies, and migrates its ephemeral
   database.
2. Downloads Job 1's `reports/` artifact.
3. Runs AI triage.
4. Stores results.
5. Generates adaptive-fix suggestions in dry-run mode.
6. Runs trend analysis, release-note generation, and notifications.
7. Attempts the existing run-history writeback behavior.
8. Uploads available triage, trend, suggested-fix, and release-note artifacts.
9. Evaluates the triage report against the expected `CURRENT_RUN_ID`.
10. Posts a report comment for pull-request runs.
11. Prints the test outcome and enforces reporting-evidence completeness.

AI triage, results storage, and adaptive-fix generation are ordinary blocking
steps. Trend analysis, release-note generation, and notifications currently
carry `continue-on-error: true`; consult the on-disk
[`TECH_DEBT.md`](../../TECH_DEBT.md) before changing or interpreting those
boundaries.

The bug-attribution summary remains informational. An `app-bug` classification
does not independently fail the workflow under the current policy.

## 5. Current-Run Evidence Enforcement

The CI decision evaluator reads the triage report with the expected current run
ID. It produces one of:

- `PASS` — complete, healthy, current-run evidence reports zero failures;
- `FAIL` — complete, healthy, current-run evidence reports one or more failures;
- `BLOCKED` — the required reporting evidence cannot support either conclusion.

The evaluator fails closed. `BLOCKED` includes:

- missing `CURRENT_RUN_ID`;
- a report without run provenance;
- a run ID that does not match the current run;
- missing, empty, unreadable, or malformed report data;
- unhealthy input evidence; and
- inconsistent or incomplete totals, categories, or result rows.

The evaluator exits non-zero for `BLOCKED`. A final workflow step independently
requires the exported decision to be exactly `PASS` or `FAIL`; missing or
unavailable decision output also fails the job. Therefore stale, malformed,
missing, or unavailable evidence cannot become a success claim.

## 6. Gates and Decision Boundaries

| Check | Location | Workflow-blocking behavior | Meaning |
|---|---|---|---|
| Dependency install and migrations | Both main jobs | Blocking | CI environment and schema must initialize |
| Automated unit suite | Job 1 | Blocking | Unit regressions stop the normal test sequence |
| Root/eval typechecks | Job 1 | Blocking | Type errors fail Job 1 |
| Playwright suite | Job 1 | Deferred by `continue-on-error` | Test evidence flows to triage |
| AI triage, result storage, adaptive-fix dry run | Job 2 | Blocking | Core reporting pipeline must execute |
| Current-run evidence evaluation | Job 2 | Blocking when `BLOCKED` | Evidence must be present, healthy, well-formed, and current |
| Reporting-evidence completeness | Job 2 | Blocking | Decision output must be `PASS` or `FAIL` |
| Bug attribution | Job 2 | Informational | Classification does not independently block |
| forge-ui typecheck | Local validation | Not in workflow | Required locally when applicable |

## 7. Interpreting GREEN Correctly

GitHub's workflow conclusion and FORGE's evidence decision are related but not
identical:

- **Workflow success** means all workflow-blocking steps completed.
- **Reporting `PASS`** means complete current-run evidence reports zero test
  failures.
- **Reporting `FAIL`** is a valid, evidence-complete conclusion, not missing
  evidence. Because Playwright failure attribution remains informational under
  current policy, verify the reporting decision instead of treating a green
  GitHub badge alone as proof that all tests passed.
- **Reporting `BLOCKED`** means merge safety cannot be established and the
  workflow fails closed.

For a stabilization or release claim, confirm:

1. The workflow completed for the intended Git SHA.
2. Blocking unit and typecheck gates passed.
3. The reporting decision is `PASS`, not merely available.
4. Current-run provenance and evidence checks passed.
5. Any required local-only gates, such as forge-ui typecheck, passed against the
   same source state.
6. Relevant capability-specific evals or rehearsals passed separately when
   required.

Historical test counts are not CI gates. Use actual run output and
commit-matched evidence; do not copy an old count forward.

## 8. Artifacts and Reporting

The workflow may upload:

- Playwright HTML reports;
- the reports handoff artifact;
- triage JSON and Markdown;
- trend dashboard output;
- suggested fixes; and
- release notes.

Artifact presence alone is not proof of success. Use the canonical run identity,
tested SHA, reporting decision, and job conclusions together.

## 9. Maintenance Rules

- Read the workflow before updating this guide.
- Keep executable commands and step order synchronized with the YAML.
- Do not weaken a blocking gate to make documentation claims pass.
- Preserve the distinction between workflow execution, evidence completeness,
  and test outcome.
- Verify open CI debt in root `TECH_DEBT.md`; do not maintain a competing TD
  status list here.
