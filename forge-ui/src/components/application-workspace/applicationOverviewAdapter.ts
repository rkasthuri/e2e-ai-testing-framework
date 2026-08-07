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

import type { Detection, DetectionField, ObservationRecord, Project } from '../../api/types'
import type {
  ApplicationOverviewReadModel,
  OverviewConfidenceDimension,
  OverviewEvidence,
  OverviewRecommendation,
} from './types'

function displayUrl(url: string): string {
  if (!url) return 'Unknown URL'
  return url.endsWith('/') ? url : `${url}/`
}

function sourceExplanation(source: string): string {
  switch (source) {
    case 'password-field-count':
      return 'Derived from the number of password fields detected during onboarding. This indicates a possible form-login surface; it does not verify authentication behavior.'
    case 'StrategyDetector':
      return 'Produced by the onboarding StrategyDetector from the target signals available during detection.'
    case 'user-supplied':
      return 'Persisted from the value supplied during onboarding.'
    case 'SPA-framework-signal':
      return 'Derived from a framework signal detected during onboarding.'
    case 'persisted-onboarding-config':
      return 'Read from the persisted onboarding project configuration.'
    default:
      return source
        ? `Reported by the persisted onboarding source '${source}'. No more specific reason was recorded.`
        : 'The persisted detection result did not record a source or reason.'
  }
}

function supportedConfidence(field: DetectionField): OverviewEvidence['confidence'] {
  if (field.source === 'password-field-count' && field.confidence === 'high') return 'low'
  return field.confidence === 'high' || field.confidence === 'medium' || field.confidence === 'low'
    ? field.confidence
    : 'unknown'
}

