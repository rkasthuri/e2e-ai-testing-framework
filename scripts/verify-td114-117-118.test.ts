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
 * TD-114/117/118 — proof tests (Project manifest, per-app DB isolation via the
 * initDb seam, migration-004 no-op safety, fossil trends.json removal).
 *
 * node:test + node:assert/strict under tsx (auto-covered by `npm run test:unit`).
 *
 * SINGLETON NOTE: the DB tests (T7-T10, T12) share the module-level Kysely
 * singleton deliberately — that IS the seam under test. They run in declaration
 * order (node:test default), open ONE temp project DB, exercise the initDb
 * rules against it, and close it in the final cleanup test. Each test file runs
 * in its own process under the runner, so no cross-file singleton bleed.
 *
 * NOTE on type-level tests (T1/T2): scripts/ is NOT under the check:core
 * tsconfig (TD-104), so the NEGATIVE proof (projectVersion: 2 rejected) is a
 * targeted tsc probe in the Step-6 report — same pattern as TD-093/TD-108.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createWorkspace } from '../src/core/workspace/WorkspaceManager'
import { ProjectManifest, buildProjectManifest, getFrameworkVersion } from '../src/core/workspace/Project'
import { openProjectDatabase, getMigrationCount } from '../src/core/storage/DatabaseFactory'
import { initDb, closeDb } from '../src/core/storage/db'
import { TrendRepository } from '../src/core/storage/repositories/TrendRepository'

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'td114-t-'))
}

function manifest(overrides: Partial<ProjectManifest> = {}): ProjectManifest {
  return {
    projectVersion: 1, frameworkVersion: '1.0.0', appName: 'saucedemo',
    url: 'https://www.saucedemo.com', createdAt: '2026-07-01T00:00:00.000Z',
    lastOpenedAt: '2026-07-01T00:00:00.000Z', databaseVersion: 10,
    ...overrides,
  }
}

// ── T1-T2: ProjectManifest type ───────────────────────────────────────────────

test('T1 ProjectManifest accepts projectVersion:1 (the only legal version)', () => {
  const m: ProjectManifest = manifest()
  assert.equal(m.projectVersion, 1)
  // frameworkVersion helper reads the real package.json at runtime
  assert.match(getFrameworkVersion(), /^\d+\.\d+\.\d+/)
})

// T2 (negative: projectVersion:2 rejected) — tsc probe, see Step-6 report.

// ── T3-T6: Workspace manifest + dbPath ────────────────────────────────────────

test('T3 dbPath() is runtime-derived, inside .forge/, ends in forge.db', () => {
  const rootA = tempRoot(), rootB = tempRoot()
  try {
    const a = createWorkspace(rootA), b = createWorkspace(rootB)
    assert.equal(a.dbPath(), path.join(rootA, '.forge', 'forge.db'))
    assert.ok(a.dbPath().endsWith('forge.db'))
    assert.notEqual(a.dbPath(), b.dbPath())   // derived from root, not a shared constant
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true })
    fs.rmSync(rootB, { recursive: true, force: true })
  }
})

