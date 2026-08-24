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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import {
  fetchCanonicalExecutionResultsDetail,
  fetchCanonicalExecutionResultsList,
} from '../api/resultsClient'
import {
  cancelCanonicalExecution,
  canonicalExecutionStatusQueryKey,
  fetchCanonicalExecutionPreflight,
  fetchCanonicalExecutionStatus,
} from '../api/executionClient'
import type {
  OnboardRequest, OnboardResponse, Project, Detection, CrawlRequest, CrawlStatus,
  CrawlProjectContext, ObservationRecord, ObservationHistoryResponse, ApplicationModelHistoryResponse,
  EvidenceLedgerResponse, EvidenceLedgerSourceClass, EvidenceLedgerSupport, EvidenceLedgerIntegrity,
  ApplicationReadinessResponse,
  TestInventoryResponse, TestGenerationResponse, TestGenerationStatusResponse,
  GenerationManifest, TestFileContent,
} from '../api/types'
import { decodeTestInventoryResponse } from '../api/testInventoryContract'
import type { RunIntentController } from '../pages/runIntentState'

/** GET /api/v1/projects — the project switcher + lists consume this. */
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.get<{ projects: Project[] }>('/api/v1/projects'),
  })
}

/** Start is a controller-owned operation; no request or authority token crosses the hook boundary. */
export function useStartCanonicalExecution(controller: RunIntentController | null) {
  return useMutation({
    mutationFn: () => controller ? controller.start() : Promise.reject(new Error('Run Start controller is unavailable.')),
  })
}

/** GET /api/v1/projects/:appName — Fix #14: one saved project's detection. */
export function useProject(appName: string | null) {
  return useQuery({
    queryKey: ['project', appName],
    queryFn: () =>
      apiClient.get<{ project: Project; detection: Detection; latestObservation: ObservationRecord | null }>(
        `/api/v1/projects/${appName}`,
      ),
    enabled: !!appName,
  })
}

/** GET /api/v1/validate?url= — format + reachability pre-check. */
export function useValidateUrl() {
  return useMutation({
    mutationFn: (url: string) =>
      apiClient.get<{ reachable: boolean; message: string }>(
        `/api/v1/validate?url=${encodeURIComponent(url)}`,
      ),
  })
}

/** POST /api/v1/crawl — start a crawl (TD-UI-002); returns { jobId } (202). */
export function useCrawl() {
  return useMutation({
    mutationFn: (body: CrawlRequest) =>
      apiClient.post<{ jobId: string; observationId: string; state: 'queued'; startedAt: string }>('/api/v1/crawl', body),
  })
}

export function useCrawlProjectContext(appName: string | null) {
  return useQuery({
    queryKey: ['crawl-project-context', appName],
    queryFn: () => apiClient.get<CrawlProjectContext>(
      `/api/v1/crawl/projects/${encodeURIComponent(appName!)}/context`,
    ),
    enabled: !!appName,
    retry: false,
  })
}

export function useLatestObservation(appName: string | null) {
  return useQuery({
    queryKey: ['latest-observation', appName],
    queryFn: () => apiClient.get<{ observation: ObservationRecord }>(
      `/api/v1/crawl/projects/${encodeURIComponent(appName!)}/latest`,
    ),
    enabled: !!appName,
    retry: false,
  })
}

export interface ObservationHistoryRequest {
  cursor: string | null
  startedFrom: string | null
  startedThrough: string | null
  observationId: string | null
}

export function useObservationHistory(
  appName: string | null,
  request: ObservationHistoryRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: ['observation-history', appName, request],
    queryFn: () => {
      const query = new URLSearchParams({ limit: '25' })
      if (request.cursor) query.set('cursor', request.cursor)
      if (request.startedFrom) query.set('startedFrom', request.startedFrom)
      if (request.startedThrough) query.set('startedThrough', request.startedThrough)
      if (request.observationId) query.set('observation', request.observationId)
      return apiClient.get<ObservationHistoryResponse>(
        `/api/v1/crawl/projects/${encodeURIComponent(appName!)}/observations?${query}`,
      )
    },
    enabled: !!appName && enabled,
    retry: false,
  })
}

export interface ApplicationModelHistoryRequest {
  cursor: string | null
  modelRowId: number | null
}

export function useApplicationModelHistory(
  appName: string | null,
  request: ApplicationModelHistoryRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: ['application-model-history', appName, request],
    queryFn: () => {
      const query = new URLSearchParams({ limit: '25' })
      if (request.cursor) query.set('cursor', request.cursor)
      if (request.modelRowId) query.set('model', String(request.modelRowId))
      return apiClient.get<ApplicationModelHistoryResponse>(
        `/api/v1/projects/${encodeURIComponent(appName!)}/model?${query}`,
      )
    },
    enabled: !!appName && enabled,
    retry: false,
  })
}

