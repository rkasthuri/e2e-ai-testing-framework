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

import * as crypto from 'crypto'

export type TestGenerationMethod = 'deterministic' | 'heuristic' | 'ai_assisted' | 'manual'
export type TestGenerationOutcome = 'completed' | 'partially_completed' | 'blocked' | 'failed' | 'interrupted'

export interface TestDesignAuthorityInput {
  projectId: string
  sourceObservation: {
    id: string
    outcome: 'completed' | 'partially_completed'
    authenticationOutcome: 'succeeded' | 'not_required'
    subjectIds: string[]
  }
  model: {
    rowId: number
    version: string
    sourceObservationId: string
    validation: 'valid'
    integrity: 'verified' | 'not_evaluated'
    subjects: Array<{ id: string; routePath: string | null; evidenceId: string | null }>
  }
  evidence: Array<{
    id: string
    canonicalSubjectId: string
    routePath: string | null
    sourceObservationId: string
    sourceModelRows: number[]
    support: 'current'
    integrity: 'verified' | 'not_evaluated'
    freshness: 'not_evaluated'
    access: 'available'
    conflict: 'not_evaluated'
  }>
  generatedAt: string
}

export interface CanonicalTestDefinition {
  id: string
  title: string
  intent: string
  category: 'navigation'
  canonicalSubjects: string[]
  preconditions: string[]
  steps: Array<{
    kind: 'navigate_to_observed_route'
    subjectId: string
    routePath: string
    evidenceId: string
  }>
  oracle: {
    kind: 'subject_observable'
    subjectId: string
    evidenceId: string
    explanation: string
  }
  provenance: {
    sourceObservationId: string
    modelRowId: number
    modelVersion: string
    supportingEvidenceIds: string[]
  }
  generationMethod: TestGenerationMethod
  validation: { state: 'valid'; explanation: string }
  runnerCompatibility: { state: 'blocked'; explanation: string }
  confidenceLimitations: string[]
  materialUnknowns: string[]
  unobservedScope: string[]
  preventedStrongerDefinition: string
}

export interface CanonicalTestSet {
  schemaVersion: 1
  testSetId: string
  revision: number
  projectId: string
  generationId: string
  generatedAt: string
  generationMethod: TestGenerationMethod
  outcome: TestGenerationOutcome
  sourceObservationId: string
  modelRowId: number
  modelVersion: string
  supportingEvidenceIds: string[]
  definitions: CanonicalTestDefinition[]
  limitations: string[]
  materialUnknowns: string[]
  unobservedScope: string[]
  preventedStrongerSet: string
  coverage: 'unknown'
  freshness: 'not_evaluated'
}

export interface MaterializedTestSet {
  value: CanonicalTestSet
  json: string
  fingerprint: string
}

