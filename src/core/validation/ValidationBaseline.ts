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

export type ValidationProfile = 'offline' | 'product' | 'full'
export type ValidationStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN'
export type FindingKind = 'NONE' | 'BASELINE_DEBT' | 'NEW_REGRESSION'

export interface ValidationRemedy {
  tier: 1 | 2 | 3
  action: string
}

export interface ValidationGateResult {
  id: string
  title: string
  required: boolean
  status: ValidationStatus
  findingKind: FindingKind
  detail: string
  evidence: unknown
  remedy: ValidationRemedy | null
  fingerprint: string
}

export interface ValidationReport {
  schemaVersion: 'forge-validation-baseline/v1'
  profile: ValidationProfile
  referenceApplication: {
    name: 'SauceDemo'
    baseUrl: 'https://www.saucedemo.com'
    smokeTests: string[]
  }
  repository: {
    commit: string
    dirty: boolean
  }
  environment: {
    node: string
    platform: NodeJS.Platform
    architecture: string
  }
  databasePath: string
  comparison: {
    mode: 'none' | 'establish' | 'baseline'
    baselinePath: string | null
  }
  gates: ValidationGateResult[]
  overallStatus: ValidationStatus
}

export interface StorageInspection {
  databasePath: string
  databaseSha256Before: string | null
  databaseSha256After: string | null
  gates: ValidationGateResult[]
}

export interface BaselineComparisonOptions {
  establishBaseline?: boolean
  baselineReport?: ValidationReport
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      result[key] = canonicalize(source[key])
    }
    return result
  }
  return value
}

export function deterministicValidationReportJson(report: ValidationReport): string {
  return `${JSON.stringify(canonicalize(report), null, 2)}\n`
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function fileSha256(filePath: string): string {
  return sha256(fs.readFileSync(filePath))
}

function gateFingerprint(
  gate: Omit<ValidationGateResult, 'findingKind' | 'fingerprint'>,
): string {
  return sha256(JSON.stringify(canonicalize({
    id: gate.id,
    status: gate.status,
    detail: gate.detail,
    evidence: gate.evidence,
    remedy: gate.remedy,
  })))
}

export function createGateResult(
  gate: Omit<ValidationGateResult, 'findingKind' | 'fingerprint'>,
): ValidationGateResult {
  if (gate.status !== 'PASS' && gate.remedy === null) {
    throw new Error(`Non-passing validation gate '${gate.id}' must carry a remedy.`)
  }
  return {
    ...gate,
    findingKind: 'NONE',
    fingerprint: gateFingerprint(gate),
  }
}

export function aggregateValidationStatus(
  gates: readonly ValidationGateResult[],
): ValidationStatus {
  const required = gates.filter(gate => gate.required)
  if (required.length === 0) return 'NOT_RUN'
  if (required.some(gate => gate.status === 'FAIL')) return 'FAIL'
  if (required.some(gate => gate.status === 'BLOCKED')) return 'BLOCKED'
  if (required.some(gate => gate.status === 'NOT_RUN')) return 'BLOCKED'
  return 'PASS'
}

export function classifyAgainstBaseline(
  gates: readonly ValidationGateResult[],
  options: BaselineComparisonOptions = {},
): ValidationGateResult[] {
  const priorById = new Map(
    (options.baselineReport?.gates ?? []).map(gate => [gate.id, gate]),
  )

  return gates.map(gate => {
    if (gate.status !== 'FAIL') return { ...gate, findingKind: 'NONE' }
    const prior = priorById.get(gate.id)
    const isDebt = options.establishBaseline === true
      || (prior?.status === 'FAIL' && prior.fingerprint === gate.fingerprint)
    return {
      ...gate,
      findingKind: isDebt ? 'BASELINE_DEBT' : 'NEW_REGRESSION',
    }
  })
}

function pass(
  id: string,
  title: string,
  evidence: unknown,
  detail: string,
): ValidationGateResult {
  return createGateResult({
    id,
    title,
    required: true,
    status: 'PASS',
    detail,
    evidence,
    remedy: null,
  })
}

function fail(
  id: string,
  title: string,
  evidence: unknown,
  detail: string,
  remedy: ValidationRemedy,
): ValidationGateResult {
  return createGateResult({
    id,
    title,
    required: true,
    status: 'FAIL',
    detail,
    evidence,
    remedy,
  })
}

function notRun(
  id: string,
  title: string,
  detail: string,
  remedy: ValidationRemedy,
): ValidationGateResult {
  return createGateResult({
    id,
    title,
    required: true,
    status: 'NOT_RUN',
    detail,
    evidence: null,
    remedy,
  })
}

function quotedIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function rowCounts(db: any): Array<{ table: string; rows: number }> {
  const tables = db.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  ).all() as Array<{ name: string }>
  return tables.map(({ name }) => ({
    table: name,
    rows: Number(
      (db.prepare(`SELECT COUNT(*) AS rows FROM ${quotedIdentifier(name)}`).get() as { rows: number }).rows,
    ),
  }))
}

