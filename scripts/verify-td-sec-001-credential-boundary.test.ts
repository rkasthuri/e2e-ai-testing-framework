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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import {
  EnvironmentCredentialExecutionScope,
  type CredentialMaterial,
} from '../src/core/security/CredentialExecutionScope'
import { CredentialError } from '../forge-ui/server/context/credentials/CredentialTypes'

const REPO_ROOT = path.resolve(__dirname, '..')
const REFERENCE = { usernameEnv: 'PROJECT_A_USERNAME', passwordEnv: 'PROJECT_A_PASSWORD' }
const USERNAME = 'td-sec-001-user-material'
const PASSWORD = 'td-sec-001-password-material'

test('TD-SEC-001-1 material exists only inside the successful operation callback', async () => {
  const environment = { PROJECT_A_USERNAME: USERNAME, PROJECT_A_PASSWORD: PASSWORD }
  const scope = new EnvironmentCredentialExecutionScope(environment)
  let retained: CredentialMaterial | null = null
  const result = await scope.run(REFERENCE, async material => {
    retained = material
    assert.equal(material.username, USERNAME)
    assert.equal(material.password, PASSWORD)
    return 'observed'
  })
  assert.deepEqual(result, { kind: 'completed', value: 'observed' })
  assert.throws(() => retained!.username, /no longer available/)
  assert.throws(() => retained!.password, /no longer available/)
  assert.deepEqual(environment, { PROJECT_A_USERNAME: USERNAME, PROJECT_A_PASSWORD: PASSWORD })
})

test('TD-SEC-001-2 exception cleanup disposes retained material without changing source environment', async () => {
  const environment = { PROJECT_A_USERNAME: USERNAME, PROJECT_A_PASSWORD: PASSWORD }
  const scope = new EnvironmentCredentialExecutionScope(environment)
  let retained: CredentialMaterial | null = null
  await assert.rejects(
    () => scope.run(REFERENCE, async material => {
      retained = material
      throw new Error(`unsafe-${PASSWORD}`)
    }),
    /unsafe-/,
  )
  assert.throws(() => retained!.username, /no longer available/)
  assert.deepEqual(environment, { PROJECT_A_USERNAME: USERNAME, PROJECT_A_PASSWORD: PASSWORD })
})

test('TD-SEC-001-3 cancellation-shaped early return still disposes material', async () => {
  const scope = new EnvironmentCredentialExecutionScope({
    PROJECT_A_USERNAME: USERNAME, PROJECT_A_PASSWORD: PASSWORD,
  })
  let retained: CredentialMaterial | null = null
  const result = await scope.run(REFERENCE, async material => {
    retained = material
    return { lifecycle: 'cancelled' as const }
  })
  assert.equal(result.kind, 'completed')
  assert.throws(() => retained!.password, /no longer available/)
})

test('TD-SEC-001-4 unavailable and partial references never invoke an operation', async () => {
  for (const environment of [{}, { PROJECT_A_USERNAME: USERNAME }]) {
    let called = false
    const result = await new EnvironmentCredentialExecutionScope(environment).run(
      REFERENCE,
      async () => { called = true },
    )
    assert.deepEqual(result, { kind: 'unavailable' })
    assert.equal(called, false)
  }
})

test('TD-SEC-001-5 project references, replacement, and reuse cannot cross-contaminate', async () => {
  const environment: Record<string, string> = {
    PROJECT_A_USERNAME: 'a-user', PROJECT_A_PASSWORD: 'a-password',
    PROJECT_B_USERNAME: 'b-user', PROJECT_B_PASSWORD: 'b-password',
  }
  const scope = new EnvironmentCredentialExecutionScope(environment)
  const observed: string[] = []
  await scope.run(REFERENCE, async material => { observed.push(`${material.username}:${material.password}`) })
  await scope.run(
    { usernameEnv: 'PROJECT_B_USERNAME', passwordEnv: 'PROJECT_B_PASSWORD' },
    async material => { observed.push(`${material.username}:${material.password}`) },
  )
  environment.PROJECT_A_PASSWORD = 'a-password-replaced'
  await scope.run(REFERENCE, async material => { observed.push(`${material.username}:${material.password}`) })
  assert.deepEqual(observed, ['a-user:a-password', 'b-user:b-password', 'a-user:a-password-replaced'])
})

test('TD-SEC-001-6 directly supplied onboarding material is disposed and input is not mutated', async () => {
  const input = { username: USERNAME, password: PASSWORD }
  let retained: CredentialMaterial | null = null
  await new EnvironmentCredentialExecutionScope({}).runProvided(input, async material => {
    retained = material
  })
  assert.deepEqual(input, { username: USERNAME, password: PASSWORD })
  assert.throws(() => retained!.username, /no longer available/)
})

test('TD-SEC-001-7 credential refusal is safe and does not expose names or values', () => {
  const error = new CredentialError('project-a', 'form-login', REFERENCE)
  const serialized = JSON.stringify({ code: 'CREDENTIALS_REQUIRED', message: error.message })
  for (const forbidden of [REFERENCE.usernameEnv, REFERENCE.passwordEnv, USERNAME, PASSWORD]) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('TD-SEC-001-8 runtime producers never write credential material to process.env', () => {
  for (const relative of [
    'forge-ui/server/context/ExecutionContext.ts',
    'src/core/runner/CrawlRunner.ts',
    'src/core/execution/PlaywrightPlanExecutor.ts',
  ]) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8')
    assert.doesNotMatch(source, /process\.env\[[^\]]+\]\s*=/, relative)
  }
})

test('TD-SEC-001-9 Product browser paths create no storage-state, screenshot, or video artifact', () => {
  for (const relative of [
    'src/core/onboarding/AuthManager.ts',
    'src/core/execution/PlaywrightPlanExecutor.ts',
  ]) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8')
    assert.doesNotMatch(source, /storageState\s*\(|screenshot\s*\(|recordVideo|video\s*:/, relative)
  }
})

test('TD-SEC-001-10 persistence, recovery, cancellation, and Results projection own no credential material', () => {
  for (const relative of [
    'src/core/storage/repositories/ExecutionRepository.ts',
    'src/core/execution/ExecutionRunCoordinator.ts',
    'src/core/execution/ExecutionRecoveryCoordinator.ts',
    'src/core/execution/ExecutionResultProjectionService.ts',
    'src/core/execution/ExecutionCancellationToken.ts',
  ]) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8')
    assert.doesNotMatch(source, /credentialMaterial|\bpassword\b|storageState|authorization\s*header/i, relative)
  }
})

test('TD-SEC-001-11 retained scope views cannot be reused by a later operation', async () => {
  const scope = new EnvironmentCredentialExecutionScope({
    PROJECT_A_USERNAME: USERNAME, PROJECT_A_PASSWORD: PASSWORD,
  })
  let first: CredentialMaterial | null = null
  await scope.run(REFERENCE, async material => { first = material })
  await scope.run(REFERENCE, async material => {
    assert.equal(material.username, USERNAME)
    assert.throws(() => first!.username, /no longer available/)
  })
})

test('TD-SEC-001-12 scope emits no log output containing material', async () => {
  const lines: string[] = []
  const original = console.log
  console.log = (...values: unknown[]) => { lines.push(values.join(' ')) }
  try {
    await new EnvironmentCredentialExecutionScope({
      PROJECT_A_USERNAME: USERNAME, PROJECT_A_PASSWORD: PASSWORD,
    }).run(REFERENCE, async () => undefined)
  } finally {
    console.log = original
  }
  assert.equal(lines.join('\n').includes(USERNAME), false)
  assert.equal(lines.join('\n').includes(PASSWORD), false)
})
