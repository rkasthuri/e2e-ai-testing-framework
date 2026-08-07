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
import * as fs from 'fs'
import * as path from 'path'
import { validateAppModelObject } from '../onboarding/ModelValidator'

export type JsonMigrationClassification =
  | 'safe_new_import'
  | 'exact_duplicate'
  | 'semantic_duplicate_different_serialization'
  | 'conflicting_active_snapshot'
  | 'matching_superseded_snapshot'
  | 'invalid_json'
  | 'schema_invalid_json'
  | 'ambiguous_identity'

export type ProposedMigrationAction =
  | 'would_import_as_active'
  | 'no_op'
  | 'no_op_preserve_superseded'
  | 'refuse'

export type Migration016Status = 'applied' | 'not_applied' | 'inconsistent'
export type JsonMigrationVerdict = 'PASS' | 'BLOCKED'

export interface Migration016Report {
  status: Migration016Status
  historyApplied: boolean
  indexPresent: boolean
  indexUnique: boolean
  indexPartial: boolean
  indexTable: string | null
  indexTargetsAppModels: boolean
  indexedColumns: Array<string | null>
  indexColumnExact: boolean
  indexPredicateExact: boolean
  indexCaseSensitive: boolean
  indexContractValid: boolean
}

export type DatabaseBlockerCode =
  | 'migration_016_not_applied'
  | 'single_active_index_missing_or_invalid'
  | 'duplicate_active_rows'

export interface DuplicateActiveIdentity {
  appName: string
  rowIds: number[]
}

export interface MigrationDatabaseReadiness {
  readOnly: true
  identity: { fileName: string; sha256: string }
  appModelsTablePresent: true
  appModelsColumns: string[]
  migrationHistoryTablePresent: boolean
  appliedMigrations: string[]
  activeRows: Array<{ id: number; appName: string }>
  duplicateActiveIdentities: DuplicateActiveIdentity[]
  ready: boolean
  blockers: Array<{
    code: DatabaseBlockerCode
    reason: string
  }>
}

export interface JsonSourceIdentity {
  appName: string | null
  modelVersion: string | null
  baseUrl: string | null
  appType: string | null
  renderingModel: string | null
}

export interface JsonSourceProvenance {
  generatedAt: string | null
  generatedBy: string | null
  crawledAt: string | null
  crawledBy: string | null
  crawlConfigHash: string | null
  evidenceState: string | null
  classificationRunId: string | null
  verificationState: string | null
}

export type SqliteSerializationMatch =
  | 'exact_serialization'
  | 'semantic_equal'
  | 'different'
  | 'unreadable_model_json'

export interface SqliteSnapshotMatch {
  id: number
  appName: string
  version: string
  status: string
  canonicalSha256: string | null
  serializationMatch: SqliteSerializationMatch
}

export interface JsonMigrationPlanItem {
  sourcePath: string
  rawSha256: string
  canonicalSha256: string | null
  identity: JsonSourceIdentity
  provenance: JsonSourceProvenance
  validation: {
    parsed: boolean
    schemaValid: boolean | null
    errors: string[]
  }
  sqliteMatches: SqliteSnapshotMatch[]
  classification: JsonMigrationClassification
  proposedAction: ProposedMigrationAction
  actionPerformed: false
  blocking: boolean
  reason: string
}

export interface JsonAppModelMigrationPlan {
  reportVersion: 'json-app-model-dry-run/v1'
  mode: 'dry-run'
  sourceRoot: string
  databasePath: string
  migration016: Migration016Report
  databaseReadiness: MigrationDatabaseReadiness
  actionsPerformed: []
  summary: {
    sourceFiles: number
    blocked: boolean
    verdict: JsonMigrationVerdict
    exitCode: 0 | 1
    classifications: Record<JsonMigrationClassification, number>
  }
  items: JsonMigrationPlanItem[]
}

export interface JsonAppModelMigrationPlannerOptions {
  modelsDir: string
  databasePath: string
}

