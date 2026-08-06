/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import type {
  OnboardRequest, OnboardResponse, Project, Detection, CrawlRequest, CrawlStatus,
  CrawlProjectContext, ObservationRecord, GenerationManifest, TestFileContent,
} from '../api/types'

/** GET /api/v1/projects — the project switcher + lists consume this. */
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.get<{ projects: Project[] }>('/api/v1/projects'),
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

/** POST /api/v1/projects — onboard; invalidates the projects list on success. */
export function useOnboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: OnboardRequest) =>
      apiClient.post<OnboardResponse>('/api/v1/projects', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}
