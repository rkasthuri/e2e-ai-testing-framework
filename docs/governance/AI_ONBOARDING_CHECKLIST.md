# AI_ONBOARDING_CHECKLIST.md
<!-- version: 1.0 | status: ACTIVE | owner: Raj Kasthuri (AnvilQ Technologies LLC) -->

> This checklist must be completed by every new AI agent before contributing
> to FORGE in any capacity. "Contributing" includes writing code, running
> commands, reviewing diffs, making recommendations, or producing any output
> that will be acted upon by Raj or another agent.
>
> This checklist is not optional and is not a formality.
> An agent that begins work without completing it has violated
> AI_CONSTITUTION.md before writing a single line.
>
> Each item must be confirmed with evidence — not "I assume I understand"
> but "I have read section X and my understanding is Y."

---

> Root `AGENTS.md` is the active repository instruction entry point and routes
> agents here. This checklist remains the single authoritative owner of the
> required onboarding order, attestations, and role-specific confirmation.

## How to Use This Checklist

Work through every item in order. For each item:

1. Complete the action described
2. Confirm completion to Raj in your first response with specific evidence
   (e.g. "I have read AI_CONSTITUTION.md Section 3.5 — No Commit Without
   Aiden Diff Review — and my understanding is that every commit must be
   reviewed by Aiden before it is made, regardless of how small the change.")

Do not summarise. Do not say "understood." Show what you understood.

---

## Part 1 — Required Reading (Complete in Order)

### 1.1 — Read AI_CONSTITUTION.md in Full

```
□ Read AI_CONSTITUTION.md from top to bottom
□ Confirm your assigned role from Section 2
□ Identify the three rules from Section 3 most critical to your role
□ State any rules you do not fully understand — ask before proceeding
```

**Confirmation required:**
> "I have read AI_CONSTITUTION.md. My role is [role]. The three rules most
> critical to my role are [rule A], [rule B], [rule C] because [reasoning].
> I have the following questions: [questions or 'none']."

---

### 1.2 — Read AI_WORKFLOW.md in Full

```
□ Read AI_WORKFLOW.md from top to bottom
□ Understand the full standard workflow (Section 2) — all 10 steps
□ Understand the checkpoint protocol (Section 3.4)
□ Understand Rule 9 (Section 7)
□ Understand what triggers an unscheduled stop (Section 3.4)
□ Understand the brief format Aiden uses (Section 3.2)
```

**Confirmation required:**
> "I have read AI_WORKFLOW.md. I understand that [summarise the workflow
> in your own words — 3–5 sentences]. I will stop and report at every
> checkpoint. I will not push without Rule 9."

---

### 1.3 — Understand the Architecture (CODEBASE_MAP.md + DECISION_LOG.md)

> ARCHITECTURE_OVERVIEW.md was never written; its content lives in
> CODEBASE_MAP.md and DECISION_LOG.md. Read those (redirected 2026-07-22).

```
□ The two boundaries that must never be violated — CODEBASE_MAP.md §1
  (src/ never imports forge-ui/; engine ↔ UI communicate only via ExecutionContext
  + REST API), plus DECISION_LOG.md ("forge-ui as Separate Package" + "No Static
  Engine Import") for the governing decisions
□ The engine / UI separation (forge-ui vs src/) — CODEBASE_MAP.md §1
□ The data storage model — CODEBASE_MAP.md §2.7 (DB layer, schema, repositories);
  docs/architecture/ARCHITECTURE_NORTH_STAR.md "Data source-of-truth" for the source-of-truth decision (DB authoritative)
□ The forge-ui structure — CODEBASE_MAP.md §3 (tab pages, lib, REST API)
□ The pipeline stage sequence — root AGENTS.md pipeline line for now; a canonical
  enumerated architecture section is pending (TD-176)
□ Read the rest of CODEBASE_MAP.md for module-by-module architecture context
```

**Confirmation required:**
> "I have read CODEBASE_MAP.md §1 and the engine/UI decisions in DECISION_LOG.md.
> The two boundaries I must never violate are [boundary 1] and [boundary 2].
> My role touches [which modules/components]."

---

### 1.4 — Read GLOSSARY.md

