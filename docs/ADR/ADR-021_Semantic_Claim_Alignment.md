<!-- FORGE — Autonomous Quality Engineering
     Copyright (c) 2026 AnvilQ Technologies LLC
     Author: Raj Kasthuri -->

# ADR-021: Semantic Claim Alignment

## Status
Proposed

## Date
2026-07-21

## Principle
> "Every detector output must describe the same property its observations measure. A
> detector may only claim properties directly supported by its observation domain." — Nova

## The distinction — this is the point of the ADR
This is a NEW failure class, not an amendment to ADR-019. Folding it into axis 2 would
lose exactly the distinction that matters:

- **ADR-019 axis 2 — discriminative competence.** The observation is **under-determined**:
  multiple materially different real-world causes produce the *same* value, so the detector
  cannot isolate which one. The evidence is about the right property but **cannot separate
  the competing causes**. *Example: `page.url()` after navigation cannot separate an app
  having moved from an SSO redirect — both yield a different origin.*

- **ADR-021 — semantic claim alignment (this ADR).** The observation is **accurate,
  unambiguous, fully determined, and repeatable** — and the output field claims a property
  in a **DIFFERENT DOMAIN** than the one measured. Not *"the evidence cannot separate
  competing causes"* but *"the evidence is about something else."*

Axis 2 is a limit of the evidence's **resolving power**. This ADR is a mismatch between the
**property measured** and the **property claimed**. A value can be perfectly determined and
still describe the wrong thing.

## Worked example — the whole ADR
`detectAppType`'s marker set `'#root, #app, [ng-version], [data-reactroot]'` observes
**framework mount-point presence**. Its output field claimed **navigation architecture**
(`'spa'`).

Direct evidence (Playwright, 2026-07-21):
- SauceDemo genuinely contains `<div id="root">`. The selector resolved and returned its
  `outerHTML` (the real login page: `Swag Labs`, the login form inside `#root`). Both
  `page.locator().count()` and `page.evaluate(querySelectorAll).length` agree it is **1**.
- Main frame, correct URL (`https://www.saucedemo.com/`), present at `domcontentloaded`, no
  JS wait needed — **no timing artifact, no frame confusion**.
- SauceDemo is **React-rendered AND full-page-reloads on login** — a document request to
  `inventory.html`, confirmed by human inspection of the network panel.

**The count was right. The claim was wrong.** `#root` truthfully reports that a client
framework mounts here; it says nothing about how the app navigates. **Client-side RENDERING
does not imply client-side ROUTING.** The detector measured rendering and claimed routing.

This is not a counting failure (the count is accurate) and not an axis-2 failure (the
observation is unambiguous — `#root` is present, full stop). It is a claim about a property
the observation does not measure.

## Risk — keep this class NARROWLY defined
Standing guidance (Nova): this class is precisely *"a detector emitted a claim about a
property different from the one its observations measure."* It **must not** become a
catch-all bucket for *"the detector did something we dislike."* If the observation genuinely
measures the claimed property but cannot resolve competing causes, that is **ADR-019**, not
this. If the observation lacks provenance, that is **ADR-015**. If the grade exceeds the
evidence, that is **ADR-020**. This ADR applies only when the measured domain and the claimed
domain are **different domains**.

## Second rule (same ADR) — evidence presentation
> "Evidence must make its measurement identity obvious, not merely visible. Metrics from
> different measurement domains must not be presented as though they are comparable
> measurements. A metric name must carry its measurement definition." — Nova

**Worked example, recorded honestly as OUR error.** ADR-020's provenance `reason` strings
printed, for the same page, `appType.links=376` and `crawlStrategy.realLinks=0`. As adjacent
bare integers they read as a contradiction, produced a confidently-wrong diagnosis (a single
shared "counting-failure" class), reclassified two TDs, and drove an investigation — until
direct Playwright evidence falsified it. **Both numbers were correct and were never measuring
the same property:** `links` is a *raw anchor count* (376 `a[href]`); `realLinks` is a
*same-origin navigable-link count* (375 of the 376 anchors are cross-origin language editions,
1 is a hash link → 0). Two different measurements, presented as if comparable.

