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

import type { CanonicalV3TestDefinitionPresentation, TestInventoryResponse } from './types'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const ROUTE = /^\/(?!\/)[^\s?#]{0,499}$/
const SHA256 = /^[a-f0-9]{64}$/

export class TestInventoryPayloadError extends Error {
  constructor() {
    super('The canonical Test inventory payload is malformed.')
    this.name = 'TestInventoryPayloadError'
  }
}

function fail(): never { throw new TestInventoryPayloadError() }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown> }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort(); const canonical = [...expected].sort()
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) fail()
}
function id(value: unknown): string { if (typeof value !== 'string' || !ID.test(value)) fail(); return value }
function text(value: unknown, max = 2000): string { if (typeof value !== 'string' || value.length < 1 || value.length > max) fail(); return value }
function positive(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) fail(); return Number(value) }
function sha(value: unknown): string { if (typeof value !== 'string' || !SHA256.test(value)) fail(); return value }
function strings(value: unknown): readonly string[] { if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 2000)) fail(); return value }
function indexes(value: unknown): readonly number[] { if (!Array.isArray(value) || value.some(item => !Number.isSafeInteger(item) || item < 0)) fail(); return value }

export function validateCanonicalV3DefinitionPresentation(value: unknown): asserts value is CanonicalV3TestDefinitionPresentation {
  const definition = record(value)
  exactKeys(definition, [
    'schemaVersion', 'authorityClass', 'definitionId', 'title', 'intent', 'category', 'subjects', 'generationMethod',
    'validation', 'intrinsicCompatibility', 'confidenceLimitations', 'materialUnknowns', 'unobservedScope',
    'preventedStrongerDefinition', 'provenance', 'appArea', 'routeEvidence', 'authenticationExpectation',
    'actions', 'oracle', 'normalizedIntent', 'executionPolicy',
  ])
  if (definition.schemaVersion !== 3 || definition.authorityClass !== 'canonical_v3' || definition.category !== 'observed_flow'
    || definition.executionPolicy !== 'canonical_v3_preflight_required') fail()
  for (const key of ['definitionId', 'title', 'intent'] as const) key === 'definitionId' ? id(definition[key]) : text(definition[key])
  if (!Array.isArray(definition.subjects) || definition.subjects.length !== 2) fail()
  const subjects = definition.subjects.map(id)
  if (new Set(subjects).size !== 2) fail()
  if (!['deterministic', 'heuristic', 'ai_assisted', 'manual'].includes(String(definition.generationMethod))) fail()
  for (const key of ['confidenceLimitations', 'materialUnknowns', 'unobservedScope'] as const) strings(definition[key])
  text(definition.preventedStrongerDefinition)

  const validation = record(definition.validation)
  exactKeys(validation, ['state', 'explanation'])
  if (validation.state !== 'valid') fail()
  text(validation.explanation)
  const compatibility = record(definition.intrinsicCompatibility)
  exactKeys(compatibility, ['state', 'reason', 'explanation'])
  if (!['compatible', 'blocked', 'not_evaluated'].includes(String(compatibility.state))) fail()
  if (compatibility.reason !== null && typeof compatibility.reason !== 'string') fail()
  text(compatibility.explanation)

  const provenance = record(definition.provenance)
  exactKeys(provenance, ['label', 'modelRowId', 'modelVersion', 'supportSealHash', 'supportingObservationCount', 'supportingGapCount', 'subjectSupportCount', 'supportingObservationIds', 'supportingGapIds', 'intentId', 'intentContentHash'])
  if (provenance.label !== 'SEALED CANONICAL SUPPORT') fail()
  positive(provenance.modelRowId); id(provenance.modelVersion); sha(provenance.supportSealHash)
  positive(provenance.supportingObservationCount); positive(provenance.subjectSupportCount)
  if (!Number.isSafeInteger(provenance.supportingGapCount) || Number(provenance.supportingGapCount) < 0) fail()
  const observationIds = strings(provenance.supportingObservationIds); const gapIds = strings(provenance.supportingGapIds)
  if (observationIds.length !== provenance.supportingObservationCount || gapIds.length !== provenance.supportingGapCount) fail()
  id(provenance.intentId); sha(provenance.intentContentHash)

  id(definition.appArea)
  const routeEvidence = record(definition.routeEvidence)
  exactKeys(routeEvidence, ['state', 'normalizationPolicy', 'supportingObservationCount', 'supportingObservationIds', 'routes'])
  if (routeEvidence.state !== 'available_flow') fail()
  const policy = record(routeEvidence.normalizationPolicy)
  exactKeys(policy, ['id', 'version'])
  id(policy.id); id(policy.version)
  positive(routeEvidence.supportingObservationCount)
  if (strings(routeEvidence.supportingObservationIds).length !== routeEvidence.supportingObservationCount) fail()
  if (!Array.isArray(routeEvidence.routes) || routeEvidence.routes.length !== 2) fail()
  const routes = routeEvidence.routes.map(item => {
    const route = record(item)
    exactKeys(route, ['subjectId', 'normalizedPath', 'supportingObservationIds'])
    const normalizedPath = text(route.normalizedPath, 500)
    if (!ROUTE.test(normalizedPath)) fail()
    if (strings(route.supportingObservationIds).length < 1) fail()
    return { subjectId: id(route.subjectId), normalizedPath }
  })
  if (routes[0].subjectId !== subjects[0] || routes[1].subjectId !== subjects[1]) fail()

  if (!Array.isArray(definition.actions) || definition.actions.length !== 2) fail()
  const navigate = record(definition.actions[0]); const click = record(definition.actions[1])
  exactKeys(navigate, ['stepId', 'ordinal', 'kind', 'subjectId', 'normalizedPath'])
  exactKeys(click, ['stepId', 'ordinal', 'kind', 'subjectId', 'elementId', 'dataTestValue', 'targetSubjectId'])
  if (navigate.ordinal !== 0 || navigate.kind !== 'navigate_to_observed_route' || id(navigate.subjectId) !== routes[0].subjectId
    || text(navigate.normalizedPath, 500) !== routes[0].normalizedPath || !ROUTE.test(String(navigate.normalizedPath))) fail()
  id(navigate.stepId)
  if (click.ordinal !== 1 || click.kind !== 'click_observed_data_test' || id(click.subjectId) !== routes[0].subjectId
    || id(click.targetSubjectId) !== routes[1].subjectId) fail()
  id(click.stepId); id(click.elementId); id(click.dataTestValue)

  const oracle = record(definition.oracle)
  exactKeys(oracle, ['kind', 'subjectId', 'explanation'])
  if (oracle.kind !== 'subject_observable' || id(oracle.subjectId) !== routes[1].subjectId) fail()
  text(oracle.explanation)
  const normalized = record(definition.normalizedIntent)
  exactKeys(normalized, ['intentId', 'source', 'sourceFlowId', 'selectedFlowStepIndexes', 'excludedFlowStepIndexes', 'limitations'])
  if (id(normalized.intentId) !== provenance.intentId || normalized.source !== 'discovered' && normalized.source !== 'manual') fail()
  id(normalized.sourceFlowId)
  if (indexes(normalized.selectedFlowStepIndexes).length !== 1) fail()
  indexes(normalized.excludedFlowStepIndexes); strings(normalized.limitations)

  const authentication = record(definition.authenticationExpectation)
  exactKeys(authentication, ['state', 'mechanism', 'basis'])
  if (!['required', 'not_required', 'unknown', 'conflicted'].includes(String(authentication.state))) fail()
  if (authentication.mechanism !== null && typeof authentication.mechanism !== 'string') fail()
  if (!Array.isArray(authentication.basis)) fail()
  authentication.basis.forEach(item => {
    const basis = record(item); exactKeys(basis, ['kind', 'policyId', 'policyVersion'])
    if (basis.kind !== 'declared_configuration') fail(); id(basis.policyId); id(basis.policyVersion)
  })
}

