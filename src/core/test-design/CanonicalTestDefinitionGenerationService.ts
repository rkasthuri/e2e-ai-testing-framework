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
import { assertProductDatabaseAuthority } from '../storage/db'
import { runMigrations } from '../storage/migrate'
import { TestSetRepository } from '../storage/repositories/TestSetRepository'
import { TestDefinitionContractError } from './TestDefinitionContract'
import { TestDefinitionAuthorityProjectionService } from './TestDefinitionAuthorityProjectionService'
import { CanonicalRouteEvidenceProjection } from './CanonicalRouteEvidenceProjection'
import { AuthenticationExpectationProjectionService } from './AuthenticationExpectationProjection'

const PROCESS_INSTANCE_ID = crypto.randomUUID()

function sameIdentity(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Core-only orchestration. Callers supply identity and intent, never evidence. */
export class CanonicalTestDefinitionGenerationService {
  constructor(
    private readonly repository = new TestSetRepository(),
    private readonly authorityProjection = new TestDefinitionAuthorityProjectionService(),
    private readonly routeProjection = new CanonicalRouteEvidenceProjection(),
    private readonly authProjection = new AuthenticationExpectationProjectionService(),
    private readonly now = () => new Date().toISOString(),
    private readonly prepare = async () => { assertProductDatabaseAuthority(); await runMigrations() },
  ) {}

  async readAdmission(projectId: string, workspaceRoot: string) {
    const authority = await this.authorityProjection.read(projectId)
    if (authority.kind !== 'ok') return { ...authority, stage: 'sealed_authority' as const }
    const route = await this.routeProjection.read(projectId, authority.authority)
    if (route.kind !== 'ok') return { ...route, stage: 'route' as const }
    const authentication = this.authProjection.read(projectId, workspaceRoot)
    return { kind: 'ok' as const, authority: authority.authority, routeEvidence: route.evidence, authenticationExpectation: authentication }
  }

  async generate(projectId: string, workspaceRoot: string, generationId = crypto.randomUUID()) {
    await this.prepare()
    const admitted = await this.readAdmission(projectId, workspaceRoot)
    if (admitted.kind !== 'ok') throw new TestDefinitionContractError('AUTHORITY_MISMATCH')
    const startedAt = this.now()
    await this.repository.beginGeneration(projectId, generationId, PROCESS_INSTANCE_ID, startedAt)
    try {
      const current = await this.readAdmission(projectId, workspaceRoot)
      if (current.kind !== 'ok'
        || !sameIdentity(current.authority, admitted.authority)
        || current.routeEvidence.identityHash !== admitted.routeEvidence.identityHash
        || current.authenticationExpectation.identityHash !== admitted.authenticationExpectation.identityHash) {
        throw new TestDefinitionContractError('STALE_AUTHORITY')
      }
      return await this.repository.commitCanonicalV2Generation({
        projectId,
        generatedAt: startedAt,
        authority: current.authority,
        routeEvidence: current.routeEvidence,
        authenticationExpectation: current.authenticationExpectation,
      }, generationId, PROCESS_INSTANCE_ID)
    } catch (cause) {
      const code = cause instanceof TestDefinitionContractError ? cause.code : 'PERSISTENCE_FAILED'
      const message = cause instanceof TestDefinitionContractError
        ? cause.message
        : 'Canonical v2 Test Definition generation failed before a revision was committed.'
      await this.repository.failGeneration(projectId, generationId, PROCESS_INSTANCE_ID, this.now(), code, message)
      throw cause
    }
  }
}

export const canonicalTestDefinitionGenerationService = new CanonicalTestDefinitionGenerationService()
