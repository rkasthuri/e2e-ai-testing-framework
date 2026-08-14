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

import * as fs from 'fs'
import * as path from 'path'
import { workspaceResolver } from '../WorkspaceResolver'
import { credentialStore, CredentialStore } from './CredentialStore'
import type { CredentialReference } from './CredentialTypes'

/**
 * TD-UI-069C-C — the non-secret facts needed to describe HOW authentication
 * is obtained for a project: the governed mechanism vocabulary (`authType`,
 * the same field ADR-013's CredentialResolver already reads) and the
 * credential REFERENCE (env var names only, never a value). This is a read
 * of the same existing authority crawl.ts's projectContext() and
 * ExecutionPreflightController's readCredentialAvailability() already
 * consult — extracted here as a shared, single reader for new consumers
 * (TestInventoryController) rather than a third independent copy.
 */
export interface AuthenticationContext {
  mechanism: string
  credentialReference: CredentialReference
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
}

export function readAuthenticationContext(appName: string): AuthenticationContext {
  const ws = workspaceResolver.resolve(appName)
  const config = readJson(path.join(ws.forgeDir, 'config.json')) ?? {}
  const mechanism = typeof config.authType === 'string' ? config.authType : 'none'
  const credentialReference = credentialStore.read(appName) ?? CredentialStore.defaultReference(appName)
  return { mechanism, credentialReference }
}
