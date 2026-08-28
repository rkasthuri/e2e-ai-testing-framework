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
import * as os from 'node:os'
import * as path from 'node:path'
import express from 'express'
import projectsRouter from '../forge-ui/server/routes/projects'
import {
  analyzeManualTest,
  parseManualTestAnalyzeRequestDto,
  parseManualTestSaveRequestDto,
  saveManualTest,
} from '../forge-ui/server/context/ManualTestController'
import {
  ExecutionContext,
  executionContext,
  parseProductManualTestAnalyzeResponse,
} from '../forge-ui/server/context/ExecutionContext'
import { WorkspaceResolver } from '../forge-ui/server/context/WorkspaceResolver'
import { closeDb } from '../src/core/storage/db'
import { ManualTestPromotionError } from '../src/core/test-design/ManualTestIngestionService'

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'm3-contract')
const PROJECT = 'project-storefront'

function fixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))
}

function analyzeBody(): Record<string, unknown> {
  const source = fixture('positive-manual-source.json')
  return {
    schemaVersion: 'forge-manual-test-source-input/v1',
    sourceKind: source.sourceKind,
    title: source.title,
    objective: source.objective,
    steps: source.steps,
    expectedOutcome: source.expectedOutcome,
  }
}

function admittedSource(projectId = PROJECT): Record<string, unknown> {
  return { ...fixture('positive-manual-source.json'), projectId }
}

function supportedAnalysis(projectId = PROJECT): Record<string, unknown> {
  const proposal = fixture('positive-automation-proposal.json')
  proposal.projectId = projectId
  proposal.normalizedIntent.projectId = projectId
  return {
    schemaVersion: 'forge-manual-analysis-result/v1',
    outcome: { kind: 'proposal', proposal },
  }
}

function admittedSourceForAnalysis(analysis: any): Record<string, unknown> {
  const authority = analysis.outcome.kind === 'proposal'
    ? analysis.outcome.proposal.sourceAuthority
    : analysis.outcome.refusal.sourceAuthority
  const source = admittedSource()
  const grounding = analysis.outcome.kind === 'proposal'
    ? analysis.outcome.proposal.sourceGrounding
    : analysis.outcome.refusal.sourceGrounding
  const stepCount = grounding.length - 1
  return {
    ...source,
    sourceId: authority.sourceId,
    contentHash: authority.sourceContentHash,
    steps: Array.from({ length: stepCount }, (_, index) => ({
      ordinal: index + 1,
      text: (source.steps as any[])[index]?.text ?? `Authored manual step ${index + 1}.`,
    })),
  }
}

function saveBody(): Record<string, unknown> {
  const result = fixture('positive-save-result.json')
  return {
    schemaVersion: 'forge-manual-promotion-request/v1',
    sourceAuthority: result.sourceAuthority,
    reviewedProposalAuthority: {
      proposalId: result.proposalAuthority.proposalId,
      proposalContentHash: result.proposalAuthority.proposalContentHash,
    },
  }
}

const resolveProject = async (appName: string) => appName === PROJECT ? { appName } : undefined

function engine(overrides: Partial<{
  analyzeProductManualTest(appName: string, body: unknown): Promise<unknown>
  saveProductManualTest(appName: string, body: unknown): Promise<unknown>
}> = {}) {
  return {
    analyzeProductManualTest: async () => ({ source: admittedSource(), analysis: supportedAnalysis() }),
    saveProductManualTest: async () => fixture('positive-save-result.json'),
    ...overrides,
  } as any
}

function errorCode(result: { body: unknown }): string | undefined {
  return (result.body as { code?: string }).code
}

test('Analyze exact shared source input returns the admitted source and supported analysis exactly', async () => {
  const expected = { source: admittedSource(), analysis: supportedAnalysis() }
  let received: unknown
  const result = await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, engine({
    analyzeProductManualTest: async (_appName, body) => { received = body; return expected },
  }))
  assert.equal(result.status, 200)
  assert.deepEqual((result.body as any).data, expected)
  assert.deepEqual(received, analyzeBody())
})

