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

import type {
  AuthenticationStageRecord,
  ObservationHistoryItem,
  ObservationTerminalRecord,
} from './ObservationStore'

const SAFE_STRATEGIES = new Set(['bfs', 'spa', 'hybrid', 'auto'])
const SAFE_AUTH_EXPECTATIONS = new Set([
  'none', 'form-login', 'basic', 'token', 'oauth', 'sso', 'unknown',
])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_ROUTE_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/
const SAFE_MODEL_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/
const SAFE_FINGERPRINT = /^[a-f0-9]{64}$/i
const MAX_PRESENTED_SUBJECTS = 100
const MAX_PRESENTED_EVIDENCE = 100
const MAX_PRESENTED_AUTHENTICATION_ATTEMPTS = 10

export type SafeObservationCategory =
  | 'authentication-prerequisite'
  | 'authentication-acceptance'
  | 'model-compatibility'
  | 'guarded-persistence'
  | 'observation-scope'
  | 'observation-blocked'
  | 'observation-failed'
  | 'observation-outcome-unknown'
  | 'observation-interrupted'

export interface SafeCategorizedExplanation {
  category: SafeObservationCategory
  explanation: string
  count: number
}

function safeOpaqueId(value: string, fallback: string): string {
  return SAFE_ID.test(value) ? value : fallback
}

function safeModelVersion(value: string): string {
  return SAFE_MODEL_VERSION.test(value) ? value : 'unavailable'
}

function safeFingerprint(value: string): string {
  return SAFE_FINGERPRINT.test(value) ? value : 'unavailable'
}

export function safeRoutePath(value: string): string | null {
  if (value.length === 0 || value.length > 2048 || /[\u0000-\u001f\\]/.test(value)) return null
  try {
    const parsed = value.startsWith('/')
      ? new URL(value, 'https://presentation.invalid')
      : new URL(value)
    const path = parsed.pathname
    return path.length <= 256 && SAFE_ROUTE_PATH.test(path) ? path : null
  } catch {
    return null
  }
}

function safeErrorCategory(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized.includes('timeout')) return 'timeout'
  if (normalized.includes('locator') || normalized.includes('control')) return 'control-unavailable'
  if (normalized.includes('navigation')) return 'navigation-unavailable'
  return 'unknown'
}

function safeAuthenticationStages(
  attempts: NonNullable<ObservationTerminalRecord['authentication']['attempts']> | undefined,
) {
  return (attempts ?? []).slice(0, MAX_PRESENTED_AUTHENTICATION_ATTEMPTS).map((attempt, attemptIndex) => ({
    roleId: `attempt-${attemptIndex + 1}`,
    outcome: attempt.outcome,
    stages: attempt.stages.map((stage: AuthenticationStageRecord) => ({
      stage: stage.stage,
      outcome: stage.outcome,
      selectorStrategyCategory: stage.selectorStrategyCategory,
      ...(stage.matchCount === undefined ? {} : { matchCount: stage.matchCount }),
      ...(stage.controlVisible === undefined ? {} : { controlVisible: stage.controlVisible }),
      ...(stage.usernameEntryCompleted === undefined ? {} : { usernameEntryCompleted: stage.usernameEntryCompleted }),
      ...(stage.passwordEntryCompleted === undefined ? {} : { passwordEntryCompleted: stage.passwordEntryCompleted }),
      ...(stage.submissionAttempted === undefined ? {} : { submissionAttempted: stage.submissionAttempted }),
      ...(stage.loginSurfaceRetained === undefined ? {} : { loginSurfaceRetained: stage.loginSurfaceRetained }),
      ...(stage.urlClassification === undefined ? {} : { urlClassification: stage.urlClassification }),
      ...(stage.safeErrorType === undefined ? {} : { safeErrorType: safeErrorCategory(stage.safeErrorType) }),
    })),
  }))
}

function authenticationExplanation(item: ObservationHistoryItem): string | null {
  const terminal = item.terminal
  if (!terminal) return null
  if (terminal.authentication.credentialAvailability === 'missing') {
    return 'Authentication prerequisites were unavailable for this observation.'
  }
  switch (terminal.authentication.outcome) {
    case 'succeeded':
      return 'Authentication succeeded for this observation.'
    case 'failed':
      return 'Authentication was attempted, but acceptance remained indeterminate.'
    case 'not_required':
      return 'Authentication was not required for this observation.'
    case 'not_evaluated':
      return 'Authentication was not evaluated for this observation.'
  }
}

