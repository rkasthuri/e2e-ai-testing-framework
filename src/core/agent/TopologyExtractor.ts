/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or modification
 * of this software is strictly prohibited.
 */

/**
 * TD-013 Phase 3 (Block 2b) — CrawlTopology producers.
 *
 * topologyFromAppModel: the MODEL-BASED producer. Reads a PERSISTED AppModel — its
 * pages[] for selectors and its flows[].steps[] for transitions — and projects them into
 * the decoupled CrawlTopology the recipe-writer (2c) consumes. StateGraph is NOT persisted
 * on AppModel (it is an in-memory crawl intermediate discarded after FlowDetector derives
 * flows), so the persisted, grounded, element-resolved transition record IS the FlowStep.
 *
 * HONESTY GUARD: grounding is COPIED 1:1 from FlowStep. This extractor NEVER recomputes or
 * upgrades it. A FlowStep with no grounding (legacy/undefined) becomes 'inferred', never
 * 'observed' — zero/absent evidence is never promoted to the stronger claim.
 */

import { AppModel, ElementDefinition, FlowStep } from '../onboarding/types'
import { strategyToSelector } from '../onboarding/generators/EmitHelper'
import { PageSignals } from './GoalSynthesizer'
import {
  CrawlTopology,
  CrawlTopologyElement,
  CrawlTopologyPage,
  CrawlTopologyTransition,
  TopologyFlow,
} from './CrawlTopology'

/** Project one ElementDefinition, resolving its selector via the canonical exported
 *  builder (EmitHelper.strategyToSelector — the same one FixtureGenerator/PomGenerator
 *  use). null when the element carries no strategy; a selector is never fabricated. */
function projectElement(el: ElementDefinition): CrawlTopologyElement {
  const best = el.strategies[0]
  return {
    id:            el.id,
    name:          el.name,
    kind:          el.kind,
    selector:      best ? strategyToSelector(best.type, best.value, best.accessibleName) : null,
    href:          el.href,
    observedState: el.observedState,
  }
}

/** Project one FlowStep into a transition. grounding is a STRICT 1:1 copy — undefined
 *  collapses to 'inferred', and 'observed' is never minted here. */
function projectTransition(step: FlowStep): CrawlTopologyTransition {
  return {
    fromPageId: step.pageId,
    toPageId:   step.targetPageId,
    elementId:  step.elementId,
    action:     step.action,
    value:      step.value,
    grounding:  step.grounding ?? 'inferred',
  }
}

export function topologyFromAppModel(model: AppModel): CrawlTopology {
  const pages: CrawlTopologyPage[] = (model.pages ?? []).map(p => ({
    id:          p.id,
    urlPattern:  p.urlPattern,
    displayName: p.displayName,
    isAuthPage:  p.isAuthPage,
    elements:    p.elements.map(projectElement),
    // Project recorded PagePrerequisite steps as transitions (grounding inherited 1:1 via
    // projectTransition, unchanged). Absent → [], never fabricated.
    prerequisites: (p.prerequisites ?? []).map(pre => ({
      roleId: pre.roleId,
      steps:  pre.steps.map(projectTransition),
    })),
  }))

  // Flatten steps into the flat transitions[] while recording each flow's identity and
  // step order in flows[] (Fork 1a — grouping restored OVER the flat list). The flat array
  // is order-identical to Block 2b; flows[] merely indexes into it. projectTransition is
  // untouched here, so the STRICT 1:1 grounding inheritance is provably undisturbed.
  const transitions: CrawlTopologyTransition[] = []
  const flows: TopologyFlow[] = []
  for (const flow of (model.flows ?? [])) {
    const orderedTransitionIndices: number[] = []
    for (const step of flow.steps) {
      orderedTransitionIndices.push(transitions.length)
      transitions.push(projectTransition(step))
    }
    flows.push({
      id:          flow.id,
      displayName: flow.displayName,
      orderedTransitionIndices,
      roleId:      flow.roleId,
    })
  }

  return {
    appName: model.app.name,
    baseUrl: model.app.baseUrl,
    appType: model.app.appType,
    pages,
    transitions,
    flows,
    source: 'app-model',
  }
}

/**
 * TD-013 Phase 3 (Block 2b) — the bootstrap convergence (the 1a promise): a single live
 * page's PageSignals expressed AS a CrawlTopology (1 page, 0 transitions, source
 * 'live-page'). This proves the type CAN represent bootstrap.
 *
 * TODO(2c): PageSignals is DOM-SIGNAL level, not model level — it carries no element ids
 * or strategies, so `elements` stays [] here. The full element/transition projection for
 * the live path lands in 2c when the synthesizer is reworked to consume CrawlTopology.
 * appName/appType are unknown pre-crawl and left empty (never fabricated).
 */
export function topologyFromPageSignals(signals: PageSignals): CrawlTopology {
  return {
    appName: '',
    baseUrl: signals.currentUrl,
    appType: '',
    pages: [{
      id:          signals.currentUrl,
      urlPattern:  signals.currentUrl,
      displayName: signals.pageTitle,
      isAuthPage:  false,   // pre-crawl bootstrap cannot classify this; false, not fabricated
      elements:    [],      // TODO(2c): PageSignals lacks element ids/strategies
      prerequisites: [],    // bootstrap records no page prerequisites
    }],
    transitions: [],        // degenerate: single page, no observed transitions
    flows: [],              // no flows in a single-page bootstrap topology
    source: 'live-page',
  }
}