function availableField(
  label: string,
  field: DetectionField | undefined,
  capturedAt: string | undefined,
): OverviewEvidence | null {
  if (!field?.value) return null
  const explanation = field.reason || sourceExplanation(field.source)
  return {
    id: `onboarding-detection-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    state: 'unknown',
    freshness: 'unknown',
    summary: `${label}: ${field.value}`,
    provenance: field.source
      ? `Onboarding detection — ${field.source}`
      : 'Onboarding detection — source unavailable',
    capturedAt: capturedAt ?? null,
    confidence: supportedConfidence(field),
    confidenceReason: explanation,
  }
}

/**
 * Converts the read-only project endpoint into the UI read-model boundary.
 * This adapter preserves the endpoint's evidence and does not infer crawl,
 * model, coverage, or application-health claims from field counts.
 */
export function buildApplicationOverviewReadModel(
  project: Project,
  detection: Detection,
  latestObservation: ObservationRecord | null = null,
): ApplicationOverviewReadModel {
  const onboardingEvidence = [
    availableField('Application kind', detection.appType ? { value: detection.appType, confidence: 'high', source: 'persisted-onboarding-config', reason: 'The application kind was persisted by onboarding for this project identity; it does not describe application behavior or structure.' } : undefined, detection.capturedAt),
    availableField('Rendering model', detection.renderingModel, detection.capturedAt),
    availableField('Authentication', detection.authType, detection.capturedAt),
    availableField('Crawl strategy', detection.crawlStrategy, detection.capturedAt),
    availableField('Application name', detection.appName, detection.capturedAt),
  ].filter((item): item is OverviewEvidence => item !== null)
  const observationEvidence: OverviewEvidence[] = latestObservation
    ? latestObservation.evidence.map(item => ({
        id: item.id,
        state: item.integrity === 'failed' ? 'integrity-failed' : 'unknown',
        freshness: 'unknown',
        summary: item.summary,
        provenance: `${item.provenance.kind} — ${item.provenance.reference}`,
        capturedAt: item.capturedAt,
        confidence: item.integrity === 'failed' ? 'unknown' : 'low',
        confidenceReason: item.integrity === 'failed'
          ? 'This evidence cannot support a conclusion because its integrity failed.'
          : 'The observation directly recorded this subject, but freshness, complete coverage, and integrity have not all been established.',
      }))
    : []
  const evidence = [...onboardingEvidence, ...observationEvidence]

  const hasDetectionEvidence = onboardingEvidence.length > 0
  const hasObservationRecord = latestObservation !== null
  const hasObservationEvidence = observationEvidence.length > 0
  const unknowns = [
    {
      id: 'application-behavior-not-observed',
      subject: 'Application behavior and structure',
      reason: hasObservationRecord
        ? 'The latest observation is bounded to its recorded subjects; behavior, structure, and coverage outside that evidence remain unknown.'
        : 'Onboarding detection identifies connection and setup signals only; no completed application observation is represented here.',
      severity: 'material' as const,
      evidenceIds: evidence.map(item => item.id),
    },
  ]
  const blockers = hasDetectionEvidence ? [] : [{
    id: 'missing-onboarding-evidence',
    kind: 'missing-evidence',
    subject: 'Onboarding detection',
    reason: 'The selected project has no persisted detection evidence.',
    evidenceIds: [],
  }]
  const confidence = hasDetectionEvidence ? 'low' as const : 'unknown' as const
  const confidenceDimensions: OverviewConfidenceDimension[] = [
    {
      key: 'identity',
      label: 'Identity',
      state: hasDetectionEvidence ? 'high' : 'unknown',
      explanation: hasDetectionEvidence
        ? 'Project identity, URL, application kind, and observation boundary come from persisted onboarding data. This does not establish application behavior or structure.'
        : 'Persisted onboarding identity evidence is unavailable.',
    },
    {
      key: 'behavior',
      label: 'Behavior',
      state: 'unknown',
      explanation: hasObservationRecord
        ? 'The latest run recorded bounded subjects, but broader application behavior is not established.'
        : 'Application behavior has not been observed.',
    },
    {
      key: 'structure',
      label: 'Structure',
      state: 'unknown',
      explanation: hasObservationRecord
        ? 'Observed subjects do not establish complete application structure.'
        : 'Application structure has not been observed.',
    },
    {
      key: 'coverage',
      label: 'Coverage',
      state: 'unknown',
      explanation: hasObservationRecord
        ? 'The latest observation explicitly did not measure complete crawl frontier coverage.'
        : 'No completed observation establishes coverage.',
    },
    {
      key: 'currency',
      label: 'Currency',
      state: 'unknown',
      explanation: 'Evidence freshness has not been evaluated because no approved freshness policy is available.',
    },
  ]
  const status = hasObservationRecord
    ? hasObservationEvidence
      ? 'Observed — bounded evidence available'
      : `Observation ${latestObservation!.terminalState} — no supporting evidence`
    : hasDetectionEvidence
      ? 'Onboarded — awaiting observation'
      : 'Created — evidence unavailable'
  const statusWhy = hasObservationRecord
    ? hasObservationEvidence
      ? `Observation '${latestObservation!.observationId}' produced persisted, bounded evidence. Complete application coverage is still unknown.`
      : `Observation '${latestObservation!.observationId}' reached '${latestObservation!.terminalState}' without evidence that can support an application claim.`
    : hasDetectionEvidence
      ? 'The project identity and onboarding detection result are persisted. A completed application observation has not been supplied to this view.'
    : 'The project exists, but no onboarding or detection evidence is available from the read-only project endpoint.'
  const recommendation: OverviewRecommendation | null = hasDetectionEvidence ? {
    id: 'start-application-observation',
    action: hasObservationRecord ? 'Review or repeat the application observation' : 'Start or complete an application observation',
    because: hasObservationRecord
      ? hasObservationEvidence
        ? 'Persisted observation evidence is available, while freshness and complete application coverage remain unknown.'
        : 'The latest observation produced no evidence that can support a current application conclusion.'
      : 'Detection evidence establishes the onboarding boundary, while application behavior and structure remain unknown.',
    safe: true,
    evidenceIds: evidence.map(item => item.id),
    destination: {
      kind: 'internal-route',
      href: `/crawl?project=${encodeURIComponent(project.appName)}`,
    },
  } : null
  const truthSection = {
    key: 'truth-confidence' as const,
    label: 'Truth Confidence',
    confidence,
    meaning: 'Qualitative confidence in the current application understanding.',
    why: hasObservationRecord
      ? hasObservationEvidence
        ? 'Confidence is Low because bounded observation evidence exists, but freshness, integrity, and complete coverage remain unestablished.'
        : 'Confidence is Low because the latest observation produced no supporting evidence; only persisted identity and onboarding evidence remain available.'
      : hasDetectionEvidence
        ? 'Confidence is Low because only onboarding/detection evidence is available; application behavior, structure, and coverage remain unobserved.'
      : 'Confidence is Unknown because no supporting evidence is available.',
    impact: 'Do not treat the application as fully observed or complete.',
    evidenceIds: evidence.map(item => item.id),
    unknowns,
    blockers,
    preventedHigherState: 'A completed observation with bounded scope and evidence is required for stronger confidence.',
    recommendedNextStep: recommendation ? {
      id: recommendation.id,
      action: recommendation.action,
      reason: recommendation.because,
      priority: 'next' as const,
      evidenceIds: recommendation.evidenceIds,
      unknownIds: unknowns.map(item => item.id),
      blockerIds: blockers.map(item => item.id),
    } : null,
  }

  return {
    applicationUrl: displayUrl(project.url),
    project: {
      projectId: project.appName,
      displayName: project.appName,
      applicationKind: detection.appType || project.appType || 'Unknown',
      observationBoundary: 'Onboarding and detection only; application behavior and structure are not yet observed.',
      lifecycleState: status,
      stateRevision: 1,
    },
    asOf: latestObservation?.completedAt || detection.capturedAt || project.createdAt || project.lastOpenedAt || 'Unknown',
    evidenceIds: evidence.map(item => item.id),
    truthConfidence: { ...truthSection, level: confidence, dimensions: {
      identity: hasDetectionEvidence ? 'high' : 'unknown',
      behavior: 'unknown',
      structure: 'unknown',
      coverage: 'missing',
      currency: 'missing',
    } },
    confidenceDimensions,
    sections: [
      {
        key: 'project-status',
        label: 'Project Status',
        confidence,
        meaning: 'Lifecycle state of the selected project based on persisted onboarding data.',
        why: statusWhy,
        impact: 'The project can be inspected, but no complete application understanding is asserted.',
        evidenceIds: evidence.map(item => item.id),
        unknowns: [],
        blockers,
        preventedHigherState: 'Application observation is not yet represented.',
        recommendedNextStep: truthSection.recommendedNextStep,
      },
      truthSection,
    ],
    observationContext: {
      id: latestObservation?.observationContext.id ?? detection.runId ?? null,
      label: hasObservationRecord ? 'Latest crawl observation context' : 'Onboarding context',
      boundary: hasObservationRecord
        ? latestObservation!.observationContext.declaredScope
        : `Target URL: ${displayUrl(project.url)}; detection evidence only`,
    },
    currentUnderstanding: {
      latestObservationSummary: hasObservationRecord
        ? `FORGE has persisted observation '${latestObservation!.observationId}' in state '${latestObservation!.terminalState}'. Its observed subjects are bounded to that run; completeness remains unknown.`
        : hasDetectionEvidence
          ? 'FORGE has persisted onboarding and detection evidence for this project. No completed application observation is shown.'
        : 'FORGE has a project record but no onboarding or detection evidence to summarize.',
      applicationModel: {
        state: hasObservationEvidence ? 'Observation-backed model available' : hasObservationRecord ? 'Observation produced no model evidence' : 'Not yet observed',
        currency: 'unknown',
        summary: hasObservationEvidence
          ? 'A crawl observation produced modeled subjects, but freshness and complete application coverage are not established.'
          : hasObservationRecord
            ? 'The latest observation produced no evidence that can support an Application Model claim.'
            : 'No application model claim is derived from onboarding data.',
      },
      limitations: [
        hasObservationRecord
          ? 'Application behavior and structure outside the recorded observation evidence remain unknown.'
          : 'Application behavior and structure are not yet observed.',
        'Coverage and completeness are unknown.',
      ],
    },
    evidence,
    recommendations: recommendation ? [recommendation] : [],
  }
}
