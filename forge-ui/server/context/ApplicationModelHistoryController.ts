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
import { presentApplicationModelHistory } from '../registry/ApplicationModelHistoryPresenter'
import { executionContext } from './ExecutionContext'

export type ApplicationModelQueryResult =
  | { ok: true; limit: number; cursor: string | null; requestedRowId: number | null }
  | { ok: false; message: string }

export interface ApplicationModelHttpResult {
  status: number
  body: unknown
}

export function parseApplicationModelQuery(query: Record<string, unknown>): ApplicationModelQueryResult {
  const limitValue = query.limit
  const cursorValue = query.cursor
  const modelValue = query.model
  if (limitValue !== undefined && (typeof limitValue !== 'string' || !/^\d{1,2}$/.test(limitValue))) {
    return { ok: false, message: 'limit must be an integer from 1 through 50.' }
  }
  const limit = limitValue === undefined ? 25 : Number(limitValue)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return { ok: false, message: 'limit must be an integer from 1 through 50.' }
  }
  if (cursorValue !== undefined
    && (typeof cursorValue !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(cursorValue))) {
    return { ok: false, message: 'cursor is malformed.' }
  }
  if (modelValue !== undefined
    && (typeof modelValue !== 'string' || !/^[1-9]\d{0,14}$/.test(modelValue))) {
    return { ok: false, message: 'model must be a positive database identity.' }
  }
  const requestedRowId = modelValue === undefined ? null : Number(modelValue)
  if (requestedRowId !== null && !Number.isSafeInteger(requestedRowId)) {
    return { ok: false, message: 'model must be a positive database identity.' }
  }
  return {
    ok: true,
    limit,
    cursor: typeof cursorValue === 'string' ? cursorValue : null,
    requestedRowId,
  }
}

export async function readApplicationModelHistory(
  appName: string,
  query: Record<string, unknown>,
  resolveProject: (appName: string) => Promise<{ appName: string } | undefined>,
): Promise<ApplicationModelHttpResult> {
  // This transport boundary accepts only bounded identities, delegates the
  // authoritative read to ExecutionContext, and never serializes caught causes.
  // Repository payloads cross the API only through the allowlisted presenter.
  const parsed = parseApplicationModelQuery(query)
  if (!parsed.ok) return { status: 400, body: fail(parsed.message, 'INVALID_APP_MODEL_QUERY') }
  const project = await resolveProject(appName)
  if (!project) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  try {
    const [raw, projection] = await Promise.all([
      executionContext.readAppModelHistory(appName, {
        limit: parsed.limit,
        cursor: parsed.cursor,
        requestedRowId: parsed.requestedRowId,
      }),
      executionContext.readObservationProjection(appName, { limit: 50 }),
    ])
    if (raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'invalid_cursor') {
      return { status: 400, body: fail('The model-history cursor is invalid for this project.', 'INVALID_APP_MODEL_QUERY') }
    }
    const presented = presentApplicationModelHistory(raw, { id: appName, name: project.appName }, {
      limit: parsed.limit,
      projection: projection as any,
    })
    if (presented.kind === 'multiple_active') {
      return { status: 409, body: fail('Authoritative model history contains multiple active models. No current model is presented.', 'APP_MODEL_MULTIPLE_ACTIVE') }
    }
    if (presented.kind === 'active_missing') {
      return { status: 409, body: fail('Authoritative model history has no active model. No historical model is presented as current.', 'APP_MODEL_ACTIVE_MISSING') }
    }
    if (presented.kind === 'malformed') {
      return { status: 422, body: fail('Authoritative model history could not be validated safely.', 'APP_MODEL_HISTORY_INVALID') }
    }
    return { status: 200, body: ok(presented.value) }
  } catch {
    return { status: 500, body: fail('Application Model data is unavailable from the authoritative store.', 'APP_MODEL_READ_UNAVAILABLE') }
  }
}
