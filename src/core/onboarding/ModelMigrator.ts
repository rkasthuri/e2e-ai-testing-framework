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
 * TD-UI-031 Block 3 — `forge migrate`: schema 1.0 → 2.0 model upgrade.
 *
 * Wraps the 8 crawl-execution fields into `app.crawlMetadata`, derives
 * `evidenceState` from OBSERVED content (pages/flows/endpoints — app-type
 * agnostic, same rule as ModelValidator.modelHasContent), and sets
 * `crawlDiagnostics: null`. Governed by ADR-015.
 *
 * Discipline:
 *  - IDEMPOTENT: schemaVersion '2.0' → no-op. Running twice changes nothing.
 *  - REFUSES to guess: an unexpected shape (unknown schemaVersion, missing app,
 *    v1.0 without the old crawl fields) throws UnmigratableModelError. It never
 *    writes a model it had to invent.
 *  - VALIDATES before writing: a migrated model that fails the v2 schema aborts
 *    the write — FORGE never persists a model that fails its own schema.
 *  - BACKS UP before rewriting: <file>.pre-v2.bak so the operator can undo.
 */
import * as fs from 'fs'
import * as path from 'path'
import type { Kysely } from 'kysely'
import { validateAppModelObject } from './ModelValidator'

export class UnmigratableModelError extends Error {
  constructor(public readonly target: string, reason: string) {
    super(`Cannot migrate '${target}': ${reason}. Refusing to guess — the model is left untouched.`)
    this.name = 'UnmigratableModelError'
  }
}

const STUB_TYPES = ['mobile-android', 'mobile-ios', 'iot', 'cloud', 'data']
const CRAWL_FIELDS = [
  'crawlConfigHash', 'crawledAt', 'crawledBy', 'crawlDurationMs',
  'pagesBudget', 'pagesDiscovered', 'pagesSkipped', 'aiBudgetStatus',
] as const

/** True when the model already carries the v2 shape. */
export function isV2(model: any): boolean {
  return model?.schemaVersion === '2.0'
}

export interface AppTypeMigration { from: string; to: string; renderingModel: string }

/**
 * ADR-021 (TD-163): legacy appType 'spa'/'mpa' claimed NAVIGATION ARCHITECTURE — a property the
 * detector never measured. Map them to the platform 'web-ui' + renderingModel 'unknown':
 *   'spa' → unknown
 *   'mpa' → unknown
 * Raj's ruling (2026-07-21): a stored appType has two possible origins — detector-produced (a
 * marker was observed) or hand-authored config (a human's navigation claim). The migrator cannot
 * distinguish them. Mapping 'spa' to a rendering value ('framework-rendered') would MANUFACTURE an
 * observation from an unattributable claim — ADR-021 applied in reverse. Both legs therefore map to
 * 'unknown'; a fresh crawl observes rendering directly. The value was never load-bearing.
 * PURE; returns null when there is nothing to map. The caller LOGS (standing logging rule).
 */
export function mapLegacyAppType(appType: unknown): AppTypeMigration | null {
  if (appType === 'spa') return { from: 'spa', to: 'web-ui', renderingModel: 'unknown' }
  if (appType === 'mpa') return { from: 'mpa', to: 'web-ui', renderingModel: 'unknown' }
  return null
}

/**
 * Pure transform, v1.0 → v2.0, PLUS the ADR-021 appType-vocab map (which fires regardless of
 * schemaVersion — a v2 model can still carry legacy 'spa'/'mpa'). Idempotent otherwise.
 * Throws UnmigratableModelError on any shape it cannot faithfully migrate (incl. an appType
 * outside the schema enum, which fails validation with a named mismatch — never a silent misread).
 */
