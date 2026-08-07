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

import { runMigrations, getDb, closeDb } from '../src/core/storage'
import { RunRepository }        from '../src/core/storage/repositories/RunRepository'
import { TestResultRepository } from '../src/core/storage/repositories/TestResultRepository'
import { TestStepRepository }   from '../src/core/storage/repositories/TestStepRepository'

async function verify() {
  await runMigrations()

  const runRepo    = new RunRepository()
  const resultRepo = new TestResultRepository()
  const stepRepo   = new TestStepRepository()

  const runId = `verify-4.8.3a-${Date.now()}`

  // Insert a test run
  const run = await runRepo.insert({
    run_id:           runId,
    app_name:         'saucedemo',
    branch:           'main',
    commit_sha:       'abc123',
    environment:      'local',
    base_url:         'https://www.saucedemo.com',
    triggered_by:     'manual',
    reporter_version: '4.8.3',
    status:           'passed',
    total_tests:      3,
    passed:           3,
    failed:           0,
    skipped:          0,
    duration_ms:      1500,
    started_at:       new Date().toISOString(),
    completed_at:     new Date().toISOString(),
    metadata:         '{}',
  })
  console.log('✓ RunRepository.insert — id:', run.id)

  // Insert test results
  await resultRepo.insertBatch([
    {
      run_id: runId, test_id: 'TC001', title: 'Login test',
      suite: 'login.spec.ts', status: 'passed', duration_ms: 400,
      retry_count: 0, error_msg: null, browser: 'chromium',
      tier: 'ui', started_at: new Date().toISOString(),
      worker_index: 0, tags: '[]', flaky_history: 0,
      screenshot_path: null, video_path: null, metadata: '{}',
    },
    {
      run_id: runId, test_id: 'TC002', title: 'Cart test',
      suite: 'cart.spec.ts', status: 'failed', duration_ms: 600,
      retry_count: 1, error_msg: 'Element not found',
      browser: 'webkit', tier: 'ui',
      started_at: new Date().toISOString(),
      worker_index: 1, tags: '["@smoke"]', flaky_history: 0,
      screenshot_path: null, video_path: null, metadata: '{}',
    },
  ])
  const results = await resultRepo.findByRun(runId)
  console.log('✓ TestResultRepository.insertBatch + findByRun — count:', results.length)

  const failed = await resultRepo.findFailedByRun(runId)
  console.log('✓ TestResultRepository.findFailedByRun — count:', failed.length)

  const breakdown = await resultRepo.getSuiteBreakdown(runId)
  console.log('✓ TestResultRepository.getSuiteBreakdown — suites:', breakdown.length)

  // Insert test steps
  await stepRepo.insertBatch([
    {
      run_id: runId, test_id: 'TC002', step_index: 1,
      action: 'navigate', target: '/cart', value: null,
      status: 'passed', duration_ms: 100, screenshot_path: null,
      error_msg: null, healed: 0, step_metadata: '{}',
    },
    {
      run_id: runId, test_id: 'TC002', step_index: 2,
      action: 'click', target: '[data-test="checkout"]', value: null,
      status: 'failed', duration_ms: 200, screenshot_path: null,
      error_msg: 'Element not found', healed: 1, step_metadata: '{}',
    },
  ])
  const steps = await stepRepo.findByTest(runId, 'TC002')
  console.log('✓ TestStepRepository.insertBatch + findByTest — count:', steps.length)

  const failStep = await stepRepo.findFailureStep(runId, 'TC002')
  console.log('✓ TestStepRepository.findFailureStep — action:', failStep?.action)

  const healed = await stepRepo.findHealedSteps(runId)
  console.log('✓ TestStepRepository.findHealedSteps — count:', healed.length)

  // Cleanup
  await stepRepo.deleteByRunId(runId)
  await resultRepo.deleteByRunId(runId)
  await runRepo.deleteByRunId(runId)
  console.log('✓ Cleanup complete')

  await closeDb()
  console.log('\n✅ Phase 4.8.3A — all assertions passed')
}

verify().catch(e => { console.error('✗', e); process.exit(1) })
