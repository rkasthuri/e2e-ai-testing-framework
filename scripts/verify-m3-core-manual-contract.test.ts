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

import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AppModel } from '../src/core/onboarding/types'
import {
  parseManualAnalysisResultV1,
  parseManualAutomationProposalV1,
  parseManualPromotionRequestV1,
  parseManualPromotionResultV1,
} from '../src/core/test-design/ManualAutomationProposalContract'
import {
  manualSourceContentHash,
  materializeManualTestSourceV1,
  parseManualTestSourceInputV1,
  parseManualTestSourceV1,
  type ManualTestSourceInputV1,
} from '../src/core/test-design/ManualTestSourceContract'
import {
  analyzeManualTestSourceV1,
  ManualTestIngestionService,
  ManualTestPromotionError,
  type ManualAnalysisEvidenceV1,
} from '../src/core/test-design/ManualTestIngestionService'
import { TestDefinitionContractError } from '../src/core/test-design/TestDefinitionContract'
import {
  generateCanonicalManualFlowTestSetV3,
  parseCanonicalTestSetV3,
} from '../src/core/test-design/TestDefinitionContract'
import { materializeSupportedNormalizedTestIntentV1 } from '../src/core/test-design/NormalizedTestIntentContract'

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'm3-contract')
const HASH = 'a'.repeat(64)
const PROJECT = 'project-storefront'

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))
}

function input(overrides: Partial<ManualTestSourceInputV1> = {}): ManualTestSourceInputV1 {
  return {
    schemaVersion: 'forge-manual-test-source-input/v1',
    sourceKind: 'manual',
    title: 'Checkout from cart',
    objective: 'Proceed from cart to checkout.',
    steps: [
      { ordinal: 1, text: 'Open the cart page.' },
      { ordinal: 2, text: 'Click the Checkout button.' },
    ],
    expectedOutcome: 'Checkout information page is displayed.',
    ...overrides,
  }
}

function source(overrides: Partial<ManualTestSourceInputV1> = {}) {
  return materializeManualTestSourceV1(PROJECT, 'manual-source-test', input(overrides)).value
}

