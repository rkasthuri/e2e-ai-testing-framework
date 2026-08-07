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
 * trend-analysis.ts
 * ─────────────────────────────────────────────────────────────
 * Step 6 — Trend Analysis / Predictive Intelligence
 * FORGE — Autonomous Quality Engineering
 *
 * Source:  RunRepository (runs table) — per-run summary only.
 * Writes:  reports/trend-dashboard.html  (interactive visual dashboard)
 *          reports/trend-report.md       (text summary)
 *
 * Run:  npx tsx src/pipeline/trend-analysis.ts
 *       npx tsx src/pipeline/trend-analysis.ts --open
 *
 * TD-051: rewritten to consume the real RunsTable shape directly. Per-test
 * trend detail (risk tiers, unstable-tests table, per-run failure/flaky lists)
 * has NO data source — test_results is never populated and TrendsTable is
 * per-day, not per-run — so those sections are stubbed visibly rather than
 * rendered as misleading empty/zero data. See TD-056.
 * ─────────────────────────────────────────────────────────────
 */

import * as fs     from 'fs';
import * as dotenv from 'dotenv';
import { RunRepository } from '../core/storage/repositories/RunRepository'
import { Run }           from '../core/storage/types'
import { aiCall }        from '../core/ai/AiClient'
import { getAppName }    from '../core/config/appConfig'

dotenv.config();

// Shown wherever per-test detail would have rendered (no DB source — TD-056).
const PER_TEST_STUB =
  'Per-test trend data not yet available (requires test_results population — see TD-056)';

// ── Types ────────────────────────────────────────────────────

interface RunSummary {
  runId:      string;
  startedAt:  string;
  durationMs: number;
  total:      number;
  passed:     number;
  failed:     number;
  skipped:    number;
  passRate:   number;   // 0..100, computed from passed / total_tests
}

interface AnalysisSummary {
  totalRuns:            number;
  currentPassRate:      string;
  avgPassRate:          string;
  consecutiveCleanRuns: number;
  durationTrend:        string;
  aiNarrative:          string;
}

// ── Config ───────────────────────────────────────────────────

const CONFIG = {
  outputHtml:  'reports/trend-dashboard.html',
  outputMd:    'reports/trend-report.md',
  model:       'claude-sonnet-4-5' as const,
  openBrowser: process.argv.includes('--open'),
};

// ── RunsTable row → per-run summary (TD-051) ──────────────────

function toRunSummary(r: Run): RunSummary {
  const total    = r.total_tests ?? 0;
  const passRate = total > 0 ? (r.passed / total) * 100 : 0;   // guard divide-by-zero
  return {
    runId:      r.run_id,
    startedAt:  r.started_at,
    durationMs: r.duration_ms,
    total,
    passed:     r.passed,
    failed:     r.failed,
    skipped:    r.skipped,
    passRate,
  };
}

// ── Entry point ───────────────────────────────────────────────

async function main() {
  console.log('\n📈 Trend Analysis — building interactive dashboard...\n');

  const runRepo = new RunRepository()
  const dbRuns  = await runRepo.findByApp(getAppName(), 100)

  if (!dbRuns.length) {
    console.error('❌ No run data in database. Run npm run test:all a few times first.\n');
    process.exit(1);
  }

  // findByApp returns DESC (newest first). Reverse to chronological ascending
  // so every "latest" (runs[last]), slice(-N), first-vs-second-half, and streak
  // calculation below reads naturally oldest→newest.
  const runs = [...dbRuns].reverse().map(toRunSummary)

  console.log(`  📊 Analyzing ${runs.length} runs (per-run summary from RunsTable)...`);

  const summary = await buildSummary(runs);
  const html    = buildDashboard(runs, summary);
  const md      = buildMarkdown(summary);

  fs.writeFileSync(CONFIG.outputHtml, html, 'utf-8');
  fs.writeFileSync(CONFIG.outputMd,   md,   'utf-8');

  printTerminal(summary);

  if (CONFIG.openBrowser) {
    const { execSync } = require('child_process');
    try { execSync(`start ${CONFIG.outputHtml}`); } catch {}
  }
}

// ── Build summary ─────────────────────────────────────────────