```
□ Read GLOSSARY.md
□ Understand what GREEN means in FORGE (both dimensions)
□ Understand the difference between HONEST and CORRECT
□ Understand what insufficient-evidence means and why it is first-class
□ Understand what provenance means and the observed / inferred distinction
□ Flag any terms you do not understand before proceeding
```

**Confirmation required:**
> "I have read GLOSSARY.md. GREEN means [definition]. The difference
> between HONEST and CORRECT is [explanation]. insufficient-evidence
> is [explanation]."

---

### 1.5 — Read CURRENT_LIMITATIONS.md

```
□ Read ../architecture/CURRENT_LIMITATIONS.md as the sole current Product
  limitations authority
□ Understand the accepted local Product constraints and explicit cloud non-claims
□ Record the exact accepted App Model debt fingerprints and classification rule
□ Distinguish canonical Product authority from retained legacy/compatibility paths
□ Treat ../architecture/KNOWN_LIMITATIONS.md only as a retained historical
  catalog; do not repeat its entries as current without fresh executable evidence
```

**Confirmation required:**
> "I have read CURRENT_LIMITATIONS.md. The current constraints relevant to my
> role are [constraints]. The accepted debt is [classification], and the
> canonical/legacy boundary is [boundary]. I will use KNOWN_LIMITATIONS.md only
> for historical evolution, never as current operational truth."

---

### 1.6 — Read TESTING_STRATEGY.md

```
□ Read TESTING_STRATEGY.md
□ Understand the no-eval rule (Section 6)
□ Understand the test execution hierarchy (Section 4)
□ Understand what GREEN means for a test or capability (Section 12)
□ Review the new test checklist (Section 13)
```

**Confirmation required:**
> "I have read TESTING_STRATEGY.md. The no-eval rule means [explanation].
> Before calling any AI capability shipped, I must [what you must do]."

---

### 1.7 — Read DECISION_LOG.md

```
□ Read DECISION_LOG.md
□ Understand ADR-011 (Never Invent Specificity)
□ Understand ADR-015 (Provenance Follows Evidence)
□ Understand ADR-019 (Vocabulary Competence Boundary)
□ Understand why TD-148 was retired ("narrower, not weaker")
□ Understand the agentic sequencing decision
   (agentic loops must not precede the honesty floor)
```

**Confirmation required:**
> "I have read DECISION_LOG.md. ADR-011 means [explanation]. ADR-019
> requires [explanation]. TD-148 was retired because [explanation]."

---

### 1.8 — Read ROADMAP.md

```
□ Read ROADMAP.md
□ Identify the current phase and focus
□ Understand which capabilities are shipped vs. in progress vs. planned
□ Note the sequencing principles (Section — Sequencing Principles)
□ Note the milestone commitment at the bottom
```

**Confirmation required:**
> "I have read ROADMAP.md. The current focus is [focus]. The capabilities
> relevant to my immediate task that are shipped are [list]. Those in
> progress are [list]. I will not treat planned items as built."

---

## Part 2 — Repository Orientation

### 2.1 — Confirm Repo State

*For implementation agents (CC, Codex) only.*

```
□ Run: git status
  → Confirm working tree is clean or understand what is pending
□ Run: git log --oneline -5
  → Note the last 5 commits
□ Run: npm run check
  → Confirm type check passes before touching anything
□ Run: npm run test:unit
  → Confirm unit test baseline
□ Report all four outputs to Raj before proceeding
```

**Do not skip this step.** Starting implementation on a broken or dirty
repo produces compounding problems that are harder to diagnose later.

---

### 2.2 — Confirm You Understand the Tech Debt State

```
□ Ask Raj for the current state of TECH_DEBT.md
  (or ask CC to cat it from disk — the project-file copy is stale)
□ Identify any open TDs relevant to your task
□ Do not attempt to fix open TDs unless they are in your brief
□ Do not open new TDs unless you have confirmed they are not
  already logged
```

---

### 2.3 — Confirm the Engine Boundary

```
□ Understand that src/ must never import from forge-ui/
□ Understand that forge-ui/ communicates with src/ via ExecutionContext only
□ Confirm you know which boundary your task touches
□ If your task requires crossing the boundary — stop and raise with Aiden
```

---

### 2.4 — Confirm Path Resolution Rules

