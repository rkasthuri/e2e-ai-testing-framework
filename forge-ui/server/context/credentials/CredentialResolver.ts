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
import { credentialStore, CredentialStore } from './CredentialStore'
import { CredentialError, type CredentialMaterial, type CredentialReference } from './CredentialTypes'
import { workspaceResolver } from '../WorkspaceResolver'

/**
 * ADR-013 — resolves an app's credentials for a crawl. Abstract so future
 * resolvers (OS keychain TD-UI-009, cloud secrets Phase 2) swap in without
 * touching callers. `resolve()` returns the material, `null` for a guest app
 * (authType 'none' with no creds), or throws `CredentialError` when auth is
 * required but the material is unresolved (pre-flight hard-fail).
 */
export abstract class CredentialResolver {
  abstract resolve(appName: string): CredentialMaterial | null
}

/** Reads authType from an app's engine-owned .forge/config.json (read-only). */
export type AuthTypeReader = (appName: string) => string

function readAuthTypeFromConfig(appName: string): string {
  try {
    const ws  = workspaceResolver.resolve(appName)
    const cfg = JSON.parse(fs.readFileSync(path.join(ws.forgeDir, 'config.json'), 'utf-8'))
    return typeof cfg?.authType === 'string' ? cfg.authType : 'none'
  } catch {
    return 'none'   // no config yet → guest; a bootstrap will establish authType
  }
}

export class EnvCredentialResolver extends CredentialResolver {
  constructor(
    private readonly store: CredentialStore = credentialStore,
    private readonly readAuthType: AuthTypeReader = readAuthTypeFromConfig,
  ) {
    super()
  }

  resolve(appName: string): CredentialMaterial | null {
    const authType  = this.readAuthType(appName)
    // Recorded sidecar reference, else default-derived <APP>_USERNAME/<APP>_PASSWORD.
    const reference = this.store.read(appName) ?? CredentialStore.defaultReference(appName)
    const username  = process.env[reference.usernameEnv]
    const password  = process.env[reference.passwordEnv]

    if (username && password) return { username, password }

    // Unresolved: hard-fail when auth is required; otherwise guest (no material).
    this.assertPresent(appName, authType, reference)
    return null
  }

  /** Pre-flight refusal: auth required but the credential pair is unresolved. */
  private assertPresent(appName: string, authType: string, reference: CredentialReference): void {
    if (authType !== 'none') throw new CredentialError(appName, authType, reference)
  }
}

export const credentialResolver: CredentialResolver = new EnvCredentialResolver()
