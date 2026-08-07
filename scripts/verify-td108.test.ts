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
 * TD-108 — proof tests (Workspace, ModuleAssignment/ModuleClassifier,
 * ConfigAdapter, WorkspaceMemoryRepository, CrawlRunner defaults).
 *
 * node:test + node:assert/strict under tsx (auto-covered by `npm run test:unit`,
 * the scripts/*.test.ts glob). Workspace tests use throwaway os.tmpdir()
 * directories, removed in finally blocks — no repo pollution, no browser, no HTTP.
 *
 * NOTE on type-level tests (T5/T10): scripts/ is NOT under the check:core
 * tsconfig (TD-104), so @ts-expect-error is not enforced here. The POSITIVE
 * constructions below prove the types accept correct values; the NEGATIVE
 * proofs (method: 'invented' rejected, schemaVersion: 2 rejected) are
 * demonstrated by targeted tsc probes in the Step-7 report — same pattern as
 * TD-093 Phase 2.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { WorkspaceManager, createWorkspace } from '../src/core/workspace/WorkspaceManager'
import { AppConfig } from '../src/core/workspace/AppConfig'
import { WorkspaceMemoryRepository } from '../src/core/workspace/WorkspaceMemoryRepository'
import { toOnboardingConfig, fromOnboardingConfig, roleIdFromEnvKey } from '../src/core/workspace/ConfigAdapter'
import { ModuleClassifier } from '../src/core/crawler/ModuleClassifier'
import { AgentMemoryRepository } from '../src/core/agent/AgentMemoryRepository'
import { AgentMemory } from '../src/core/agent/types'
import { ModuleAssignment, PageDefinition } from '../src/core/onboarding/types'

// ── helpers ───────────────────────────────────────────────────────────────────

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'td108-ws-'))
}

function validConfig(): AppConfig {
  return {
    schemaVersion: 1, appName: 'saucedemo', url: 'https://www.saucedemo.com',
    appType: 'web-ui', crawlStrategy: 'spa', authType: 'form-login',
    credentials: { envKey: 'STANDARD_USER_CREDENTIALS' },
    budgets: { maxDepth: 3, maxPages: 30 },
  }
}

/** Minimal PageDefinition for classifier tests — only id/urlPattern are read. */
function page(id: string, urlPattern: string): PageDefinition {
  return {
    id, urlPattern, displayName: id, urlPatternType: 'exact',
    fingerprint: 'f', fingerprintBasis: 'url-only', appType: 'web-ui',
    accessibleByRoles: [], isAuthPage: false, elements: [],
  }
}

// ── T1-T4: WorkspaceManager ───────────────────────────────────────────────────

test('T1 loadConfig() returns null when .forge/ missing (auto-bootstrap trigger, not an error)', async () => {
  const root = tempRoot()
  try {
    const ws = createWorkspace(root)
    assert.equal(await ws.loadConfig(), null)
    // A pure read must not auto-create directories.
    assert.equal(fs.existsSync(ws.forgeDir), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('T2 saveConfig() writes schemaVersion:1 to .forge/config.json; loadConfig round-trips', async () => {
  const root = tempRoot()
  try {
    const ws = createWorkspace(root)
    await ws.saveConfig(validConfig())
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.forge', 'config.json'), 'utf-8'))
    assert.equal(onDisk.schemaVersion, 1)
    assert.deepEqual(await ws.loadConfig(), validConfig())
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('T3 loadConfig() throws on wrong schemaVersion (never silently regenerates)', async () => {
  const root = tempRoot()
  try {
    fs.mkdirSync(path.join(root, '.forge'), { recursive: true })
    fs.writeFileSync(path.join(root, '.forge', 'config.json'),
      JSON.stringify({ ...validConfig(), schemaVersion: 2 }), 'utf-8')
    await assert.rejects(() => createWorkspace(root).loadConfig(), /schemaVersion/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('T3b loadConfig() throws on unparseable JSON (corrupt config is loud, not null)', async () => {
  const root = tempRoot()
  try {
    fs.mkdirSync(path.join(root, '.forge'), { recursive: true })
    fs.writeFileSync(path.join(root, '.forge', 'config.json'), '{not json', 'utf-8')
    await assert.rejects(() => createWorkspace(root).loadConfig(), /not valid JSON/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('T4 workspace paths are runtime-derived from root (no hardcoded absolutes — TD-097)', () => {
  const rootA = tempRoot(), rootB = tempRoot()
  try {
    const a = new WorkspaceManager(rootA)
    const b = new WorkspaceManager(rootB)
    assert.equal(a.forgeDir,   path.join(rootA, '.forge'))
    assert.equal(a.testsDir,   path.join(rootA, 'tests'))
    assert.equal(a.reportsDir, path.join(rootA, 'reports'))
    assert.notEqual(a.forgeDir, b.forgeDir)   // derived, not shared constants
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true })
    fs.rmSync(rootB, { recursive: true, force: true })
  }
})

test('T4b path-traversal segments are rejected loudly (workspace cannot be escaped)', async () => {
  const root = tempRoot()
  try {
    const ws = createWorkspace(root)
    await assert.rejects(() => ws.writeTests('../escape', 'x.spec.ts', ''), /Invalid module/)
    await assert.rejects(() => ws.saveReport('run1', '..\\up', {}), /Invalid report name/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

// ── T5: ModuleAssignment type (positive half — negatives are tsc probes) ─────

test('T5 ModuleAssignment accepts every legal method value', () => {
  const methods: Array<ModuleAssignment['method']> = ['rule', 'ai', 'manual', 'unknown']
  for (const method of methods) {
    const a: ModuleAssignment = { name: 'X', confidence: 'low', method, evidenceIds: [] }
    assert.equal(a.method, method)
  }
})

// ── T6-T8: ModuleClassifier ───────────────────────────────────────────────────

test('T6 Login confidence is DERIVED by keyword quantity — /login MEDIUM (1 token), /auth/login HIGH (2 tokens) (ADR-020)', () => {
  const c = new ModuleClassifier()
  // Single unambiguous keyword token → 'medium' (was hardcoded 'high'; a single token no
  // longer buys high, and keyword semantic strength is not measured).
  const single = c.classify(page('p-login', '/login'))
  assert.equal(single.name, 'Login')
  assert.equal(single.confidence, 'medium')
  assert.equal(single.source, 'evidence-matched')
  assert.match(single.reason ?? '', /single/i)
  // Two corroborating keyword tokens ('auth' + 'login') → 'high' (real OrangeHRM shape).
  const multi = c.classify(page('p-login', '/web/index.php/auth/login'))
  assert.equal(multi.name, 'Login')
  assert.equal(multi.confidence, 'high')
  assert.match(multi.reason ?? '', /2 corroborating/i)
  // The brief's requirement: a weak single match and a strong multi-match must NOT be identical.
  assert.notEqual(single.confidence, multi.confidence)
})

test('T7 /cart URL → Cart, derived MEDIUM (single keyword token), rule (real SauceDemo shape)', () => {
  const c = new ModuleClassifier()
  for (const url of ['/cart', '/cart.html']) {
    const a = c.classify(page('p-cart', url))
    assert.equal(a.name, 'Cart')
    assert.equal(a.confidence, 'medium')          // single 'cart' token → medium (was hardcoded 'high')
    assert.equal(a.source, 'evidence-matched')
    assert.equal(a.method, 'rule')
    assert.deepEqual(a.evidenceIds, ['p-cart'])
  }
})

test('T8 unmatched URL → confidence:unknown, method:unknown, no evidence claimed', () => {
  const c = new ModuleClassifier()
  for (const url of ['/xyz', '/web/index.php/pim/viewPimModule']) {
    const a = c.classify(page('p-x', url))
    assert.deepEqual(a, { name: '', confidence: 'unknown', method: 'unknown', evidenceIds: [] })
  }
})

// ── T9: default workspace root ────────────────────────────────────────────────

test('T9 createWorkspace() with no root defaults to process.cwd() (CrawlRunner\'s default)', () => {
  // CrawlRunner.run() step 1 is `options.workspace ?? createWorkspace()` —
  // this factory IS its default; a live run() needs a URL + browser, so the
  // default is proven at the factory it delegates to.
  const ws = createWorkspace()
  assert.equal(ws.root, path.resolve(process.cwd()))
})

// ── T10: AppConfig schema literal (positive half — negative is a tsc probe) ──

test('T10 AppConfig accepts schemaVersion:1 (the only legal version)', () => {
  const config: AppConfig = validConfig()
  assert.equal(config.schemaVersion, 1)
})

// ── T11: ConfigAdapter ────────────────────────────────────────────────────────

test('T11 toOnboardingConfig preserves url + appName; round-trip is stable', () => {
  const app = validConfig()
  const onboarding = toOnboardingConfig(app)
  assert.equal(onboarding.app.name, 'saucedemo')
  assert.equal(onboarding.app.baseUrl, 'https://www.saucedemo.com')
  assert.equal(onboarding.roles[0].id, 'standardUser')          // envKey → role id inverse
  assert.equal(onboarding.budgets?.maxDepth, 3)
  assert.deepEqual(fromOnboardingConfig(onboarding), app)       // round-trip stable
})

test('T11b toOnboardingConfig throws on invalid union values (never coerces)', () => {
  assert.throws(() => toOnboardingConfig({ ...validConfig(), appType: 'banana' }), /Invalid appType/)
  assert.throws(() => toOnboardingConfig({ ...validConfig(), crawlStrategy: 'dfs' }), /Invalid crawlStrategy/)
  assert.throws(() => toOnboardingConfig({ ...validConfig(), authType: 'magic' }), /Invalid authType/)
})

test('T11c roleIdFromEnvKey is the exact inverse of the envKey convention', () => {
  assert.equal(roleIdFromEnvKey('ADMIN_CREDENTIALS'), 'admin')
  assert.equal(roleIdFromEnvKey('STANDARD_USER_CREDENTIALS'), 'standardUser')
  assert.equal(roleIdFromEnvKey('LOCKED_USER_CREDENTIALS'), 'lockedUser')
})

// ── T12: WorkspaceMemoryRepository ────────────────────────────────────────────

test('T12 WorkspaceMemoryRepository implements AgentMemoryRepository; save/load round-trips via .forge/', async () => {
  const root = tempRoot()
  try {
    const ws = createWorkspace(root)
    const repo: AgentMemoryRepository = new WorkspaceMemoryRepository(ws)   // structural check (compiles)
    const memory: AgentMemory = {
      appId: 'saucedemo', goals: [], evidence: [],
      discoveredCapabilities: [], lastUpdated: new Date().toISOString(), crawlRunCount: 1,
    }
    await repo.save(memory)
    assert.equal(fs.existsSync(path.join(root, '.forge', 'agent-memory.json')), true)
    assert.deepEqual(await repo.load('saucedemo'), memory)
    // Single-app-workspace safeguard: a different appId gets null, never app A's memory.
    assert.equal(await repo.load('otherapp'), null)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
