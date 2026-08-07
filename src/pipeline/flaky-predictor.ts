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

/**
 * flaky-predictor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Flaky Test Predictions — Pure Consumer (TD-127)
 * FORGE — Autonomous Quality Engineering
 *
 * ARCHITECTURAL RULE (Nova TD-120 Q4 / TD-127 ruling):
 * One computation, many consumers. FlakyPredictorStage (AnalysisPipeline,
 * triggered by results-store on every run) is the ONLY writer of the
 * flaky_analysis table. This script READS flaky_analysis and formats it for
 * humans — it never scores, never writes the DB, never calls AI.
 *
 * insufficient-evidence is a valid, honest state (Nova Q3, Option B): tests
 * without enough run history are reported in their own section, never
 * silently dropped and never guessed at.
 *
 * Usage:
 *   npx tsx src/pipeline/flaky-predictor.ts                ← JSON + HTML report
 *   npx tsx src/pipeline/flaky-predictor.ts --summary      ← terminal summary only
 *   npx tsx src/pipeline/flaky-predictor.ts --threshold=60 ← custom at-risk threshold
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs     from 'fs';
import * as path   from 'path';
import * as dotenv from 'dotenv';
import { FlakyAnalysisRepository } from '../core/storage/repositories/FlakyAnalysisRepository'
import { RunRepository }           from '../core/storage/repositories/RunRepository'
import { FlakyAnalysis }           from '../core/storage/types'
import { getAppName }              from '../core/config/appConfig'
dotenv.config();

// ── Output paths ──────────────────────────────────────────────────────────────

const REPORT_PATH = path.join('reports', 'flaky-prediction-report.html');
const JSON_PATH   = path.join('reports', 'flaky-predictions.json');

// ── Output contract ───────────────────────────────────────────────────────────

interface FlakyPredictionsFile {
  schemaVersion: 1;
  generatedAt:   string;
  /** run_id of the most recent run that informed this projection, or null. */
  sourceRun:     string | null;
  appName:       string;
  summary: {
    totalTests:            number;
    scoredTests:           number;
    insufficientDataTests: number;
    highRisk:              number;   // scored, flaky_score > 60
    degrading:             number;
  };
  predictions: FlakyAnalysis[];      // scored only, top 10 by flaky_score
  degrading:   FlakyAnalysis[];
  insufficientEvidence: {
    count:   number;
    testIds: string[];
    message: string;
  };
}

const SIGNAL_LABELS: [keyof FlakyAnalysis, string][] = [
  ['signal_timing',      'timing'],
  ['signal_selector',    'selector'],
  ['signal_data',        'data'],
  ['signal_env',         'environment'],
  ['signal_concurrency', 'concurrency'],
  ['signal_network',     'network'],
];

function signalsOf(r: FlakyAnalysis): string[] {
  return SIGNAL_LABELS.filter(([col]) => (r[col] as number) === 1).map(([, label]) => label);
}

// ── HTML report (presentation only — no computation) ─────────────────────────

