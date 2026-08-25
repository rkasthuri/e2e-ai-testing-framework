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

import * as crypto from 'crypto'
import { fail, ok } from '../http'
import { executionContext } from './ExecutionContext'

export interface M1TestIntentHttpResult { status: number; body: unknown }
type Project = { appName: string }

function safeFailure(cause: unknown): M1TestIntentHttpResult {
  const name = cause instanceof Error ? cause.name : ''
  const code = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : null
  if (name === 'NormalizedTestIntentContractError') {
    return { status: 422, body: fail('The reviewed normalized intent is malformed.', 'NORMALIZED_INTENT_INVALID') }
  }
  if (name === 'DuplicateTestGenerationError') {
    return { status: 409, body: fail('A test-design generation is already active for this project.', 'DUPLICATE_TEST_GENERATION') }
  }
  if (name === 'TestDefinitionContractError') {
    return code === 'STALE_AUTHORITY' || code === 'AUTHORITY_MISMATCH'
      ? { status: 409, body: fail('Current canonical evidence no longer matches the exact reviewed intent.', 'STALE_REVIEWED_INTENT') }
      : { status: 422, body: fail('The reviewed intent could not be promoted into canonical v3 authority.', 'TEST_DEFINITION_INVALID') }
  }
  return { status: 503, body: fail('M1 test-design authority is temporarily unavailable.', 'M1_TEST_DESIGN_UNAVAILABLE') }
}

export async function listM1DiscoveredAreas(appName: string, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<M1TestIntentHttpResult> {
  if (!await resolveProject(appName)) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  try {
    return { status: 200, body: ok(await executionContext.listM1DiscoveredAreas(appName)) }
  } catch (cause) { return safeFailure(cause) }
}

export async function generateM1Intent(appName: string, body: unknown, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<M1TestIntentHttpResult> {
  if (!await resolveProject(appName)) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const appArea = body && typeof body === 'object' ? (body as { appArea?: unknown }).appArea : null
  if (typeof appArea !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(appArea)) {
    return { status: 400, body: fail('A valid discovered application area is required.', 'INVALID_APP_AREA') }
  }
  try {
    return { status: 200, body: ok(await executionContext.generateM1Intent(appName, appArea)) }
  } catch (cause) { return safeFailure(cause) }
}

export async function saveM1Intent(appName: string, body: unknown, resolveProject: (appName: string) => Promise<Project | undefined>): Promise<M1TestIntentHttpResult> {
  if (!await resolveProject(appName)) return { status: 404, body: fail('Project not found', 'NOT_FOUND') }
  const intent = body && typeof body === 'object' ? (body as { intent?: unknown }).intent : null
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    return { status: 400, body: fail('The exact reviewed intent is required.', 'INVALID_REVIEWED_INTENT') }
  }
  try {
    return { status: 201, body: ok(await executionContext.saveM1Intent(appName, intent as Record<string, unknown>, crypto.randomUUID())) }
  } catch (cause) { return safeFailure(cause) }
}