export class JsonMigrationDatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'JsonMigrationDatabaseError'
  }
}

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson }

interface AppModelDbRow {
  id: number
  app_name: string
  version: string
  status: string
  model_json: string
}

interface SourceInspection {
  sourcePath: string
  raw: string
  rawSha256: string
  parsed: unknown | null
  parseError: string | null
  canonicalSha256: string | null
  identity: JsonSourceIdentity
  provenance: JsonSourceProvenance
  identityError: string | null
  schemaValid: boolean | null
  schemaErrors: string[]
}

const CLASSIFICATION_ORDER: JsonMigrationClassification[] = [
  'safe_new_import',
  'exact_duplicate',
  'semantic_duplicate_different_serialization',
  'conflicting_active_snapshot',
  'matching_superseded_snapshot',
  'invalid_json',
  'schema_invalid_json',
  'ambiguous_identity',
]

const BLOCKING_CLASSIFICATIONS = new Set<JsonMigrationClassification>([
  'conflicting_active_snapshot',
  'invalid_json',
  'schema_invalid_json',
  'ambiguous_identity',
])

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/**
 * Return a new JSON value whose object keys are sorted recursively.
 * Arrays retain their original order and the input value is never mutated.
 */
export function canonicalizeJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON cannot contain a non-finite number.')
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => canonicalizeJson(item))
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result = Object.create(null) as Record<string, CanonicalJson>
    for (const key of Object.keys(source).sort()) {
      result[key] = canonicalizeJson(source[key])
    }
    return result
  }
  throw new TypeError(`Canonical JSON cannot contain a value of type '${typeof value}'.`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

export function canonicalJsonSha256(value: unknown): string {
  return sha256(canonicalJson(value))
}

function posixPath(value: string): string {
  return value.split(path.sep).join('/')
}

/** Keep operational absolute paths out of the deterministic payload. */
function stableInputReference(resolvedPath: string): string {
  const relative = path.relative(process.cwd(), resolvedPath)
  const outsideCurrentDirectory = relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  return outsideCurrentDirectory
    ? path.basename(resolvedPath)
    : (relative === '' ? '.' : posixPath(relative))
}

/** Code-unit comparison is stable across operating-system locale settings. */
function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function listAppModelFiles(modelsDir: string): string[] {
  const files: string[] = []
  const visit = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => compareNames(a.name, b.name))
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
      } else if (entry.isFile() && entry.name === 'app-model.json') {
        files.push(fullPath)
      }
    }
  }
  visit(modelsDir)
  return files
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function inspectSource(filePath: string, modelsDir: string): SourceInspection {
  const rawBuffer = fs.readFileSync(filePath)
  const raw = rawBuffer.toString('utf8')
  const sourcePath = posixPath(path.relative(modelsDir, filePath))

  let parsed: unknown | null = null
  let parseError: string | null = null
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (cause) {
    parseError = cause instanceof Error ? cause.message : String(cause)
  }

  const root = parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown>
    : null
  const app = root?.app && typeof root.app === 'object'
    ? root.app as Record<string, unknown>
    : null
  const crawlMetadata = app?.crawlMetadata && typeof app.crawlMetadata === 'object'
    ? app.crawlMetadata as Record<string, unknown>
    : null
  const appName = stringValue(app?.name)
  const expectedFolder = path.basename(path.dirname(filePath))

  let identityError: string | null = null
  if (parsed !== null) {
    if (!appName || appName.length === 0) {
      identityError = 'Missing non-empty app.name identity.'
    } else if (expectedFolder !== appName) {
      identityError =
        `Source folder '${expectedFolder}' does not exactly match case-sensitive app.name '${appName}'.`
    }
  }

  let schemaValid: boolean | null = null
  let schemaErrors: string[] = []
  if (parsed !== null) {
    const validation = validateAppModelObject(parsed)
    schemaValid = validation.valid
    schemaErrors = validation.errors
  }

  return {
    sourcePath,
    raw,
    rawSha256: sha256(rawBuffer),
    parsed,
    parseError,
    canonicalSha256: parsed === null ? null : canonicalJsonSha256(parsed),
    identity: {
      appName,
      modelVersion: stringValue(app?.modelVersion),
      baseUrl: stringValue(app?.baseUrl),
      appType: stringValue(app?.appType),
      renderingModel: stringValue(app?.renderingModel),
    },
    provenance: {
      generatedAt: stringValue(root?.generatedAt),
      generatedBy: stringValue(root?.generatedBy),
      crawledAt: stringValue(crawlMetadata?.crawledAt),
      crawledBy: stringValue(crawlMetadata?.crawledBy),
      crawlConfigHash: stringValue(crawlMetadata?.crawlConfigHash),
      evidenceState: stringValue(app?.evidenceState),
      classificationRunId: stringValue(root?.classificationRunId),
      verificationState:
        stringValue(app?.verificationState)
        ?? stringValue(root?.verificationState),
    },
    identityError,
    schemaValid,
    schemaErrors,
  }
}

