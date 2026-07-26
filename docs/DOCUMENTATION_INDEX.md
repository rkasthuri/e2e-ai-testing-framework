# FORGE Documentation
<!-- version: 1.0 | status: ACTIVE | owner: Raj Kasthuri (AnvilQ Technologies LLC) -->

> Master index and map for all FORGE documentation.
> Use this file to locate documents; it does not define governance or the
> required reading order.
>
> **If you are a new implementation agent:** Start at root
> [`AGENTS.md`](../AGENTS.md), which routes you to the authoritative checklist.
>
> **If you are looking for something specific:** Use Section 3 (Document
> Directory) to find it directly.

---

## 1. What This Documentation Covers

FORGE™ is an AI-augmented, app-agnostic end-to-end test automation platform
built by Raj Kasthuri under AnvilQ Technologies LLC.

This documentation set covers:
- The rules every AI agent must follow (constitution, workflow, onboarding)
- The system architecture and design decisions
- The current project state, milestone, and priorities
- How to set up, run, and contribute to FORGE
- The product roadmap, limitations, and testing strategy
- Reference material (glossary, decision log, codebase map)

---

## 2. Onboarding Map

This index does not own or restate onboarding governance. The exact required
reading order, attestations, repository checks, and role-specific confirmations
live only in
[`AI_ONBOARDING_CHECKLIST.md`](governance/AI_ONBOARDING_CHECKLIST.md).

### New AI or Implementation Agent

1. Begin at root [`AGENTS.md`](../AGENTS.md).
2. Complete
   [`AI_ONBOARDING_CHECKLIST.md`](governance/AI_ONBOARDING_CHECKLIST.md)
   in its stated order.
3. Use the role-specific links from that checklist. Codex-specific deltas live
   in [`CODEX_ONBOARDING.md`](governance/CODEX_ONBOARDING.md).

---

### Human Project Orientation

Start with [`FORGE-Handover.md`](product/FORGE-Handover.md), then use
[`BUILD_AND_RUN.md`](project/BUILD_AND_RUN.md),
[`ROADMAP.md`](project/ROADMAP.md), and
[`TECH_DEBT_SUMMARY.md`](project/TECH_DEBT_SUMMARY.md) for the relevant
operational or project-state context.

---

### Architectural Review

The role-specific reading and attestation live in
[`AI_ONBOARDING_CHECKLIST.md`](governance/AI_ONBOARDING_CHECKLIST.md);
the document directory below maps the constitution, workflow, decision log,
architecture, and roadmap sources it references.

---

## 3. Document Directory

### Foundation — Read Before Anything Else

| Document | Purpose | Status |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | Active repository-level instruction and governance-routing entry point for implementation agents. | ✅ Complete |
| [AI_CONSTITUTION.md](governance/AI_CONSTITUTION.md) | Immutable rules every AI must follow. Non-negotiable. | ✅ Complete |
| [AI_WORKFLOW.md](governance/AI_WORKFLOW.md) | Collaboration process, roles, approval gates, Rule 9. | ✅ Complete |
| [AI_ONBOARDING_CHECKLIST.md](governance/AI_ONBOARDING_CHECKLIST.md) | Step-by-step checklist every new AI must complete before contributing. | ✅ Complete |
| [CODEX_ONBOARDING.md](governance/CODEX_ONBOARDING.md) | Implementation agent specific onboarding guide. | ✅ Complete |
| [OPERATING_MANUAL.md](governance/OPERATING_MANUAL.md) | Orienting map to the working cycle, standing rules, roles, and onboarding — pointers to the canonical sources, not a restatement. | ✅ Complete |

---

### Architecture and Design

| Document | Purpose | Status |
|---|---|---|
| [CODEBASE_MAP.md](architecture/CODEBASE_MAP.md) | Module-by-module map of the repo, ownership, and dependencies. | ✅ Complete |
| [REPOSITORY_STRUCTURE.md](architecture/REPOSITORY_STRUCTURE.md) | Directory-by-directory explanation of the repo layout. | ✅ Complete |
| [DECISION_LOG.md](governance/DECISION_LOG.md) | Chronological record of architectural decisions and ADRs. | ✅ Complete |

---

### Project State