function evidence(mutator?: (model: AppModel) => void): ManualAnalysisEvidenceV1 {
  const model = {
    schemaVersion: '1', generatedAt: '2026-08-26T00:00:00.000Z', generatedBy: 'engine',
    app: {
      name: PROJECT, displayName: 'Storefront', baseUrl: 'https://example.invalid', appType: 'web',
      modelVersion: 'app-model-v7', spaConfig: null, evidenceState: 'crawled', crawlMetadata: null,
    },
    roles: [{
      id: 'shopper', displayName: 'Shopper', authFlow: 'form-login', credentialsEnvKey: null,
      storageStatePath: null, reachablePageIds: ['subject-cart', 'subject-checkout-step-one'],
      restrictedPageIds: [], authOutcome: 'succeeded',
    }],
    pages: [{
      id: 'subject-cart', displayName: 'cart', urlPattern: '/cart.html', urlPatternType: 'exact',
      fingerprint: HASH, fingerprintBasis: 'url-only', appType: 'web', accessibleByRoles: ['shopper'],
      isAuthPage: false,
      module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-cart'] },
      elements: [{
        id: 'subject-checkout-control', name: 'Checkout', kind: 'button', label: 'Checkout',
        critical: true, aiNamed: false, strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }],
        tier3Assertions: [], cardinality: { kind: 'single' }, observedState: 'visible',
      }],
    }, {
      id: 'subject-checkout-step-one', displayName: 'Checkout information',
      urlPattern: '/checkout-step-one.html', urlPatternType: 'exact', fingerprint: HASH,
      fingerprintBasis: 'url-only', appType: 'web', accessibleByRoles: ['shopper'], isAuthPage: false,
      elements: [], module: { name: 'checkout', confidence: 'high', method: 'rule', evidenceIds: ['subject-checkout-step-one'] },
    }],
    flows: [{
      id: 'flow-cart-checkout', displayName: 'Cart checkout', confidence: 'observed', source: 'inferred',
      roleId: 'shopper', linkedApiEndpointIds: [], steps: [{
        stepIndex: 7, pageId: 'subject-cart', action: 'click', elementId: 'subject-checkout-control',
        targetPageId: 'subject-checkout-step-one', value: null, grounding: 'observed',
      }],
    }],
    endpoints: null, api: null, diff: null,
  } as unknown as AppModel
  mutator?.(model)
  return {
    model,
    authority: {
      schemaVersion: 'forge-test-definition-authority/v2', authorityClass: 'canonical_v2', projectId: PROJECT,
      modelRowId: 42, modelVersion: 'app-model-v7', observationRunId: 'observation-run-7',
      supportSealHash: 'c'.repeat(64), characterizationPolicy: { id: 'forge.policy', version: '1' },
      supportingObservationIds: ['obs-cart-route', 'obs-checkout-control', 'obs-checkout-subject'],
      supportingGapIds: [], subjectSupport: [
        { canonicalSubjectId: 'subject-cart', supportingObservationIds: ['obs-cart-route', 'obs-checkout-control'], supportingGapIds: [] },
        { canonicalSubjectId: 'subject-checkout-step-one', supportingObservationIds: ['obs-checkout-subject'], supportingGapIds: [] },
      ],
    },
    routeEvidence: {
      schemaVersion: 'forge-canonical-route-evidence/v1', projectId: PROJECT, modelRowId: 42,
      supportSealHash: 'c'.repeat(64), normalizationPolicy: { id: 'forge.route', version: '1' },
      subjects: [
        { canonicalSubjectId: 'subject-cart', normalizedPath: '/cart.html', supportingObservationIds: ['obs-cart-route'] },
        { canonicalSubjectId: 'subject-checkout-step-one', normalizedPath: '/checkout-step-one.html', supportingObservationIds: ['obs-checkout-subject'] },
      ], identityHash: 'd'.repeat(64),
    },
    authenticationExpectation: {
      schemaVersion: 'forge-authentication-expectation/v1', state: 'required', mechanism: 'form-login',
      bases: [{ kind: 'declared_configuration', policyId: 'forge.auth', policyVersion: '1', configurationDigest: 'f'.repeat(64), mechanism: 'form-login' }],
      identityHash: 'e'.repeat(64),
    },
  }
}

test('Core parsers consume the same seven physical shared fixtures without recomputing opaque example authority', () => {
  parseManualTestSourceV1(fixture('positive-manual-source.json'), false)
  parseManualAutomationProposalV1(fixture('positive-automation-proposal.json'), false)
  parseManualPromotionResultV1(fixture('positive-save-result.json'))
  for (const name of ['unsupported-fill.json', 'ambiguous-control.json', 'insufficient-outcome.json', 'app-area-unknown.json']) {
    parseManualAnalysisResultV1(fixture(name))
  }
})

function promotionResult(): any {
  return fixture('positive-save-result.json')
}

test('promotion result rejects the pre-fix shallow-parser hole: an extra nested source-authority key', () => {
  const result = promotionResult()
  result.sourceAuthority.unexpected = 'accepted-before-core-c'
  assert.throws(() => parseManualPromotionResultV1(result))
})

test('promotion result rejects extra proposal-authority keys and malformed reviewed proposal authority', () => {
  const extra = promotionResult()
  extra.proposalAuthority.unexpected = true
  assert.throws(() => parseManualPromotionResultV1(extra))

  const malformedId = promotionResult()
  malformedId.proposalAuthority.proposalId = 'unsafe proposal id'
  assert.throws(() => parseManualPromotionResultV1(malformedId))

  const malformedHash = promotionResult()
  malformedHash.proposalAuthority.proposalContentHash = 'A'.repeat(64)
  assert.throws(() => parseManualPromotionResultV1(malformedHash))
})

test('promotion result rejects extra Definition authority keys and the wrong v3 discriminator', () => {
  const extra = promotionResult()
  extra.definitionAuthority.unexpected = null
  assert.throws(() => parseManualPromotionResultV1(extra))

  const wrongVersion = promotionResult()
  wrongVersion.definitionAuthority.definitionSchemaVersion = 2
  assert.throws(() => parseManualPromotionResultV1(wrongVersion))
})

