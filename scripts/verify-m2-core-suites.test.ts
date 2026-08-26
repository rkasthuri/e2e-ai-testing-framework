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
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { sql } from 'kysely'
import { closeDb, getDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import { MIGRATION_032_TRIGGER_DEFINITIONS_V1 } from '../src/core/storage/migrations/032_canonical_suite_revision_authority'
import {
  generateCanonicalFlowTestSetV3, materializeCanonicalTestSet,
  type CanonicalTestSetV2, type CanonicalTestSetV3,
} from '../src/core/test-design/TestDefinitionContract'
import { normalizeDiscoveredIntentV1 } from '../src/core/test-design/NormalizedTestIntentContract'
import { SuiteService } from '../src/core/suites/SuiteService'
import {
  SuiteContractError, suiteChangeFingerprint, suiteHash, type CanonicalSuiteRevision, type DefinitionRevisionRef,
} from '../src/core/suites/SuiteContract'
import { SuiteRepository } from '../src/core/storage/repositories/SuiteRepository'
import {
  ExecutionRepository, StaleExecutionAuthorityError, SuiteExecutionIntegrityError, type BeginExecutionInput,
} from '../src/core/storage/repositories/ExecutionRepository'
import { ExecutionResultProjectionService } from '../src/core/execution/ExecutionResultProjectionService'
import { ExecutionRunCoordinator } from '../src/core/execution/ExecutionRunCoordinator'
import { ExecutionService } from '../src/core/execution/ExecutionService'

const HASH='a'.repeat(64), NOW='2026-08-25T12:00:00.000Z', PROJECT='m2-suite-project'
function fixture(modelRowId:number, revision:number, generationId:string): ReturnType<typeof materializeCanonicalTestSet> {
  const definition=(id:string,subject:string)=>({id,title:`${id} title`,intent:`Exercise ${subject}.`,canonicalSubjects:[subject],provenance:{modelRowId,modelVersion:'1.0.0',supportSealHash:HASH,subjectSupport:[{canonicalSubjectId:subject,supportingObservationIds:['11111111-1111-4111-8111-111111111111'],supportingGapIds:[]}]},generationMethod:'deterministic' as const,validation:{state:'valid' as const,explanation:'Exact sealed authority.'},confidenceLimitations:[],materialUnknowns:[],unobservedScope:[],preventedStrongerDefinition:'Bounded fixture.'})
  const value:CanonicalTestSetV2={schemaVersion:2,testSetId:'test-set-m2',revision,projectId:PROJECT,generationId,generatedAt:NOW,generationMethod:'deterministic',outcome:'completed',canonicalSupport:{modelRowId,modelVersion:'1.0.0',observationRunId:'22222222-2222-4222-8222-222222222222',supportSealHash:HASH,characterizationPolicy:{id:'forge.fixture',version:'1'},supportingObservationIds:['11111111-1111-4111-8111-111111111111'],supportingGapIds:[]},definitions:[definition('definition-a','subject-a'),definition('definition-b','subject-b')],limitations:[],materialUnknowns:[],unobservedScope:[],preventedStrongerSet:'Bounded fixture.',coverage:'unknown',freshness:'not_evaluated'}
  return materializeCanonicalTestSet(value)
}
function v3Fixture(modelRowId: number, revision: number) {
  const authority = {
    schemaVersion: 'forge-test-definition-authority/v2', authorityClass: 'canonical_v2', projectId: PROJECT,
    modelRowId, modelVersion: '1.0.0', observationRunId: 'observation-run-v3', supportSealHash: HASH,
    characterizationPolicy: { id: 'forge.fixture', version: '1' },
    supportingObservationIds: ['obs-cart', 'obs-checkout'], supportingGapIds: [],
    subjectSupport: [
      { canonicalSubjectId: 'cart-html', supportingObservationIds: ['obs-cart'], supportingGapIds: [] },
      { canonicalSubjectId: 'checkout-html', supportingObservationIds: ['obs-checkout'], supportingGapIds: [] },
    ],
  } as any
  const routeEvidence = {
    schemaVersion: 'forge-canonical-route-evidence/v1', projectId: PROJECT, modelRowId,
    supportSealHash: HASH, normalizationPolicy: { id: 'forge.fixture.routes', version: '1' },
    subjects: [
      { canonicalSubjectId: 'cart-html', normalizedPath: '/cart.html', supportingObservationIds: ['obs-cart'] },
      { canonicalSubjectId: 'checkout-html', normalizedPath: '/checkout.html', supportingObservationIds: ['obs-checkout'] },
    ], identityHash: 'b'.repeat(64),
  } as any
  const authenticationExpectation = {
    schemaVersion: 'forge-authentication-expectation/v1', state: 'required', mechanism: 'form-login',
    bases: [{ kind: 'declared_configuration', policyId: 'forge.fixture.auth', policyVersion: '1',
      configurationDigest: 'c'.repeat(64), mechanism: 'form-login' }], identityHash: 'd'.repeat(64),
  } as any
  const model = {
    schemaVersion: '2.0', generatedAt: NOW, generatedBy: 'engine', classificationRunId: 'classification-v3',
    app: { name: PROJECT, displayName: 'M2 v3 fixture', baseUrl: 'https://example.invalid', appType: 'web-ui',
      modelVersion: '1.0.0', spaConfig: null, evidenceState: 'crawled', crawlMetadata: null },
    roles: [{ id: 'standardUser', displayName: 'Standard user', authFlow: 'form-login',
      credentialsEnvKey: 'M2_CREDENTIALS', storageStatePath: null,
      reachablePageIds: ['cart-html', 'checkout-html'], restrictedPageIds: [], authOutcome: 'succeeded' }],
    pages: [{
      id: 'cart-html', displayName: 'Cart', urlPattern: '/cart.html', urlPatternType: 'exact',
      fingerprint: 'cart-fingerprint', fingerprintBasis: 'url+dom-hash', appType: 'web-ui',
      accessibleByRoles: ['standardUser'], isAuthPage: false,
      module: { name: 'Cart', confidence: 'medium', method: 'rule', evidenceIds: ['cart-html'],
        source: 'evidence-matched', reason: 'unambiguous cart evidence' },
      elements: [{ id: 'cart-html:checkout', name: 'checkout', kind: 'button', label: 'Checkout', critical: true,
        aiNamed: false, strategies: [{ type: 'data-test', value: 'checkout', confidence: 1 }],
        tier3Assertions: [], cardinality: { kind: 'single' }, observedState: 'visible', href: null }],
    }, {
      id: 'checkout-html', displayName: 'Checkout', urlPattern: '/checkout.html', urlPatternType: 'exact',
      fingerprint: 'checkout-fingerprint', fingerprintBasis: 'url+dom-hash', appType: 'web-ui',
      accessibleByRoles: ['standardUser'], isAuthPage: false,
      module: { name: 'Checkout', confidence: 'medium', method: 'rule', evidenceIds: ['checkout-html'],
        source: 'evidence-matched', reason: 'unambiguous checkout evidence' }, elements: [],
    }],
    flows: [{ id: 'checkout-flow', displayName: 'Observed checkout', confidence: 'partial', source: 'agent-proposed',
      roleId: 'standardUser', steps: [
        { stepIndex: 1, pageId: 'home', action: 'assert-navigation', elementId: null,
          targetPageId: 'cart-html', value: null, grounding: 'inferred' },
        { stepIndex: 2, pageId: 'cart-html', action: 'click', elementId: 'cart-html:checkout',
          targetPageId: 'checkout-html', value: null, grounding: 'observed' },
      ], linkedApiEndpointIds: [], groundingWarnings: ['Entry navigation was not observed.'] }],
    endpoints: null, api: null, diff: null,
  } as any
  const normalized = normalizeDiscoveredIntentV1({
    projectId: PROJECT, model, authority, routeEvidence, authenticationExpectation,
    selection: { flowId: 'checkout-flow', selectedFlowStepIndexes: [2] },
  })
  assert.equal(normalized.kind, 'supported')
  if (normalized.kind !== 'supported') throw new Error('Expected valid v3 fixture intent.')
  return generateCanonicalFlowTestSetV3({
    projectId: PROJECT, generatedAt: NOW, authority, routeEvidence,
    authenticationExpectation, normalizedIntent: normalized.materialized,
  }, `generation-v3-${revision}`, revision)
}
async function insertSet(materialized:ReturnType<typeof materializeCanonicalTestSet>, modelRowId:number){const value=materialized.value as CanonicalTestSetV2|CanonicalTestSetV3; await getDb().insertInto('test_set_revisions').values({test_set_id:value.testSetId,revision:value.revision,project_id:value.projectId,generation_id:value.generationId,schema_version:value.schemaVersion,source_observation_id:null,model_row_id:modelRowId,model_version:'1.0.0',observation_run_id:value.canonicalSupport.observationRunId,support_seal_hash:HASH,characterization_policy_id:'forge.fixture',characterization_policy_version:'1',generated_at:NOW,outcome:'completed',definition_count:value.definitions.length,payload_json:materialized.json,content_hash:materialized.fingerprint}).execute()}
async function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'forge-m2-core-'));initDb(path.join(root,'forge.db'));await runMigrations();const model=await getDb().insertInto('app_models').values({app_name:PROJECT,version:'1.0.0',base_url:'https://example.invalid',app_type:'web',intake_mode:'crawl',crawl_config_hash:HASH,page_count:2,flow_count:0,role_count:0,model_json:'{}',crawled_at:NOW,crawled_by:'engine',status:'active',evidence_state:'crawled',operation_id:null,candidate_hash:null,recovery_source_row_id:null,recovery_source_fingerprint:null}).returning('id').executeTakeFirstOrThrow();const set=fixture(Number(model.id),1,'generation-m2-1');await insertSet(set,Number(model.id));return{root,modelRowId:Number(model.id),set}}
function refs(set:ReturnType<typeof materializeCanonicalTestSet>){const value=set.value as CanonicalTestSetV2|CanonicalTestSetV3;return value.definitions.map(d=>({definitionId:d.id,definitionSchemaVersion:value.schemaVersion as 2|3,testSetId:value.testSetId,testSetRevision:value.revision,testSetContentHash:set.fingerprint}))}
function isSuiteError(code: string) {
  return (error: unknown) => error instanceof SuiteContractError && error.code === code
}

