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
 * TD-179 - persisted authType correction provenance uses the actual before-value.
 *
 * Run: npx tsx --test scripts/verify-td179.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentRunner } from '../src/core/agent/AgentRunner'
import {
  Bootstrap, BootstrapDetection,
} from '../src/core/onboarding/Bootstrap'
import { BootstrapEvidencePackage } from '../src/core/onboarding/BootstrapEvidence'

const detectionFromUnknown = (): BootstrapDetection => ({
  appName:        { value: 'x', confidence: 'medium', source: 'test' },
  renderingModel: { value: 'unknown', confidence: 'unknown', source: 'test' },
  crawlStrategy:  { value: 'bfs', confidence: 'low', source: 'test' },
  authType:       { value: 'unknown', confidence: 'unknown', source: 'default-fallback' },
  loginUrl:       { value: null, confidence: 'unknown', source: 'test' },
  baseUrl:        { value: 'https://x.test', confidence: 'high', source: 'user-supplied' },
})

test('TD-179 correction from unknown records the actual before-value in evidence and notes', async () => {
  const bootstrap = new Bootstrap() as any
  bootstrap.collectPageSignals = async () => ({
    navLinks: [],
    buttonTexts: ['Login'],
    formPresence: true,
    currentUrl: 'https://x.test',
    pageTitle: 'Test',
  })

  const originalRun = AgentRunner.prototype.run
  AgentRunner.prototype.run = async () => {
    throw new Error('TD-179 deterministic test stop')
  }

  try {
    const detection = detectionFromUnknown()
    await bootstrap.runAgentPhase({} as any, detection, {
      url: 'https://x.test',
      credentials: [],
    })

    assert.equal(detection.authType.value, 'form-login', 'the unknown floor must be corrected')

    const evidence = bootstrap.evidencePackage as BootstrapEvidencePackage
    const authTypeRecord = evidence.records.find(r => r.field === 'authType')
    assert.equal(authTypeRecord?.value, 'form-login (corrected from unknown)')
    const expectedNote = 'authType corrected unknown ' + String.fromCharCode(0x2192) + ' form-login'
    assert.ok(
      evidence.notes.some(note => note.includes(expectedNote)),
      'the persisted note must name unknown as the actual before-value',
    )
  } finally {
    AgentRunner.prototype.run = originalRun
  }
})