```
□ Understand that no filesystem path may be hardcoded
□ Confirm you will use __dirname, process.cwd(), path.resolve(),
  or path.join() for every path in every file you touch
□ Mental model: "Would this break if cloned into a different directory?"
  If yes — fix it before committing
```

---

### 2.5 — Confirm Copyright Header Requirement

```
□ Understand that every new .ts or .tsx file requires the AnvilQ header
□ Know the exact header text (AI_CONSTITUTION.md Section 3.9)
□ Confirm you will add it before committing any new file
□ Understand that Aiden checks for this in every diff review
```

---

## Part 3 — Role-Specific Requirements

Complete the section that matches your role. Skip sections that do not apply.

---

### 3.A — Implementation Agent (CC or Codex)

```
□ Confirm you have read the brief for your current task in full
□ Confirm you understand every step in the brief
□ Identify any steps where the brief and your understanding of the
  codebase diverge — raise these with Aiden before starting
□ Confirm you will stop at every checkpoint
□ Confirm you will not commit without Aiden diff review
□ Confirm you will not push without Rule 9
□ State the first step you will take and wait for go-ahead
```

**Session start report format:**
```
REPO STATE
  git status:     [output]
  last 5 commits: [output]
  npm run check:  [PASS / FAIL]
  test:unit:      [X/X passing]

BRIEF UNDERSTANDING
  Task:           [one sentence]
  First step:     [what I will do first]
  Questions:      [any questions or 'none']

READY TO PROCEED — awaiting go-ahead
```

---

### 3.B — Nova (Architectural Reviewer)

```
□ Confirm you have the full design proposal from Aiden
□ Confirm you understand the existing architecture context
  (from CODEBASE_MAP.md)
□ Confirm you understand the relevant ADRs from DECISION_LOG.md
□ Confirm your review will follow the format:
  Assessment / Risks / Recommendation / Decision
□ Confirm you will not make implementation decisions —
  only assessment and recommendation
```

---

### 3.C — Finn (UX Reviewer)

```
□ Confirm you have access to the forge-ui tab or component under review
□ Confirm CI is green before beginning UX review
□ Confirm your feedback will be structured as:
  Issue / Severity / Recommendation
□ Confirm you understand that actionable feedback is logged as TD-UI-* items
□ Confirm you are reviewing the UI surface only —
  not engine code or architecture
```

---

### 3.D — Aiden (Architecture Partner — New Session)

```
□ Confirm current project state from PROJECT_STATE.md
□ Confirm last commit hash and CI status from Raj or CC
□ Confirm open TD list from on-disk TECH_DEBT.md (not project-file copy)
□ Confirm current milestone from CURRENT_MILESTONE.md
□ Confirm what was in progress at the end of the last session
□ Do not make design rulings until current state is confirmed
```

---

## Part 4 — Final Confirmation

Before beginning any work, deliver this confirmation to Raj:

```
ONBOARDING COMPLETE — [Agent Name / Role]

Required reading:     ✅ All 8 documents read and confirmed
Repo orientation:     ✅ State confirmed (implementation agents only)
Role requirements:    ✅ Role-specific checklist complete

My role:              [role]
Current task:         [what I have been asked to do]
First action:         [what I will do first]
Questions before I start: [questions or 'none']

I have read AI_CONSTITUTION.md and I operate under its rules.
I will stop at every checkpoint and report with evidence.
I will not commit without Aiden diff review.
I will not push without Rule 9.
```

An agent that cannot produce this confirmation has not completed onboarding.
An agent that produces this confirmation and then violates the constitution
has committed a trust violation — not a misunderstanding.

---

## Part 5 — Ongoing Obligations

Onboarding is a one-time gate. These obligations are permanent:

```
□ Re-read AI_CONSTITUTION.md at the start of any session after a long gap
□ Re-read CODEBASE_MAP.md §1 (the two boundaries)
  before any task that touches module structure or inter-module contracts
□ Check TECH_DEBT.md before opening a new TD
  (confirm it is not already logged)
□ Check DECISION_LOG.md before proposing any structural change
  (confirm it has not already been decided)
□ Never assume the project is in the same state as the last session
  — always confirm repo state at session start
```

---

*FORGE™ — AI-Augmented Quality Engineering Platform*
*AnvilQ Technologies LLC — Copyright © 2026 Raj Kasthuri*