| Document | Purpose | Status |
|---|---|---|
| [FORGE-Handover.md](product/FORGE-Handover.md) | Master orientation document — complete project handover. | 📅 Dated snapshot (2026-07-20) — see on-disk ledger + status docs for current state |
| [PROJECT_STATE.md](project/PROJECT_STATE.md) | Current branch, WIP, open TDs, blockers, next priorities. | ✅ Complete |
| [CURRENT_MILESTONE.md](project/CURRENT_MILESTONE.md) | Active milestone objectives, scope, and completion criteria. | ✅ Complete |
| [TECH_DEBT_SUMMARY.md](project/TECH_DEBT_SUMMARY.md) | Summary of all open TDs, priorities, and status. | ✅ Complete |

---

### Strategy and Roadmap

| Document | Purpose | Status |
|---|---|---|
| [ROADMAP.md](project/ROADMAP.md) | Planned work, phases, and long-term product direction. | ✅ Complete |
| [TESTING_STRATEGY.md](project/TESTING_STRATEGY.md) | Testing philosophy, eval harnesses, execution strategy, validation. | ✅ Complete |
| [KNOWN_LIMITATIONS.md](architecture/KNOWN_LIMITATIONS.md) | Current limitations, assumptions, and deferred capabilities. | ✅ Complete |

---

### Operations

| Document | Purpose | Status |
|---|---|---|
| [BUILD_AND_RUN.md](project/BUILD_AND_RUN.md) | Setup, build, run, and debug FORGE locally. | ✅ Complete |
| [CI_PIPELINE.md](project/CI_PIPELINE.md) | CI/CD workflow, quality gates, release validation. | ✅ Complete |
| [RELEASE_PROCESS.md](project/RELEASE_PROCESS.md) | Versioning, release workflow, deployment. | ✅ Complete |

---

### Reference

| Document | Purpose | Status |
|---|---|---|
| [GLOSSARY.md](product/GLOSSARY.md) | Definitions of FORGE terminology, concepts, and abbreviations. | ✅ Complete |
| [/prompts/](prompts/) | Standardised prompts for architecture review, implementation, audits, ADRs, code review, CI review. | ✅ Complete |

---

### Archive

| Document | Purpose | Status |
|---|---|---|
| [CLAUDE.md](archive/CLAUDE.md) | Preserved legacy Claude-specific repository contract. Historical reference only; root `AGENTS.md` is active. | 🗄️ Archived — non-authoritative |
| [CLAUDE_BEST_PRACTICES_v2.md](archive/CLAUDE_BEST_PRACTICES_v2.md) | Historical reference used during earlier instruction-file design work. | 🗄️ Archived — non-authoritative |

---

## 4. Document Status Key

| Symbol | Meaning |
|---|---|
| ✅ Complete | Written, reviewed, accurate as of this version |
| 📅 Dated snapshot | Point-in-time doc; content may be superseded — verify against live state |
| ⏳ Pending verification | Requires repository verification from the active implementation agent before writing |
| ⏳ Pending upload | Raj to upload source material |
| ⏳ Pending | Requires scoping conversation before writing |

---

## 5. The One Rule That Governs All of This

Every document in this directory, and every agent who reads it, operates
under the same constraint that governs FORGE itself:

> **Confidence must be earned from observed evidence.**
> **It can never be assumed, inferred, or fabricated.**

Documentation that overstates capability is a defect.
Documentation that understates built capability is equally a defect.
Uncertainty is flagged inline — never papered over.

If you find a document that violates this — raise it with Aiden.

---

## 6. Keeping This Documentation Current

| When | What to update |
|---|---|
| New architectural decision | Add entry to `DECISION_LOG.md`, write ADR |
| TD opened or resolved | Update `TECH_DEBT_SUMMARY.md` and on-disk `TECH_DEBT.md` |
| Milestone completed | Update `PROJECT_STATE.md`, `CURRENT_MILESTONE.md`, `ROADMAP.md` |
| New limitation discovered | Add entry to `KNOWN_LIMITATIONS.md` |
| New capability shipped | Update `ROADMAP.md` status, update `CODEBASE_MAP.md` |
| New agent joins | Begin at root `AGENTS.md`; complete `AI_ONBOARDING_CHECKLIST.md` |
| New term introduced | Add to `GLOSSARY.md` |

Documentation that drifts from the codebase is as much a lie as code
that claims more than it does. Keep them in sync.

---

*FORGE™ — AI-Augmented Quality Engineering Platform*
*AnvilQ Technologies LLC — Copyright © 2026 Raj Kasthuri*
