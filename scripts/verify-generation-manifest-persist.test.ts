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
 * TD-UI-003 Block 2 — persistence proof for WorkspaceManager.saveGenerationManifest().
 *
 * The two GeneratorRunner tests (verify-td121, verify-td112) stub
 * saveGenerationManifest to a no-op — correct for what they assert (routing /
 * read-only-consumer behaviour), but that means the REAL .forge write was never
 * executed. This suite exercises the real implementation against a real temp
 * workspace: file lands in .forge/, survives JSON round-trip, ensureDirs() fires,
 * and a second call overwrites cleanly. node:test + node:assert/strict under tsx
 * (auto-covered by `npm run test:unit`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'
import { GenerationManifest, GENERATION_SCHEMA_VERSION } from '../src/core/onboarding/GenerationManifest'

// A minimal but COMPLETE manifest — every required field populated (plus the
// optional classificationRunId), so a successful round-trip also proves the
// type is fully serializable. Overrides let a test vary specific fields.
function buildManifest(overrides: Partial<GenerationManifest> = {}): GenerationManifest {
  return {
    schemaVersion:       GENERATION_SCHEMA_VERSION,
    generatorVersion:    '1.0.0',
    appName:             'proofapp',
    generatedAt:         '2026-07-12T00:00:00.000Z',
    durationMs:          42,
    classificationRunId: 'run-abc-123',
    specCount:           1,
    pomCount:            1,
    fixtureCount:        1,
    filesWritten:        3,
    observedFlows:       1,
    partialFlows:        0,
    unknownFlows:        0,
    flows: [
      {
        id:                'flow-login',
        displayName:       'Login',
        confidence:        'observed',
        source:            'config-seeded',
        groundingWarnings: [],
        specFile:          'tests/auth/flow-login.generated.spec.ts',
      },
    ],
    pages: [
      {
        id:               'login',
        urlPattern:       '/login',
        moduleConfidence: 'high',
        pomFile:          'tests/pages/LoginPage.generated.ts',
      },
    ],
    files: [
      { id: 'id-spec',    relativePath: 'tests/auth/flow-login.generated.spec.ts', type: 'spec',    reason: 'new-flow', flowId: 'flow-login' },
      { id: 'id-pom',     relativePath: 'tests/pages/LoginPage.generated.ts',       type: 'pom',     reason: 'new-flow', pageId: 'login' },
      { id: 'id-fixture', relativePath: 'tests/fixtures.generated.ts',              type: 'fixture', reason: 'new-flow' },
    ],
    ...overrides,
  }
}

test('P1 saveGenerationManifest writes .forge/generation-manifest.json and round-trips', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genmanifest-p1-'))
  try {
    const ws = createWorkspace(root)
    const manifest = buildManifest()

    await ws.saveGenerationManifest(manifest)

    const file = path.join(root, '.forge', 'generation-manifest.json')
    assert.equal(fs.existsSync(file), true, `expected manifest at ${file}`)
    // Deep round-trip: any field that doesn't survive serialization fails here.
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), manifest)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('P2 saveGenerationManifest creates .forge/ when it does not exist (ensureDirs fires)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genmanifest-p2-'))
  try {
    const forgeDir = path.join(root, '.forge')
    // Fresh temp dir — .forge/ must not exist before the call.
    assert.equal(fs.existsSync(forgeDir), false, '.forge/ should not exist yet')

    await createWorkspace(root).saveGenerationManifest(buildManifest())

    assert.equal(fs.existsSync(forgeDir), true, '.forge/ was not created')
    assert.equal(fs.existsSync(path.join(forgeDir, 'generation-manifest.json')), true, 'manifest did not land in .forge/')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('P3 second call overwrites cleanly (no append/corruption)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genmanifest-p3-'))
  try {
    const ws = createWorkspace(root)
    const first  = buildManifest({ durationMs: 100, specCount: 1 })
    const second = buildManifest({ durationMs: 999, specCount: 7 })

    await ws.saveGenerationManifest(first)
    await ws.saveGenerationManifest(second)

    const file = path.join(root, '.forge', 'generation-manifest.json')
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))   // valid JSON → no append/corruption
    assert.deepEqual(parsed, second)                            // second won, not the first
    assert.equal(parsed.durationMs, 999)
    assert.equal(parsed.specCount, 7)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
