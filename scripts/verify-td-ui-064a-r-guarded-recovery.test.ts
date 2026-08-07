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
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const runner = read('src/core/runner/CrawlRunner.ts')
const repository = read('src/core/storage/repositories/AppModelRepository.ts')
const recovery = read('src/core/storage/AppModelRecoveryOrchestrator.ts')
const canonicalBoundary = read('src/core/storage/AppModelCanonicalCandidate.ts')
const route = read('forge-ui/server/routes/crawl.ts')
const store = read('forge-ui/server/registry/ObservationStore.ts')
const page = read('forge-ui/src/pages/CrawlPage.tsx')

test('fresh and valid-model crawls retain the normal trusted-model path', () => {
  assert.match(runner, /const previousModel = await this\.appModels\.findActive\(config\.appName\)/)
  assert.match(runner, /const model = await produceCandidate\(previousModel\)/)
  assert.match(runner, /commitAndProject\(/)
})

test('force discovers only an invalid active row and starts guarded recovery without prior state', () => {
  assert.match(runner, /options\.force\s*\? await this\.appModels\.findInvalidActiveForRecovery/)
  assert.match(runner, /new AppModelRecoveryOrchestrator\(this\.appModels\)\.recover/)
  assert.match(runner, /async \(\{ previousModel \}\) => \{[\s\S]*recoveryCandidate = await produceCandidate\(previousModel\)[\s\S]*return recoveryCandidate/)
  assert.match(recovery, /crawlFresh\(\{ previousModel: null \}\)/)
  assert.match(runner, /operator_acknowledgement: true/)
})

test('invalid source remains byte-bound historical evidence and replacement activation is atomic', () => {
  assert.match(repository, /rawModelJsonFingerprint\(expected\.model_json\)/)
  assert.match(repository, /where\('model_json', '=', expected\.model_json\)/)
  assert.match(repository, /set\(\{ status: 'superseded' \}\)/)
  assert.match(repository, /insertInto\('app_models'\)/)
  assert.doesNotMatch(repository, /deleteFrom\('app_models'\)[\s\S]*commitInvalidActiveRecovery/)
})

test('fresh replacement must pass canonical validation before guarded commit', () => {
  assert.doesNotMatch(recovery, /validateAppModelObject\(validationSnapshot\)/)
  assert.match(repository, /materializeCandidate\([\s\S]*'commitInvalidActiveRecovery'/)
  assert.match(canonicalBoundary, /validateAppModelStructure\(validationSnapshot\)/)
  assert.match(canonicalBoundary, /candidateHash: sha256\(serialized\)/)
  assert.match(repository, /materializeAppModelSnapshot\(canonicalCandidate, version\)/)
  assert.match(repository, /committed\.recoverySourceRowId !== request\.expected_row_id/)
})

test('recovery provenance is persisted without raw model or credential material', () => {
  for (const field of ['sourceRowId', 'sourceVersion', 'sourceFingerprint', 'detectedAt', 'validationErrors', 'decision', 'replacementRowId', 'replacementVersion']) {
    assert.match(store, new RegExp(field))
  }
  assert.doesNotMatch(store, /modelRecovery[\s\S]*rawModelJson/)
  assert.doesNotMatch(store, /modelRecovery[\s\S]*(username|password|cookie|token):/i)
})

test('pre-crawl incompatibility and post-crawl persistence failure remain distinct', () => {
  assert.match(route, /isModelCompatibilityError/)
  assert.match(route, /kind: 'model-compatibility'/)
  assert.match(route, /existing Application Model is incompatible with the current schema/)
  assert.match(route, /Review the guarded persistence diagnostic before another recovery attempt/)
  assert.match(route, /Crawl execution completed, authentication was/)
  assert.match(route, /Authentication was not evaluated and no evidence was activated/)
  assert.doesNotMatch(route, /AppModelPersistenceError\|schema-invalid model_json/)
  assert.doesNotMatch(route, /modelCompatibilityFailure[\s\S]{0,300}credentials-missing/)
})

test('UI exposes guarded recovery provenance and detailed diagnostics without completeness claims', () => {
  assert.match(page, /Guarded Application Model recovery/)
  assert.match(page, /Schema diagnostics/)
  assert.match(page, /incompatible source model was preserved as historical evidence/)
  assert.doesNotMatch(page, /recovery complete coverage|fully recovered|100%/i)
})
