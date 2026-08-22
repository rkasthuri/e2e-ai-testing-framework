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

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'
import BetterSqlite3 from 'better-sqlite3'
import { closeDb, initDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'
import {
  aggregateValidationStatus,
  createGateResult,
  deterministicValidationReportJson,
  type ValidationReport,
  type ValidationStatus,
} from '../src/core/validation/ValidationBaseline'
import {
  canonicalGovernedReportEvidence,
  decodeGovernedReportBytes,
  GOVERNANCE_SIDECAR_LIMITS,
  productionGovernanceSidecarPath,
  type AcceptedGovernedInvocation,
  type GovernanceValidationSidecarHandle,
  type GovernedInvocationExpectation,
} from './governance-validation-sidecar'
import {
  DisposableGovernanceValidationSidecarForTests as GovernanceValidationSidecar,
  openDisposableGovernanceSidecarHarnessForTests,
  readDisposableGovernedCurrentForTests as readGovernedCurrentFromSidecar,
} from './governance-validation-sidecar.test-support'
import { readGovernedInvocationAtPathInternal } from './governance-validation-sidecar-internal'

const REPOSITORY_ROOT = path.resolve(__dirname, '..')
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gov-sqlite-certification-'))
const TEST_REPOSITORY = path.join(TEST_ROOT, 'repository')
const BARRIER_ROOT = path.join(TEST_ROOT, 'barriers')
const AMBIENT_PROFILE = path.join(TEST_ROOT, 'ambient-profile')
const CLEAN_DATABASE = path.join(TEST_ROOT, 'clean-forge.db')
const SHARED_SIDECAR = path.join(TEST_REPOSITORY, '.forge', 'governance.db')
const PRELOAD_PATH = path.join(TEST_ROOT, 'governed-run-preload.cjs')
const RUNNER_PATH = path.join(TEST_ROOT, 'governed-run-child.ts')
const DIRECT_CHILD_PATH = path.join(TEST_ROOT, 'governed-sidecar-child.ts')
const BASELINE_MODULE_URL = pathToFileURL(path.join(TEST_REPOSITORY, 'scripts', 'forge-validation-baseline.ts')).href
const SIDECAR_MODULE_URL = pathToFileURL(path.join(__dirname, 'governance-validation-sidecar.ts')).href
const SIDECAR_TEST_SUPPORT_MODULE_URL = pathToFileURL(path.join(__dirname, 'governance-validation-sidecar.test-support.ts')).href
const BETTER_SQLITE3_MODULE_URL = pathToFileURL(require.resolve('better-sqlite3')).href
const TSX_CLI = path.join(REPOSITORY_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const USERINFO_PRELOAD = path.join(REPOSITORY_ROOT, 'notes', 'review-scratch', 'tsx-userinfo-preload.cjs')
const ENVIRONMENT_KEYS = ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TMP', 'TEMP'] as const
const activeChildren = new Set<ChildProcess>()

interface InvocationMarker {
  readonly label: string
  readonly root: string
  readonly marker: string
  readonly environment: Record<(typeof ENVIRONMENT_KEYS)[number], string>
  readonly gitChild: {
    readonly environment: Record<(typeof ENVIRONMENT_KEYS)[number], string>
    readonly observedConfig: string
  }
}

interface CompletedRun {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

interface RunningRun {
  readonly label: string
  readonly targetId: string
  readonly exportPath: string
  readonly started: Promise<InvocationMarker>
  readonly completed: Promise<CompletedRun>
  readonly release: () => void
}

function parentEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(ENVIRONMENT_KEYS.map(key => [key, process.env[key]]))
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sidecarPath(label: string): string {
  return path.join(TEST_ROOT, `${label}.db`)
}

function expectation(invocation: AcceptedGovernedInvocation): GovernedInvocationExpectation {
  return {
    targetId: invocation.targetId,
    invocationId: invocation.invocationId,
    sequence: invocation.sequence,
    stateRevision: invocation.stateRevision,
    authorityEpoch: invocation.lastAuthorityEpoch,
  }
}

function report(status: ValidationStatus, id = `gate.${status.toLowerCase()}`): ValidationReport {
  const gate = createGateResult({
    id,
    title: `Synthetic ${status} gate`,
    required: true,
    status,
    detail: `Synthetic ${status} evidence.`,
    evidence: { status },
    remedy: status === 'PASS' ? null : { tier: 1, action: `Resolve ${status}.` },
  })
  return {
    schemaVersion: 'forge-validation-baseline/v1',
    profile: 'offline',
    referenceApplication: {
      name: 'SauceDemo',
      baseUrl: 'https://www.saucedemo.com',
      smokeTests: [],
    },
    repository: { commit: 'certification', dirty: false },
    environment: { node: process.version, platform: process.platform, architecture: process.arch },
    databasePath: CLEAN_DATABASE,
    comparison: { mode: 'none', baselinePath: null },
    gates: [gate],
    overallStatus: aggregateValidationStatus([gate]),
  }
}

function complete(
  store: GovernanceValidationSidecarHandle,
  invocation: AcceptedGovernedInvocation,
  status: ValidationStatus,
) {
  const evidence = canonicalGovernedReportEvidence(report(status))
  return { evidence, result: store.completeInvocation(expectation(invocation), evidence) }
}

function rawDatabase(databasePath: string): BetterSqlite3.Database {
  const db = new BetterSqlite3(databasePath)
  db.defaultSafeIntegers(true)
  db.pragma('foreign_keys = ON')
  db.pragma('recursive_triggers = ON')
  return db
}

function corruptAuthorityRows(
  databasePath: string,
  mutation: (database: BetterSqlite3.Database) => void,
): void {
  const database = rawDatabase(databasePath)
  const triggerNames = [
    'governed_invocations_validate_update',
    'governed_invocations_after_update',
    'governed_targets_projection_guard',
  ] as const
  const definitions = database.prepare(
    `SELECT name, sql FROM main.sqlite_schema
      WHERE type = 'trigger' AND name IN (${triggerNames.map(() => '?').join(', ')})`,
  ).all(...triggerNames) as Array<{ name: string; sql: string }>
  assert.equal(definitions.length, triggerNames.length)
  try {
    for (const name of triggerNames) database.exec(`DROP TRIGGER main.${name}`)
    database.pragma('ignore_check_constraints = ON')
    mutation(database)
  } finally {
    database.pragma('ignore_check_constraints = OFF')
    for (const definition of definitions) database.exec(definition.sql)
    database.close()
  }
}

function startedFile(label: string): string {
  return path.join(BARRIER_ROOT, `${label}.started.json`)
}

function releaseFile(label: string): string {
  return path.join(BARRIER_ROOT, `${label}.release`)
}

function callerEnvironmentFile(label: string): string {
  return path.join(BARRIER_ROOT, `${label}.caller-environment.json`)
}

function waitForFile(filePath: string, timeoutMs = 60_000): Promise<void> {
  if (fs.existsSync(filePath)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const watcher = fs.watch(path.dirname(filePath), (_event, fileName) => {
      if (String(fileName) !== path.basename(filePath) || !fs.existsSync(filePath)) return
      clearTimeout(timer)
      watcher.close()
      resolve()
    })
    const timer = setTimeout(() => {
      watcher.close()
      reject(new Error(`Timed out waiting for ${filePath}`))
    }, timeoutMs)
  })
}

function launchRun(options: {
  label: string
  targetId?: string
  childExitCode?: number
  failCleanup?: boolean
  failContextCreation?: boolean
  failExport?: boolean
  baselineReference?: string
  waitAtFirstCommand?: boolean
  expectBarrier?: boolean
}): RunningRun {
  const targetId = options.targetId ?? options.label
  const exportPath = path.join(TEST_ROOT, `${options.label}.export.json`)
  const args = [
    '--profile', 'offline',
    '--db', CLEAN_DATABASE,
    '--report', exportPath,
    '--governed-target', targetId,
  ]
  if (options.baselineReference) args.push('--baseline', options.baselineReference)
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: AMBIENT_PROFILE,
    USERPROFILE: AMBIENT_PROFILE,
    GOV_RUN_LABEL: options.label,
    GOV_BARRIER_ROOT: BARRIER_ROOT,
    GOV_CHILD_EXIT: String(options.childExitCode ?? 0),
    GOV_WAIT_AT_FIRST_COMMAND: options.waitAtFirstCommand === false ? '0' : '1',
    GOV_FAIL_CLEANUP: options.failCleanup ? '1' : '0',
    GOV_FAIL_CONTEXT_CREATION: options.failContextCreation ? '1' : '0',
    GOV_FAIL_EXPORT: options.failExport ? '1' : '0',
    GOV_EXPORT_PATH: exportPath,
    GOV_RUN_ARGS: JSON.stringify(args),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${USERINFO_PRELOAD}`, `--require=${PRELOAD_PATH}`]
      .filter(Boolean).join(' '),
  }
  const child = spawn(process.execPath, [TSX_CLI, RUNNER_PATH], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  activeChildren.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout += String(chunk) })
  child.stderr?.on('data', chunk => { stderr += String(chunk) })
  const completed = new Promise<CompletedRun>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      activeChildren.delete(child)
      resolve({ code, signal, stdout, stderr })
    })
  })
  const started = options.expectBarrier === false
    ? new Promise<InvocationMarker>(() => undefined)
    : Promise.race([
        waitForFile(startedFile(options.label)).then(() => (
          JSON.parse(fs.readFileSync(startedFile(options.label), 'utf8')) as InvocationMarker
        )),
        completed.then(result => {
          throw new Error(`Run ${options.label} exited before its command barrier: ${JSON.stringify(result)}`)
        }),
      ])
  return {
    label: options.label,
    targetId,
    exportPath,
    started,
    completed,
    release: () => fs.writeFileSync(releaseFile(options.label), 'release', 'utf8'),
  }
}

function assertInvocationEnvironment(marker: InvocationMarker): void {
  const parsedRoot = path.parse(marker.root).root
  assert.equal(marker.environment.HOME, marker.root)
  assert.equal(marker.environment.USERPROFILE, marker.root)
  assert.equal(marker.environment.HOMEDRIVE, parsedRoot.replace(/\\$/, ''))
  assert.equal(marker.environment.TMP, marker.root)
  assert.equal(marker.environment.TEMP, marker.root)
  if (process.platform === 'win32') {
    assert.match(marker.environment.HOMEPATH, /^\\/)
    assert.equal(`${marker.environment.HOMEDRIVE}${marker.environment.HOMEPATH}`, marker.root)
  } else {
    assert.equal(marker.environment.HOMEPATH, marker.root)
  }
  assert.deepEqual(marker.gitChild.environment, marker.environment)
  assert.equal(marker.gitChild.observedConfig, `${marker.label}-isolated`)
}

function removeKnownRoot(root: string): void {
  const resolved = path.resolve(root)
  assert.equal(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), true)
  assert.equal(path.basename(resolved).startsWith('forge-governed-baseline-'), true)
  fs.rmSync(resolved, { recursive: true, force: true })
}

function removeRecoveredCrashJournal(databasePath: string): void {
  const journalPath = `${databasePath}-journal`
  if (!fs.existsSync(journalPath)) return
  const bytes = fs.readFileSync(journalPath)
  const sqliteHotJournalMagic = Buffer.from([0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7])
  assert.equal(bytes.subarray(0, sqliteHotJournalMagic.length).equals(sqliteHotJournalMagic), false)
  fs.rmSync(journalPath, { force: true })
  assert.equal(fs.existsSync(journalPath), false)
}

function directChild(environment: NodeJS.ProcessEnv): Promise<CompletedRun> {
  const child = spawn(process.execPath, [TSX_CLI, DIRECT_CHILD_PATH], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      ...environment,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${USERINFO_PRELOAD}`].filter(Boolean).join(' '),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  activeChildren.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout += String(chunk) })
  child.stderr?.on('data', chunk => { stderr += String(chunk) })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      activeChildren.delete(child)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

