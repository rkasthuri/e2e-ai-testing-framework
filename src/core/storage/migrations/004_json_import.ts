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

import { Kysely } from 'kysely';
import * as fs from 'fs';
import * as path from 'path';

const HISTORY_PATH = path.resolve(process.cwd(), 'reports/run-history.json');
const HEAL_PATH    = path.resolve(process.cwd(), 'reports/heal-store.json');
// TRENDS_PATH removed with the trends block (TD-118) — see the comment below.

export async function up(db: Kysely<any>): Promise<void> {

  // ── run-history.json ──────────────────────────────────────────────────────
  if (fs.existsSync(HISTORY_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
      const runs: any[] = Array.isArray(raw) ? raw : (raw.runs ?? []);
      let imported = 0;
      for (const r of runs) {
        await db.insertInto('runs')
          .values({
            run_id:           r.runId           ?? r.run_id           ?? `legacy-${Date.now()}-${Math.random()}`,
            app_name:         r.appName         ?? r.app_name         ?? 'unknown',
            branch:           r.branch          ?? 'unknown',
            commit_sha:       r.commitSha       ?? r.commit_sha       ?? 'unknown',
            environment:      r.environment     ?? 'local',
            base_url:         r.baseUrl         ?? r.base_url         ?? '',
            triggered_by:     r.triggeredBy     ?? r.triggered_by     ?? 'manual',
            reporter_version: r.reporterVersion ?? r.reporter_version ?? 'legacy',
            status:           r.status          ?? 'unknown',
            total_tests:      r.stats?.total    ?? r.totalTests       ?? r.total ?? 0,
            passed:           r.stats?.passed   ?? r.passed           ?? 0,
            failed:           r.stats?.failed   ?? r.failed           ?? 0,
            skipped:          r.stats?.skipped  ?? r.skipped          ?? 0,
            duration_ms:      r.durationMs      ?? r.duration_ms      ?? r.duration ?? 0,
            started_at:       r.startTime       ?? r.started_at       ?? r.timestamp ?? new Date().toISOString(),
            completed_at:     r.endTime         ?? r.completed_at     ?? new Date().toISOString(),
            metadata:         JSON.stringify(r.metadata ?? {}),
          })
          .onConflict(oc => oc.column('run_id').doNothing())
          .execute();
        imported++;
      }
      console.log(`[migration 004] Imported ${imported} run(s) from run-history.json`);
    } catch (e) {
      console.warn('[migration 004] Could not import run-history.json:', (e as Error).message);
    }
  } else {
    console.log('[migration 004] run-history.json not found — skipping');
  }

  // ── heal-store.json ───────────────────────────────────────────────────────
  if (fs.existsSync(HEAL_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(HEAL_PATH, 'utf-8'));
      const entries = Object.values(raw) as any[];
      let healCount = 0;
      for (const e of entries) {
        await db.insertInto('heal_events')
          .values({
            run_id:            e.runId            ?? 'legacy-import',
            page:              e.page             ?? 'unknown',
            element:           e.element          ?? e.key ?? 'unknown',
            original_strategy: e.originalStrategy ?? e.original_strategy ?? '',
            healed_strategy:   e.healedSelector   ?? e.healed_strategy   ?? '',
            heal_type:         e.source           ?? e.heal_type         ?? 'smart-locator',
            confidence:        e.confidence       ?? 1.0,
            consecutive_count: e.consecutiveSuccesses ?? e.consecutive_count ?? 0,
            promoted:          e.promoted ? 1 : 0,
            healed_at:         e.firstHealed      ?? e.healed_at         ?? new Date().toISOString(),
          })
          .execute();
        healCount++;
      }
      console.log(`[migration 004] Imported ${healCount} heal event(s) from heal-store.json`);
    } catch (e) {
      console.warn('[migration 004] Could not import heal-store.json:', (e as Error).message);
    }
  } else {
    console.log('[migration 004] heal-store.json not found — skipping');
  }

  // ── trends.json ───────────────────────────────────────────────────────────
  /*
   * TD-118: trends import removed.
   *
   * The onConflict(['app_name','period']) here required the unique index
   * created by migration 005_trends_unique — which runs AFTER this migration
   * on a fresh DB. This silently failed (caught + warned) on every fresh DB,
   * i.e. every CI runner, since the day it shipped.
   *
   * trends.json is a fossil (TD-117) — trends data lives in the DB via
   * TrendRepository writes, not file import.
   *
   * The run-history and heal-store imports above remain LIVE — CI runners
   * repopulate the DB from git-committed JSON on every fresh runner.
   * Do not remove them.
   *
   * This block intentionally does nothing. Migration history is never
   * rewritten (Nova ruling) — the migration keeps its name and position;
   * only the broken trends insert is gone.
   */
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Intentional no-op — legacy JSON files are not restored on rollback.
}
