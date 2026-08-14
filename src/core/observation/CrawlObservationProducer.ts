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
import type { AppModelCandidate, PageDiscovery } from '../onboarding/types'
import type { ObservationService } from './ObservationService'
import {
  CRAWL_OBSERVATION_METHOD_VERSIONS,
  type AppModelObservationSupportInput,
  type ObservationBoundary,
  type ObservationRecord,
  type ObservationRunRecord,
} from './ObservationTypes'

const POLICY_ID = 'forge.crawl-observation-characterization'
const POLICY_VERSION = '1'

function cleanUrl(value: string): string {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.split(/[?#]/, 1)[0]
  }
}

function key(prefix: string, value: string): string {
  return `${prefix}:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 40)}`
}

function boundary(kind: ObservationBoundary['kind'], run: ObservationRunRecord, endedAt: string, completion: 'complete' | 'partial', scope: Record<string, unknown> = {}): ObservationBoundary {
  return {
    schemaVersion: 'forge-observation-boundary/v1',
    kind,
    scope: { acquisitionKind: run.acquisitionKind, ...scope },
    startedAt: run.startedAt,
    endedAt,
    completion,
    policyId: POLICY_ID,
    policyVersion: POLICY_VERSION,
  }
}

export interface CrawlObservationProductionResult {
  support: AppModelObservationSupportInput
  completeness: 'complete' | 'partial' | 'unobserved'
}

/** Converts crawler-owned acquisition facts into committed canonical truth. */
export class CrawlObservationProducer {
  async persistPageDiscovery(
    page: PageDiscovery,
    run: ObservationRunRecord,
    service: ObservationService,
    capturedAt = new Date().toISOString(),
    roleId = 'unspecified',
  ): Promise<ObservationRecord> {
    const persisted = await service.recordObservation({
      observationRunId: run.observationRunId,
      projectId: run.projectId,
      producer: run.producer,
      producerVersion: run.producerVersion,
      method: 'browser_dom_inspection',
      methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
      subjectId: page.pageId,
      predicate: 'page.discovered',
      outcome: 'present',
      observedValue: {
        urlPattern: cleanUrl(page.urlPattern),
        elementCount: page.elements.length,
        fingerprint: page.domHash,
        roleId,
      },
      boundary: boundary('document', run, capturedAt, 'complete', { roleId }),
      capturedAt,
      idempotencyKey: key(`page:${run.observationRunId}`, `${roleId}:${page.pageId}`),
    })
    return persisted.value
  }

  async persist(
    candidate: AppModelCandidate,
    run: ObservationRunRecord,
    service: ObservationService,
    precommittedPages: ObservationRecord[] = [],
  ): Promise<CrawlObservationProductionResult> {
    const capturedAt = candidate.app.crawlMetadata?.crawledAt ?? new Date().toISOString()
    const observations: AppModelObservationSupportInput['observations'] = []
    const subjects: AppModelObservationSupportInput['subjects'] = []
    const gaps: AppModelObservationSupportInput['gaps'] = []

    for (const page of candidate.pages ?? []) {
      const existing = precommittedPages.filter(item => item.subjectId === page.id)
      const persisted = existing.length > 0 ? existing : [(await service.recordObservation({
        observationRunId: run.observationRunId,
        projectId: run.projectId,
        producer: run.producer,
        producerVersion: run.producerVersion,
        method: 'browser_dom_inspection',
        methodVersion: CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
        subjectId: page.id,
        predicate: 'page.discovered',
        outcome: 'present',
        observedValue: {
          urlPattern: cleanUrl(page.urlPattern),
          elementCount: page.elements.length,
          fingerprint: page.fingerprint,
        },
        boundary: boundary('document', run, capturedAt, 'complete'),
        capturedAt,
        idempotencyKey: key(`page:${run.observationRunId}`, `unspecified:${page.id}`),
      })).value]
      for (const item of persisted) {
        observations.push({ observationId: item.observationId, claimKey: `page:${page.id}`, supportRole: 'basis' })
        subjects.push({ canonicalSubjectId: page.id, observationId: item.observationId, claimKey: 'subject.exists', supportRole: 'basis' })
      }
    }

    const frontierMeasured = candidate.app.crawlMetadata?.pagesSkipped !== null
      && candidate.app.crawlMetadata?.pagesSkipped !== undefined
    const noFacts = observations.length === 0
    const specificationInputOnly = (candidate.endpoints?.length ?? 0) > 0 && (candidate.pages?.length ?? 0) === 0
    if (noFacts || !frontierMeasured || specificationInputOnly) {
      const persisted = await service.recordGap({
        observationRunId: run.observationRunId,
        projectId: run.projectId,
        producer: run.producer,
        producerVersion: run.producerVersion,
        intendedMethod: specificationInputOnly ? 'configuration_api_spec' : 'browser_dom_inspection',
        intendedMethodVersion: specificationInputOnly ? 'forge.configuration-api-spec/v1' : CRAWL_OBSERVATION_METHOD_VERSIONS.browser_dom_inspection,
        intendedSubjectId: `application-${crypto.createHash('sha256').update(run.projectId).digest('hex').slice(0, 24)}`,
        intendedPredicate: 'application.coverage',
        boundary: boundary(specificationInputOnly ? 'http_exchange' : 'document', run, capturedAt, 'partial'),
        reason: specificationInputOnly ? 'unsupported_method' : noFacts ? 'not_reached' : 'boundary_incomplete',
        occurredAt: capturedAt,
        idempotencyKey: key(`coverage:${run.observationRunId}`, noFacts ? 'not-reached' : 'frontier-not-measured'),
        safeMessage: specificationInputOnly
          ? 'API specification input was retained as planning data and did not establish an HTTP response fact.'
          : noFacts
          ? 'The crawl established no canonical page or endpoint fact.'
          : 'The crawl frontier was not measured, so full application coverage is not established.',
      })
      gaps.push({ gapId: persisted.value.gapId, claimKey: 'application.coverage', supportRole: 'bounds' })
    }

    return {
      completeness: noFacts ? 'unobserved' : gaps.length > 0 ? 'partial' : 'complete',
      support: {
        projectId: run.projectId,
        observationRunId: run.observationRunId,
        observations,
        subjects,
        gaps,
        characterizationPolicyId: POLICY_ID,
        characterizationPolicyVersion: POLICY_VERSION,
        linkedAt: new Date().toISOString(),
      },
    }
  }
}
