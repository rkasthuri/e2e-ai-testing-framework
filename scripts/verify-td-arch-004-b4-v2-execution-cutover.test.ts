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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { closeDb, getDatabaseProvenance, getDb, initDb } from '../src/core/storage/db'
import { runMigrations, runSqliteMigrationCoordinator } from '../src/core/storage/migrate'
import { runWithMigrationContext } from '../src/core/storage/MigrationContext'
import { up as migrateUp, down as migrateDown } from '../src/core/storage/migrations/027_canonical_v2_execution_authority'
import { generateCanonicalTestSetV2 } from '../src/core/test-design/TestDefinitionContract'
import type { CanonicalTestDefinitionAuthority } from '../src/core/test-design/TestDefinitionAuthorityProjectionService'
import { AuthenticationExpectationProjectionService } from '../src/core/test-design/AuthenticationExpectationProjection'
import { ROUTE_NORMALIZATION_POLICY } from '../src/core/test-design/CanonicalRouteEvidenceProjection'
import { projectExecutablePlan, routeEvidenceIdentity } from '../src/core/execution/ExecutionProjectionService'
import { ExecutionService } from '../src/core/execution/ExecutionService'

const SEALED_AUTHORITY: CanonicalTestDefinitionAuthority = {
  schemaVersion: 'forge-test-definition-authority/v2', authorityClass: 'canonical_v2', projectId: 'product',
  modelRowId: 7, modelVersion: '1.0.0', observationRunId: 'run-1', supportSealHash: 'a'.repeat(64),
  characterizationPolicy: { id: 'forge.policy', version: '1' }, supportingObservationIds: ['obs-1'], supportingGapIds: ['gap-1'],
  subjectSupport: [{ canonicalSubjectId: 'inventory', supportingObservationIds: ['obs-1'], supportingGapIds: [] }],
}

const ROUTE_EVIDENCE = {
  schemaVersion: 'forge-canonical-route-evidence/v1' as const, projectId: 'product', modelRowId: 7,
  supportSealHash: 'a'.repeat(64), normalizationPolicy: { ...ROUTE_NORMALIZATION_POLICY },
  subjects: [{ canonicalSubjectId: 'inventory', normalizedPath: '/inventory.html', supportingObservationIds: ['obs-1'] }],
  identityHash: 'b'.repeat(64),
}

function auth(state: 'required' | 'not_required' | 'unknown' | 'conflicted' = 'required') {
  const sources = state === 'unknown' ? [] : state === 'conflicted'
    ? [{ state: 'required' as const, mechanism: 'form-login', configurationDigest: '1'.repeat(64) }, { state: 'not_required' as const, mechanism: null, configurationDigest: '2'.repeat(64) }]
    : [{ state, mechanism: state === 'required' ? 'form-login' : null, configurationDigest: '1'.repeat(64) }]
  return new AuthenticationExpectationProjectionService({ read: () => sources }).read('product', 'unused')
}

function fixture(authentication = auth()) {
  return generateCanonicalTestSetV2({ projectId: 'product', generatedAt: '2026-08-13T10:00:00.000Z', authority: SEALED_AUTHORITY, routeEvidence: ROUTE_EVIDENCE, authenticationExpectation: authentication }, 'generation-1', 2)
}

function live(materialized = fixture(), overrides: Record<string, unknown> = {}) {
  return {
    currentRevision: { revision: 2, testSetId: materialized.value.testSetId, contentHash: materialized.fingerprint },
    sealedAuthority: SEALED_AUTHORITY,
    routeEvidence: ROUTE_EVIDENCE,
    authenticationExpectation: auth(),
    ...overrides,
  }
}

test('valid v2 projection carries sealed identity and no singular provenance', () => {
  const set = fixture()
  const result = projectExecutablePlan({ definition: set.value.definitions[0], definitionSchemaVersion: 2,
    definitionTestSetId: set.value.testSetId, definitionRevision: 2, testSetContentHash: set.fingerprint }, live(set), '2026-08-13T10:01:00.000Z')
  assert.equal(result.kind, 'ok')
  if (result.kind === 'ok') {
    assert.equal(result.plan.value.schemaVersion, 2)
    assert.equal((result.plan.value as any).provenance.supportSealHash, SEALED_AUTHORITY.supportSealHash)
    assert.equal('sourceObservationId' in result.plan.value.provenance, false)
  }
})

test('new Product execution of readable v1 authority fails closed without conversion', async () => {
  const service = new ExecutionService({
    definitions: { readInventory: async () => ({ current: { rowId: 1, contentHash: '0'.repeat(64),
      testSet: { schemaVersion: 1, revision: 1 } as any, startedAt: '', completedAt: '', temporalIntegrity: 'verified', temporalCode: null, temporalExplanation: '' },
      history: [], total: 1, nextCursor: null, requestedDefinition: null }) } as any,
    runnerReadiness: () => ({ available: true, safeCode: 'ready', safeMessage: 'ready' }),
  })
  const result = await service.preflight({ ...request, revision: 1, definitionIds: ['legacy-definition'] })
  assert.equal(result.kind, 'rejected')
  if (result.kind === 'rejected') assert.equal(result.code, 'legacy_provenance_unsupported')
})

