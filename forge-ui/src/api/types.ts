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

// API request/response types — mirror the engine + API.md contract.

export interface DetectionField {
  value: string
  confidence: string
  // ADR-020 §6: provenance for the confidence grade. `source` = evidence-matched |
  // default-fallback | user-supplied; `reason` names the specific evidence. `reason` is
  // '' for pre-ADR-020 manifests (graceful — the row simply omits it).
  source: string
  reason?: string
}

export interface Detection {
  appType:       string   // PLATFORM — a structural fact from the execution context, NOT a graded observation (ruling 2026-07-21). Plain value, no confidence chip.
  renderingModel?: DetectionField   // ADR-021/TD-173: the observed rendering (framework-rendered vs unknown) — absent on pre-refactor manifests
  authType:      DetectionField
  crawlStrategy: DetectionField
  appName:       DetectionField
}

export interface Project {
  appName:       string
  url:           string
  appType:       string
  crawlStrategy: string
  authType:      string
  createdAt:     string
  lastOpenedAt:  string
  workspacePath: string   // '' for fixture fallbacks (not yet crawled)
}

export interface OnboardRequest {
  url:       string
  appName:   string
  username?: string
  password?: string
  dryRun?:   boolean
  jobId?:    string            // TD-UI-011 — client-generated, keys the log buffer
  detectionResult?: Detection  // Step 4 — save-after-dry-run fast path
}

export interface OnboardResponse {
  project:   Project
  detection: Detection
  dryRun:    boolean
}

/** Server envelope: { data, error, timestamp }. */
export interface Envelope<T> {
  data:      T
  error:     string | null
  timestamp: string
}

// --- TD-UI-002 Crawl tab (ADR-012, Phase 1) ---

export interface CrawlRequest {
  appName:  string
  force?:   boolean
  aiBudget?: number
}

/** A page from the SQLite App Model, mapped for the table (audit ruling; no depth). */
export interface DiscoveredPage {
  id:               string
  url:              string          // app.baseUrl + urlPattern
  urlPattern:       string
  module:           string          // 'Unknown' when unclassified
  moduleConfidence: string | null
  moduleReason:     string | null   // ADR-020 §6: the evidence behind the grade
  elements:         number
  roles:            string[]
}

/**
 * TD-148 / TD-UI-064 — the login-surface OBSERVATION carried on a crawlDiagnostics
 * entry. STRUCTURAL mirror of the engine's LoginSurfaceSignal / LoginSurfaceObservationReport
 * / CrawlDiagnostic (src/core/onboarding/types.ts). Redeclared here, NOT imported from src/:
 * forge-ui's one-directional boundary (forge-ui → src, never a static src import). Same
 * discipline as DiscoveredPage. The UI RENDERS these strings verbatim; it never authors
 * them — the engine owns observation values, mechanism, boundary, and note text.
 */
export interface LoginSurfaceSignal {
  signal:              'password-field' | 'app-shape' | 'landing-url'
  observation:         string   // the value, factually — or 'not observed'
  mechanism:           string   // how it was obtained, incl. its blind spot
  observationBoundary: string   // what the observation cannot determine + competing causes
}

export interface LoginSurfaceObservationReport {
  check:        'login-surface-observation'
  observations: LoginSurfaceSignal[]
  note:         string
}

export type CrawlDiagnosticReason =
  | 'page-load-failed' | 'auth-required' | 'auth-failed' | 'zero-clickables'
  | 'hydration-timeout' | 'navigation-error' | 'login-surface-observation'

export interface CrawlDiagnostic {
  scope:   'start-page' | 'role' | 'page'
  target:  string
  reason:  CrawlDiagnosticReason
  detail:  string
  remedy?: { tier: 1 | 2 | 3; action: string }
  loginSurfaceObservation?: LoginSurfaceObservationReport
}

export interface CrawlStatus {
  jobId:       string
  status:      'running' | 'completed' | 'failed'
  complete:    boolean
  lines:       string[]             // Mission Timeline
  strategy:    string | null        // user-friendly label
  strategyRaw: string | null        // engine term, for the tooltip
  pagesFound:  number
  pages:       DiscoveredPage[]      // [] until complete
  crawlDiagnostics: CrawlDiagnostic[]  // [] until complete; [] also = clean crawl (render nothing)
  error:       string | null
  startedAt:   string
  completedAt: string | null
}

// --- TD-UI-003 Test Cases tab — generation manifest ---
// STRUCTURAL mirror of the engine's GenerationManifest (src/core/onboarding/
// GenerationManifest.ts). Redeclared here, NOT imported from src/: forge-ui's
// one-directional boundary (forge-ui → src, never a static src import). Same
// discipline as JobResult/ResolvedWorkspace and TestFileResolver's local shape.

export type TestFileType = 'spec' | 'pom' | 'fixture' | 'api-client' | 'api-spec'
export type FlowConfidenceTier = 'observed' | 'partial' | 'unknown'

export interface ManifestFile {
  id:           string   // opaque handle — the ONLY thing the file route accepts
  relativePath: string
  type:         TestFileType
  reason:       string
  flowId?:      string
  pageId?:      string
}

export interface ManifestFlow {
  id:                string
  displayName:       string
  confidence:        FlowConfidenceTier
  source:            string
  groundingWarnings: string[]
  specFile:          string
}

export interface ManifestPage {
  id:               string
  urlPattern:       string
  moduleConfidence: string   // 'high' | 'medium' | 'low' | 'unknown'
  pomFile:          string
}

export interface GenerationManifest {
  schemaVersion:       number
  generatorVersion:    string
  appName:             string
  generatedAt:         string
  durationMs:          number
  classificationRunId?: string
  specCount:           number
  pomCount:            number
  fixtureCount:        number
  filesWritten:        number
  observedFlows:       number
  partialFlows:        number
  unknownFlows:        number
  flows:               ManifestFlow[]
  pages:               ManifestPage[]
  files:               ManifestFile[]
}

/** GET /api/v1/projects/:appName/tests/file/:fileId — one generated file's content. */
export interface TestFileContent {
  id:           string
  relativePath: string
  language:     string   // 'typescript'
  content:      string
  lastModified: string   // ISO — file mtime
  generatedAt:  string   // ISO — from the manifest
}
