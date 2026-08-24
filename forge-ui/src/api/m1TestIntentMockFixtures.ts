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

import type {
  DiscoveredAppArea,
  M1RefusalCode,
  NormalizedTestIntentV1,
  RefusedNormalizedTestIntentV1,
  SupportedNormalizedTestIntentV1,
} from './m1TestIntentContract'

const HASH = 'a'.repeat(64)

function supportedIntent(projectId: string, appArea = 'Cart'): SupportedNormalizedTestIntentV1 {
  const billing = appArea === 'Billing'
  const sourceSubjectId = billing ? 'subject-billing' : 'subject-cart'
  const targetSubjectId = billing ? 'subject-invoice-detail' : 'subject-checkout-step-one'
  const routePath = billing ? '/billing' : '/cart.html'
  const targetRoute = billing ? '/invoice-detail' : '/checkout-step-one.html'
  const dataTestValue = billing ? 'open-invoice' : 'checkout'
  return {
    schemaVersion: 'forge-normalized-test-intent/v1',
    intentId: `intent-${projectId}-${appArea.toLowerCase()}`,
    projectId,
    source: 'discovered',
    appArea: { id: appArea, sourceSubjectId, confidence: 'high', method: 'rule', evidenceIds: ['evidence-flow', 'evidence-target'] },
    title: billing ? 'Open an observed invoice' : 'Continue from Cart to checkout',
    objective: billing
      ? 'Verify that the observed invoice control reaches the observed invoice detail subject.'
      : 'Verify that the observed checkout element reaches the first checkout subject.',
    preconditions: [{ kind: 'authenticated_role', roleId: 'shopper', mechanism: 'form-login' }],
    steps: [
      { stepId: 'step-navigate', ordinal: 0, kind: 'navigate_to_observed_route', subjectId: sourceSubjectId, routePath },
      { stepId: 'step-click', ordinal: 1, kind: 'click_observed_data_test', subjectId: sourceSubjectId, elementId: `element-${dataTestValue}`, dataTestValue, targetSubjectId },
    ],
    expectedOutcomes: [{ outcomeId: 'outcome-subject', kind: 'subject_observable', subjectId: targetSubjectId, routePath: targetRoute }],
    grounding: {
      modelRowId: 7,
      modelVersion: '1.0.0',
      observationRunId: 'observation-run-1',
      supportSealHash: HASH,
      sourceFlowId: `flow-${appArea.toLowerCase()}`,
      selectedFlowStepIndexes: [1],
      excludedFlowStepIndexes: [2],
      subjectSupport: [
        { canonicalSubjectId: sourceSubjectId, supportingObservationIds: ['observation-source'], supportingGapIds: [] },
        { canonicalSubjectId: targetSubjectId, supportingObservationIds: ['observation-target'], supportingGapIds: [] },
      ],
    },
    evidenceAssessment: {
      state: 'sufficient',
      sourceFlowConfidence: 'observed',
      selectedStepGrounding: 'observed',
      limitations: ['A later payment step was excluded from this bounded M1 intent.', 'Execution eligibility remains subject to canonical Run preflight.'],
    },
    disposition: { state: 'supported' },
  }
}

function refusedIntent(projectId: string, appArea: string, code: M1RefusalCode, safeMessage: string, state: 'insufficient' | 'ambiguous' | 'unsupported'): RefusedNormalizedTestIntentV1 {
  return {
    schemaVersion: 'forge-normalized-test-intent/v1',
    intentId: `intent-${projectId}-refused-${code}`,
    projectId,
    source: 'discovered',
    appArea: null,
    title: `Unable to generate ${appArea} test`,
    objective: 'Generate a supported observed-flow test.',
    preconditions: [],
    steps: [],
    expectedOutcomes: [],
    grounding: { sourceFlowId: `flow-${appArea.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, selectedFlowStepIndexes: [] },
    evidenceAssessment: { state, limitations: [safeMessage] },
    disposition: { state: 'refused', code, safeMessage },
  }
}

export function m1MockGeneration(projectId: string, appArea: string): NormalizedTestIntentV1 {
  if (appArea === 'Cart' || appArea === 'Billing') return supportedIntent(projectId, appArea)
  if (appArea === 'Reports') return refusedIntent(projectId, appArea, 'insufficient_evidence', 'The selected flow subjects do not have exact sealed canonical support.', 'insufficient')
  if (appArea === 'Administration') return refusedIntent(projectId, appArea, 'ambiguous_evidence', 'The selected App Model flow identity is not unique.', 'ambiguous')
  if (appArea === 'Advanced-search') return refusedIntent(projectId, appArea, 'unsupported_semantics', 'The selected flow segment contains semantics outside the bounded M1 action set.', 'unsupported')
  return refusedIntent(projectId, appArea, 'app_area_unknown', 'The selected source subject has no persisted canonical App Model classification.', 'insufficient')
}

export function m1MockAreas(projectId: string): readonly DiscoveredAppArea[] {
  const available = (appArea: string, sourceSubjectId: string, observedRoute: string, evidenceSummary: string, confidence: 'high' | 'medium' | 'unknown'): DiscoveredAppArea => ({ appArea, sourceSubjectId, observedRoute, evidenceSummary, confidence, availability: 'available', refusal: null })
  return Object.freeze([
    available('Cart', 'subject-cart', '/cart.html', 'Cart module, checkout element, and checkout destination were observed in one persisted flow.', 'high'),
    available('Reports', 'subject-reports', '/reports', 'A Reports route was observed, but no supported interaction target was grounded.', 'unknown'),
    available('Administration', 'subject-admin', '/admin', 'Conflicting observations associate the same control with different destinations.', 'unknown'),
    available('Advanced-search', 'subject-search', '/search', 'Observed behavior requires semantics outside the frozen M1 executable scope.', 'medium'),
    { appArea: null, sourceSubjectId: 'subject-legacy', observedRoute: '/legacy', evidenceSummary: 'The observed page has no persisted PageDefinition.module value.', confidence: 'unknown', availability: 'app_area_unknown', refusal: refusedIntent(projectId, 'unknown', 'app_area_unknown', 'The selected source subject has no persisted canonical App Model classification.', 'insufficient') },
    available('Billing', 'subject-billing', '/billing', 'Billing has a supported observed flow; this fixture exercises a bounded save failure.', 'high'),
  ])
}
