/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

/**
 * TD-UI-003 Block 4b — operator-facing engine errors reach the Mission Timeline.
 *
 * The whole point: an engine precondition thrown INSIDE the run (where the
 * ExecutionContext boundary stringifies errors) must still surface its message to
 * the Timeline lines[]. It does so via a stable `code` that survives the boundary
 * (OperatorFacingError.code → JobResult.errorCode → JobRunner append), NOT via an
 * instanceof (the typed class does not survive). Two rails must both work:
 *   (b) NEW — engine OperatorFacingError (ModelNotFoundError), proven END-TO-END.
 *   (a) EXISTING — CredentialError (pre-flight throw), regression-checked.
 * node:test + node:assert/strict under tsx (auto-covered by `npm run test:unit`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { JobRunner } from '../forge-ui/server/jobs/JobRunner'
import { executionContext } from '../forge-ui/server/context/ExecutionContext'
import { ModelNotFoundError } from '../src/core/errors/OperatorFacingError'
import { CredentialError } from '../forge-ui/server/context/credentials/CredentialTypes'
import { initDb, closeDb } from '../src/core/storage/db'
import { runMigrations } from '../src/core/storage/migrate'

test('E1 ModelNotFoundError — operator-facing shape (code, brand, clean message)', () => {
  const e = new ModelNotFoundError('saucedemo')
  assert.equal(e.code, 'MODEL_NOT_FOUND')
  assert.equal((e as unknown as { operatorFacing: boolean }).operatorFacing, true)
  assert.equal(e.name, 'ModelNotFoundError')
  assert.equal(e.message, "No crawled model for 'saucedemo'. Run a crawl before generating tests.")
  assert.ok(!e.message.includes('[GeneratorRunner]'), 'message must not leak internal tags')
  assert.ok(!e.message.startsWith('Error:'), 'message must not carry an Error: prefix')
  assert.ok(e instanceof Error)
})

test('E2 END-TO-END: generate with no model → ModelNotFoundError message reaches the Timeline lines[]', async () => {
  // Real path: JobRunner → ExecutionContext.runGuarded → GeneratorRunner (loadModel
  // null → throws ModelNotFoundError) → code preserved across the boundary → Timeline.
  const appName = 'zzz-opfacing-nomodel-proof'
  const projectDir = path.join(os.homedir(), '.forge-projects', appName)
  const jr = new JobRunner()
  try {
    fs.rmSync(projectDir, { recursive: true, force: true })
    const dbPath = path.join(projectDir, '.forge', 'forge.db')
    initDb(dbPath)
    await runMigrations()
    await closeDb()
    const jobId = 'e2-generate-nomodel'
    await jr.submit({ jobId, type: 'generate', appName, options: {} })

    const status = jr.getStatus(jobId)
    assert.ok(status, 'status must exist for the jobId')
    assert.equal(status!.status, 'failed')
    // Clean operator message on job status — no internal [GeneratorRunner] tag,
    // no "Error:" prefix (the operator-facing rail preserves the raw .message).
    assert.equal(status!.error, `No crawled model for '${appName}'. Run a crawl before generating tests.`)
    // THE POINT OF THE BLOCK — the message is in the Mission Timeline lines[].
    assert.ok(
      status!.lines.some(l => l.includes('⛔') && l.includes(`No crawled model for '${appName}'`)),
      `operator message missing from Timeline lines[] — lines: ${JSON.stringify(status!.lines)}`,
    )
  } finally {
    await closeDb()
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
})

test('E3 REGRESSION: CredentialError still surfaces to the Timeline lines[] (rail a unchanged)', async () => {
  // Stub the engine call to REJECT with a real CredentialError instance (its true
  // shape on the crawl path: thrown pre-flight, propagates as an instance). Proves
  // the existing instanceof rail is intact. type 'generate' avoids provisioning.
  const jr = new JobRunner()
  const orig = executionContext.submit
  ;(executionContext as unknown as { submit: unknown }).submit = () =>
    Promise.reject(new CredentialError('regapp', 'form', { usernameEnv: 'REGAPP_USERNAME', passwordEnv: 'REGAPP_PASSWORD' }))
  const jobId = 'e3-cred'
  try {
    await jr.submit({ jobId, type: 'generate', appName: 'regapp', options: {} })

    const status = jr.getStatus(jobId)
    assert.ok(status)
    assert.equal(status!.status, 'failed')
    assert.ok(
      status!.lines.some(l => l.includes('⛔') && l.includes('requires authentication')),
      `CredentialError message missing from Timeline lines[] — lines: ${JSON.stringify(status!.lines)}`,
    )
  } finally {
    ;(executionContext as unknown as { submit: typeof orig }).submit = orig
  }
})
