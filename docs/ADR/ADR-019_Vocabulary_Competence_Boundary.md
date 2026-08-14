<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-019: Vocabulary Competence Boundary

## Status
Accepted (ratified 2026-08-14; amended 2026-07-19 — second axis added; see
Amendment History)

## Date
2026-07-18 · amended 2026-07-19

> **Note on title:** originally "Vocabulary Competence Boundary." The 2026-07-19
> amendment broadens the law to two axes; the unifying concept is **evidential
> sufficiency**. The filename is retained (the stable citation is the number, ADR-019);
> a rename to `ADR-019_Evidential_Sufficiency.md` is available and clean.

## Principle
> "A comparison may produce a definitive conclusion only when BOTH hold: (1) the
> detector can **represent** the competing values, AND (2) the available observations
> **uniquely support** the asserted conclusion. These are necessary conditions; neither
> is sufficient alone." — Nova (unifying principle, 2026-07-19 amendment)

ADR-015 governs **provenance**: a claim requires evidence.
ADR-019 governs **evidential sufficiency**: the evidence must both *express* the claim
and *uniquely support* it. Neither replaces ADR-015 — a conclusion needs an observation
(015) whose vocabulary can represent the values **and** whose result the observation
uniquely supports (019).

The detector contract carries **three** properties, all owned by the detector, none
rediscovered by consumers:
1. **observation vocabulary** — the values it can observe and emit;
2. **representational competence** — can it express the values being compared? (axis 1)
3. **discriminative competence** — do its observations *uniquely* support the conclusion
   being asserted? (axis 2)

The focus stays on *what conclusions the detector's observations can uniquely support* —
never on "what the detector can distinguish" in the abstract. The question is always
whether the evidence justifies the conclusion.

## The distinction that generated it
The three-state identity-divergence model (TD-UI-027: `divergence-detected` /
`no-divergence-detected` / `inconclusive`) protected against a **failed** observation
collapsing into agreement — a probe that could not run returns `inconclusive`, never
`no-divergence-detected`. It did **not** protect against a **successful-but-incompetent**
observation doing the same.

The old guard asked: *"did the probe run?"* The missing question is: *"was the probe
capable of representing the thing it was asked about?"* A probe can run cleanly, produce
a confident value, and still be answering a question its vocabulary cannot express. That
value compared against a configured value the detector cannot represent yields a
comparison result that looks earned but is not.

## The two axes

### AXIS 1 — Representational competence (original ADR-019, TD-142)
Can the detector's vocabulary **represent** the values involved in the comparison?

- **Failure:** a configured authType `sso` compared against a `{ form-login, none }`
  vocabulary — the detector has no token for `sso`, so it cannot confirm *or* deny the
  distinction.
- **Character:** fails **loudly, at an enumerable boundary**. Greppable — the vocabulary
  is a finite set and the miss is decidable from the configured value alone.

### AXIS 2 — Discriminative competence (2026-07-19 amendment, TD-146)
Assuming the values are representable, do the available observations **uniquely identify**
the hypothesis being asserted, or do multiple materially different causes produce the same
observation?

- **Failure:** `observed.baseUrl = page.url()` after navigation. An IdP origin is perfectly
  representable, but it is **equally consistent with** the application moving, an SSO
  redirect, a reverse proxy, a maintenance redirect, geo routing, or tenant routing. The
  observation does not select among them.
- **Character:** fails **silently**, whenever an observation is under-determined by its
  causes. **Not greppable** — it must be reasoned about per signal, from the space of
  causes that could produce the observation.

**Accepted cost — structural muteness.** Applying axis 2 to an under-determined observation
can render a signal *structurally incapable of its positive conclusion*. Once baseUrl gates
every origin difference to `inconclusive`, it can **no longer emit `divergence-detected`
under any input** — its only reachable outcomes are `no-divergence-detected` (same origin)
and `inconclusive` (any origin difference). This is an **accepted cost of correctness, not
an oversight**: a conclusion we cannot back is not drawn. The risk (Nova, first flagged on
TD-142) is real — a signal that can never fire is close to a **mute** signal, and perpetual
inconclusiveness invites consumers to stop reading it, eroding the honesty model **by
attrition** rather than by lying. The remedy is always to **enrich the observation until it
discriminates** (a capability milestone — TD-147 for baseUrl), **never to relax the gate**.

## The observation-context prerequisite (before either axis) — added 2026-07-19, TD-148
Both axes assume the observation is even *about* the conclusion's domain. It may not be.
**Before** asking whether the evidence *distinguishes* competing hypotheses (axis 2) or
*represents* the compared values (axis 1), verify the observation context is capable of
evidencing the conclusion domain **at all**.

**The audit sequence is domain → representation → discrimination.** Domain is **not a third
axis** — there is no axis 3. It is a *prerequisite* to both: an observation from the wrong
domain fails discrimination for a reason **no gate inside the comparison can fix**.

