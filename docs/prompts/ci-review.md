# CI Review Prompt

---

Document Authority:
E — Reference

Owner:
CI Owner

Source of Truth:
`.github/workflows/e2e-pipeline.yml`, CI decision code, and the exact workflow
run under review

Refresh Trigger:
CI jobs, gates, evidence schema, run identity, or reporting-decision behavior
changes

Last Verified:
2026-07-30

---

Use this prompt after a workflow run completes. It is a review aid, not a CI
authority. Verify every answer against the exact run, tested SHA, workflow YAML,
and current-run evidence.

## Run Identity

```text
Workflow:       [name / URL]
Run ID:         [run number / URL]
Commit SHA:     [exact tested SHA]
Triggered by:   [push / pull request / manual / scheduled]
CURRENT_RUN_ID: [value expected by the reporting decision]
Date:           [YYYY-MM-DD]
```

Confirm the tested SHA is the intended source state and that reporting evidence
belongs to the same `CURRENT_RUN_ID`. A successful old run cannot validate a new
commit.

## Job 1 — Test

| Gate | Result | Evidence / notes |
|---|---|---|
| Dependencies and migrations | [PASS / FAIL] | |
| `npm run test:unit` | [PASS / FAIL] | Record actual output count; do not use a fixed baseline |
| `npm run check` | [PASS / FAIL] | Root and eval TypeScript |
| Selected Playwright suite | [PASS / FAIL / DEFERRED] | Note `continue-on-error` and actual failures |
| Provenance sidecar | [PASS / FAIL] | Confirm run ID and Git SHA |
| Reports artifact | [PASS / FAIL] | |

## Job 2 — AI Pipeline

| Step | Result | Evidence / notes |
|---|---|---|
| AI triage | [PASS / FAIL] | |
| Results store | [PASS / FAIL] | |
| Adaptive-fix dry run | [PASS / FAIL] | |
| Trend analysis | [PASS / ALLOWED FAILURE] | Check current workflow policy |
| Release notes | [PASS / ALLOWED FAILURE] | Check current workflow policy |
| Notifications | [PASS / ALLOWED FAILURE] | No positive claim from a skipped/unavailable notification |
| Run-history writeback | [PASS / FAIL / NOT RUN] | Record whether a commit was created |
| Current-run evidence evaluation | [PASS / FAIL / BLOCKED] | Must match `CURRENT_RUN_ID` |
| Reporting completeness enforcement | [PASS / FAIL] | `PASS` or `FAIL` required; `BLOCKED` fails closed |
| PR comment | [POSTED / SKIPPED / FAILED] | Skipped on non-PR runs is expected |

## Evidence Decision

The CI evaluator has three states:

- `PASS`: complete, healthy, current-run evidence reports zero failures;
- `FAIL`: complete, healthy, current-run evidence reports one or more failures;
- `BLOCKED`: evidence is missing, stale, malformed, unhealthy, inconsistent,
  unreadable, or not tied to the current run.

Check specifically for:

- missing or empty `CURRENT_RUN_ID`;
- missing, unreadable, empty, or malformed triage report;
- report run ID different from the expected run ID;
- unhealthy input evidence;
- invalid counts, missing categories, or inconsistent result totals; and
- positive merge or success claims emitted for `BLOCKED` evidence.

## Overall Assessment

Do not equate a green GitHub workflow conclusion with a zero-failure result.
Record both independently:

```text
Workflow conclusion:        [SUCCESS / FAILURE / CANCELLED]
Reporting decision:         [PASS / FAIL / BLOCKED]
Blocking gates passed:      [YES / NO]
Current-run evidence valid: [YES / NO]
New regression:             [YES / NO / UNKNOWN]
Release-ready:              [YES / NO / REVIEW REQUIRED]
```

`BLOCKED` means the run cannot support a safe positive claim. `FAIL` is
evidence-complete but requires review under the current policy. A release-ready
`PASS` still requires the intended SHA, applicable local gates, and any focused
capability rehearsal required by the task.

## Action

```text
[ ] No action — evidence-complete PASS and required gates are clear
[ ] Review required — evidence-complete FAIL
[ ] Blocked — missing/stale/malformed/unhealthy evidence
[ ] New defect or regression to investigate
[ ] Technical debt or documentation drift to record
[ ] Push/merge authorization withheld
```

Record the exact evidence, not a copied count or summary. Consult
[`CI_PIPELINE.md`](../project/CI_PIPELINE.md), the workflow YAML, and root
[`TECH_DEBT.md`](../../TECH_DEBT.md) for current policy.