test('promotion result rejects malformed Definition and Test Set opaque identities and hashes', () => {
  for (const mutate of [
    (result: any) => { result.definitionAuthority.definitionId = '' },
    (result: any) => { result.definitionAuthority.testSetId = 'unsafe test set id' },
    (result: any) => { result.definitionAuthority.testSetContentHash = 'f'.repeat(63) },
    (result: any) => { result.sourceAuthority.sourceId = '.unsafe-leading-character' },
    (result: any) => { result.sourceAuthority.sourceContentHash = null },
  ]) {
    const result = promotionResult()
    mutate(result)
    assert.throws(() => parseManualPromotionResultV1(result))
  }
})

test('promotion result rejects missing nested authority fields', () => {
  for (const mutate of [
    (result: any) => { delete result.sourceAuthority.sourceId },
    (result: any) => { delete result.proposalAuthority.proposalContentHash },
    (result: any) => { delete result.definitionAuthority.testSetContentHash },
  ]) {
    const result = promotionResult()
    mutate(result)
    assert.throws(() => parseManualPromotionResultV1(result))
  }
})

test('promotion result rejects wrong nested object/nullability shapes', () => {
  for (const field of ['sourceAuthority', 'proposalAuthority', 'definitionAuthority']) {
    for (const malformed of [null, [], 'authority']) {
      const result = promotionResult()
      result[field] = malformed
      assert.throws(() => parseManualPromotionResultV1(result))
    }
  }
})

