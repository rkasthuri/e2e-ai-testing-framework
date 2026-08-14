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
 * ADR-013 Credential Resolution Policy — proof tests (Phase 2).
 *
 * node:test + node:assert/strict under tsx. CredentialStore is isolated via an
 * injected baseDir (temp), so ~/.forge-projects is never touched. The resolver's
 * authType read is injected (fake), so no engine config.json is required and the
 * engine is never loaded.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { CredentialStore } from '../forge-ui/server/context/credentials/CredentialStore'
import { EnvCredentialResolver } from '../forge-ui/server/context/credentials/CredentialResolver'
import { planCrawlCredentials } from '../forge-ui/server/context/credentials/CredentialPlanner'
import { CredentialError, CredentialSlotError } from '../forge-ui/server/context/credentials/CredentialTypes'

const tmpBase = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cred-'))
/** Empty-sidecar store → resolver falls back to default-derived reference names. */
const emptyStore = (): CredentialStore => new CredentialStore(tmpBase())

function clearEnv(...keys: string[]): void {
  for (const k of keys) delete process.env[k]
}

// ── CredentialStore ───────────────────────────────────────────────────────────

test('S1 defaultReference derives <APP>_USERNAME/<APP>_PASSWORD (hyphens → _)', () => {
  assert.deepEqual(CredentialStore.defaultReference('saucedemo'),
    { usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD' })
  assert.deepEqual(CredentialStore.defaultReference('restful-booker'),
    { usernameEnv: 'RESTFUL_BOOKER_USERNAME', passwordEnv: 'RESTFUL_BOOKER_PASSWORD' })
})

test('S2 write → read round-trips the reference', () => {
  const store = new CredentialStore(tmpBase())
  store.write('saucedemo', { usernameEnv: 'X_USER', passwordEnv: 'X_PASS' })
  assert.deepEqual(store.read('saucedemo'), { usernameEnv: 'X_USER', passwordEnv: 'X_PASS' })
})

test('S3 read → null for missing / malformed sidecar', () => {
  const base = tmpBase()
  const store = new CredentialStore(base)
  assert.equal(store.read('nope'), null)                       // missing
  const p = path.join(base, '.forge-projects', 'bad', '.forge', 'credentials.json')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, '{ not json')
  assert.equal(store.read('bad'), null)                        // malformed
})

test('S4 sidecar stores ONLY pointer names + schemaVersion (never secrets)', () => {
  const base = tmpBase()
  new CredentialStore(base).write('saucedemo',
    { usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD' })
  const parsed = JSON.parse(fs.readFileSync(
    path.join(base, '.forge-projects', 'saucedemo', '.forge', 'credentials.json'), 'utf-8'))
  assert.deepEqual(Object.keys(parsed).sort(), ['passwordEnv', 'schemaVersion', 'usernameEnv'])
  assert.equal(parsed.usernameEnv, 'SAUCEDEMO_USERNAME')
  assert.equal(parsed.schemaVersion, 1)
})

// ── EnvCredentialResolver ─────────────────────────────────────────────────────

test('R1 resolves only the default-derived reference when material is available', () => {
  process.env.SAUCEDEMO_USERNAME = 'standard_user'
  process.env.SAUCEDEMO_PASSWORD = 'secret_sauce'
  const r = new EnvCredentialResolver(emptyStore(), () => 'form-login')
  assert.deepEqual(r.resolve('saucedemo'), {
    usernameEnv: 'SAUCEDEMO_USERNAME', passwordEnv: 'SAUCEDEMO_PASSWORD',
  })
  clearEnv('SAUCEDEMO_USERNAME', 'SAUCEDEMO_PASSWORD')
})

test('R2 hard-fails with CredentialError when auth required + creds unset', () => {
  clearEnv('SAUCEDEMO_USERNAME', 'SAUCEDEMO_PASSWORD')
  const r = new EnvCredentialResolver(emptyStore(), () => 'form-login')
  assert.throws(() => r.resolve('saucedemo'), (e: unknown) => {
    assert.ok(e instanceof CredentialError)
    const ce = e as CredentialError
    assert.equal(ce.appName, 'saucedemo')
    assert.match(ce.message, /requires authentication/)
    assert.doesNotMatch(ce.message, /SAUCEDEMO_USERNAME|SAUCEDEMO_PASSWORD/)
    return true
  })
})

test('R3 guest app (authType none) → null, no throw, creds unset', () => {
  clearEnv('PUBLIC_USERNAME', 'PUBLIC_PASSWORD')
  const r = new EnvCredentialResolver(emptyStore(), () => 'none')
  assert.equal(r.resolve('public'), null)
})

test('R4 custom sidecar reference overrides the default names', () => {
  const store = new CredentialStore(tmpBase())
  store.write('saucedemo', { usernameEnv: 'CUSTOM_U', passwordEnv: 'CUSTOM_P' })
  process.env.CUSTOM_U = 'u'; process.env.CUSTOM_P = 'p'
  const r = new EnvCredentialResolver(store, () => 'form-login')
  assert.deepEqual(r.resolve('saucedemo'), { usernameEnv: 'CUSTOM_U', passwordEnv: 'CUSTOM_P' })
  clearEnv('CUSTOM_U', 'CUSTOM_P')
})

test('R5 partial creds (username only) still hard-fails when auth required', () => {
  process.env.SAUCEDEMO_USERNAME = 'u'
  clearEnv('SAUCEDEMO_PASSWORD')
  const r = new EnvCredentialResolver(emptyStore(), () => 'form-login')
  assert.throws(() => r.resolve('saucedemo'), CredentialError)
  clearEnv('SAUCEDEMO_USERNAME')
})

// ── planCrawlCredentials (ADR-013 crawl injection decision) ────────────────────

const MAT = { usernameEnv: 'U', passwordEnv: 'P' }

test('CP1 planCrawlCredentials: force → Path A', () => {
  assert.deepEqual(planCrawlCredentials({ credentials: { envKey: 'X' } }, MAT, { force: true }), { path: 'A' })
})

test('CP2 planCrawlCredentials: fresh (no config) → Path A', () => {
  assert.deepEqual(planCrawlCredentials(null, MAT, { force: false }), { path: 'A' })
})

test('CP3 planCrawlCredentials: existing envKey, no force → Path B', () => {
  assert.deepEqual(
    planCrawlCredentials({ credentials: { envKey: 'SAUCEDEMO_CREDENTIALS' } }, MAT, { force: false }),
    { path: 'B', envKey: 'SAUCEDEMO_CREDENTIALS' },
  )
})

test('CP4 planCrawlCredentials: creds resolved, no envKey, no force → CredentialSlotError', () => {
  assert.throws(
    () => planCrawlCredentials({ appName: 'saucedemo', authType: 'form-login' }, MAT, { force: false }),
    (e: unknown) => {
      assert.ok(e instanceof CredentialSlotError)
      assert.match((e as CredentialSlotError).message, /Authenticated bootstrap required/)
      return true
    },
  )
})