export function migrateModelToV2(model: any, target = '(model)'): { model: any; changed: boolean; appTypeMigration?: AppTypeMigration } {
  if (model == null || typeof model !== 'object') {
    throw new UnmigratableModelError(target, 'not a JSON object')
  }
  // ADR-021 vocab map FIRST — a legacy 'spa'/'mpa' is upgraded even on an already-v2 model,
  // NEVER left to fall through a downstream `=== 'rest-api'` comparison into generic-UI unremarked.
  let working = model
  let appTypeMigration: AppTypeMigration | undefined
  const legacy = model.app && typeof model.app === 'object' ? mapLegacyAppType(model.app.appType) : null
  if (legacy) {
    working = { ...model, app: { ...model.app, appType: legacy.to, renderingModel: legacy.renderingModel } }
    appTypeMigration = legacy
  }
  // TD-173: 'static-rendered' is retired from the vocabulary — it was the false FLOOR (no producer:
  // absence of a marker was mislabelled 'static' instead of 'unknown'). A stored model carrying it
  // has no evidence behind the value (same reason as legacy 'spa'/'mpa'), so normalize to 'unknown';
  // a fresh crawl re-observes rendering directly. Fires regardless of schemaVersion. Logged (standing rule).
  let renderingNormalized = false
  if (working.app && typeof working.app === 'object' && working.app.renderingModel === 'static-rendered') {
    working = { ...working, app: { ...working.app, renderingModel: 'unknown' } }
    renderingNormalized = true
    console.log(`[ModelMigrator] ${target}: renderingModel 'static-rendered' → 'unknown' (TD-173 — the retired false floor had no producer; a fresh crawl re-observes rendering).`)
  }
  if (working.schemaVersion === '2.0') return { model: working, changed: !!appTypeMigration || renderingNormalized, appTypeMigration }   // idempotent apart from the vocab maps
  if (working.schemaVersion !== '1.0') {
    throw new UnmigratableModelError(target, `unexpected schemaVersion ${JSON.stringify(working.schemaVersion)} (expected "1.0" or "2.0")`)
  }
  const app = working.app
  if (!app || typeof app !== 'object') {
    throw new UnmigratableModelError(target, 'missing or invalid app block')
  }
  // A genuine v1.0 model carries the crawl fields at app level. If they are
  // absent, the shape is not what we expect — refuse rather than fabricate.
  const missing = CRAWL_FIELDS.filter(f => !(f in app))
  if (missing.length > 0) {
    throw new UnmigratableModelError(target, `v1.0 app block missing expected field(s): ${missing.join(', ')}`)
  }

  const isStub = STUB_TYPES.includes(app.appType)
  const hasContent =
    (working.pages?.length ?? 0) > 0 ||
    (working.flows?.length ?? 0) > 0 ||
    (working.endpoints?.length ?? 0) > 0
  const evidenceState = isStub ? 'unsupported-platform' : (hasContent ? 'crawled' : 'crawled-empty')

  // unsupported-platform: no crawl ran → crawlMetadata null (the old stub still
  // had a fabricated crawledAt; migration drops it — that is the whole point).
  const crawlMetadata = isStub ? null : {
    crawlConfigHash: app.crawlConfigHash,
    crawledAt:       app.crawledAt,
    crawledBy:       app.crawledBy,
    crawlDurationMs: app.crawlDurationMs,
    pagesBudget:     app.pagesBudget,
    pagesDiscovered: app.pagesDiscovered,
    pagesSkipped:    app.pagesSkipped,
    aiBudgetStatus:  app.aiBudgetStatus,
    crawlDiagnostics: null,
  }

  const migrated = {
    ...working,
    schemaVersion: '2.0',
    app: {
      name:          app.name,
      displayName:   app.displayName,
      baseUrl:       app.baseUrl,
      appType:       app.appType,
      modelVersion:  app.modelVersion,
      spaConfig:     app.spaConfig ?? null,
      evidenceState,
      crawlMetadata,
      ...(app.renderingModel !== undefined ? { renderingModel: app.renderingModel } : {}),   // ADR-021
    },
  }

  const { valid, errors } = validateAppModelObject(migrated)
  if (!valid) {
    throw new UnmigratableModelError(target, `migrated model fails the v2 schema — NOT written: ${errors.join('; ')}`)
  }
  return { model: migrated, changed: true, appTypeMigration }
}