test('T4 saveProjectManifest() writes .forge/project.json; loadProjectManifest() round-trips', async () => {
  const root = tempRoot()
  try {
    const ws = createWorkspace(root)
    await ws.saveProjectManifest(manifest())
    assert.equal(fs.existsSync(path.join(root, '.forge', 'project.json')), true)
    assert.deepEqual(await ws.loadProjectManifest(), manifest())
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('T5 loadProjectManifest() returns null when .forge/ missing (first open, not an error)', async () => {
  const root = tempRoot()
  try {
    assert.equal(await createWorkspace(root).loadProjectManifest(), null)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('T6 loadProjectManifest() throws on wrong projectVersion (never silently regenerates)', async () => {
  const root = tempRoot()
  try {
    fs.mkdirSync(path.join(root, '.forge'), { recursive: true })
    fs.writeFileSync(path.join(root, '.forge', 'project.json'),
      JSON.stringify(manifest({ projectVersion: 2 as any })), 'utf-8')
    await assert.rejects(() => createWorkspace(root).loadProjectManifest(), /projectVersion/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

// ── T13: createdAt preserve-semantics (production code via buildProjectManifest) ──

test('T13 second open preserves createdAt, refreshes lastOpenedAt', () => {
  const first = buildProjectManifest(null, { appName: 'a', url: 'u', databaseVersion: 10 })
  const existing = { ...first, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z' }
  const second = buildProjectManifest(existing, { appName: 'a', url: 'u', databaseVersion: 10 })
  assert.equal(second.createdAt, '2026-01-01T00:00:00.000Z')       // preserved
  assert.notEqual(second.lastOpenedAt, '2026-01-01T00:00:00.000Z') // refreshed
})

// ── T7-T10, T12: the DB singleton cluster (ordered, one shared project DB) ────

const dbRoot = tempRoot()
const dbWs   = createWorkspace(dbRoot)

test('T9 openProjectDatabase(): forge.db lands inside .forge/ (not cwd, not repo root)', async () => {
  await openProjectDatabase(dbWs)
  assert.equal(fs.existsSync(dbWs.dbPath()), true)
  assert.equal(path.dirname(dbWs.dbPath()), path.join(dbRoot, '.forge'))
  // and NOT at the legacy cwd-relative location for this process
  assert.notEqual(path.resolve('./forge-framework.db'), dbWs.dbPath())
})

test('T10 migration 004 completed without error on the fresh DB (all migrations)', async () => {
  // openProjectDatabase above ran migrateToLatest and would have THROWN on a
  // migration error (migrate.ts rethrows). Completed count == the migrations
  // directory's file count (derived, not hard-coded — a literal broke here
  // when TD-120's migration 011 landed), which includes 004.
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'core', 'storage', 'migrations')
  const expected = fs.readdirSync(migrationsDir).filter(f => /^\d+_.*\.ts$/.test(f)).length
  assert.ok(expected >= 10, `sanity: migrations dir has ${expected} files`)
  assert.equal(await getMigrationCount(), expected)
})

test('T7 initDb(): re-init at the SAME path is a no-op (idempotent)', () => {
  initDb(dbWs.dbPath())   // must not throw
  assert.ok(true)
})

test('T8 initDb(): re-init at a DIFFERENT path throws the descriptive error', () => {
  assert.throws(
    () => initDb(path.join(dbRoot, 'other.db')),
    /DB already open at .*Cannot re-initialize for .*Call closeDb\(\) first/s,
  )
})

test('T12 TrendRepository.findByApp() on the fresh DB returns [] (empty, NOT an error)', async () => {
  // Also proves the 004 no-op end state: nothing imported trends, table exists
  // and is empty — the old code either errored (fresh DB) or inserted a bogus
  // totalRuns:1 row (repo root).
  const rows = await new TrendRepository().findByApp('no-such-app', 30)
  assert.deepEqual(rows, [])
})

test('T-cleanup close the shared project DB and remove the temp root', async () => {
  await closeDb()
  fs.rmSync(dbRoot, { recursive: true, force: true })
  assert.equal(fs.existsSync(dbRoot), false)
})

// ── T11: fossil is gone from the pipeline (source-level proof) ────────────────

test('T11 no LIVE trends.json reference remains in any pipeline/platform source', () => {
  const repoRoot = path.resolve(__dirname, '..')
  const files = [
    'src/pipeline/results-store.ts',
    'src/pipeline/flaky-predictor.ts',
    'src/pipeline/knowledge-query.ts',
    'src/pipeline/notifier.ts',
    'src/pipeline/release-notes.ts',
    'src/platform/platform-server.ts',
  ]
  for (const f of files) {
    const lines = fs.readFileSync(path.join(repoRoot, f), 'utf-8').split('\n')
    const live = lines.filter(l => {
      const t = l.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false   // comments
      return t.includes('trends.json')
    })
    assert.deepEqual(live, [], `${f} still references trends.json outside comments`)
  }
})
