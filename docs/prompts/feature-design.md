# Feature Design Prompt
<!-- FORGE prompt template — version 1.0 -->
<!-- Use: Aiden uses this to structure a feature design before writing the implementation task -->
<!-- This prompt produces the design. Nova reviews it. Then implementation-task.md follows. -->

---

## FORGE Feature Design

**Feature:** [Name]
**Aiden:** [Date]
**Related TD:** [TD-XXX or N/A]
**Pipeline stage:** [Crawl / Model / Verify / Generate / Execute / Triage / Heal / Learn / UI]

---

### Problem Statement

[What gap or limitation does this feature address?
What cannot be done today that this makes possible?
Reference the relevant TD or ../architecture/CURRENT_LIMITATIONS.md entry for
current truth. ../architecture/KNOWN_LIMITATIONS.md may be cited only as
explicitly historical context.]

---

### Success Criteria

[How will we know this feature is working correctly?
What is the measurable outcome?
Include both the HONEST dimension (reports truthfully) and
the CORRECT dimension (measures accurately) — both required for GREEN.]

---

### Proposed Design

#### Overview

[One paragraph. What the feature does and how it fits into the pipeline.]

#### Components

[What new components are needed, or what existing components change.]

| Component | New / Modified | Responsibility |
|---|---|---|
| [Name] | New | [What it does] |
| [Name] | Modified | [What changes] |

#### Data Flow

[How data moves through this feature. What it receives, what it produces.
Include provenance — is the output observed or inferred?]

```
Input: [what comes in]
  ↓
[Processing step]
  ↓
Output: [what goes out — with provenance label]
```

#### Storage Changes

[Any new tables, columns, or migrations required.
If none: state "No storage changes."]

#### API Surface Changes

[Any new ExecutionContext methods, REST routes, or CLI commands.
If none: state "No API surface changes."]

---

### Evidence Integrity

[How does this feature earn its confidence?
What evidence does it produce?
What happens when evidence is insufficient — can it return "unknown"?
Does it satisfy ADR-019 (both axes of vocabulary competence)?]

---

### Evaluation Harness

[What eval harness is needed for this AI capability?
If no AI is involved: state "No eval harness required."
If AI is involved: this section is mandatory — no AI capability ships without an eval.]

```
Ground-truth dataset:  [what labelled examples would look like]
Runner:                [how accuracy would be measured]
Pass threshold:        [minimum accuracy for GREEN]
```

---

### Risks and Open Questions

[What could go wrong. What is uncertain. What Nova should challenge.]

| Risk | Likelihood | Mitigation |
|---|---|---|
| [Risk] | [H/M/L] | [Mitigation] |

**Open questions for Nova:**
1. [Question]
2. [Question]

---

### Sequencing

[What must be true before this feature can be built.
What this feature enables after it ships.
Does this conflict with any standing design decision?]

**Prerequisites:**
- [TD or capability that must exist first]

**Enables:**
- [What becomes possible after this ships]

---

### Nova Review Required

[Yes / No — and why]

If yes: send this document to Nova using `architecture-review.md` template.
If no: document the reason (only routine implementation with no structural decisions).