before(async () => {
  fs.mkdirSync(BARRIER_ROOT, { recursive: true })
  fs.mkdirSync(AMBIENT_PROFILE, { recursive: true })
  fs.mkdirSync(path.dirname(SHARED_SIDECAR), { recursive: true })
  fs.mkdirSync(path.join(TEST_REPOSITORY, 'scripts'), { recursive: true })
  fs.copyFileSync(path.join(__dirname, 'forge-validation-baseline.ts'), path.join(TEST_REPOSITORY, 'scripts', 'forge-validation-baseline.ts'))
  fs.copyFileSync(path.join(__dirname, 'governance-validation-sidecar.ts'), path.join(TEST_REPOSITORY, 'scripts', 'governance-validation-sidecar.ts'))
  fs.copyFileSync(path.join(__dirname, 'governance-validation-sidecar-internal.ts'), path.join(TEST_REPOSITORY, 'scripts', 'governance-validation-sidecar-internal.ts'))
  fs.symlinkSync(path.join(REPOSITORY_ROOT, 'src'), path.join(TEST_REPOSITORY, 'src'), 'junction')
  fs.symlinkSync(path.join(REPOSITORY_ROOT, 'node_modules'), path.join(TEST_REPOSITORY, 'node_modules'), 'junction')
  fs.writeFileSync(path.join(TEST_REPOSITORY, 'certification-marker.txt'), 'governed sidecar test repository\n', 'utf8')
  const gitEnvironment = { ...process.env, HOME: AMBIENT_PROFILE, USERPROFILE: AMBIENT_PROFILE }
  for (const args of [
    ['init'],
    ['add', 'certification-marker.txt'],
    ['-c', 'user.name=FORGE Certification', '-c', 'user.email=certification@forge.invalid', 'commit', '-m', 'test fixture'],
  ]) {
    const result = spawnSync('git', args, { cwd: TEST_REPOSITORY, env: gitEnvironment, encoding: 'utf8', windowsHide: true })
    if (result.status !== 0) throw new Error(`Could not initialize governed test repository: ${result.stderr}`)
  }
  fs.writeFileSync(path.join(AMBIENT_PROFILE, '.gitconfig'), '[forge]\n\tgovernedProbe = ambient\n', 'utf8')
  initDb(CLEAN_DATABASE)
  await runMigrations()
  await closeDb()

  fs.writeFileSync(PRELOAD_PATH, `
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
os.userInfo = () => ({ uid: -1, gid: -1, username: 'forge-validation', homedir: '', shell: null })
const realSpawnSync = childProcess.spawnSync
const realRmSync = fs.rmSync
const realMkdtempSync = fs.mkdtempSync
const realRenameSync = fs.renameSync
let commandCount = 0
let invocationRoot = null
const waitArray = new Int32Array(new SharedArrayBuffer(4))

childProcess.spawnSync = function governedSpawnSync(command, args, options) {
  const argv = Array.isArray(args) ? args.map(String) : []
  const environment = options && options.env ? options.env : process.env
  const commandName = path.basename(String(command)).toLowerCase()
  if (commandName === 'git' || commandName === 'git.exe') {
    fs.writeFileSync(path.join(environment.HOME, '.gitconfig'), '[forge]\\n\\tgovernedProbe = ' + process.env.GOV_RUN_LABEL + '-isolated\\n', 'utf8')
    const probe = realSpawnSync.call(this, command, ['config', '--global', '--get', 'forge.governedProbe'], { ...options, env: environment })
    const result = realSpawnSync.apply(this, arguments)
    fs.writeFileSync(path.join(environment.HOME, 'git-child-environment.json'), JSON.stringify({
      environment: Object.fromEntries(['HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','TMP','TEMP'].map(key => [key, environment[key]])),
      observedConfig: String(probe.stdout || '').trim(),
    }), 'utf8')
    return result
  }
  const governed = argv.some(value => value.includes('npm-cli.js')) && argv.includes('run')
    && (argv.includes('check') || argv.includes('test:unit') || argv.includes('build'))
  if (!governed) return realSpawnSync.apply(this, arguments)
  commandCount += 1
  invocationRoot = environment.HOME
  if (commandCount === 1) {
    const captured = Object.fromEntries(['HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','TMP','TEMP'].map(key => [key, environment[key]]))
    const gitChild = JSON.parse(fs.readFileSync(path.join(invocationRoot, 'git-child-environment.json'), 'utf8'))
    const marker = JSON.stringify({ label: process.env.GOV_RUN_LABEL, root: invocationRoot, environment: captured, gitChild })
    fs.writeFileSync(path.join(invocationRoot, 'owned-marker.json'), marker, 'utf8')
    const finalPath = path.join(process.env.GOV_BARRIER_ROOT, process.env.GOV_RUN_LABEL + '.started.json')
    const temporaryPath = finalPath + '.' + process.pid + '.tmp'
    fs.writeFileSync(temporaryPath, JSON.stringify({ label: process.env.GOV_RUN_LABEL, root: invocationRoot, marker, environment: captured, gitChild }), 'utf8')
    fs.renameSync(temporaryPath, finalPath)
    if (process.env.GOV_WAIT_AT_FIRST_COMMAND !== '0') {
      const release = path.join(process.env.GOV_BARRIER_ROOT, process.env.GOV_RUN_LABEL + '.release')
      const deadline = Date.now() + 60000
      while (!fs.existsSync(release)) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for governed release barrier')
        Atomics.wait(waitArray, 0, 0, 20)
      }
    }
  }
  const status = commandCount === 1 ? Number(process.env.GOV_CHILD_EXIT || 0) : 0
  return { status, signal: null, error: undefined, stdout: '', stderr: '', output: [null, '', ''], pid: process.pid }
}

fs.rmSync = function governedRmSync(target, options) {
  if (process.env.GOV_FAIL_CLEANUP === '1' && invocationRoot
      && path.resolve(String(target)) === path.resolve(invocationRoot)) {
    const error = new Error('synthetic governed cleanup failure')
    error.code = 'EPERM'
    throw error
  }
  return realRmSync.call(this, target, options)
}

fs.mkdtempSync = function governedMkdtempSync(prefix, options) {
  if (process.env.GOV_FAIL_CONTEXT_CREATION === '1' && String(prefix).includes('forge-governed-baseline-')) {
    const error = new Error('synthetic governed context creation failure')
    error.code = 'EIO'
    throw error
  }
  return realMkdtempSync.call(this, prefix, options)
}

fs.renameSync = function governedRenameSync(source, destination) {
  if (process.env.GOV_FAIL_EXPORT === '1'
      && path.resolve(String(destination)) === path.resolve(process.env.GOV_EXPORT_PATH)) {
    const error = new Error('synthetic non-authoritative export failure')
    error.code = 'EIO'
    throw error
  }
  return realRenameSync.call(this, source, destination)
}
`, 'utf8')

  fs.writeFileSync(RUNNER_PATH, `
import fs from 'node:fs'
import { run } from ${JSON.stringify(BASELINE_MODULE_URL)}
async function main() {
  const keys = ['HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','TMP','TEMP']
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const args = JSON.parse(process.env.GOV_RUN_ARGS!) as string[]
  const code = await run(args)
  const after = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  fs.writeFileSync(process.env.GOV_BARRIER_ROOT + '/' + process.env.GOV_RUN_LABEL + '.caller-environment.json', JSON.stringify({ before, after }), 'utf8')
  process.stdout.write('RUN_RESULT=' + code + '\\n')
  process.exitCode = code
}
void main().catch(error => {
  process.stderr.write(String(error instanceof Error ? error.stack ?? error.message : error) + '\\n')
  process.exitCode = 2
})
`, 'utf8')

  fs.writeFileSync(DIRECT_CHILD_PATH, `
import fs from 'node:fs'
import BetterSqlite3 from ${JSON.stringify(BETTER_SQLITE3_MODULE_URL)}
import { canonicalGovernedReportEvidence } from ${JSON.stringify(SIDECAR_MODULE_URL)}
import { DisposableGovernanceValidationSidecarForTests as GovernanceValidationSidecar } from ${JSON.stringify(SIDECAR_TEST_SUPPORT_MODULE_URL)}
const store = new GovernanceValidationSidecar(process.env.GOV_DB!)
if (process.env.GOV_READY) fs.writeFileSync(process.env.GOV_READY, 'ready', 'utf8')
if (process.env.GOV_DELAY_TRIGGER === 'acceptance') {
  const db = new BetterSqlite3(process.env.GOV_DB!)
  db.exec(\`CREATE TRIGGER certification_delay_acceptance
    AFTER INSERT ON governed_invocations BEGIN
      SELECT sum(value) FROM (
        WITH RECURSIVE counter(value) AS (
          VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < 20000000
        ) SELECT value FROM counter
      );
    END;\`)
  db.close()
} else if (process.env.GOV_DELAY_TRIGGER === 'transition') {
  const db = new BetterSqlite3(process.env.GOV_DB!)
  db.exec(\`CREATE TRIGGER certification_delay_transition
    AFTER UPDATE ON governed_invocations BEGIN
      SELECT sum(value) FROM (
        WITH RECURSIVE counter(value) AS (
          VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < 20000000
        ) SELECT value FROM counter
      );
    END;\`)
  db.close()
}
const mode = process.env.GOV_MODE
if (process.env.GOV_RELEASE) {
  while (!fs.existsSync(process.env.GOV_RELEASE)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
}
if (mode === 'accept') {
  const value = store.acceptInvocation(process.env.GOV_TARGET!, process.env.GOV_INVOCATION!)
  process.stdout.write(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
} else if (mode === 'accept-and-hold') {
  const value = store.acceptInvocation(process.env.GOV_TARGET!, process.env.GOV_INVOCATION!)
  fs.writeFileSync(process.env.GOV_STARTED!, JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
  while (!fs.existsSync(process.env.GOV_HOLD_RELEASE!)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
} else if (mode === 'complete') {
  const accepted = store.acceptInvocation(process.env.GOV_TARGET!, process.env.GOV_INVOCATION!)
  if (accepted.kind !== 'ACCEPTED') throw new Error('accept conflict')
  const report = JSON.parse(process.env.GOV_REPORT!)
  const result = store.completeInvocation({
    targetId: accepted.invocation.targetId,
    invocationId: accepted.invocation.invocationId,
    sequence: accepted.invocation.sequence,
    stateRevision: accepted.invocation.stateRevision,
    authorityEpoch: accepted.invocation.lastAuthorityEpoch,
  }, canonicalGovernedReportEvidence(report))
  process.stdout.write(JSON.stringify(result, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
} else if (mode === 'complete-and-hold') {
  const accepted = store.acceptInvocation(process.env.GOV_TARGET!, process.env.GOV_INVOCATION!)
  if (accepted.kind !== 'ACCEPTED') throw new Error('accept conflict')
  const result = store.completeInvocation({
    targetId: accepted.invocation.targetId,
    invocationId: accepted.invocation.invocationId,
    sequence: accepted.invocation.sequence,
    stateRevision: accepted.invocation.stateRevision,
    authorityEpoch: accepted.invocation.lastAuthorityEpoch,
  }, canonicalGovernedReportEvidence(JSON.parse(process.env.GOV_REPORT!)))
  fs.writeFileSync(process.env.GOV_STARTED!, JSON.stringify(result, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
  while (!fs.existsSync(process.env.GOV_HOLD_RELEASE!)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
} else if (mode === 'recover-and-hold') {
  const accepted = store.acceptInvocation(process.env.GOV_TARGET!, process.env.GOV_INVOCATION!)
  if (accepted.kind !== 'ACCEPTED') throw new Error('accept conflict')
  const result = store.requireRecovery({
    targetId: accepted.invocation.targetId,
    invocationId: accepted.invocation.invocationId,
    sequence: accepted.invocation.sequence,
    stateRevision: accepted.invocation.stateRevision,
    authorityEpoch: accepted.invocation.lastAuthorityEpoch,
  }, process.env.GOV_RECOVERY_ID!, 'operator recovery proof')
  fs.writeFileSync(process.env.GOV_STARTED!, JSON.stringify(result, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
  while (!fs.existsSync(process.env.GOV_HOLD_RELEASE!)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
} else if (mode === 'complete-existing') {
  const result = store.completeInvocation({
    targetId: process.env.GOV_TARGET!,
    invocationId: process.env.GOV_INVOCATION!,
    sequence: BigInt(process.env.GOV_SEQUENCE!),
    stateRevision: BigInt(process.env.GOV_REVISION!),
    authorityEpoch: BigInt(process.env.GOV_EPOCH!),
  }, canonicalGovernedReportEvidence(JSON.parse(process.env.GOV_REPORT!)))
  process.stdout.write(JSON.stringify(result, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
} else if (mode === 'recover-existing') {
  const result = store.requireRecovery({
    targetId: process.env.GOV_TARGET!,
    invocationId: process.env.GOV_INVOCATION!,
    sequence: BigInt(process.env.GOV_SEQUENCE!),
    stateRevision: BigInt(process.env.GOV_REVISION!),
    authorityEpoch: BigInt(process.env.GOV_EPOCH!),
  }, process.env.GOV_RECOVERY_ID!, 'racing recovery request')
  process.stdout.write(JSON.stringify(result, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
}
store.close()
`, 'utf8')
})

after(async () => {
  for (const child of activeChildren) child.kill()
  await closeDb()
  for (const name of ['src', 'node_modules']) {
    const junction = path.join(TEST_REPOSITORY, name)
    if (fs.existsSync(junction)) {
      assert.equal(fs.lstatSync(junction).isSymbolicLink(), true)
      fs.unlinkSync(junction)
    }
  }
  fs.rmSync(TEST_ROOT, { recursive: true, force: true })
})

test('sidecar initializes strict schema, verified pragmas, and bigint authority', () => {
  const dbPath = sidecarPath('schema')
  const store = new GovernanceValidationSidecar(dbPath)
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  assert.equal(accepted.invocation.sequence, 1n)
  assert.equal(accepted.invocation.acceptedAuthorityEpoch, 1n)
  const integrity = store.integrityCheck()
  assert.equal(integrity.integrity, 'ok')
  assert.deepEqual(integrity.foreignKeyViolations, [])
  assert.deepEqual(integrity.authorityAuditViolations, [])
  store.close()

  const db = rawDatabase(dbPath)
  assert.equal(db.pragma('journal_mode', { simple: true }), 'delete')
  assert.equal(db.pragma('synchronous', { simple: true }), 2n)
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1n)
  const tables = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string; sql: string }>
  for (const name of ['governance_schema', 'governed_targets', 'governed_invocations', 'authority_events']) {
    assert.match(tables.find(row => row.name === name)?.sql ?? '', /STRICT$/)
  }
  assert.equal((db.prepare(`SELECT version FROM governance_schema`).get() as { version: bigint }).version, 1n)
  db.close()
})

test('schema identity rejects same-name weakened authority objects before evidence is trusted', async t => {
  const seedPath = sidecarPath('schema-identity-seed')
  const seed = new GovernanceValidationSidecar(seedPath)
  const accepted = seed.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  complete(seed, accepted.invocation, 'PASS')
  seed.close()

  const catalogDb = rawDatabase(seedPath)
  const catalog = catalogDb.prepare(
    `SELECT type, name FROM sqlite_schema
      WHERE type IN ('trigger', 'index') AND sql IS NOT NULL
      ORDER BY type, name`,
  ).all() as Array<{ type: 'trigger' | 'index'; name: string }>
  catalogDb.close()

  for (const object of catalog) {
    await t.test(`${object.type} ${object.name}`, () => {
      const dbPath = sidecarPath(`schema-substitution-${object.type}-${object.name}`)
      fs.copyFileSync(seedPath, dbPath)
      const db = rawDatabase(dbPath)
      db.exec(`DROP ${object.type.toUpperCase()} "${object.name}"`)
      if (object.type === 'trigger') {
        db.exec(`CREATE TRIGGER "${object.name}" BEFORE INSERT ON governed_targets BEGIN SELECT 1; END`)
      } else {
        db.exec(`CREATE INDEX "${object.name}" ON governed_invocations(target_id)`)
      }
      db.close()
      assert.throws(() => new GovernanceValidationSidecar(dbPath), /schema definition fingerprint mismatch/)
      assert.equal(readGovernedCurrentFromSidecar(dbPath, 'offline').kind, 'INVALID')
    })
  }

  await t.test('table constraint weakening', () => {
    const dbPath = sidecarPath('schema-substitution-table')
    fs.copyFileSync(seedPath, dbPath)
    const db = rawDatabase(dbPath)
    db.unsafeMode(true)
    db.pragma('writable_schema = ON')
    const changed = db.prepare(
      `UPDATE sqlite_schema
          SET sql = replace(sql,
            'CHECK(next_sequence BETWEEN 1 AND 9007199254740991)',
            'CHECK(next_sequence >= 1)')
        WHERE type = 'table' AND name = 'governed_targets'`,
    ).run()
    assert.equal(changed.changes, 1)
    db.pragma('writable_schema = OFF')
    db.pragma(`schema_version = ${Number(db.pragma('schema_version', { simple: true })) + 1}`)
    db.close()
    assert.throws(() => new GovernanceValidationSidecar(dbPath), /schema definition fingerprint mismatch/)
    assert.equal(readGovernedCurrentFromSidecar(dbPath, 'offline').kind, 'INVALID')
  })
})