async function acceptedSuiteExecution(label: string) {
  const context=await setup()
  const service=new SuiteService(undefined,()=>NOW,()=>`suite-results-${label}`)
  const suite=await service.create({
    projectId:PROJECT,changeIntentKey:`create-results-${label}`,name:`Results ${label} Sanity`,members:refs(context.set),
  })
  const manifestItems=[
    {itemOrdinal:1,definitionId:'definition-a',executablePlanHash:'f'.repeat(64)},
    {itemOrdinal:2,definitionId:'definition-b',executablePlanHash:'0'.repeat(64)},
  ]
  const input:BeginExecutionInput={
    executionId:`execution-results-${label}`,projectId:PROJECT,processInstanceId:`process-results-${label}`,
    startedAt:NOW,executionPlanHash:require('node:crypto').createHash('sha256').update(JSON.stringify({
      schemaVersion:1,planFingerprints:manifestItems.map(item=>item.executablePlanHash),
    })).digest('hex'),executionIntentKey:`run-results-${label}`,executionIntentFingerprint:'c'.repeat(64),
    expectedTestSetId:'test-set-m2',expectedRevision:1,expectedTestSetContentHash:context.set.fingerprint,
    definitionSchemaVersion:2,expectedModelRowId:context.modelRowId,expectedModelVersion:'1.0.0',
    sourceObservationId:null,supportSealHash:HASH,routeEvidenceIdentityHash:'d'.repeat(64),
    authenticationExpectationIdentityHash:'e'.repeat(64),suiteAuthority:{
      suiteId:suite.suiteId,suiteRevision:suite.revision,suiteContentHash:suite.contentHash,
    },manifestItems,
  }
  const executions=new ExecutionRepository()
  assert.deepEqual(await executions.beginExecution(input),{kind:'accepted'})
  return {context,service,suite,input,executions}
}

async function assertSuiteProjectionInvalid(executionId:string, corruptedName?:string) {
  const service=new ExecutionResultProjectionService()
  const detail=await service.read(PROJECT,executionId)
  assert.equal(detail.kind,'integrity_invalid')
  if (detail.kind==='integrity_invalid') {
    assert.equal(detail.integrityWarnings.some(warning=>warning.code==='conflicting_provenance' && warning.severity==='error'),true)
  }
  if (corruptedName) assert.equal(JSON.stringify(detail).includes(corruptedName),false)
  const list=await service.list(PROJECT,10)
  const summary=list.executions.find(item=>item.executionId===executionId)
  assert.equal(summary?.integrityState,'invalid')
  assert.equal(summary?.reasonCode,'projection_integrity_invalid')
  assert.equal(summary?.selectionAuthority,undefined)
}