export interface FileMigrationResult {
  file: string
  changed: boolean
  evidenceState: string
}

/** Migrate one app-model.json in place: validate → back up → write. */
export function migrateModelFile(modelPath: string): FileMigrationResult {
  let model: any
  try {
    model = JSON.parse(fs.readFileSync(modelPath, 'utf-8'))
  } catch (e: any) {
    throw new UnmigratableModelError(modelPath, `unreadable / invalid JSON (${e.message})`)
  }
  const { model: migrated, changed, appTypeMigration } = migrateModelToV2(model, modelPath)
  if (appTypeMigration) {
    // Standing logging rule: reconstructable from the line alone (file, old→new, why).
    console.log(`[ModelMigrator] ${modelPath}: legacy appType '${appTypeMigration.from}' → appType '${appTypeMigration.to}' + renderingModel '${appTypeMigration.renderingModel}' (ADR-021 — 'spa'/'mpa' claimed navigation architecture, retired).`)
  }
  if (!changed) {
    return { file: modelPath, changed: false, evidenceState: migrated.app.evidenceState }
  }
  // Back up the original, then write (transform already validated inside migrateModelToV2).
  fs.copyFileSync(modelPath, `${modelPath}.pre-v2.bak`)
  fs.writeFileSync(modelPath, JSON.stringify(migrated, null, 2), 'utf-8')
  return { file: modelPath, changed: true, evidenceState: migrated.app.evidenceState }
}

export interface WorkspaceMigrationReport {
  diskModels:  FileMigrationResult[]
  dbRowsTotal:   number
  dbRowsMigrated: number
  dbRowsSkipped:  number   // already v2
  dbBackupPath:  string | null
}

/** Scan every models/<app>/app-model.json under the workspace and migrate each. */
export function migrateDiskModels(modelsDir: string): FileMigrationResult[] {
  if (!fs.existsSync(modelsDir)) return []
  const results: FileMigrationResult[] = []
  for (const entry of fs.readdirSync(modelsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const modelPath = path.join(modelsDir, entry.name, 'app-model.json')
    if (!fs.existsSync(modelPath)) continue
    results.push(migrateModelFile(modelPath))   // throws (refuses) on bad shape — surfaced to caller
  }
  return results
}

/**
 * Migrate every app_models.model_json blob (by primary key — the table carries
 * duplicate app_name/version pairs) and set the evidence_state column + crawled_at
 * consistently with the migrated model. Idempotent.
 */
export async function migrateDbBlobs(db: Kysely<any>): Promise<{ total: number; migrated: number; skipped: number }> {
  const rows = await db.selectFrom('app_models').select(['id', 'model_json']).execute()
  let migrated = 0, skipped = 0
  for (const row of rows) {
    let model: any
    try { model = JSON.parse(row.model_json) } catch (e: any) {
      throw new UnmigratableModelError(`app_models.id=${row.id}`, `unreadable model_json (${e.message})`)
    }
    const { model: next, changed, appTypeMigration } = migrateModelToV2(model, `app_models.id=${row.id}`)
    if (appTypeMigration) {
      console.log(`[ModelMigrator] app_models.id=${row.id}: legacy appType '${appTypeMigration.from}' → appType '${appTypeMigration.to}' + renderingModel '${appTypeMigration.renderingModel}' (ADR-021 — 'spa'/'mpa' claimed navigation architecture, retired).`)
    }
    if (!changed) { skipped++; continue }
    await db.updateTable('app_models')
      .set({
        model_json:     JSON.stringify(next),
        evidence_state: next.app.evidenceState,
        crawled_at:     next.app.crawlMetadata?.crawledAt ?? null,
      })
      .where('id', '=', row.id)
      .execute()
    migrated++
  }
  return { total: rows.length, migrated, skipped }
}