test('reviewer same-name inert-trigger attack cannot turn mutated evidence into current authority', () => {
  const dbPath = sidecarPath('schema-reviewer-inert-trigger')
  const store = new GovernanceValidationSidecar(dbPath)
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  complete(store, accepted.invocation, 'PASS')

  const forgedEvidence = canonicalGovernedReportEvidence(report('FAIL'))
  const db = rawDatabase(dbPath)
  db.exec(`
    DROP TRIGGER governed_invocations_validate_update;
    DROP TRIGGER governed_invocations_after_update;
    CREATE TRIGGER governed_invocations_validate_update
      BEFORE UPDATE ON governed_invocations BEGIN SELECT 1; END;
    CREATE TRIGGER governed_invocations_after_update
      AFTER UPDATE ON governed_invocations BEGIN SELECT 1; END;
  `)
  const mutation = db.prepare(
    `UPDATE governed_invocations
        SET report_bytes=?, report_sha256=?, result_status='FAIL'
      WHERE invocation_id=?`,
  ).run(forgedEvidence.reportBytes, forgedEvidence.reportSha256, accepted.invocation.invocationId)
  assert.equal(mutation.changes, 1)
  db.close()

  assert.equal(store.readGovernedCurrent('offline').kind, 'INVALID')
  assert.throws(() => store.integrityCheck(), /schema definition fingerprint mismatch/)
  store.close()
  assert.throws(() => new GovernanceValidationSidecar(dbPath), /schema definition fingerprint mismatch/)
  assert.equal(readGovernedCurrentFromSidecar(dbPath, 'offline').kind, 'INVALID')
})

test('MAIN-bound authority ignores TEMP and attached-schema shadow objects', () => {
  const dbPath = sidecarPath('namespace-shadowing')
  const { handle: store, database } = openDisposableGovernanceSidecarHarnessForTests(dbPath)
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  complete(store, accepted.invocation, 'FAIL')

  database.exec(`
    CREATE TEMP TABLE governance_schema AS SELECT * FROM main.governance_schema;
    CREATE TEMP TABLE governed_targets AS SELECT * FROM main.governed_targets;
    CREATE TEMP TABLE governed_invocations AS SELECT * FROM main.governed_invocations;
    CREATE TEMP TABLE authority_events AS SELECT * FROM main.authority_events;
    CREATE INDEX temp.one_live_invocation_per_target ON governed_invocations(target_id);
    CREATE TEMP TRIGGER governed_targets_no_delete
      BEFORE DELETE ON governed_targets BEGIN SELECT 1; END;
    ATTACH ':memory:' AS attacker;
    CREATE TABLE attacker.governance_schema AS SELECT * FROM main.governance_schema;
    CREATE TABLE attacker.governed_targets AS SELECT * FROM main.governed_targets;
    CREATE TABLE attacker.governed_invocations AS SELECT * FROM main.governed_invocations;
    CREATE TABLE attacker.authority_events AS SELECT * FROM main.authority_events;
  `)
  const forged = canonicalGovernedReportEvidence(report('PASS'))
  database.prepare(
    `UPDATE temp.governed_invocations
        SET result_status='PASS', infrastructure_status='HEALTHY', report_bytes=?, report_sha256=?`,
  ).run(forged.reportBytes, forged.reportSha256)
  database.prepare(
    `UPDATE attacker.governed_invocations
        SET result_status='PASS', infrastructure_status='HEALTHY', report_bytes=?, report_sha256=?`,
  ).run(forged.reportBytes, forged.reportSha256)

  assert.equal(store.readGovernedCurrent('offline').kind, 'INVALID')
  assert.throws(() => store.acceptInvocation('second-target'), /TEMP authority-schema objects|unexpected attached schemas/)
  assert.equal((database.prepare(
    `SELECT result_status FROM main.governed_invocations WHERE invocation_id=?`,
  ).get(accepted.invocation.invocationId) as { result_status: string }).result_status, 'FAIL')

  database.exec('DETACH attacker')

  database.exec(`
    DROP TRIGGER temp.governed_targets_no_delete;
    DROP INDEX temp.one_live_invocation_per_target;
    DROP TABLE temp.authority_events;
    DROP TABLE temp.governed_invocations;
    DROP TABLE temp.governed_targets;
    DROP TABLE temp.governance_schema;
    CREATE TEMP VIEW governed_targets AS SELECT * FROM main.governed_targets;
    CREATE TEMP VIEW governed_invocations AS SELECT * FROM main.governed_invocations;
    CREATE TEMP VIEW authority_events AS SELECT * FROM main.authority_events;
    CREATE TEMP VIEW governance_schema AS SELECT * FROM main.governance_schema;
  `)
  assert.equal(store.readGovernedCurrent('offline').kind, 'INVALID')
  database.exec(`
    DROP VIEW temp.authority_events;
    DROP VIEW temp.governed_invocations;
    DROP VIEW temp.governed_targets;
    DROP VIEW temp.governance_schema;
  `)
  const recovered = store.readGovernedCurrent('offline')
  assert.equal(recovered.kind, 'CURRENT_COMPLETED')
  if (recovered.kind === 'CURRENT_COMPLETED') assert.equal(recovered.report.overallStatus, 'FAIL')
  assert.equal(store.acceptInvocation('second-target').kind, 'ACCEPTED')
  assert.equal((database.prepare(
    `SELECT COUNT(*) AS count FROM main.governed_targets WHERE target_id='second-target'`,
  ).get() as { count: bigint }).count, 1n)
  store.close()
})

test('schema identity accepts harmless keyword casing and formatting but not weakened structure', () => {
  const dbPath = sidecarPath('schema-normalization')
  const seed = new GovernanceValidationSidecar(dbPath)
  seed.acceptInvocation('offline')
  seed.close()
  const database = rawDatabase(dbPath)
  database.exec(`
    DROP TRIGGER governed_targets_no_delete;
    create   trigger governed_targets_no_delete
      before delete on governed_targets
      begin
        select raise(abort, 'governed targets cannot be deleted');
      end;
  `)
  database.close()
  const reopened = new GovernanceValidationSidecar(dbPath)
  assert.equal(reopened.readGovernedCurrent('offline').kind, 'INCOMPLETE')
  reopened.close()
})

test('store-level INVALID poisons current and specific-invocation readers alike', () => {
  const dbPath = sidecarPath('invalid-reader-family')
  const { handle: store, database } = openDisposableGovernanceSidecarHarnessForTests(dbPath)
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  complete(store, accepted.invocation, 'FAIL')
  database.exec(`
    DROP TRIGGER governed_invocations_no_delete;
    CREATE TRIGGER governed_invocations_no_delete
      BEFORE DELETE ON governed_invocations BEGIN SELECT 1; END;
  `)
  assert.equal(store.readGovernedCurrent('offline').kind, 'INVALID')
  const specific = store.readGovernedInvocation('offline', accepted.invocation.invocationId)
  assert.equal(specific.kind, 'INVALID')
  assert.equal('report' in specific, false)
  store.close()
})

test('reader family reports an inaccessible closed connection as UNAVAILABLE', () => {
  const store = new GovernanceValidationSidecar(sidecarPath('unavailable-reader-family'))
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  store.close()
  assert.equal(store.readGovernedCurrent('offline').kind, 'UNAVAILABLE')
  assert.equal(store.readGovernedInvocation('offline', accepted.invocation.invocationId).kind, 'UNAVAILABLE')
})

test('sealed production handle exposes no raw SQLite or arbitrary-SQL capability', async () => {
  const dbPath = sidecarPath('sealed-handle')
  const store = new GovernanceValidationSidecar(dbPath)
  const ownNames = Object.getOwnPropertyNames(store)
  const ownSymbols = Object.getOwnPropertySymbols(store)
  const prototypeNames = Object.getOwnPropertyNames(Object.getPrototypeOf(store))
  assert.deepEqual(ownSymbols, [])
  assert.deepEqual(prototypeNames.sort(), Object.getOwnPropertyNames(Object.prototype).sort())
  assert.equal(ownNames.includes('db'), false)
  assert.equal(ownNames.includes('_db'), false)
  for (const name of ownNames) {
    const value = (store as unknown as Record<string, unknown>)[name]
    assert.equal(Boolean(value && typeof value === 'object'
      && ('prepare' in value || 'exec' in value || 'pragma' in value)), false)
  }
  const productionModule = await import('./governance-validation-sidecar')
  assert.equal('openDisposableGovernanceSidecarForTests' in productionModule, false)
  assert.equal('DisposableGovernanceValidationSidecarForTests' in productionModule, false)
  assert.equal('openGovernanceSidecarAtPathInternal' in productionModule, false)
  store.close()
})

test('connection-local pragma drift fails closed before reads or mutations', () => {
  const dbPath = sidecarPath('pragma-drift')
  const { handle: store, database } = openDisposableGovernanceSidecarHarnessForTests(dbPath)
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  database.pragma('foreign_keys = OFF')
  assert.equal(store.readGovernedCurrent('offline').kind, 'INVALID')
  assert.throws(() => store.acceptInvocation('second-target'), /pragma verification failed/)
  database.pragma('foreign_keys = ON')
  assert.equal(store.readGovernedCurrent('offline').kind, 'INCOMPLETE')
  store.close()
})

test('disposable test path rejects traversal, junction, and symlink aliases', async t => {
  assert.throws(
    () => new GovernanceValidationSidecar(path.join(TEST_ROOT, '..', '..', 'escaped-governance.db')),
    /lexically inside the operating-system temporary directory/,
  )

  const junction = path.join(TEST_ROOT, 'junction-escape')
  fs.symlinkSync(REPOSITORY_ROOT, junction, 'junction')
  try {
    const packageBytes = fs.readFileSync(path.join(REPOSITORY_ROOT, 'package.json'))
    assert.throws(
      () => new GovernanceValidationSidecar(path.join(junction, 'attacker.db')),
      /symbolic links or junctions|resolve inside/,
    )
    assert.throws(
      () => new GovernanceValidationSidecar(path.join(junction, 'CON.db')),
      /reserved Windows device name|symbolic links or junctions|resolve inside/,
    )
    assert.deepEqual(fs.readFileSync(path.join(REPOSITORY_ROOT, 'package.json')), packageBytes)
    assert.equal(fs.existsSync(path.join(REPOSITORY_ROOT, 'attacker.db')), false)
  } finally {
    fs.unlinkSync(junction)
  }

  await t.test('directory symlink inside temp is rejected when supported', t2 => {
    const realParent = path.join(TEST_ROOT, 'real-symlink-parent')
    const symbolicParent = path.join(TEST_ROOT, 'symbolic-parent')
    fs.mkdirSync(realParent)
    try {
      fs.symlinkSync(realParent, symbolicParent, 'dir')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EPERM') {
        t2.skip('Windows host does not permit directory symlink creation.')
        return
      }
      throw cause
    }
    try {
      assert.throws(
        () => new GovernanceValidationSidecar(path.join(symbolicParent, 'attacker.db')),
        /symbolic links or junctions/,
      )
      assert.throws(
        () => new GovernanceValidationSidecar(path.join(symbolicParent, 'NUL.db')),
        /reserved Windows device name|symbolic links or junctions/,
      )
    } finally {
      fs.unlinkSync(symbolicParent)
    }
  })

  await t.test('hard-link alias cannot redirect a disposable database file', t2 => {
    const outside = path.join(REPOSITORY_ROOT, 'package.json')
    const linked = path.join(TEST_ROOT, 'hard-link-attacker.db')
    const outsideBefore = fs.readFileSync(outside)
    const productionSidecar = path.join(REPOSITORY_ROOT, '.forge', 'governance.db')
    const productionBefore = fs.existsSync(productionSidecar) ? fs.readFileSync(productionSidecar) : null
    try {
      fs.linkSync(outside, linked)
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EXDEV' || code === 'EACCES' || code === 'ENOTSUP') {
        const arbitrary = path.join(TEST_ROOT, 'hard-link-capability-fallback.db')
        const marker = Buffer.from('not-a-disposable-sqlite-destination', 'utf8')
        fs.writeFileSync(arbitrary, marker)
        assert.throws(
          () => new GovernanceValidationSidecar(arbitrary),
          /pre-existing non-SQLite destination/,
        )
        assert.deepEqual(fs.readFileSync(arbitrary), marker)
        fs.unlinkSync(arbitrary)
        assert.deepEqual(fs.readFileSync(outside), outsideBefore)
        if (productionBefore !== null) assert.deepEqual(fs.readFileSync(productionSidecar), productionBefore)
        t2.diagnostic(`HARD_LINK_ATTACK_UNAVAILABLE_ON_HOST; STATIC/STRUCTURAL_GUARD_VERIFIED (${code})`)
        return
      }
      throw cause
    }
    try {
      assert.throws(() => new GovernanceValidationSidecar(linked), /multiply-linked file/)
      assert.deepEqual(fs.readFileSync(outside), outsideBefore)
      if (productionBefore !== null) assert.deepEqual(fs.readFileSync(productionSidecar), productionBefore)
      t2.diagnostic('HARD_LINK_ATTACK_TESTED_AND_REJECTED')
    } finally {
      fs.unlinkSync(linked)
    }
  })
})