test('all four semantic Analyze refusals remain 200 and preserve the admitted source', async t => {
  for (const [file, code] of [
    ['insufficient-outcome.json', 'insufficient_evidence'],
    ['ambiguous-control.json', 'ambiguous_evidence'],
    ['unsupported-fill.json', 'unsupported_semantics'],
    ['app-area-unknown.json', 'app_area_unknown'],
  ] as const) await t.test(code, async () => {
    const analysis = fixture(file)
    const source = admittedSourceForAnalysis(analysis)
    const result = await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, engine({
      analyzeProductManualTest: async () => ({ source, analysis }),
    }))
    assert.equal(result.status, 200)
    assert.deepEqual((result.body as any).data.source, source)
    assert.deepEqual((result.body as any).data.analysis, analysis)
    assert.equal((result.body as any).data.analysis.outcome.refusal.code, code)
  })
})

test('MANUAL_SOURCE_INVALID is distinct from a valid semantic refusal and malformed input never reaches Analyze', async () => {
  let calls = 0
  const refusal = fixture('unsupported-fill.json')
  const semantic = await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, engine({
    analyzeProductManualTest: async () => {
      calls += 1
      return { source: admittedSourceForAnalysis(refusal), analysis: refusal }
    },
  }))
  const malformed = await analyzeManualTest(PROJECT, { ...analyzeBody(), unexpected: true }, resolveProject, engine({
    analyzeProductManualTest: async () => { calls += 1; throw new Error('must not run') },
  }))
  assert.equal(semantic.status, 200)
  assert.equal((semantic.body as any).data.analysis.outcome.refusal.code, 'unsupported_semantics')
  assert.equal(malformed.status, 400)
  assert.equal(errorCode(malformed), 'MANUAL_SOURCE_INVALID')
  assert.equal(calls, 1)
})

test('malformed dynamic Analyze results fail closed before HTTP 200 emission', async t => {
  const proposalCases: Array<[string, (response: any) => void]> = [
    ['proposal nested extra key', response => { response.analysis.outcome.proposal.oracle.unexpected = true }],
    ['appArea string', response => { response.analysis.outcome.proposal.appArea = 'checkout' }],
    ['appArea object shape', response => { response.analysis.outcome.proposal.appArea.unexpected = true }],
    ['swapped grounding basis', response => {
      response.analysis.outcome.proposal.sourceGrounding[0].basis = {
        kind: 'observed_flow_step', flowStepIndex: 0, evidenceIds: ['obs-cart-route'],
      }
    }],
    ['wrong source ordinal', response => { response.source.steps[0].ordinal = 0 }],
    ['wrong canonical ordinal', response => { response.analysis.outcome.proposal.canonicalActions[0].ordinal = 1 }],
    ['malformed nested SafeOpaqueId', response => { response.analysis.outcome.proposal.normalizedIntent.steps[1].elementId = 'bad id' }],
    ['malformed nested hash', response => { response.analysis.outcome.proposal.authority.supportSealHash = 'not-a-hash' }],
    ['malformed nested type', response => { response.analysis.outcome.proposal.authority.modelRowId = '42' }],
    ['unknown outcome variant', response => { response.analysis.outcome = { kind: 'future', future: {} } }],
  ]
  for (const [label, mutate] of proposalCases) await t.test(label, async () => {
    const response: any = { source: admittedSource(), analysis: supportedAnalysis() }
    mutate(response)
    const result = await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, engine({
      analyzeProductManualTest: async () => response,
    }))
    assert.equal(result.status, 500)
    assert.equal(errorCode(result), 'INTERNAL_ERROR')
  })

  const refusal = fixture('insufficient-outcome.json')
  const refusalResponse: any = { source: admittedSourceForAnalysis(refusal), analysis: refusal }
  refusalResponse.analysis.outcome.refusal.sourceAuthority.unexpected = true
  const refused = await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, engine({
    analyzeProductManualTest: async () => refusalResponse,
  }))
  assert.equal(refused.status, 500)
  assert.equal(errorCode(refused), 'INTERNAL_ERROR')

  const refusalGroundingCases: Array<[string, (grounding: any[]) => void]> = [
    ['action0 + observed_flow_step', grounding => {
      grounding[0].basis = { kind: 'observed_flow_step', flowStepIndex: 0, evidenceIds: [] }
    }],
    ['action0 + governed_route + non-null flowStepIndex', grounding => {
      grounding[0].basis.flowStepIndex = 0
    }],
    ['action1 + governed_route', grounding => {
      grounding[2].basis = { kind: 'governed_route', flowStepIndex: null, evidenceIds: [] }
    }],
    ['action1 + observed_flow_step + null index', grounding => {
      grounding[2].basis.flowStepIndex = null
    }],
    ['action1 + observed_flow_step + negative index', grounding => {
      grounding[2].basis.flowStepIndex = -1
    }],
    ['action1 + observed_flow_step + fractional index', grounding => {
      grounding[2].basis.flowStepIndex = 0.5
    }],
    ['oracle + governed_route', grounding => {
      grounding[3].basis = { kind: 'governed_route', flowStepIndex: null, evidenceIds: [] }
    }],
    ['oracle + observed_flow_step', grounding => {
      grounding[3].basis = { kind: 'observed_flow_step', flowStepIndex: 0, evidenceIds: [] }
    }],
    ['oracle + governed_subject + non-null index', grounding => {
      grounding[3].basis.flowStepIndex = 0
    }],
  ]
  for (const [label, mutate] of refusalGroundingCases) await t.test(`refusal ${label}`, async () => {
    const hostile = fixture('unsupported-fill.json')
    mutate(hostile.outcome.refusal.sourceGrounding)
    const response = { source: admittedSourceForAnalysis(hostile), analysis: hostile }
    const result = await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, engine({
      analyzeProductManualTest: async () => response,
    }))
    assert.equal(result.status, 500)
    assert.equal(errorCode(result), 'INTERNAL_ERROR')
  })
})

