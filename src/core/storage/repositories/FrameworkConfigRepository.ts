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
import { FrameworkConfig, NewFrameworkConfig } from '../types'

export class FrameworkConfigRepository {

  async get(key: string): Promise<string | null> {
    const db = getDb()
    const result = await db.selectFrom('framework_config')
      .select(['value', 'default_value'])
      .where('key', '=', key)
      .executeTakeFirst()
    return result?.value ?? result?.default_value ?? null
  }

  async getNumber(key: string): Promise<number> {
    const val = await this.get(key)
    return val !== null ? parseFloat(val) : 0
  }

  async getString(key: string): Promise<string> {
    const val = await this.get(key)
    return val !== null ? val.replace(/^"|"$/g, '') : ''
  }

  async getBoolean(key: string): Promise<boolean> {
    const val = await this.get(key)
    return val === 'true' || val === '"true"'
  }

  async set(
    key: string,
    value: string,
    updatedBy: string
  ): Promise<void> {
    const db = getDb()
    await db.updateTable('framework_config')
      .set({ value, updated_by: updatedBy, updated_at: new Date().toISOString() })
      .where('key', '=', key)
      .execute()
  }

  async getByCategory(category: string): Promise<FrameworkConfig[]> {
    const db = getDb()
    return db.selectFrom('framework_config')
      .selectAll()
      .where('category', '=', category)
      .orderBy('key', 'asc')
      .execute()
  }

  async getRetentionDays(): Promise<15 | 30 | 60> {
    const val = await this.getNumber('snapshot.retention_days')
    if (val === 15 || val === 30 || val === 60) return val
    return 30
  }

  async getAll(): Promise<FrameworkConfig[]> {
    const db = getDb()
    return db.selectFrom('framework_config')
      .selectAll()
      .orderBy('category', 'asc')
      .execute()
  }

  async getSdetHourlyRate(): Promise<number> {
    return this.getNumber('reporting.sdet_hourly_rate_usd')
  }

  async getAiBudgetPerCrawl(): Promise<number> {
    return this.getNumber('ai.budget_per_crawl')
  }

  async getVisionHealBudget(): Promise<number> {
    return this.getNumber('ai.vision_heal_budget')
  }
}
