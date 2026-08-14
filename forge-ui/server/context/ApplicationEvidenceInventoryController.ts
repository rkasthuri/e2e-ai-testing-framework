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

import { fail, ok } from '../http'
import {
  parseEvidenceLedgerQuery,
  type EvidenceLedgerHttpResult,
} from './EvidenceLedgerController'
import { executionContext, type ExecutionContext } from './ExecutionContext'

/**
 * Transport-only controller for the canonical Application Evidence Inventory.
 * Compatibility composition remains isolated in EvidenceLedgerController and
 * is never selected by this canonical Product endpoint.
 */
export async function readApplicationEvidenceInventory(
  appName: string,
  query: Record<string, unknown>,
  resolveProject: (appName: string) => Promise<{ appName: string } | undefined>,
  engine: Pick<ExecutionContext, 'readApplicationEvidenceInventory'> = executionContext,
): Promise<EvidenceLedgerHttpResult> {
  const parsed = parseEvidenceLedgerQuery(query)
  if (!parsed.ok) return { status: 400, body: fail(parsed.message, 'INVALID_EVIDENCE_QUERY') }
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  if (parsed.value.cursor !== null) {
    return { status: 400, body: fail('The canonical evidence cursor is not supported by this bounded projection.', 'INVALID_EVIDENCE_QUERY') }
  }
  try {
    const inventory = await engine.readApplicationEvidenceInventory(appName, { ...parsed.value }) as any
    if (inventory?.authority !== 'canonical_product') {
      return { status: 422, body: fail('Canonical evidence inventory authority could not be validated.', 'EVIDENCE_AUTHORITY_INVALID') }
    }
    return { status: 200, body: ok(inventory) }
  } catch {
    return { status: 500, body: fail('Canonical evidence inventory is unavailable.', 'EVIDENCE_READ_UNAVAILABLE') }
  }
}
