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
import * as fs from 'fs'
import * as path from 'path'

export type AuthenticationExpectationState = 'required' | 'not_required' | 'unknown' | 'conflicted'

export const AUTHENTICATION_DECLARATION_POLICY = Object.freeze({
  id: 'forge.authentication-expectation.declared-configuration',
  version: '1',
})

export interface AuthenticationExpectationBasis {
  kind: 'declared_configuration'
  policyId: string
  policyVersion: string
  configurationDigest: string
  mechanism: string | null
}

export interface AuthenticationExpectationProjection {
  schemaVersion: 'forge-authentication-expectation/v1'
  state: AuthenticationExpectationState
  mechanism: string | null
  bases: AuthenticationExpectationBasis[]
  identityHash: string
}

export interface DeclaredAuthenticationSource {
  state: 'required' | 'not_required'
  mechanism: string | null
  configurationDigest: string
}

export interface DeclaredAuthenticationReader {
  read(projectId: string, workspaceRoot: string): DeclaredAuthenticationSource[]
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SUPPORTED_DECLARATIONS = new Set(['none', 'form-login', 'oauth', 'api-key'])

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export class WorkspaceAuthenticationDeclarationReader implements DeclaredAuthenticationReader {
  read(projectId: string, workspaceRoot: string): DeclaredAuthenticationSource[] {
    if (!SAFE_ID.test(projectId)) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(path.resolve(workspaceRoot), '.forge', 'config.json'), 'utf8'))
    } catch {
      return []
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const config = parsed as Record<string, unknown>
    if (config.schemaVersion !== 1 || config.appName !== projectId
      || typeof config.authType !== 'string' || !SUPPORTED_DECLARATIONS.has(config.authType)) return []
    const mechanism = config.authType === 'none' ? null : config.authType
    return [{
      state: mechanism === null ? 'not_required' : 'required',
      mechanism,
      configurationDigest: digest({ schemaVersion: 1, appName: projectId, authType: config.authType }),
    }]
  }
}

function canonicalIdentity(value: Omit<AuthenticationExpectationProjection, 'identityHash'>): string {
  return digest(value)
}

export class AuthenticationExpectationProjectionService {
  constructor(private readonly declarations: DeclaredAuthenticationReader = new WorkspaceAuthenticationDeclarationReader()) {}

  read(projectId: string, workspaceRoot: string): AuthenticationExpectationProjection {
    const sources = this.declarations.read(projectId, workspaceRoot)
    const bases = sources.map(source => ({
      kind: 'declared_configuration' as const,
      policyId: AUTHENTICATION_DECLARATION_POLICY.id,
      policyVersion: AUTHENTICATION_DECLARATION_POLICY.version,
      configurationDigest: source.configurationDigest,
      mechanism: source.mechanism,
    })).sort((left, right) => left.configurationDigest.localeCompare(right.configurationDigest))
    const identities = new Set(sources.map(source => `${source.state}\u0000${source.mechanism ?? ''}`))
    const state: AuthenticationExpectationState = sources.length === 0
      ? 'unknown'
      : identities.size > 1
        ? 'conflicted'
        : sources[0].state
    const mechanism = state === 'required' ? sources[0].mechanism : null
    const projection = {
      schemaVersion: 'forge-authentication-expectation/v1' as const,
      state,
      mechanism,
      bases,
    }
    return { ...projection, identityHash: canonicalIdentity(projection) }
  }
}
