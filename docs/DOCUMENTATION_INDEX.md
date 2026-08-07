# FORGE Documentation Index

---

Document Authority:
E — Reference

Owner:
Documentation Owner

Source of Truth:
Tracked repository documentation and root `AGENTS.md`

Refresh Trigger:
A document is added, moved, renamed, archived, or changes authority, ownership,
or purpose

Last Verified:
2026-07-29

---

This file is a pure documentation map. It does not define governance, required
reading order, architecture, operational behavior, or project status.

- Human and AI navigation begins at [`START_HERE.md`](START_HERE.md).
- Implementation agents must begin at [`../AGENTS.md`](../AGENTS.md).
- The authority classes and trust order are explained in `START_HERE.md`.
- Metadata for new or modernized documents is available at
  [`templates/DOCUMENT_AUTHORITY.md`](templates/DOCUMENT_AUTHORITY.md).

## Foundation and Governance

| Document | Purpose | Class | Owner | Refresh trigger | Source of truth |
|---|---|---|---|---|---|
| [`../README.md`](../README.md) | Public product overview and quick-start route | E — Reference | Product and Documentation Owners | Public positioning, capability summary, or primary reader route changes | Product vision and executable evidence for capability claims |
| [`../AGENTS.md`](../AGENTS.md) | Active repository instruction and authority router for implementation agents | A — Authoritative | Raj | Repository instruction or authority routing changes | Governance authorities linked from the file |
| [`START_HERE.md`](START_HERE.md) | Human and AI documentation entry point | E — Reference | Documentation Owner | Authority model or primary routes change | `AGENTS.md` and this index |
| [`governance/AI_CONSTITUTION.md`](governance/AI_CONSTITUTION.md) | Non-negotiable AI rules and role authority | A — Authoritative | Raj | Raj-approved governance change | The constitution itself |
| [`governance/AI_WORKFLOW.md`](governance/AI_WORKFLOW.md) | Collaboration, checkpoints, approvals, commits, and push authorization | A — Authoritative | Raj | Approved workflow or role change | The workflow itself |
| [`governance/AI_ONBOARDING_CHECKLIST.md`](governance/AI_ONBOARDING_CHECKLIST.md) | Universal onboarding sequence and attestations | A — Authoritative | Governance Owner | Required reading, checks, or attestations change | Documentation-governance decision and checklist |
| [`governance/CODEX_ONBOARDING.md`](governance/CODEX_ONBOARDING.md) | Codex-specific onboarding deltas | B — Operational | Codex Workflow Owner | Codex behavior or role-specific procedure changes | `AGENTS.md`, universal checklist, and current Codex behavior |
| [`governance/OPERATING_MANUAL.md`](governance/OPERATING_MANUAL.md) | Map of the working cycle, roles, and canonical rules | E — Reference | Governance Owner | Governed sources or role map change | Linked governance authorities |
| [`governance/TD-GOV-001_FIRST_PARTY_SOURCE_AUDIT.md`](governance/TD-GOV-001_FIRST_PARTY_SOURCE_AUDIT.md) | Dated first-party source-header and commentary audit, applicability rules, and exact correction manifest | B — Operational | Governance Owner | Constitutional header, applicable source types, exclusions, or commentary standard changes | `AI_CONSTITUTION.md` Section 3.9, Git source inventory, and focused policy verifier |
| [`governance/DECISION_LOG.md`](governance/DECISION_LOG.md) | Chronological map of accepted decisions and ADRs | E — Reference | Architecture Authority | A decision is accepted, superseded, or retired | Individual ADRs and approved decision records |

## Architecture and Decisions

