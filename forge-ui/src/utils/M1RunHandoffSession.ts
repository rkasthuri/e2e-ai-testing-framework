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

export interface M1RunHandoff {
  projectId: string
  testSetId: string
  definitionId: string
  revision: number
  createdAt: string
}

const PREFIX = 'forge:m1-run-handoff:'
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

export function isM1RunHandoff(value: unknown): value is M1RunHandoff {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<M1RunHandoff>
  return typeof item.projectId === 'string' && SAFE_ID.test(item.projectId)
    && typeof item.testSetId === 'string' && SAFE_ID.test(item.testSetId)
    && typeof item.definitionId === 'string' && SAFE_ID.test(item.definitionId)
    && Number.isSafeInteger(item.revision) && Number(item.revision) > 0
    && typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt))
}

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null }
}

export const M1RunHandoffSession = {
  save(value: M1RunHandoff): boolean {
    const target = storage()
    if (!target || !isM1RunHandoff(value)) return false
    try { target.setItem(`${PREFIX}${value.projectId}`, JSON.stringify(value)); return true } catch { return false }
  },
  load(projectId: string): M1RunHandoff | null {
    const target = storage()
    if (!target) return null
    try {
      const raw = target.getItem(`${PREFIX}${projectId}`)
      if (!raw) return null
      const value: unknown = JSON.parse(raw)
      return isM1RunHandoff(value) && value.projectId === projectId ? value : null
    } catch { return null }
  },
  clear(projectId: string): void {
    try { storage()?.removeItem(`${PREFIX}${projectId}`) } catch { /* Presentation state only. */ }
  },
}
