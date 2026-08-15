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
import type { ObservationGapRecord, ObservationRecord } from './ObservationTypes'

export interface ObservationArtifactIntegrityMember {
  artifactId: string
  sha256: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]))
  }
  return value
}

export function canonicalObservationIntegrityHash(
  observation: Omit<ObservationRecord, 'observationId' | 'idempotencyKey' | 'integrityHash' | 'artifactIds' | 'safeMessage'>,
  artifactHashes: readonly ObservationArtifactIntegrityMember[],
): string {
  const semantic = {
    schemaVersion: observation.schemaVersion,
    observationRunId: observation.observationRunId,
    projectId: observation.projectId,
    producer: observation.producer,
    producerVersion: observation.producerVersion,
    method: observation.method,
    methodVersion: observation.methodVersion,
    subjectId: observation.subjectId,
    predicate: observation.predicate,
    outcome: observation.outcome,
    observedValue: observation.observedValue,
    boundary: observation.boundary,
    capturedAt: observation.capturedAt,
    provenanceClass: observation.provenanceClass,
    safeReasonCode: observation.safeReasonCode,
    artifactHashes: artifactHashes.map(member => ({ artifactId: member.artifactId, sha256: member.sha256 })),
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(semantic))).digest('hex')
}

export function canonicalObservationGapIntegrityHash(
  gap: Omit<ObservationGapRecord, 'gapId' | 'idempotencyKey' | 'integrityHash' | 'artifactIds' | 'safeMessage'>,
  artifactHashes: readonly ObservationArtifactIntegrityMember[],
): string {
  const canonicalArtifactHashes = [...artifactHashes]
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
  const semantic = {
    schemaVersion: gap.schemaVersion,
    observationRunId: gap.observationRunId,
    projectId: gap.projectId,
    producer: gap.producer,
    producerVersion: gap.producerVersion,
    intendedMethod: gap.intendedMethod,
    intendedMethodVersion: gap.intendedMethodVersion,
    intendedSubjectId: gap.intendedSubjectId,
    intendedPredicate: gap.intendedPredicate,
    boundary: gap.boundary,
    reason: gap.reason,
    occurredAt: gap.occurredAt,
    artifactHashes: canonicalArtifactHashes.map(member => ({ artifactId: member.artifactId, sha256: member.sha256 })),
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(semantic))).digest('hex')
}