| Document | Purpose | Class | Owner | Refresh trigger | Source of truth |
|---|---|---|---|---|---|
| [`ADR/`](ADR/) | Decision rationale, constraints, and decision-time history | A — Authoritative | Architecture Authority | A decision is added, superseded, or receives an implementation note | Accepted ADRs |
| [`architecture/ARCHITECTURAL_PRINCIPLES.md`](architecture/ARCHITECTURAL_PRINCIPLES.md) | Durable engineering principles | A — Authoritative | Architecture Authority | A governing principle changes | ADRs and approved architecture decisions |
| [`architecture/ARCHITECTURE_NORTH_STAR.md`](architecture/ARCHITECTURE_NORTH_STAR.md) | Architectural direction and system spine | A — Authoritative | Architecture Authority | Approved architectural direction changes | ADRs and approved architecture decisions |
| [`architecture/ARCHITECTURE_TARGET_EVIDENCE_LAYER.md`](architecture/ARCHITECTURE_TARGET_EVIDENCE_LAYER.md) | Target evidence-layer design | A — Authoritative | Architecture Authority | Target design or implementation status changes | Approved design decisions; code/tests for shipped state |
| [`architecture/OBSERVATION_MODEL.md`](architecture/OBSERVATION_MODEL.md) | Observation semantics and ownership boundaries | A — Authoritative | Architecture Authority | Observation contract changes | ADRs, approved design, schemas, and contract tests |
| [`architecture/TD-UI-062B_DOMAIN_CONTRACT.md`](architecture/TD-UI-062B_DOMAIN_CONTRACT.md) | Project lifecycle, evidence, explainable state, and Truth Confidence contract | A — Authoritative | Architecture Authority | Lifecycle, evidence, confidence, or project-identity policy changes | `src/core/domain/tdUi062b.ts` and its contract tests |
| [`architecture/TD-UI-064A_CRAWL_OBSERVATION_VERTICAL_SLICE.md`](architecture/TD-UI-064A_CRAWL_OBSERVATION_VERTICAL_SLICE.md) | Crawl-to-persisted-observation request, truth, and provenance contract | A — Authoritative | Architecture Authority | Crawl request, observation persistence, credential-status, progress, or result contracts change | Crawl API, observation store, Crawl UI, and focused tests |
| [`architecture/TD-UI-067A_APPLICATION_READINESS.md`](architecture/TD-UI-067A_APPLICATION_READINESS.md) | Decision-specific, evidence-backed Application Readiness projection | A — Authoritative | Architecture Authority | Readiness vocabulary, authority inputs, derivation, safe actions, or presentation boundary changes | Readiness presenter/controller and focused contract tests |
| [`architecture/TD-UI-068A_EVIDENCE_BACKED_TESTS.md`](architecture/TD-UI-068A_EVIDENCE_BACKED_TESTS.md) | Immutable, provenance-bound evidence-backed test design and Tests UI contract | A — Authoritative | Test Architecture Owner | Test-definition schema, generation policy, provenance, persistence, status, or presentation behavior changes | Test-definition contract, repository/service, selected-project Tests API, and focused tests |
| [`architecture/CODEBASE_MAP.md`](architecture/CODEBASE_MAP.md) | Module, dependency, and implementation ownership map | E — Reference | Engineering Documentation Owner | Modules, ownership, entry points, or dependencies change | Current source tree, imports, scripts, and tests |
| [`architecture/REPOSITORY_STRUCTURE.md`](architecture/REPOSITORY_STRUCTURE.md) | Directory-level repository map | E — Reference | Engineering Documentation Owner | Repository layout changes | Current tracked repository tree |
| [`architecture/TD-UI-064B_LIVE_APPLICATION_OBSERVATIONS.md`](architecture/TD-UI-064B_LIVE_APPLICATION_OBSERVATIONS.md) | Bounded immutable observation-history read and Application Observations contract | A - Authoritative | Architecture Authority | Observation-history validation, ordering, safe projection, pagination, or presentation changes | Observation store history reader, crawl API, Observations adapter/UI, and focused tests |

## Operations and Validation