test('promotion result requires a positive safe-integer Test Set revision', () => {
  for (const revision of [null, '8', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = promotionResult()
    result.definitionAuthority.testSetRevision = revision
    assert.throws(() => parseManualPromotionResultV1(result))
  }
})

test('promotion result keeps rejecting top-level hostile shapes', () => {
  for (const result of [
    null,
    [],
    { ...promotionResult(), unexpected: true },
    { ...promotionResult(), schemaVersion: 'forge-manual-promotion-result/v2' },
    { ...promotionResult(), outcome: 'refused' },
    (() => { const value = promotionResult(); delete value.definitionAuthority; return value })(),
  ]) assert.throws(() => parseManualPromotionResultV1(result))
})

test('source hash uses constructed semantic material: caller key order is irrelevant and authored semantics are exact', () => {
  const normal = input()
  const reordered = {
    expectedOutcome: normal.expectedOutcome, steps: normal.steps, objective: normal.objective,
    title: normal.title, sourceKind: normal.sourceKind, schemaVersion: normal.schemaVersion,
  }
  const parsed = parseManualTestSourceInputV1(reordered)
  assert.equal(manualSourceContentHash(PROJECT, normal), manualSourceContentHash(PROJECT, parsed))
  for (const changed of [
    input({ title: `${normal.title} ` }), input({ expectedOutcome: `${normal.expectedOutcome} ` }),
    input({ steps: [{ ordinal: 1, text: normal.steps[1].text }, { ordinal: 2, text: normal.steps[0].text }] }),
  ]) assert.notEqual(manualSourceContentHash(PROJECT, normal), manualSourceContentHash(PROJECT, changed))
  assert.throws(() => parseManualTestSourceInputV1(input({ steps: [{ ordinal: 1, text: 'a' }, { ordinal: 1, text: 'b' }] })))
  assert.throws(() => parseManualTestSourceInputV1(input({ steps: [{ ordinal: 2, text: 'a' }] })))
})

test('bounded positive grounding preserves navigation null index, observed click index, oracle, app area, and manual source', () => {
  const current = evidence()
  const observedFlow = current.model.flows![0]
  assert.equal(observedFlow.steps.findIndex(step => step.elementId === 'subject-checkout-control'), 0)
  assert.equal(observedFlow.steps[0].stepIndex, 7)
  const result = analyzeManualTestSourceV1(source(), current)
  assert.equal(result.outcome.kind, 'proposal')
  if (result.outcome.kind !== 'proposal') return
  const proposal = result.outcome.proposal
  assert.equal(proposal.normalizedIntent.source, 'manual')
  assert.deepEqual(proposal.canonicalActions.map(action => [action.ordinal, action.kind]), [
    [0, 'navigate_to_observed_route'], [1, 'click_observed_data_test'],
  ])
  assert.equal(proposal.sourceGrounding[0].basis.flowStepIndex, null)
  assert.equal(proposal.sourceGrounding[1].basis.flowStepIndex, 7)
  assert.equal(proposal.sourceGrounding[2].basis.flowStepIndex, null)
  assert.deepEqual(proposal.normalizedIntent.grounding.selectedFlowStepIndexes, [7])
  assert.deepEqual(proposal.normalizedIntent.grounding.excludedFlowStepIndexes, [])
  assert.equal(proposal.oracle.kind, 'subject_observable')
  assert.equal(proposal.oracle.explanation, 'The governed target subject is observable at the expected checkout route.')
  assert.equal(proposal.appArea.id, 'checkout')
})

test('differently named eligible controls sharing the authored control data-test refuse without partial authority', () => {
  const current = evidence(model => {
    model.pages![0].elements[0].strategies[0].value = 'continue'
    model.pages![0].elements.push({
      ...model.pages![0].elements[0],
      id: 'subject-continue-control',
      name: 'Continue',
      label: 'Continue',
    })
  })
  const result = analyzeManualTestSourceV1(source(), current)
  assert.equal(result.outcome.kind, 'refusal')
  if (result.outcome.kind !== 'refusal') return
  assert.equal(result.outcome.refusal.code, 'ambiguous_evidence')
  assert.ok(result.outcome.refusal.sourceGrounding.every(item => item.canonicalBinding === null))
  assert.equal('proposal' in result.outcome, false)
})

test('duplicate data-test on a canonically ineligible attached control does not defeat eligible uniqueness', () => {
  const current = evidence(model => {
    model.pages![0].elements[0].strategies[0].value = 'continue'
    model.pages![0].elements.push({
      ...model.pages![0].elements[0],
      id: 'subject-hidden-continue-control',
      name: 'Continue',
      label: 'Continue',
      observedState: 'attached',
    })
  })
  const result = analyzeManualTestSourceV1(source(), current)
  assert.equal(result.outcome.kind, 'proposal')
  if (result.outcome.kind !== 'proposal') return
  assert.equal(result.outcome.proposal.canonicalActions[1].kind, 'click_observed_data_test')
  assert.equal(result.outcome.proposal.canonicalActions[1].dataTestValue, 'continue')
})

test('canonically ineligible same-semantic controls do not create semantic or selector ambiguity', () => {
  for (const [label, ineligible] of [
    ['non-visible', { observedState: 'attached' as const }],
    ['non-single-cardinality', { cardinality: { kind: 'repeated' as const, index: 0 } }],
  ] as const) {
    const current = evidence(model => {
      model.pages![0].elements.push({
        ...model.pages![0].elements[0],
        id: `subject-${label}-checkout-control`,
        ...ineligible,
      })
    })
    const result = analyzeManualTestSourceV1(source(), current)
    assert.equal(result.outcome.kind, 'proposal', label)
    if (result.outcome.kind !== 'proposal') continue
    assert.equal(result.outcome.proposal.canonicalActions[1].kind, 'click_observed_data_test', label)
    assert.equal(result.outcome.proposal.canonicalActions[1].dataTestValue, 'checkout', label)
  }
})

test('two eligible same-semantic controls refuse as ambiguous evidence', () => {
  const current = evidence(model => {
    model.pages![0].elements.push({
      ...model.pages![0].elements[0],
      id: 'subject-second-checkout-control',
      strategies: [{ type: 'data-test', value: 'checkout-secondary', confidence: 1 }],
    })
  })
  const result = analyzeManualTestSourceV1(source(), current)
  assert.equal(result.outcome.kind, 'refusal')
  if (result.outcome.kind !== 'refusal') return
  assert.equal(result.outcome.refusal.code, 'ambiguous_evidence')
  assert.ok(result.outcome.refusal.sourceGrounding.every(item => item.canonicalBinding === null))
  assert.equal('proposal' in result.outcome, false)
})

test('one intended eligible control with one unique supported data-test remains promotable', () => {
  const result = analyzeManualTestSourceV1(source(), evidence())
  assert.equal(result.outcome.kind, 'proposal')
})

test('an intended control with no supported data-test refuses as unsupported semantics', () => {
  const result = analyzeManualTestSourceV1(source(), evidence(model => { model.pages![0].elements[0].strategies = [] }))
  assert.equal(result.outcome.kind, 'refusal')
  if (result.outcome.kind === 'refusal') assert.equal(result.outcome.refusal.code, 'unsupported_semantics')
})

test('an intended control with multiple supported executable data-tests refuses as ambiguous evidence', () => {
  const result = analyzeManualTestSourceV1(source(), evidence(model => {
    model.pages![0].elements[0].strategies.push({ type: 'data-test', value: 'checkout-alternate', confidence: 1 })
  }))
  assert.equal(result.outcome.kind, 'refusal')
  if (result.outcome.kind === 'refusal') assert.equal(result.outcome.refusal.code, 'ambiguous_evidence')
})

test('unsupported authored fill refuses the whole source and never exposes canonical actions', () => {
  const result = analyzeManualTestSourceV1(source({ steps: [
    { ordinal: 1, text: 'Open the cart page.' }, { ordinal: 2, text: 'Enter first name.' },
    { ordinal: 3, text: 'Click the Checkout button.' },
  ] }), evidence())
  assert.equal(result.outcome.kind, 'refusal')
  if (result.outcome.kind === 'refusal') {
    assert.equal(result.outcome.refusal.code, 'unsupported_semantics')
    assert.equal(result.outcome.refusal.sourceGrounding.length, 4)
    assert.ok(result.outcome.refusal.sourceGrounding.every(item => item.canonicalBinding === null))
  }
})

test('bounded evidence failures map only to frozen refusal vocabulary', () => {
  const cases: Array<[string, ManualAnalysisEvidenceV1, string]> = [
    ['ambiguous control', evidence(model => model.pages![0].elements.push({ ...model.pages![0].elements[0], id: 'checkout-copy' })), 'ambiguous_evidence'],
    ['missing outcome', evidence(model => { model.pages = model.pages!.slice(0, 1) }), 'insufficient_evidence'],
    ['unknown app area', evidence(model => { delete model.pages![0].module }), 'app_area_unknown'],
    ['multiple data-test', evidence(model => model.pages![0].elements[0].strategies.push({ type: 'data-test', value: 'checkout-two', confidence: 1 })), 'ambiguous_evidence'],
    ['no data-test', evidence(model => { model.pages![0].elements[0].strategies = [] }), 'unsupported_semantics'],
    ['inferred click', evidence(model => { model.flows![0].steps[0].grounding = 'inferred' }), 'insufficient_evidence'],
  ]
  for (const [label, current, code] of cases) {
    const result = analyzeManualTestSourceV1(source(), current)
    assert.equal(result.outcome.kind, 'refusal', label)
    if (result.outcome.kind === 'refusal') assert.equal(result.outcome.refusal.code, code, label)
  }
})

test('identity-only Save request rejects canonical actions and every non-authority body field', () => {
  const valid = {
    schemaVersion: 'forge-manual-promotion-request/v1',
    sourceAuthority: { sourceId: 'source-a', sourceContentHash: 'a'.repeat(64) },
    reviewedProposalAuthority: { proposalId: 'proposal-a', proposalContentHash: 'b'.repeat(64) },
  }
  assert.deepEqual(parseManualPromotionRequestV1(valid), valid)
  assert.throws(() => parseManualPromotionRequestV1({ ...valid, canonicalActions: [] }))
  assert.throws(() => parseManualPromotionRequestV1({ ...valid, sourceText: 'rewritten' }))
})

function saveRequest(proposal: ReturnType<typeof analyzeManualTestSourceV1> extends infer _T ? any : never) {
  return {
    schemaVersion: 'forge-manual-promotion-request/v1',
    sourceAuthority: { ...proposal.sourceAuthority },
    reviewedProposalAuthority: {
      proposalId: proposal.proposalId,
      proposalContentHash: proposal.proposalContentHash,
    },
  }
}

function proposalFor(currentEvidence = evidence()) {
  const result = analyzeManualTestSourceV1(source(), currentEvidence)
  assert.equal(result.outcome.kind, 'proposal')
  if (result.outcome.kind !== 'proposal') throw new Error('Expected proposal')
  return result.outcome.proposal
}

test('duplicate executable selector ambiguity cannot begin promotion or create a Definition', async () => {
  const reviewed = proposalFor()
  const ambiguous = evidence(model => {
    model.pages![0].elements[0].strategies[0].value = 'continue'
    model.pages![0].elements.push({
      ...model.pages![0].elements[0],
      id: 'subject-continue-control',
      name: 'Continue',
      label: 'Continue',
    })
  })
  let generationBegins = 0
  let definitionCommits = 0
  const service = new ManualTestIngestionService(
    { read: async () => source() } as any,
    {
      findManualPromotion: async () => null,
      beginGeneration: async () => { generationBegins += 1 },
      commitCanonicalV3ManualPromotion: async () => { definitionCommits += 1; throw new Error('must not commit') },
      failGeneration: async () => undefined,
    } as any,
    { read: async () => ambiguous } as any,
    () => '2026-08-26T00:00:00.000Z',
    async () => undefined,
    () => '00000000-0000-4000-8000-000000000001',
    () => reviewed.authority.authenticationExpectationIdentityHash,
  )
  await assert.rejects(service.save(PROJECT, '.', saveRequest(reviewed)),
    (error: unknown) => error instanceof ManualTestPromotionError && error.code === 'MANUAL_PROPOSAL_NOT_EXECUTABLE')
  assert.equal(generationBegins, 0)
  assert.equal(definitionCommits, 0)
})

test('Save distinguishes inconsistent identity, source mismatch, stale review, and current refusal', async () => {
  const persisted = source()
  const reviewed = proposalFor()
  const noPromotion = { findManualPromotion: async () => null, failGeneration: async () => undefined }
  const inconsistent = new ManualTestIngestionService(
    { read: async () => persisted } as any, noPromotion as any, { read: async () => evidence() } as any,
    () => '2026-08-26T00:00:00.000Z', async () => undefined, () => '00000000-0000-4000-8000-000000000001', () => reviewed.authority.authenticationExpectationIdentityHash,
  )
  await assert.rejects(inconsistent.save(PROJECT, '.', {
    ...saveRequest(reviewed),
    reviewedProposalAuthority: { proposalId: 'manual-proposal-wrong', proposalContentHash: reviewed.proposalContentHash },
  }), (error: unknown) => error instanceof ManualTestPromotionError && error.code === 'MANUAL_PROMOTION_IDENTITY_CONFLICT')

  const missing = new ManualTestIngestionService(
    { read: async () => null } as any, noPromotion as any, { read: async () => evidence() } as any,
    () => '2026-08-26T00:00:00.000Z', async () => undefined, () => '00000000-0000-4000-8000-000000000001', () => reviewed.authority.authenticationExpectationIdentityHash,
  )
  await assert.rejects(missing.save(PROJECT, '.', saveRequest(reviewed)),
    (error: unknown) => error instanceof ManualTestPromotionError && error.code === 'SOURCE_PROPOSAL_MISMATCH')

  const changedEvidence = evidence()
  changedEvidence.routeEvidence.identityHash = '1'.repeat(64)
  const stale = new ManualTestIngestionService(
    { read: async () => persisted } as any, noPromotion as any, { read: async () => changedEvidence } as any,
    () => '2026-08-26T00:00:00.000Z', async () => undefined, () => '00000000-0000-4000-8000-000000000001', () => reviewed.authority.authenticationExpectationIdentityHash,
  )
  await assert.rejects(stale.save(PROJECT, '.', saveRequest(reviewed)),
    (error: unknown) => error instanceof ManualTestPromotionError && error.code === 'STALE_REVIEWED_PROPOSAL')

  const refused = new ManualTestIngestionService(
    { read: async () => persisted } as any, noPromotion as any, { read: async () => null } as any,
    () => '2026-08-26T00:00:00.000Z', async () => undefined, () => '00000000-0000-4000-8000-000000000001', () => reviewed.authority.authenticationExpectationIdentityHash,
  )
  await assert.rejects(refused.save(PROJECT, '.', saveRequest(reviewed)),
    (error: unknown) => error instanceof ManualTestPromotionError && error.code === 'MANUAL_PROPOSAL_NOT_EXECUTABLE')
})

test('exact Save replay returns original Definition authority and creates no new revision', async () => {
  const persisted = source()
  const proposal = proposalFor()
  const result = {
    schemaVersion: 'forge-manual-promotion-result/v1' as const,
    outcome: 'promoted' as const,
    sourceAuthority: { ...proposal.sourceAuthority },
    proposalAuthority: { proposalId: proposal.proposalId, proposalContentHash: proposal.proposalContentHash },
    definitionAuthority: {
      definitionId: 'definition-m3', definitionSchemaVersion: 3 as const, testSetId: 'test-set-m3',
      testSetRevision: 1, testSetContentHash: '2'.repeat(64),
    },
  }
  let promoted = false
  let revisions = 0
  const testSets = {
    findManualPromotion: async () => promoted ? result : null,
    beginGeneration: async () => { revisions += 1 },
    commitCanonicalV3ManualPromotion: async (_input: unknown, _generation: string, _process: string, actual: typeof proposal, revalidate: () => boolean) => {
      assert.equal(actual.proposalId, proposal.proposalId)
      assert.equal(revalidate(), true)
      promoted = true
      return { result }
    },
    failGeneration: async () => undefined,
  }
  const service = new ManualTestIngestionService(
    { read: async () => persisted } as any, testSets as any, { read: async () => evidence() } as any,
    () => '2026-08-26T00:00:00.000Z', async () => undefined, () => '00000000-0000-4000-8000-000000000001', () => proposal.authority.authenticationExpectationIdentityHash,
  )
  assert.deepEqual(await service.save(PROJECT, '.', saveRequest(proposal)), result)
  assert.deepEqual(await service.save(PROJECT, '.', saveRequest(proposal)), result)
  assert.equal(revisions, 1)
})

test('authority drift inside the promotion transaction becomes the frozen stale-reviewed outcome', async () => {
  const persisted = source()
  const proposal = proposalFor()
  const testSets = {
    findManualPromotion: async () => null,
    beginGeneration: async () => undefined,
    commitCanonicalV3ManualPromotion: async (_input: unknown, _generation: string, _process: string, _proposal: unknown, revalidate: () => boolean) => {
      if (!revalidate()) throw new TestDefinitionContractError('STALE_AUTHORITY')
      throw new Error('expected drift')
    },
    failGeneration: async () => undefined,
  }
  const service = new ManualTestIngestionService(
    { read: async () => persisted } as any, testSets as any, { read: async () => evidence() } as any,
    () => '2026-08-26T00:00:00.000Z', async () => undefined, () => '00000000-0000-4000-8000-000000000001', () => '3'.repeat(64),
  )
  await assert.rejects(service.save(PROJECT, '.', saveRequest(proposal)),
    (error: unknown) => error instanceof ManualTestPromotionError && error.code === 'STALE_REVIEWED_PROPOSAL')
})

test('manual promotion maps through the unchanged v3 parser with no embedded parallel provenance', () => {
  const current = evidence()
  const proposal = proposalFor(current)
  const generated = generateCanonicalManualFlowTestSetV3({
    projectId: PROJECT, generatedAt: '2026-08-26T00:00:00.000Z', authority: current.authority,
    routeEvidence: current.routeEvidence, authenticationExpectation: current.authenticationExpectation,
    normalizedIntent: materializeSupportedNormalizedTestIntentV1(proposal.normalizedIntent),
  }, 'generation-manual-m3', 4)
  const parsed = parseCanonicalTestSetV3(generated.json)
  assert.equal(parsed.value.schemaVersion, 3)
  assert.equal(parsed.value.revision, 4)
  assert.equal(parsed.value.definitions[0].normalizedIntent.source, 'manual')
  assert.deepEqual(parsed.value.definitions[0].actions.map(action => action.kind), [
    'navigate_to_observed_route', 'click_observed_data_test',
  ])
  assert.equal(parsed.value.definitions[0].oracle.kind, 'subject_observable')
  assert.equal('manualSource' in parsed.value.definitions[0], false)
  assert.equal('proposalId' in parsed.value.definitions[0], false)
})