test('Windows reserved device components fail closed while safe lookalikes remain usable', () => {
  if (process.platform !== 'win32') return
  const rejected = [
    'CON', 'con', 'CON.db', 'PRN.sqlite', 'AUX', 'NUL.json',
    'CLOCK$', 'clock$.db', 'COM1', 'cOm1.Db', 'COM9.db',
    'LPT1', 'LPT9.sqlite', 'CON.', 'NUL ', 'ordinary.', 'ordinary ',
  ]
  for (const filename of rejected) {
    const candidate = path.join(TEST_ROOT, filename)
    assert.throws(
      () => new GovernanceValidationSidecar(candidate),
      /reserved Windows device name|trailing-dot\/space Windows alias/,
    )
    assert.equal(fs.existsSync(candidate), false)
  }

  const nestedReserved = path.join(TEST_ROOT, 'COM1', 'nested.db')
  assert.throws(
    () => new GovernanceValidationSidecar(nestedReserved),
    /reserved Windows device name/,
  )
  assert.equal(fs.existsSync(path.dirname(nestedReserved)), false)

  const ads = path.join(TEST_ROOT, 'safe.db:authority')
  assert.throws(
    () => new GovernanceValidationSidecar(ads),
    /invalid Windows path component/,
  )

  const safe = [
    'console.db', 'auxiliary.db', 'company1.db', 'my-com1-test.db',
    'com0.db', 'com10.db', 'lpt0.db', 'lpt10.db',
  ]
  for (const filename of safe) {
    const candidate = path.join(TEST_ROOT, filename)
    const store = new GovernanceValidationSidecar(candidate)
    assert.equal(store.readGovernedCurrent('offline').kind, 'NONE')
    store.close()
    const reopened = new GovernanceValidationSidecar(candidate)
    assert.equal(reopened.readGovernedCurrent('offline').kind, 'NONE')
    reopened.close()
  }

  const caseAlias = path.join(TEST_ROOT.toUpperCase(), 'windows-case-alias.db')
  const caseStore = new GovernanceValidationSidecar(caseAlias)
  caseStore.close()

  const arbitrary = path.join(TEST_ROOT, 'existing-arbitrary.db')
  const marker = Buffer.from('arbitrary-existing-file', 'utf8')
  fs.writeFileSync(arbitrary, marker)
  assert.throws(
    () => new GovernanceValidationSidecar(arbitrary),
    /pre-existing non-SQLite destination/,
  )
  assert.deepEqual(fs.readFileSync(arbitrary), marker)
  fs.unlinkSync(arbitrary)
})

test('database constraints and triggers reject structural authority forgery', async t => {
  const dbPath = sidecarPath('constraints')
  const store = new GovernanceValidationSidecar(dbPath)
  const first = store.acceptInvocation('p1')
  assert.equal(first.kind, 'ACCEPTED')
  if (first.kind !== 'ACCEPTED') return
  complete(store, first.invocation, 'PASS')
  store.close()
  const db = rawDatabase(dbPath)

  await t.test('target counters and identity cannot be directly mutated', () => {
    assert.throws(() => db.prepare(`UPDATE governed_targets SET authority_epoch = authority_epoch + 1 WHERE target_id = 'p1'`).run(), /projection mismatch/)
    assert.throws(() => db.prepare(`UPDATE governed_targets SET target_id = 'p2' WHERE target_id = 'p1'`).run(), /immutable/)
  })
  await t.test('invocations and events cannot be deleted or rewritten', () => {
    assert.throws(() => db.prepare(`DELETE FROM governed_invocations WHERE target_id = 'p1'`).run(), /cannot be deleted/)
    assert.throws(() => db.prepare(`UPDATE governed_invocations SET report_bytes = X'00' WHERE target_id = 'p1'`).run(), /state transition|immutable/)
    assert.throws(() => db.prepare(`DELETE FROM authority_events WHERE target_id = 'p1'`).run(), /append-only/)
    assert.throws(() => db.prepare(`UPDATE authority_events SET event_type = 'ABANDONED' WHERE target_id = 'p1'`).run(), /append-only/)
  })
  await t.test('invalid state bundles and sequence reuse fail', () => {
    assert.throws(() => db.prepare(`INSERT INTO governed_invocations(
      invocation_id,target_id,sequence,state,state_revision,accepted_authority_epoch,last_authority_epoch,
      accepted_at,infrastructure_status
    ) VALUES(?, 'p1', 1, 'ACTIVE', 0, 3, 3, 'now', 'HEALTHY')`).run(randomUUID()), /sequence|UNIQUE/)
    assert.throws(() => db.prepare(`UPDATE governed_invocations SET state = 'ACTIVE' WHERE target_id = 'p1'`).run(), /state transition/)
  })
  await t.test('cross-target predecessor is rejected by composite FK/trigger', () => {
    db.prepare(`INSERT INTO governed_targets(target_id,next_sequence,authority_epoch) VALUES('p2',1,0)`).run()
    assert.throws(() => db.prepare(`INSERT INTO governed_invocations(
      invocation_id,target_id,sequence,state,state_revision,accepted_authority_epoch,last_authority_epoch,
      previous_completed_invocation_id,accepted_at,infrastructure_status
    ) VALUES(?, 'p2', 1, 'ACTIVE', 0, 1, 1, ?, 'now', 'HEALTHY')`).run(randomUUID(), first.invocation.invocationId), /predecessor|FOREIGN KEY/)
  })
  db.close()
})

test('PASS, FAIL, and BLOCKED reports commit atomically and remain exact', async t => {
  for (const status of ['PASS', 'FAIL', 'BLOCKED'] as const) {
    await t.test(status, () => {
      const store = new GovernanceValidationSidecar(sidecarPath(`lifecycle-${status}`))
      const accepted = store.acceptInvocation('offline')
      assert.equal(accepted.kind, 'ACCEPTED')
      if (accepted.kind !== 'ACCEPTED') return
      assert.equal(store.readGovernedCurrent('offline').kind, 'INCOMPLETE')
      const { evidence, result } = complete(store, accepted.invocation, status)
      assert.equal(result.kind, 'COMPLETED')
      const current = store.readGovernedCurrent('offline')
      assert.equal(current.kind, 'CURRENT_COMPLETED')
      if (current.kind === 'CURRENT_COMPLETED') {
        assert.equal(current.invocationId, accepted.invocation.invocationId)
        assert.equal(current.report.overallStatus, status)
        assert.equal(deterministicValidationReportJson(current.report), evidence.reportBytes.toString('utf8'))
      }
      store.close()
    })
  }
})

test('canonical completion matrix never permits blocked infrastructure to surface PASS', async t => {
  const cases: ReadonlyArray<{
    name: string
    status: ValidationStatus
    infrastructure: 'HEALTHY' | 'BLOCKED'
    expected: ValidationStatus | 'REJECTED'
  }> = [
    { name: 'PASS plus HEALTHY', status: 'PASS', infrastructure: 'HEALTHY', expected: 'PASS' },
    { name: 'FAIL plus HEALTHY', status: 'FAIL', infrastructure: 'HEALTHY', expected: 'FAIL' },
    { name: 'BLOCKED plus BLOCKED', status: 'BLOCKED', infrastructure: 'BLOCKED', expected: 'BLOCKED' },
    { name: 'PASS plus BLOCKED', status: 'PASS', infrastructure: 'BLOCKED', expected: 'REJECTED' },
    { name: 'FAIL plus BLOCKED', status: 'FAIL', infrastructure: 'BLOCKED', expected: 'FAIL' },
    { name: 'NOT_RUN plus BLOCKED', status: 'NOT_RUN', infrastructure: 'BLOCKED', expected: 'NOT_RUN' },
  ]
  for (const item of cases) {
    await t.test(item.name, () => {
      const store = new GovernanceValidationSidecar(sidecarPath(`infrastructure-${item.name.replaceAll(' ', '-')}`))
      const accepted = store.acceptInvocation('offline')
      assert.equal(accepted.kind, 'ACCEPTED')
      if (accepted.kind !== 'ACCEPTED') return
      const validation = item.status === 'NOT_RUN'
        ? { ...report('PASS'), gates: [], overallStatus: 'NOT_RUN' as const }
        : report(item.status)
      const evidence = canonicalGovernedReportEvidence(validation)
      if (item.expected === 'REJECTED') {
        assert.throws(
          () => store.completeInvocation(expectation(accepted.invocation), evidence, item.infrastructure),
          /PASS requires healthy infrastructure/,
        )
        assert.equal(store.readGovernedCurrent('offline').kind, 'INCOMPLETE')
      } else {
        assert.equal(store.completeInvocation(expectation(accepted.invocation), evidence, item.infrastructure).kind, 'COMPLETED')
        const current = store.readGovernedCurrent('offline')
        assert.equal(current.kind, 'CURRENT_COMPLETED')
        if (current.kind === 'CURRENT_COMPLETED') assert.equal(current.report.overallStatus, item.expected)
      }
      store.close()
    })
  }

  await t.test('SQLite rejects raw PASS plus BLOCKED even below the production completion method', () => {
    const dbPath = sidecarPath('infrastructure-raw-pass-blocked')
    const store = new GovernanceValidationSidecar(dbPath)
    const accepted = store.acceptInvocation('offline')
    assert.equal(accepted.kind, 'ACCEPTED')
    if (accepted.kind !== 'ACCEPTED') return
    const evidence = canonicalGovernedReportEvidence(report('PASS'))
    store.close()
    const db = rawDatabase(dbPath)
    assert.throws(() => db.prepare(
      `UPDATE governed_invocations
          SET state='COMPLETED', state_revision=1, last_authority_epoch=2,
              terminal_at=?, result_status='PASS', infrastructure_status='BLOCKED',
              report_bytes=?, report_sha256=?
        WHERE invocation_id=?`,
    ).run(evidence.terminalAt, evidence.reportBytes, evidence.reportSha256, accepted.invocation.invocationId), /CHECK constraint failed/)
    db.close()
  })
})

test('authority timestamps are canonical ISO-8601 UTC audit metadata', () => {
  const store = new GovernanceValidationSidecar(sidecarPath('timestamps'))
  for (const invalid of [
    'now',
    '2026-08-21',
    '2026-08-21T12:00:00',
    '2026-08-21T12:00:00Z',
    '2026-08-21T12:00:00.000+00:00',
  ]) {
    assert.throws(() => store.acceptInvocation('offline', randomUUID(), invalid), /ISO-8601 UTC timestamp/)
  }
  for (const invalid of ['2026-08-21T24:00:00.000Z', '2026-08-21T24:01:00.001Z']) {
    assert.throws(() => store.acceptInvocation('offline', randomUUID(), invalid), /canonical UTC timestamp/)
  }
  const accepted = store.acceptInvocation('offline', randomUUID(), '2026-08-21T12:00:00.000Z')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  const evidence = canonicalGovernedReportEvidence(report('PASS'))
  assert.throws(
    () => store.completeInvocation(expectation(accepted.invocation), { ...evidence, terminalAt: '2026-08-21 12:00:00' }),
    /ISO-8601 UTC timestamp/,
  )
  store.close()

  const dbPath = sidecarPath('timestamps-schema')
  const schemaStore = new GovernanceValidationSidecar(dbPath)
  schemaStore.close()
  const db = rawDatabase(dbPath)
  db.prepare(`INSERT INTO governed_targets(target_id,next_sequence,authority_epoch) VALUES('offline',1,0)`).run()
  assert.throws(() => db.prepare(
    `INSERT INTO governed_invocations(
       invocation_id,target_id,sequence,state,state_revision,
       accepted_authority_epoch,last_authority_epoch,accepted_at,infrastructure_status
     ) VALUES(?, 'offline', 1, 'ACTIVE', 0, 1, 1, '2026-08-21 12:00:00', 'HEALTHY')`,
  ).run(randomUUID()), /CHECK constraint failed/)
  assert.throws(() => db.prepare(
    `INSERT INTO governed_invocations(
       invocation_id,target_id,sequence,state,state_revision,
       accepted_authority_epoch,last_authority_epoch,accepted_at,infrastructure_status
     ) VALUES(?, 'offline', 1, 'ACTIVE', 0, 1, 1, '2026-08-21T24:00:00.000Z', 'HEALTHY')`,
  ).run(randomUUID()), /CHECK constraint failed/)
  db.close()

  const terminalPath = sidecarPath('timestamps-schema-terminal')
  const terminalStore = new GovernanceValidationSidecar(terminalPath)
  const terminalAccepted = terminalStore.acceptInvocation(
    'offline', randomUUID(), '2026-08-21T23:59:59.999Z',
  )
  assert.equal(terminalAccepted.kind, 'ACCEPTED')
  if (terminalAccepted.kind !== 'ACCEPTED') return
  const terminalEvidence = canonicalGovernedReportEvidence(report('PASS'))
  terminalStore.close()
  const terminalDb = rawDatabase(terminalPath)
  assert.throws(() => terminalDb.prepare(
    `UPDATE governed_invocations
        SET state='COMPLETED', state_revision=1, last_authority_epoch=2,
            terminal_at='2026-08-21T24:00:00.000Z', result_status='PASS',
            infrastructure_status='HEALTHY', report_bytes=?, report_sha256=?
      WHERE invocation_id=?`,
  ).run(
    terminalEvidence.reportBytes,
    terminalEvidence.reportSha256,
    terminalAccepted.invocation.invocationId,
  ), /CHECK constraint failed/)
  terminalDb.exec(`DROP TRIGGER authority_events_no_update`)
  assert.throws(() => terminalDb.prepare(
    `UPDATE authority_events SET recorded_at='2026-08-21T24:00:00.000Z'`,
  ).run(), /CHECK constraint failed/)
  terminalDb.close()
})

test('completion retry is exact-idempotent and conflicting evidence is fenced', () => {
  const store = new GovernanceValidationSidecar(sidecarPath('completion-idempotency'))
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  const evidence = canonicalGovernedReportEvidence(report('PASS'))
  const expected = expectation(accepted.invocation)
  assert.deepEqual(store.completeInvocation(expected, evidence), {
    kind: 'COMPLETED',
    invocation: { ...accepted.invocation, stateRevision: 1n, lastAuthorityEpoch: 2n },
    idempotent: false,
  })
  assert.equal(store.completeInvocation(expected, evidence).kind, 'COMPLETED')
  assert.throws(
    () => store.completeInvocation(expected, { ...evidence, terminalAt: 'different-terminal-time' }),
    /terminal time must be an ISO-8601 UTC timestamp/,
  )
  const conflicting = canonicalGovernedReportEvidence(report('FAIL'))
  assert.deepEqual(store.completeInvocation(expected, conflicting), {
    kind: 'CONFLICT', reason: 'Completed governed evidence differs from the retry.',
  })
  store.close()
})