function dependentStorageNotRun(detail: string): ValidationGateResult[] {
  const remedy: ValidationRemedy = {
    tier: 2,
    action: 'Provide a readable SQLite database containing the FORGE app_models schema, then rerun validation.',
  }
  return [
    notRun('storage.quick-check', 'SQLite quick_check', detail, remedy),
    notRun('storage.foreign-keys', 'SQLite foreign-key integrity', detail, remedy),
    notRun('storage.migration-history', 'SQLite migration history', detail, remedy),
    notRun('storage.migration-016', 'Migration 016 status', detail, remedy),
    notRun('storage.single-active-index', 'Single-active App Model index', detail, remedy),
    notRun('storage.duplicate-active', 'Duplicate active App Models', detail, remedy),
    notRun('storage.active-model-json', 'Active App Model JSON validity', detail, remedy),
    notRun('storage.all-model-json', 'Stored App Model JSON validity', detail, remedy),
    notRun('storage.logical-read-only-proof', 'Read-only logical row-count proof', detail, remedy),
    notRun('storage.read-only-proof', 'Read-only database proof', detail, remedy),
  ]
}

/**
 * Inspect a live SQLite database without invoking Kysely, migrations, WAL mode,
 * or any write-capable connection. Mutation behavior is tested separately with
 * disposable databases.
 */