function safeStateExplanation(item: ObservationHistoryItem): string {
  // Legacy reasons are classified, never forwarded. This preserves the stored
  // terminal outcome while preventing credentials, URLs, persistence errors,
  // schema payloads, or other unrestricted prose from crossing the API.
  const terminal = item.terminal
  if (!terminal) {
    return 'A start record exists without a terminal record. The observation is interrupted, is not active after restart, and its outcome remains unknown.'
  }
  const subjectCount = terminal.observedSubjects.length
  if (terminal.modelRecoveryFailure?.phases.modelGeneration === 'failed') {
    return 'The active model was incompatible with the current schema.'
  }
  if (terminal.modelRecoveryFailure?.phases.guardedPersistence === 'failed') {
    return 'Guarded persistence failed before replacement activation.'
  }
  switch (terminal.terminalState) {
    case 'completed':
      return `The observation completed and produced ${subjectCount} observed subject${subjectCount === 1 ? '' : 's'}.`
    case 'partially_completed':
      return 'The observation completed with bounded limitations; some application scope remained unobserved.'
    case 'blocked':
      return terminal.authentication.credentialAvailability === 'missing'
        ? 'Authentication prerequisites were unavailable for this observation.'
        : 'The observation was blocked before all intended evidence could be collected.'
    case 'failed':
      return 'The observation ended with a recorded processing failure.'
    case 'unknown':
      return 'The terminal outcome could not be established from persisted evidence.'
  }
}

function safeUnknowns(item: ObservationHistoryItem): SafeCategorizedExplanation[] {
  const terminal = item.terminal
  if (!terminal) return [{
    category: 'observation-interrupted',
    explanation: 'The observation has no persisted terminal outcome.',
    count: 1,
  }]
  const result: SafeCategorizedExplanation[] = []
  if (terminal.authentication.outcome === 'failed') result.push({
    category: 'authentication-acceptance',
    explanation: 'Authentication was attempted, but acceptance remained indeterminate.',
    count: 1,
  })
  if (terminal.terminalState === 'unknown') result.push({
    category: 'observation-outcome-unknown',
    explanation: 'The terminal outcome remains unknown from persisted evidence.',
    count: Math.max(1, terminal.unknowns.length),
  })
  if (terminal.unknowns.length > 0 && result.length === 0) result.push({
    category: 'observation-outcome-unknown',
    explanation: 'One or more observation facts remain unknown.',
    count: terminal.unknowns.length,
  })
  return result
}

function safeBlockers(item: ObservationHistoryItem): SafeCategorizedExplanation[] {
  const terminal = item.terminal
  if (!terminal) return []
  if (terminal.authentication.credentialAvailability === 'missing') return [{
    category: 'authentication-prerequisite',
    explanation: 'Authentication prerequisites were unavailable for this observation.',
    count: Math.max(1, terminal.blockers.length),
  }]
  if (terminal.modelRecoveryFailure?.phases.modelGeneration === 'failed') return [{
    category: 'model-compatibility',
    explanation: 'The active model was incompatible with the current schema.',
    count: 1,
  }]
  if (terminal.modelRecoveryFailure?.phases.guardedPersistence === 'failed') return [{
    category: 'guarded-persistence',
    explanation: 'Guarded persistence failed before replacement activation.',
    count: 1,
  }]
  if (terminal.terminalState === 'blocked' || terminal.blockers.length > 0) return [{
    category: 'observation-blocked',
    explanation: 'The observation was blocked before all intended evidence could be collected.',
    count: Math.max(1, terminal.blockers.length),
  }]
  return []
}

function safeLimitations(item: ObservationHistoryItem): SafeCategorizedExplanation[] {
  if (!item.terminal) return [{
    category: 'observation-interrupted',
    explanation: 'The observation ended without a persisted terminal record.',
    count: 1,
  }]
  return item.terminal.unobservedScope.length > 0
    ? [{
        category: 'observation-scope',
        explanation: 'Some application scope remained unobserved.',
        count: item.terminal.unobservedScope.length,
      }]
    : []
}

function safeRecommendation(item: ObservationHistoryItem) {
  const terminal = item.terminal
  if (!terminal) return {
    category: 'observation-interrupted' as const,
    action: 'Review the interrupted observation before starting new work.',
    because: 'No terminal outcome was persisted for this observation.',
  }
  if (terminal.authentication.credentialAvailability === 'missing') return {
    category: 'authentication-prerequisite' as const,
    action: 'Restore authentication prerequisites before another observation.',
    because: 'Authentication prerequisites were unavailable for this observation.',
  }
  if (terminal.authentication.outcome === 'failed') return {
    category: 'authentication-acceptance' as const,
    action: 'Review target-side authentication acceptance evidence.',
    because: 'Authentication was attempted, but acceptance remained indeterminate.',
  }
  if (terminal.modelRecoveryFailure?.phases.modelGeneration === 'failed') return {
    category: 'model-compatibility' as const,
    action: 'Review model compatibility before another recovery observation.',
    because: 'The active model was incompatible with the current schema.',
  }
  if (terminal.modelRecoveryFailure?.phases.guardedPersistence === 'failed') return {
    category: 'guarded-persistence' as const,
    action: 'Review the guarded persistence stage before another recovery observation.',
    because: 'Guarded persistence failed before replacement activation.',
  }
  if (terminal.terminalState === 'blocked') return {
    category: 'observation-blocked' as const,
    action: 'Review the blocker category before another observation.',
    because: 'The observation was blocked before all intended evidence could be collected.',
  }
  if (terminal.terminalState === 'failed') return {
    category: 'observation-failed' as const,
    action: 'Review the failed processing stage before another observation.',
    because: 'The observation ended with a recorded processing failure.',
  }
  if (terminal.terminalState === 'unknown') return {
    category: 'observation-outcome-unknown' as const,
    action: 'Review the unknown outcome before another observation.',
    because: 'The terminal outcome could not be established from persisted evidence.',
  }
  return null
}