test('Analyze refusal self-falsification: former independent shape checks accept mismatched coupling, repaired boundary rejects it', async () => {
  const analysis = fixture('insufficient-outcome.json')
  const grounding = analysis.outcome.refusal.sourceGrounding[0]
  grounding.basis = { kind: 'observed_flow_step', flowStepIndex: 0, evidenceIds: [] }
  const formerIndependentShapeAcceptance = grounding.canonicalBinding.kind === 'action'
    && [0, 1].includes(grounding.canonicalBinding.ordinal)
    && grounding.basis.kind === 'observed_flow_step'
    && Number.isSafeInteger(grounding.basis.flowStepIndex)
    && grounding.basis.flowStepIndex >= 0
  assert.equal(formerIndependentShapeAcceptance, true)
  const response = { source: admittedSourceForAnalysis(analysis), analysis }
  const repaired = await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, engine({
    analyzeProductManualTest: async () => response,
  }))
  assert.equal(repaired.status, 500)
  assert.equal(errorCode(repaired), 'INTERNAL_ERROR')
})

test('Analyze self-falsification: the former broad outcome accepts string appArea, repaired boundary refuses it', async () => {
  const malformed: any = { source: admittedSource(), analysis: supportedAnalysis() }
  malformed.analysis.outcome.proposal.appArea = 'checkout'
  const formerBroadOutcomeAcceptance = malformed.analysis.outcome !== null
    && typeof malformed.analysis.outcome === 'object'
    && !Array.isArray(malformed.analysis.outcome)
  assert.equal(formerBroadOutcomeAcceptance, true,
    'Record<string, unknown> plus an unchecked response assertion accepts this malformed nested payload')
  const repaired = await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, engine({
    analyzeProductManualTest: async () => malformed,
  }))
  assert.equal(repaired.status, 500)
  assert.equal(errorCode(repaired), 'INTERNAL_ERROR')
})

test('Analyze decoder enforces the frozen exact contract including nested step keys', () => {
  assert.deepEqual(parseManualTestAnalyzeRequestDto(analyzeBody()), analyzeBody())
  for (const hostile of [
    { ...analyzeBody(), projectId: PROJECT },
    { ...analyzeBody(), authentication: { username: 'caller' } },
    { ...analyzeBody(), steps: [{ ordinal: 1, text: 'Open the cart page.', selector: '#cart' }] },
    { ...analyzeBody(), steps: [{ ordinal: 2, text: 'wrong ordinal' }] },
  ]) assert.equal(parseManualTestAnalyzeRequestDto(hostile), null)
})

test('project/context mismatch is rejected before either M3 service path', async () => {
  let calls = 0
  const mismatch = async () => ({ appName: 'different-project' })
  const transport = engine({
    analyzeProductManualTest: async () => { calls += 1 },
    saveProductManualTest: async () => { calls += 1 },
  })
  assert.equal((await analyzeManualTest(PROJECT, analyzeBody(), mismatch, transport)).status, 404)
  assert.equal((await saveManualTest(PROJECT, saveBody(), mismatch, transport)).status, 404)
  assert.equal(calls, 0)
})

test('Save exact identity-only request returns ManualPromotionResultV1 exactly', async () => {
  const expected = fixture('positive-save-result.json')
  let received: unknown
  const result = await saveManualTest(PROJECT, saveBody(), resolveProject, engine({
    saveProductManualTest: async (_appName, body) => { received = body; return expected },
  }))
  assert.equal(result.status, 201)
  assert.deepEqual((result.body as any).data, expected)
  assert.deepEqual(received, saveBody())
})

