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

import { Router } from 'express'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { ok, fail } from '../http'
import { jobRunner } from '../jobs/JobRunner'
import { workspaceResolver } from '../context/WorkspaceResolver'
import { isValidAppName } from '../context/appName'
import { projectRegistry } from '../registry/ProjectRegistry'
import { executionContext } from '../context/ExecutionContext'

/**
 * TD-UI-002 Crawl tab (ADR-012, Phase 1 — polling).
 *  POST /api/v1/crawl               → 202 { jobId } (fires async, returns at once)
 *  GET  /api/v1/crawl/:jobId/status → Mission Timeline (live log lines) + strategy
 *                                     + structured pages (post-completion, from
 *                                     the SQLite App Model). Client polls every 1s.
 */
const router = Router()

/** Engine crawl mode → user-friendly label (ADR-012). Raw term kept for tooltip. */
const STRATEGY_LABELS: Record<string, string> = {
  bfs:    'Link Following',
  spa:    'Click Discovery',
  hybrid: 'Hybrid Exploration',
  auto:   'Auto-detected',
}

export interface DiscoveredPage {
  id:               string
  url:              string          // app.baseUrl + urlPattern (audit ruling)
  urlPattern:       string
  module:           string          // page.module?.name ?? 'Unknown'
  moduleConfidence: string | null
  moduleReason:     string | null   // ADR-020 §6: the evidence behind the confidence grade
  elements:         number          // page.elements?.length ?? 0
  roles:            string[]        // page.accessibleByRoles ?? []
  // depth: omitted — not present in the SQLite App Model (audit)
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
}

/** Resolve the app's start URL (CrawlRunner requires it): registry, then config. */
function resolveUrl(appName: string): string | undefined {
  const fromRegistry = projectRegistry.find(appName)?.url
  if (fromRegistry) return fromRegistry
  const ws = workspaceResolver.resolve(appName)
  return readJson(path.join(ws.forgeDir, 'config.json'))?.url
}

/** Pure map: a SQLite-backed App Model → table rows (audit ruling; no depth). */
export function mapModelPages(model: any): DiscoveredPage[] {
  if (!Array.isArray(model?.pages)) return []
  const baseUrl: string = model.app?.baseUrl ?? ''
  return model.pages.map((p: any): DiscoveredPage => ({
    id:               p.id ?? '',
    url:              baseUrl + (p.urlPattern ?? ''),
    urlPattern:       p.urlPattern ?? '',
    module:           p.module?.name ?? 'Unknown',
    moduleConfidence: p.module?.confidence ?? null,
    moduleReason:     p.module?.reason ?? null,
    elements:         Array.isArray(p.elements) ? p.elements.length : 0,
    roles:            Array.isArray(p.accessibleByRoles) ? p.accessibleByRoles : [],
  }))
}

/** A crawl diagnostic from the SQLite App Model (TD-UI-064). Structural mirror of the engine's
 *  CrawlDiagnostic (src/core/onboarding/types.ts) — redeclared, never imported (forge-ui →
 *  src is one-directional). `reason` is left open (string) so an unknown/future reason
 *  passes through and degrades honestly rather than being dropped. */
export interface CrawlDiagnostic {
  scope:   'start-page' | 'role' | 'page'
  target:  string
  reason:  string
  detail:  string
  remedy?: { tier: number; action: string }
  loginSurfaceObservation?: {
    check:        'login-surface-observation'
    observations: { signal: string; observation: string; mechanism: string; observationBoundary: string }[]
    note:         string
  }
}

/** Pure map: a SQLite-backed App Model → crawl diagnostics (TD-UI-064). Field selection only,
 *  NO business logic — reads .app.crawlMetadata.crawlDiagnostics and passes the engine's
 *  structured observation payload through VERBATIM (the UI renders it, never authors it).
 *  null crawlMetadata (unsupported-platform) or null crawlDiagnostics (clean crawl) → []. */
