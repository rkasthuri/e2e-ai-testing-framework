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

export type CrawlAcquisitionKind = 'web_crawl' | 'api_crawl'
export type ObservationRunLifecycle = 'running' | 'completed' | 'blocked' | 'failed' | 'interrupted'
export type ObservationCompleteness = 'complete' | 'partial' | 'unobserved'
export type CrawlObservationMethod =
  | 'browser_dom_inspection'
  | 'browser_navigation_attempt'
  | 'http_response_inspection'
export type ObservationOutcome = 'present' | 'absent' | 'indeterminate'
export type ObservationProvenanceClass = 'native' | 'legacy_direct' | 'legacy_reconstructed'
export type ObservationBoundaryKind = 'document' | 'navigation_attempt' | 'http_exchange'
export type ObservationGapReason =
  | 'not_reached'
  | 'acquisition_failed'
  | 'boundary_incomplete'
  | 'producer_interrupted'
  | 'unsupported_method'
  | 'prerequisite_blocked'
  | 'redaction_failed'
  | 'artifact_persistence_failed'

export type ArtifactSensitivityClass = 'internal' | 'sensitive'
export type ArtifactRedactionState = 'not_required' | 'redacted'
export type ArtifactRetentionClass =
  | 'short_lived_diagnostic'
  | 'standard_diagnostic'
  | 'forensic_pinned'

export const CRAWL_OBSERVATION_METHOD_VERSIONS: Readonly<Record<CrawlObservationMethod, string>> = {
  browser_dom_inspection: 'forge.browser-dom-inspection/v1',
  browser_navigation_attempt: 'forge.browser-navigation-attempt/v1',
  http_response_inspection: 'forge.http-response-inspection/v1',
}

export interface ObservationBoundary {
  schemaVersion: 'forge-observation-boundary/v1'
  kind: ObservationBoundaryKind
  scope: Record<string, unknown>
  startedAt: string
  endedAt: string
  completion: 'complete' | 'partial'
  policyId: string
  policyVersion: string
}

export interface ObservationRunRecord {
  schemaVersion: 'forge-observation-run/v1'
  observationRunId: string
  projectId: string
  workspaceAuthority: 'PRODUCT_WORKSPACE'
  operationId: string
  producer: string
  producerVersion: string
  producerInstanceId: string
  producerProcessId: number
  acquisitionKind: CrawlAcquisitionKind
  startedAt: string
  terminalAt: string | null
  lifecycle: ObservationRunLifecycle
  completeness: ObservationCompleteness | null
  safeReasonCode: string | null
  safeMessage: string | null
  policyId: string
  policyVersion: string
  acquisitionPlanHash: string
}

export interface ObservationRecord {
  schemaVersion: 'forge-observation/v1'
  observationId: string
  observationRunId: string
  projectId: string
  producer: string
  producerVersion: string
  method: CrawlObservationMethod
  methodVersion: string
  subjectId: string
  predicate: string
  outcome: ObservationOutcome
  observedValue: unknown | null
  boundary: ObservationBoundary
  capturedAt: string
  idempotencyKey: string
  integrityHash: string
  artifactIds: string[]
  provenanceClass: ObservationProvenanceClass
  safeReasonCode: string | null
  safeMessage: string | null
}

export interface ObservationGapRecord {
  schemaVersion: 'forge-observation-gap/v1'
  gapId: string
  observationRunId: string
  projectId: string
  producer: string
  producerVersion: string
  intendedMethod: string
  intendedMethodVersion: string
  intendedSubjectId: string
  intendedPredicate: string
  boundary: ObservationBoundary
  reason: ObservationGapReason
  occurredAt: string
  idempotencyKey: string
  integrityHash: string
  artifactIds: string[]
  safeMessage: string | null
}

export interface ArtifactReferenceRecord {
  schemaVersion: 'forge-observation-artifact/v1'
  artifactId: string
  observationRunId: string
  projectId: string
  storageKey: string
  sha256: string
  mediaType: string
  byteSize: number
  sensitivityClass: ArtifactSensitivityClass
  redactionState: ArtifactRedactionState
  capturedAt: string
  retentionClass: ArtifactRetentionClass
  retentionPolicyId: string
  retentionPolicyVersion: string
  expiresAt: string | null
  retentionState: 'active'
}

export interface NewObservationInput {
  observationRunId: string
  projectId: string
  producer: string
  producerVersion: string
  method: string
  methodVersion: string
  subjectId: string
  predicate: string
  outcome: string
  observedValue?: unknown
  boundary: ObservationBoundary
  capturedAt: string
  idempotencyKey: string
  artifactIds?: string[]
  safeReasonCode?: string | null
  safeMessage?: string | null
}

export interface NewObservationGapInput {
  observationRunId: string
  projectId: string
  producer: string
  producerVersion: string
  intendedMethod: string
  intendedMethodVersion: string
  intendedSubjectId: string
  intendedPredicate: string
  boundary: ObservationBoundary
  reason: ObservationGapReason
  occurredAt: string
  idempotencyKey: string
  artifactIds?: string[]
  safeMessage?: string | null
}

export interface AppModelObservationSupportInput {
  projectId: string
  observationRunId: string
  observations: Array<{
    observationId: string
    claimKey: string
    supportRole: 'basis' | 'bounds'
  }>
  subjects: Array<{
    canonicalSubjectId: string
    observationId: string
    claimKey: string
    supportRole: 'basis'
  }>
  gaps: Array<{
    gapId: string
    claimKey: string
    supportRole: 'bounds'
  }>
  characterizationPolicyId: string
  characterizationPolicyVersion: string
  linkedAt: string
}

export interface ObservationRunSnapshot {
  run: ObservationRunRecord
  observations: ObservationRecord[]
  gaps: ObservationGapRecord[]
  artifacts: ArtifactReferenceRecord[]
}

export type PersistenceOutcome = 'committed_new' | 'replayed_existing'

export interface PersistedValue<T> {
  outcome: PersistenceOutcome
  value: T
}