| Document | Purpose | Class | Owner | Refresh trigger | Source of truth |
|---|---|---|---|---|---|
| [`project/BUILD_AND_RUN.md`](project/BUILD_AND_RUN.md) | Setup, commands, launch paths, and troubleshooting | B — Operational | Engineering Operations | CLI, package scripts, prerequisites, ports, or launch behavior change | `package.json`, CLI implementation, server configuration, and observed behavior |
| [`project/CI_PIPELINE.md`](project/CI_PIPELINE.md) | CI jobs, gates, evidence handling, and workflow behavior | B — Operational | CI Owner | Workflow, gate, artifact, or decision handling changes | `.github/workflows/` and CI execution evidence |
| [`project/FORGE_VALIDATION_BASELINE.md`](project/FORGE_VALIDATION_BASELINE.md) | Validation profiles, status semantics, and automated preservation checks | B — Operational | Validation Owner | Validation profiles, gates, report schema, or storage checks change | Validation implementation, tests, and generated evidence |
| [`project/FORGE_HUMAN_VALIDATION_CHECKLIST.md`](project/FORGE_HUMAN_VALIDATION_CHECKLIST.md) | Commit-matched human validation procedure | B — Operational | Validation Owner | Human evidence contract or release gate changes | Validation contract and accepted evidence schema |
| [`project/TESTING_STRATEGY.md`](project/TESTING_STRATEGY.md) | Test-layer purpose, ownership, and execution strategy | A — Authoritative | Test Architecture Owner | Test ownership or validation strategy changes | Approved strategy; test config and suites for implementation |
| [`project/RELEASE_PROCESS.md`](project/RELEASE_PROCESS.md) | Release, versioning, and publication procedure | B — Operational | Release Owner | Release gates, versioning, or publication workflow changes | Governance workflow, CI configuration, and release tooling |

## Product and Project State

| Document | Purpose | Class | Owner | Refresh trigger | Source of truth |
|---|---|---|---|---|---|
| [`product/PRODUCT_VISION.md`](product/PRODUCT_VISION.md) | Mission, intended user outcome, and product direction | A — Authoritative | Product Owner | Approved product direction changes | Product owner decisions |
| [`project/ROADMAP.md`](project/ROADMAP.md) | Planned, active, and shipped product work | C — Status/Snapshot | Product Owner | Milestone start/close or capability status changes | Product decisions, code/tests, CI evidence, and current milestone |
| [`project/PROJECT_STATE.md`](project/PROJECT_STATE.md) | Point-in-time repository state, validation, and priorities | C — Status/Snapshot | Milestone Owner | Material branch, validation, blocker, or priority change | Git, CI, root `TECH_DEBT.md`, code, and tests |
| [`project/CURRENT_MILESTONE.md`](project/CURRENT_MILESTONE.md) | Active milestone scope and completion criteria | C — Status/Snapshot | Milestone Owner | Milestone start, scope change, or closure | Approved milestone and current evidence |
| [`../TECH_DEBT.md`](../TECH_DEBT.md) | Complete open and resolved technical-debt ledger | A — Authoritative | Technical Debt Owner | TD creation, reclassification, or evidence-backed closure | The on-disk ledger plus linked implementation evidence |
| [`project/TECH_DEBT_SUMMARY.md`](project/TECH_DEBT_SUMMARY.md) | Human-readable debt summary and priorities | C — Status/Snapshot | Technical Debt Owner | Authoritative ledger or priority changes | Root `TECH_DEBT.md` |
| [`architecture/KNOWN_LIMITATIONS.md`](architecture/KNOWN_LIMITATIONS.md) | Current limitations, intentional boundaries, and non-claims | C — Status/Snapshot | Architecture Authority | Capability, limitation, or debt status changes | Root `TECH_DEBT.md`, code/tests, and architecture decisions |

## Reference