test('M2 Suite hashes and change fingerprints use only deterministic semantic material', () => {
  const definitionA: DefinitionRevisionRef = {
    definitionId: 'definition-a', definitionSchemaVersion: 2, testSetId: 'test-set-m2',
    testSetRevision: 1, testSetContentHash: HASH,
  }
  const definitionAReordered = {
    testSetContentHash: HASH, testSetRevision: 1, testSetId: 'test-set-m2',
    definitionSchemaVersion: 2 as const, definitionId: 'definition-a',
  }
  const definitionB: DefinitionRevisionRef = { ...definitionA, definitionId: 'definition-b' }
  const inheritedDefinition = Object.create({
    definitionId: 'definition-a', definitionSchemaVersion: 2, testSetId: 'test-set-m2',
    testSetRevision: 1, testSetContentHash: HASH,
  }) as DefinitionRevisionRef
  const suite = (members: DefinitionRevisionRef[] = [definitionA, definitionB]) => ({
    schemaVersion: 1 as const,
    suiteId: 'suite-11111111-1111-4111-8111-111111111111',
    projectId: PROJECT,
    revision: 1,
    name: 'Checkout Sanity',
    purpose: 'sanity' as const,
    members: members.map((definitionAuthority, index) => ({ ordinal: index + 1, definitionAuthority })),
    createdAt: NOW,
    provenance: {
      source: 'product_api' as const,
      changeKind: 'created' as const,
      priorRevision: null,
      changeIntentKey: 'create-k1',
      changeIntentFingerprint: 'b'.repeat(64),
    },
  })
  const change = (members: DefinitionRevisionRef[] = [definitionA, definitionB]) => ({
    operation: 'created' as const,
    projectId: PROJECT,
    suiteId: null,
    expectedRevision: null,
    name: 'Checkout Sanity',
    members,
  })
  const suiteBaseline = suiteHash(suite())
  const fingerprintBaseline = suiteChangeFingerprint(change())

  const reorderedSuiteInput = {
    provenance: {
      changeIntentFingerprint: 'b'.repeat(64), changeIntentKey: 'create-k1', priorRevision: null,
      changeKind: 'created' as const, source: 'product_api' as const,
    },
    createdAt: NOW,
    members: [{ definitionAuthority: definitionAReordered, ordinal: 1 }, { definitionAuthority: definitionB, ordinal: 2 }],
    purpose: 'sanity' as const,
    name: 'Checkout Sanity',
    revision: 1,
    projectId: PROJECT,
    suiteId: 'suite-11111111-1111-4111-8111-111111111111',
    schemaVersion: 1 as const,
  }
  const reorderedChangeInput = {
    members: [definitionAReordered, definitionB], name: 'Checkout Sanity', expectedRevision: null,
    suiteId: null, projectId: PROJECT, operation: 'created' as const,
  }
  assert.equal(suiteHash(reorderedSuiteInput), suiteBaseline)
  assert.equal(suiteChangeFingerprint(reorderedChangeInput), fingerprintBaseline)
  assert.equal(suiteHash(suite([inheritedDefinition, definitionB])), suiteBaseline)
  assert.equal(suiteChangeFingerprint(change([inheritedDefinition, definitionB])), fingerprintBaseline)

  const definitionWithIrrelevantField = { ...definitionA, callerMetadata: 'not-authority' } as DefinitionRevisionRef
  const suiteWithIrrelevantFields = Object.assign(suite([definitionWithIrrelevantField, definitionB]), {
    callerMetadata: 'not-authority',
  })
  const changeWithIrrelevantFields = Object.assign(change([definitionWithIrrelevantField, definitionB]), {
    callerMetadata: 'not-authority',
  })
  assert.equal(suiteHash(suiteWithIrrelevantFields), suiteBaseline)
  assert.equal(suiteChangeFingerprint(changeWithIrrelevantFields), fingerprintBaseline)

  assert.notEqual(suiteHash(suite([definitionB, definitionA])), suiteBaseline)
  assert.notEqual(suiteChangeFingerprint(change([definitionB, definitionA])), fingerprintBaseline)
  for (const mutation of [
    { definitionId: 'definition-c' },
    { definitionSchemaVersion: 3 as const },
    { testSetId: 'test-set-other' },
    { testSetRevision: 2 },
    { testSetContentHash: 'c'.repeat(64) },
  ]) {
    const changed = { ...definitionA, ...mutation }
    assert.notEqual(suiteHash(suite([changed, definitionB])), suiteBaseline)
    assert.notEqual(suiteChangeFingerprint(change([changed, definitionB])), fingerprintBaseline)
  }
  assert.notEqual(suiteHash({ ...suite(), name: 'Checkout Sanity Updated' }), suiteBaseline)
  assert.notEqual(suiteChangeFingerprint({ ...change(), name: 'Checkout Sanity Updated' }), fingerprintBaseline)

  const changeIntentMutations: Array<(
    value: ReturnType<typeof change>,
  ) => Parameters<typeof suiteChangeFingerprint>[0]> = [
    value => ({ ...value, operation: 'revised' }),
    value => ({ ...value, projectId: 'other-project' }),
    value => ({ ...value, suiteId: 'suite-11111111-1111-4111-8111-111111111111' }),
    value => ({ ...value, expectedRevision: 1 }),
  ]
  for (const mutate of changeIntentMutations) {
    assert.notEqual(suiteChangeFingerprint(mutate(change())), fingerprintBaseline)
  }

  const immutableMutations: Array<(value: ReturnType<typeof suite>) => Omit<CanonicalSuiteRevision, 'contentHash'>> = [
    value => ({ ...value, schemaVersion: 2 as any }),
    value => ({ ...value, suiteId: 'suite-22222222-2222-4222-8222-222222222222' }),
    value => ({ ...value, projectId: 'other-project' }),
    value => ({ ...value, revision: 2 }),
    value => ({ ...value, purpose: 'other' as any }),
    value => ({ ...value, createdAt: '2026-08-25T12:00:01.000Z' }),
    value => ({ ...value, members: value.members.map((member, index) => index === 0 ? { ...member, ordinal: 2 } : member) }),
    value => ({ ...value, provenance: { ...value.provenance, source: 'other' as any } }),
    value => ({ ...value, provenance: { ...value.provenance, changeKind: 'revised' } }),
    value => ({ ...value, provenance: { ...value.provenance, priorRevision: 1 } }),
    value => ({ ...value, provenance: { ...value.provenance, changeIntentKey: 'create-k2' } }),
    value => ({ ...value, provenance: { ...value.provenance, changeIntentFingerprint: 'c'.repeat(64) } }),
  ]
  for (const mutate of immutableMutations) assert.notEqual(suiteHash(mutate(suite())), suiteBaseline)
})