test('stale revision, seal, route, and authentication provenance each refuse', () => {
  const set = fixture(); const definition = set.value.definitions[0]
  const request = { definition, definitionSchemaVersion: 2 as const, definitionTestSetId: set.value.testSetId, definitionRevision: 2, testSetContentHash: set.fingerprint }
  assert.equal((projectExecutablePlan(request, live(set, { currentRevision: { revision: 3, testSetId: set.value.testSetId, contentHash: set.fingerprint } }), '2026-08-13T10:01:00.000Z') as any).failure.code, 'stale_definition')
  assert.equal((projectExecutablePlan(request, live(set, { sealedAuthority: { ...SEALED_AUTHORITY, supportSealHash: 'c'.repeat(64) } }), '2026-08-13T10:01:00.000Z') as any).failure.code, 'support_seal_mismatch')
  assert.equal((projectExecutablePlan(request, live(set, { routeEvidence: { ...ROUTE_EVIDENCE, subjects: [{ ...ROUTE_EVIDENCE.subjects[0], normalizedPath: '/cart.html' }] } }), '2026-08-13T10:01:00.000Z') as any).failure.code, 'stale_definition')
  assert.equal((projectExecutablePlan(request, live(set, { authenticationExpectation: auth('not_required') }), '2026-08-13T10:01:00.000Z') as any).failure.code, 'stale_definition')
})

test('semantic plan hash ignores projection time and changes with route/auth/support semantics', () => {
  const set = fixture(); const definition = set.value.definitions[0]
  const request = { definition, definitionSchemaVersion: 2 as const, definitionTestSetId: set.value.testSetId, definitionRevision: 2, testSetContentHash: set.fingerprint }
  const first = projectExecutablePlan(request, live(set), '2026-08-13T10:01:00.000Z') as any
  const second = projectExecutablePlan(request, live(set), '2026-08-13T11:01:00.000Z') as any
  assert.equal(first.plan.fingerprint, second.plan.fingerprint)
  const notRequired = fixture(auth('not_required'))
  const changedAuth = projectExecutablePlan({ ...request, definition: notRequired.value.definitions[0], testSetContentHash: notRequired.fingerprint },
    live(notRequired, { authenticationExpectation: auth('not_required') }), '2026-08-13T10:01:00.000Z') as any
  assert.notEqual(first.plan.fingerprint, changedAuth.plan.fingerprint)
  const changedRouteDefinition = structuredClone(definition) as any
  changedRouteDefinition.routeEvidence.normalizedPath = '/cart.html'; changedRouteDefinition.action.routePath = '/cart.html'
  const changedRoute = { ...ROUTE_EVIDENCE, subjects: [{ ...ROUTE_EVIDENCE.subjects[0], normalizedPath: '/cart.html' }] }
  const routed = projectExecutablePlan({ ...request, definition: changedRouteDefinition }, live(set, { routeEvidence: changedRoute }), '2026-08-13T10:01:00.000Z') as any
  assert.notEqual(first.plan.fingerprint, routed.plan.fingerprint)
  assert.notEqual(routeEvidenceIdentity(definition), routeEvidenceIdentity(changedRouteDefinition))
})

function service(authentication: ReturnType<typeof auth>, credentialAvailable: boolean, runnerAvailable = true) {
  const set = fixture(authentication)
  return { set, service: new ExecutionService({
    definitions: { readInventory: async () => ({ current: { rowId: 1, contentHash: set.fingerprint, testSet: set.value,
      startedAt: set.value.generatedAt, completedAt: set.value.generatedAt, temporalIntegrity: 'verified', temporalCode: null, temporalExplanation: 'ok' }, history: [], total: 1, nextCursor: null, requestedDefinition: null }) } as any,
    authorityProjection: { read: async () => ({ kind: 'ok', authority: SEALED_AUTHORITY }) } as any,
    routeProjection: { read: async () => ({ kind: 'ok', evidence: ROUTE_EVIDENCE }) } as any,
    authenticationProjection: { read: () => authentication } as any,
    credentials: { isAvailable: () => credentialAvailable } as any,
    runnerReadiness: () => ({ available: runnerAvailable, safeCode: runnerAvailable ? 'ready' : 'runner_unavailable', safeMessage: runnerAvailable ? 'ready' : 'runner unavailable' }) as any,
  }) }
}

const request = { projectId: 'product', executionIntentKey: 'intent-v2-cutover', definitionIds: [] as string[], revision: 2, workspaceRoot: 'unused',
  credentialReference: { usernameEnv: 'PRODUCT_USERNAME', passwordEnv: 'PRODUCT_PASSWORD' }, runtime: { baseUrl: 'https://example.invalid' } }

