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

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

// Chunk 6 is an explicit executable certification entry point over the closed
// Product owners. Every imported suite registers runtime tests with node:test;
// a subordinate failure therefore fails this certificate. No source-text match
// is accepted as proof and no certification substitute owns Product semantics.

// Executable section: positive Product outcomes.
// Executable section: Suite v1/v2 replay (delegated and executed).
// Executable section: recovery/restart.
// Executable section: versioning and corruption/authority hostiles.
// Executable section: Product self-falsification.
import './verify-m2-product-integration.test'

// Executable section: independent direct-v3 replay and self-falsification.
import './verify-m4-direct-v3-replay.test'

// Executable section: frozen contract and deterministic classifier.
import './verify-m4-evidence-contract.test'
import './verify-m4-diagnostic-classifier.test'

// Executable section: Results transport/UI.
import './verify-m4-diagnostic-results-transport.test'
import './verify-m4-diagnostic-results-ui.test'

// Executable section: Insights Core/certification/UI.
import './verify-m4-diagnostic-insights.test'
import './verify-m4-insights-certification.test'
import './verify-m4-diagnostic-insights-ui.test'

const REPOSITORY_ROOT = path.resolve(__dirname, '..')
const CONTRACT_ROOT = path.join(REPOSITORY_ROOT, 'fixtures', 'm4-contract')
const FROZEN_CONTRACT_DIGEST = '02fccfc9a985a417dc7613d43e301202307edee8c1fcd878a67e442a4de01889'
const FROZEN_VERIFIER_DIGEST = '841728306c94078f8d658c8be30f09f7eb2c9fadc87fc47710b84ffa14438f84'

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function filesBelow(root: string): string[] {
  const discovered: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) discovered.push(absolute)
    }
  }
  visit(root)
  return discovered.sort((left, right) => left.localeCompare(right, 'en'))
}

function frozenContractDigest(): string {
  const entries = filesBelow(CONTRACT_ROOT).map(absolute => {
    const relative = path.relative(REPOSITORY_ROOT, absolute).replaceAll(path.sep, '/')
    return `${relative}\0${sha256(readFileSync(absolute))}\n`
  })
  return sha256(entries.join(''))
}

test('M4 Chunk 6 frozen physical contract and verifier remain byte-exact', () => {
  assert.equal(frozenContractDigest(), FROZEN_CONTRACT_DIGEST)
  assert.equal(
    sha256(readFileSync(path.join(REPOSITORY_ROOT, 'scripts', 'verify-m4-evidence-contract.test.ts'))),
    FROZEN_VERIFIER_DIGEST,
  )
})
