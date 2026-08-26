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

import type { CanonicalSuiteCandidateSet, CanonicalSuiteRevision, SuiteChangeRequest } from './suiteContract'

export interface SuiteTransport {
  listHeads(projectId: string): Promise<readonly CanonicalSuiteRevision[]>
  refreshCurrentHead(projectId: string, suiteId: string): Promise<CanonicalSuiteRevision>
  readRevision(projectId: string, suiteId: string, revision: number): Promise<CanonicalSuiteRevision>
  readCandidates(projectId: string): Promise<CanonicalSuiteCandidateSet>
  save(projectId: string, request: SuiteChangeRequest): Promise<CanonicalSuiteRevision>
}

export class SuiteTransportUnavailableError extends Error {
  readonly code = 'M2_CORE_SUITE_TRANSPORT_UNAVAILABLE'
  constructor() {
    super('Saved Suite authority is unavailable because the frozen Core Suite transport has not landed in this branch.')
    this.name = 'SuiteTransportUnavailableError'
  }
}

/**
 * The sole production adapter seam while M2 Core is developed independently.
 * No endpoint path or DTO is guessed here. Replace this implementation only
 * after the frozen Core transport is present and can be decoded end-to-end.
 */
export const suiteTransport: SuiteTransport = Object.freeze({
  async listHeads() { throw new SuiteTransportUnavailableError() },
  async refreshCurrentHead() { throw new SuiteTransportUnavailableError() },
  async readRevision() { throw new SuiteTransportUnavailableError() },
  async readCandidates() { throw new SuiteTransportUnavailableError() },
  async save() { throw new SuiteTransportUnavailableError() },
})