function stripOuterSqlParentheses(value: string): string {
  let result = value.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let quote: "'" | '"' | '`' | ']' | null = null
    let enclosesWholeExpression = true
    for (let index = 0; index < result.length; index++) {
      const character = result[index]
      if (quote) {
        if (quote === ']' && character === ']') {
          quote = null
        } else if (quote !== ']' && character === quote) {
          if (result[index + 1] === quote) {
            index++
          } else {
            quote = null
          }
        }
        continue
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character
      } else if (character === '[') {
        quote = ']'
      } else if (character === '(') {
        depth++
      } else if (character === ')') {
        depth--
        if (depth === 0 && index < result.length - 1) {
          enclosesWholeExpression = false
          break
        }
      }
    }
    if (!enclosesWholeExpression || depth !== 0 || quote !== null) break
    result = result.slice(1, -1).trim()
  }
  return result
}

function unquoteSqlIdentifier(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/""/g, '"')
  }
  if (value.startsWith('`') && value.endsWith('`')) {
    return value.slice(1, -1).replace(/``/g, '`')
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).replace(/\]\]/g, ']')
  }
  return value
}

function isExactActivePredicate(indexSql: string | null): boolean {
  if (!indexSql) return false
  const where = indexSql.match(/\bWHERE\b([\s\S]*)$/i)
  if (!where) return false
  const predicate = stripOuterSqlParentheses(
    where[1].trim().replace(/;\s*$/, ''),
  )
  const equality = predicate.match(
    /^([A-Za-z_][A-Za-z0-9_]*|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\])\s*=\s*('(?:[^']|'')*')$/,
  )
  if (!equality) return false
  const identifier = unquoteSqlIdentifier(equality[1])
  const literal = equality[2].slice(1, -1).replace(/''/g, "'")
  return identifier.toLowerCase() === 'status' && literal === 'active'
}

