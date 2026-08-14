<!-- FORGE - Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-026: Independent Architecture Review Governance

## Status

Accepted

## Date

2026-08-11

## Context

FORGE's first whole-system independent architecture review deliberately tested
previous decisions against current repository evidence instead of treating
prior certification or architectural intent as proof. The review found both
strong subsystems and material drift that slice-level certification had not
been designed to detect.

Design-fork review remains necessary, but it answers a narrower question: it
challenges a proposed decision before implementation. FORGE also needs a
repeatable, milestone-triggered review of the assembled system. Without a
separate governance contract, later reviews can inherit the conclusions,
scores, framing, or loyalties of earlier work and become confirmation
exercises.

## Decision

FORGE establishes Independent Architecture Review as a governed architecture
checkpoint with this principle:

> An independent architecture review evaluates FORGE as though an unaffiliated
> Principal Engineer inherited the repository today. No prior decision is
> entitled to deference; every claim about the current system must be earned
> again from current evidence.

Independence is a review posture and an authority separation, not merely a
different person or model name. A reviewer must disclose material involvement
in the architecture under review and must not approve, implement, or silently
repair findings during the review.

### Evidence precedence

For claims about what FORGE currently does, current executable repository
evidence outranks historical design intent. The reviewer establishes current
truth from code, tests, migrations, configuration, CI workflows, persistence,
repository state, and directly observed behavior before relying on narrative
claims.

If current evidence conflicts with an ADR, the evidence governs the factual
description of implemented behavior. The ADR continues to govern intended
policy until it is explicitly clarified, superseded, or retired. The conflict
must be reported as implementation drift; unauthorized behavior does not
become approved architecture merely because it exists. Historical rationale is
preserved through dated notes or a superseding record, never rewritten to make
the past appear consistent with the present.

### Falsification posture

Every review starts with these assumptions:

- the previous review may be wrong;
- a previous ADR may have drifted or may no longer describe the best system;
- certification proves only the approved scope and evidence of that slice;
- previous conclusions and scores are hypotheses, not protected truths; and
- a passing baseline does not prove cross-subsystem architectural coherence.

The reviewer must actively seek counterexamples, competing authorities,
failure paths, restart inconsistencies, semantic drift, and evidence that would
disprove the architecture's strongest claims.

### Review personas

Every whole-system review covers these lenses. One reviewer may perform
multiple declared passes, or the Owner may appoint multiple reviewers.

| Persona | Primary concern |
|---|---|
| Principal Architect | Authority, domain boundaries, layering, coupling, ADR health, and long-term coherence |
| Principal Scalability Engineer | Concurrency, contention, data volume, multi-process behavior, distribution, and first scale failure |
| Principal Security Engineer | Trust boundaries, credentials, tenants, secrets, sensitive artifacts, input surfaces, and disclosure paths |
| Principal Reliability Engineer | Transactions, failure honesty, recovery, idempotency, restart behavior, liveness, and operational evidence |
| Principal Product Engineer | User value, workflow coherence, operability, complexity cost, and whether abstractions serve real product needs |

Persona coverage must be explicit in the artifact. Missing expertise is an
unknown to report, not a reason to invent assurance.

### Milestone-triggered frequency

Reviews are not calendar ceremonies. A review is required when an architectural
milestone materially changes the system's authority, trust, or operating model,
and before the next gated expansion relies on that model.

Required trigger points include:

- completion or material redesign of a major execution subsystem;
- expansion of AI triage, healing, or autonomous behavior;
- a public Results/reporting authority or cross-authority federation;
- cloud, distributed-runner, multi-process, or multi-tenant architecture;
- a plugin or public extension architecture;
- Product v1 readiness declaration;
- General Availability declaration; and
- any Owner-designated milestone whose integrated risk exceeds a design-fork
  review.

A prior review may satisfy a later trigger only when scope and repository
evidence are unchanged and the artifact explicitly proves that equivalence.

### Required deliverables

Every review artifact contains:

1. executive verdict and scope;
2. evidence baseline and declared unknowns;
3. architecture scorecard with rationale;
4. current architecture and authority map;
5. ownership matrix;
6. domain and vocabulary assessment;
7. layering and dependency assessment;
8. repository, persistence, and migration assessment;
9. ADR health matrix;
10. transaction, failure, recovery, and security assessment;
11. legacy and compatibility-path assessment;
12. technical-debt register;
13. scalability and certification-method assessment;
14. meaningful strengths, risks, and recommendations;
15. a section titled exactly `What surprised the reviewer?`;
16. sequenced remediation or accepted-debt roadmap;
17. `GO`, `CONDITIONAL GO`, or `NO-GO`; and
18. a trend comparison against the latest comparable review.

The artifact must distinguish current authority, legacy authority,
compatibility paths, and dead or obsolete paths. Findings must cite
repository evidence or be marked as hypotheses requiring verification.

The surprise section exists to expose blind spots that a standard scorecard
may not reveal. It records evidence that materially contradicted the
reviewer's expectations, including unexpectedly strong architecture as well as
unexpected risk. If the reviewer found nothing surprising, the section must
say so explicitly; it may never be omitted or silently left empty.

### Scorecard

The standard scorecard covers:

