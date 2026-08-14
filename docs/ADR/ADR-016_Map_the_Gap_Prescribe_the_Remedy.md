<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-016: Map the Gap, Prescribe the Remedy

## Status
Proposed

## Date
2026-07-13

## Context

### The origin argument — honesty is half a product
ADR-015 made FORGE honest. It did not make FORGE useful.

Suppose FORGE generates 81 specs and 73 contain steps it never observed. Suppose
it labels them honestly — badges, warnings, grounding notes, all of it. The
operator says "yes, give me all 81."

How long does that person now spend validating 73 ungrounded specs? Run it, watch
it fail, diagnose it (bad selector? unreachable page? wrong assumption?), fix it.
Ten to thirty minutes each. **73 specs = 12 to 36 HOURS.** They would have been
faster writing them by hand.

THAT is the failure mode that discredited the previous generation of AI test
tools. Not that the generated code was bad — that **VALIDATING it cost more than
writing it**. The tool appeared to deliver 81 tests and actually delivered 8
tests plus two weeks of debugging.

An ungrounded spec is not a bonus. It is **a liability wearing a badge**. An
honest report of a gap tells the operator they have a problem; it does not tell
them what to do about it. **Honesty without a remedy is half a product.**

### How this connects to current work
Triggered by the confluence of two threads:
- **ADR-015 / TD-UI-029** made verification honest about what it did *not* verify
  — the report now surfaces `elementsCouldNotVerify`, `endpointsSkipped`, and
  `pagesWithNoCriticalElements`. Those fields *are* coverage gaps. Having made
  them representable, the open question is what FORGE prescribes for each.
- **TD-UI-033 (Discovery)** is the operator-facing surface where remedies get
  requested — input ingestion, intent-vs-grounding reconciliation, "the crawl
  wins." ADR-016 is the governing decision behind that arc: the Discovery UI must
  ask for the *smallest targeted input*, and only after FORGE has exhausted what
  it can observe itself.

`TD-UI-034` is already the first concrete instance of Remedy Hierarchy step 1:
for an all-mutations API scored `insufficient-evidence`, the ruling was **verify
more (path-param sample IDs, contract read-verification) — do NOT score softer**.
That is FORGE closing the gap itself rather than lowering the bar or asking the
operator to vouch for coverage.

## Principle
> "FORGE never reports a gap without stating what would close it." — Raj

Not a generic "upload your documentation." The exact, targeted, **per-gap** ask:

> **NOT:** "73 flows are ungrounded."
>
> **BUT:** "I could not ground `checkout-flow`. No real edge was observed from
> `cart-html` → `checkout-step-one`.
> → Give me a test case describing this journey and I can ground it against the
> elements I DID observe.
> → Or let me try walking it agentically."

ADR-015 (Provenance Follows Evidence) made **absence honest**: a verification
that verified nothing must say so (`insufficient-evidence`, `could-not-verify`,
`endpointsSkipped`, `pagesWithNoCriticalElements`) rather than fabricate a
passing default. ADR-016 governs the **next question**: once a gap is honestly
flagged, what does FORGE *do* about it?

The answer is not "report it and wait for a human to audit." The answer is:
FORGE prescribes the **lowest-cost evidence that closes the gap**, and where
FORGE can close the gap *itself*, it must recommend that before asking the
operator for anything. Coverage is a contract FORGE actively drives toward — not
a checklist it hands to the operator.

## Corollaries

**1. Derive, don't declare — applied to remedies. (Aiden)**
Never ask a human for something FORGE could go observe. `TD-UI-033` already
established this for *inputs* (FORGE auto-detects an input's type; the dropdown
is an override, not a declaration the user must make). ADR-016 extends the same
reflex to *gaps*: operator effort must stay **proportional to the actual
uncertainty**, not to FORGE's unwillingness to look.

**2. A document is a claim; the crawl is evidence. (Aiden, `TD-UI-033`)**
Even when FORGE *does* ask the operator, what it gets back is **intent**, not
**grounding**. A document (BRD, mockup, described journey) is a CLAIM about the
application; only observation produces evidence. When a claim and the crawl
disagree, the crawl wins, and the disagreement is itself a reportable finding.
This is *why* the remedy hierarchy prefers self-observation: it yields grounding;
an operator ask yields only a claim that still has to be reconciled.

**3. You cannot remedy a gap you fabricated away. (ADR-015)**
The honesty floor is a precondition. A prescribed remedy is only meaningful if
the gap it targets was flagged truthfully. ADR-016 sits *on top of* ADR-015: map
the gap without fabrication first, then prescribe.

## Decision

### Core rule — the Remedy Hierarchy (Nova)
Always propose the **LOWEST-COST evidence that closes the gap**. Ordered:

  1. **FORGE closes it ITSELF** — agentic exploration, re-crawl, a different
     role, another observation. Zero operator cost. If FORGE CAN close a gap, it
     must recommend that BEFORE asking the human for anything.
  2. **FORGE asks for the SMALLEST TARGETED input** — "describe this one
     journey," never "upload your documentation."
  3. **Only then, the broader ask.**

This is "derive, don't declare" applied to remedies: never ask a human for
something FORGE could go observe. Operator effort must stay PROPORTIONAL TO THE
ACTUAL UNCERTAINTY — not to FORGE's unwillingness to look.

