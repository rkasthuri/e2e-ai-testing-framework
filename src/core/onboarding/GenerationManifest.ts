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
 * GenerationManifest — first-class engine type describing the output of a
 * single GeneratorRunner.generateIntoWorkspace() invocation. Nova-approved:
 * the producer (GeneratorRunner) describes its own output; consumers (UI,
 * CLI, future cloud) never reconstruct it. Persisted to
 * <workspace>/.forge/generation-manifest.json and returned as JobResult.result
 * through ExecutionContext → JobRunner → API.
 */

import type { FlowConfidence, FlowSource, ModuleConfidence } from './types'

export type GenerationFileReason = 'new-flow' | 'regenerated' | 'unchanged'
export type GenerationFileType = 'spec' | 'pom' | 'fixture' | 'api-client' | 'api-spec'
export const GENERATION_SCHEMA_VERSION = 3   // v3 (TD-140): refusals[] + vacuous/partial/omitted counts

export interface GenerationFile {
  /** Stable, deterministic ID: SHA-256 of relativePath. Survives regeneration.
   *  The ID — never a path — is what clients reference. */
  id: string
  /** Relative path from workspace root e.g. tests/checkout/checkout-flow.spec.ts */
  relativePath: string
  type: GenerationFileType
  reason: GenerationFileReason
  /** flowId this file covers (undefined for fixtures) */
  flowId?: string
  /** pageId this file covers (undefined for specs and fixtures) */
  pageId?: string
}

export interface GenerationFlow {
  id: string
  displayName: string
  confidence: FlowConfidence
  source: FlowSource
  groundingWarnings: string[]
  /** Relative path of the spec file generated for this flow */
  specFile: string
}

/**
 * TD-140 — a generated test FORGE refused to execute: every requested step was honestly
 * omitted (FC-004a/TD-081), leaving zero executable statements, so it is emitted as an
 * evidence-based `test.skip` (carrying a forge:could-not-verify annotation) rather than a
 * vacuous green. Detail is the source of truth; the counts below derive from it.
 */
export interface GenerationRefusal {
  /** The generated test id (e.g. TC-GEN-002). */
  testId: string
  /** Relative path of the spec file the refused test lives in. */
  specFile: string
  /** The omission reasons that left the test with no executable statement. */
  omissionReasons: string[]
}

export interface GenerationPage {
  id: string
  /** PageDefinition persists a urlPattern, not a literal crawled URL. */
  urlPattern: string
  moduleConfidence: ModuleConfidence
  /** Relative path of the POM file generated for this page */
  pomFile: string
}

export interface GenerationManifest {
  /** Schema version for future UI compatibility */
  schemaVersion: typeof GENERATION_SCHEMA_VERSION
  /** Semver of the generator that produced this manifest */
  generatorVersion: string
  appName: string
  generatedAt: string        // ISO timestamp
  durationMs: number         // performance.now() delta — generation only
  /**
   * The crawl run ID is not persisted to the AppModel today
   * (AiBudgetTracker.runId is not saved). This is the classification run that
   * produced the model snapshot — a different thing. Do not relabel it as a
   * crawl run. Threading a true crawlRunId is follow-up work.
   */
  classificationRunId?: string

  /** Counts — always derivable from arrays below but surfaced for fast UI rendering */
  specCount: number
  pomCount: number
  fixtureCount: number
  filesWritten: number

  /** Evidence breakdown */
  observedFlows: number      // confidence === 'observed'
  partialFlows: number       // confidence === 'partial'
  unknownFlows: number       // confidence === 'unknown'

  /**
   * TD-140 refusal evidence — FORGE honestly refusing tests must be visible, not silent.
   * Counts are at TEST-CASE granularity (a .spec.ts file holds many tests):
   *   vacuousTestCount — tests emitted as skip (zero executable statements). = refusals.length
   *   partialTestCount — tests with ≥1 executable statement AND ≥1 omission (honest partials).
   *   omittedStepCount — omitted flow steps, counted ONCE per flow from its full-flow test
   *     (which replays every step); NOT re-counted per critical-elements prefix-replay.
   */
  vacuousTestCount: number
  partialTestCount: number
  omittedStepCount: number

  /** Full detail arrays — never omit these; summaries derive from them */
  flows: GenerationFlow[]
  pages: GenerationPage[]
  files: GenerationFile[]
  refusals: GenerationRefusal[]
}