test('M2 Core-C rejects missing, inert, or weakened same-name Migration 032 triggers', async () => {
  const attacks: Array<{ name: keyof typeof MIGRATION_032_TRIGGER_DEFINITIONS_V1; replacement?: string }> = [
    { name: 'suites_guard_update', replacement: `CREATE TRIGGER suites_guard_update
      BEFORE UPDATE ON suites BEGIN SELECT 1; END` },
    { name: 'suites_no_delete' },
    { name: 'suite_revisions_immutable_update', replacement: `CREATE TRIGGER suite_revisions_immutable_update
      BEFORE UPDATE ON suite_revisions BEGIN SELECT 1; END` },
    { name: 'suite_revisions_immutable_delete' },
    { name: 'suite_revision_members_immutable_update', replacement: `CREATE TRIGGER suite_revision_members_immutable_update
      BEFORE UPDATE ON suite_revision_members BEGIN SELECT 1; END` },
    { name: 'suite_revision_members_immutable_delete', replacement: `CREATE TRIGGER suite_revision_members_immutable_delete
      BEFORE DELETE ON suite_revision_members BEGIN SELECT 1; END` },
    { name: 'execution_suite_authority_insert', replacement: `CREATE TRIGGER execution_suite_authority_insert
      BEFORE INSERT ON executions BEGIN SELECT 1; END` },
    { name: 'execution_suite_authority_match_insert', replacement: `CREATE TRIGGER execution_suite_authority_match_insert
      BEFORE INSERT ON executions BEGIN SELECT 1; END` },
  ]
  for (const attack of attacks) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),`forge-m2-trigger-${attack.name}-`))
    initDb(path.join(root,'forge.db'))
    try {
      await runMigrations()
      await runMigrations()
      await sql.raw(`DROP TRIGGER ${attack.name}`).execute(getDb())
      if (attack.replacement) await sql.raw(attack.replacement).execute(getDb())
      await assert.rejects(runMigrations(), error => error instanceof Error
        && error.name==='MigrationStateMismatchError'
        && /032_canonical_suite_revision_authority/.test(error.message))
      if (attack.replacement) await sql.raw(`DROP TRIGGER ${attack.name}`).execute(getDb())
      await sql.raw(MIGRATION_032_TRIGGER_DEFINITIONS_V1[attack.name]).execute(getDb())
      await runMigrations()
    } finally {
      await closeDb()
      fs.rmSync(root,{recursive:true,force:true})
    }
  }

  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forge-m2-trigger-formatting-'))
  initDb(path.join(root,'forge.db'))
  try {
    await runMigrations()
    await sql.raw('DROP TRIGGER suites_no_delete').execute(getDb())
    await sql.raw(`create trigger suites_no_delete
      before delete on suites
      begin
        -- harmless formatting and keyword casing
        select raise ( abort , 'Suite identity cannot be deleted' ) ;
      end ;`).execute(getDb())
    await runMigrations()
  } finally {
    await closeDb()
    fs.rmSync(root,{recursive:true,force:true})
  }
})

test('M2 Suite revision persistence, normalization, idempotency, immutability, and hostiles', async () => {
  const c = await setup()
  try {
    const service = new SuiteService(undefined, () => NOW, () => 'suite-11111111-1111-4111-8111-111111111111')
    const members = refs(c.set)
    const created = await service.create({
      projectId: PROJECT, changeIntentKey: 'create-k1', name: '  Checkout   Sanity  ', members,
    })
    assert.equal(created.revision, 1)
    assert.equal(created.name, 'Checkout Sanity')
    assert.deepEqual(created.members.map(member => member.definitionAuthority.definitionId), ['definition-a', 'definition-b'])
    assert.deepEqual(await service.create({
      projectId: PROJECT, changeIntentKey: 'create-k1', name: 'Checkout Sanity', members,
    }), created)
    assert.deepEqual(await service.read(PROJECT, created.suiteId, 1), created)
    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'control-name', name: 'Control\tName', members,
    }), isSuiteError('suite_integrity_invalid'))

    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'create-k1', name: 'Changed retry', members,
    }), isSuiteError('suite_change_intent_conflict'))
    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'empty-suite', name: 'Empty', members: [],
    }), isSuiteError('empty_suite'))
    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'large-suite', name: 'Large',
      members: Array.from({ length: 51 }, (_, index) => ({ ...members[0], definitionId: `definition-${index}` })),
    }), isSuiteError('too_many_suite_members'))
    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'duplicate-member', name: 'Duplicate', members: [members[0], members[0]],
    }), isSuiteError('duplicate_suite_member'))
    for (const [key, mutation] of [
      ['mixed-id', { testSetId: 'other-test-set' }],
      ['mixed-revision', { testSetRevision: 2 }],
      ['mixed-hash', { testSetContentHash: 'b'.repeat(64) }],
      ['mixed-schema', { definitionSchemaVersion: 3 }],
    ] as const) {
      await assert.rejects(service.create({
        projectId: PROJECT, changeIntentKey: key, name: key,
        members: [members[0], { ...members[1], ...mutation } as any],
      }), isSuiteError('suite_members_not_single_test_set'))
    }
    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'v1-member', name: 'V1',
      members: [{ ...members[0], definitionSchemaVersion: 1 } as any],
    }), isSuiteError('unsupported_definition_schema'))
    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'missing-definition', name: 'Missing definition',
      members: [{ ...members[0], definitionId: 'missing-definition' }],
    }), isSuiteError('definition_authority_mismatch'))
    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'missing-authority', name: 'Missing authority',
      members: [{ ...members[0], testSetId: 'absent-test-set', testSetContentHash: 'c'.repeat(64) }],
    }), isSuiteError('definition_authority_not_found'))
    await getDb().insertInto('test_set_revisions').values({
      test_set_id: 'foreign-test-set', revision: 1, project_id: 'foreign-project', generation_id: 'foreign-generation',
      schema_version: 2, source_observation_id: null, model_row_id: c.modelRowId, model_version: '1.0.0',
      observation_run_id: 'foreign-observation', support_seal_hash: HASH,
      characterization_policy_id: 'forge.fixture', characterization_policy_version: '1',
      generated_at: NOW, outcome: 'completed', definition_count: 1, payload_json: '{}', content_hash: 'b'.repeat(64),
    }).execute()
    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'cross-project', name: 'Cross project',
      members: [{ definitionId: 'foreign-definition', definitionSchemaVersion: 2,
        testSetId: 'foreign-test-set', testSetRevision: 1, testSetContentHash: 'b'.repeat(64) }],
    }), isSuiteError('cross_project_definition'))

    const secondService = new SuiteService(undefined, () => NOW, () => 'suite-33333333-3333-4333-8333-333333333333')
    await assert.rejects(secondService.create({
      projectId: PROJECT, changeIntentKey: 'duplicate-name', name: 'checkout sanity', members,
    }), isSuiteError('duplicate_suite_name'))
    await assert.rejects(service.revise({
      projectId: PROJECT, suiteId: created.suiteId, expectedRevision: 2,
      changeIntentKey: 'stale-edit', name: 'Renamed', members,
    }), isSuiteError('stale_suite_revision'))

    await getDb().insertInto('test_set_revisions').values({
      test_set_id: 'malformed-test-set', revision: 2, project_id: PROJECT, generation_id: 'malformed-generation',
      schema_version: 2, source_observation_id: null, model_row_id: c.modelRowId, model_version: '1.0.0',
      observation_run_id: 'malformed-observation', support_seal_hash: HASH,
      characterization_policy_id: 'forge.fixture', characterization_policy_version: '1',
      generated_at: NOW, outcome: 'completed', definition_count: 1, payload_json: '{}', content_hash: 'd'.repeat(64),
    }).execute()
    await assert.rejects(service.create({
      projectId: PROJECT, changeIntentKey: 'malformed-authority', name: 'Malformed authority',
      members: [{ definitionId: 'malformed-definition', definitionSchemaVersion: 2,
        testSetId: 'malformed-test-set', testSetRevision: 2, testSetContentHash: 'd'.repeat(64) }],
    }), isSuiteError('suite_integrity_invalid'))

    await assert.rejects(sql`UPDATE suite_revisions SET name='mutated' WHERE suite_id=${created.suiteId}`.execute(getDb()))
    await sql.raw('DROP TRIGGER suite_revision_members_immutable_delete').execute(getDb())
    await sql`DELETE FROM suite_revision_members WHERE suite_id=${created.suiteId} AND member_ordinal=1`.execute(getDb())
    await assert.rejects(new SuiteRepository().read(PROJECT, created.suiteId, 1), isSuiteError('suite_integrity_invalid'))

    const columns = await sql<{name:string}>`PRAGMA table_info(executions)`.execute(getDb())
    assert.equal(['suite_id', 'suite_revision', 'suite_content_hash'].every(
      name => columns.rows.some(column => column.name === name),
    ), true)
  } finally {
    await closeDb()
    fs.rmSync(c.root, { recursive: true, force: true })
  }
})

