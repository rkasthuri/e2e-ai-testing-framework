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

/**
 * Pure helpers for the Test Cases tab (TD-UI-003 Block 5b, extracted 5b follow-up).
 * No React, no fs — unit-testable in isolation (scripts/verify-test-case-helpers).
 * These encode the tab's honesty-critical decisions, so they are proven directly.
 */
import type { ManifestFile, ManifestFlow, ManifestPage } from '../api/types'

// ── Confidence display — honesty-critical mappings ──────────────────────────────
// Flow confidence: unknown is NEVER "Low". POM module confidence: as-is (has 'low').
export const FLOW_CONF: Record<string, { label: string; cls: string }> = {
  observed: { label: 'High',    cls: 'text-pass' },
  partial:  { label: 'Medium',  cls: 'text-flaky' },
  unknown:  { label: 'Unknown', cls: 'text-unknown' },
}
export const MODULE_CONF: Record<string, { label: string; cls: string }> = {
  high:    { label: 'High',    cls: 'text-pass' },
  medium:  { label: 'Medium',  cls: 'text-flaky' },
  low:     { label: 'Low',     cls: 'text-fail' },
  unknown: { label: 'Unknown', cls: 'text-unknown' },
}

/**
 * A file's confidence badge, or null when the file legitimately has none.
 * A spec whose flowId has no matching flow → null (NEVER default to High — that
 * would silently overstate confidence). Fixtures / api-client / api-spec → null.
 */
export function fileConfidence(
  file: ManifestFile,
  flows: ManifestFlow[],
  pages: ManifestPage[],
): { label: string; cls: string } | null {
  if (file.type === 'spec' && file.flowId) {
    const flow = flows.find(f => f.id === file.flowId)
    return flow ? (FLOW_CONF[flow.confidence] ?? FLOW_CONF.unknown) : null
  }
  if (file.type === 'pom' && file.pageId) {
    const page = pages.find(p => p.id === file.pageId)
    return page ? (MODULE_CONF[page.moduleConfidence] ?? MODULE_CONF.unknown) : null
  }
  return null   // fixture / api-client / api-spec — no confidence, do not invent one
}

/**
 * Review item = a spec that needs human eyes. Partial or unknown flow → yes.
 * RULING (Block 5b follow-up, Aiden): a spec we CANNOT assess — no flowId, or a
 * flowId with no matching flow — IS a review item. Fail toward review, never
 * toward silent trust. Non-spec files are not review items.
 */
export function isReviewItem(file: ManifestFile, flows: ManifestFlow[]): boolean {
  if (file.type !== 'spec') return false
  if (!file.flowId) return true                       // unassessable → review
  const flow = flows.find(f => f.id === file.flowId)
  if (!flow) return true                              // unassessable → review
  return flow.confidence === 'partial' || flow.confidence === 'unknown'
}

/**
 * relativePath → { dir (relative to tests/, '(root)' for top level), name }.
 * Normalizes Windows backslashes so a manifest minted on either OS groups
 * identically (portability). Real manifest paths are already forward-slash.
 */
export function splitPath(relativePath: string): { dir: string; name: string } {
  const norm = relativePath.replace(/\\/g, '/').replace(/^tests\//, '')
  const slash = norm.lastIndexOf('/')
  return slash === -1
    ? { dir: '(root)', name: norm }
    : { dir: norm.slice(0, slash), name: norm.slice(slash + 1) }
}

/** The flow a spec file covers, or null (non-spec, no flowId, or no match). */
export function flowForFile(file: ManifestFile, flows: ManifestFlow[]): ManifestFlow | null {
  if (file.type !== 'spec' || !file.flowId) return null
  return flows.find(f => f.id === file.flowId) ?? null
}

/**
 * Human-readable generation duration from a performance.now() delta (ms).
 * ms / s (one decimal under a minute) / m s. 0 renders as "0 ms" — a real zero,
 * never a dash. '—' only for a non-finite/negative input (defensive; the manifest
 * always carries a real number).
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const totalSec = Math.round(ms / 1000)
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
}

/**
 * Compose the "Why was this generated?" note from REAL manifest evidence ONLY.
 *
 * HONESTY BOUNDARY (Nova/Finn) — the crux of Block 5c: FORGE has NO AI-authored
 * intent string today. FlowDefinition carries no reasoning field and enrichWithAi
 * never requests one (Step-0 audit). So this note is a factual statement of the
 * evidence FORGE actually has — flow.source, flow.confidence, and the engine's
 * real groundingWarnings — NEVER a fabricated explanation of "intent". When there
 * are no warnings it says so; it must never pad with invented text. If the data
 * is thin, the note is thin — that is the honest outcome.
 *
 * FUTURE WORK: a true AI-authored rationale would require enrichWithAi to REQUEST
 * a rationale and a new FlowDefinition field to persist it. Until both exist, this
 * function stays purely factual and this comment stands as the reason why.
 */
export function composeIntentNote(flow: ManifestFlow): string {
  const sentences: string[] = [
    `Source: ${flow.source}.`,
    `Confidence: ${flow.confidence}.`,
  ]
  if (flow.confidence === 'partial') {
    sentences.push('This flow contains steps FORGE did not directly observe.')
  } else if (flow.confidence === 'unknown') {
    sentences.push('FORGE has no direct observational evidence for this flow.')
  }
  sentences.push(
    flow.groundingWarnings.length > 0
      ? `Grounding warnings: ${flow.groundingWarnings.join('; ')}.`
      : 'No grounding warnings were recorded.',
  )
  return sentences.join(' ')
}