function migration016Report(db: any): Migration016Report {
  const migrationTable = db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name = 'kysely_migration'`,
  ).get() as { name?: string } | undefined
  const historyApplied = migrationTable
    ? Boolean(db.prepare(
        'SELECT 1 AS found FROM kysely_migration WHERE name = ? LIMIT 1',
      ).get('016_app_models_single_active'))
    : false

  const indexes = db.pragma('index_list(app_models)') as Array<{
    name: string
    unique: number
    partial: number
  }>
  const index = indexes.find(row => row.name === 'idx_models_one_active')
  const definition = db.prepare(
    `SELECT tbl_name, sql FROM sqlite_master
     WHERE type = 'index' AND name = ?`,
  ).get('idx_models_one_active') as { tbl_name: string; sql: string | null } | undefined
  const indexInfo = definition
    ? db.pragma('index_xinfo(idx_models_one_active)') as Array<{
        cid: number
        name: string | null
        coll: string | null
        key: number
      }>
    : []
  const keyColumns = indexInfo.filter(row => row.key === 1)
  const indexedColumns = keyColumns.map(row => row.name)
  const indexPresent = Boolean(definition)
  const indexUnique = index?.unique === 1
  const indexPartial = index?.partial === 1
  const indexTable = definition?.tbl_name ?? null
  const indexTargetsAppModels = indexTable === 'app_models' && Boolean(index)
  const indexColumnExact = keyColumns.length === 1
    && keyColumns[0].cid >= 0
    && keyColumns[0].name === 'app_name'
  const indexPredicateExact = isExactActivePredicate(definition?.sql ?? null)
  const indexCaseSensitive = indexColumnExact
    && keyColumns[0].coll?.toUpperCase() === 'BINARY'
  const indexContractValid = indexPresent
    && indexTargetsAppModels
    && indexUnique
    && indexPartial
    && indexColumnExact
    && indexPredicateExact
    && indexCaseSensitive

  let status: Migration016Status
  if (historyApplied && indexContractValid) {
    status = 'applied'
  } else if (!historyApplied && !indexPresent) {
    status = 'not_applied'
  } else {
    status = 'inconsistent'
  }
  return {
    status,
    historyApplied,
    indexPresent,
    indexUnique,
    indexPartial,
    indexTable,
    indexTargetsAppModels,
    indexedColumns,
    indexColumnExact,
    indexPredicateExact,
    indexCaseSensitive,
    indexContractValid,
  }
}

function inspectDatabaseReadiness(
  db: any,
  databasePath: string,
  migration016: Migration016Report,
): MigrationDatabaseReadiness {
  const migrationHistoryTablePresent = Boolean(db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name = 'kysely_migration'`,
  ).get())
  const appliedMigrations = migrationHistoryTablePresent
    ? (db.prepare('SELECT name FROM kysely_migration ORDER BY name COLLATE BINARY').all() as Array<{ name: string }>)
      .map(row => row.name)
    : []
  const appModelsColumns = (db.pragma('table_info(app_models)') as Array<{ name: string; cid: number }>)
    .sort((left, right) => left.cid - right.cid)
    .map(row => row.name)
  const activeRows = db.prepare(
    `SELECT id, app_name FROM app_models
     WHERE status = 'active'
     ORDER BY app_name COLLATE BINARY, id`,
  ).all() as Array<{ id: number; app_name: string }>
  const activeByName = new Map<string, number[]>()
  for (const row of activeRows) {
    const ids = activeByName.get(row.app_name) ?? []
    ids.push(Number(row.id))
    activeByName.set(row.app_name, ids)
  }
  const duplicateActiveIdentities = [...activeByName.entries()]
    .filter(([, rowIds]) => rowIds.length > 1)
    .map(([appName, rowIds]) => ({ appName, rowIds }))
    .sort((left, right) => compareNames(left.appName, right.appName))

  const blockers: MigrationDatabaseReadiness['blockers'] = []
  if (!migration016.historyApplied) {
    blockers.push({
      code: 'migration_016_not_applied',
      reason: 'Migration 016 is absent from kysely_migration history.',
    })
  }
  if (!migration016.indexContractValid) {
    blockers.push({
      code: 'single_active_index_missing_or_invalid',
      reason:
        'The idx_models_one_active index does not exactly enforce one case-sensitive ' +
        "active row per app_name (UNIQUE app_models(app_name) WHERE status = 'active').",
    })
  }
  if (duplicateActiveIdentities.length > 0) {
    blockers.push({
      code: 'duplicate_active_rows',
      reason: `Duplicate active app_name identities exist: ${duplicateActiveIdentities
        .map(item => `${item.appName}=[${item.rowIds.join(',')}]`)
        .join('; ')}`,
    })
  }

  return {
    readOnly: true,
    identity: {
      fileName: path.basename(databasePath),
      sha256: sha256(fs.readFileSync(databasePath)),
    },
    appModelsTablePresent: true,
    appModelsColumns,
    migrationHistoryTablePresent,
    appliedMigrations,
    activeRows: activeRows.map(row => ({ id: Number(row.id), appName: row.app_name })),
    duplicateActiveIdentities,
    ready: blockers.length === 0,
    blockers,
  }
}
function sqliteMatches(source: SourceInspection, rows: AppModelDbRow[]): SqliteSnapshotMatch[] {
  return rows.map(row => {
    let canonicalSha256: string | null = null
    let serializationMatch: SqliteSerializationMatch = 'unreadable_model_json'
    try {
      const parsed = JSON.parse(row.model_json) as unknown
      canonicalSha256 = canonicalJsonSha256(parsed)
      if (row.model_json === source.raw) {
        serializationMatch = 'exact_serialization'
      } else if (canonicalSha256 === source.canonicalSha256) {
        serializationMatch = 'semantic_equal'
      } else {
        serializationMatch = 'different'
      }
    } catch {
      // The row remains visible in the report but can never count as a match.
    }
    return {
      id: Number(row.id),
      appName: row.app_name,
      version: row.version,
      status: row.status,
      canonicalSha256,
      serializationMatch,
    }
  })
}