- ownership clarity;
- domain coherence;
- layering;
- persistence integrity;
- failure honesty;
- recovery design;
- security boundary;
- test and certification architecture;
- scalability;
- maintainability;
- extensibility; and
- technical-debt health.

Each category is scored from 0 to 10 using the shared anchors in the scorecard
template. Every score below 9 requires an evidence-backed explanation. The
overall score is the unweighted arithmetic mean unless a different weighting
is approved and recorded before evidence collection. A critical finding can
require `NO-GO` regardless of the average; the score never replaces judgment.

### Verdict semantics

- `GO`: no unaccepted material issue blocks the stated next milestone.
- `CONDITIONAL GO`: only named corrective work may proceed until explicit
  conditions are met.
- `NO-GO`: the current architecture cannot safely support the stated milestone;
  remediation and a follow-up review are required first.

The verdict is scoped. It must name what may proceed and what remains gated.

### Immutable versioned artifacts

Accepted reviews are stored under `docs/architecture/reviews/` using:

`FORGE_ARCHITECTURE_REVIEW_v<major>.<minor>.md`

A major version represents a new whole-system or materially expanded-scope
review. A minor version represents a separately executed follow-up with a
substantially comparable scope. Past review files are never rewritten. A
factual correction is recorded in a dated erratum or a new review version;
scores, findings, and verdicts in the original remain intact.

Trend comparison occurs only after the new review's findings and scores have
been formed. This prevents prior scores from anchoring the evidence pass. Scope
changes and non-comparable metrics must be called out explicitly rather than
forced into a favorable trend.

### Review discipline

Independent reviews must not:

- protect previous decisions, reviewers, implementers, or certifications;
- optimize the language or score for praise;
- hide debt to preserve a roadmap or milestone date;
- inflate scores because a subsystem was previously certified;
- rewrite an earlier review after later evidence appears;
- treat the absence of discovered problems as proof of correctness;
- implement fixes or change persistence while in read-only review mode; or
- let the architecture author edit the reviewer's findings into agreement.

The design authority and Owner may publish a separate disposition that accepts,
rejects, reprioritizes, or requests more evidence for findings. That response
does not alter the independent artifact.

## Success criterion

The strongest review is not one that reports no issues. It is one that can say:

> We actively attempted to disprove the architecture. The surviving tradeoffs
> are explicit, evidence-backed, understood, and accepted by the accountable
> authority.

## Alternatives

- **Calendar-driven annual or quarterly review:** rejected because review value
  follows architectural change, not elapsed time.
- **Reuse design-fork reviews only:** rejected because local decisions do not
  test the coherence of the assembled system.
- **Let the architecture author perform and approve the review:** rejected
  because it collapses independence and disposition into one authority.
- **Make scores the release gate:** rejected because averages can conceal a
  single critical authority, security, or failure-honesty defect.
- **Rewrite prior reports when facts change:** rejected because it destroys the
  historical trend and conceals what reviewers knew at the time.

## Tradeoffs

- Reviews consume focused engineering time at major milestones.
- A falsification posture can delay expansion when integrated risk was not
  visible in slice-level certification.
- Stable metrics improve trend visibility but cannot remove reviewer judgment.
- Keeping artifacts immutable requires explicit errata and disposition records.

These costs are accepted because architecture review exists to improve the
system, not validate its authors.

## Consequences

- Independent Architecture Review becomes a required checkpoint before the
  trigger points in this ADR.
- The Owner retains the final decision and accepts or rejects remediation.
- The reviewer owns assessment and recommendation only.
- Findings do not authorize implementation; they become separately approved
  TDs or accepted debt.
- Design-fork review continues unchanged and complements, rather than replaces,
  milestone review.
- Future reviews compare trends without editing historical artifacts.

## Related

- `docs/governance/INDEPENDENT_ARCHITECTURE_REVIEW_PROCESS.md`
- `docs/templates/ARCHITECTURE_REVIEW.md`
- `docs/templates/ARCHITECTURE_SCORECARD.md`
- `docs/templates/ARCHITECTURE_REVIEW_TREND.md`
- `docs/prompts/architecture-review.md`
- `docs/governance/AI_WORKFLOW.md`
- `docs/architecture/reviews/README.md`
- `docs/architecture/reviews/FORGE_ARCHITECTURE_REVIEW_v1.0.md`
- `docs/architecture/reviews/FORGE_ARCHITECTURE_REVIEW_v2.0.md`
- `docs/architecture/reviews/FORGE_ARCHITECTURE_REVIEW_TREND.md`
- `docs/architecture/reviews/FORGE_ARCHITECTURE_SCORECARD.md`
- `docs/ADR/ADR-006_Truth-Telling and Earned Evidence.md`
- `docs/ADR/ADR-011_Verify_Before_Assert.md`
- `docs/ADR/ADR-015_Provenance_Follows_Evidence.md`
- `docs/ADR/ADR-018_Aggregate_to_the_Weakest_Truth.md`

## Implementation Note - 2026-08-14

TD-CONFIG-002 published the accepted v1.0 and v2.0 whole-system conclusions in
the governed review directory. Their original chat bodies were unavailable, so
both immutable files identify themselves as reconstructed from accepted review
records and do not claim verbatim provenance. The accepted overall scores and
verdicts are preserved; reconstructed category values are labelled as such.
The review index, trend, and scorecard register make this limitation
repository-local and discoverable.
