# Implementation Task Prompt
<!-- FORGE prompt template — version 1.0 -->
<!-- Use: Aiden prepares this for CC or Codex for every implementation task -->
<!-- Nova's note: this is the most important prompt in the pack -->

---

## FORGE Implementation Task

**Agent:** [CC / Codex]
**Prepared by:** Aiden
**Date:** [YYYY-MM-DD]
**Related TD:** [TD-XXX or N/A]

---

### Objective

[One sentence. What will be true when this task is complete that is not true now.
Not "improve X" — a specific, verifiable outcome.
Example: "StrategyDetector correctly counts real links on MPA pages (TD-162)."]

---

### Background

[Why this work is needed. What problem it solves.
What the current behaviour is. What the desired behaviour is.
Keep to 3–5 sentences. If the TD description is complete, reference it here
rather than repeating it.]

---

### Relevant ADRs

[List only the ADRs that constrain or inform this task.
Include the decision text, not just the number — Codex cannot look up history.]

- ADR-XXX: [Decision text in one sentence]
- ADR-XXX: [Decision text in one sentence]

---

### Relevant TDs

[List open TDs this task resolves or must not disturb.
One line per TD. Include current status.]

| TD | Description | This task |
|---|---|---|
| TD-XXX | [description] | Resolves |
| TD-XXX | [description] | Must not disturb |

---

### Files to Modify

[Explicit file paths — relative to repo root. One per line.
Be specific. If unsure of exact path, verify with CC before writing the brief.]

```
src/core/crawler/StrategyDetector.ts
src/core/crawler/BFSStrategy.ts
```

---

### Files NOT to Modify

[Explicit paths that must not change, with the reason why.]

```
forge-ui/          — engine boundary: src/ never imports from forge-ui/
src/core/storage/  — no schema changes in this task
```

---

### Constraints

[Numbered list. Every constraint that applies to this specific task.]

1. No hardcoded filesystem paths — use `__dirname`, `process.cwd()`, `path.resolve()`
2. Copyright header required on every new `.ts` / `.tsx` file (see AI_CONSTITUTION.md 3.9)
3. Engine boundary: `src/` must not import from `forge-ui/`
4. No business logic in routes
5. [Task-specific constraints]

---

### Step-by-Step Instructions

[Numbered steps. Each step is a checkpoint — agent stops and reports after each one.]

**Step 1 — [Step name]**
[What to do. Be specific about file, function, and change.]
→ Stop and report before proceeding to Step 2.

**Step 2 — [Step name]**
[What to do.]
→ Stop and report before proceeding to Step 3.

**Step 3 — [Step name]**
[What to do.]
→ Stop and report. This is the final step.

---

### Acceptance Criteria

[Numbered, verifiable. Each item must be checkable with terminal evidence.]

1. `npm run check` passes clean
2. `npm run test:unit` passes — expect [X]/[X]
3. [Specific behaviour test — e.g. "StrategyDetector returns realLinks > 0 on Wikipedia"]
4. No new TDs introduced by this change
5. Copyright header present on any new files

---

### Definition of Done

Codex / CC must produce before reporting completion:

```
□ List of all files modified (actual paths)
□ Terminal output confirming each acceptance criterion
□ git diff output (actual diff — not a description)
□ Any questions or divergences discovered during implementation
```

---

### Validation Required

```bash
npm run check              # Must pass — tsc --noEmit
npm run test:unit          # Expect [X]/[X]
[any additional commands]
```

---

### Rollback Considerations

[What a revert of this change would affect.
If low-risk: state that.
If it touches schema, persistent state, or external APIs: describe what rollback requires.]

---

### Commit Message

```
fix(crawl): [short description] (TD-XXX)
```

---

### Notes for Agent

[Any additional context that does not fit the above sections.
Reference docs the agent should read for this specific task.]

- Read: `CODEBASE_MAP.md` Section 2.3 (crawler module)
- Read: `../architecture/CURRENT_LIMITATIONS.md` for current constraints
- Historical context only: `../architecture/KNOWN_LIMITATIONS.md` L-002 records the retired
  single-hop constraint and must not be used as a current implementation premise
- [Additional notes]