test('M2 Core-B binds Suite identity, revisions, reads, names, and intents to one immutable project', async () => {
  const c = await setup()
  const projectB = 'm2-suite-project-b'
  try {
    const modelB = await getDb().insertInto('app_models').values({
      app_name: projectB, version: '1.0.0', base_url: 'https://project-b.invalid', app_type: 'web',
      intake_mode: 'crawl', crawl_config_hash: HASH, page_count: 2, flow_count: 0, role_count: 0,
      model_json: '{}', crawled_at: NOW, crawled_by: 'engine', status: 'active', evidence_state: 'crawled',
      operation_id: null, candidate_hash: null, recovery_source_row_id: null, recovery_source_fingerprint: null,
    }).returning('id').executeTakeFirstOrThrow()
    const valueB = structuredClone(c.set.value) as CanonicalTestSetV2
    valueB.projectId = projectB
    valueB.testSetId = 'test-set-m2-b'
    valueB.generationId = 'generation-m2-b-1'
    valueB.canonicalSupport.modelRowId = Number(modelB.id)
    for (const definition of valueB.definitions) definition.provenance.modelRowId = Number(modelB.id)
    const setB = materializeCanonicalTestSet(valueB)
    await insertSet(setB, Number(modelB.id))

    const serviceA = new SuiteService(undefined, () => NOW, () => 'suite-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const serviceB = new SuiteService(undefined, () => NOW, () => 'suite-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    const suiteA = await serviceA.create({
      projectId: PROJECT, changeIntentKey: 'shared-project-intent', name: 'Shared Sanity', members: refs(c.set),
    })
    const suiteB = await serviceB.create({
      projectId: projectB, changeIntentKey: 'shared-project-intent', name: 'Shared Sanity', members: refs(setB),
    })
    assert.equal(suiteA.name, suiteB.name)
    assert.equal((await getDb().selectFrom('suite_revisions').select(({fn})=>fn.countAll<number>().as('count'))
      .where('change_intent_key','=','shared-project-intent').executeTakeFirstOrThrow()).count, 2)

    await assert.rejects(serviceB.revise({
      projectId: projectB, suiteId: suiteA.suiteId, expectedRevision: 1,
      changeIntentKey: 'cross-project-revise', name: 'Foreign Revision', members: refs(setB),
    }), isSuiteError('suite_not_found'))
    assert.equal((await getDb().selectFrom('suite_revisions').select(({fn})=>fn.countAll<number>().as('count'))
      .where('suite_id','=',suiteA.suiteId).executeTakeFirstOrThrow()).count, 1)
    assert.equal((await getDb().selectFrom('suites').select('current_revision')
      .where('suite_id','=',suiteA.suiteId).where('project_id','=',PROJECT).executeTakeFirstOrThrow()).current_revision, 1)

    const setBRow = await getDb().selectFrom('test_set_revisions').select('id')
      .where('project_id','=',projectB).where('test_set_id','=',valueB.testSetId).executeTakeFirstOrThrow()
    await assert.rejects(getDb().insertInto('suite_revisions').values({
      suite_id: suiteA.suiteId, revision: 2, project_id: projectB, name: 'Forged Revision',
      name_key: 'forged revision', purpose: 'sanity', definition_schema_version: 2,
      test_set_row_id: Number(setBRow.id), test_set_id: valueB.testSetId, test_set_revision: 1,
      test_set_content_hash: setB.fingerprint, created_at: NOW, provenance_source: 'product_api',
      change_kind: 'revised', prior_revision: 1, change_intent_key: 'direct-cross-project-attack',
      change_intent_fingerprint: 'e'.repeat(64), member_count: 1, content_hash: 'f'.repeat(64),
    }).execute())
    const wrongProjectAdvance = await getDb().updateTable('suites')
      .set({ current_revision: 2, name_key: 'wrong-project-head' })
      .where('suite_id','=',suiteA.suiteId).where('project_id','=',projectB).executeTakeFirst()
    assert.equal(Number(wrongProjectAdvance.numUpdatedRows), 0)

    const foreignKeys = await sql<{id:number;seq:number;table:string;from:string;to:string}>`
      PRAGMA foreign_key_list(suite_revisions)
    `.execute(getDb())
    assert.equal([...new Set(foreignKeys.rows.map(row=>Number(row.id)))].some(id => {
      const authority = foreignKeys.rows.filter(row=>Number(row.id)===id).sort((left,right)=>Number(left.seq)-Number(right.seq))
      return authority.length===2 && authority.every(row=>row.table==='suites')
        && authority[0].from==='suite_id' && authority[0].to==='suite_id'
        && authority[1].from==='project_id' && authority[1].to==='project_id'
    }), true)

    const revisedA = await serviceA.revise({
      projectId: PROJECT, suiteId: suiteA.suiteId, expectedRevision: 1,
      changeIntentKey: 'normal-project-a-revision', name: 'Shared Sanity Revised', members: refs(c.set),
    })
    assert.equal(revisedA.revision, 2)
    assert.deepEqual(await serviceA.read(PROJECT, suiteA.suiteId, 1), suiteA)
    await assert.rejects(serviceB.read(projectB, suiteA.suiteId, 1), isSuiteError('suite_not_found'))
  } finally {
    await closeDb()
    fs.rmSync(c.root, { recursive: true, force: true })
  }
})

test('M2 saves and reopens a current one-member v3 Suite revision', async () => {
  const c = await setup()
  try {
    const testSet = v3Fixture(c.modelRowId, 2)
    await insertSet(testSet, c.modelRowId)
    const service = new SuiteService(undefined, () => NOW, () => 'suite-55555555-5555-4555-8555-555555555555')
    const suite = await service.create({
      projectId: PROJECT, changeIntentKey: 'create-v3-suite', name: 'Observed Flow Sanity', members: refs(testSet),
    })
    assert.equal(suite.revision, 1)
    assert.equal(suite.members.length, 1)
    assert.equal(suite.members[0].definitionAuthority.definitionSchemaVersion, 3)
    assert.deepEqual(await service.read(PROJECT, suite.suiteId, 1), suite)
  } finally {
    await closeDb()
    fs.rmSync(c.root, { recursive: true, force: true })
  }
})

test('M2 acceptance preserves order/provenance, replays K1, projects immutable Suite, and fences stale authority', async () => {
  const c = await setup()
  try {
    const service = new SuiteService(undefined, () => NOW, () => 'suite-22222222-2222-4222-8222-222222222222')
    const suite = await service.create({
      projectId: PROJECT, changeIntentKey: 'create-execution-suite', name: 'Checkout Sanity', members: refs(c.set),
    })
    const repo = new ExecutionRepository()
    const input: BeginExecutionInput = {
      executionId: 'execution-m2-suite', projectId: PROJECT, processInstanceId: 'process-m2-suite',
      startedAt: NOW, executionPlanHash: 'b'.repeat(64), executionIntentKey: 'run-k1',
      executionIntentFingerprint: 'c'.repeat(64), expectedTestSetId: 'test-set-m2', expectedRevision: 1,
      expectedTestSetContentHash: c.set.fingerprint, definitionSchemaVersion: 2,
      expectedModelRowId: c.modelRowId, expectedModelVersion: '1.0.0', sourceObservationId: null,
      supportSealHash: HASH, routeEvidenceIdentityHash: 'd'.repeat(64),
      authenticationExpectationIdentityHash: 'e'.repeat(64),
      suiteAuthority: { suiteId: suite.suiteId, suiteRevision: 1, suiteContentHash: suite.contentHash },
      manifestItems: [
        { itemOrdinal: 1, definitionId: 'definition-a', executablePlanHash: 'f'.repeat(64) },
        { itemOrdinal: 2, definitionId: 'definition-b', executablePlanHash: '0'.repeat(64) },
      ],
    }
    input.executionPlanHash = require('node:crypto').createHash('sha256').update(JSON.stringify({
      schemaVersion: 1, planFingerprints: input.manifestItems.map(item => item.executablePlanHash),
    })).digest('hex')
    assert.deepEqual(await repo.beginExecution(input), { kind: 'accepted' })
    const root = await getDb().selectFrom('executions').selectAll()
      .where('execution_id', '=', input.executionId).executeTakeFirstOrThrow()
    assert.deepEqual([root.suite_id, root.suite_revision, root.suite_content_hash], [suite.suiteId, 1, suite.contentHash])
    assert.deepEqual((await getDb().selectFrom('execution_items').selectAll()
      .where('execution_id', '=', input.executionId).orderBy('item_ordinal').execute())
      .map(item => item.definition_id), ['definition-a', 'definition-b'])
    assert.equal((await repo.beginExecution({ ...input, executionId: 'must-not-exist' })).kind, 'replayed')
    const resultProjection = new ExecutionResultProjectionService()
    const expectedSelection = {
      kind: 'suite_revision' as const, suiteId: suite.suiteId, suiteRevision: 1,
      suiteContentHash: suite.contentHash, name: 'Checkout Sanity', purpose: 'sanity' as const,
    }
    const projection = await resultProjection.read(PROJECT, input.executionId)
    assert.equal(projection.kind, 'ok')
    if (projection.kind === 'ok') assert.deepEqual(projection.projection.execution.selectionAuthority, expectedSelection)

    const revised = await service.revise({
      projectId: PROJECT, suiteId: suite.suiteId, expectedRevision: 1, changeIntentKey: 'revise-suite-head',
      name: 'Renamed Checkout Sanity', members: [...refs(c.set)].reverse(),
    })
    assert.equal(revised.revision, 2)
    assert.deepEqual(revised.members.map(member => member.definitionAuthority.definitionId), ['definition-b', 'definition-a'])
    const historicalProjection = await resultProjection.read(PROJECT, input.executionId)
    assert.equal(historicalProjection.kind, 'ok')
    if (historicalProjection.kind === 'ok') {
      assert.deepEqual(historicalProjection.projection.execution.selectionAuthority, expectedSelection)
    }

    await repo.completeExecution(PROJECT, input.executionId, input.processInstanceId, '2026-08-25T12:00:01.000Z')
    const wrongOrder = [
      { ...input.manifestItems[1], itemOrdinal: 1 },
      { ...input.manifestItems[0], itemOrdinal: 2 },
    ]
    await assert.rejects(repo.beginExecution({
      ...input, executionId: 'execution-wrong-order', executionIntentKey: 'run-wrong-order',
      executionIntentFingerprint: '9'.repeat(64),
      executionPlanHash: require('node:crypto').createHash('sha256').update(JSON.stringify({
        schemaVersion: 1, planFingerprints: wrongOrder.map(item => item.executablePlanHash),
      })).digest('hex'),
      manifestItems: wrongOrder,
    }), SuiteExecutionIntegrityError)
    const newer = fixture(c.modelRowId, 2, 'generation-m2-2')
    await insertSet(newer, c.modelRowId)
    await assert.rejects(repo.beginExecution({
      ...input, executionId: 'execution-stale', executionIntentKey: 'run-k2', executionIntentFingerprint: '1'.repeat(64),
    }), (error: unknown) => error instanceof StaleExecutionAuthorityError && error.code === 'stale_suite_authority')
    assert.deepEqual(await service.read(PROJECT, suite.suiteId, 1), suite)
  } finally {
    await closeDb()
    fs.rmSync(c.root, { recursive: true, force: true })
  }
})

test('M2 Core-D Results rejects independently corrupted accepted Suite authority without fallback', async () => {
  const attacks: Array<{label:string;corruptedName?:string;mutate:(fixture:Awaited<ReturnType<typeof acceptedSuiteExecution>>)=>Promise<void>}> = [
    {label:'corrupt-name',corruptedName:'Corrupted Result Name',mutate:async ({suite})=>{
      await sql.raw('DROP TRIGGER suite_revisions_immutable_update').execute(getDb())
      await getDb().updateTable('suite_revisions').set({name:'Corrupted Result Name'})
        .where('suite_id','=',suite.suiteId).where('revision','=',1).execute()
      assert.equal((await getDb().selectFrom('suite_revisions').select('content_hash')
        .where('suite_id','=',suite.suiteId).where('revision','=',1).executeTakeFirstOrThrow()).content_hash,suite.contentHash)
    }},
    {label:'corrupt-order',mutate:async ({suite})=>{
      await sql.raw('DROP TRIGGER suite_revision_members_immutable_update').execute(getDb())
      await getDb().updateTable('suite_revision_members').set({definition_id:'temporary-definition'})
        .where('suite_id','=',suite.suiteId).where('suite_revision','=',1).where('member_ordinal','=',1).execute()
      await getDb().updateTable('suite_revision_members').set({definition_id:'definition-a'})
        .where('suite_id','=',suite.suiteId).where('suite_revision','=',1).where('member_ordinal','=',2).execute()
      await getDb().updateTable('suite_revision_members').set({definition_id:'definition-b'})
        .where('suite_id','=',suite.suiteId).where('suite_revision','=',1).where('member_ordinal','=',1).execute()
      assert.equal((await getDb().selectFrom('suite_revisions').select('content_hash')
        .where('suite_id','=',suite.suiteId).where('revision','=',1).executeTakeFirstOrThrow()).content_hash,suite.contentHash)
    }},
    {label:'corrupt-suite-hash',mutate:async ({suite,input})=>{
      await sql.raw('DROP TRIGGER suite_revisions_immutable_update').execute(getDb())
      await getDb().updateTable('suite_revisions').set({content_hash:'9'.repeat(64)})
        .where('suite_id','=',suite.suiteId).where('revision','=',1).execute()
      assert.equal((await getDb().selectFrom('executions').select('suite_content_hash')
        .where('execution_id','=',input.executionId).executeTakeFirstOrThrow()).suite_content_hash,suite.contentHash)
    }},
    {label:'corrupt-execution-hash',mutate:async ({suite,input})=>{
      await sql.raw('DROP TRIGGER executions_immutable_update').execute(getDb())
      await getDb().updateTable('executions').set({suite_content_hash:'9'.repeat(64)})
        .where('execution_id','=',input.executionId).execute()
      assert.equal((await getDb().selectFrom('suite_revisions').select('content_hash')
        .where('suite_id','=',suite.suiteId).where('revision','=',1).executeTakeFirstOrThrow()).content_hash,suite.contentHash)
    }},
    {label:'missing-historical-revision',mutate:async ({context,service,suite})=>{
      const revised=await service.revise({projectId:PROJECT,suiteId:suite.suiteId,expectedRevision:1,
        changeIntentKey:'results-head-revision',name:'Current Head Must Not Repair Results',members:[...refs(context.set)].reverse()})
      assert.equal(revised.revision,2)
      assert.equal((await getDb().selectFrom('suites').select('current_revision')
        .where('suite_id','=',suite.suiteId).where('project_id','=',PROJECT).executeTakeFirstOrThrow()).current_revision,2)
      await sql.raw('DROP TRIGGER suite_revision_members_immutable_delete').execute(getDb())
      await sql.raw('DROP TRIGGER suite_revisions_immutable_delete').execute(getDb())
      await getDb().deleteFrom('suite_revision_members').where('suite_id','=',suite.suiteId).where('suite_revision','=',1).execute()
      await getDb().deleteFrom('suite_revisions').where('suite_id','=',suite.suiteId).where('revision','=',1).execute()
    }},
  ]
  for (const attack of attacks) {
    const fixture=await acceptedSuiteExecution(attack.label)
    try {
      await attack.mutate(fixture)
      await assertSuiteProjectionInvalid(fixture.input.executionId,attack.corruptedName)
    } finally {
      await closeDb()
      fs.rmSync(fixture.context.root,{recursive:true,force:true})
    }
  }
})

test('M2 Core-D Results ignores legacy result Suite text and preserves direct-definition behavior', async () => {
  const fixture=await acceptedSuiteExecution('legacy-suite-column')
  try {
    let resultOrdinal=0
    const coordinator=new ExecutionRunCoordinator(
      getDb,undefined,undefined,fixture.executions,()=> 'run-results-legacy',()=> `result-results-legacy-${++resultOrdinal}`,
    )
    const run=await coordinator.admitRun({executionId:fixture.input.executionId,projectId:PROJECT,
      processInstanceId:fixture.input.processInstanceId,expectedResultCount:2,runnerAdapter:'playwright-plan-executor/v1',
      environmentSnapshot:{environment:'local',browser:'chromium',headless:true},startedAt:NOW})
    for (const item of fixture.input.manifestItems) await coordinator.recordResult({
      executionId:fixture.input.executionId,runId:run.run_id,itemOrdinal:item.itemOrdinal,
      plan:{fingerprint:item.executablePlanHash,value:{definitionId:item.definitionId}} as any,
      observed:{status:'executor_failure',reasonCode:'executor_failure'},startedAt:NOW,completedAt:'2026-08-25T12:00:01.000Z',
    })
    const legacySuites=new Set((await getDb().selectFrom('test_results').select('suite')
      .where('run_id','=',run.run_id).execute()).map(row=>row.suite))
    assert.deepEqual(legacySuites,new Set(['product-execution']))
    assert.equal(legacySuites.has(fixture.suite.name),false)
    const suiteRead=await new ExecutionResultProjectionService().read(PROJECT,fixture.input.executionId)
    assert.equal(suiteRead.kind,'ok')
    if (suiteRead.kind==='ok') assert.equal(suiteRead.projection.execution.selectionAuthority?.name,fixture.suite.name)
    await coordinator.terminalize({executionId:fixture.input.executionId,projectId:PROJECT,
      processInstanceId:fixture.input.processInstanceId,runId:run.run_id,completedAt:'2026-08-25T12:00:02.000Z'})

    const directInput={...fixture.input,executionId:'execution-results-direct',executionIntentKey:'run-results-direct',
      executionIntentFingerprint:'8'.repeat(64),suiteAuthority:undefined}
    assert.deepEqual(await fixture.executions.beginExecution(directInput),{kind:'accepted'})
    const directRead=await new ExecutionResultProjectionService().read(PROJECT,directInput.executionId)
    assert.equal(directRead.kind,'ok')
    if (directRead.kind==='ok') assert.equal(directRead.projection.execution.selectionAuthority,undefined)
  } finally {
    await closeDb()
    fs.rmSync(fixture.context.root,{recursive:true,force:true})
  }
})

test('M2 Start accepts Suite identity only, preserves Suite order, and rejects client authority injection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m2-start-'))
  initDb(path.join(root, 'forge.db'))
  const authority = refs(fixture(7, 1, 'generation-start'))
  const suite = {
    schemaVersion: 1 as const, suiteId: 'suite-44444444-4444-4444-8444-444444444444', projectId: PROJECT,
    revision: 1, name: 'Checkout Sanity', purpose: 'sanity' as const,
    members: authority.map((definitionAuthority, index) => ({ ordinal: index + 1, definitionAuthority })),
    createdAt: NOW, provenance: { source: 'product_api' as const, changeKind: 'created' as const, priorRevision: null,
      changeIntentKey: 'suite-start-create', changeIntentFingerprint: '2'.repeat(64) }, contentHash: '3'.repeat(64),
  }
  const plan = (definitionId: string, fingerprint: string) => ({ fingerprint, value: {
    schemaVersion: 2 as const, definitionId, category: 'navigation' as const,
    steps: [{ kind: 'navigate_to_observed_route' as const, subjectId: definitionId, routePath: '/inventory.html' }],
    oracle: { kind: 'subject_observable' as const, subjectId: definitionId, assertion: 'final_url_matches_route_no_navigation_error' as const },
    provenance: { routeEvidenceIdentityHash: '4'.repeat(64), authenticationExpectationIdentityHash: '5'.repeat(64) },
  } })
  const plans = [plan('definition-a', '6'.repeat(64)), plan('definition-b', '7'.repeat(64))] as any
  let accepted: BeginExecutionInput | null = null
  const repository: any = {
    findExecutionIntent: async () => accepted ? {
      executionId: accepted.executionId, acceptedAt: accepted.startedAt,
      executionPlanHash: accepted.executionPlanHash, requestFingerprint: accepted.executionIntentFingerprint,
    } : null,
    beginExecution: async (input: BeginExecutionInput) => { accepted = input; return { kind: 'accepted' as const } },
    heartbeat: async () => undefined, completeExecution: async () => undefined, failExecution: async () => undefined,
    requestCancellation: async () => ({ kind: 'not_found' as const }),
  }
  const lifecycle = new ExecutionService({
    repository, suites: { read: async (_projectId: string, _suiteId: string, revision: number) => revision === 1
      ? suite : { ...suite, revision: 2, name: 'Changed Suite', contentHash: '8'.repeat(64),
        provenance: { ...suite.provenance, changeKind: 'revised' as const, priorRevision: 1 } } },
    migrate: async () => undefined,
    recovery: { reconcileProject: async () => null, reconcile: async () => ({ action: 'none', status: null }) } as any,
    coordinator: { admitRun: async () => ({ run_id: 'run-suite-start' }), recordResult: async () => undefined,
      terminalize: async () => undefined, terminalizeCancellation: async () => undefined } as any,
    executor: { execute: async () => ({ status: 'completed', reasonCode: 'completed', finalUrl: 'https://example.invalid/inventory.html' }) } as any,
    mintExecutionId: () => 'execution-suite-start', mintCancellationTokenId: () => 'token-suite-start',
    processInstanceId: 'process-suite-start', now: () => NOW,
  })
  ;(lifecycle as any).preflight = async () => ({ kind: 'ready', plans, suiteAuthority: suite,
    definitionResults: [], current: { contentHash: authority[0].testSetContentHash, testSet: { schemaVersion: 2, testSetId: authority[0].testSetId, revision: 1 } },
    authority: { sealedAuthority: { modelRowId: 7, modelVersion: '1.0.0', supportSealHash: HASH } } })
  const request = { projectId: PROJECT, executionIntentKey: 'suite-start-k1',
    selection: { kind: 'suite_revision' as const, suiteId: suite.suiteId, suiteRevision: 1 }, workspaceRoot: '.',
    credentialReference: { usernameEnv: 'FIXTURE_USERNAME', passwordEnv: 'FIXTURE_PASSWORD' }, runtime: { baseUrl: 'https://example.invalid' } }
  const result = await lifecycle.start(request)
  assert.equal(result.kind, 'accepted')
  assert.deepEqual(accepted?.manifestItems.map(item => item.definitionId), ['definition-a', 'definition-b'])
  assert.deepEqual(accepted?.suiteAuthority, { suiteId: suite.suiteId, suiteRevision: 1, suiteContentHash: suite.contentHash })
  const replay = await lifecycle.start(request)
  assert.equal(replay.kind === 'accepted' && replay.replayed, true)
  const conflict = await lifecycle.start({
    ...request, selection: { ...request.selection, suiteRevision: 2 },
  })
  assert.deepEqual(conflict.kind === 'rejected' && conflict.code, 'execution_intent_conflict')
  const injected = await lifecycle.start({ ...request, executionIntentKey: 'suite-start-injected', members: [] } as any)
  assert.deepEqual(injected.kind === 'rejected' && injected.code, 'invalid_request')
  await closeDb()
  fs.rmSync(root, { recursive: true, force: true })
})
