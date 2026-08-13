# Independent Architecture Review Process

---

Document Authority:
B - Operational

Owner:
Architecture Authority

Source of Truth:
ADR-026 Independent Architecture Review Governance

Refresh Trigger:
ADR-026 changes or an accepted review exposes a process defect

Last Verified:
2026-08-11

---

This procedure operationalizes
[`ADR-026`](../ADR/ADR-026-independent-architecture-review-governance.md). It
does not replace design-fork review in `AI_WORKFLOW.md` or the narrower prompt
in [`docs/prompts/architecture-review.md`](../prompts/architecture-review.md).

## 1. Authorize the review

The Owner records:

- the milestone or risk that triggered the review;
- the repository scope and exclusions;
- the required personas;
- the intended next milestone being gated;
- the reviewer and any material conflicts of involvement;
- whether the review is whole-system or deliberately bounded; and
- the target artifact version.

Review scope cannot be narrowed after a serious finding appears merely to
improve the verdict. A genuine scope change is recorded in the artifact.

## 2. Establish independent review mode

The reviewer begins in read-only mode. No implementation, migration, cleanup,
repair, staging, commit, or push is authorized by the review.

Before inspecting prior review conclusions, the reviewer records the current
repository evidence baseline. If prior conclusions are already known, that
exposure is disclosed and the reviewer still performs a fresh falsification
pass.

The reviewer states:

- previous conclusions may be wrong;
- certification scope is not whole-system proof;
- current evidence may contradict accepted intent; and
- unknowns will remain unknown until evidence resolves them.

## 3. Build the evidence baseline

Inspect, as applicable:

- repository and dependency structure;
- runtime composition roots and process-global state;
- source, tests, migrations, configuration, and CI;
- live and disposable persistence using read-only methods;
- APIs, adapters, repositories, services, controllers, and presentation;
- ADRs, limitations, technical debt, and legacy compatibility paths;
- transaction, restart, failure, and recovery behavior;
- security and secret-bearing channels; and
- certification methodology itself.

For each material claim, retain a resolvable file, test, command, schema, or
observed-runtime reference. Documentation is evidence of intent; executable
behavior is evidence of current implementation.

The review must identify four path classes explicitly:

1. current authority;
2. legacy authority;
3. compatibility path; and
4. dead or obsolete path.

## 4. Perform persona falsification passes

Each required persona asks what evidence would disprove the current design.

### Principal Architect

- Where are there multiple writers or authorities?
- Which dependency crosses its intended layer?
- Which concepts or identities can be confused?
- Which ADRs are healthy, drifting, conflicting, or obsolete?

### Principal Scalability Engineer

- What fails first under more users, projects, results, or processes?
- Which locks, queues, registries, or singletons are process-local?
- Which reads become unbounded or N+1?
- Which low-cost choice is worth making now, without speculative redesign?

### Principal Security Engineer

- Where do trust, tenant, credential, and secret boundaries begin and end?
- What sensitive value can enter logs, errors, artifacts, URLs, or APIs?
- Which local-only assumptions would become unsafe when exposed remotely?

### Principal Reliability Engineer

- What is the atomic boundary for each critical transition?
- What survives failure and restart?
- Can retries duplicate truth or strengthen unsupported truth?
- Do normal execution and recovery derive identical truth from identical
  evidence?

### Principal Product Engineer

- Does each abstraction protect a real user or operational need?
- Which incomplete path creates misleading product behavior?
- Which complexity should be deleted or deferred?
- What must be corrected before the proposed Product milestone?

## 5. Freeze findings before trend comparison

Complete the current scorecard, findings, and provisional verdict before
opening the prior review's scores and recommendations. Preserve this ordering
in the review notes.

Then compare the new review with the latest comparable artifact. Classify prior
findings as:

- resolved;
- improved but open;
- unchanged;
- regressed;
- reclassified;
- accepted debt; or
- no longer applicable.

Also identify new findings and anything the prior review missed. A changed
scope or metric is `not comparable`, not an invented improvement.

## 6. Produce and challenge the artifact

Use:

- [`ARCHITECTURE_REVIEW.md`](../templates/ARCHITECTURE_REVIEW.md);
- [`ARCHITECTURE_SCORECARD.md`](../templates/ARCHITECTURE_SCORECARD.md); and
- [`ARCHITECTURE_REVIEW_TREND.md`](../templates/ARCHITECTURE_REVIEW_TREND.md).

Before issuing the artifact, the reviewer performs a final challenge:

- What is the strongest evidence against my verdict?
- Which score would I lower if the original architect were anonymous?
- Which uncertainty did I accidentally convert into reassurance?
- Did a passing test replace architectural analysis?
- Did I recommend speculative infrastructure before demonstrated need?

Every artifact must contain a section titled exactly:

`What surprised the reviewer?`

Use it to record evidence that contradicted the reviewer's initial model,
including unexpected strengths, risks, ownership crossings, failure behavior,
or blind spots in prior reviews. This section is formed before trend comparison
so the previous report cannot supply the surprise. If nothing surprising was
discovered, state that explicitly in the section. Never omit it or leave it
blank.

## 7. Issue a scoped verdict

The verdict states both what may proceed and what is gated:

- `GO` - the stated milestone has no unaccepted material blocker;
- `CONDITIONAL GO` - only named corrective work may proceed until the listed
  conditions are met; or
- `NO-GO` - the stated milestone cannot safely proceed.

Scores inform but never determine the verdict.

## 8. Persist without rewriting

After acceptance, store the artifact at:

`docs/architecture/reviews/FORGE_ARCHITECTURE_REVIEW_v<major>.<minor>.md`

Never edit an accepted review to change its findings, scores, or verdict. Use a
dated erratum for a factual transcription error or issue a new review version
for new evidence. The documentation index may add references without changing
the artifact.

## 9. Dispose findings through normal governance

The Owner and design authority publish or record a disposition separately.
Findings may become:

- approved corrective TDs;
- accepted debt with scope and expiry/trigger;
- requests for further evidence; or
- rejected recommendations with rationale.

The review itself does not authorize implementation. `CONDITIONAL GO` and
`NO-GO` remain in force for their stated milestone until the Owner accepts
evidence that the named conditions are satisfied.

## 10. Required checkpoints

An independent review is required before:

- major Product expansion that depends on a newly integrated authority;
- AI triage, healing, or autonomous-agent architecture expansion;
- cloud, distributed-runner, multi-process, or multi-tenant architecture;
- plugin or public extension architecture;
- Product v1 readiness declaration; and
- General Availability declaration.

An emergency exception requires an explicit Owner decision, documented scope,
risk acceptance, and a review before the next expansion checkpoint. Silence or
schedule pressure is not an exception.