export class TestDefinitionContractError extends Error {
  constructor(readonly code: 'AUTHORITY_MISMATCH' | 'UNSUPPORTED_DEFINITION' | 'INVALID_DEFINITION') {
    super(code === 'AUTHORITY_MISMATCH'
      ? 'Current observation, model, and evidence provenance do not agree.'
      : code === 'UNSUPPORTED_DEFINITION'
        ? 'The proposed test uses an action or oracle that current evidence does not support.'
        : 'The proposed test definition is malformed.')
    this.name = 'TestDefinitionContractError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const ROUTE = /^\/(?!\/)[^\s?#]{0,499}$/

function stableId(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}-${crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 24)}`
}

function assertText(value: unknown, max = 500): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
}

function assertTextList(value: unknown, max = 50): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max) throw new TestDefinitionContractError('INVALID_DEFINITION')
  for (const item of value) assertText(item)
}

/**
 * This is the one representation boundary: construction, validation, hashing,
 * and persistence all use the returned JSON. No downstream layer may rebuild
 * the payload from a looser runtime object.
 */
export function materializeCanonicalTestSet(value: CanonicalTestSet): MaterializedTestSet {
  validateCanonicalTestSet(value)
  const json = JSON.stringify(value)
  const reparsed = JSON.parse(json) as CanonicalTestSet
  validateCanonicalTestSet(reparsed)
  return {
    value: reparsed,
    json,
    fingerprint: crypto.createHash('sha256').update(json).digest('hex'),
  }
}

export function parseCanonicalTestSet(json: string): MaterializedTestSet {
  let value: CanonicalTestSet
  try { value = JSON.parse(json) as CanonicalTestSet } catch { throw new TestDefinitionContractError('INVALID_DEFINITION') }
  return materializeCanonicalTestSet(value)
}

export function validateCanonicalTestSet(value: CanonicalTestSet): void {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) throw new TestDefinitionContractError('INVALID_DEFINITION')
  for (const identity of [value.testSetId, value.projectId, value.generationId, value.sourceObservationId, value.modelVersion]) {
    if (typeof identity !== 'string' || !ID.test(identity)) throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.modelRowId) || value.modelRowId < 1) {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (!ISO.test(value.generatedAt) || Number.isNaN(Date.parse(value.generatedAt))) throw new TestDefinitionContractError('INVALID_DEFINITION')
  if (value.generationMethod !== 'deterministic' || value.outcome !== 'partially_completed'
    || value.coverage !== 'unknown' || value.freshness !== 'not_evaluated') {
    throw new TestDefinitionContractError('INVALID_DEFINITION')
  }
  if (!Array.isArray(value.definitions) || value.definitions.length < 1 || value.definitions.length > 50) throw new TestDefinitionContractError('INVALID_DEFINITION')
  assertTextList(value.supportingEvidenceIds)
  assertTextList(value.limitations)
  assertTextList(value.materialUnknowns)
  assertTextList(value.unobservedScope)
  assertText(value.preventedStrongerSet)
  const definitionIds = new Set<string>()
  for (const definition of value.definitions) {
    if (!ID.test(definition.id) || definitionIds.has(definition.id)) throw new TestDefinitionContractError('INVALID_DEFINITION')
    definitionIds.add(definition.id)
    assertText(definition.title)
    assertText(definition.intent)
    if (definition.category !== 'navigation' || definition.generationMethod !== 'deterministic') throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    if (!Array.isArray(definition.canonicalSubjects) || definition.canonicalSubjects.length !== 1 || !ID.test(definition.canonicalSubjects[0])) throw new TestDefinitionContractError('INVALID_DEFINITION')
    assertTextList(definition.preconditions)
    if (!Array.isArray(definition.steps) || definition.steps.length !== 1) throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    const step = definition.steps[0]
    if (step.kind !== 'navigate_to_observed_route' || !ROUTE.test(step.routePath)
      || step.subjectId !== definition.canonicalSubjects[0] || !ID.test(step.evidenceId)) throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    if (definition.oracle.kind !== 'subject_observable'
      || definition.oracle.subjectId !== step.subjectId || definition.oracle.evidenceId !== step.evidenceId) throw new TestDefinitionContractError('UNSUPPORTED_DEFINITION')
    assertText(definition.oracle.explanation)
    if (definition.provenance.sourceObservationId !== value.sourceObservationId
      || definition.provenance.modelRowId !== value.modelRowId
      || definition.provenance.modelVersion !== value.modelVersion
      || definition.provenance.supportingEvidenceIds.length !== 1
      || definition.provenance.supportingEvidenceIds[0] !== step.evidenceId) throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    if (definition.validation.state !== 'valid' || definition.runnerCompatibility.state !== 'blocked') throw new TestDefinitionContractError('INVALID_DEFINITION')
    assertText(definition.validation.explanation)
    assertText(definition.runnerCompatibility.explanation)
    assertTextList(definition.confidenceLimitations)
    assertTextList(definition.materialUnknowns)
    assertTextList(definition.unobservedScope)
    assertText(definition.preventedStrongerDefinition)
  }
}

export function generateEvidenceBackedTestSet(
  input: TestDesignAuthorityInput,
  generationId: string,
  revision: number,
): MaterializedTestSet {
  if (!ID.test(input.projectId) || !ID.test(generationId) || !ISO.test(input.generatedAt)
    || input.model.validation !== 'valid' || input.model.sourceObservationId !== input.sourceObservation.id
    || !['completed', 'partially_completed'].includes(input.sourceObservation.outcome)
    || !['succeeded', 'not_required'].includes(input.sourceObservation.authenticationOutcome)) {
    throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  }
  const observed = new Set(input.sourceObservation.subjectIds)
  const modelSubjects = new Map(input.model.subjects.map(subject => [subject.id, subject]))
  const definitions = [...input.evidence]
    .sort((left, right) => left.canonicalSubjectId.localeCompare(right.canonicalSubjectId) || left.id.localeCompare(right.id))
    .map(evidence => {
      const subject = modelSubjects.get(evidence.canonicalSubjectId)
      if (!subject || !observed.has(evidence.canonicalSubjectId) || subject.evidenceId !== evidence.id
        || subject.routePath !== evidence.routePath || evidence.sourceObservationId !== input.sourceObservation.id
        || !evidence.sourceModelRows.includes(input.model.rowId) || evidence.support !== 'current'
        || evidence.access !== 'available' || evidence.conflict !== 'not_evaluated'
        || !evidence.routePath || !ROUTE.test(evidence.routePath)) {
        throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
      }
      if (evidence.integrity !== 'verified' && evidence.integrity !== 'not_evaluated') throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
      const intent = `Establish whether the observed subject ${evidence.canonicalSubjectId} remains observable at its evidenced route.`
      return {
        id: stableId('test', input.projectId, evidence.canonicalSubjectId, 'navigation', intent),
        title: `Observe ${evidence.canonicalSubjectId}`,
        intent,
        category: 'navigation' as const,
        canonicalSubjects: [evidence.canonicalSubjectId],
        preconditions: ['A separately governed authenticated session may be required; current evidence does not establish reusable session setup.'],
        steps: [{ kind: 'navigate_to_observed_route' as const, subjectId: evidence.canonicalSubjectId, routePath: evidence.routePath, evidenceId: evidence.id }],
        oracle: { kind: 'subject_observable' as const, subjectId: evidence.canonicalSubjectId, evidenceId: evidence.id, explanation: 'Observe the same canonical subject without assuming page completeness or a business outcome.' },
        provenance: { sourceObservationId: input.sourceObservation.id, modelRowId: input.model.rowId, modelVersion: input.model.version, supportingEvidenceIds: [evidence.id] },
        generationMethod: 'deterministic' as const,
        validation: { state: 'valid' as const, explanation: 'The definition matches one current-support subject, route, model, observation, and evidence identity.' },
        runnerCompatibility: { state: 'blocked' as const, explanation: 'The current authorities do not establish reusable authentication setup or an approved execution adapter for this bounded definition.' },
        confidenceLimitations: ['Evidence integrity and freshness were not evaluated.'],
        materialUnknowns: ['Current behavior outside the evidenced subject and route is unknown.'],
        unobservedScope: ['Application scope outside the explicitly referenced subjects remains unknown.'],
        preventedStrongerDefinition: 'No current evidence establishes selectors, multi-step workflow behavior, business rules, or an executable success oracle.',
      }
    })
  if (definitions.length === 0) throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
  const evidenceIds = definitions.map(definition => definition.provenance.supportingEvidenceIds[0]).sort()
  return materializeCanonicalTestSet({
    schemaVersion: 1,
    testSetId: stableId('test-set', input.projectId),
    revision,
    projectId: input.projectId,
    generationId,
    generatedAt: input.generatedAt,
    generationMethod: 'deterministic',
    outcome: 'partially_completed',
    sourceObservationId: input.sourceObservation.id,
    modelRowId: input.model.rowId,
    modelVersion: input.model.version,
    supportingEvidenceIds: evidenceIds,
    definitions,
    limitations: ['Generation was deterministic and did not use AI enrichment.', 'Definitions were not executed.'],
    materialUnknowns: ['Runner-compatible authentication setup, selectors, workflow actions, and business oracles remain unknown.'],
    unobservedScope: ['Coverage outside the exact supporting subjects is unknown.'],
    preventedStrongerSet: 'Current evidence supports bounded subject observation intents, but not executable workflows or coverage conclusions.',
    coverage: 'unknown',
    freshness: 'not_evaluated',
  })
}