### The gap must carry its remedy
A flagged gap is not a complete output until it carries a **prescribed remedy**
and the **hierarchy tier** that remedy sits at. A gap report that stops at "here
is what I could not cover" — without prescribing the target remedy — is
incomplete under this ADR. A report that jumps straight to a tier-2/3 operator
ask without first evaluating tier-1 self-closure is a **defect**, not a
conservative choice.

### Gap → Remedy Map (illustrative — grows as capabilities grow)

| Gap | Targeted remedy |
|---|---|
| No observed edge A→B | a test case describing the journey, **or** agentic exploration of that path |
| Element observed, purpose unclear | a BRD / requirement naming the rule |
| Page unreachable (auth wall) | credentials, or a prerequisite flow |
| Flow detected but never verified | permission to run and observe it |
| Don't know what MATTERS | existing test cases, bug history, or production analytics |

The map is not fixed. As FORGE's own capabilities grow (e.g. agentic crawl,
`TD-013`), remedies migrate **up** the hierarchy — a gap that needs an operator
ask today becomes a tier-1 self-closure tomorrow.

## Review Protocol (Finn) — applied to every FORGE design
Every FORGE design is reviewed through these three questions, in order:

  1. **IDENTIFY THE GAP** — where is the boundary of observation or intent?
  2. **ENFORCE THE HONESTY FLOOR** — flag it cleanly, without fabrication
     (ADR-015).
  3. **PRESCRIBE THE TARGET REMEDY** — what exact asset, credential, or agentic
     directive destroys THIS specific gap?

Step 3 is the addition ADR-016 makes to the existing correctness/honesty review:
a design that identifies a gap and flags it honestly but does *not* prescribe the
minimal remedy has not yet passed review.

## Consequences
1. FORGE's real output is not "81 tests." It is: "8 tests I can stand behind,
   plus 73 flows I could not observe — here is why, and here is exactly what I
   need to close each one."
2. The ungrounded set is not test output. It is a **WORK LIST**, and FORGE owns
   telling the user how to work it.
3. Discovery (`TD-UI-033`) becomes **GAP-DRIVEN, not bulk-import**. FORGE does
   not say "upload everything you have." It says "I need these 12 specific
   journeys described — here is what I could not see." A far smaller ask, a far
   higher hit rate.
4. Agentic crawl (`TD-013`) is not a feature on a roadmap. It is a **REMEDY** —
   FORGE closing its own gaps by going and observing, instead of asking the
   human.
5. Autonomy is the goal and 100% is unreachable. **WHERE FORGE CANNOT BE
   AUTONOMOUS, IT MUST BE A GUIDE.** The gap between what FORGE knows and what it
   needs is not a failure to hide. It is the most valuable thing FORGE can tell
   you.
6. This reverses the operator dynamic. Today the operator audits FORGE. Under
   ADR-016, FORGE guides the operator — telling them how to reach maximum
   coverage with minimum friction. FORGE is not a tool that writes code. It is a
   tool that maps and eliminates uncertainty.

## Follow-ups
- **TD-UI-039 — remedy-bearing gap schema** — every ungrounded flow, unverifiable
  page, and unclassified element carries a structured, **machine-readable** remedy
  (a field on the evidence model, not a UI string) so UI, CLI, and every future
  consumer surface the same targeted ask. Requires a remedy taxonomy and each
  gap-producing subsystem (FlowDetector, VerificationRunner, CrawlRunner, module
  classifier) emitting one, honouring the remedy hierarchy (tier-1 self-closure
  before any operator ask). Logged in `TECH_DEBT.md`.
- **TD-UI-034** is the first tier-1 instance (verify more, don't score softer);
  it should be tagged as governed by ADR-016.
- **TD-UI-033 (Discovery)** is the tier-2/3 surface; its ask flows must be
  gap-driven — the smallest-targeted-input rule, not bulk-import.
- **TD-013 (agentic crawl)** is a tier-1 remedy engine, not a standalone feature:
  it is how FORGE closes its own edge/reachability gaps by observing.
- **Coverage Gap Analysis** and **"Ask"** (both in CLAUDE.md's *Not Yet
  Implemented* list) are the capabilities this ADR governs; neither may ship a
  remedy that skips the hierarchy.

## Related
ADR-015 (Provenance Follows Evidence — the honesty floor ADR-016 builds on),
ADR-006 (Truth-Telling and Earned Evidence), ADR-011 (Verify Before Assert),
ADR-003 (Human Review Gate — the operator dynamic ADR-016 reverses), ADR-007
(App-Agnostic Framework Design), TD-UI-033 (Discovery / "derive don't declare" /
intent-vs-grounding), TD-UI-034 (first tier-1 remedy instance), TD-UI-039
(remedy-bearing gap schema), TD-013 (agentic crawl as a tier-1 remedy), TD-066
(earned confidence, never fabricated).

## Status Audit Note — 2026-08-14 (TD-CONFIG-003)

This ADR remains **Proposed**. Canonical ObservationGap and several execution
refusal paths preserve precise reason vocabularies, and crawl diagnostics carry
bounded remedies. The complete decision requires every governed gap to carry a
structured remedy after evaluating self-closure first. TD-UI-039 and TD-UI-053
show that the shared remedy taxonomy and all producer/consumer paths are not yet
complete. The implemented subset does not justify ratifying the whole contract.
