# CLAUDE.md Best Practices: The Ultimate Guide

A `CLAUDE.md` file is the **standing brief / behavioral contract** for Claude Code (and other AI assistants). It is loaded automatically at the start of every session and re-read on every turn, so its structure, size, and content directly affect the assistant's accuracy, its context-window overhead, and your API cost.

This guide covers how to create, structure, and maintain a high-performance `CLAUDE.md`.

---

## 1. Core Philosophy: Every Line Must Earn Its Place

`CLAUDE.md` is not project documentation, an onboarding guide, or a roadmap. It is a short list of things the assistant would otherwise get wrong.

- **The Omission Rule (the only rule that matters):** For each line ask *"If I delete this, will the assistant make a mistake?"* If no, delete it. This — not any line count — is the real test.
- **Keep it short, because attention is finite.** As a rule of thumb, aim for the length of a single screen or two (~150 lines is a healthy target, not a hard limit). A 250-line file where every line is load-bearing beats a 100-line file padded with fluff. The Omission Rule sets the length; the target is just a smell test.
- **Dynamic over static:** Never list what the assistant can discover by searching the workspace (source file names, class inventories, full DB schemas). It will read the code; that content only goes stale.
- **Order by importance:** Put the most important and most-violated rules first. Attention degrades down a long file, so front-load what matters.

---

## 2. Recommended Structure

An optimized `CLAUDE.md` should follow a structured, scan-friendly layout:

```markdown
# [Project Name] — [Core Purpose]

[1-2 sentence description of what the project does]

---

## 🛠️ Build & Test Commands
[The exact terminal commands the assistant can run to verify its work]

## 🏗️ Architecture & References
[Brief architecture pointers and links to detailed external docs]

## 📋 Standing Rules
[Behavioral rules, design constraints, and workflow guardrails]

## ⚠️ Common Codebase Gotchas
[Tribal knowledge, tricky bugs, and quirks specific to this project]
```

Write rules as **imperatives**, not prose ("Never hardcode credentials," not "It is generally preferable that credentials not be hardcoded").

---

## 3. Section-by-Section Details

### A. Build & Test Commands
The highest-value section for an agentic assistant. Without it, the assistant guesses at package scripts or inspects config files by hand.
- Give **one canonical command** per task, not a menu. Prefer the project's declared script (`npm run build`) over raw fallbacks (`npx tsc`); listing both invites the assistant to pick the wrong one or run both. Only list an alternative if it does something genuinely different.
- Cover: build/compile, run all tests, run a single test file, debug / test UI, lint, format, start the dev server.

### B. Architecture & References (Layering)
Don't paste your architecture into `CLAUDE.md`. Keep it thin and **link out** to detailed docs.
- Use links the tooling can actually resolve. Repo-relative paths are the safest and most portable:
  - `[Architecture](../architecture/CODEBASE_MAP.md)`
  - `[Technical Debt](../../TECH_DEBT.md)`
  - `[Memory Log](../../MEMORY.md)`
- Avoid `file:///docs/...` style links with a leading slash — those resolve to a nonexistent filesystem root. If you must use absolute `file://` URIs, make them fully qualified (`file:///c:/Projects/forge/docs/ARCHITECTURE.md`) and be aware they break for anyone who clones to a different path.

### C. Standing Rules
Standing rules stop the assistant from producing code that violates decisions it can't infer from the repo.
- **State constraints as prohibitions or requirements:** *"Never hardcode credentials,"* *"Verify core models before building UI on top of them,"* *"Confirm CI impact before pushing."*
- **Only include the non-obvious.** Skip anything a competent engineer (or the model's defaults) would already do. Encode standards only where defaults genuinely vary run-to-run and the choice matters (test framework, error-handling convention).
- **Merge overlapping rules.** "Design before patching" and "fix known bugs first" are often one idea; collapse them.

### D. Gotchas
Document quirks that are hard to spot by reading the code and expensive to rediscover.
- Examples: stateful closures that hide live updates; build-tool wrapping issues inside `page.evaluate()`; naming-convention mismatches between generators and the DB schema; token-truncation limits on batched AI inputs.
- Each gotcha should name the symptom *and* the fix, so the assistant can act on it.

---

## 4. What to Exclude

- 🚫 **General coding platitudes:** "write clean code," "add unit tests," "use meaningful names." Modern LLMs do this by default; these lines only cost tokens.
- 🚫 **Standard library / framework APIs:** Don't explain how to write a React component or use Playwright — that's parametric knowledge.
- 🚫 **Future roadmaps:** The assistant works on what's in the repo today, not what's planned.
- 🚫 **Personal preferences in the shared file:** `CLAUDE.md` is committed and read by the whole team. Put individual formatting/comment preferences in your global or local file (see §5).
- 🚫 **Credentials or secrets:** Never store passwords, API keys, tokens, or personal config.
- 🚫 **Volatile values that live better in config:** e.g., a hardcoded model ID or version string duplicated from source. If it changes independently of this doc, you now have two places to update and a stale-doc risk. Link to the config instead, or omit.

---

## 5. Maintenance Best Practices

1. **Turn recurring mistakes into rules.** When you fix a bug pattern the assistant hit, add it as a Gotcha. When the assistant violates an unstated assumption, make it a Standing Rule.
2. **Edit in the moment.** If a mistake traces back to a missing or unclear line, fix `CLAUDE.md` right then — that's when the lesson is concrete.
3. **Prune as aggressively as you add.** Re-run the Omission Rule periodically; delete rules that no longer apply and stale references. Growth-only files drift toward noise.
4. **Use the memory tooling.** In Claude Code, `/memory` opens the memory files for editing, and the `#` shortcut lets you quickly append a remembered fact. Use them to capture lessons instead of hand-editing every time.
5. **Layer your instructions:**
   - **Global (`~/.claude/CLAUDE.md`):** Your personal rules across all projects (comment language, formatting preferences).
   - **Project (`./CLAUDE.md`):** Shared, committed repository rules — the subject of this guide.
   - **Local (`CLAUDE.local.md`):** Personal, uncommitted notes for one repo. Add it to `.gitignore`.