test('uncommitted completion is invisible and rollback preserves ACTIVE authority', () => {
  const dbPath = sidecarPath('completion-rollback')
  const reader = new GovernanceValidationSidecar(dbPath)
  const accepted = reader.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  const evidence = canonicalGovernedReportEvidence(report('PASS'))
  const writer = rawDatabase(dbPath)
  writer.exec('BEGIN IMMEDIATE')
  writer.prepare(
    `UPDATE governed_invocations
        SET state = 'COMPLETED', state_revision = state_revision + 1,
            last_authority_epoch = ?, terminal_at = ?, result_status = ?,
            infrastructure_status = 'HEALTHY', report_bytes = ?, report_sha256 = ?
      WHERE invocation_id = ? AND target_id = ? AND state = 'ACTIVE'`,
  ).run(
    accepted.invocation.lastAuthorityEpoch + 1n,
    evidence.terminalAt,
    evidence.resultStatus,
    evidence.reportBytes,
    evidence.reportSha256,
    accepted.invocation.invocationId,
    accepted.invocation.targetId,
  )
  assert.equal(reader.readGovernedCurrent('offline').kind, 'INCOMPLETE')
  writer.exec('ROLLBACK')
  writer.close()
  assert.equal(reader.readGovernedCurrent('offline').kind, 'INCOMPLETE')
  const completed = reader.completeInvocation(expectation(accepted.invocation), evidence)
  assert.equal(completed.kind, 'COMPLETED')
  assert.equal(reader.readGovernedCurrent('offline').kind, 'CURRENT_COMPLETED')
  reader.close()
})

test('recovery and abandonment are identity-bound, idempotent, and fence stale completion', () => {
  const store = new GovernanceValidationSidecar(sidecarPath('recovery'))
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  const request = randomUUID()
  const recovery = store.requireRecovery(expectation(accepted.invocation), request, 'child process disappeared')
  assert.equal(recovery.kind, 'RECOVERY_REQUIRED')
  if (recovery.kind !== 'RECOVERY_REQUIRED') return
  assert.equal(store.readGovernedCurrent('offline').kind, 'RECOVERY_REQUIRED')
  const repeatedRecovery = store.requireRecovery(expectation(accepted.invocation), request, 'child process disappeared')
  assert.equal(repeatedRecovery.kind, 'RECOVERY_REQUIRED')
  if (repeatedRecovery.kind === 'RECOVERY_REQUIRED') assert.equal(repeatedRecovery.idempotent, true)
  assert.equal(store.requireRecovery({ ...expectation(accepted.invocation), sequence: 2n }, request, 'child process disappeared').kind, 'CONFLICT')
  const recoveredExpectation = expectation(recovery.invocation)
  const terminalAt = '2026-08-21T12:00:00.000Z'
  const abandonment = store.abandonInvocation(recoveredExpectation, request, 'child process disappeared', terminalAt)
  assert.equal(abandonment.kind, 'ABANDONED')
  if (abandonment.kind !== 'ABANDONED') return
  assert.equal(store.abandonInvocation(recoveredExpectation, request, 'child process disappeared', terminalAt).kind, 'ABANDONED')
  assert.equal(store.abandonInvocation(recoveredExpectation, randomUUID(), 'different request', terminalAt).kind, 'CONFLICT')
  assert.equal(
    store.abandonInvocation(recoveredExpectation, request, 'child process disappeared', '2026-08-21T12:00:01.000Z').kind,
    'CONFLICT',
  )
  assert.equal(store.completeInvocation(expectation(accepted.invocation), canonicalGovernedReportEvidence(report('PASS'))).kind, 'CONFLICT')
  assert.equal(store.readGovernedCurrent('offline').kind, 'ABANDONED')
  const next = store.acceptInvocation('offline')
  assert.equal(next.kind, 'ACCEPTED')
  store.close()

  const directStore = new GovernanceValidationSidecar(sidecarPath('direct-abandonment'))
  const direct = directStore.acceptInvocation('offline')
  assert.equal(direct.kind, 'ACCEPTED')
  if (direct.kind === 'ACCEPTED') {
    const requestId = randomUUID()
    const abandoned = directStore.abandonInvocation(expectation(direct.invocation), requestId, 'quiescence independently proven')
    assert.equal(abandoned.kind, 'ABANDONED')
    assert.equal(directStore.readGovernedCurrent('offline').kind, 'ABANDONED')
  }
  directStore.close()
})

test('abandonment retry requires byte-for-byte authority request identity', () => {
  const store = new GovernanceValidationSidecar(sidecarPath('abandonment-exactness'))
  const accepted = store.acceptInvocation('offline', randomUUID(), '2026-08-21T12:00:00.000Z')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  const recoveryRequestId = randomUUID()
  const recovery = store.requireRecovery(expectation(accepted.invocation), recoveryRequestId, 'exact reason')
  assert.equal(recovery.kind, 'RECOVERY_REQUIRED')
  if (recovery.kind !== 'RECOVERY_REQUIRED') return
  const expected = expectation(recovery.invocation)
  const terminalAt = '2026-08-21T12:00:01.000Z'
  const first = store.abandonInvocation(expected, recoveryRequestId, 'exact reason', terminalAt)
  assert.equal(first.kind, 'ABANDONED')
  assert.equal(store.abandonInvocation(expected, recoveryRequestId, 'exact reason', terminalAt).kind, 'ABANDONED')
  const changedExpectations: GovernedInvocationExpectation[] = [
    { ...expected, targetId: 'another-target' },
    { ...expected, invocationId: randomUUID() },
    { ...expected, sequence: expected.sequence + 1n },
    { ...expected, stateRevision: expected.stateRevision + 1n },
    { ...expected, authorityEpoch: expected.authorityEpoch + 1n },
  ]
  for (const changed of changedExpectations) {
    assert.equal(store.abandonInvocation(changed, recoveryRequestId, 'exact reason', terminalAt).kind, 'CONFLICT')
  }
  assert.equal(store.abandonInvocation(expected, randomUUID(), 'exact reason', terminalAt).kind, 'CONFLICT')
  assert.equal(store.abandonInvocation(expected, recoveryRequestId, 'changed reason', terminalAt).kind, 'CONFLICT')
  assert.equal(
    store.abandonInvocation(expected, recoveryRequestId, 'exact reason', '2026-08-21T12:00:02.000Z').kind,
    'CONFLICT',
  )
  store.close()
})

test('historical PASS never replaces ACTIVE, RECOVERY_REQUIRED, or ABANDONED latest authority', async t => {
  for (const terminal of ['ACTIVE', 'RECOVERY_REQUIRED', 'ABANDONED'] as const) {
    await t.test(terminal, () => {
      const store = new GovernanceValidationSidecar(sidecarPath(`no-fallback-${terminal}`))
      const first = store.acceptInvocation('offline')
      assert.equal(first.kind, 'ACCEPTED')
      if (first.kind !== 'ACCEPTED') return
      complete(store, first.invocation, 'PASS')
      const second = store.acceptInvocation('offline')
      assert.equal(second.kind, 'ACCEPTED')
      if (second.kind !== 'ACCEPTED') return
      let expected = expectation(second.invocation)
      if (terminal !== 'ACTIVE') {
        const recovery = store.requireRecovery(expected, randomUUID(), 'synthetic recovery')
        assert.equal(recovery.kind, 'RECOVERY_REQUIRED')
        if (recovery.kind !== 'RECOVERY_REQUIRED') return
        expected = expectation(recovery.invocation)
        if (terminal === 'ABANDONED') store.abandonInvocation(expected, randomUUID(), 'synthetic abandonment')
      }
      const current = store.readGovernedCurrent('offline')
      assert.equal(current.kind, terminal === 'ACTIVE' ? 'INCOMPLETE' : terminal)
      assert.equal('lastCompleted' in current ? current.lastCompleted?.invocationId : null, first.invocation.invocationId)
      store.close()
    })
  }
})

test('same-target acceptance has one transactional winner', async () => {
  const dbPath = sidecarPath('same-target')
  const release = path.join(BARRIER_ROOT, 'same-target.release')
  const readyA = path.join(BARRIER_ROOT, 'same-target-a.ready')
  const readyB = path.join(BARRIER_ROOT, 'same-target-b.ready')
  const invocationA = randomUUID()
  const invocationB = randomUUID()
  const aPromise = directChild({ GOV_DB: dbPath, GOV_MODE: 'accept', GOV_TARGET: 'offline', GOV_INVOCATION: invocationA, GOV_READY: readyA, GOV_RELEASE: release })
  await waitForFile(readyA)
  const bPromise = directChild({ GOV_DB: dbPath, GOV_MODE: 'accept', GOV_TARGET: 'offline', GOV_INVOCATION: invocationB, GOV_READY: readyB, GOV_RELEASE: release })
  await waitForFile(readyB)
  fs.writeFileSync(release, 'go', 'utf8')
  const [a, b] = await Promise.all([aPromise, bPromise])
  assert.equal(a.code, 0)
  assert.equal(b.code, 0)
  const results = [JSON.parse(a.stdout), JSON.parse(b.stdout)] as Array<{ kind: string }>
  assert.deepEqual(results.map(value => value.kind).sort(), ['ACCEPTED', 'CONFLICT'])
  const store = new GovernanceValidationSidecar(dbPath)
  assert.equal(store.readGovernedCurrent('offline').kind, 'INCOMPLETE')
  store.close()
})

test('same-target acceptance remains single-winner under repeated contention', async () => {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const dbPath = sidecarPath(`same-target-stress-${iteration}`)
    const release = path.join(BARRIER_ROOT, `same-target-stress-${iteration}.release`)
    const readyA = path.join(BARRIER_ROOT, `same-target-stress-${iteration}-a.ready`)
    const readyB = path.join(BARRIER_ROOT, `same-target-stress-${iteration}-b.ready`)
    const a = directChild({
      GOV_DB: dbPath, GOV_MODE: 'accept', GOV_TARGET: 'offline',
      GOV_INVOCATION: randomUUID(), GOV_READY: readyA, GOV_RELEASE: release,
    })
    await waitForFile(readyA)
    const b = directChild({
      GOV_DB: dbPath, GOV_MODE: 'accept', GOV_TARGET: 'offline',
      GOV_INVOCATION: randomUUID(), GOV_READY: readyB, GOV_RELEASE: release,
    })
    await waitForFile(readyB)
    fs.writeFileSync(release, 'go', 'utf8')
    const results = await Promise.all([a, b])
    assert.equal(results.every(result => result.code === 0), true)
    assert.deepEqual(
      results.map(result => (JSON.parse(result.stdout) as { kind: string }).kind).sort(),
      ['ACCEPTED', 'CONFLICT'],
    )
  }
})

test('completion and recovery race has one epoch winner and fences the loser', async () => {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const dbPath = sidecarPath(`transition-race-${iteration}`)
    const store = new GovernanceValidationSidecar(dbPath)
    const accepted = store.acceptInvocation('offline')
    assert.equal(accepted.kind, 'ACCEPTED')
    if (accepted.kind !== 'ACCEPTED') continue
    store.close()
    const shared = {
      GOV_DB: dbPath,
      GOV_TARGET: 'offline',
      GOV_INVOCATION: accepted.invocation.invocationId,
      GOV_SEQUENCE: accepted.invocation.sequence.toString(),
      GOV_REVISION: accepted.invocation.stateRevision.toString(),
      GOV_EPOCH: accepted.invocation.lastAuthorityEpoch.toString(),
    }
    const release = path.join(BARRIER_ROOT, `transition-race-${iteration}.release`)
    const completionReady = path.join(BARRIER_ROOT, `transition-race-${iteration}-completion.ready`)
    const recoveryReady = path.join(BARRIER_ROOT, `transition-race-${iteration}-recovery.ready`)
    const completionPromise = directChild({
      ...shared,
      GOV_MODE: 'complete-existing',
      GOV_REPORT: JSON.stringify(report('PASS')),
      GOV_READY: completionReady,
      GOV_RELEASE: release,
    })
    await waitForFile(completionReady)
    const recoveryPromise = directChild({
      ...shared,
      GOV_MODE: 'recover-existing',
      GOV_RECOVERY_ID: randomUUID(),
      GOV_READY: recoveryReady,
      GOV_RELEASE: release,
    })
    await waitForFile(recoveryReady)
    fs.writeFileSync(release, 'go', 'utf8')
    const [completion, recovery] = await Promise.all([completionPromise, recoveryPromise])
    assert.equal(completion.code, 0, completion.stderr)
    assert.equal(recovery.code, 0, recovery.stderr)
    const completionResult = JSON.parse(completion.stdout) as { kind: string }
    const recoveryResult = JSON.parse(recovery.stdout) as { kind: string }
    const winners = [completionResult.kind, recoveryResult.kind]
      .filter(kind => kind === 'COMPLETED' || kind === 'RECOVERY_REQUIRED')
    assert.equal(winners.length, 1)
    assert.equal([completionResult.kind, recoveryResult.kind].includes('CONFLICT'), true)
    const verify = new GovernanceValidationSidecar(dbPath)
    const current = verify.readGovernedCurrent('offline')
    assert.equal(current.kind, winners[0] === 'COMPLETED' ? 'CURRENT_COMPLETED' : 'RECOVERY_REQUIRED')
    const db = rawDatabase(dbPath)
    const eventCount = (db.prepare(`SELECT COUNT(*) AS count FROM authority_events WHERE target_id = 'offline'`).get() as { count: bigint }).count
    assert.equal(eventCount, 2n)
    db.close()
    verify.close()
  }
})

