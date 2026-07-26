# FORGE Operating Manual
<!-- version: 1.0 | status: ACTIVE | owner: Raj Kasthuri (AnvilQ Technologies LLC) -->

> One-page orientation to how FORGE is built — the cycle, the rules, the roles, and how a new
> participant gets productive.
>
> **This is a MAP, not an authority.** Where it points at a rule, the canonical text lives in the
> linked source; this manual never restates it (Single Source of Truth DR, `DECISION_LOG.md`). If
> this map and a linked source ever disagree, the source wins — and the disagreement is a defect to
> report.
>
> **Read for the ROLE you hold, not the tool you are.** It must read correctly for a human, for CC,
> for Codex, or for a future agent. Roles are defined by function (Section 3); who holds them is a
> roster line, not a rule.

---

## 1. The Cycle

The end-to-end working cadence. **Pointers only — do not treat this table as the rule; follow the
pointer to the canonical text.** The one place the whole cycle is drawn as a single no-skip flow is
`AI_WORKFLOW.md` §2 (the 10-step diagram). Note the authority is split: steps 1/2/5/6 are canonical
in `AI_CONSTITUTION.md`; steps 3/4/7 in `AI_WORKFLOW.md`.

| # | Step | What happens | Canonical source |
|---|---|---|---|
| 1 | Audit before fix | Reproduce and diagnose the root cause before proposing anything — no patch on contact | `AI_CONSTITUTION.md` §3.3 |
| 2 | Design before code | A structural change needs a design and the design-authority's sign-off first | `AI_CONSTITUTION.md` §3.2 |
| 3 | Reviewer at every fork | An independent architectural reviewer is consulted at every design fork, however obvious the answer seems | `AI_WORKFLOW.md` §3.3 + §5 |
| 4 | Scoped brief to implementer | The implementer works from a scoped brief (context / scope / out-of-scope / steps / verify / stop) and never self-directs scope | `AI_WORKFLOW.md` §3.2 (brief format) + §5 |
| 5 | Diff review, not summary | The reviewer reads the actual diff, never a summary of it | `AI_CONSTITUTION.md` §3.5 |
| 6 | Commit gate | No commit without reviewer approval; the implementer never self-approves | `AI_CONSTITUTION.md` §3.5 |
| 7 | Rule-9 push gate | No push without the owner's explicit "Go"; a push triggers live cost — CI runs, API usage, Slack/email, automated commits | `AI_WORKFLOW.md` §7 (authorisation protocol) · CI-cost rationale in `../../AGENTS.md` "Task and Checkpoint Workflow" |

---

## 2. The Standing Rules

The always-on rules an implementer re-reads every turn. **Index only — each rule's enforceable text
lives at its source of truth.** Three ⚠ notes flag *weak footing* (single-homed, ADR-less, or
enforcement-not-yet-built); they are observations for the design authority and reviewer to home, not
fixes this map makes.

| Rule | Source of truth | Footing |
|---|---|---|
| Evidence before "resolved / fixed / passing" (verify, adversarially) | `../../AGENTS.md` "Non-Negotiable Engineering Posture" · `AI_CONSTITUTION.md` §3.1 · `../ADR/ADR-011_Verify_Before_Assert.md` | strong |
| Design before code (structural fix over local patch) | `../../AGENTS.md` "Task and Checkpoint Workflow" · `AI_CONSTITUTION.md` §3.2 | ⚠ no dedicated ADR — authority is the contract + constitution |
| App-agnostic / portable paths (no app logic or hardcoded paths in framework internals) | `../ADR/ADR-007_App-Agnostic Framework Design.md` · `AI_CONSTITUTION.md` §3.8 | strong |
| Honest provenance (assert only what evidence supports) | `../ADR/ADR-015_Provenance_Follows_Evidence.md` (parent: `../ADR/ADR-006_Truth-Telling and Earned Evidence.md`) | strong |
| Reference-naming (name the real file; path resolvable from the citing location) | `../../AGENTS.md` "Documentation and Working Artifacts" | ⚠ single-homed in AGENTS.md; automated CI enforcement not yet built (`../../TECH_DEBT.md` TD-177) |
| No business logic in routes (`forge-ui/server/` routes are transport only) | `AI_CONSTITUTION.md` §3.10 | ⚠ no ADR; enforcement is diff review only |
| Aggregate to the weakest truth (failed > could-not-verify > passed) | `../ADR/ADR-018_Aggregate_to_the_Weakest_Truth.md` | strong; ratified, with a reference implementation |