The lesson is **not** "print less" — the provenance strings are what made these findings
possible at all (ADR-020 §6 stands). The lesson is **make incompatible measurements visibly
incompatible.** A metric label must state its definition:

- `rawDomAnchorCount`, not `links`
- `sameOriginNavigableLinkCount`, not `realLinks`

A reader (or a future detector) comparing `rawDomAnchorCount` against
`sameOriginNavigableLinkCount` cannot mistake them for the same measurement. Names carry the
definition so the incompatibility is legible without opening the code.

## Relationship to its siblings — a new decision, not an amendment
Four laws now govern a claim; each is a different question, and they are siblings:
- **ADR-015 — provenance.** Does the claim have evidence at all?
- **ADR-019 — sufficiency.** Can the evidence express and *uniquely support* the claim?
- **ADR-020 — grade.** How *strongly* may the claim be held?
- **ADR-021 — alignment (this ADR).** Is the claim about the property that was actually
  **measured**?

A value can satisfy 015 (has evidence), 019 (unambiguous), and 020 (honestly graded) and
still violate 021 — a perfectly-determined, well-graded measurement of the *wrong property*.
`spaDom=1 → 'spa'` is exactly that: evidenced, unambiguous, and it was even graded honestly
at `medium`/`evidence-matched` — and it claimed routing from a rendering observation.