function safeRecoveryStage(terminal: ObservationTerminalRecord): string | null {
  const phases = terminal.modelRecoveryFailure?.phases
  if (!phases) return null
  if (phases.modelGeneration === 'failed') return 'model-generation'
  if (phases.guardedPersistence === 'failed') return 'guarded-persistence'
  if (phases.compatibilityProjection === 'failed') return 'compatibility-projection'
  return 'unknown'
}

export function projectObservationHistoryItem(item: ObservationHistoryItem) {
  const terminal = item.terminal
  const evidence = (terminal?.evidence ?? []).slice(0, MAX_PRESENTED_EVIDENCE)
  const safeEvidenceIds = new Map(evidence.map((record, index) => [
    record.id,
    safeOpaqueId(record.id, `evidence-${index + 1}`),
  ]))
  const limitations = safeLimitations(item)
  return {
    observationId: item.observationId,
    projectId: item.start.projectId,
    projectName: item.start.projectId,
    observationContext: {
      id: item.observationId,
      label: 'Crawl observation',
      declaredScope: 'Configured crawl observation scope.',
      strategy: SAFE_STRATEGIES.has(item.start.observationContext.strategy)
        ? item.start.observationContext.strategy
        : 'unknown',
    },
    sourceKind: item.start.sourceKind,
    position: item.position,
    orderingTimestamp: item.orderingTimestamp,
    startedAt: item.start.startedAt,
    completedAt: terminal?.completedAt ?? null,
    terminalState: item.state,
    stateExplanation: safeStateExplanation(item),
    authentication: terminal
      ? {
          expectation: SAFE_AUTH_EXPECTATIONS.has(terminal.authentication.expectation)
            ? terminal.authentication.expectation
            : 'unknown',
          credentialAvailability: terminal.authentication.credentialAvailability,
          outcome: terminal.authentication.outcome,
          explanation: authenticationExplanation(item),
          attempts: safeAuthenticationStages(terminal.authentication.attempts),
        }
      : {
          expectation: SAFE_AUTH_EXPECTATIONS.has(item.start.authenticationExpectation)
            ? item.start.authenticationExpectation
            : 'unknown',
          credentialAvailability: item.start.credentialAvailability,
          outcome: null,
          explanation: null,
          attempts: [],
        },
    observedSubjects: (terminal?.observedSubjects ?? []).slice(0, MAX_PRESENTED_SUBJECTS).map((subject, index) => ({
      id: safeOpaqueId(subject.id, `subject-${index + 1}`),
      kind: subject.kind,
      routePath: safeRoutePath(subject.value),
      evidenceId: safeEvidenceIds.get(subject.evidenceId) ?? 'evidence-unavailable',
    })),
    unobservedScope: limitations,
    unknowns: safeUnknowns(item),
    blockers: safeBlockers(item),
    limitations,
    evidence: evidence.map(record => ({
      id: safeEvidenceIds.get(record.id) ?? 'evidence-unavailable',
      subjectPath: safeRoutePath(record.subject),
      summary: 'A bounded subject observation was recorded during this crawl.',
      capturedAt: record.capturedAt,
      provenance: { kind: record.provenance.kind, reference: item.observationId },
      integrity: record.integrity,
    })),
    recommendation: safeRecommendation(item),
    modelRecovery: terminal?.modelRecovery
      ? {
          sourceRowId: terminal.modelRecovery.sourceRowId,
          sourceVersion: safeModelVersion(terminal.modelRecovery.sourceVersion),
          sourceFingerprint: safeFingerprint(terminal.modelRecovery.sourceFingerprint),
          detectedAt: terminal.modelRecovery.detectedAt,
          decision: terminal.modelRecovery.decision,
          replacementRowId: terminal.modelRecovery.replacementRowId,
          replacementVersion: safeModelVersion(terminal.modelRecovery.replacementVersion),
        }
      : null,
    modelRecoveryFailure: terminal?.modelRecoveryFailure
      ? {
          sourceRowId: terminal.modelRecoveryFailure.sourceRowId,
          sourceVersion: safeModelVersion(terminal.modelRecoveryFailure.sourceVersion),
          sourceFingerprint: safeFingerprint(terminal.modelRecoveryFailure.sourceFingerprint),
          detectedAt: terminal.modelRecoveryFailure.detectedAt,
          safeStage: safeRecoveryStage(terminal),
          phases: terminal.modelRecoveryFailure.phases,
        }
      : null,
  }
}