---

## 3. Roles

FORGE runs on five roles, defined by **what the role does** — independent of who holds it. Changing
who holds a role means editing the roster below; it never changes the role definitions.

- **Owner** — final authority on product, architecture, and process. The only role that authorises a
  push (Rule 9). Sets direction and resolves every fork the reviewer escalates.
- **Design authority** — turns a goal into a scoped, reviewable brief; holds design sign-off (no code
  without it); reads the actual diff before any commit; owns documentation. The gate between *what*
  and *how*.
- **Implementer** — executes on-disk work strictly from an approved brief; produces evidence (diffs,
  command output); stops at every checkpoint; never self-approves scope, commits, or pushes.
- **Reviewer** — an independent architectural check, consulted at every design fork however obvious
  the answer seems; outputs assessment + recommendation only, and never implements. Independence is
  the point.
- **UX** — product and usability critique of user-facing surfaces; review only.

**The handoff (the repeatable pattern):** Owner sets a goal → Design authority drafts the brief,
consulting the Reviewer at each fork → Owner approves → Implementer executes → Design authority
reviews the diff → Reviewer again if the change is structural → Owner issues Rule 9 → push → UX
critiques the result. No step is skipped. The canonical flow is `AI_WORKFLOW.md` §2.

### Current roster

| Role | Currently held by |
|---|---|
| Owner | **Raj Kasthuri** |
| Design authority | **Aiden** (Claude, primary chat) |
| Reviewer | **Nova** (ChatGPT) |
| Implementer | **CC** (Claude Code) or **Codex** (OpenAI Codex) — one active at a time; the role is identical for both |
| UX | **Finn** |

> A new participant — human or agent — **adopts a role and its obligations wholesale**. Onboarding
> someone new is a roster edit, not a rewrite of the role definitions. Full per-role responsibilities:
> `AI_CONSTITUTION.md` §2 and `AI_WORKFLOW.md` §3.

---

## 4. Getting Productive

The reading order, per-doc attestations, and implementer baseline checks already exist — this section
**points at them and fills the two gaps they leave**, without restating them.

**Start here (existing):** the required reading order, "show what you understood" attestations,
and implementer baseline checks (`git status` · `git log --oneline -5` · `npm run check` ·
`npm run test:unit`, reported before any work) live in `AI_ONBOARDING_CHECKLIST.md`.
`../DOCUMENTATION_INDEX.md` is a map only and does not own onboarding governance.
Root `../../AGENTS.md` is the active repository entry point and routes implementation agents to
the checklist without restating it.

### First task — a dry run of the cycle (any role)

Before real work, a new occupant of **any** role does one small, throwaway task end-to-end. The point
is not to produce value — it is to exercise every gate once, on something zero-risk, so the first real
task is not also the first time the loop is tested:

- **Implementer** — take a trivial scoped brief (e.g. add a missing copyright header to one file),
  produce the diff, stop for review. Proves the brief → implement → diff-review → gate path.
- **Design authority** — write one throwaway scoped brief and take it through reviewer consultation.
  Proves the brief format and the fork-review handoff.
- **Reviewer** — review one real diff or fork and return an assessment + recommendation in the
  expected format. Proves the independent-review handoff.
- **Any role** — the goal is to hit each checkpoint once (review, no self-approve, Rule 9) before it
  matters.

*(The implementer form of this exists today as Codex's "First Task Recommendation," `CODEX_ONBOARDING.md`
§10; it is generalised here to every role.)*

### Human / reviewer entry path

The baseline checks above are written for implementation agents. A human or reviewer joining does the
equivalent:

1. Read the required set (`../DOCUMENTATION_INDEX.md` §2) and produce the attestation — *show* what
   you understood, do not say "understood" (`AI_ONBOARDING_CHECKLIST.md` §4).
2. Confirm you can **locate** the baseline gates (you need not run them): where `npm run check` and
   `npm run test:unit` are defined and what a green result looks like (`../../AGENTS.md`
   "Validation").
3. Confirm which role you hold (§3 roster) and read its obligations at the sources linked there.
4. Do the first-task dry run for your role (above) before taking on real work.

---

*FORGE™ — AI-Augmented Quality Engineering Platform*
*Copyright (c) 2026 AnvilQ Technologies LLC. All rights reserved.*
