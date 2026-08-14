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

import { Transaction } from 'kysely'
import { getDb } from '../db'
import { Database, Run, NewRun, UpdateRun } from '../types'
import { RunStatus, RunLifecycle } from '../../types'

export class RunRepository {

  /** TD-120: optional trx joins the caller's Kysely transaction (results-store
   *  wraps run + test_results + trend writes atomically); omitted = singleton. */
  async insert(run: NewRun, trx?: Transaction<Database>): Promise<Run> {
    const db = trx ?? getDb()
    const result = await db.insertInto('runs')
      .values(run)
      .returningAll()
      .executeTakeFirstOrThrow()
    return result
  }

  async findById(runId: string, trx?: Transaction<Database>): Promise<Run | null> {
    const db = trx ?? getDb()
    const result = await db.selectFrom('runs')
      .selectAll()
      .where('run_id', '=', runId)
      .executeTakeFirst()
    return result ?? null
  }

  async findProductByExecution(executionId: string, trx?: Transaction<Database>): Promise<Run[]> {
    const db = trx ?? getDb()
    return db.selectFrom('runs')
      .selectAll()
      .where('execution_id', '=', executionId)
      .where('origin', '=', 'product')
      .orderBy('attempt_ordinal')
      .execute()
  }

  async findByApp(appName: string, limit = 50): Promise<Run[]> {
    const db = getDb()
    return db.selectFrom('runs')
      .selectAll()
      .where('app_name', '=', appName)
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute()
  }

  async findRecent(limit = 10): Promise<Run[]> {
    const db = getDb()
    return db.selectFrom('runs')
      .selectAll()
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute()
  }

  /** TD-126: optional trx so the verifier can reconcile run + results + trend atomically. */
  async updateStatus(
    runId: string,
    status: RunStatus,
    completedAt?: string,
    trx?: Transaction<Database>,
  ): Promise<void> {
    const db = trx ?? getDb()
    await db.updateTable('runs')
      .set({
        status,
        ...(completedAt ? { completed_at: completedAt } : {}),
      })
      .where('run_id', '=', runId)
      .execute()
  }

  /**
   * TD-126: update a run's LIFECYCLE (orthogonal to updateStatus / outcome).
   * completedAt is set only when provided — INTERRUPTED runs pass nothing, so
   * completed_at stays NULL (distinguishable forever, Nova S3).
   */
  async updateLifecycle(
    runId: string,
    lifecycle: RunLifecycle,
    completedAt?: string,
    trx?: Transaction<Database>,
  ): Promise<void> {
    const db = trx ?? getDb()
    await db.updateTable('runs')
      .set({
        lifecycle,
        ...(completedAt ? { completed_at: completedAt } : {}),
      })
      .where('run_id', '=', runId)
      .execute()
  }

  /**
   * TD-126: RUNNING runs for this app whose started_at is older than the
   * threshold — the reporter marks these INTERRUPTED on the next run start
   * (on-next-run cleanup, no background daemon).
   */
  async findStaleRunning(appName: string, olderThanMinutes: number): Promise<Run[]> {
    const db = getDb()
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()
    return db.selectFrom('runs')
      .selectAll()
      .where('app_name', '=', appName)
      .where('lifecycle', '=', 'running')
      .where('started_at', '<', cutoff)
      .execute()
  }

  async updateStats(
    runId: string,
    stats: {
      total_tests: number
      passed:      number
      failed:      number
      skipped:     number
      duration_ms: number
    },
    trx?: Transaction<Database>,
  ): Promise<void> {
    const db = trx ?? getDb()
    await db.updateTable('runs')
      .set(stats)
      .where('run_id', '=', runId)
      .execute()
  }

  /** Product aggregate fields are the only mutable part of an admitted Run. */
  async terminalizeProduct(
    runId: string,
    terminal: {
      status: 'passed' | 'failed' | 'could_not_verify'
      passed: number
      failed: number
      skipped: number
      duration_ms: number
      completed_at: string
    },
    trx: Transaction<Database>,
  ): Promise<void> {
    const result = await trx.updateTable('runs')
      .set({ ...terminal, lifecycle: 'completed' })
      .where('run_id', '=', runId)
      .where('origin', '=', 'product')
      .where('lifecycle', '=', 'running')
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error('Product Run is missing, not running, or already terminal.')
    }
  }

  /** Cancellation is terminal lifecycle, while outcome remains evidence-derived. */
  async cancelProduct(
    runId: string,
    terminal: {
      status: 'passed' | 'failed' | 'could_not_verify'
      passed: number
      failed: number
      skipped: number
      duration_ms: number
      completed_at: string
    },
    trx: Transaction<Database>,
  ): Promise<void> {
    const result = await trx.updateTable('runs')
      .set({ ...terminal, lifecycle: 'cancelled' })
      .where('run_id', '=', runId)
      .where('origin', '=', 'product')
      .where('lifecycle', '=', 'running')
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error('Product Run is missing, not running, or already terminal.')
    }
  }

  /** Recovery mutates only aggregate/lifecycle fields; admission identity stays immutable. */
  async reconcileProduct(
    runId: string,
    terminal: {
      lifecycle: 'completed' | 'cancelled' | 'interrupted'
      status: 'passed' | 'failed' | 'could_not_verify' | 'unknown'
      passed: number
      failed: number
      skipped: number
      duration_ms: number
      completed_at: string | null
    },
    trx: Transaction<Database>,
  ): Promise<void> {
    const result = await trx.updateTable('runs')
      .set(terminal)
      .where('run_id', '=', runId)
      .where('origin', '=', 'product')
      .where('lifecycle', '=', 'running')
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) !== 1) {
      throw new Error('Product Run is missing, not running, or already terminal.')
    }
  }

  /**
   * ADR-018 red-side (the reconcile gap): write results-store's honest
   * input-health assessment onto a run the streaming reporter created. The
   * reporter never assesses input_health — it inserts the migration-009 default
   * ('unknown') at onBegin — so without this the reconciled row keeps the default
   * and the run-outcome routing signal is lost. Optional trx joins the reconcile
   * transaction (mirrors updateStatus/updateLifecycle).
   */
  async updateInputHealth(
    runId: string,
    inputHealth: string,
    inputHealthReason: string | null,
    trx?: Transaction<Database>,
  ): Promise<void> {
    const db = trx ?? getDb()
    await db.updateTable('runs')
      .set({ input_health: inputHealth, input_health_reason: inputHealthReason })
      .where('run_id', '=', runId)
      .execute()
  }

  async findByEnvironment(env: string, limit = 20): Promise<Run[]> {
    const db = getDb()
    return db.selectFrom('runs')
      .selectAll()
      .where('environment', '=', env)
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute()
  }

  async getPassRateSince(appName: string, since: string): Promise<number> {
    const db = getDb()
    const rows = await db.selectFrom('runs')
      .select(['status'])
      .where('app_name', '=', appName)
      .where('started_at', '>=', since)
      .execute()
    if (rows.length === 0) return 0
    const passed = rows.filter(r => r.status === 'passed').length
    return passed / rows.length
  }

  async deleteByRunId(runId: string): Promise<void> {
    const db = getDb()
    await db.deleteFrom('runs')
      .where('run_id', '=', runId)
      .execute()
  }
}