function classifiedItem(
  source: SourceInspection,
  matches: SqliteSnapshotMatch[],
  duplicateIdentity: boolean,
): JsonMigrationPlanItem {
  let classification: JsonMigrationClassification
  let proposedAction: ProposedMigrationAction
  let reason: string

  if (source.parsed === null) {
    classification = 'invalid_json'
    proposedAction = 'refuse'
    reason = `JSON parsing failed: ${source.parseError ?? 'unknown parse error'}`
  } else if (source.identityError) {
    classification = 'ambiguous_identity'
    proposedAction = 'refuse'
    reason = source.identityError
  } else if (duplicateIdentity) {
    classification = 'ambiguous_identity'
    proposedAction = 'refuse'
    reason = `Multiple source files claim exact case-sensitive app.name '${source.identity.appName}'.`
  } else if (!source.schemaValid) {
    classification = 'schema_invalid_json'
    proposedAction = 'refuse'
    reason = `Current App Model schema rejected the source: ${source.schemaErrors.join('; ')}`
  } else {
    const active = matches.filter(row => row.status === 'active')
    const exactActive = active.find(row => row.serializationMatch === 'exact_serialization')
    const semanticActive = active.find(row => row.serializationMatch === 'semantic_equal')
    const matchingSuperseded = matches.find(row =>
      row.status === 'superseded'
      && (
        row.serializationMatch === 'exact_serialization'
        || row.serializationMatch === 'semantic_equal'
      ),
    )

    if (active.length > 1) {
      classification = 'ambiguous_identity'
      proposedAction = 'refuse'
      reason =
        `SQLite contains multiple active rows for exact app_name '${source.identity.appName}': ` +
        active.map(row => row.id).join(', ')
    } else if (exactActive) {
      classification = 'exact_duplicate'
      proposedAction = 'no_op'
      reason = `Source serialization exactly matches active SQLite row ${exactActive.id}.`
    } else if (semanticActive) {
      classification = 'semantic_duplicate_different_serialization'
      proposedAction = 'no_op'
      reason =
        `Source is canonically identical to active SQLite row ${semanticActive.id}; ` +
        'only JSON serialization differs.'
    } else if (matchingSuperseded) {
      classification = 'matching_superseded_snapshot'
      proposedAction = 'no_op_preserve_superseded'
      reason =
        `Source matches superseded SQLite row ${matchingSuperseded.id}; ` +
        'the row remains superseded and is not reactivated.'
    } else if (active.length === 1) {
      classification = 'conflicting_active_snapshot'
      proposedAction = 'refuse'
      reason =
        `Active SQLite row ${active[0].id} has the same exact app_name but different snapshot content.`
    } else if (matches.length === 0) {
      classification = 'safe_new_import'
      proposedAction = 'would_import_as_active'
      reason = 'No SQLite rows exist for this exact case-sensitive app_name.'
    } else {
      classification = 'ambiguous_identity'
      proposedAction = 'refuse'
      reason =
        'SQLite contains non-matching historical rows but no active or equivalent snapshot; ' +
        'activation requires an explicit decision.'
    }
  }

  return {
    sourcePath: source.sourcePath,
    rawSha256: source.rawSha256,
    canonicalSha256: source.canonicalSha256,
    identity: source.identity,
    provenance: source.provenance,
    validation: {
      parsed: source.parsed !== null,
      schemaValid: source.schemaValid,
      errors: source.parsed === null
        ? [source.parseError ?? 'unknown parse error']
        : source.schemaErrors,
    },
    sqliteMatches: matches,
    classification,
    proposedAction,
    actionPerformed: false,
    blocking: BLOCKING_CLASSIFICATIONS.has(classification),
    reason,
  }
}

