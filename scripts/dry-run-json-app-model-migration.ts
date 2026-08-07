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
 * Read-only JSON App Model → SQLite migration planner.
 *
 * This command writes only its requested report file. It never invokes the
 * migration runner, opens SQLite read/write, or changes an App Model JSON file.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  deterministicMigrationReportJson,
  JsonAppModelMigrationPlan,
  JsonMigrationDatabaseError,
  planJsonAppModelMigration,
} from '../src/core/storage/JsonAppModelMigrationPlanner'

interface CliOptions {
  modelsDir: string
  databasePath: string
  reportPath: string
  overwrite: boolean
}

function optionValue(args: string[], name: string): string {
  const index = args.indexOf(name)
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`Missing required option ${name}.`)
  }
  return args[index + 1]
}

export function parseOptions(args: string[]): CliOptions {
  return {
    modelsDir: path.resolve(optionValue(args, '--models-dir')),
    databasePath: path.resolve(optionValue(args, '--db')),
    reportPath: path.resolve(optionValue(args, '--report')),
    overwrite: args.includes('--overwrite'),
  }
}

function assertReportOutsideModels(options: CliOptions): void {
  const relative = path.relative(options.modelsDir, options.reportPath)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('The machine-readable report must be written outside the App Model source directory.')
  }
}

function assertReportCanBeCreated(options: CliOptions): void {
  if (fs.existsSync(options.reportPath) && !options.overwrite) {
    throw new Error(
      `Report already exists: ${options.reportPath}. Pass --overwrite to replace it explicitly.`,
    )
  }
}

export function renderHumanReport(
  plan: JsonAppModelMigrationPlan,
  operational?: { databasePath: string; sourceRoot: string },
): string {
  const lines = [
    'FORGE JSON → SQLite App Model migration dry-run',
    `Database: ${operational?.databasePath ?? plan.databasePath}`,
    `Sources: ${operational?.sourceRoot ?? plan.sourceRoot}`,
    `Migration 016: ${plan.migration016.status}`,
    `  history applied: ${plan.migration016.historyApplied}`,
    `  index present: ${plan.migration016.indexPresent}`,
    `  index unique: ${plan.migration016.indexUnique}`,
    `  index partial: ${plan.migration016.indexPartial}`,
    `Database ready: ${plan.databaseReadiness.ready}`,
    `Database SHA-256: ${plan.databaseReadiness.identity.sha256}`,
    ...plan.databaseReadiness.blockers.map(
      blocker => `  blocker ${blocker.code}: ${blocker.reason}`,
    ),
    '',
    'SOURCE | APP_NAME | VALIDATION | SQLITE MATCH | CLASSIFICATION | ACTION',
  ]

  for (const item of plan.items) {
    const validation = item.validation.parsed
      ? (item.validation.schemaValid ? 'valid' : 'schema-invalid')
      : 'invalid-json'
    const sqliteMatch = item.sqliteMatches.length === 0
      ? 'none'
      : item.sqliteMatches
        .map(row => `${row.id}:${row.status}:${row.serializationMatch}`)
        .join(',')
    lines.push([
      item.sourcePath,
      item.identity.appName ?? '(missing)',
      validation,
      sqliteMatch,
      item.classification,
      item.proposedAction,
    ].join(' | '))
    lines.push(`  reason: ${item.reason}`)
  }

  lines.push('')
  lines.push(`Result: ${plan.summary.blocked ? 'BLOCKED' : 'PASS'}`)
  lines.push(`Exit code: ${plan.summary.exitCode}`)
  lines.push('Actions performed: none. Proposed actions are hypothetical future actions only.')
  lines.push('No database rows, migrations, or App Model JSON files were written.')
  return lines.join('\n')
}

interface FatalReport {
  reportVersion: 'json-app-model-dry-run/v1'
  mode: 'dry-run'
  status: 'error'
  error: {
    code: 'database_unavailable_or_unreadable' | 'invalid_arguments'
    message: string
  }
}

function writeJsonReport(
  reportPath: string,
  report: JsonAppModelMigrationPlan | FatalReport,
  overwrite: boolean,
): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  const json = 'summary' in report
    ? deterministicMigrationReportJson(report)
    : `${JSON.stringify(report, null, 2)}\n`
  fs.writeFileSync(reportPath, json, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' })
}

export function run(args: string[]): number {
  let options: CliOptions
  try {
    options = parseOptions(args)
    assertReportOutsideModels(options)
    assertReportCanBeCreated(options)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.error(`ERROR: ${message}`)
    return 1
  }

  try {
    const plan = planJsonAppModelMigration({
      modelsDir: options.modelsDir,
      databasePath: options.databasePath,
    })
    writeJsonReport(options.reportPath, plan, options.overwrite)
    console.log(renderHumanReport(plan, {
      databasePath: options.databasePath,
      sourceRoot: options.modelsDir,
    }))
    console.log(`Machine report: ${options.reportPath}`)
    return plan.summary.exitCode
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const error: FatalReport = {
      reportVersion: 'json-app-model-dry-run/v1',
      mode: 'dry-run',
      status: 'error',
      error: {
        code: cause instanceof JsonMigrationDatabaseError
          ? 'database_unavailable_or_unreadable'
          : 'invalid_arguments',
        message,
      },
    }
    writeJsonReport(options.reportPath, error, options.overwrite)
    console.error(`ERROR: ${message}`)
    console.error(`Machine report: ${options.reportPath}`)
    return 1
  }
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2))
}
