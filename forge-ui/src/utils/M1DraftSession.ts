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

import { isSupportedNormalizedTestIntentV1, type SupportedNormalizedTestIntentV1 } from '../api/m1TestIntentContract'

const PREFIX = 'forge:m1-review-draft:'

export type M1DraftLoadResult =
  | { state: 'available'; intent: SupportedNormalizedTestIntentV1 }
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'storage_unavailable' }

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null }
}

export const M1DraftSession = {
  load(projectId: string): M1DraftLoadResult {
    const target = storage()
    if (!target) return { state: 'storage_unavailable' }
    let raw: string | null
    try { raw = target.getItem(`${PREFIX}${projectId}`) } catch { return { state: 'storage_unavailable' } }
    if (!raw) return { state: 'missing' }
    try {
      const intent: unknown = JSON.parse(raw)
      return isSupportedNormalizedTestIntentV1(intent) && intent.projectId === projectId
        ? { state: 'available', intent }
        : { state: 'invalid' }
    } catch { return { state: 'invalid' } }
  },
  save(intent: SupportedNormalizedTestIntentV1): boolean {
    const target = storage()
    if (!target) return false
    try { target.setItem(`${PREFIX}${intent.projectId}`, JSON.stringify(intent)); return true } catch { return false }
  },
  clear(projectId: string): void {
    try { storage()?.removeItem(`${PREFIX}${projectId}`) } catch { /* A lost draft never changes canonical state. */ }
  },
}
