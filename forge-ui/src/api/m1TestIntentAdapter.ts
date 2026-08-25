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

import {
  decodeCanonicalDefinitionSaveResultV3,
  decodeDiscoveredAppAreas,
  exactIntentContent,
  isNormalizedTestIntentV1,
  isSupportedNormalizedTestIntentV1,
  type CanonicalDefinitionSaveResultV3,
  type M1TestIntentAdapter,
} from './m1TestIntentContract'
import { m1MockAreas, m1MockGeneration } from './m1TestIntentMockFixtures'
import { apiClient } from './client'

export class M1IntentValidationError extends Error {
  constructor() {
    super('The reviewed test intent is malformed or no longer matches the selected project.')
    this.name = 'M1IntentValidationError'
  }
}

export class M1IntentSaveError extends Error {
  constructor(message = 'Canonical promotion failed. The review draft remains non-authoritative.') {
    super(message)
    this.name = 'M1IntentSaveError'
  }
}

function waitForMock(): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, 120))
}

export function createM1MockTestIntentAdapter(): M1TestIntentAdapter {
  const generated = new Map<string, string>()
  const saved = new Map<string, CanonicalDefinitionSaveResultV3>()
  return {
    mode: 'mock',
    async listDiscoveredAreas(projectId) {
      await waitForMock()
      return projectId === 'm1-empty' ? [] : m1MockAreas(projectId)
    },
    async generate(projectId, appArea) {
      await waitForMock()
      const result = m1MockGeneration(projectId, appArea)
      if (isSupportedNormalizedTestIntentV1(result)) generated.set(result.intentId, exactIntentContent(result))
      return result
    },
    async save(projectId, intent) {
      await waitForMock()
      if (!isSupportedNormalizedTestIntentV1(intent) || intent.projectId !== projectId
        || generated.get(intent.intentId) !== exactIntentContent(intent)) throw new M1IntentValidationError()
      if (intent.appArea.id === 'Billing') throw new M1IntentSaveError('Canonical promotion was rejected by the mock persistence boundary. No Definition was created.')
      const existing = saved.get(intent.intentId)
      if (existing) return existing
      const result = {
        schemaVersion: 3 as const,
        testSetId: `test-set-v3-${projectId}`,
        definitionId: `definition-v3-${intent.intentId.replace(/^intent-/, '')}`,
        revision: 3,
      }
      saved.set(intent.intentId, result)
      return result
    },
  }
}

export function createM1BackendTestIntentAdapter(): M1TestIntentAdapter {
  return {
    mode: 'backend',
    async listDiscoveredAreas(projectId) {
      return decodeDiscoveredAppAreas(await apiClient.get<unknown>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/test-intents/areas`,
      ))
    },
    async generate(projectId, appArea) {
      const value = await apiClient.post<unknown>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/test-intents/generate`,
        { appArea },
      )
      if (!isNormalizedTestIntentV1(value)) throw new M1IntentValidationError()
      return value
    },
    async save(projectId, intent) {
      return decodeCanonicalDefinitionSaveResultV3(await apiClient.post<unknown>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/test-intents/save`,
        { intent },
      ))
    },
  }
}

export const m1TestIntentAdapter = createM1BackendTestIntentAdapter()