async function buildSummary(runs: RunSummary[]): Promise<AnalysisSummary> {
  const last  = runs[runs.length - 1];
  const rates = runs.map(r => r.passRate);
  const avg   = (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1) + '%';

  // Clean streak: consecutive most-recent runs with zero failures. Flaky is
  // unknowable per-run without test_results, so it is not part of the streak.
  let streak = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].failed === 0) streak++; else break;
  }

  const recentN   = Math.min(3, runs.length);
  const recentAvg = runs.slice(-recentN).reduce((s, r) => s + r.durationMs, 0) / recentN;
  const firstAvg  = runs.slice(0,  recentN).reduce((s, r) => s + r.durationMs, 0) / recentN;
  const pct       = firstAvg > 0 ? Math.round(((recentAvg - firstAvg) / firstAvg) * 100) : 0;
  const durTrend  = pct <= -10 ? `${Math.abs(pct)}% faster (${Math.round(recentAvg / 1000)}s avg)`
                  : pct >=  10 ? `${pct}% slower (${Math.round(recentAvg / 1000)}s avg)`
                  : `stable at ${Math.round(recentAvg / 1000)}s avg`;

  const aiNarrative = await generateNarrative(runs, { streak, avg, durTrend });

  return {
    totalRuns:            runs.length,
    currentPassRate:      last.passRate.toFixed(1) + '%',
    avgPassRate:          avg,
    consecutiveCleanRuns: streak,
    durationTrend:        durTrend,
    aiNarrative,
  };
}

// ── AI narrative ──────────────────────────────────────────────

async function generateNarrative(runs: RunSummary[], meta: Record<string, any>): Promise<string> {
  try {
    const last5 = runs.slice(-5).map(r =>
      `${r.runId}: ${r.passRate.toFixed(1)}% (${r.failed} failed)`).join('\n');
    const response = await aiCall({
      operation: 'trend-narrative',
      appName:   getAppName(),
      messages:  [{ role: 'user', content: `Write a 2-sentence QA framework health summary. Be specific with numbers. No markdown.\n\nLast 5 runs (pass rate, failures):\n${last5}\nClean streak: ${meta.streak}\nAvg pass rate: ${meta.avg}\nDuration: ${meta.durTrend}\n\nNote: per-test failure/flaky detail is not available this run — comment only on run-level pass rate, failure counts, and duration.` }],
      maxTokens: 150,
    })
    return response.content
  } catch {
    return `Framework has achieved ${meta.streak} consecutive clean runs with ${meta.avg} average pass rate.`;
  }
}

// ── Build interactive HTML dashboard ─────────────────────────