## Provenance of this ADR — recorded honestly
Found 2026-07-21 by Raj's manual DOM inspection during ground-truth-fixture authoring, then
established by direct Playwright resolution of the selectors (the counts reproduced exactly,
and were both accurate). **Aiden's initial diagnosis — that TD-162 and TD-163 were one shared
counting-failure class — was WRONG, and was falsified by the investigation** it prompted: the
`#root` count is correct (SauceDemo really has it) and the `realLinks=0` count is correct
(the portal's links are cross-origin). Recording the wrong turn is the point: the confident
mis-diagnosis was itself produced by the presentation defect this ADR's second rule addresses.

## Consequences
- `detectAppType` claims navigation architecture from a rendering observation (TD-163). Under
  this ADR that is a semantic-alignment defect, remediated separately (scoped refactor: emit
  what is observed — framework-rendered vs static-html — not what is inferred).
- The `signals?` metric key set (documented as a fixture-facing contract in the previous
  commit) will rename to definition-carrying names; cheap now because no fixture is filled yet.
- TD-162 is CLOSED, works-as-designed: `realLinks` is *defined* as same-origin different-path;
  0 on a cross-origin portal is accurate. This establishes FORGE's crawler as a **same-origin
  application crawler**, not a general web crawler — cross-origin portal crawling is a future
  capability decision, not a detector correction.

## Implementation note — 2026-07-21 (TD-163 remediation, Commit 2 of 3)
`detectAppType` → `detectRenderingModel`: it emits the OBSERVED rendering
(`framework-rendered` / `static-rendered` — the `static-rendered` floor was RETIRED 2026-07-23,
see the TD-173 note below), never a navigation claim. The `appType` field
collapses to `'web-ui'` — the PLATFORM discriminator only — and `spa`/`mpa` are removed from
the schema enum. A new optional `renderingModel` field carries the rendering observation.

**Migrator legacy-vocab map — Raj's ruling (2026-07-21): `spa → unknown`, `mpa → unknown`.**
A stored `appType` value has two possible origins — detector-produced (a marker was observed)
or hand-authored config (a human's navigation claim). The migrator cannot distinguish them.
Mapping `'spa'` to a rendering value (`framework-rendered`) would MANUFACTURE an observation
from an unattributable claim — **ADR-021 applied in reverse**. Both legs therefore map to
`renderingModel: 'unknown'`; a fresh crawl observes rendering directly. The value was never
load-bearing. (`ModelMigrator.mapLegacyAppType`.)

The `FlowDetector.ts` `isSpa` heuristic (platform value + page count → navigation architecture)
is the SAME overclaim one layer down; it is left UNCHANGED under a marker comment pending its
own design conversation — **TD-170**.

## Correction — 2026-07-21 (worked-example navigation claim falsified; the rule stands)
The worked example above states SauceDemo "is **React-rendered AND full-page-reloads on login**
— a document request to `inventory.html`, confirmed by human inspection of the network panel."
**The first half is verified true; the second half is FALSE.**

Direct observation (Raj, 2026-07-21, clean-run method — fresh incognito, Network panel,
Preserve-log ON, Doc filter, the login as the ONLY action): the whole session produced **exactly
one document row** (`www.saucedemo.com`, 200). The login fetched **no document** — the view
changed and the URL became `/inventory.html` with no document request. **SauceDemo login is a
client-side transition, not a full page load.** The `404 → /inventory.html` sequence that earlier
looked like a reload is the static host's SPA-fallback, which fires only on a COLD load of a deep
URL (a manual refresh), never on the login click — a preserved log conflated the two. This
corroborates `docs/architecture/spikes/spike-q1-pushstate-vs-navigation.txt` Case A, whose
`Page.navigatedWithinDocument`-with-no-load reading was correct (not the false positive it was
earlier called).

Consequences for this ADR:
- **The RULE is UNAFFECTED.** "Client-side rendering does not imply client-side routing" stands
  exactly as decided; nothing in the finding touches it.
- **The worked example is a weaker illustration than presented.** SauceDemo is framework-rendered
  AND client-routed, so it is NOT the rendering-without-routing counter-example the example claims.
  On this app the retired detector's `'spa'` output was **accidentally correct** — invalid
  reasoning (a rendering marker asserting routing) that happened to land on the right answer.
- **The TD-163 refactor REMAINS CORRECT.** The navigation claim was retired for **lack of
  evidence**, not for being wrong. A guess that lands is not evidence; a detector that reaches the
  right answer by measuring the wrong property is still measuring the wrong property. Retiring the
  claim was right regardless of what SauceDemo turned out to be.
- The example's navigation claim was **never verified at decision time** — the network-panel line
  asserted a reload that a clean-run observation has now falsified. Tracked as **TD-175**. The
  original decision text above is preserved as dated history.

## Implementation note — 2026-07-23 (TD-173: `static-rendered` retired; the rendering absence-floor is `unknown`)
The 2026-07-21 implementation note above states `detectRenderingModel` emits `framework-rendered`
/ `static-rendered`. **`static-rendered` is now RETIRED (TD-173, `7e2783f`).** It was a FALSE
FLOOR: absence of a framework marker is not evidence of static rendering — an unhydrated framework
app reads identically (the ADR-020 §2 asymmetry). The detector now emits `framework-rendered` or
**`unknown`** (no marker observed after a delayed sample). `'static-rendered'` had no producer once
the false floor was removed, so it was removed from the schema enum
(`models/schema/app-model.schema.json` → `["framework-rendered", "unknown"]`), and `ModelMigrator`
normalizes any stored `'static-rendered'` → `'unknown'` (a fresh crawl re-observes rendering). The
ADR's RULE — rendering is OBSERVED, not inferred; a metric names what it measures — is UNAFFECTED;
only the floor vocabulary changed. Original 2026-07-21 note preserved as dated history; this note is
the forward-pointer. Related: TD-173, ADR-020 §2 (the absence-of-evidence asymmetry) + its own
2026-07-23 dated note (the sibling authType absence-floor change, same day).

## Related
ADR-015 (provenance — sibling), ADR-019 (sufficiency — sibling), ADR-020 (grade — sibling).
TD-163 (the detectAppType rendering-vs-routing overclaim this governs), TD-162 (closed WAD —
the same-origin `realLinks` definition), the ground-truth-fixture work that surfaced both.
TD-175 (this correction — the worked example's navigation claim, falsified by direct observation).

## Status Audit Note — 2026-08-14 (TD-CONFIG-003)

This ADR remains **Proposed**. The `detectAppType` to
`detectRenderingModel` correction is implemented and tested, and current
canonical route evidence names the route property it actually measures. The ADR
itself records the remaining `FlowDetector.isSpa` routing inference as TD-170.
Because that producer still claims navigation architecture from insufficiently
aligned inputs, the repository contains a material contradiction to the broad
principle and ratification would be premature.