| Document | Purpose | Class | Owner | Refresh trigger | Source of truth |
|---|---|---|---|---|---|
| [`product/GLOSSARY.md`](product/GLOSSARY.md) | Shared FORGE terminology | E — Reference | Product and Architecture Owners | A governed term is added or changes meaning | ADRs, governance documents, and product decisions |
| [`prompts/`](prompts/) | Standard task and review prompt templates | E — Reference | Documentation Owner | Workflow or prompt contract changes | Applicable governance and engineering authorities |
| [`templates/DOCUMENT_AUTHORITY.md`](templates/DOCUMENT_AUTHORITY.md) | Reusable authority metadata block | E — Reference | Documentation Owner | Authority classes or metadata requirements change | `START_HERE.md` authority model |
| [`td-064/TD-064-Failure-Class-Catalogue.md`](td-064/TD-064-Failure-Class-Catalogue.md) | Generator failure-class contract | A — Authoritative | Test Generation Owner | Approved failure-class contract changes | ADRs, approved design, and generator contract tests |
| [`architecture/spikes/`](architecture/spikes/) | Time-bounded investigation evidence | D — Historical | Architecture Authority | A spike is added or explicitly superseded | Original captured evidence |
| [`specs/`](specs/) | Feature and capability specifications | E — Reference | Architecture Authority | Specification status or governing decision changes | Applicable ADRs and current implementation evidence |

## Historical Material

| Document | Purpose | Class | Owner | Refresh trigger | Source of truth |
|---|---|---|---|---|---|
| [`product/FORGE-Handover.md`](product/FORGE-Handover.md) | Dated project orientation snapshot | C — Status/Snapshot | Documentation Owner | Retained until a separately approved archival task | Its stated baseline; never current behavior |
| [`archive/`](archive/) | Preserved legacy contracts, handoffs, and implementation briefs | D — Historical | Documentation Owner | Historical material is added or its archival label is unclear | Original documents in their historical context |

## Trust and Verification Rules

The authoritative TD-UI-062C Truth Board read-model contract is documented in
[`architecture/TD-UI-062C_TRUTH_BOARD_READ_MODEL.md`](architecture/TD-UI-062C_TRUTH_BOARD_READ_MODEL.md).
The authoritative TD-UI-062D Truth Board presentation contract is documented in
[`architecture/TD-UI-062D_TRUTH_BOARD_PRESENTATION_SLICE.md`](architecture/TD-UI-062D_TRUTH_BOARD_PRESENTATION_SLICE.md).
The authoritative TD-UI-063A Application Overview contract is documented in
[`architecture/TD-UI-063A_APPLICATION_OVERVIEW.md`](architecture/TD-UI-063A_APPLICATION_OVERVIEW.md).
The authoritative TD-UI-063B Application Observations contract is documented in
[`architecture/TD-UI-063B_APPLICATION_OBSERVATIONS.md`](architecture/TD-UI-063B_APPLICATION_OBSERVATIONS.md).
The authoritative TD-UI-063C Application Model contract is documented in
[`architecture/TD-UI-063C_APPLICATION_MODEL.md`](architecture/TD-UI-063C_APPLICATION_MODEL.md).
The authoritative TD-UI-063D / TD-UI-066A unified Application Evidence ledger contract is documented in
[`architecture/TD-UI-063D_APPLICATION_EVIDENCE.md`](architecture/TD-UI-063D_APPLICATION_EVIDENCE.md).
The authoritative TD-UI-067A decision-specific Application Readiness contract is documented in
[`architecture/TD-UI-067A_APPLICATION_READINESS.md`](architecture/TD-UI-067A_APPLICATION_READINESS.md).
The authoritative TD-UI-064A Crawl and Observation vertical-slice contract is
documented in
[`architecture/TD-UI-064A_CRAWL_OBSERVATION_VERTICAL_SLICE.md`](architecture/TD-UI-064A_CRAWL_OBSERVATION_VERTICAL_SLICE.md).
The authoritative TD-UI-064B live Application Observations vertical-slice
contract is documented in
[`architecture/TD-UI-064B_LIVE_APPLICATION_OBSERVATIONS.md`](architecture/TD-UI-064B_LIVE_APPLICATION_OBSERVATIONS.md).

1. Current code, tests, migrations, configuration, and CI workflows outrank
   explanatory documents for implemented behavior.
2. ADRs explain why decisions exist; preserve their historical rationale.
3. Operational guides explain use and must be verified against executable
   behavior.
4. Status and snapshot documents do not define current truth.
5. Historical material is not operational guidance.
6. Readers and AI agents must report contradictions and follow the authority
   order in [`START_HERE.md`](START_HERE.md).