export interface EvidenceLedgerRequest {
  cursor: string | null
  evidenceId: string | null
  sourceClass: EvidenceLedgerSourceClass | null
  support: EvidenceLedgerSupport | null
  integrity: EvidenceLedgerIntegrity | null
  observationId: string | null
  capturedFrom: string | null
  capturedThrough: string | null
}

export function useEvidenceLedger(
  appName: string | null,
  request: EvidenceLedgerRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: ['evidence-ledger', appName, request],
    queryFn: () => {
      const query = new URLSearchParams({ limit: '25' })
      if (request.cursor) query.set('cursor', request.cursor)
      if (request.evidenceId) query.set('evidence', request.evidenceId)
      if (request.sourceClass) query.set('sourceClass', request.sourceClass)
      if (request.support) query.set('support', request.support)
      if (request.integrity) query.set('integrity', request.integrity)
      if (request.observationId) query.set('observation', request.observationId)
      if (request.capturedFrom) query.set('capturedFrom', request.capturedFrom)
      if (request.capturedThrough) query.set('capturedThrough', request.capturedThrough)
      return apiClient.get<EvidenceLedgerResponse>(
        `/api/v1/projects/${encodeURIComponent(appName!)}/evidence?${query}`,
      )
    },
    enabled: !!appName && enabled,
    retry: false,
  })
}

export function useApplicationReadiness(appName: string | null, enabled = true) {
  return useQuery({
    queryKey: ['application-readiness', appName],
    queryFn: () => apiClient.get<ApplicationReadinessResponse>(
      `/api/v1/projects/${encodeURIComponent(appName!)}/readiness`,
    ),
    enabled: !!appName && enabled,
    retry: false,
  })
}

export function useEvidenceBackedTests(appName: string | null, cursor: string | null, testId: string | null) {
  return useQuery({
    queryKey: ['evidence-backed-tests', appName, cursor, testId],
    queryFn: () => {
      const query = new URLSearchParams({ limit: '25' })
      if (cursor) query.set('cursor', cursor)
      if (testId) query.set('test', testId)
      return apiClient.get<unknown>(`/api/v1/projects/${encodeURIComponent(appName!)}/test-definitions?${query}`).then(decodeTestInventoryResponse)
    },
    enabled: !!appName,
    retry: false,
  })
}

export function useGenerateEvidenceBackedTests() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (appName: string) => apiClient.post<TestGenerationResponse>(
      `/api/v1/projects/${encodeURIComponent(appName)}/test-definitions/generate`, {},
    ),
    onSuccess: (_data, appName) => qc.invalidateQueries({ queryKey: ['evidence-backed-tests', appName] }),
  })
}

export function useTestGenerationStatus(appName: string | null, generationId: string | null) {
  return useQuery({
    queryKey: ['test-generation-status', appName, generationId],
    queryFn: () => apiClient.get<TestGenerationStatusResponse>(
      `/api/v1/projects/${encodeURIComponent(appName!)}/test-definitions/generations/${encodeURIComponent(generationId!)}`,
    ),
    enabled: !!appName && !!generationId,
    retry: false,
  })
}

/** POST /api/v1/projects/:appName/authenticate — ADR-013 authenticated bootstrap. */
export function useAuthenticate() {
  return useMutation({
    mutationFn: (appName: string) =>
      apiClient.post<{ jobId?: string; noop?: boolean }>(
        `/api/v1/projects/${appName}/authenticate`, {},
      ),
  })
}

/** GET /api/v1/crawl/:jobId/status — polls every 1s until the crawl completes. */
export function useCrawlStatus(jobId: string | null, appName?: string | null) {
  return useQuery({
    queryKey: ['crawl-status', jobId, appName],
    queryFn: () => apiClient.get<CrawlStatus>(
      `/api/v1/crawl/${jobId}/status${appName ? `?project=${encodeURIComponent(appName)}` : ''}`,
    ),
    enabled: !!jobId,
    retry: false,
    refetchInterval: query => (query.state.status === 'error' || query.state.data?.complete ? false : 1000),
  })
}

/**
 * GET /api/v1/projects/:appName/tests/manifest — the generated-tests manifest.
 * 200 → { manifest }. 404 (never generated) → the query REJECTS; the tab reads
 * isError as the empty state. retry:false because a 404 is a valid terminal
 * state, not a transient error worth re-hitting.
 */
export function useTestManifest(appName: string | null) {
  return useQuery({
    queryKey: ['test-manifest', appName],
    queryFn: () =>
      apiClient.get<{ manifest: GenerationManifest }>(
        `/api/v1/projects/${appName}/tests/manifest`,
      ),
    enabled: !!appName,
    retry: false,
  })
}