**Worked example — TD-148 (the probe observes the door, not the room).** The
identity-divergence probe fired only on crawl auth failure, so its execution context was
**always** pre-auth: it observed the **login surface**, then drew conclusions about the
**application behind it**. A proposed "if pre-auth, gate every signal to inconclusive" fence
would have rendered every signal *permanently* inconclusive — precisely because the context
is always pre-auth — and that is the evidence that the comparison **never belonged in this
execution context**. The fix was not a harder gate but a **domain correction**: lower the
conclusion to the reachable domain. The capability was **retired, not gated**; the surface
now records login-surface observations and concludes nothing.

**Observation-only surfaces sit at the FLOOR of this framework.** A surface that draws no
conclusion has axes 1 and 2 **idle** — there is no conclusion whose representation or
discrimination could fail — and it passes the domain check **by construction**: it asserts
only within the domain it observed, and can never make the observation-domain ≠
conclusion-domain leap. That is *why* it is honest. But a surface that asserts nothing
*explicitly* still makes **implicit** claims — **which observations it selects** (a relevance
claim) and **how it frames them** (a connotation claim). Those re-enter the domain check:
"these are the relevant signals" is a diagnosis-domain assertion the observation domain does
not support. So the audit still applies to a record-only surface, on its *implicit*
assertions: report **mechanism** ("what this probe observed"), never **relevance**, and
attach each observation's non-implications so it cannot be read as a cause.

## The rule
A comparison resolves to `inconclusive` when **either** axis fails:

1. **(axis 1)** the configured value is outside the detector's representational vocabulary; or
2. **(axis 2)** *the observation admits multiple materially different explanations that
   cannot be separated by the available evidence.*

The axis-2 rule is stated in terms of **under-determination**, not any single cause.
It is deliberately **not** "gate on redirect" — a redirect is merely axis 2's first
manifestation; writing it redirect-specifically would make the ADR accidentally about
redirects. Whenever the evidence cannot separate the competing explanations, the outcome
is inconclusive.

`inconclusive` is **not a fallback**. In both axes it is the only truthful answer: the
detector observed cleanly, but the comparison it was asked to make is not one its evidence
can definitively support. FORGE remains an **evidence consumer, not an inference engine** —
it does not guess which cause produced the observation. `inconclusive` we can back beats
`divergence-detected` we cannot.

## The authority rule
The **detector** is the authority on its own competence — never the comparison layer.
Comparison layers **ask** (`canRepresent(configuredValue)`); they do **not** maintain
their own copies of vocabulary lists. A public array invites callers to read and copy it,
reproducing the list at every call site and letting it drift; a method keeps the boundary
interrogable but not copyable, and does not assume the boundary is a finite enumerable
list. (This is why ADR-019 mandates a `canRepresent`-style predicate over an exported
`supportedVocabulary` array — the two reviews split on this; the method won on the
authority rule.)

## Application policy — differs by axis (revised 2026-07-19)

**Axis 1 (representational) — on contact.** The miss is decidable from the configured value
against a finite vocabulary; it surfaces the moment a comparison is written. Whenever a
detector changes or a consumer performs a comparison, ask: *"can the detector represent
every configured value it will be compared against?"* On-contact detection is a real control
here because the failure is greppable.

**Axis 2 (discriminative) — a scoped audit, not on-contact.** TD-146 proves on-contact
detection is *not* a real control for this axis: the defect is invisible to the people
closest to it (see Provenance & Discoverability). Axis-2 failures are silent and per-signal,
so they are found by a **focused audit of the surfaces where a comparison output reaches a
user as a decision** — appType, crawl-strategy selection, identity divergence, triage
verdicts, heal classification — asking one question per surface: *could the same observation
support materially different conclusions?* This is **not** a repository-wide sweep and **not**
purely on-contact; it follows **architectural risk, not implementation breadth**. Parsers,
helpers, and comparisons whose output is not user-visible are out of scope. (Tracked as the
focused axis-2 audit TD; find-only when run.)

## Worked example — TD-142 (SSO observes as authType `none`)
The authType detector's vocabulary is `{ form-login, none }` (password-field presence). An
SSO / redirect-based login page presents no password field, so the detector observes
`none` — cleanly, confidently. Compared against a configured `sso` (or `oauth`) auth flow,
raw comparison would report `divergence-detected` (`none` ≠ `sso`), and a matching config
would report `no-divergence-detected` — both **unearned**: the detector has no way to
observe or represent `sso`, so it cannot competently confirm *or* deny the distinction.
Under ADR-019 the comparison resolves to `inconclusive`, and the CHECKED/NOT-CHECKED
manifest names the vocabulary limitation so coverage is never over-implied. The capability
to actually detect SSO is a separate milestone (TD-144), gated behind its own evaluation
bar — until then, `inconclusive` is the honest state, a declared limitation, not a defect.