export function mapModelDiagnostics(model: any): CrawlDiagnostic[] {
  const diags = model?.app?.crawlMetadata?.crawlDiagnostics
  return Array.isArray(diags) ? diags : []
}

/** Parse the engine crawl mode from a '… | Mode: <mode> | …' log line. */
export function parseStrategy(lines: string[]): { raw: string | null; label: string | null } {
  let raw: string | null = null
  for (const l of lines) {
    // Matches BOTH '[StrategyDetector] Mode: bfs | …' and
    // '[FORGE Crawler] Role: … | Mode: bfs | …' (Issue #3). Constrained to the
    // real modes so a stray 'Mode:' line can't set a bogus strategy.
    const m = l.match(/Mode:\s*(bfs|spa|hybrid)\b/)
    if (m) raw = m[1]   // last match wins (multi-role, last-wins ruling)
  }
  return { raw, label: raw ? (STRATEGY_LABELS[raw] ?? raw) : null }
}

const DISCOVERED = /\[FORGE Crawler\] Discovered:/

/** Count the per-page '[FORGE Crawler] Discovered:' lines (live page counter). */
export function countDiscovered(lines: string[]): number {
  return lines.filter(l => DISCOVERED.test(l)).length
}

// POST /api/v1/crawl — start a crawl; 202 immediately (ADR-012 async job).
router.post('/', (req, res) => {
  const { appName, force, aiBudget } = req.body ?? {}
  if (!appName || typeof appName !== 'string')
    return res.status(400).json(fail('appName is required', 'MISSING_APP_NAME'))
  if (!isValidAppName(appName))   // TD-UI-051 — reject traversal before resolveUrl→resolve
    return res.status(400).json(fail('appName must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, hyphens).', 'INVALID_APP_NAME'))

  const url = resolveUrl(appName)
  if (!url)
    return res.status(404).json(fail(`Project '${appName}' not found — onboard it first`, 'NOT_FOUND'))

  const jobId = randomUUID()
  // Fire WITHOUT await — 202 returns immediately; the client polls /:jobId/status.
  // Credentials are NOT read here (ADR-013): ExecutionContext's credential
  // provider resolves + injects them from the sidecar reference + env pair.
  void jobRunner.submit({
    jobId,
    type: 'crawl',
    appName,
    options: { url, appName, force: !!force, aiBudget },
  })

  res.status(202).json(ok({ jobId }))
})

// GET /api/v1/crawl/:jobId/status — Mission Timeline (live) + pages (post-crawl).
router.get('/:jobId/status', async (req, res) => {
  const view = jobRunner.getStatus(req.params.jobId)
  if (!view) return res.status(404).json(fail('Job not found', 'NOT_FOUND'))

  const { raw, label } = parseStrategy(view.lines)
  let model: unknown | null = null
  if (view.status === 'completed') {
    try {
      model = await executionContext.readAppModel(view.appName)
    } catch (err) {
      return res.status(500).json(
        fail(`SQLite App Model read failed: ${String(err)}`, 'APP_MODEL_READ_FAILED'),
      )
    }
  }
  const pages = mapModelPages(model)                    // [] when model is null
  const crawlDiagnostics = mapModelDiagnostics(model)   // [] when model is null
  const pagesFound = view.status === 'completed' ? pages.length : countDiscovered(view.lines)

  res.json(ok({
    jobId:       view.jobId,
    status:      view.status,      // running | completed | failed
    complete:    view.complete,
    lines:       view.lines,       // Mission Timeline
    strategy:    label,            // user-friendly (ADR-012); null until Mode line appears
    strategyRaw: raw,              // engine term, for the hover tooltip
    pagesFound,                    // live count while running; pages.length when complete
    pages,                         // [] until complete, then from the SQLite App Model
    crawlDiagnostics,              // [] until complete; [] also = clean crawl (TD-UI-064)
    error:       view.error ?? null,
    startedAt:   view.startedAt,
    completedAt: view.completedAt ?? null,
  }))
})

export default router
