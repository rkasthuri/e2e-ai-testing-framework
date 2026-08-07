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

import {
  asEvidenceId, asObservationContextId, asProjectId,
  type ConfidenceDimensions, type EvidenceRecord, type ProjectIdentity,
} from './tdUi062b'

export const fixtureProject: ProjectIdentity = {
  projectId: asProjectId('project-saucedemo'),
  displayName: 'SauceDemo',
  applicationKind: 'web',
  observationBoundary: 'https://www.saucedemo.com',
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:00:00.000Z',
  lifecycleState: 'created',
  stateRevision: 0,
}

export const currentEvidence: EvidenceRecord = {
  id: asEvidenceId('evidence-current-1'),
  projectId: fixtureProject.projectId,
  observationContextId: asObservationContextId('observation-1'),
  source: 'crawl',
  subject: 'application-shell',
  observation: 'The application shell loaded and exposed the observed navigation surface.',
  capturedAt: '2026-07-30T10:01:00.000Z',
  provenance: { kind: 'crawl-run', reference: 'crawl-1' },
  integrity: 'valid',
  freshness: 'current',
}

export const staleEvidence: EvidenceRecord = { ...currentEvidence, id: asEvidenceId('evidence-stale-1'), freshness: 'stale', capturedAt: '2026-07-01T10:01:00.000Z' }
export const integrityFailedEvidence: EvidenceRecord = { ...currentEvidence, id: asEvidenceId('evidence-invalid-1'), integrity: 'failed' }

export const highConfidenceDimensions: ConfidenceDimensions = {
  currency: 'current', coverage: 'complete', access: 'verified', integrity: 'valid', agreement: 'agreed',
}

export const unknownDimensions: ConfidenceDimensions = {
  currency: 'missing', coverage: 'missing', access: 'missing', integrity: 'unknown', agreement: 'unknown',
}

export const blockedDimensions: ConfidenceDimensions = {
  currency: 'current', coverage: 'partial', access: 'blocked', integrity: 'valid', agreement: 'unknown',
}
