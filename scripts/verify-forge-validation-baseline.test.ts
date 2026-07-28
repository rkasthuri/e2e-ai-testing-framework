/**
 * Focused proof tests for the FORGE Validation Baseline.
 *
 * Storage tests use disposable SQLite files only. They never open the live
 * repository database.
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aggregateValidationStatus,
  classifyAgainstBaseline,
  createGateResult,
  deterministicValidationReportJson,
  inspectSqliteReadOnly,
  ValidationGateResult,
  ValidationReport,
} from '../src/core/validation/ValidationBaseline'
import {
  CommandExecution,
  commandResult,
  humanGate,
  profileCommandSpecs,
  resourceFailureReason,
  sauceDemoCommandSpec,
} from './forge-validation-baseline'

const ROOT = path.resolve(__dirname, '..')
const VALID_MODEL = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'models', 'ultimateqa', 'app-model.json'), 'utf8'),
)

function temp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-validation-baseline-'))
}

function fileHash(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function gate(
  id: string,
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN',
  evidence: unknown = null,
  required = true,
): ValidationGateResult {
  return createGateResult({
    id,
    title: id,
    required,
    status,
    detail: `${id}:${status}`,
    evidence,
    remedy: status === 'PASS' ? null : { tier: 1, action: `Remedy ${id}.` },
  })
}

function report(gates: ValidationGateResult[]): ValidationReport {
  return {
    schemaVersion: 'forge-validation-baseline/v1',
    profile: 'offline',
    referenceApplication: {
      name: 'SauceDemo',
      baseUrl: 'https://www.saucedemo.com',
      smokeTests: ['A', 'B', 'C'],
    },
    repository: { commit: 'abc123', dirty: false },
    environment: { node: 'v24.0.0', platform: 'win32', architecture: 'x64' },
    databasePath: 'C:/fixture/forge.db',
    comparison: { mode: 'none', baselinePath: null },
    gates,
    overallStatus: aggregateValidationStatus(gates),
  }
}

function execution(
  overrides: Partial<CommandExecution> = {},
): CommandExecution {
  return {
    exitCode: 1,
    signal: null,
    error: null,
    stdout: '',
    stderr: '',
    termination: 'exit',
    ...overrides,
  }
}
function createDatabase(
  root: string,
  options: {
    migration016?: boolean
    duplicateActive?: boolean
    invalidActive?: boolean
  } = {},
): string {
  const dbPath = path.join(root, 'forge.db')
  const BetterSqlite3 = require('better-sqlite3')
  const db = new BetterSqlite3(dbPath)
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE kysely_migration (
      name TEXT PRIMARY KEY NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE app_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_name TEXT NOT NULL,
      status TEXT NOT NULL,
      model_json TEXT NOT NULL
    );
  `)
  db.prepare('INSERT INTO kysely_migration (name, timestamp) VALUES (?, ?)').run(
    '015_app_models_crawled_by_nullable',
    '2026-01-01T00:00:00.000Z',
  )
  if (options.migration016 !== false) {
    db.prepare('INSERT INTO kysely_migration (name, timestamp) VALUES (?, ?)').run(
      '016_app_models_single_active',
      '2026-01-01T00:00:00.000Z',
    )
    db.exec(`
      CREATE UNIQUE INDEX idx_models_one_active
      ON app_models (app_name)
      WHERE status = 'active'
    `)
  }

  const insert = db.prepare(
    'INSERT INTO app_models (app_name, status, model_json) VALUES (?, ?, ?)',
  )
  insert.run(
    'ultimateqa',
    'active',
    options.invalidActive ? '{' : JSON.stringify(VALID_MODEL),
  )
  if (options.duplicateActive) {
    insert.run('ultimateqa', 'active', JSON.stringify(VALID_MODEL))
  }
  db.close()
  return dbPath
}

test('aggregate takes the weakest required truth and ignores optional NOT_RUN gates', () => {
  assert.equal(aggregateValidationStatus([gate('pass', 'PASS')]), 'PASS')
  assert.equal(
    aggregateValidationStatus([gate('pass', 'PASS'), gate('optional', 'NOT_RUN', null, false)]),
    'PASS',
  )
  assert.equal(
    aggregateValidationStatus([gate('pass', 'PASS'), gate('blocked', 'BLOCKED')]),
    'BLOCKED',
  )
  assert.equal(
    aggregateValidationStatus([gate('blocked', 'BLOCKED'), gate('failed', 'FAIL')]),
    'FAIL',
  )
  assert.equal(
    aggregateValidationStatus([gate('not-run', 'NOT_RUN')]),
    'BLOCKED',
  )
})

test('baseline comparison distinguishes exact debt from a new or changed failure', () => {
  const original = gate('storage.example', 'FAIL', { count: 1 })
  const established = classifyAgainstBaseline([original], { establishBaseline: true })
  assert.equal(established[0].findingKind, 'BASELINE_DEBT')

  const exact = classifyAgainstBaseline([original], { baselineReport: report(established) })
  assert.equal(exact[0].findingKind, 'BASELINE_DEBT')

  const changed = gate('storage.example', 'FAIL', { count: 2 })
  const regression = classifyAgainstBaseline([changed], { baselineReport: report(established) })
  assert.equal(regression[0].findingKind, 'NEW_REGRESSION')

  const recovered = classifyAgainstBaseline([gate('storage.example', 'PASS')], {
    baselineReport: report(established),
  })
  assert.equal(recovered[0].findingKind, 'NONE')
})

test('deterministic report serialization is byte-identical and key-stable', () => {
  const value = report([gate('z', 'PASS'), gate('a', 'FAIL', { z: 1, a: 2 })])
  const first = deterministicValidationReportJson(value)
  const second = deterministicValidationReportJson(structuredClone(value))
  assert.equal(second, first)
  assert.ok(first.indexOf('"architecture"') < first.indexOf('"node"'))
  assert.ok(first.endsWith('\n'))
})

test('profiles keep UI production build release-only', () => {
  assert.deepEqual(
    profileCommandSpecs('offline').map(spec => spec.id),
    ['build.root-typecheck', 'test.unit', 'build.ui-typecheck'],
  )
  assert.deepEqual(
    profileCommandSpecs('product').map(spec => spec.id),
    ['build.root-typecheck', 'test.unit', 'build.ui-typecheck'],
  )
  assert.deepEqual(
    profileCommandSpecs('full').map(spec => spec.id),
    ['build.root-typecheck', 'test.unit', 'build.ui-typecheck', 'build.ui-production'],
  )
})

test('SauceDemo smoke command selects only the approved primary-reference evidence', () => {
  const spec = sauceDemoCommandSpec()
  assert.equal(spec.id, 'product.saucedemo-smoke')
  assert.ok(spec.args.includes('src/apps/desktop/ui/saucedemo/tests/loginFast.spec.ts'))
  assert.ok(spec.args.includes('src/apps/desktop/ui/saucedemo/tests/e2e-journey.spec.ts'))
  assert.ok(spec.args.includes('--project=chromium'))
  assert.ok(spec.args.includes('Standard user login|Invalid credentials|TC033'))
  assert.ok(spec.args.includes('--reporter=line'))
  assert.ok(spec.args.includes('--workers=1'))
  assert.ok(spec.args.includes('--retries=0'))
})

test('command failure is preserved as FAIL instead of being swallowed', () => {
  const spec = profileCommandSpecs('offline')[0]
  const result = commandResult(spec, execution({ exitCode: 7 }))
  assert.equal(result.status, 'FAIL')
  assert.equal((result.evidence as any).exitCode, 7)
  assert.match(result.remedy?.action ?? '', /raw command output/)
})

test('explicit ENOMEM is BLOCKED and cannot become baseline debt', () => {
  const spec = profileCommandSpecs('offline')[1]
  const blocked = commandResult(spec, execution({ error: 'spawn ENOMEM', stderr: 'Error: spawn ENOMEM', termination: 'spawn-error' }))
  assert.equal(blocked.status, 'BLOCKED')
  assert.equal(blocked.findingKind, 'NONE')
  assert.equal(resourceFailureReason(execution({ stderr: 'fatal: ENOMEM' })), 'ENOMEM')
  const established = classifyAgainstBaseline([blocked], { establishBaseline: true })
  assert.equal(established[0].findingKind, 'NONE')
  const matched = classifyAgainstBaseline([blocked], { baselineReport: report(established) })
  assert.equal(matched[0].status, 'BLOCKED')
  assert.equal(matched[0].findingKind, 'NONE')
})

test('VirtualAlloc and worker resource exhaustion are BLOCKED', () => {
  const spec = profileCommandSpecs('offline')[1]
  const evidence = [
    'FATAL ERROR: VirtualAlloc failure',
    'ERR_WORKER_INIT_FAILED: Insufficient system resources exist to complete the requested service.',
  ]

  for (const stderr of evidence) {
    const result = commandResult(spec, execution({ stderr }))
    assert.equal(result.status, 'BLOCKED')
    assert.equal(result.findingKind, 'NONE')
  }
})

test('assertion failures and ordinary exit 1 remain FAIL', () => {
  const spec = profileCommandSpecs('offline')[1]
  const assertion = commandResult(
    spec,
    execution({ stderr: 'AssertionError [ERR_ASSERTION]: expected true to equal false' }),
  )
  const ordinary = commandResult(spec, execution({ stderr: 'command failed', exitCode: 1 }))

  assert.equal(assertion.status, 'FAIL')
  assert.equal(ordinary.status, 'FAIL')
})

test('non-resource signal or timeout termination remains ordinary FAIL', () => {
  const spec = profileCommandSpecs('offline')[1]
  const signalExecution = execution({
    exitCode: null,
    signal: 'SIGTERM',
    stderr: 'Child process terminated after its test timeout.',
    termination: 'signal',
  })
  const timedOut = commandResult(spec, signalExecution)

  assert.equal(resourceFailureReason(signalExecution), null)
  assert.equal(timedOut.status, 'FAIL')
  assert.equal(timedOut.findingKind, 'NONE')
  assert.notEqual(timedOut.status, 'BLOCKED')
  assert.notEqual(timedOut.status, 'PASS')

  const classified = classifyAgainstBaseline([timedOut])
  assert.equal(classified[0].status, 'FAIL')
  assert.equal(classified[0].findingKind, 'NEW_REGRESSION')
})

test('successful command remains PASS even when stdout names resource signatures', () => {
  const spec = profileCommandSpecs('offline')[1]
  const result = commandResult(
    spec,
    execution({ exitCode: 0, stdout: 'tests cover ENOMEM and VirtualAlloc failure' }),
  )

  assert.equal(result.status, 'PASS')
})

test('read-only inspection passes a valid disposable database without changing it', () => {
  const dbPath = createDatabase(temp())
  const before = fileHash(dbPath)
  const inspection = inspectSqliteReadOnly(dbPath)
  const after = fileHash(dbPath)
  assert.equal(after, before)
  assert.equal(inspection.databaseSha256Before, before)
  assert.equal(inspection.databaseSha256After, before)
  assert.ok(inspection.gates.every(result => result.status === 'PASS'))
  assert.equal(
    inspection.gates.find(result => result.id === 'storage.database-open')?.evidence
      && (inspection.gates.find(result => result.id === 'storage.database-open')!.evidence as any).readonly,
    true,
  )
})

test('storage findings preserve missing migration, duplicate-active, and invalid JSON separately', () => {
  const dbPath = createDatabase(temp(), {
    migration016: false,
    duplicateActive: true,
    invalidActive: true,
  })
  const inspection = inspectSqliteReadOnly(dbPath)
  assert.equal(
    inspection.gates.find(result => result.id === 'storage.migration-016')?.status,
    'FAIL',
  )
  assert.equal(
    inspection.gates.find(result => result.id === 'storage.single-active-index')?.status,
    'FAIL',
  )
  assert.equal(
    inspection.gates.find(result => result.id === 'storage.duplicate-active')?.status,
    'FAIL',
  )
  assert.equal(
    inspection.gates.find(result => result.id === 'storage.active-model-json')?.status,
    'FAIL',
  )
  assert.equal(
    inspection.gates.find(result => result.id === 'storage.read-only-proof')?.status,
    'PASS',
  )
})

test('unavailable SQLite is explicit BLOCKED evidence, never a fabricated pass', () => {
  const missing = path.join(temp(), 'missing.db')
  const inspection = inspectSqliteReadOnly(missing)
  assert.equal(inspection.gates[0].id, 'storage.database-open')
  assert.equal(inspection.gates[0].status, 'BLOCKED')
  assert.match(inspection.gates[0].remedy?.action ?? '', /readable SQLite/)
})

test('full profile requires a commit-matched human attestation', () => {
  const absent = humanGate('full', null, 'commit-a')
  assert.equal(absent.status, 'NOT_RUN')

  const root = temp()
  const file = path.join(root, 'attestation.json')
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 'forge-human-validation/v1',
    status: 'PASS',
    validator: 'Human Validator',
    commit: 'commit-a',
    completedChecks: ['negative-path', 'onboarding'],
    evidence: ['screenshot-1.png'],
  }))
  assert.equal(humanGate('full', file, 'commit-a').status, 'PASS')
  assert.equal(humanGate('full', file, 'commit-b').status, 'BLOCKED')
  assert.equal(humanGate('offline', null, 'commit-a').required, false)
})