test('live eligibility separates auth states, credential availability, and runner availability', async () => {
  const available = service(auth('required'), true); request.definitionIds = [available.set.value.definitions[0].id]
  assert.equal((await available.service.preflight(request)).kind, 'ready')
  assert.equal((await service(auth('required'), false).service.preflight(request) as any).code, 'credentials_unavailable')
  assert.equal((await service(auth('unknown'), true).service.preflight(request) as any).code, 'authentication_unknown')
  assert.equal((await service(auth('conflicted'), true).service.preflight(request) as any).code, 'authentication_conflicted')
  assert.equal((await service(auth('required'), true, false).service.preflight(request) as any).code, 'runner_unavailable')
  const guest = service(auth('not_required'), false); request.definitionIds = [guest.set.value.definitions[0].id]
  assert.equal((await guest.service.preflight(request)).kind, 'ready')
})

test('controllers cannot inject route, auth, support, seal, or credential semantics', () => {
  const lifecycleSource = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/context/ExecutionLifecycleController.ts'), 'utf8')
  assert.doesNotMatch(lifecycleSource, /projectionAuthority|sourceObservation|supportSealHash|supportingObservationIds|authenticationExpectation|credentialReference|routePath/)
  const preflightSource = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/context/ExecutionPreflightController.ts'), 'utf8')
  assert.match(preflightSource, /readProductExecutionPreflight/)
  assert.doesNotMatch(preflightSource, /TestDefinitionAuthorityProjectionService|CanonicalRouteEvidenceProjection|AuthenticationExpectationProjectionService|projectExecutablePlan/)
  const lifecycle = fs.readFileSync(path.join(process.cwd(), 'forge-ui/server/context/ExecutionLifecycleController.ts'), 'utf8')
  for (const code of ['LEGACY_PROVENANCE_UNSUPPORTED', 'SUPPORT_SEAL_MISMATCH', 'ROUTE_UNKNOWN', 'ROUTE_CONFLICTED',
    'AUTHENTICATION_UNKNOWN', 'AUTHENTICATION_CONFLICTED']) assert.match(lifecycle, new RegExp(`PREFLIGHT_${code}`))
})

test('Migration 027 preserves v1 roots, reapplies, enforces exclusive v2 identity, and refuses lossy rollback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-td-arch-004-b4-migration-'))
  initDb(path.join(root, 'forge.db'))
  try {
    const migrationsDirectory = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')
    const through026 = Object.fromEntries(fs.readdirSync(migrationsDirectory)
      .filter(file => file.endsWith('.ts') && file <= '026_canonical_test_definition_v2.ts')
      .sort()
      .map(file => [file.replace(/\.ts$/, ''), require(path.join(migrationsDirectory, file))]))
    await runSqliteMigrationCoordinator(getDb(), through026)
    const authority = getDatabaseProvenance()
    await runWithMigrationContext(authority, () => migrateUp(getDb()))
    const base = {
      project_id: 'product', accepted_at: '2026-08-13T10:00:00.000Z', test_set_id: 'test-set', test_set_revision: 1,
      model_row_id: 1, model_version: '1.0.0', manifest_hash: '1'.repeat(64), max_run_attempts: 1,
      dispatch_mode: 'serial' as const, stop_rule: 'stop_on_first_non_completed' as const,
    }
    await getDb().insertInto('executions').values({
      ...base, execution_id: 'execution-v1', definition_schema_version: 1, source_observation_id: 'observation-v1',
      support_seal_hash: null, route_evidence_identity_hash: null, authentication_expectation_identity_hash: null,
    }).execute()
    await runWithMigrationContext(authority, () => migrateDown(getDb()))
    const historical = await getDb().selectFrom('executions').selectAll().where('execution_id', '=', 'execution-v1').executeTakeFirstOrThrow() as any
    assert.equal(historical.source_observation_id, 'observation-v1')
    assert.equal('definition_schema_version' in historical, false)
    await runWithMigrationContext(authority, () => migrateUp(getDb()))
    const restored = await getDb().selectFrom('executions').selectAll().where('execution_id', '=', 'execution-v1').executeTakeFirstOrThrow()
    assert.equal(restored.definition_schema_version, 1)
    assert.equal(restored.source_observation_id, 'observation-v1')
    await getDb().insertInto('executions').values({
      ...base, execution_id: 'execution-v2', definition_schema_version: 2, source_observation_id: null,
      support_seal_hash: 'a'.repeat(64), route_evidence_identity_hash: 'b'.repeat(64), authentication_expectation_identity_hash: 'c'.repeat(64),
    }).execute()
    await assert.rejects(() => getDb().insertInto('executions').values({
      ...base, execution_id: 'execution-mixed', definition_schema_version: 2, source_observation_id: 'forbidden-singular-provenance',
      support_seal_hash: 'a'.repeat(64), route_evidence_identity_hash: 'b'.repeat(64), authentication_expectation_identity_hash: 'c'.repeat(64),
    }).execute())
    await assert.rejects(() => runWithMigrationContext(authority, () => migrateDown(getDb())), /cannot roll back while v2 Execution roots exist/i)
  } finally {
    await closeDb()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
