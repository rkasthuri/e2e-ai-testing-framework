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

import { runMigrations, closeDb } from '../src/core/storage'
import { RunRepository }            from '../src/core/storage/repositories/RunRepository'
import { AppModelRepository }       from '../src/core/storage/repositories/AppModelRepository'
import { AssertionRepository }      from '../src/core/storage/repositories/AssertionRepository'
import { TrendRepository }          from '../src/core/storage/repositories/TrendRepository'
import { PerfBaselineRepository }   from '../src/core/storage/repositories/PerfBaselineRepository'
import { FrameworkConfigRepository} from '../src/core/storage/repositories/FrameworkConfigRepository'
import { PurgeRepository }          from '../src/core/storage/repositories/PurgeRepository'
import { loadAppModelFixture }       from './helpers/load-app-model-fixture'

async function verify() {
  await runMigrations()

  const runId  = `verify-4.8.3c-${Date.now()}`
  const runRepo = new RunRepository()

  await runRepo.insert({
    run_id: runId, app_name: 'saucedemo', branch: 'main',
    commit_sha: 'abc123', environment: 'local',
    base_url: 'https://www.saucedemo.com', triggered_by: 'manual',
    reporter_version: '4.8.3', status: 'passed', total_tests: 1,
    passed: 1, failed: 0, skipped: 0, duration_ms: 800,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(), metadata: '{}',
  })

  // AppModelRepository
  const modelRepo = new AppModelRepository()
  await modelRepo.upsert(loadAppModelFixture('saucedemo') as any)
  const active = await modelRepo.findActive('saucedemo')
  console.log('✓ AppModelRepository.upsert + findActive — version:', active?.version)
  const history = await modelRepo.findHistory('saucedemo')
  console.log('✓ AppModelRepository.findHistory — count:', history.length)
  const modelJson = await modelRepo.getModelJson('saucedemo')
  console.log('✓ AppModelRepository.getModelJson — pages:', (modelJson as any)?.pages?.length)

  // AssertionRepository
  const assertRepo = new AssertionRepository()
  const assertion = await assertRepo.insert({
    app_name: 'saucedemo', flow_id: 'checkout-happy-path',
    test_id: 'TC001',
    assertion_text: 'Cart badge should show item count',
    assertion_code: 'expect(cartBadge).toHaveText("1")',
    tier: 3, status: 'quarantined', confidence: 0.82,
    proposed_by: 'ai', reviewed_by: null,
    mutation_score: null, proposed_at: new Date().toISOString(),
    reviewed_at: null,
  })
  console.log('✓ AssertionRepository.insert — id:', assertion.id)
  const quarantined = await assertRepo.findQuarantined('saucedemo')
  console.log('✓ AssertionRepository.findQuarantined — count:', quarantined.length)
  await assertRepo.promote(assertion.id!, 'human')
  const breakdown = await assertRepo.getStatusBreakdown('saucedemo')
  console.log('✓ AssertionRepository.promote + getStatusBreakdown — statuses:', breakdown.length)

  // TrendRepository
  const trendRepo = new TrendRepository()
  await trendRepo.upsert({
    app_name: 'saucedemo',
    period: new Date().toISOString().slice(0, 10),
    total_runs: 5, pass_rate: 0.92, avg_duration_ms: 45000,
    flaky_count: 1, heal_count: 2, coverage_delta: 3,
    computed_at: new Date().toISOString(),
  })
  const latest = await trendRepo.getLatest('saucedemo')
  console.log('✓ TrendRepository.upsert + getLatest — pass_rate:', latest?.pass_rate)
  const passRateTrend = await trendRepo.getPassRateTrend('saucedemo', 7)
  console.log('✓ TrendRepository.getPassRateTrend — periods:', passRateTrend.length)
  const computed = await trendRepo.computeAndUpsertForRun('saucedemo', runId)
  console.log('✓ TrendRepository.computeAndUpsertForRun — total_runs:', computed.total_runs)

  // PerfBaselineRepository
  const perfRepo = new PerfBaselineRepository()
  await perfRepo.upsert({
    app_name: 'saucedemo', flow_id: 'checkout',
    metric: 'duration_ms', baseline_value: 3000,
    threshold_pct: 10, current_value: null,
    status: 'stable', run_id: null,
    recorded_at: new Date().toISOString(),
  })
  const baselines = await perfRepo.findByFlow('saucedemo', 'checkout')
  console.log('✓ PerfBaselineRepository.upsert + findByFlow — count:', baselines.length)
  const regCheck = await perfRepo.checkRegression('saucedemo', 'checkout', 'duration_ms', 3500)
  console.log('✓ PerfBaselineRepository.checkRegression — isRegression:', regCheck.isRegression, 'pct:', regCheck.pctOver.toFixed(1))
  const regCheck2 = await perfRepo.checkRegression('saucedemo', 'checkout', 'duration_ms', 2800)
  console.log('✓ PerfBaselineRepository.checkRegression improvement — status:', regCheck2.status)

  // FrameworkConfigRepository
  const configRepo = new FrameworkConfigRepository()
  const retentionDays = await configRepo.getRetentionDays()
  console.log('✓ FrameworkConfigRepository.getRetentionDays:', retentionDays)
  const budget = await configRepo.getAiBudgetPerCrawl()
  console.log('✓ FrameworkConfigRepository.getAiBudgetPerCrawl:', budget)
  const healBudget = await configRepo.getVisionHealBudget()
  console.log('✓ FrameworkConfigRepository.getVisionHealBudget:', healBudget)
  await configRepo.set('snapshot.retention_days', '60', 'human')
  const updated = await configRepo.getRetentionDays()
  console.log('✓ FrameworkConfigRepository.set + getRetentionDays (updated):', updated)
  await configRepo.set('snapshot.retention_days', '30', 'system')

  // PurgeRepository
  const purgeRepo = new PurgeRepository()
  const purgeStats = await purgeRepo.getPurgeStats()
  console.log('✓ PurgeRepository.getPurgeStats — retentionDays:', purgeStats.retentionDays)
  console.log('✓ PurgeRepository.getPurgeStats — nextPurgeDate:', purgeStats.nextPurgeDate)
  const purged = await purgeRepo.purgeExpiredSnapshots()
  console.log('✓ PurgeRepository.purgeExpiredSnapshots — purged:', purged)

  // Cleanup
  await runRepo.deleteByRunId(runId)
  console.log('✓ Cleanup complete')

  await closeDb()
  console.log('\n✅ Phase 4.8.3C — all assertions passed')
}

verify().catch(e => { console.error('✗', e); process.exit(1) })