/** POST /api/v1/projects/:appName/tests/generate — 202 { jobId }; poll via
 *  useCrawlStatus (generate jobs run through the same JobRunner as crawl). */
export function useGenerateTests() {
  return useMutation({
    mutationFn: (appName: string) =>
      apiClient.post<{ jobId: string }>(`/api/v1/projects/${appName}/tests/generate`, {}),
  })
}

/**
 * GET /api/v1/projects/:appName/tests/file/:fileId — one generated file's content
 * by its OPAQUE manifest ID (never a path). 404 (unknown/rejected) → the query
 * REJECTS; the viewer shows a "not available" state and does NOT fall back.
 * retry:false — a 404 here is terminal, not transient.
 */
export function useTestFile(appName: string | null, fileId: string | null) {
  return useQuery({
    queryKey: ['test-file', appName, fileId],
    queryFn: () =>
      apiClient.get<TestFileContent>(`/api/v1/projects/${appName}/tests/file/${fileId}`),
    enabled: !!appName && !!fileId,
    retry: false,
  })
}

/**
 * POST /api/v1/projects/:appName/execution/preflight — TD-UI-069A-C. Read-only
 * and side-effect-free despite the verb: the server never submits work through
 * ExecutionContext or persists anything. `enabled` should stay false until the
 * caller has loaded the current test-set revision (so `revision` reflects a
 * real read, not a guess).
 */
export function useExecutionPreflight(
  appName: string | null,
  definitionIds: string[],
  revision: number | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: executionPreflightQueryKey(appName, definitionIds, revision),
    queryFn: () => fetchCanonicalExecutionPreflight(appName!, definitionIds, revision!),
    enabled: !!appName && enabled,
    retry: false,
  })
}

/** Exact ordered cache identity for canonical Product execution preflight authority. */
export function executionPreflightQueryKey(
  appName: string | null,
  definitionIds: readonly string[],
  revision: number | null,
) {
  return ['execution-preflight', appName, [...definitionIds], revision] as const
}

/**
 * Durable lifecycle authority. React Query serializes each query's requests;
 * polling remains active only while canonical lifecycle can still change.
 */
export function useCanonicalExecutionStatus(
  appName: string | null,
  executionId: string | null,
  queryAuthority: object | null = null,
) {
  return useQuery({
    queryKey: canonicalExecutionStatusQueryKey(appName, executionId),
    queryFn: () => fetchCanonicalExecutionStatus(appName!, executionId!, queryAuthority ?? undefined),
    enabled: !!appName && !!executionId,
    retry: false,
    structuralSharing: false,
    refetchInterval: query => query.state.status === 'error' || query.state.data?.terminal ? false : 1_500,
  })
}

/** Durable cancellation intent; lifecycle is reconciled by the subsequent status read. */
export function useCancelCanonicalExecution(appName: string, executionId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => cancelCanonicalExecution(appName, executionId!),
    onSettled: async () => {
      if (!executionId) return
      await qc.invalidateQueries({ queryKey: canonicalExecutionStatusQueryKey(appName, executionId) })
      await qc.invalidateQueries({ queryKey: ['canonical-execution-result-detail', appName, executionId] })
      await qc.invalidateQueries({ queryKey: ['canonical-execution-results', appName] })
    },
  })
}

/** Canonical Product execution summaries. No legacy endpoint fallback is permitted. */
export function useCanonicalExecutionResults(appName: string | null, limit = 25) {
  return useQuery({
    queryKey: ['canonical-execution-results', appName, limit],
    queryFn: () => fetchCanonicalExecutionResultsList(appName!, limit),
    enabled: !!appName,
    retry: false,
  })
}

/** One canonical Product Execution → Run → Result projection. */
export type CanonicalExecutionDetailPhase = 'live' | 'terminal'

export function canonicalExecutionDetailQueryKey(
  appName: string | null,
  executionId: string | null,
  phase: CanonicalExecutionDetailPhase,
) {
  return ['canonical-execution-result-detail', appName, executionId, phase] as const
}

export function useCanonicalExecutionResultDetail(
  appName: string | null,
  executionId: string | null,
  monitor = false,
  phase: CanonicalExecutionDetailPhase = 'live',
) {
  return useQuery({
    queryKey: canonicalExecutionDetailQueryKey(appName, executionId, phase),
    queryFn: () => fetchCanonicalExecutionResultsDetail(appName!, executionId!),
    enabled: !!appName && !!executionId,
    retry: false,
    refetchInterval: query => monitor && query.state.status !== 'error' ? 1_500 : false,
  })
}

/** POST /api/v1/projects — onboard; invalidates the projects list on success. */
export function useOnboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: OnboardRequest) =>
      apiClient.post<OnboardResponse>('/api/v1/projects', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}