test('every forbidden Save body injection is rejected before service invocation', async t => {
  const injections: Record<string, unknown> = {
    sourceText: 'Click Checkout.',
    actions: [{ kind: 'click' }],
    selector: '[data-test=checkout]',
    appArea: 'checkout',
    oracle: { kind: 'subject_observable' },
    authentication: { username: 'caller-controlled' },
    grounding: { evidenceIds: [] },
    definition: { schemaVersion: 3 },
  }
  for (const [key, value] of Object.entries(injections)) await t.test(key, async () => {
    let calls = 0
    const result = await saveManualTest(PROJECT, { ...saveBody(), [key]: value }, resolveProject, engine({
      saveProductManualTest: async () => { calls += 1; throw new Error('must not run') },
    }))
    assert.equal(result.status, 400)
    assert.equal(errorCode(result), 'INVALID_MANUAL_PROMOTION_REQUEST')
    assert.equal(calls, 0)
  })
})

test('Save self-falsification: a permissive arbitrary JSON handoff would carry a forbidden field, repaired decoding refuses it', async () => {
  const hostile = { ...saveBody(), arbitraryForbiddenField: { definitionBody: true } }
  let permissiveReceived: unknown
  await engine({ saveProductManualTest: async (_appName, body) => { permissiveReceived = body } })
    .saveProductManualTest(PROJECT, hostile)
  assert.deepEqual(permissiveReceived, hostile)
  assert.equal(parseManualTestSaveRequestDto(hostile), null)
  let repairedCalls = 0
  const repaired = await saveManualTest(PROJECT, hostile, resolveProject, engine({
    saveProductManualTest: async () => { repairedCalls += 1 },
  }))
  assert.equal(repaired.status, 400)
  assert.equal(repairedCalls, 0)
})

test('the four frozen governed Save failures retain their public mappings', async t => {
  for (const [code, status] of [
    ['SOURCE_PROPOSAL_MISMATCH', 409],
    ['MANUAL_PROMOTION_IDENTITY_CONFLICT', 409],
    ['STALE_REVIEWED_PROPOSAL', 409],
    ['MANUAL_PROPOSAL_NOT_EXECUTABLE', 422],
  ] as const) await t.test(code, async () => {
    const result = await saveManualTest(PROJECT, saveBody(), resolveProject, engine({
      saveProductManualTest: async () => { throw new ManualTestPromotionError(code) },
    }))
    assert.equal(result.status, status)
    assert.equal(errorCode(result), code)
  })
})

test('arbitrary colliding error codes have no Manual-test public error authority', async t => {
  for (const hostile of [
    Object.assign(new Error('collision'), { code: 'STALE_REVIEWED_PROPOSAL' }),
    Object.assign(new Error('collision'), { code: 'SOURCE_PROPOSAL_MISMATCH' }),
    Object.assign(new Error('collision'), { code: 'MANUAL_PROPOSAL_NOT_EXECUTABLE' }),
    Object.assign(new Error('collision'), { code: 'MANUAL_SOURCE_INVALID' }),
    { code: 'MANUAL_PROMOTION_IDENTITY_CONFLICT' },
  ]) await t.test(String((hostile as { code: string }).code), async () => {
    const analyze = await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, engine({
      analyzeProductManualTest: async () => { throw hostile },
    }))
    const save = await saveManualTest(PROJECT, saveBody(), resolveProject, engine({
      saveProductManualTest: async () => { throw hostile },
    }))
    for (const result of [analyze, save]) {
      assert.equal(result.status, 500)
      assert.equal(errorCode(result), 'INTERNAL_ERROR')
    }
  })
})

test('stale-code collision self-falsification distinguishes arbitrary and governed errors', async () => {
  const arbitrary = Object.assign(new Error('internal stale-shaped failure'), { code: 'STALE_REVIEWED_PROPOSAL' })
  assert.equal(arbitrary.code, new ManualTestPromotionError('STALE_REVIEWED_PROPOSAL').code,
    'pre-fix string-only classification cannot distinguish these failures')
  const attacked = await saveManualTest(PROJECT, saveBody(), resolveProject, engine({
    saveProductManualTest: async () => { throw arbitrary },
  }))
  const governed = await saveManualTest(PROJECT, saveBody(), resolveProject, engine({
    saveProductManualTest: async () => { throw new ManualTestPromotionError('STALE_REVIEWED_PROPOSAL') },
  }))
  assert.equal(attacked.status, 500)
  assert.equal(errorCode(attacked), 'INTERNAL_ERROR')
  assert.equal(governed.status, 409)
  assert.equal(errorCode(governed), 'STALE_REVIEWED_PROPOSAL')
})

