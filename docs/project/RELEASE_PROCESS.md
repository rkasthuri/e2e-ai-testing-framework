# RELEASE_PROCESS.md

---

Document Authority:
B — Operational

Owner:
Release Owner

Source of Truth:
`AGENTS.md`, `AI_WORKFLOW.md`, package scripts, Git state, and
`.github/workflows/e2e-pipeline.yml`

Refresh Trigger:
Authorization rules, validation gates, CI behavior, branch policy, or release
tooling changes

Last Verified:
2026-07-30

---

FORGE does not currently publish numbered packages or maintain a formal release
registry. A release is an approved change on `main` whose required validation
and evidence are complete. This document describes the current commit-and-push
discipline; future versioning is not current practice.

Read [START_HERE.md](../START_HERE.md) for authority routing and
[BUILD_AND_RUN.md](BUILD_AND_RUN.md) for commands. Governance and authorization
remain in [`AGENTS.md`](../../AGENTS.md) and
[`AI_WORKFLOW.md`](../governance/AI_WORKFLOW.md).

## Current Release Sequence

1. Define an approved, scoped task. Do not begin implementation from an
   unapproved idea or a stale snapshot.
2. Inspect repository state, relevant architecture, storage boundaries, and
   preservation-sensitive files.
3. Implement the approved change with surgical scope. Keep unrelated working
   tree changes separate.
4. Run focused tests and the applicable repository gates:

   ```text
   npm run check
   npm run test:unit
   cd forge-ui && npm run check       # when forge-ui is affected
   npm run validate:baseline -- --profile offline --db .forge/forge.db
   git diff --check
   ```

5. Review the actual diff. Confirm paths, assertions, ownership boundaries,
   generated artifacts, and preservation checks.
6. Obtain the required design/diff approval and explicit Rule 9 push
   authorization. An implementation agent must not self-authorize a push.
7. Stage only explicitly approved paths, verify the staged diff, and commit with
   a scoped message.
8. Push the authorized commit without rewriting history. Record the new SHA and
   inspect branch divergence.
9. Verify the CI run for that exact SHA when the workflow is triggered. Confirm
   blocking gates, current-run evidence, and the reporting decision.
10. Update the authoritative technical-debt ledger only when closure evidence and
    approval exist.

## What Release Evidence Means

CI workflow success alone is not a sufficient release claim. A release-ready
result requires:

- the intended commit SHA was tested;
- required unit and typecheck gates passed;
- current-run provenance matches `CURRENT_RUN_ID`;
- missing, stale, malformed, unhealthy, or unavailable evidence did not produce
  a positive claim;
- the reporting decision is `PASS` when the release requires a no-failure result;
- required local-only validation, including forge-ui typecheck, passed; and
- focused capability tests or explicit operator rehearsals passed when the task
  requires them.

The CI workflow may produce an evidence-complete `FAIL` without a workflow
failure under its current informational Playwright policy. Treat that as a
review result, not as a release-ready PASS.

## Commit and Push Discipline

- Batch changes by logical milestone.
- Never use `git add -A` for scoped work.
- Never reset, clean, discard, or overwrite unrelated work.
- Verify no SQLite, WAL/SHM, App Model JSON, or unrelated image changes are
  staged.
- Do not push documentation or code without the required explicit authorization.
- Do not force-push or rewrite existing history.

The workflow ignores Markdown-only changes for its push and pull-request
triggers. A documentation-only change therefore still requires diff review and
authorization, but it should not be described as having passed a new CI run
unless a workflow was actually executed.

## Current Non-Goals

FORGE does not currently have a package registry, semantic-version automation,
release artifact signing, deployment promotion, or rollback automation. Those
would require separately approved design and governance work.

## Rollback

If an authorized change must be reverted:

1. Prefer a new, reviewed revert commit on `main`.
2. Re-run the applicable validation and inspect CI for the revert SHA.
3. Use fix-forward when the defect is understood and the new change remains
   within approved scope.
4. Do not rewrite history or bypass diff review and push authorization.