export function inspectSqliteReadOnly(databasePath: string): StorageInspection {
  const requestedPath = path.resolve(databasePath)
  let resolvedPath: string
  let beforeHash: string
  try {
    resolvedPath = fs.realpathSync(requestedPath)
    beforeHash = fileSha256(resolvedPath)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    const openGate = createGateResult({
      id: 'storage.database-open',
      title: 'SQLite database availability',
      required: true,
      status: 'BLOCKED',
      detail: `SQLite is unavailable or unreadable: ${detail}`,
      evidence: { databasePath: requestedPath },
      remedy: {
        tier: 2,
        action: 'Provide an existing readable SQLite database path and rerun validation.',
      },
    })
    return {
      databasePath: requestedPath,
      databaseSha256Before: null,
      databaseSha256After: null,
      gates: [openGate, ...dependentStorageNotRun('Not run because the SQLite database is unavailable or unreadable.')],
    }
  }
  const BetterSqlite3 = require('better-sqlite3')
  let db: any

  try {
    db = new BetterSqlite3(resolvedPath, {
      readonly: true,
      fileMustExist: true,
    })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    const openGate = createGateResult({
      id: 'storage.database-open',
      title: 'SQLite database availability',
      required: true,
      status: 'BLOCKED',
      detail: `SQLite could not be opened read-only: ${detail}`,
      evidence: { databasePath: resolvedPath },
      remedy: {
        tier: 2,
        action: 'Provide an existing readable SQLite database path and rerun validation.',
      },
    })
    return {
      databasePath: resolvedPath,
      databaseSha256Before: beforeHash,
      databaseSha256After: fileSha256(resolvedPath),
      gates: [openGate, ...dependentStorageNotRun('Not run because the SQLite database could not be opened.')],
    }
  }

  const gates: ValidationGateResult[] = []
  try {
    gates.push(pass(
      'storage.database-open',
      'SQLite database availability',
      { databasePath: resolvedPath, readonly: true },
      'SQLite opened with readonly=true and fileMustExist=true.',
    ))

    const quickCheck = String(db.pragma('quick_check', { simple: true }))
    gates.push(quickCheck === 'ok'
      ? pass('storage.quick-check', 'SQLite quick_check', { result: quickCheck }, 'SQLite quick_check returned ok.')
      : fail(
          'storage.quick-check',
          'SQLite quick_check',
          { result: quickCheck },
          `SQLite quick_check returned '${quickCheck}'.`,
          { tier: 2, action: 'Restore the database from a verified backup or run an approved SQLite recovery procedure.' },
        ))

    const foreignKeyViolations = db.pragma('foreign_key_check') as unknown[]
    gates.push(foreignKeyViolations.length === 0
      ? pass('storage.foreign-keys', 'SQLite foreign-key integrity', [], 'No foreign-key violations were found.')
      : fail(
          'storage.foreign-keys',
          'SQLite foreign-key integrity',
          foreignKeyViolations,
          `${foreignKeyViolations.length} foreign-key violation(s) were found.`,
          { tier: 2, action: 'Repair the reported foreign-key violations in a backed-up disposable copy before changing the live database.' },
        ))

    const tableRows = rowCounts(db)
    const tables = new Set(tableRows.map(row => row.table))
    if (!tables.has('kysely_migration')) {
      gates.push(fail(
        'storage.migration-history',
        'SQLite migration history',
        { tables: [...tables].sort() },
        'The kysely_migration table is absent.',
        { tier: 2, action: 'Use an initialized FORGE database with auditable migration history.' },
      ))
    } else {
      const migrations = db.prepare(
        'SELECT name FROM kysely_migration ORDER BY name',
      ).all() as Array<{ name: string }>
      gates.push(pass(
        'storage.migration-history',
        'SQLite migration history',
        { count: migrations.length, names: migrations.map(row => row.name) },
        `${migrations.length} applied migration(s) were read successfully.`,
      ))
    }

    if (!tables.has('app_models')) {
      gates.push(fail(
        'storage.app-model-table',
        'App Model storage schema',
        { tables: [...tables].sort() },
        'The app_models table is absent.',
        { tier: 2, action: 'Use an initialized FORGE database containing the app_models table.' },
      ))
      const dependentIds = new Set([
        'storage.migration-016',
        'storage.single-active-index',
        'storage.duplicate-active',
        'storage.active-model-json',
        'storage.all-model-json',
      ])
      gates.push(...dependentStorageNotRun(
        'Not run because the app_models table is absent.',
      ).filter(gate => dependentIds.has(gate.id)))
    } else {
      const migration016Applied = tables.has('kysely_migration')
        && Boolean(db.prepare(
          `SELECT 1
             FROM kysely_migration
            WHERE name = ?
            LIMIT 1`,
        ).get('016_app_models_single_active'))
      gates.push(migration016Applied
        ? pass(
            'storage.migration-016',
            'Migration 016 status',
            { applied: true },
            'Migration 016 is recorded as applied.',
          )
        : fail(
            'storage.migration-016',
            'Migration 016 status',
            { applied: false },
            'Migration 016 is not recorded as applied.',
            { tier: 1, action: 'After duplicate-active audit and verified backup, run the approved Migration 016 procedure.' },
          ))

      const indexes = db.pragma('index_list(app_models)') as Array<{
        name: string
        unique: number
        partial: number
      }>
      const singleActiveIndex = indexes.find(index => index.name === 'idx_models_one_active')
      const indexValid = singleActiveIndex?.unique === 1 && singleActiveIndex.partial === 1
      gates.push(indexValid
        ? pass(
            'storage.single-active-index',
            'Single-active App Model index',
            singleActiveIndex,
            'The unique partial single-active index is present.',
          )
        : fail(
            'storage.single-active-index',
            'Single-active App Model index',
            { indexes },
            'The unique partial idx_models_one_active index is absent or invalid.',
            { tier: 1, action: 'Apply Migration 016 only after its duplicate audit and verified backup requirements are satisfied.' },
          ))

      const duplicates = db.prepare(
        `SELECT app_name, COUNT(*) AS count
           FROM app_models
          WHERE status = 'active'
          GROUP BY app_name
         HAVING COUNT(*) > 1
          ORDER BY app_name`,
      ).all() as Array<{ app_name: string; count: number }>
      gates.push(duplicates.length === 0
        ? pass(
            'storage.duplicate-active',
            'Duplicate active App Models',
            [],
            'No exact, case-sensitive app_name has multiple active rows.',
          )
        : fail(
            'storage.duplicate-active',
            'Duplicate active App Models',
            duplicates,
            `${duplicates.length} exact app_name identity or identities have duplicate active rows.`,
            { tier: 2, action: 'Review the duplicate snapshots and explicitly choose their disposition; do not auto-merge, supersede, or delete them.' },
          ))

      const models = db.prepare(
        `SELECT id, app_name, status, model_json
           FROM app_models
          ORDER BY id`,
      ).all() as Array<{
        id: number
        app_name: string
        status: string
        model_json: string
      }>
      const invalid = models.flatMap(row => {
        try {
          const parsed = JSON.parse(row.model_json)
          const validation = validateAppModelObject(parsed)
          return validation.valid ? [] : [{
            id: row.id,
            appName: row.app_name,
            status: row.status,
            reason: 'schema-invalid',
            errors: validation.errors,
          }]
        } catch (cause) {
          return [{
            id: row.id,
            appName: row.app_name,
            status: row.status,
            reason: 'invalid-json',
            errors: [cause instanceof Error ? cause.message : String(cause)],
          }]
        }
      })
      const invalidActive = invalid.filter(row => row.status === 'active')
      gates.push(invalidActive.length === 0
        ? pass(
            'storage.active-model-json',
            'Active App Model JSON validity',
            { checked: models.filter(row => row.status === 'active').length, invalid: [] },
            'Every active App Model parses and satisfies the current schema.',
          )
        : fail(
            'storage.active-model-json',
            'Active App Model JSON validity',
            { checked: models.filter(row => row.status === 'active').length, invalid: invalidActive },
            `${invalidActive.length} active App Model row(s) are malformed or schema-invalid.`,
            { tier: 1, action: 'Regenerate or explicitly migrate each reported active App Model from valid observed evidence.' },
          ))
      gates.push(invalid.length === 0
        ? pass(
            'storage.all-model-json',
            'Stored App Model JSON validity',
            { checked: models.length, invalid: [] },
            'Every stored App Model parses and satisfies the current schema.',
          )
        : fail(
            'storage.all-model-json',
            'Stored App Model JSON validity',
            { checked: models.length, invalid },
            `${invalid.length} stored App Model row(s) are malformed or schema-invalid.`,
            { tier: 2, action: 'Review and explicitly migrate or retire each reported historical snapshot; do not silently discard it.' },
          ))
    }

    const countsAfterRead = rowCounts(db)
    gates.push(JSON.stringify(tableRows) === JSON.stringify(countsAfterRead)
      ? pass(
          'storage.logical-read-only-proof',
          'Read-only logical row-count proof',
          { before: tableRows, after: countsAfterRead },
          'All SQLite table row counts are unchanged after inspection.',
        )
      : fail(
          'storage.logical-read-only-proof',
          'Read-only logical row-count proof',
          { before: tableRows, after: countsAfterRead },
          'One or more SQLite table row counts changed during inspection.',
          { tier: 1, action: 'Stop using the validation command and investigate the unexpected concurrent or validation-time writer.' },
        ))
  } finally {
    db.close()
  }

  const afterHash = fileSha256(resolvedPath)
  gates.push(beforeHash === afterHash
    ? pass(
        'storage.read-only-proof',
        'Read-only database proof',
        { sha256Before: beforeHash, sha256After: afterHash },
        'The SQLite database file hash is unchanged after inspection.',
      )
    : fail(
        'storage.read-only-proof',
        'Read-only database proof',
        { sha256Before: beforeHash, sha256After: afterHash },
        'The SQLite database file hash changed during inspection.',
        { tier: 1, action: 'Stop and identify the writer before relying on this validation report.' },
      ))

  return {
    databasePath: resolvedPath,
    databaseSha256Before: beforeHash,
    databaseSha256After: afterHash,
    gates,
  }
}