test('unexpected Analyze and Save storage failures remain internal server errors', async () => {
  const unexpected = engine({
    analyzeProductManualTest: async () => { throw Object.assign(new Error('database failed'), { code: 'SQLITE_CONSTRAINT' }) },
    saveProductManualTest: async () => { throw Object.assign(new Error('database failed'), { code: 'SQLITE_CONSTRAINT' }) },
  })
  for (const result of [
    await analyzeManualTest(PROJECT, analyzeBody(), resolveProject, unexpected),
    await saveManualTest(PROJECT, saveBody(), resolveProject, unexpected),
  ]) {
    assert.equal(result.status, 500)
    assert.equal(errorCode(result), 'INTERNAL_ERROR')
  }
})

test('exact Save replay transports the original authority without changing its Test Set revision', async () => {
  const original = fixture('positive-save-result.json')
  let serviceCalls = 0
  const transport = engine({ saveProductManualTest: async () => { serviceCalls += 1; return original } })
  const first = await saveManualTest(PROJECT, saveBody(), resolveProject, transport)
  const replay = await saveManualTest(PROJECT, saveBody(), resolveProject, transport)
  assert.equal(serviceCalls, 2)
  assert.deepEqual((first.body as any).data, original)
  assert.deepEqual((replay.body as any).data, original)
  assert.equal((replay.body as any).data.definitionAuthority.testSetRevision,
    (first.body as any).data.definitionAuthority.testSetRevision)
})

test('real ExecutionContext Analyze binding scopes a disposable Product workspace and preserves the admitted source', async () => {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-m3-transport-'))
  const workspaceRoot = path.join(projectsRoot, PROJECT)
  fs.mkdirSync(path.join(workspaceRoot, '.forge'), { recursive: true })
  const context = new ExecutionContext(new WorkspaceResolver(projectsRoot))
  try {
    const result = await context.analyzeProductManualTest(PROJECT, analyzeBody())
    assert.equal(result.source.projectId, PROJECT)
    assert.equal(result.source.title, analyzeBody().title)
    assert.equal(result.analysis.schemaVersion, 'forge-manual-analysis-result/v1')
    assert.equal(result.analysis.outcome.kind, 'refusal')
  } finally {
    await closeDb()
    fs.rmSync(projectsRoot, { recursive: true, force: true })
  }
})

test('the real project router binds the exact M3 methods and leaves M1/M2 routes intact', async () => {
  const originalAnalyze = executionContext.analyzeProductManualTest
  const originalSave = executionContext.saveProductManualTest
  const source = admittedSource('saucedemo')
  const analysis = supportedAnalysis('saucedemo')
  const analyzeResponse = await parseProductManualTestAnalyzeResponse({ source, analysis })
  const promotion = fixture('positive-save-result.json')
  executionContext.analyzeProductManualTest = async () => analyzeResponse
  executionContext.saveProductManualTest = async () => promotion
  const app = express()
  app.use(express.json())
  app.use('/api/v1/projects', projectsRouter)
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}/api/v1/projects/saucedemo/manual-tests`
    const analyzed = await fetch(`${base}/analyze`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(analyzeBody()),
    })
    const saved = await fetch(`${base}/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(saveBody()),
    })
    assert.equal(analyzed.status, 200)
    assert.deepEqual((await analyzed.json() as any).data, { source, analysis })
    assert.equal(saved.status, 201)
    assert.deepEqual((await saved.json() as any).data, promotion)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    executionContext.analyzeProductManualTest = originalAnalyze
    executionContext.saveProductManualTest = originalSave
  }

  const routes = fs.readFileSync(path.resolve('forge-ui/server/routes/projects.ts'), 'utf8')
  for (const route of [
    "router.post('/:appName/test-intents/generate'",
    "router.post('/:appName/test-intents/save'",
    "router.get('/:appName/suites'",
    "router.post('/:appName/execution/start'",
    "router.post('/:appName/manual-tests/analyze'",
    "router.post('/:appName/manual-tests/save'",
  ]) assert.equal(routes.split(route).length - 1, 1, `${route} must remain exactly once`)
})