function buildDashboard(runs: RunSummary[], summary: AnalysisSummary): string {
  // Per-run scalars are real (RunsTable). Per-test detail is stubbed (TD-056).
  const runData = runs.map(r => ({
    id:     r.runId.slice(0, 20),
    pass:   Math.round(r.passRate * 10) / 10,
    failed: r.failed,
    dur:    Math.round(r.durationMs / 1000),
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trend Dashboard — FORGE</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;color:#1a1a1a;padding:2rem}
h1{font-size:22px;font-weight:500;margin-bottom:4px}
.sub{font-size:13px;color:#888;margin-bottom:1.5rem}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:1.5rem}
.metric{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:1rem}
.mlabel{font-size:12px;color:#888;margin-bottom:4px}
.mval{font-size:22px;font-weight:500}
.mval.g{color:#059669}.mval.r{color:#dc2626}.mval.a{color:#d97706}
.card{background:#fff;border:1px solid #e8e8e8;border-radius:12px;padding:1.25rem;margin-bottom:1rem}
.ctitle{font-size:13px;color:#888;margin-bottom:6px}
.hint{font-size:11px;color:#aaa;margin-bottom:8px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px}
.li{display:flex;align-items:center;gap:5px;font-size:12px;color:#666}
.ld{width:10px;height:10px;border-radius:2px;flex-shrink:0}
.drill{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:1rem;margin-top:10px;display:none}
.dtitle{font-size:13px;font-weight:500;color:#1d4ed8;margin-bottom:8px}
.narrative{background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:1rem 1.25rem;margin-bottom:1.5rem}
.nlabel{font-size:12px;color:#1d4ed8;font-weight:500;margin-bottom:6px}
.ntext{font-size:13px;color:#1e40af;line-height:1.6}
.stub{background:#fffbeb;border:1px dashed #f59e0b}
.stub .ctitle{color:#92400e}
.stub-body{font-size:13px;color:#92400e;line-height:1.6}
.stub-list{font-size:12px;color:#b45309;margin-top:6px}
footer{margin-top:2rem;font-size:12px;color:#aaa;text-align:center}
</style>
</head>
<body>
<h1>Trend Dashboard</h1>
<p class="sub">Generated ${new Date().toLocaleString()} &nbsp;·&nbsp; ${runs.length} runs &nbsp;·&nbsp; per-run summary from RunsTable</p>

<div class="metrics">
  <div class="metric"><div class="mlabel">Total runs</div><div class="mval">${summary.totalRuns}</div></div>
  <div class="metric"><div class="mlabel">Current pass rate</div><div class="mval g">${summary.currentPassRate}</div></div>
  <div class="metric"><div class="mlabel">Average pass rate</div><div class="mval ${parseFloat(summary.avgPassRate) >= 95 ? 'g' : 'a'}">${summary.avgPassRate}</div></div>
  <div class="metric"><div class="mlabel">Clean streak</div><div class="mval g">${summary.consecutiveCleanRuns} runs</div></div>
</div>

<div class="narrative">
  <div class="nlabel">AI analysis</div>
  <div class="ntext">${summary.aiNarrative}</div>
</div>

<div class="card">
  <div class="ctitle">Pass rate &amp; failures per run</div>
  <div class="hint">Click any data point for that run's run-level numbers</div>
  <div class="legend">
    <div class="li"><div class="ld" style="background:#059669"></div>Pass rate %</div>
    <div class="li"><div class="ld" style="background:#dc2626;height:3px;margin-top:3px"></div>Failures</div>
  </div>
  <div style="position:relative;height:240px"><canvas id="c1" role="img" aria-label="Pass rate trend across ${runs.length} runs">Pass rate trend from first to last run.</canvas></div>
  <div class="drill" id="d1"></div>
</div>

<div class="card">
  <div class="ctitle">Duration per run (seconds)</div>
  <div class="hint">Click a bar to compare with previous run — ${summary.durationTrend}</div>
  <div class="legend">
    <div class="li"><div class="ld" style="background:#7c3aed"></div>Duration (s)</div>
  </div>
  <div style="position:relative;height:190px"><canvas id="c3" role="img" aria-label="Duration bar chart across ${runs.length} runs">Duration trend across runs.</canvas></div>
  <div class="drill" id="d3"></div>
</div>

<div class="card stub">
  <div class="ctitle">Per-test analysis</div>
  <div class="stub-body">${PER_TEST_STUB}</div>
  <div class="stub-list">Unavailable sections: risk-tier breakdown, unstable-tests table, per-run failure drill-down, flaky counts, browser-bias.</div>
</div>

<footer>FORGE &nbsp;·&nbsp; Step 6 Trend Analysis &nbsp;·&nbsp; rkasthuri/forge-framework</footer>

<script>
const RD=${JSON.stringify(runData)};
const STUB=${JSON.stringify(PER_TEST_STUB)};

const labels=RD.map((_,i)=>'R'+(i+1));
const rates =RD.map(r=>r.pass);
const fails =RD.map(r=>r.failed);
const durs  =RD.map(r=>r.dur);

function show(id,html){const d=document.getElementById(id);d.style.display='block';d.innerHTML=html}
function hide(id){document.getElementById(id).style.display='none'}

new Chart(document.getElementById('c1'),{
  type:'line',
  data:{labels,datasets:[
    {label:'Pass %',data:rates,borderColor:'#059669',backgroundColor:'rgba(5,150,105,0.06)',fill:true,tension:0.3,yAxisID:'y',
     pointRadius:6,pointHoverRadius:9,pointBackgroundColor:rates.map(v=>v===100?'#059669':v<80?'#dc2626':'#d97706')},
    {label:'Fails',data:fails,borderColor:'#dc2626',borderDash:[4,3],tension:0.3,yAxisID:'y2',
     pointRadius:4,pointHoverRadius:7,pointBackgroundColor:'#dc2626'}
  ]},
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>'Run R'+(i[0].index+1)+' ('+RD[i[0].index].id+')'}}},
    onClick:(_,els)=>{
      if(!els.length){hide('d1');return}
      const r=RD[els[0].index];
      show('d1','<div class="dtitle">R'+(els[0].index+1)+' ('+r.id+') — '+r.pass+'% pass · '+r.failed+' failure(s) · '+r.dur+'s</div><div style="font-size:12px;color:#1e40af">'+STUB+'</div>');
    },
    scales:{
      y:{min:0,max:110,ticks:{callback:v=>v+'%',font:{size:11}},grid:{color:'rgba(0,0,0,0.05)'}},
      y2:{min:0,max:Math.max(...fails,1)+3,position:'right',ticks:{font:{size:11}},grid:{display:false}},
      x:{ticks:{font:{size:10},autoSkip:false,maxRotation:0},grid:{display:false}}
    }
  }
});

new Chart(document.getElementById('c3'),{
  type:'bar',
  data:{labels,datasets:[{label:'Duration',data:durs,
    backgroundColor:durs.map(v=>v>200?'#d97706':v<100?'#059669':'#7c3aed'),borderRadius:3}]},
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false}},
    onClick:(_,els)=>{
      if(!els.length){hide('d3');return}
      const i=els[0].index;const r=RD[i];
      const prev=i>0?RD[i-1]:null;
      const chg=prev&&prev.dur?Math.round(((r.dur-prev.dur)/prev.dur)*100):0;
      const arrow=chg>0?'↑':'↓';
      show('d3','<div class="dtitle">R'+(i+1)+' — '+r.dur+'s'+(prev?' ('+arrow+Math.abs(chg)+'% vs R'+i+')':'')+'</div><div style="font-size:12px;color:#1e40af">Pass rate: '+r.pass+'%  ·  Failures: '+r.failed+'</div>');
    },
    scales:{
      y:{ticks:{callback:v=>v+'s',font:{size:11}},grid:{color:'rgba(0,0,0,0.05)'}},
      x:{ticks:{font:{size:10},autoSkip:false,maxRotation:0},grid:{display:false}}
    }
  }
});
</script>
</body>
</html>`;
}

// ── Markdown ──────────────────────────────────────────────────

function buildMarkdown(s: AnalysisSummary): string {
  return [
    '# Trend Report',
    `**Generated:** ${new Date().toLocaleString()}`,
    '',
    '## Summary',
    `- Total runs: ${s.totalRuns}`,
    `- Current pass rate: ${s.currentPassRate}`,
    `- Average pass rate: ${s.avgPassRate}`,
    `- Clean streak: ${s.consecutiveCleanRuns} runs`,
    `- Duration: ${s.durationTrend}`,
    '',
    '## AI Analysis',
    s.aiNarrative,
    '',
    '## Per-Test Analysis',
    `_${PER_TEST_STUB}_`,
    '',
    'Unavailable: risk-tier breakdown, unstable-tests table, per-run failure detail, flaky counts, browser-bias.',
  ].join('\n');
}

// ── Terminal ──────────────────────────────────────────────────

function printTerminal(s: AnalysisSummary) {
  console.log('\n──────────────────────────────────────');
  console.log('  TREND ANALYSIS COMPLETE');
  console.log('──────────────────────────────────────');
  console.log(`  📊 Runs:         ${s.totalRuns}`);
  console.log(`  ✅ Pass rate:    ${s.currentPassRate} (avg ${s.avgPassRate})`);
  console.log(`  🏆 Clean streak: ${s.consecutiveCleanRuns} runs`);
  console.log(`  ⏱️  Duration:     ${s.durationTrend}`);
  console.log(`  ℹ️  ${PER_TEST_STUB}`);
  console.log('──────────────────────────────────────');
  console.log(`  🌐 ${CONFIG.outputHtml}`);
  console.log(`  📝 ${CONFIG.outputMd}`);
  console.log('──────────────────────────────────────\n');
  console.log(`  AI: ${s.aiNarrative.slice(0, 120)}...\n`);
}

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