test('different exported run targets overlap while preserving roots, environment, and real Git isolation', async () => {
  const parentBefore = parentEnvironment()
  const a = launchRun({ label: 'overlap-a', targetId: 'target-a', childExitCode: 0 })
  const b = launchRun({ label: 'overlap-b', targetId: 'target-b', childExitCode: 0 })
  const [markerA, markerB] = await Promise.all([a.started, b.started])
  assert.notEqual(markerA.root, markerB.root)
  assert.equal(fs.existsSync(markerA.root), true)
  assert.equal(fs.existsSync(markerB.root), true)
  assertInvocationEnvironment(markerA)
  assertInvocationEnvironment(markerB)
  const markerBBytes = fs.readFileSync(path.join(markerB.root, 'owned-marker.json'))
  a.release()
  const resultA = await a.completed
  assert.equal(resultA.code, 0)
  assert.equal(fs.existsSync(markerA.root), false)
  assert.equal(fs.existsSync(markerB.root), true)
  assert.deepEqual(fs.readFileSync(path.join(markerB.root, 'owned-marker.json')), markerBBytes)
  b.release()
  const resultB = await b.completed
  assert.equal(resultB.code, 0)
  assert.equal(fs.existsSync(markerB.root), false)
  assert.deepEqual(parentEnvironment(), parentBefore)
  for (const label of [a.label, b.label]) {
    const environment = JSON.parse(fs.readFileSync(callerEnvironmentFile(label), 'utf8')) as { before: unknown; after: unknown }
    assert.deepEqual(environment.after, environment.before)
  }
  const store = new GovernanceValidationSidecar(SHARED_SIDECAR)
  assert.equal(store.readGovernedCurrent('target-a').kind, 'CURRENT_COMPLETED')
  assert.equal(store.readGovernedCurrent('target-b').kind, 'CURRENT_COMPLETED')
  store.close()
})

test('exported run rejects same-target overlap before a second command/root starts', async () => {
  const a = launchRun({ label: 'same-run-a', targetId: 'same-run' })
  const markerA = await a.started
  const b = launchRun({ label: 'same-run-b', targetId: 'same-run', waitAtFirstCommand: false, expectBarrier: false })
  const resultB = await b.completed
  assert.equal(resultB.code, 2)
  assert.match(resultB.stderr, /already has ACTIVE invocation/)
  assert.equal(fs.existsSync(startedFile(b.label)), false)
  a.release()
  assert.equal((await a.completed).code, 0)
  assert.equal(fs.existsSync(markerA.root), false)
})

test('cleanup failure becomes completed infrastructure BLOCKED evidence without forged deletion', async () => {
  const state = launchRun({ label: 'cleanup-failure', targetId: 'cleanup-failure', failCleanup: true })
  const marker = await state.started
  state.release()
  const result = await state.completed
  assert.equal(result.code, 2)
  assert.equal(fs.existsSync(marker.root), true)
  const store = new GovernanceValidationSidecar(SHARED_SIDECAR)
  const current = store.readGovernedCurrent(state.targetId)
  assert.equal(current.kind, 'CURRENT_COMPLETED')
  if (current.kind === 'CURRENT_COMPLETED') {
    assert.equal(current.report.overallStatus, 'BLOCKED')
    assert.equal(current.report.gates.some(gate => gate.id === 'governance.invocation-cleanup'
      && gate.findingKind === 'NONE'), true)
  }
  store.close()
  removeKnownRoot(marker.root)
})

test('context creation failure is durable BLOCKED authority and creates no invocation root', async () => {
  const state = launchRun({
    label: 'context-failure',
    targetId: 'context-failure',
    failContextCreation: true,
    waitAtFirstCommand: false,
    expectBarrier: false,
  })
  const result = await state.completed
  assert.equal(result.code, 2)
  const store = new GovernanceValidationSidecar(SHARED_SIDECAR)
  const current = store.readGovernedCurrent(state.targetId)
  assert.equal(current.kind, 'CURRENT_COMPLETED')
  if (current.kind === 'CURRENT_COMPLETED') assert.equal(current.report.overallStatus, 'BLOCKED')
  store.close()
  assert.equal(fs.existsSync(startedFile(state.label)), false)
})