function generateReport(out: FlakyPredictionsFile): void {
  const scoreColor = (s: number) => s > 60 ? '#ef4444' : s > 30 ? '#f59e0b' : '#22c55e';

  const cardsHTML = out.predictions.map(r => `
    <div class="card">
      <div class="card-header" style="border-left:4px solid ${scoreColor(r.flaky_score)}">
        <div class="card-title-row">
          <div>
            <span class="badge" style="background:${scoreColor(r.flaky_score)}">score ${r.flaky_score}</span>
            <span class="trend-badge">${r.trend} · confidence: ${r.confidence}</span>
          </div>
        </div>
        <h3 class="card-title">${r.test_id}</h3>
        <div class="card-meta">sample: ${r.sample_size} run(s) · analysed: ${r.analysis_date}${signalsOf(r).length ? ' · signals: ' + signalsOf(r).join(', ') : ''}</div>
      </div>
      <div class="card-body"><p class="ai-text">${r.recommendation}</p></div>
    </div>`).join('\n');

  const insufficientHTML = out.insufficientEvidence.count === 0 ? '' : `
    <div class="card insufficient">
      <div class="card-header" style="border-left:4px solid #64748b">
        <h3 class="card-title">Insufficient evidence — ${out.insufficientEvidence.count} test(s)</h3>
        <div class="card-meta">${out.insufficientEvidence.message}</div>
      </div>
      <div class="card-body"><ul class="signals">${out.insufficientEvidence.testIds.map(t => `<li>${t}</li>`).join('')}</ul></div>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FORGE Flaky Predictions</title>
  <style>
    :root { --bg:#0d0f14; --surface:#13161d; --border:#1e2330; --text:#e2e8f0; --muted:#64748b; --accent:#38bdf8; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
    .header { border-bottom:1px solid var(--border); padding:2rem; }
    .header-inner { max-width:1100px; margin:0 auto; }
    .logo { font-size:.7rem; font-family:monospace; color:var(--accent); letter-spacing:.2em; text-transform:uppercase; margin-bottom:.4rem; }
    h1 { font-size:1.6rem; }
    .header-meta { font-family:monospace; font-size:.75rem; color:var(--muted); margin-top:.5rem; }
    .stats { display:flex; gap:1rem; margin-top:1.4rem; flex-wrap:wrap; }
    .stat { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:.8rem 1.2rem; min-width:90px; text-align:center; }
    .stat-number { font-size:1.5rem; font-weight:700; font-family:monospace; }
    .stat-label { font-size:.65rem; color:var(--muted); text-transform:uppercase; letter-spacing:.1em; margin-top:.2rem; }
    .cards { max-width:1100px; margin:1.5rem auto 3rem; padding:0 2rem; display:flex; flex-direction:column; gap:1rem; }
    .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
    .card-header { padding:1rem 1.4rem; }
    .card-title-row { display:flex; justify-content:space-between; margin-bottom:.5rem; }
    .badge { padding:.2rem .7rem; border-radius:100px; font-size:.7rem; font-weight:700; color:#fff; }
    .trend-badge { margin-left:.5rem; font-size:.78rem; color:var(--muted); }
    .card-title { font-size:.85rem; font-weight:600; line-height:1.3; word-break:break-all; }
    .card-meta { font-family:monospace; font-size:.72rem; color:var(--muted); margin-top:.4rem; }
    .card-body { padding:1rem 1.4rem; border-top:1px solid var(--border); }
    .ai-text { font-size:.82rem; line-height:1.5; }
    .signals { list-style:none; }
    .signals li { font-size:.75rem; font-family:monospace; color:var(--muted); line-height:1.6; word-break:break-all; }
  </style>
</head>
<body>
<header class="header">
  <div class="header-inner">
    <div class="logo">FORGE — flaky_analysis projection</div>
    <h1>Flaky Test Predictions</h1>
    <div class="header-meta">app: ${out.appName} · generated: ${out.generatedAt} · source run: ${out.sourceRun ?? 'n/a'} · computed by FlakyPredictorStage</div>
    <div class="stats">
      <div class="stat"><div class="stat-number">${out.summary.totalTests}</div><div class="stat-label">Tests</div></div>
      <div class="stat"><div class="stat-number">${out.summary.scoredTests}</div><div class="stat-label">Scored</div></div>
      <div class="stat"><div class="stat-number" style="color:#ef4444">${out.summary.highRisk}</div><div class="stat-label">High risk</div></div>
      <div class="stat"><div class="stat-number" style="color:#f59e0b">${out.summary.degrading}</div><div class="stat-label">Degrading</div></div>
      <div class="stat"><div class="stat-number" style="color:#64748b">${out.summary.insufficientDataTests}</div><div class="stat-label">Insufficient data</div></div>
    </div>
  </div>
</header>
<div class="cards">${cardsHTML || '<div class="card"><div class="card-header"><h3 class="card-title">No scored predictions yet.</h3></div></div>'}${insufficientHTML}</div>
</body>
</html>`;

  fs.writeFileSync(REPORT_PATH, html, 'utf8');
  console.log(`📊 Report saved: ${REPORT_PATH}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args        = process.argv.slice(2);
  const summaryOnly = args.includes('--summary');
  const threshold   = parseInt(args.find(a => a.startsWith('--threshold='))?.split('=')[1] ?? '25');
  const appName     = getAppName();

  console.log('═══════════════════════════════════════════════════');
  console.log('  FORGE — Flaky Test Predictions (flaky_analysis)');
  console.log('═══════════════════════════════════════════════════');

  // Pure reads — FlakyPredictorStage computed all of this at results-store time.
  const repo      = new FlakyAnalysisRepository();
  const all       = await repo.findByApp(appName);
  const topFlaky  = await repo.findTopFlaky(appName, 10);
  const degrading = await repo.findDegrading(appName);

  if (all.length === 0) {
    console.log(`\n⚠️  No flaky_analysis rows for "${appName}". Run the test suite first`);
    console.log('   (results-store triggers the AnalysisPipeline, which writes flaky_analysis).\n');
  }

  // Nova Q3 (Option B): insufficient-evidence is separated, never dropped.
  const scored       = all.filter(r => r.confidence !== 'insufficient-evidence');
  const insufficient = all.filter(r => r.confidence === 'insufficient-evidence');

  const latestRun = (await new RunRepository().findByApp(appName, 1))[0] ?? null;

  const out: FlakyPredictionsFile = {
    schemaVersion: 1,
    generatedAt:   new Date().toISOString(),
    sourceRun:     latestRun?.run_id ?? null,
    appName,
    summary: {
      totalTests:            all.length,
      scoredTests:           scored.length,
      insufficientDataTests: insufficient.length,
      highRisk:              scored.filter(r => r.flaky_score > 60).length,
      degrading:             degrading.length,
    },
    predictions: topFlaky.filter(r => r.confidence !== 'insufficient-evidence'),
    degrading,
    insufficientEvidence: {
      count:   insufficient.length,
      testIds: insufficient.map(r => r.test_id),
      message: `${insufficient.length} test(s) need more run history before flaky risk can be estimated.`,
    },
  };

  fs.writeFileSync(JSON_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`📁 Predictions saved: ${JSON_PATH}`);

  // Terminal summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  FLAKINESS SUMMARY');
  console.log('═══════════════════════════════════════════════════');

  for (const r of scored) {
    const bar = '█'.repeat(Math.round(r.flaky_score / 10)).padEnd(10, '░');
    console.log(`  [${String(r.flaky_score).padStart(3)}] ${bar}  ${r.test_id} (${r.trend}, confidence: ${r.confidence})`);
  }
  if (insufficient.length > 0) {
    console.log(`  ⏳ ${out.insufficientEvidence.message}`);
  }

  const atRisk = scored.filter(r => r.flaky_score >= threshold);
  console.log('\n  ─────────────────────────────────────────────────');
  console.log(`  Total: ${all.length} tests | Scored: ${scored.length} | At-risk (≥${threshold}): ${atRisk.length} | Insufficient data: ${insufficient.length}`);
  console.log('═══════════════════════════════════════════════════\n');

  if (summaryOnly) return;

  // TD-127: HTML written and its path logged — no browser-open side effect.
  generateReport(out);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
