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
import { fail, ok } from '../http'
import { executionContext } from './ExecutionContext'
import { readApplicationReadiness } from './ApplicationReadinessController'
import { readApplicationModelHistory } from './ApplicationModelHistoryController'
import { readEvidenceLedger } from './EvidenceLedgerController'

export interface TestInventoryHttpResult { status: number; body: unknown }
type Project = { appName: string }

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null
}

function data(result: { status: number; body: unknown }): Record<string, any> | null {
  return result.status === 200 ? record(record(result.body)?.data) : null
}

function validLimit(value: unknown): number | null {
  if (value === undefined) return 25
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) return null
  const limit = Number(value)
  return limit >= 1 && limit <= 50 ? limit : null
}

async function authorityInput(appName: string, project: Project): Promise<{ input: Record<string, unknown>; readiness: Record<string, any> } | TestInventoryHttpResult> {
  const resolve = async () => project
  const [readinessResult, modelResult, evidenceResult] = await Promise.all([
    readApplicationReadiness(appName, resolve),
    readApplicationModelHistory(appName, { limit: '25' }, resolve),
    readEvidenceLedger(appName, { limit: '50', support: 'current' }, resolve),
  ])
  if (readinessResult.status !== 200 || modelResult.status !== 200 || evidenceResult.status !== 200) {
    return { status: 422, body: fail('Test-design authorities could not be validated safely.', 'TEST_DESIGN_SOURCE_INVALID') }
  }
  const readiness = data(readinessResult)
  const modelData = data(modelResult)
  const evidenceData = data(evidenceResult)
  const decision = Array.isArray(readiness?.decisions)
    ? readiness.decisions.find((item: any) => item?.id === 'design_evidence_backed_tests') : null
  if (!readiness || !modelData || !evidenceData || !decision) {
    return { status: 422, body: fail('Test-design authorities could not be validated safely.', 'TEST_DESIGN_SOURCE_INVALID') }
  }
  if (!['supported', 'supported_with_constraints'].includes(decision.state)) {
    return { status: 409, body: fail('Current evidence does not support evidence-backed test generation.', 'TEST_DESIGN_NOT_READY') }
  }
  const latest = record(readiness.authoritySnapshot?.latestObservation)
  const model = record(modelData.currentModel)
  const evidence = Array.isArray(evidenceData.evidence) ? evidenceData.evidence : []
  const currentTotal = Number(evidenceData.page?.currentSupportTotal)
  if (!latest || !model || evidence.length !== currentTotal || currentTotal < 1 || currentTotal > 50
    || !Array.isArray(model.subjects) || latest.id !== model.sourceObservation?.id) {
    return { status: 422, body: fail('Current observation, model, and evidence provenance do not agree.', 'TEST_DESIGN_PROVENANCE_MISMATCH') }
  }
  const input = {
    projectId: appName,
    sourceObservation: {
      id: latest.id,
      outcome: latest.outcome,
      authenticationOutcome: latest.authenticationOutcome,
      subjectIds: latest.subjectIds,
    },
    model: {
      rowId: model.rowId, version: model.version, sourceObservationId: model.sourceObservation.id,
      validation: model.validation, integrity: model.integrity,
      subjects: model.subjects.map((subject: any) => ({ id: subject.id, routePath: subject.routePath, evidenceId: subject.evidenceId })),
    },
    evidence: evidence.map((item: any) => ({
      id: item.id, canonicalSubjectId: item.canonicalSubjectId, routePath: item.routePath,
      sourceObservationId: item.sourceObservation?.id,
      sourceModelRows: Array.isArray(item.sourceModels) ? item.sourceModels.map((source: any) => source.rowId) : [],
      support: item.support, integrity: item.integrity, freshness: item.freshness,
      access: item.access, conflict: item.conflict,
    })),
    generatedAt: new Date().toISOString(),
  }
  return { input, readiness }
}

