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
import { RunRepository }           from '../src/core/storage/repositories/RunRepository'
import { HealRepository }          from '../src/core/storage/repositories/HealRepository'
import { AiTriageRepository }      from '../src/core/storage/repositories/AiTriageRepository'
import { AiUsageRepository }       from '../src/core/storage/repositories/AiUsageRepository'
import { DomSnapshotRepository }   from '../src/core/storage/repositories/DomSnapshotRepository'
import { FlakyAnalysisRepository } from '../src/core/storage/repositories/FlakyAnalysisRepository'
import { CoverageGapRepository }   from '../src/core/storage/repositories/CoverageGapRepository'

async function verify() {
  await runMigrations()

  const runId  = `verify-4.8.3b-${Date.now()}`
  const runRepo = new RunRepository()

  await runRepo.insert({
    run_id: runId, app_name: 'saucedemo', branch: 'main',
    commit_sha: 'abc123', environment: 'local',
    base_url: 'https://www.saucedemo.com', triggered_by: 'manual',
    reporter_version: '4.8.3', status: 'failed', total_tests: 1,
    passed: 0, failed: 1, skipped: 0, duration_ms: 500,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(), metadata: '{}',
  })

  // HealRepository
  const healRepo = new HealRepository()
  await healRepo.insert({
    run_id: runId, page: 'CartPage', element: 'checkoutButton',
    original_strategy: 'data-test:checkout-broken',
    healed_strategy: 'role:button[name=Checkout]',
    heal_type: 'smart-locator', confidence: 0.95,
    consecutive_count: 1, promoted: 0,
    healed_at: new Date().toISOString(),
  })
  const heals = await healRepo.findByRun(runId)
  console.log('✓ HealRepository.insert + findByRun — count:', heals.length)
  const consec = await healRepo.getConsecutiveCount('CartPage', 'checkoutButton')
  console.log('✓ HealRepository.getConsecutiveCount:', consec)
  const topHealed = await healRepo.getTopHealedElements('saucedemo', 5)
  console.log('✓ HealRepository.getTopHealedElements — count:', topHealed.length)

  // AiTriageRepository
  const triageRepo = new AiTriageRepository()
  await triageRepo.insert({
    run_id: runId, test_id: 'TC001',
    failure_category: 'selector-change', confidence: 0.9,
    root_cause: 'data-test attribute renamed',
    suggested_fix: 'Update selector to data-test=checkout',
    similar_failures: '["TC003","TC004"]',
    triage_model: 'claude-sonnet-4-5',
    triaged_at: new Date().toISOString(), tokens_used: 450,
  })
  const triage = await triageRepo.findByTest(runId, 'TC001')
  console.log('✓ AiTriageRepository.insert + findByTest — category:', triage?.failure_category)
  const breakdown = await triageRepo.getCategoryBreakdown('saucedemo', 30)
  console.log('✓ AiTriageRepository.getCategoryBreakdown — categories:', breakdown.length)

  // AiUsageRepository
  const usageRepo = new AiUsageRepository()
  await usageRepo.insert({
    run_id: runId, app_name: 'saucedemo', operation: 'triage',
    model: 'claude-sonnet-4-5', input_tokens: 300, output_tokens: 150,
    total_tokens: 450, estimated_cost_usd: 0.00315,
    duration_ms: 1200, triggered_by: 'manual', success: 1,
    recorded_at: new Date().toISOString(),
  })
  const usage = await usageRepo.findByRun(runId)
  console.log('✓ AiUsageRepository.insert + findByRun — count:', usage.length)
  const monthly = await usageRepo.getMonthlySpend('saucedemo')
  console.log('✓ AiUsageRepository.getMonthlySpend — usd:', monthly.toFixed(5))
  const roi = await usageRepo.getROIMetrics('saucedemo', 75)
  console.log('✓ AiUsageRepository.getROIMetrics — multiplier:', roi.roiMultiplier.toFixed(2))

  // DomSnapshotRepository
  const snapRepo = new DomSnapshotRepository()
  const purgeDate = new Date(Date.now() - 1000).toISOString().slice(0, 10)
  await snapRepo.insert({
    run_id: runId, test_id: 'TC001', step_index: 3,
    url: 'https://www.saucedemo.com/cart.html',
    dom_hash: 'sha256:abc123', interactive_elements: '[]',
    captured_at: new Date().toISOString(),
    snapshot_type: 'failure', purge_after_days: 30,
    purge_after_date: purgeDate, purged: 0,
  })
  const snaps = await snapRepo.findByTest(runId, 'TC001')
  console.log('✓ DomSnapshotRepository.insert + findByTest — count:', snaps.length)
  const expired = await snapRepo.findExpired()
  console.log('✓ DomSnapshotRepository.findExpired — count:', expired.length)
  const purgeStats = await snapRepo.getPurgeStats()
  console.log('✓ DomSnapshotRepository.getPurgeStats — total:', purgeStats.total)

  // FlakyAnalysisRepository
  const flakyRepo = new FlakyAnalysisRepository()
  await flakyRepo.upsert({
    test_id: 'TC001', app_name: 'saucedemo',
    analysis_date: new Date().toISOString().slice(0, 10),
    flaky_score: 72, signal_timing: 30, signal_selector: 20,
    signal_data: 10, signal_env: 5, signal_concurrency: 5,
    signal_network: 2, sample_size: 20,
    recommendation: 'fix-selector', trend: 'degrading',
  })
  const flaky = await flakyRepo.findByTest('TC001')
  console.log('✓ FlakyAnalysisRepository.upsert + findByTest — score:', flaky?.flaky_score)
  const topFlaky = await flakyRepo.findTopFlaky('saucedemo', 5)
  console.log('✓ FlakyAnalysisRepository.findTopFlaky — count:', topFlaky.length)
  const signals = await flakyRepo.getSignalBreakdown('saucedemo')
  console.log('✓ FlakyAnalysisRepository.getSignalBreakdown — signals:', signals.length)

  // CoverageGapRepository
  const gapRepo = new CoverageGapRepository()
  await gapRepo.insertBatch([
    {
      app_name: 'saucedemo', gap_id: 'TC039',
      gap_type: 'test-case',
      description: 'Missing test for locked user checkout',
      priority: 'high', suggested_spec: 'checkout.spec.ts',
      status: 'open', identified_at: new Date().toISOString(),
      closed_at: null, closed_by_test: null,
    },
  ])
  const openGaps = await gapRepo.findOpen('saucedemo')
  console.log('✓ CoverageGapRepository.insertBatch + findOpen — count:', openGaps.length)
  await gapRepo.closeGap('TC039', 'TC039-impl')
  const afterClose = await gapRepo.getOpenCount('saucedemo')
  console.log('✓ CoverageGapRepository.closeGap + getOpenCount — open:', afterClose)

  // Cleanup
  await snapRepo.deleteByRunId(runId)
  await triageRepo.deleteByRunId(runId)
  await usageRepo.findByRun(runId)
  await healRepo.deleteByRunId(runId)
  await runRepo.deleteByRunId(runId)
  console.log('✓ Cleanup complete')

  await closeDb()
  console.log('\n✅ Phase 4.8.3B — all assertions passed')
}

verify().catch(e => { console.error('✗', e); process.exit(1) })
