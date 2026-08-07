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

import { CredentialSlotError } from './CredentialTypes'
import type { CredentialMaterial } from './CredentialTypes'

/** The engine config fields the crawl credential planner reads (read-only). */
export interface EngineConfigView {
  appName?: string
  authType?: string
  credentials?: { envKey?: string }
}

export type CrawlCredentialPlan = { path: 'A' } | { path: 'B'; envKey: string }

/**
 * ADR-013 — pure decision for ExecutionContext's crawl credential injection,
 * mirroring planAuthenticate. Precondition: `material` is present — guest apps
 * (resolve() → null) are handled by the caller and never reach here.
 *   Path A — force OR fresh (no config): the engine Bootstrap writes
 *     credentials.envKey and CrawlRunner:129 injects.
 *   Path B — existing config WITH envKey, no force: the caller sets
 *     process.env[envKey] and keeps line-129 inert (single materializer).
 *   throws CredentialSlotError — existing config, no force, no envKey slot yet
 *     (creds resolved, but nowhere to inject them; operator runs Authenticated
 *     Bootstrap).
 */
export function planCrawlCredentials(
  config: EngineConfigView | null,
  material: CredentialMaterial | null,
  options: { force?: boolean },
): CrawlCredentialPlan {
  // `material` is the resolved-credentials precondition (see above); the path
  // decision itself is force/config/envKey-driven.
  void material
  if (options.force === true || !config) return { path: 'A' }
  const envKey = config.credentials?.envKey
  if (envKey) return { path: 'B', envKey }
  throw new CredentialSlotError(config.appName ?? 'app', config.authType ?? 'form-login')
}