## Worked example — TD-146 (baseUrl under-determined by its causes)
The baseUrl signal records a single post-navigation `page.url()` and compares its origin
against the configured origin. When the two differ, the single observation cannot say
*why*: the application's base URL changed, an SSO/auth redirect, a reverse proxy, a
maintenance redirect, geo routing, tenant routing — all produce a different landing origin,
and one `page.url()` cannot separate them. Emitting `divergence-detected` (and a "re-onboard"
remedy) from that observation asserts a conclusion the evidence does not uniquely support.
Under axis 2 the comparison resolves to `inconclusive` whenever the origins differ; only a
**matching** origin uniquely supports a conclusion (`no-divergence-detected`). Making the
baseUrl observation genuinely discriminative — recording the full navigation chain (initial
landing origin, redirect hops, final origin) rather than a single value — is a separate
capability milestone (TD-147), gated behind its own evaluation bar.

## Named candidate surfaces (NOT scheduled work)
Surfaces to check ON CONTACT when next touched — listed to seed the on-contact check, not
to schedule a sweep:

- **appType** — hybrid / micro-frontend applications outside the SPA/MPA vocabulary the
  detector distinguishes.
- **crawl strategy selection** — the strategy the detector can choose vs. the space of
  real application shapes.
- **element classification** — a combobox must not be confidently emitted as `textbox`
  when the classifier's vocabulary lacks `combobox`; absence of the label is not evidence
  of the simpler type.

## Consequences
- Detectors expose their competence as a **predicate** (`canRepresent` for axis 1), never a
  copyable array — the authority rule above.
- Comparison layers gate every comparison **before any equality check** — a miss on either
  axis returns `inconclusive` via the same structural early return (unreachable equality),
  exactly as the null-observation branch does. Axis 1 keys on the configured value; axis 2
  keys on whether the observation uniquely supports the conclusion.
- The `why` distinguishes the causes: probe-could-not-observe vs. cannot-represent (axis 1)
  vs. observation-under-determined (axis 2).
- Reports name the limitation in their coverage manifest; remedies use the "analysis could
  not be completed / known limitation" tier, never imply the configuration was checked and
  found sound, and never instruct an action (e.g. re-onboard) on an inconclusive signal's
  basis.

## Provenance & Discoverability (load-bearing — the reason the audit posture changed)
Axis 2 was found by the **2026-07-18 EOD audit (SWEEP A / A1)** in the very code the original
ADR-019 produced — commits `ad28832` / `1b453c7`. It **survived implementation, diff review,
a clarifying comment, acceptance, and CI**; only the dedicated audit caught it. That
discoverability fact is not incidental — it is *why* the axis-2 posture is a scoped audit
rather than on-contact: **when a defect class is invisible to the people closest to it,
on-contact detection is not a real control.** This belongs in the law, not just the ledger.

## Relationship to other ADRs
- **ADR-015 (Provenance Follows Evidence)** — the sibling. 015: a claim requires evidence.
  019: the evidence must be **evidentially sufficient** — both represent the claim and
  uniquely support it. Read together.
- **ADR-016 (Map the Gap, Prescribe the Remedy)** — an inconclusive result carries a
  machine-readable remedy naming the limitation and the capability follow-up.
- **ADR-017 (What FORGE Observes, FORGE Keeps)** — unrelated to this law; ADR-019 is a new,
  separately-numbered decision and does not modify ADR-017.

## Amendment History
- **2026-07-18** — original: representational competence (axis 1), from TD-142.
- **2026-07-19** — amended: added discriminative competence (axis 2), from TD-146; reframed
  the whole under the unifying principle (evidential sufficiency). Amend, not supersede — no
  ADR-020. Axis-2 audit posture revised from on-contact to a scoped audit on the
  discoverability evidence above.
- **2026-07-19 (TD-148)** — added the observation-context **prerequisite** (domain →
  representation → discrimination) and the observation-only **floor**. No axis 3 — domain is
  a prerequisite, not a parallel category. Result: the identity-divergence comparison was
  **retired** (wrong observation domain for its conclusion), replaced by an observation-only
  login-surface surface that concludes nothing.

## Ratification Note — 2026-08-14 (TD-CONFIG-003)

The evidential-sufficiency principle is ratified from current executable
evidence. Detector ownership remains in the core onboarding boundary; the
identity-divergence comparison was retired when its observation domain could
not support the conclusion, and the replacement login-surface owner records
observations without inferring application identity. Ground-truth and
login-surface tests exercise representational, discriminative, and domain
boundaries, including explicit unknown/inconclusive behavior. The completed
TD-148 audit found no remaining material contradiction in its governed
user-visible detector surfaces. This ratification does not claim that every
future detector is competent; new or changed detectors must prove the same
contract.