test('stored report corruption fails closed below the canonical reader boundary', async t => {
  async function corrupt(label: string, mutation: (db: BetterSqlite3.Database, invocationId: string) => void, expected: RegExp) {
    const dbPath = sidecarPath(`corrupt-${label}`)
    const store = new GovernanceValidationSidecar(dbPath)
    const accepted = store.acceptInvocation('offline')
    assert.equal(accepted.kind, 'ACCEPTED')
    if (accepted.kind !== 'ACCEPTED') return
    complete(store, accepted.invocation, 'PASS')
    const db = rawDatabase(dbPath)
    const enforcementSql = db.prepare(
      `SELECT sql FROM sqlite_schema
        WHERE type='trigger' AND name IN ('governed_invocations_validate_update','governed_invocations_after_update')
        ORDER BY name`,
    ).all().map(row => (row as { sql: string }).sql)
    db.exec(`DROP TRIGGER governed_invocations_validate_update`)
    db.exec(`DROP TRIGGER governed_invocations_after_update`)
    mutation(db, accepted.invocation.invocationId)
    for (const sql of enforcementSql) db.exec(sql)
    db.close()
    const current = store.readGovernedCurrent('offline')
    assert.equal(current.kind, 'INVALID')
    if (current.kind === 'INVALID') assert.match(current.reason, expected)
    store.close()
  }

  await t.test('hash mismatch', () => corrupt('hash', db => {
    db.prepare(`UPDATE governed_invocations SET report_sha256 = ?`).run('0'.repeat(64))
  }, /hash mismatch/))
  await t.test('invalid UTF-8 with matching hash', () => corrupt('utf8', db => {
    const bytes = Buffer.from([0xc3, 0x28])
    db.prepare(`UPDATE governed_invocations SET report_bytes = ?, report_sha256 = ?`).run(bytes, sha256(bytes))
  }, /UTF-8/))
  await t.test('result mismatch', () => corrupt('result', db => {
    db.prepare(`UPDATE governed_invocations SET result_status = 'FAIL'`).run()
  }, /status does not match/))
  await t.test('event epoch/revision corruption poisons trusted authority without becoming an authority source', () => {
    const dbPath = sidecarPath('corrupt-event')
    const store = new GovernanceValidationSidecar(dbPath)
    const accepted = store.acceptInvocation('offline')
    assert.equal(accepted.kind, 'ACCEPTED')
    if (accepted.kind !== 'ACCEPTED') return
    complete(store, accepted.invocation, 'PASS')
    const db = rawDatabase(dbPath)
    const enforcementSql = (db.prepare(
      `SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='authority_events_no_update'`,
    ).get() as { sql: string }).sql
    db.exec(`DROP TRIGGER authority_events_no_update`)
    db.prepare(`UPDATE authority_events SET state_revision = state_revision + 1 WHERE event_type = 'COMPLETED'`).run()
    db.exec(enforcementSql)
    db.close()
    assert.equal(store.readGovernedCurrent('offline').kind, 'INVALID')
    assert.ok(store.integrityCheck().authorityAuditViolations.length > 0)
    store.close()
  })
  await t.test('invalid ACTIVE state bundle is rejected even below SQLite CHECK enforcement', () => {
    const dbPath = sidecarPath('corrupt-active-bundle')
    const store = new GovernanceValidationSidecar(dbPath)
    const accepted = store.acceptInvocation('offline')
    assert.equal(accepted.kind, 'ACCEPTED')
    if (accepted.kind !== 'ACCEPTED') return
    const db = rawDatabase(dbPath)
    const enforcementSql = db.prepare(
      `SELECT sql FROM sqlite_schema
        WHERE type='trigger' AND name IN ('governed_invocations_validate_update','governed_invocations_after_update')
        ORDER BY name`,
    ).all().map(row => (row as { sql: string }).sql)
    db.exec(`DROP TRIGGER governed_invocations_validate_update`)
    db.exec(`DROP TRIGGER governed_invocations_after_update`)
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE governed_invocations SET report_bytes = X'00' WHERE invocation_id = ?`).run(accepted.invocation.invocationId)
    for (const sql of enforcementSql) db.exec(sql)
    db.close()
    const current = store.readGovernedCurrent('offline')
    assert.equal(current.kind, 'INVALID')
    if (current.kind === 'INVALID') assert.match(current.reason, /ACTIVE.*state bundle|CHECK constraint/)
    store.close()
  })
  await t.test('wrong highest-completed predecessor is rejected independently of its FK', () => {
    const dbPath = sidecarPath('corrupt-predecessor')
    const store = new GovernanceValidationSidecar(dbPath)
    const first = store.acceptInvocation('offline')
    assert.equal(first.kind, 'ACCEPTED')
    if (first.kind !== 'ACCEPTED') return
    complete(store, first.invocation, 'PASS')
    const second = store.acceptInvocation('offline')
    assert.equal(second.kind, 'ACCEPTED')
    if (second.kind !== 'ACCEPTED') return
    const db = rawDatabase(dbPath)
    const enforcementSql = db.prepare(
      `SELECT sql FROM sqlite_schema
        WHERE type='trigger' AND name IN ('governed_invocations_validate_update','governed_invocations_after_update')
        ORDER BY name`,
    ).all().map(row => (row as { sql: string }).sql)
    db.exec(`DROP TRIGGER governed_invocations_validate_update`)
    db.exec(`DROP TRIGGER governed_invocations_after_update`)
    db.prepare(`UPDATE governed_invocations SET previous_completed_invocation_id = NULL WHERE invocation_id = ?`).run(second.invocation.invocationId)
    for (const sql of enforcementSql) db.exec(sql)
    db.close()
    const current = store.readGovernedCurrent('offline')
    assert.equal(current.kind, 'INVALID')
    if (current.kind === 'INVALID') assert.match(current.reason, /predecessor/)
    store.close()
  })
})

test('epoch and revision corruption fails closed across current and specific trusted readers', async t => {
  const cases: ReadonlyArray<{
    readonly label: string
    readonly mutate: (database: BetterSqlite3.Database) => void
  }> = [
    {
      label: 'accepted epoch plus one',
      mutate: database => { database.prepare(
        `UPDATE main.governed_invocations SET accepted_authority_epoch = accepted_authority_epoch + 1`,
      ).run() },
    },
    {
      label: 'accepted epoch minus one',
      mutate: database => { database.prepare(
        `UPDATE main.governed_invocations SET accepted_authority_epoch = accepted_authority_epoch - 1`,
      ).run() },
    },
    {
      label: 'last epoch plus one',
      mutate: database => { database.prepare(
        `UPDATE main.governed_invocations SET last_authority_epoch = last_authority_epoch + 1`,
      ).run() },
    },
    {
      label: 'last epoch minus one',
      mutate: database => { database.prepare(
        `UPDATE main.governed_invocations SET last_authority_epoch = last_authority_epoch - 1`,
      ).run() },
    },
    {
      label: 'state revision wrong',
      mutate: database => { database.prepare(
        `UPDATE main.governed_invocations SET state_revision = state_revision + 1`,
      ).run() },
    },
    {
      label: 'target epoch ahead',
      mutate: database => { database.prepare(
        `UPDATE main.governed_targets SET authority_epoch = authority_epoch + 1`,
      ).run() },
    },
    {
      label: 'target epoch behind',
      mutate: database => { database.prepare(
        `UPDATE main.governed_targets SET authority_epoch = authority_epoch - 1`,
      ).run() },
    },
    {
      label: 'sequence history gap',
      mutate: database => { database.prepare(
        `UPDATE main.governed_invocations SET sequence = sequence + 1`,
      ).run() },
    },
  ]

  for (const scenario of cases) {
    await t.test(scenario.label, () => {
      const dbPath = sidecarPath(`epoch-corruption-${scenario.label.replaceAll(' ', '-')}`)
      const store = new GovernanceValidationSidecar(dbPath)
      const accepted = store.acceptInvocation('offline')
      assert.equal(accepted.kind, 'ACCEPTED')
      if (accepted.kind !== 'ACCEPTED') return
      assert.equal(complete(store, accepted.invocation, 'PASS').result.kind, 'COMPLETED')
      assert.equal(store.readGovernedCurrent('offline').kind, 'CURRENT_COMPLETED')

      corruptAuthorityRows(dbPath, scenario.mutate)

      const integrity = store.integrityCheck()
      assert.equal(typeof integrity.integrity, 'string')
      assert.deepEqual(integrity.foreignKeyViolations, [])
      assert.ok(integrity.authorityAuditViolations.length > 0)
      const current = store.readGovernedCurrent('offline')
      assert.equal(current.kind, 'INVALID')
      assert.notEqual(current.kind, 'CURRENT_COMPLETED')
      const specific = store.readGovernedInvocation('offline', accepted.invocation.invocationId)
      assert.equal(specific.kind, 'INVALID')
      store.close()
    })
  }
})

test('reopened semantic epoch corruption is INVALID, never unavailable or current authority', () => {
  const dbPath = sidecarPath('epoch-corruption-reopen')
  const store = new GovernanceValidationSidecar(dbPath)
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  assert.equal(complete(store, accepted.invocation, 'PASS').result.kind, 'COMPLETED')
  assert.equal(store.readGovernedCurrent('offline').kind, 'CURRENT_COMPLETED')
  store.close()

  corruptAuthorityRows(dbPath, database => {
    database.prepare(
      `UPDATE main.governed_invocations SET accepted_authority_epoch = accepted_authority_epoch + 1`,
    ).run()
  })

  const current = readGovernedCurrentFromSidecar(dbPath, 'offline')
  assert.equal(current.kind, 'INVALID')
  assert.notEqual(current.kind, 'UNAVAILABLE')
  assert.notEqual(current.kind, 'CURRENT_COMPLETED')
  const specific = readGovernedInvocationAtPathInternal(
    dbPath, 'offline', accepted.invocation.invocationId,
  )
  assert.equal(specific.kind, 'INVALID')
  assert.notEqual(specific.kind, 'UNAVAILABLE')
  assert.notEqual(specific.kind, 'CURRENT_COMPLETED')
})

test('full authority history rejects coordinated and historically impossible counter rewrites', async t => {
  await t.test('coordinated latest-row shift cannot create a new epoch origin', () => {
    const dbPath = sidecarPath('epoch-coordinated-latest')
    const store = new GovernanceValidationSidecar(dbPath)
    const accepted = store.acceptInvocation('offline')
    assert.equal(accepted.kind, 'ACCEPTED')
    if (accepted.kind !== 'ACCEPTED') return
    assert.equal(complete(store, accepted.invocation, 'PASS').result.kind, 'COMPLETED')
    corruptAuthorityRows(dbPath, database => {
      database.prepare(
        `UPDATE main.governed_invocations
            SET accepted_authority_epoch = accepted_authority_epoch + 1,
                last_authority_epoch = last_authority_epoch + 1`,
      ).run()
      database.prepare(`UPDATE main.governed_targets SET authority_epoch = authority_epoch + 1`).run()
    })
    assert.equal(store.readGovernedCurrent('offline').kind, 'INVALID')
    assert.throws(() => store.acceptInvocation('offline'), /semantic authority epoch\/revision violations/)
    store.close()
  })

  await t.test('locally valid latest row cannot hide a corrupted prior epoch chain', () => {
    const dbPath = sidecarPath('epoch-corrupt-prior')
    const store = new GovernanceValidationSidecar(dbPath)
    const first = store.acceptInvocation('offline')
    assert.equal(first.kind, 'ACCEPTED')
    if (first.kind !== 'ACCEPTED') return
    assert.equal(complete(store, first.invocation, 'PASS').result.kind, 'COMPLETED')
    const second = store.acceptInvocation('offline')
    assert.equal(second.kind, 'ACCEPTED')
    if (second.kind !== 'ACCEPTED') return
    corruptAuthorityRows(dbPath, database => {
      database.prepare(
        `UPDATE main.governed_invocations
            SET accepted_authority_epoch = accepted_authority_epoch + 1,
                last_authority_epoch = last_authority_epoch + 1
          WHERE invocation_id = ?`,
      ).run(first.invocation.invocationId)
    })
    const current = store.readGovernedCurrent('offline')
    assert.equal(current.kind, 'INVALID')
    assert.equal(store.readGovernedInvocation('offline', first.invocation.invocationId).kind, 'INVALID')
    store.close()
  })

  await t.test('ABANDONED revision cannot claim an unrecorded recovery transition', () => {
    const dbPath = sidecarPath('epoch-impossible-abandonment')
    const store = new GovernanceValidationSidecar(dbPath)
    const accepted = store.acceptInvocation('offline')
    assert.equal(accepted.kind, 'ACCEPTED')
    if (accepted.kind !== 'ACCEPTED') return
    const recoveryId = randomUUID()
    const abandoned = store.abandonInvocation(
      expectation(accepted.invocation), recoveryId, 'direct abandonment', '2026-08-21T00:00:00.000Z',
    )
    assert.equal(abandoned.kind, 'ABANDONED')
    corruptAuthorityRows(dbPath, database => {
      database.prepare(
        `UPDATE main.governed_invocations
            SET state_revision = state_revision + 1,
                last_authority_epoch = last_authority_epoch + 1`,
      ).run()
      database.prepare(`UPDATE main.governed_targets SET authority_epoch = authority_epoch + 1`).run()
    })
    assert.equal(store.readGovernedCurrent('offline').kind, 'INVALID')
    store.close()
  })

  await t.test('semantic corruption poisons trusted readers across the same governance store', () => {
    const dbPath = sidecarPath('epoch-store-poison')
    const store = new GovernanceValidationSidecar(dbPath)
    const targetA = store.acceptInvocation('target-a')
    const targetB = store.acceptInvocation('target-b')
    assert.equal(targetA.kind, 'ACCEPTED')
    assert.equal(targetB.kind, 'ACCEPTED')
    if (targetA.kind !== 'ACCEPTED' || targetB.kind !== 'ACCEPTED') return
    assert.equal(complete(store, targetA.invocation, 'PASS').result.kind, 'COMPLETED')
    assert.equal(complete(store, targetB.invocation, 'PASS').result.kind, 'COMPLETED')
    corruptAuthorityRows(dbPath, database => {
      database.prepare(
        `UPDATE main.governed_targets SET authority_epoch = authority_epoch + 1 WHERE target_id = 'target-b'`,
      ).run()
    })
    assert.equal(store.readGovernedCurrent('target-a').kind, 'INVALID')
    assert.equal(store.readGovernedInvocation('target-a', targetA.invocation.invocationId).kind, 'INVALID')
    store.close()
  })
})

test('normal completion and recovery transitions advance revision and epoch exactly once', () => {
  const completionStore = new GovernanceValidationSidecar(sidecarPath('epoch-normal-completion'))
  const completionAccepted = completionStore.acceptInvocation('offline')
  assert.equal(completionAccepted.kind, 'ACCEPTED')
  if (completionAccepted.kind === 'ACCEPTED') {
    const completed = complete(completionStore, completionAccepted.invocation, 'PASS').result
    assert.equal(completed.kind, 'COMPLETED')
    if (completed.kind === 'COMPLETED') {
      assert.equal(completed.invocation.stateRevision, 1n)
      assert.equal(completed.invocation.lastAuthorityEpoch, completed.invocation.acceptedAuthorityEpoch + 1n)
    }
  }
  completionStore.close()

  const recoveryStore = new GovernanceValidationSidecar(sidecarPath('epoch-normal-recovery'))
  const recoveryAccepted = recoveryStore.acceptInvocation('offline')
  assert.equal(recoveryAccepted.kind, 'ACCEPTED')
  if (recoveryAccepted.kind === 'ACCEPTED') {
    const recoveryId = randomUUID()
    const recovery = recoveryStore.requireRecovery(
      expectation(recoveryAccepted.invocation), recoveryId, 'operator recovery',
    )
    assert.equal(recovery.kind, 'RECOVERY_REQUIRED')
    if (recovery.kind === 'RECOVERY_REQUIRED') {
      assert.equal(recovery.invocation.stateRevision, 1n)
      assert.equal(recovery.invocation.lastAuthorityEpoch, recovery.invocation.acceptedAuthorityEpoch + 1n)
      const abandoned = recoveryStore.abandonInvocation(
        expectation(recovery.invocation), recoveryId, 'operator recovery', '2026-08-21T00:00:00.000Z',
      )
      assert.equal(abandoned.kind, 'ABANDONED')
      if (abandoned.kind === 'ABANDONED') {
        assert.equal(abandoned.invocation.stateRevision, 2n)
        assert.equal(abandoned.invocation.lastAuthorityEpoch, abandoned.invocation.acceptedAuthorityEpoch + 2n)
      }
    }
  }
  recoveryStore.close()
})

test('schema and transition triggers reject skipped application epochs', () => {
  const activePath = sidecarPath('epoch-trigger-active')
  const activeStore = new GovernanceValidationSidecar(activePath)
  const active = activeStore.acceptInvocation('offline')
  assert.equal(active.kind, 'ACCEPTED')
  if (active.kind === 'ACCEPTED') {
    const database = rawDatabase(activePath)
    assert.throws(() => database.prepare(
      `UPDATE main.governed_invocations
          SET state = 'RECOVERY_REQUIRED', state_revision = 1,
              last_authority_epoch = 3, infrastructure_status = 'RECOVERY_REQUIRED',
              recovery_request_id = ?, recovery_reason = 'skip attack'
        WHERE invocation_id = ?`,
    ).run(randomUUID(), active.invocation.invocationId), /epoch|CHECK constraint/)
    database.close()
  }
  activeStore.close()

  const recoveryPath = sidecarPath('epoch-trigger-recovery')
  const recoveryStore = new GovernanceValidationSidecar(recoveryPath)
  const accepted = recoveryStore.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind === 'ACCEPTED') {
    const recovery = recoveryStore.requireRecovery(expectation(accepted.invocation), randomUUID(), 'operator recovery')
    assert.equal(recovery.kind, 'RECOVERY_REQUIRED')
    if (recovery.kind === 'RECOVERY_REQUIRED') {
      const database = rawDatabase(recoveryPath)
      assert.throws(() => database.prepare(
        `UPDATE main.governed_invocations
            SET state = 'ABANDONED', state_revision = 2,
                last_authority_epoch = 4, terminal_at = '2026-08-21T00:00:00.000Z',
                infrastructure_status = 'BLOCKED'
          WHERE invocation_id = ?`,
      ).run(recovery.invocation.invocationId), /epoch|CHECK constraint/)
      database.close()
    }
  }
  recoveryStore.close()
})

test('canonical bytes reject malformed JSON, aggregate mismatch, and noncanonical serialization', () => {
  assert.throws(() => decodeGovernedReportBytes(Buffer.from('{', 'utf8')), /valid JSON/)
  const mismatched = report('PASS')
  mismatched.overallStatus = 'FAIL'
  assert.throws(() => decodeGovernedReportBytes(Buffer.from(deterministicValidationReportJson(mismatched))), /overall status/)
  assert.throws(() => decodeGovernedReportBytes(Buffer.from(JSON.stringify(report('PASS')))), /deterministic canonical/)
  const wrongApplication = report('PASS') as ValidationReport & { referenceApplication: { name: string; baseUrl: string; smokeTests: string[] } }
  wrongApplication.referenceApplication.name = 'NotSauceDemo'
  assert.throws(() => decodeGovernedReportBytes(Buffer.from(deterministicValidationReportJson(wrongApplication as ValidationReport))), /reference-application/)
  const duplicate = report('PASS')
  duplicate.gates.push(structuredClone(duplicate.gates[0]))
  assert.throws(() => decodeGovernedReportBytes(Buffer.from(deterministicValidationReportJson(duplicate))), /duplicate gate/)
  const badFingerprint = report('PASS')
  badFingerprint.gates[0].fingerprint = 'not-a-sha'
  assert.throws(() => decodeGovernedReportBytes(Buffer.from(deterministicValidationReportJson(badFingerprint))), /fingerprint/)
})

test('counter precision is bigint and fabricated exhaustion cannot bypass contiguous authority', () => {
  const dbPath = sidecarPath('precision')
  const store = new GovernanceValidationSidecar(dbPath)
  const accepted = store.acceptInvocation('edge')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind !== 'ACCEPTED') return
  assert.equal(typeof accepted.invocation.sequence, 'bigint')
  assert.equal(typeof accepted.invocation.acceptedAuthorityEpoch, 'bigint')
  const db = rawDatabase(dbPath)
  assert.throws(() => db.prepare(
    `INSERT INTO main.governed_targets(target_id,next_sequence,authority_epoch) VALUES('overflow', ?, 0)`,
  ).run(GOVERNANCE_SIDECAR_LIMITS.maxAuthorityInteger + 1n), /counters must start|CHECK constraint/)
  db.close()
  corruptAuthorityRows(dbPath, database => {
    database.prepare(
      `UPDATE main.governed_targets SET next_sequence = ?, authority_epoch = ? WHERE target_id = 'edge'`,
    ).run(
      GOVERNANCE_SIDECAR_LIMITS.maxAuthorityInteger - 1n,
      GOVERNANCE_SIDECAR_LIMITS.maxAuthorityInteger - 2n,
    )
  })
  assert.equal(store.readGovernedCurrent('edge').kind, 'INVALID')
  assert.throws(() => store.acceptInvocation('edge'), /semantic authority epoch\/revision violations/)
  store.close()
  assert.throws(() => new GovernanceValidationSidecar(dbPath), /semantic authority epoch\/revision violations/)
})

test('initialization handles zero-byte, refuses corrupt/versioned stores, and converges concurrently', async t => {
  await t.test('zero-byte initializes', () => {
    const dbPath = sidecarPath('zero')
    fs.writeFileSync(dbPath, '')
    const store = new GovernanceValidationSidecar(dbPath)
    assert.equal(store.readGovernedCurrent('offline').kind, 'NONE')
    store.close()
  })
  await t.test('corrupt store refuses replacement', () => {
    const dbPath = sidecarPath('corrupt-open')
    fs.writeFileSync(dbPath, 'not sqlite', 'utf8')
    assert.throws(() => new GovernanceValidationSidecar(dbPath), /sidecar|database disk image|file is not a database/i)
    assert.equal(fs.readFileSync(dbPath, 'utf8'), 'not sqlite')
  })
  await t.test('unsupported schema version refuses implicit migration', () => {
    const dbPath = sidecarPath('version')
    const store = new GovernanceValidationSidecar(dbPath)
    store.close()
    const db = rawDatabase(dbPath)
    db.exec(`DROP TRIGGER governance_schema_no_update`)
    db.prepare(`UPDATE governance_schema SET version = 2`).run()
    db.close()
    assert.throws(() => new GovernanceValidationSidecar(dbPath), /newer than supported|schema definition fingerprint mismatch/)
  })
  await t.test('missing required trigger refuses partial schema', () => {
    const dbPath = sidecarPath('missing-trigger')
    const store = new GovernanceValidationSidecar(dbPath)
    store.close()
    const db = rawDatabase(dbPath)
    db.exec(`DROP TRIGGER authority_events_no_delete`)
    db.close()
    assert.throws(() => new GovernanceValidationSidecar(dbPath), /schema definition fingerprint mismatch/)
  })
  await t.test('concurrent first open produces one valid schema', async () => {
    const dbPath = sidecarPath('first-open')
    const release = path.join(BARRIER_ROOT, 'first-open.release')
    const [a, b] = await Promise.all([
      directChild({ GOV_DB: dbPath, GOV_MODE: 'accept', GOV_TARGET: 'a', GOV_INVOCATION: randomUUID(), GOV_RELEASE: release }),
      directChild({ GOV_DB: dbPath, GOV_MODE: 'accept', GOV_TARGET: 'b', GOV_INVOCATION: randomUUID(), GOV_RELEASE: release }),
      Promise.resolve().then(() => fs.writeFileSync(release, 'go', 'utf8')).then(() => ({ code: 0 })),
    ]).then(values => values.slice(0, 2) as [CompletedRun, CompletedRun])
    assert.equal(a.code, 0)
    assert.equal(b.code, 0)
    const store = new GovernanceValidationSidecar(dbPath)
    assert.equal(store.integrityCheck().integrity, 'ok')
    store.close()
  })
})

test('real SQLite busy timeout is unavailable infrastructure, not same-target mutation', async () => {
  const dbPath = sidecarPath('busy')
  const store = new GovernanceValidationSidecar(dbPath)
  store.close()
  const locker = rawDatabase(dbPath)
  locker.exec('BEGIN EXCLUSIVE')
  const unavailableRead = readGovernedCurrentFromSidecar(dbPath, 'offline')
  assert.equal(unavailableRead.kind, 'UNAVAILABLE')
  const result = await directChild({
    GOV_DB: dbPath,
    GOV_MODE: 'accept',
    GOV_TARGET: 'offline',
    GOV_INVOCATION: randomUUID(),
  })
  locker.exec('ROLLBACK')
  locker.close()
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /database is locked|SQLITE_BUSY/i)
  const verify = new GovernanceValidationSidecar(dbPath)
  assert.equal(verify.readGovernedCurrent('offline').kind, 'NONE')
  verify.close()
})

test('process death inside the real acceptance transaction rolls back all authority', async () => {
  const dbPath = sidecarPath('crash-acceptance-transaction')
  const store = new GovernanceValidationSidecar(dbPath)
  store.close()
  const childPromise = directChild({
    GOV_DB: dbPath,
    GOV_MODE: 'accept',
    GOV_DELAY_TRIGGER: 'acceptance',
    GOV_TARGET: 'offline',
    GOV_INVOCATION: randomUUID(),
  })
  await waitForFile(`${dbPath}-journal`)
  const child = [...activeChildren].find(value => value.spawnargs.includes(DIRECT_CHILD_PATH))
  assert.ok(child)
  child.kill()
  await childPromise
  const recovered = rawDatabase(dbPath)
  recovered.exec('DROP TRIGGER IF EXISTS certification_delay_acceptance')
  recovered.close()
  removeRecoveredCrashJournal(dbPath)
  const verify = new GovernanceValidationSidecar(dbPath)
  assert.equal(verify.readGovernedCurrent('offline').kind, 'NONE')
  verify.close()
})

test('process death inside completion or recovery transaction preserves prior ACTIVE authority', async t => {
  for (const mode of ['complete-existing', 'recover-existing'] as const) {
    await t.test(mode, async () => {
      const dbPath = sidecarPath(`crash-${mode}-transaction`)
      const store = new GovernanceValidationSidecar(dbPath)
      const accepted = store.acceptInvocation('offline')
      assert.equal(accepted.kind, 'ACCEPTED')
      if (accepted.kind !== 'ACCEPTED') return
      store.close()
      const childPromise = directChild({
        GOV_DB: dbPath,
        GOV_MODE: mode,
        GOV_DELAY_TRIGGER: 'transition',
        GOV_TARGET: 'offline',
        GOV_INVOCATION: accepted.invocation.invocationId,
        GOV_SEQUENCE: accepted.invocation.sequence.toString(),
        GOV_REVISION: accepted.invocation.stateRevision.toString(),
        GOV_EPOCH: accepted.invocation.lastAuthorityEpoch.toString(),
        GOV_REPORT: JSON.stringify(report('PASS')),
        GOV_RECOVERY_ID: randomUUID(),
      })
      await waitForFile(`${dbPath}-journal`)
      const child = [...activeChildren].find(value => value.spawnargs.includes(DIRECT_CHILD_PATH))
      assert.ok(child)
      child.kill()
      await childPromise
      const recovered = rawDatabase(dbPath)
      recovered.exec('DROP TRIGGER IF EXISTS certification_delay_transition')
      recovered.close()
      removeRecoveredCrashJournal(dbPath)
      const verify = new GovernanceValidationSidecar(dbPath)
      assert.equal(verify.readGovernedCurrent('offline').kind, 'INCOMPLETE')
      verify.close()
    })
  }
})

test('crash after acceptance remains INCOMPLETE and stale writer is recoverable only by identity', async () => {
  const dbPath = sidecarPath('crash-active')
  const started = path.join(BARRIER_ROOT, 'crash-active.started')
  const holdRelease = path.join(BARRIER_ROOT, 'crash-active.hold')
  const invocationId = randomUUID()
  const childPromise = directChild({
    GOV_DB: dbPath,
    GOV_MODE: 'accept-and-hold',
    GOV_TARGET: 'offline',
    GOV_INVOCATION: invocationId,
    GOV_STARTED: started,
    GOV_HOLD_RELEASE: holdRelease,
  })
  await waitForFile(started)
  const child = [...activeChildren].find(value => value.spawnargs.includes(DIRECT_CHILD_PATH))
  assert.ok(child)
  child.kill()
  await childPromise
  const store = new GovernanceValidationSidecar(dbPath)
  const current = store.readGovernedCurrent('offline')
  assert.equal(current.kind, 'INCOMPLETE')
  if (current.kind === 'INCOMPLETE') {
    assert.equal(current.invocationId, invocationId)
    const row = JSON.parse(fs.readFileSync(started, 'utf8')) as { invocation: { sequence: string; stateRevision: string; lastAuthorityEpoch: string } }
    const recovery = store.abandonInvocation({
      targetId: 'offline', invocationId,
      sequence: BigInt(row.invocation.sequence),
      stateRevision: BigInt(row.invocation.stateRevision),
      authorityEpoch: BigInt(row.invocation.lastAuthorityEpoch),
    }, randomUUID(), 'operator-confirmed child termination')
    assert.equal(recovery.kind, 'ABANDONED')
  }
  store.close()
})

test('crash after completion commit preserves exact current completed authority', async () => {
  const dbPath = sidecarPath('crash-completed')
  const started = path.join(BARRIER_ROOT, 'crash-completed.started')
  const holdRelease = path.join(BARRIER_ROOT, 'crash-completed.hold')
  const invocationId = randomUUID()
  const childPromise = directChild({
    GOV_DB: dbPath,
    GOV_MODE: 'complete-and-hold',
    GOV_TARGET: 'offline',
    GOV_INVOCATION: invocationId,
    GOV_REPORT: JSON.stringify(report('PASS')),
    GOV_STARTED: started,
    GOV_HOLD_RELEASE: holdRelease,
  })
  await waitForFile(started)
  const child = [...activeChildren].find(value => value.spawnargs.includes(DIRECT_CHILD_PATH))
  assert.ok(child)
  child.kill()
  await childPromise
  const current = readGovernedCurrentFromSidecar(dbPath, 'offline')
  assert.equal(current.kind, 'CURRENT_COMPLETED')
  if (current.kind === 'CURRENT_COMPLETED') {
    assert.equal(current.invocationId, invocationId)
    assert.equal(current.report.overallStatus, 'PASS')
  }
})

test('crash after recovery commit preserves RECOVERY_REQUIRED and blocks a new writer', async () => {
  const dbPath = sidecarPath('crash-recovery')
  const started = path.join(BARRIER_ROOT, 'crash-recovery.started')
  const holdRelease = path.join(BARRIER_ROOT, 'crash-recovery.hold')
  const invocationId = randomUUID()
  const childPromise = directChild({
    GOV_DB: dbPath,
    GOV_MODE: 'recover-and-hold',
    GOV_TARGET: 'offline',
    GOV_INVOCATION: invocationId,
    GOV_RECOVERY_ID: randomUUID(),
    GOV_STARTED: started,
    GOV_HOLD_RELEASE: holdRelease,
  })
  await waitForFile(started)
  const child = [...activeChildren].find(value => value.spawnargs.includes(DIRECT_CHILD_PATH))
  assert.ok(child)
  child.kill()
  await childPromise
  const store = new GovernanceValidationSidecar(dbPath)
  assert.equal(store.readGovernedCurrent('offline').kind, 'RECOVERY_REQUIRED')
  const next = store.acceptInvocation('offline')
  assert.equal(next.kind, 'CONFLICT')
  if (next.kind === 'CONFLICT') assert.equal(next.state, 'RECOVERY_REQUIRED')
  store.close()
})

test('canonical path reader returns tagged NONE, current, and fail-closed corrupt-store states', () => {
  const missing = sidecarPath('reader-missing')
  assert.deepEqual(readGovernedCurrentFromSidecar(missing, 'offline'), { kind: 'NONE', targetId: 'offline' })
  assert.equal(fs.existsSync(missing), false)

  const currentPath = sidecarPath('reader-current')
  const store = new GovernanceValidationSidecar(currentPath)
  const accepted = store.acceptInvocation('offline')
  assert.equal(accepted.kind, 'ACCEPTED')
  if (accepted.kind === 'ACCEPTED') complete(store, accepted.invocation, 'FAIL')
  store.close()
  const current = readGovernedCurrentFromSidecar(currentPath, 'offline')
  assert.equal(current.kind, 'CURRENT_COMPLETED')
  if (current.kind === 'CURRENT_COMPLETED') assert.equal(current.report.overallStatus, 'FAIL')

  const corruptPath = sidecarPath('reader-corrupt')
  fs.writeFileSync(corruptPath, 'not sqlite', 'utf8')
  const corrupt = readGovernedCurrentFromSidecar(corruptPath, 'offline')
  assert.equal(corrupt.kind, 'INVALID')
  assert.equal(fs.readFileSync(corruptPath, 'utf8'), 'not sqlite')

  const unavailable = readGovernedCurrentFromSidecar(TEST_ROOT, 'offline')
  assert.equal(unavailable.kind, 'UNAVAILABLE')
})

test('non-authoritative export and reference snapshot cannot substitute governed current authority', async () => {
  const baselineReference = path.join(TEST_ROOT, 'accepted-reference.json')
  fs.writeFileSync(baselineReference, deterministicValidationReportJson(report('FAIL')), 'utf8')
  const state = launchRun({
    label: 'separation', targetId: 'separation', childExitCode: 1,
    baselineReference, waitAtFirstCommand: true,
  })
  await state.started
  state.release()
  const result = await state.completed
  assert.equal(result.code, 1)
  assert.equal(fs.existsSync(state.exportPath), true)
  const store = new GovernanceValidationSidecar(SHARED_SIDECAR)
  const before = store.readGovernedCurrent(state.targetId)
  assert.equal(before.kind, 'CURRENT_COMPLETED')
  fs.writeFileSync(state.exportPath, deterministicValidationReportJson(report('PASS')), 'utf8')
  const after = store.readGovernedCurrent(state.targetId)
  assert.deepEqual(after, before)
  store.close()
})

test('non-authoritative export failure is signalled but cannot rewrite governed PASS authority', async () => {
  const state = launchRun({
    label: 'export-failure', targetId: 'export-failure', childExitCode: 0,
    failExport: true,
  })
  await state.started
  state.release()
  const result = await state.completed
  assert.equal(result.code, 2)
  assert.match(result.stderr, /non-authoritative report export/)
  assert.equal(fs.existsSync(state.exportPath), false)
  const store = new GovernanceValidationSidecar(SHARED_SIDECAR)
  const current = store.readGovernedCurrent(state.targetId)
  assert.equal(current.kind, 'CURRENT_COMPLETED')
  if (current.kind === 'CURRENT_COMPLETED') {
    assert.equal(current.report.overallStatus, 'PASS')
    assert.equal(current.report.gates.some(gate => gate.id === 'governance.report-persistence'), false)
  }
  store.close()
  const exportTemps = fs.readdirSync(path.dirname(state.exportPath))
    .filter(name => name.startsWith(`.${path.basename(state.exportPath)}.`) && name.endsWith('.tmp'))
  assert.deepEqual(exportTemps, [])
})

test('production governance authority is fixed-path and isolated from Product persistence', async () => {
  const sidecarSource = fs.readFileSync(path.join(__dirname, 'governance-validation-sidecar.ts'), 'utf8')
  const internalSource = fs.readFileSync(path.join(__dirname, 'governance-validation-sidecar-internal.ts'), 'utf8')
  const testSupportSource = fs.readFileSync(path.join(__dirname, 'governance-validation-sidecar.test-support.ts'), 'utf8')
  const runnerSource = fs.readFileSync(path.join(__dirname, 'forge-validation-baseline.ts'), 'utf8')
  const sidecarModule = await import('./governance-validation-sidecar')
  for (const source of [sidecarSource, internalSource, testSupportSource]) {
    assert.doesNotMatch(source, /getDb\(|getProductDb|resolveSqlitePath|node-sqlite3-wasm|kysely|\/storage\/migrations/)
  }
  const applicationSql = internalSource.slice(internalSource.indexOf('class GovernanceValidationSidecar'))
  assert.doesNotMatch(
    applicationSql,
    /\b(?:FROM|INTO|UPDATE|JOIN|DELETE FROM)\s+(?:governance_schema|governed_targets|governed_invocations|authority_events)\b/i,
  )
  assert.doesNotMatch(runnerSource, /governance-validation-sidecar-(?:internal|test-support)/)
  assert.doesNotMatch(runnerSource, /GovernanceValidationSidecar\([^)]*databasePath/)
  assert.doesNotMatch(runnerSource, /FORGE_GOVERNANCE_TEST|GOVERNANCE_TEST_SIDECAR/)
  assert.equal(productionGovernanceSidecarPath(), path.join(REPOSITORY_ROOT, '.forge', 'governance.db'))
  assert.notEqual(productionGovernanceSidecarPath(), path.join(REPOSITORY_ROOT, '.forge', 'forge.db'))
  assert.equal(productionGovernanceSidecarPath.length, 0)
  assert.equal('GovernanceValidationSidecar' in sidecarModule, false)
  assert.equal(sidecarModule.openProductionGovernanceSidecar.length, 0)
  assert.equal(sidecarModule.readGovernedCurrent.length, 1)
  assert.throws(
    () => new GovernanceValidationSidecar(path.join(REPOSITORY_ROOT, '.forge', 'attacker-selected.db')),
    /test sidecars must be .*inside the operating-system temporary directory/,
  )
})

test('public run API remains sealed against injected executor/report/root authority', async () => {
  const module = await import('./forge-validation-baseline')
  assert.equal(module.run.length, 1)
  assert.equal('createValidationInvocationContext' in module, false)
  assert.equal('persistReport' in module, false)
  assert.equal('loadBaseline' in module, false)
  assert.equal('acquireInvocationAuthority' in module, false)
})

test('task-owned transient residue is absent after successful closed invocations', () => {
  const invocationResidue = fs.readdirSync(os.tmpdir())
    .filter(name => name.startsWith('forge-governed-baseline-'))
    .filter(name => {
      const candidate = path.join(os.tmpdir(), name)
      return fs.existsSync(candidate)
        && fs.statSync(candidate).isDirectory()
        && fs.existsSync(path.join(candidate, 'owned-marker.json'))
    })
  assert.deepEqual(invocationResidue, [])
  const rollbackResidue = fs.readdirSync(TEST_ROOT)
    .filter(name => !name.startsWith('clean-forge.db'))
    .filter(name => name.endsWith('-journal') || name.endsWith('-wal') || name.endsWith('-shm'))
  assert.deepEqual(rollbackResidue, [])
})