export function decodeTestInventoryResponse(value: unknown): TestInventoryResponse {
  const inventory = record(value)
  const current = inventory.current === null ? null : record(inventory.current)
  if (current) {
    const testSet = record(current.testSet)
    if (testSet.schemaVersion === 3) {
      exactKeys(testSet, ['schemaVersion', 'authorityClass', 'testSetId', 'revision', 'projectId', 'generationId', 'generatedAt', 'outcome', 'definitions', 'provenance', 'limitations', 'materialUnknowns', 'unobservedScope', 'preventedStrongerSet', 'coverage', 'freshness'])
      if (testSet.authorityClass !== 'canonical_v3' || !Array.isArray(testSet.definitions) || testSet.definitions.length < 1) fail()
      id(testSet.testSetId); positive(testSet.revision); id(testSet.projectId); id(testSet.generationId); text(testSet.generatedAt)
      if (!['completed', 'partially_completed', 'blocked', 'failed', 'interrupted'].includes(String(testSet.outcome))
        || testSet.coverage !== 'unknown' || testSet.freshness !== 'not_evaluated') fail()
      strings(testSet.limitations); strings(testSet.materialUnknowns); strings(testSet.unobservedScope); text(testSet.preventedStrongerSet)
      const provenance = record(testSet.provenance)
      exactKeys(provenance, ['label', 'modelRowId', 'modelVersion', 'observationRunId', 'supportSealHash', 'characterizationPolicy', 'supportingObservationCount', 'supportingGapCount', 'subjectSupportCount'])
      if (provenance.label !== 'SEALED CANONICAL SUPPORT') fail()
      positive(provenance.modelRowId); id(provenance.modelVersion); id(provenance.observationRunId); sha(provenance.supportSealHash)
      positive(provenance.supportingObservationCount); positive(provenance.subjectSupportCount)
      if (!Number.isSafeInteger(provenance.supportingGapCount) || Number(provenance.supportingGapCount) < 0) fail()
      const characterizationPolicy = record(provenance.characterizationPolicy)
      exactKeys(characterizationPolicy, ['id', 'version']); id(characterizationPolicy.id); id(characterizationPolicy.version)
      testSet.definitions.forEach(validateCanonicalV3DefinitionPresentation)
    } else if (![1, 2].includes(Number(testSet.schemaVersion))) fail()
  }
  if (!Array.isArray(inventory.history)) fail()
  for (const item of inventory.history) {
    const history = record(item)
    if (![1, 2, 3].includes(Number(history.schemaVersion))) fail()
    if (history.schemaVersion === 3 && history.authorityClass !== 'canonical_v3') fail()
  }
  if (inventory.requestedDefinition !== null && inventory.requestedDefinition !== undefined) {
    const requested = record(inventory.requestedDefinition)
    const definition = record(requested.definition)
    if (definition.schemaVersion === 3) validateCanonicalV3DefinitionPresentation(definition)
    if (requested.schemaVersion !== definition.schemaVersion) fail()
  }
  return value as TestInventoryResponse
}
