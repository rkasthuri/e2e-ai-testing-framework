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

import { getDb } from '../db'
import { PerfBaseline, NewPerfBaseline } from '../types'

export class PerfBaselineRepository {

  async upsert(baseline: NewPerfBaseline): Promise<PerfBaseline> {
    const db = getDb()
    await db.insertInto('perf_baselines')
      .values(baseline)
      .onConflict(oc => oc
        .columns(['app_name', 'flow_id', 'metric'] as any)
        .doUpdateSet({
          current_value: baseline.current_value,
          status:        baseline.status,
          run_id:        baseline.run_id,
          recorded_at:   baseline.recorded_at,
        })
      )
      .execute()

    return db.selectFrom('perf_baselines')
      .selectAll()
      .where('app_name', '=', baseline.app_name)
      .where('flow_id', '=', baseline.flow_id)
      .where('metric',  '=', baseline.metric)
      .executeTakeFirstOrThrow()
  }

  async findByFlow(
    appName: string,
    flowId: string
  ): Promise<PerfBaseline[]> {
    const db = getDb()
    return db.selectFrom('perf_baselines')
      .selectAll()
      .where('app_name', '=', appName)
      .where('flow_id', '=', flowId)
      .execute()
  }

  async findRegressions(appName: string): Promise<PerfBaseline[]> {
    const db = getDb()
    return db.selectFrom('perf_baselines')
      .selectAll()
      .where('app_name', '=', appName)
      .where('status', '=', 'regression')
      .execute()
  }

  async checkRegression(
    appName: string,
    flowId: string,
    metric: string,
    currentValue: number
  ): Promise<{ isRegression: boolean; pctOver: number; status: string }> {
    const db = getDb()
    const baseline = await db.selectFrom('perf_baselines')
      .selectAll()
      .where('app_name', '=', appName)
      .where('flow_id', '=', flowId)
      .where('metric',  '=', metric)
      .executeTakeFirst()

    if (!baseline) {
      return { isRegression: false, pctOver: 0, status: 'no-baseline' }
    }

    const pctOver = ((currentValue - baseline.baseline_value) /
      baseline.baseline_value) * 100
    const isRegression = pctOver > baseline.threshold_pct
    const status = isRegression
      ? 'regression'
      : currentValue < baseline.baseline_value
        ? 'improvement'
        : 'stable'

    return { isRegression, pctOver, status }
  }

  async getAllForApp(appName: string): Promise<PerfBaseline[]> {
    const db = getDb()
    return db.selectFrom('perf_baselines')
      .selectAll()
      .where('app_name', '=', appName)
      .orderBy('flow_id', 'asc')
      .execute()
  }
}