function safeFailure(cause: unknown): TestInventoryHttpResult {
  const name = cause instanceof Error ? cause.name : ''
  if (name === 'DuplicateTestGenerationError') return { status: 409, body: fail('A test-design generation is already active for this project.', 'DUPLICATE_TEST_GENERATION') }
  if (name === 'TestDefinitionContractError') return { status: 422, body: fail('The proposed definitions did not satisfy the evidence-backed test contract.', 'TEST_DEFINITION_INVALID') }
  if (name === 'MalformedTestSetError') return { status: 422, body: fail('Persisted test-set history could not be validated safely.', 'TEST_SET_HISTORY_INVALID') }
  return { status: 503, body: fail('The test-definition authority is temporarily unavailable.', 'TEST_DEFINITION_UNAVAILABLE') }
}

export async function readTestInventory(appName: string, query: Record<string, unknown>, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<TestInventoryHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const limit = validLimit(query.limit)
  if (limit === null || (query.cursor !== undefined && typeof query.cursor !== 'string')
    || (query.test !== undefined && (typeof query.test !== 'string' || query.test.length > 255))) {
    return { status: 400, body: fail('Invalid test inventory pagination or identity.', 'INVALID_TEST_QUERY') }
  }
  try {
    const [inventory, readinessResult] = await Promise.all([
      executionContext.readTestInventory(appName, { limit, cursor: (query.cursor as string | undefined) ?? null, definitionId: (query.test as string | undefined) ?? null }),
      readApplicationReadiness(appName, async () => project),
    ])
    if ((inventory as any).kind === 'invalid_cursor') return { status: 400, body: fail('Invalid or mismatched test inventory cursor.', 'INVALID_TEST_CURSOR') }
    const readiness = data(readinessResult)
    if (!readiness) return { status: 422, body: fail('Test-design readiness could not be validated safely.', 'TEST_DESIGN_SOURCE_INVALID') }
    const decision = readiness.decisions.find((item: any) => item.id === 'design_evidence_backed_tests')
    return { status: 200, body: ok({
      project: { id: appName, name: project.appName },
      designReadiness: decision,
      canGenerate: ['supported', 'supported_with_constraints'].includes(decision.state),
      ...inventory as Record<string, unknown>,
      boundaries: {
        execution: 'not_performed', coverage: 'unknown', freshness: 'not_evaluated',
        explanation: 'A valid definition is not an executed, passing, comprehensive, or current test.',
      },
    }) }
  } catch (cause) { return safeFailure(cause) }
}

export async function generateTestInventory(appName: string, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<TestInventoryHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const authority = await authorityInput(appName, project)
  if ('status' in authority) return authority
  const generationId = crypto.randomUUID()
  try {
    const result = await executionContext.generateTestSet(appName, authority.input, generationId)
    return { status: 201, body: ok({ generationId, state: result.testSet.outcome, complete: true, testSetRowId: result.rowId, revision: result.testSet.revision, definitionCount: result.testSet.definitions.length }) }
  } catch (cause) { return safeFailure(cause) }
}

export async function readTestDefinition(appName: string, definitionId: string, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<TestInventoryHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(definitionId)) return { status: 404, body: fail('Test definition not found', 'NOT_FOUND') }
  try {
    const inventory = await executionContext.readTestInventory(appName, { limit: 1, cursor: null, definitionId }) as any
    return inventory.requestedDefinition
      ? { status: 200, body: ok({ project: { id: appName, name: project.appName }, ...inventory.requestedDefinition }) }
      : { status: 404, body: fail('Test definition not found', 'NOT_FOUND') }
  } catch (cause) { return safeFailure(cause) }
}

export async function readTestGenerationStatus(appName: string, generationId: string, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<TestInventoryHttpResult> {
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(generationId)) return { status: 404, body: fail('Generation not found', 'NOT_FOUND') }
  try {
    const status = await executionContext.readTestGenerationStatus(appName, generationId)
    return status ? { status: 200, body: ok(status) } : { status: 404, body: fail('Generation not found', 'NOT_FOUND') }
  } catch (cause) { return safeFailure(cause) }
}