export function planJsonAppModelMigration(
  options: JsonAppModelMigrationPlannerOptions,
): JsonAppModelMigrationPlan {
  const sourceRoot = path.resolve(options.modelsDir)
  const databasePath = path.resolve(options.databasePath)
  const files = listAppModelFiles(sourceRoot)
  const sources = files.map(file => inspectSource(file, sourceRoot))

  const identityCounts = new Map<string, number>()
  for (const source of sources) {
    const name = source.identity.appName
    if (name) identityCounts.set(name, (identityCounts.get(name) ?? 0) + 1)
  }

  const BetterSqlite3 = require('better-sqlite3')
  let db: any
  try {
    db = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true })
  } catch (cause) {
    throw new JsonMigrationDatabaseError(
      `SQLite database is unavailable or unreadable: ${stableInputReference(databasePath)}`,
      { cause },
    )
  }

  try {
    const table = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'app_models'`,
    ).get() as { name?: string } | undefined
    if (!table) {
      throw new JsonMigrationDatabaseError(
        `SQLite database does not contain the required app_models table: ${stableInputReference(databasePath)}`,
      )
    }

    const migration016 = migration016Report(db)
    const databaseReadiness = inspectDatabaseReadiness(db, databasePath, migration016)
    const items = sources.map(source => {
      const appName = source.identity.appName
      const rows = appName
        ? db.prepare(
            `SELECT id, app_name, version, status, model_json
             FROM app_models
             WHERE app_name COLLATE BINARY = ?
             ORDER BY id`,
          ).all(appName) as AppModelDbRow[]
        : []
      return classifiedItem(
        source,
        sqliteMatches(source, rows),
        appName !== null && (identityCounts.get(appName) ?? 0) > 1,
      )
    })

    const classifications = Object.fromEntries(
      CLASSIFICATION_ORDER.map(name => [name, 0]),
    ) as Record<JsonMigrationClassification, number>
    for (const item of items) classifications[item.classification]++
    const blocked = !databaseReadiness.ready || items.some(item => item.blocking)

    return {
      reportVersion: 'json-app-model-dry-run/v1',
      mode: 'dry-run',
      sourceRoot: stableInputReference(sourceRoot),
      databasePath: stableInputReference(databasePath),
      migration016,
      databaseReadiness,
      actionsPerformed: [],
      summary: {
        sourceFiles: items.length,
        blocked,
        verdict: blocked ? 'BLOCKED' : 'PASS',
        exitCode: blocked ? 1 : 0,
        classifications,
      },
      items,
    }
  } catch (cause) {
    if (cause instanceof JsonMigrationDatabaseError) throw cause
    throw new JsonMigrationDatabaseError(
      `Could not read App Model state from SQLite database: ${stableInputReference(databasePath)}`,
      { cause },
    )
  } finally {
    db.close()
  }
}

export function deterministicMigrationReportJson(plan: JsonAppModelMigrationPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`
}
