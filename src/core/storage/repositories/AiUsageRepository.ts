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
import { AiUsage, NewAiUsage } from '../types'

export interface DailyUsageSummary {
  date:               string
  total_tokens:       number
  estimated_cost_usd: number
  call_count:         number
  failed_count:       number
}

export interface OperationCostBreakdown {
  operation:          string
  total_tokens:       number
  estimated_cost_usd: number
  call_count:         number
}

export class AiUsageRepository {

  async insert(usage: NewAiUsage): Promise<AiUsage> {
    const db = getDb()
    return db.insertInto('ai_usage')
      .values(usage)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  async findByRun(runId: string): Promise<AiUsage[]> {
    const db = getDb()
    return db.selectFrom('ai_usage')
      .selectAll()
      .where('run_id', '=', runId)
      .execute()
  }

  async findByOperation(
    operation: string,
    days = 30
  ): Promise<AiUsage[]> {
    const db = getDb()
    const since = new Date(Date.now() - days * 86400000).toISOString()
    return db.selectFrom('ai_usage')
      .selectAll()
      .where('operation', '=', operation)
      .where('recorded_at', '>=', since)
      .orderBy('recorded_at', 'desc')
      .execute()
  }

  async getDailySummary(
    appName: string,
    days = 30
  ): Promise<DailyUsageSummary[]> {
    const db = getDb()
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const rows = await db.selectFrom('ai_usage')
      .select([
        'recorded_at',
        'total_tokens',
        'estimated_cost_usd',
        'success',
      ])
      .where('app_name', '=', appName)
      .where('recorded_at', '>=', since)
      .execute()

    const map = new Map<string, DailyUsageSummary>()
    for (const r of rows) {
      const date = r.recorded_at.slice(0, 10)
      const entry = map.get(date) || {
        date,
        total_tokens:       0,
        estimated_cost_usd: 0,
        call_count:         0,
        failed_count:       0,
      }
      entry.total_tokens       += r.total_tokens
      entry.estimated_cost_usd += r.estimated_cost_usd
      entry.call_count++
      if (!r.success) entry.failed_count++
      map.set(date, entry)
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  }

  async getMonthlySpend(appName: string): Promise<number> {
    const db = getDb()
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const rows = await db.selectFrom('ai_usage')
      .select(['estimated_cost_usd'])
      .where('app_name', '=', appName)
      .where('recorded_at', '>=', since)
      .execute()
    return rows.reduce((sum, r) => sum + r.estimated_cost_usd, 0)
  }

  async getTotalByOperation(
    appName: string
  ): Promise<OperationCostBreakdown[]> {
    const db = getDb()
    const rows = await db.selectFrom('ai_usage')
      .select(['operation', 'total_tokens', 'estimated_cost_usd', 'success'])
      .where('app_name', '=', appName)
      .execute()

    const map = new Map<string, OperationCostBreakdown>()
    for (const r of rows) {
      const entry = map.get(r.operation) || {
        operation:          r.operation,
        total_tokens:       0,
        estimated_cost_usd: 0,
        call_count:         0,
      }
      entry.total_tokens       += r.total_tokens
      entry.estimated_cost_usd += r.estimated_cost_usd
      entry.call_count++
      map.set(r.operation, entry)
    }
    return Array.from(map.values())
      .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
  }

  async getROIMetrics(
    appName: string,
    sdetHourlyRateUsd = 75
  ): Promise<{
    totalAiSpendUsd:     number
    healEvents:          number
    estimatedHoursSaved: number
    estimatedSavingsUsd: number
    roiMultiplier:       number
  }> {
    const db = getDb()
    const since = new Date(Date.now() - 30 * 86400000).toISOString()

    const spendRows = await db.selectFrom('ai_usage')
      .select(['estimated_cost_usd'])
      .where('app_name', '=', appName)
      .where('recorded_at', '>=', since)
      .execute()
    const totalAiSpendUsd = spendRows.reduce((s, r) => s + r.estimated_cost_usd, 0)

    const healRows = await db.selectFrom('heal_events')
      .innerJoin('runs', 'runs.run_id', 'heal_events.run_id')
      .select(['heal_events.id'])
      .where('runs.app_name', '=', appName)
      .where('heal_events.healed_at', '>=', since)
      .execute()
    const healEvents = healRows.length

    const minutesPerManualTriage = 15
    const estimatedHoursSaved    = (healEvents * minutesPerManualTriage) / 60
    const estimatedSavingsUsd    = estimatedHoursSaved * sdetHourlyRateUsd
    const roiMultiplier          = totalAiSpendUsd > 0
      ? estimatedSavingsUsd / totalAiSpendUsd
      : 0

    return {
      totalAiSpendUsd,
      healEvents,
      estimatedHoursSaved,
      estimatedSavingsUsd,
      roiMultiplier,
    }
  }
}
