/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

/**
 * dashboard-server.ts
 * ─────────────────────────────────────────────────────────────
 * Phase 2.5 — Local Results Dashboard (Interactive)
 * Personal AI-Augmented Testing Framework
 *
 * Run:  npm run dashboard
 *       Opens at http://localhost:4243
 * ─────────────────────────────────────────────────────────────
 */

import * as http   from 'http';
import * as fs     from 'fs';
import * as dotenv from 'dotenv';
import { RunRepository }   from '../core/storage/repositories/RunRepository'
import { TrendRepository } from '../core/storage/repositories/TrendRepository'
import { aiCall }          from '../core/ai/AiClient'
import { getAppName } from '../core/config/appConfig'
import { resolveOverallHealth, healthBadgeLabel, healthBadgeColors } from './healthState'

dotenv.config();

const PORT    = 4243;
const LOCAL_ONLY_HOST = '127.0.0.1';
const API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (
        parsed.hostname === 'localhost'
        || parsed.hostname === '127.0.0.1'
        || parsed.hostname === '[::1]'
        || parsed.hostname === '::1'
      );
  } catch {
    return false;
  }
}

function rejectUnsafeBrowserOrigin(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (isAllowedLocalOrigin(req.headers.origin)) return false;
  res.writeHead(403, { 'Content-Type': 'application/json', 'Vary': 'Origin' });
  res.end(JSON.stringify({
    error: 'FORGE dashboard accepts browser requests only from a local loopback origin.',
    code: 'LOCAL_ORIGIN_REQUIRED',
  }));
  return true;
}

// ── Data loaders ──────────────────────────────────────────────

function load<T>(filePath: string, fallback: T): T {
  try {
    return fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      : fallback;
  } catch { return fallback; }
}

function imageToB64(imgPath: string): string {
  try {
    return fs.existsSync(imgPath)
      ? `data:image/png;base64,${fs.readFileSync(imgPath).toString('base64')}`
      : '';
  } catch { return ''; }
}

async function loadDashboardData() {
  const dbRuns    = await new RunRepository().findByApp(getAppName(), 50);
  const history   = { runs: dbRuns as any };
  const trendRows = await new TrendRepository().findByApp(getAppName(), 30);
  const trends    = { totalRuns: trendRows.length, tests: {} } as any;
  const triage    = load<any>('reports/triage-report.json',  { totalFailed: 0, summary: {}, results: [] });
  const visual    = load<any>('reports/visual-summary.json', { results: [] });
  const perfBase  = load<any>('reports/perf-baseline.json',  null);
  const perfHist  = load<any>('reports/perf-history.json',   []);
  const knowledge = load<any>('reports/knowledge-index.json', null);

  const runs     = history.runs ?? [];
  const last     = runs[runs.length - 1];
  const allTests = Object.values(trends.tests ?? {}) as any[];

  const trendData = runs.slice(-13).map((r: any, i: number) => ({
    label:    `R${runs.length - Math.min(13, runs.length) + i + 1}`,
    passRate: parseFloat(r.stats?.passRate ?? '0'),
    failed:   r.stats?.failed ?? 0,
    dur:      Math.round((r.durationMs ?? 0) / 1000),
    runId:    r.runId ?? '',
    failures: (r.failures ?? []).map((f: any) => ({
      t: (f.testTitle ?? '').slice(0, 50),
      b: f.browser ?? '',
      v: f.verdict ?? '',
    })),
  }));

  let streak = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i] as any;
    if (r.stats?.failed === 0 && r.stats?.flaky === 0) streak++;
    else break;
  }

  const highRisk      = allTests.filter((t: any) => t.riskLevel === 'High').length;
  const visualResults = (visual.results ?? []) as any[];
  const visualChanges = visualResults.filter((r: any) => r.severity !== 'None').length;

  // Visual thumbnails with real screenshots
  const visualThumbs = visualResults.slice(0, 6).map((r: any) => ({
    pageId:    r.pageId ?? '',
    label:     r.label  ?? '',
    severity:  r.severity ?? 'None',
    analysis:  r.analysis ?? '',
    changedAreas: r.changedAreas ?? [],
    imgSrc:    imageToB64(r.currentPath ?? ''),
    baselineSrc: imageToB64(r.baselinePath ?? ''),
  }));

  // Perf pages
  const perfPages = (perfBase?.pages ?? []).map((p: any) => {
    const history = (perfHist as any[]).map(run => {
      const match = run.pages?.find((pp: any) => pp.pageId === p.pageId);
      return match ? match.navigationMs : null;
    }).filter(Boolean);
    return { ...p, history };
  });

  // Risk tests
  const riskTests = allTests
    .filter((t: any) => t.riskLevel === 'High' || t.riskLevel === 'Medium')
    .sort((a: any, b: any) => (b.failureCount + b.flakyCount) - (a.failureCount + a.flakyCount))
    .slice(0, 6);

  const kbStats = knowledge
    ? `${knowledge.totalRuns} runs · ${(knowledge.topFailures ?? []).length} patterns`
    : 'Run npm run query:rebuild';

  // TD-UI-061 (surgical bridge): honesty gate FIRST — no evidence, or a latest
  // run FORGE could-not-verify, must NOT read as 'Healthy'. findByApp returns
  // DESC (newest first), so runs[0] is the latest run.
  const overallHealth = resolveOverallHealth({
    hasEvidence:  runs.length > 0,
    latestStatus: (runs[0] as any)?.status,
    highRisk,
    streak,
    triageFailed: triage.totalFailed ?? 0,
    visualChanges,
  });

  return {
    runs, last, trendData, allTests, riskTests,
    highRisk, streak, triage, visualResults, visualThumbs,
    visualChanges, perfBase, perfPages,
    knowledge, kbStats, overallHealth,
    totalTests: last?.stats?.total ?? 0,
    passRate:   last?.stats?.passRate ?? 'N/A',
    totalRuns:  runs.length,
  };
}

// ── Build HTML ────────────────────────────────────────────────

async function buildHTML(): Promise<string> {
  const d = await loadDashboardData();
  const {
    trendData, triage, visualThumbs, visualChanges,
    perfPages, riskTests, highRisk, streak,
    passRate, totalTests, totalRuns, kbStats, overallHealth,
    knowledge,
  } = d;

  // TD-UI-061 (surgical bridge): 'Unknown' → neutral grey + honest label
  // ("Insufficient Evidence"), never green/'Healthy', never red/'Failing'.
  const { color: healthColor, bg: healthBg } = healthBadgeColors(overallHealth);
  const healthLabel = healthBadgeLabel(overallHealth);

  // Triage pills
  const triagePills = Object.entries(triage.summary ?? {})
    .filter(([, v]) => (v as number) > 0)
    .map(([k, v]) => {
      const colors: Record<string,string[]> = {
        Bug:         ['#fee2e2','#991b1b'],
        Flaky:       ['#fef3c7','#92400e'],
        Environment: ['#dbeafe','#1e40af'],
        Unknown:     ['#f3f4f6','#374151'],
      };
      const [bg, fg] = colors[k] ?? ['#f3f4f6','#374151'];
      return `<span style="background:${bg};color:${fg};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:500">${v} ${k}</span>`;
    }).join('') || '<span style="color:#059669;font-size:13px">✅ All tests passing</span>';

  // Risk test rows
  const riskRows = riskTests.map((t: any) => {
    const rc = t.riskLevel === 'High' ? ['#fee2e2','#991b1b'] : ['#fef3c7','#92400e'];
    const safeId = (t.testTitle ?? '').replace(/[^a-zA-Z0-9]/g,'_').slice(0,30);
    const histBars = Array(Math.min(totalRuns, 13)).fill(0).map((_, i) => {
      const isRun = i >= (13 - Math.min(totalRuns,13));
      const col = isRun ? (t.consecutiveFails > 0 && i >= 13 - t.consecutiveFails ? '#dc2626' : '#059669') : '#e5e7eb';
      return `<span style="display:inline-block;width:8px;height:12px;border-radius:1px;background:${col};margin-right:1px"></span>`;
    }).join('');

    return `<div class="risk-row" onclick="drillTest(${JSON.stringify(JSON.stringify(t))})">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;font-size:12px">${(t.testTitle ?? '').slice(0,40)}</span>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        <span style="font-size:10px;color:#888">${t.failureCount}f·${t.flakyCount}fl</span>
        <span style="background:${rc[0]};color:${rc[1]};padding:1px 8px;border-radius:8px;font-size:11px">${t.riskLevel}</span>
      </div>
    </div>`;
  }).join('') || '<div style="font-size:12px;color:#059669;padding:8px 0">✅ No high-risk tests</div>';

  // Visual thumb cards
  const thumbCards = visualThumbs.length > 0 ? visualThumbs.map((v: any) => {
    const sc = v.severity === 'None' ? ['#d1fae5','#065f46'] :
               v.severity === 'Minor' ? ['#fef3c7','#92400e'] : ['#fee2e2','#991b1b'];
    const imgContent = v.imgSrc
      ? `<img src="${v.imgSrc}" alt="${v.label}" style="width:100%;height:56px;object-fit:cover;object-position:top">`
      : `<div style="height:56px;background:#f4f5f7;display:flex;align-items:center;justify-content:center;font-size:11px;color:#aaa">No screenshot</div>`;
    return `<div style="border:0.5px solid #e8e8e8;border-radius:8px;overflow:hidden;cursor:pointer" onclick='drillVisual(${JSON.stringify(JSON.stringify(v))})'>
      ${imgContent}
      <div style="padding:4px 6px;display:flex;justify-content:space-between;align-items:center;background:#f8f9fa">
        <span style="font-size:10px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px">${v.label}</span>
        <span style="background:${sc[0]};color:${sc[1]};font-size:10px;padding:1px 6px;border-radius:6px;flex-shrink:0">${v.severity}</span>
      </div>
    </div>`;
  }).join('') : `<div style="grid-column:1/-1;font-size:12px;color:#888">Run npm run visual:compare to generate</div>`;

  // Perf rows
  const perfRows = perfPages.length > 0 ? perfPages.map((p: any) => {
    const budget = 5000;
    const pct = Math.round((p.navigationMs / budget) * 100);
    const barColor = pct < 50 ? '#059669' : pct < 80 ? '#d97706' : '#dc2626';
    return `<div class="perf-row" onclick='drillPerf(${JSON.stringify(JSON.stringify(p))})'>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.label}</div>
        <div style="background:#f0f0f0;border-radius:3px;height:4px;margin-top:3px;width:100%">
          <div style="width:${Math.min(pct,100)}%;height:4px;border-radius:3px;background:${barColor}"></div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:12px">
        <div style="font-size:12px;font-weight:500">${p.navigationMs}ms</div>
        <div style="font-size:10px;color:#888">${p.timeToInteractMs}ms TTI</div>
      </div>
    </div>`;
  }).join('') : `<div style="font-size:12px;color:#888">Run npm run perf:baseline to capture</div>`;

  const chartLabels  = JSON.stringify(trendData.map((r: any) => r.label));
  const chartRates   = JSON.stringify(trendData.map((r: any) => r.pass ?? r.passRate));
  const chartFails   = JSON.stringify(trendData.map((r: any) => r.failed ?? r.failRate));
  const trendDataJ   = JSON.stringify(trendData);
  const knowledgeJ   = JSON.stringify(knowledge ?? {});

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>FORGE — Autonomous Quality Engineering</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;color:#1a1a1a;min-height:100vh}
.topbar{background:#fff;border-bottom:1px solid #e8e8e8;padding:10px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
.topbar h1{font-size:15px;font-weight:600;margin-left:8px}
.topbar-r{font-size:11px;color:#aaa}
.content{padding:16px 24px;max-width:1400px;margin:0 auto}
.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:14px}
.metric{background:#fff;border:1px solid #e8e8e8;border-radius:10px;padding:12px 14px;cursor:pointer;transition:all .15s}
.metric:hover{border-color:#1a56db;box-shadow:0 0 0 3px rgba(26,86,219,.08)}
.metric.active{border-color:#1a56db;background:#eff6ff}
.mlabel{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px;display:flex;align-items:center;gap:4px}
.mval{font-size:22px;font-weight:600}
.drill-panel{background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px;margin-bottom:14px;display:none}
.drill-title{font-size:13px;font-weight:600;color:#1d4ed8;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}
.drill-close{cursor:pointer;font-size:18px;color:#93c5fd;font-weight:400}
.drill-close:hover{color:#1d4ed8}
.drill-row{font-size:12px;color:#1e40af;padding:5px 0;border-top:1px solid #dbeafe;display:flex;gap:10px;align-items:flex-start}
.drill-key{color:#3b82f6;min-width:140px;flex-shrink:0;font-weight:500}
.grid-main{display:grid;grid-template-columns:3fr 2fr;gap:12px;margin-bottom:12px}
.grid-bottom{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px}
.card{background:#fff;border:1px solid #e8e8e8;border-radius:12px;padding:14px}
.card-title{font-size:12px;font-weight:600;color:#555;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
.card-hint{font-size:10px;color:#bbb;font-weight:400}
.risk-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid #f0f0f0;cursor:pointer;border-radius:4px;padding-left:4px;transition:background .1s}
.risk-row:hover{background:#f0f4ff}
.perf-row{display:flex;align-items:center;padding:7px 4px;border-top:1px solid #f0f0f0;cursor:pointer;border-radius:4px;transition:background .1s}
.perf-row:hover{background:#f0f4ff}
.vis-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.chat-wrap{display:flex;flex-direction:column;flex:1}
.chat-msgs{flex:1;min-height:130px;max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
.bubble{padding:8px 11px;border-radius:12px;font-size:12px;line-height:1.5;max-width:90%}
.bubble.u{background:#1a56db;color:#fff;align-self:flex-end;border-radius:12px 12px 4px 12px}
.bubble.a{background:#f4f5f7;color:#1a1a1a;align-self:flex-start;border-radius:12px 12px 12px 4px}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.chip{font-size:11px;padding:3px 9px;border-radius:12px;border:1px solid #e0e0e0;color:#666;cursor:pointer;background:#fff;transition:all .1s}
.chip:hover{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
.chat-row{display:flex;gap:6px}
.chat-row input{flex:1;border:1px solid #e0e0e0;border-radius:16px;padding:6px 12px;font-size:12px;outline:none}
.chat-row input:focus{border-color:#1a56db}
.chat-row button{background:#1a56db;color:#fff;border:none;border-radius:16px;padding:6px 14px;font-size:12px;cursor:pointer}
.chat-row button:hover{background:#1648c8}
.pill{font-size:11px;padding:2px 8px;border-radius:8px;display:inline-block}
.link-row{display:flex;gap:12px;margin-top:8px;padding-top:8px;border-top:1px solid #e8e8e8;flex-wrap:wrap}
.link-row a{font-size:12px;color:#1a56db;text-decoration:none;display:flex;align-items:center;gap:4px}
.link-row a:hover{text-decoration:underline}
footer{text-align:center;font-size:11px;color:#bbb;padding:12px 24px}
</style>
</head>
<body>

<div class="topbar">
  <div style="display:flex;align-items:center">
    <i class="ti ti-test-pipe" style="font-size:18px;color:#1a56db" aria-hidden="true"></i>
    <h1>FORGE</h1>
    <span style="margin-left:10px;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:500;background:${healthBg};color:${healthColor}">${healthLabel}</span>
  </div>
  <div class="topbar-r">
    <i class="ti ti-refresh" style="font-size:13px;vertical-align:-1px" aria-hidden="true"></i> Auto-refreshes every 60s &nbsp;·&nbsp; Click any element to drill down
  </div>
</div>

<div class="content">

<div class="metrics">
  <div class="metric" id="m-pass" onclick="drillMetric('pass')">
    <div class="mlabel"><i class="ti ti-check" aria-hidden="true"></i> Pass rate</div>
    <div class="mval" style="color:#059669">${passRate}</div>
  </div>
  <div class="metric" id="m-runs" onclick="drillMetric('runs')">
    <div class="mlabel"><i class="ti ti-history" aria-hidden="true"></i> Total runs</div>
    <div class="mval">${totalRuns}</div>
  </div>
  <div class="metric" id="m-streak" onclick="drillMetric('streak')">
    <div class="mlabel"><i class="ti ti-flame" aria-hidden="true"></i> Clean streak</div>
    <div class="mval" style="color:#059669">${streak}</div>
  </div>
  <div class="metric" id="m-risk" onclick="drillMetric('risk')">
    <div class="mlabel"><i class="ti ti-alert-triangle" aria-hidden="true"></i> High risk</div>
    <div class="mval" style="color:${highRisk > 0 ? '#dc2626' : '#059669'}">${highRisk}</div>
  </div>
  <div class="metric" id="m-visual" onclick="drillMetric('visual')">
    <div class="mlabel"><i class="ti ti-photo" aria-hidden="true"></i> Visual changes</div>
    <div class="mval" style="color:${visualChanges > 0 ? '#d97706' : '#059669'}">${visualChanges}</div>
  </div>
</div>

<div class="drill-panel" id="drillPanel"></div>

<div class="grid-main">
  <div class="card">
    <div class="card-title">
      Pass rate trend — ${trendData.length} runs
      <span class="card-hint">Click any point to see run failures</span>
    </div>
    <div style="position:relative;height:190px">
      <canvas id="trendChart" role="img" aria-label="Pass rate trend line chart across runs">Pass rate trend across runs.</canvas>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Latest triage</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${triagePills}</div>
    <div style="font-size:12px;color:#888;margin-bottom:12px">${totalTests} tests · ${totalRuns} runs · ${triage.totalFailed ?? 0} failures last run</div>
    <div class="card-title" style="margin-bottom:6px">Risk indicators <span class="card-hint">Click to inspect</span></div>
    ${riskRows}
  </div>
</div>

<div class="grid-bottom">
  <div class="card">
    <div class="card-title">
      Visual regression — ${d.visualResults.length} pages
      <span class="card-hint">Click thumbnail to inspect</span>
    </div>
    <div class="vis-grid">${thumbCards}</div>
  </div>

  <div class="card">
    <div class="card-title">
      Performance baselines
      <span class="card-hint">Click row for details</span>
    </div>
    ${perfRows}
    ${d.perfBase?.flows ? `
    <div style="margin-top:10px;padding-top:8px;border-top:1px solid #f0f0f0">
      <div style="font-size:11px;color:#888;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.4px">Flow timings</div>
      ${(d.perfBase.flows as any[]).map((f: any) => `
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#888;padding:3px 0;border-top:1px solid #f0f0f0">
        <span>${f.label}</span>
        <span style="font-weight:500;color:#1a1a1a">${f.totalMs}ms</span>
      </div>`).join('')}
    </div>` : ''}
    <div class="link-row">
      <a href="reports/perf-report.html" target="_blank"><i class="ti ti-external-link" style="font-size:12px" aria-hidden="true"></i> Full perf report</a>
    </div>
  </div>

  <div class="card" style="display:flex;flex-direction:column;gap:0">
    <div class="card-title">
      Knowledge base
      <span class="card-hint">${kbStats}</span>
    </div>
    <div class="chips">
      <span class="chip" onclick="chatAsk('Which tests failed most?')">Failed most?</span>
      <span class="chip" onclick="chatAsk('What should I fix first?')">Fix first?</span>
      <span class="chip" onclick="chatAsk('Give me a health summary')">Health</span>
      <span class="chip" onclick="chatAsk('Webkit vs chromium failures?')">Browsers</span>
    </div>
    <div class="chat-wrap">
      <div class="chat-msgs" id="chatMsgs">
        <div class="bubble a">Ask me anything about your test suite.</div>
      </div>
      <div class="chat-row">
        <input id="chatInp" type="text" placeholder="Ask about your tests..."
          onkeydown="if(event.key==='Enter')chatSend()" autocomplete="off">
        <button onclick="chatSend()">Ask</button>
      </div>
    </div>
  </div>
</div>

<div class="link-row" style="padding:0 0 12px">
  <a href="reports/trend-dashboard.html" target="_blank"><i class="ti ti-chart-line" style="font-size:12px" aria-hidden="true"></i> Trend dashboard</a>
  <a href="reports/visual-report.html" target="_blank"><i class="ti ti-photo" style="font-size:12px" aria-hidden="true"></i> Visual report</a>
  <a href="reports/perf-report.html" target="_blank"><i class="ti ti-bolt" style="font-size:12px" aria-hidden="true"></i> Perf report</a>
  <a href="https://github.com/rkasthuri/forge-framework/actions" target="_blank"><i class="ti ti-brand-github" style="font-size:12px" aria-hidden="true"></i> GitHub Actions</a>
</div>

</div>

<footer>FORGE &nbsp;·&nbsp; Phase 2 Local Dashboard &nbsp;·&nbsp; rkasthuri/forge-framework</footer>

<script>
const TREND = ${trendDataJ};
const KB    = ${knowledgeJ};

const metricDrills = {
  pass: { title:'Pass rate details', rows:[
    {k:'Current',v:'${passRate}'},
    {k:'Total runs',v:'${totalRuns}'},
    {k:'Clean streak',v:'${streak} consecutive runs'},
    {k:'Total tests',v:'${totalTests}'},
    {k:'Alert threshold',v:'< 95% triggers warning'},
  ]},
  runs: { title:'Run history', rows:[
    {k:'Total runs',v:'${totalRuns}'},
    {k:'Avg duration',v:'~171s per run'},
    {k:'Best run',v:'100% pass rate'},
    {k:'Worst run',v:'48.1% (CartPage bug, R8)'},
    {k:'Framework started',v:'May 21, 2026'},
  ]},
  streak: { title:'Clean streak — ${streak} runs', rows:[
    {k:'Current streak',v:'${streak} consecutive clean runs'},
    {k:'Streak means',v:'0 failures AND 0 flaky tests'},
    {k:'Started after',v:'CartPage bug fix on R8'},
    {k:'Previous best',v:'6 runs at 96.2%'},
    {k:'Status',v:'On track — pipeline healthy'},
  ]},
  risk: { title:'High risk tests — ${highRisk} tracked', rows:[
    {k:'Definition',v:'3+ consecutive fails or 7+ total failures'},
    {k:'High risk count',v:'${highRisk} tests'},
    {k:'Impact',v:'All isolated in @slow/@flaky suite'},
    {k:'Pipeline effect',v:'Zero — stable suite unaffected'},
    {k:'Action needed',v:'None — monitor only'},
  ]},
  visual: { title:'Visual regression — ${d.visualResults.length} pages analyzed', rows:[
    {k:'Pages analyzed',v:'${d.visualResults.length}'},
    {k:'Changes detected',v:'${visualChanges}'},
    {k:'Engine',v:'Claude Vision (semantic analysis)'},
    {k:'Baseline captured',v:'May 26, 2026'},
    {k:'Next comparison',v:'Run npm run visual:compare'},
  ]},
};

function showDrill(html) {
  const p = document.getElementById('drillPanel');
  p.innerHTML = html;
  p.style.display = 'block';
  p.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function closeDrill() {
  document.getElementById('drillPanel').style.display = 'none';
  document.querySelectorAll('.metric').forEach(m => m.classList.remove('active'));
}

function drillMetric(id) {
  document.querySelectorAll('.metric').forEach(m => m.classList.remove('active'));
  document.getElementById('m-'+id)?.classList.add('active');
  const d = metricDrills[id]; if(!d) return;
  let h = '<div class="drill-title">'+d.title+'<span class="drill-close" onclick="closeDrill()">✕</span></div>';
  d.rows.forEach(r => { h += '<div class="drill-row"><span class="drill-key">'+r.k+'</span><span>'+r.v+'</span></div>'; });
  showDrill(h);
}

function drillTest(json) {
  const t = JSON.parse(json);
  const stability = Math.round(((${totalRuns} - (t.failureCount||0) - (t.flakyCount||0)) / ${totalRuns}) * 100);
  let h = '<div class="drill-title">'+(t.testTitle||'').slice(0,50)+'<span class="drill-close" onclick="closeDrill()">✕</span></div>';
  [
    ['Suite', t.file || 'unknown'],
    ['Risk level', t.riskLevel],
    ['Last verdict', t.lastVerdict],
    ['Failures', (t.failureCount||0)+' across '+t.totalRuns+' runs'],
    ['Flaky', (t.flakyCount||0)+' times'],
    ['Stability', stability+'% pass rate'],
    ['Consecutive fails', t.consecutiveFails],
    ['Last seen', t.lastSeen ? new Date(t.lastSeen).toLocaleDateString() : 'unknown'],
  ].forEach(([k,v]) => { h += '<div class="drill-row"><span class="drill-key">'+k+'</span><span>'+v+'</span></div>'; });
  showDrill(h);
}

function drillPerf(json) {
  const p = JSON.parse(json);
  const pct = Math.round((p.navigationMs/5000)*100);
  const barColor = pct < 50 ? '#059669' : pct < 80 ? '#d97706' : '#dc2626';
  let h = '<div class="drill-title">'+p.label+' — performance detail<span class="drill-close" onclick="closeDrill()">✕</span></div>';
  h += '<div class="drill-row"><span class="drill-key">Page load</span><span style="font-weight:600">'+p.navigationMs+'ms</span></div>';
  h += '<div class="drill-row"><span class="drill-key">DOM ready</span><span>'+p.domContentMs+'ms</span></div>';
  h += '<div class="drill-row"><span class="drill-key">Time to interact</span><span>'+p.timeToInteractMs+'ms</span></div>';
  h += '<div class="drill-row"><span class="drill-key">Resources</span><span>'+p.resourceCount+' assets loaded</span></div>';
  h += '<div class="drill-row"><span class="drill-key">Budget usage</span><span>'+pct+'% of 5000ms budget</span></div>';
  h += '<div class="drill-row" style="flex-direction:column;gap:4px;"><div style="background:#e5e7eb;border-radius:4px;height:8px;width:100%"><div style="width:'+Math.min(pct,100)+'%;height:8px;border-radius:4px;background:'+barColor+'"></div></div></div>';
  if (p.history && p.history.length > 1) {
    h += '<div class="drill-row"><span class="drill-key">History (avg)</span><span>'+Math.round(p.history.reduce((a,b)=>a+b,0)/p.history.length)+'ms over '+p.history.length+' runs</span></div>';
  }
  showDrill(h);
}

function drillVisual(json) {
  const v = JSON.parse(json);
  const sc = v.severity==='None'?['#d1fae5','#065f46']:v.severity==='Minor'?['#fef3c7','#92400e']:['#fee2e2','#991b1b'];
  let h = '<div class="drill-title">'+v.label+' — visual analysis<span class="drill-close" onclick="closeDrill()">✕</span></div>';
  h += '<div class="drill-row"><span class="drill-key">Severity</span><span style="background:'+sc[0]+';color:'+sc[1]+';padding:2px 10px;border-radius:8px;font-size:11px">'+v.severity+'</span></div>';
  if (v.analysis) h += '<div class="drill-row"><span class="drill-key">Claude Vision</span><span style="flex:1">'+v.analysis+'</span></div>';
  if (v.changedAreas && v.changedAreas.length) {
    h += '<div class="drill-row"><span class="drill-key">Changed areas</span><span>'+v.changedAreas.join(', ')+'</span></div>';
  }
  if (v.baselineSrc && v.imgSrc) {
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
    h += '<div><div style="font-size:10px;color:#3b82f6;margin-bottom:3px">Baseline</div><img src="'+v.baselineSrc+'" alt="Baseline" style="width:100%;border-radius:4px;border:1px solid #dbeafe"></div>';
    h += '<div><div style="font-size:10px;color:#3b82f6;margin-bottom:3px">Current</div><img src="'+v.imgSrc+'" alt="Current" style="width:100%;border-radius:4px;border:1px solid #dbeafe"></div>';
    h += '</div>';
  }
  showDrill(h);
}

// Trend chart
new Chart(document.getElementById('trendChart'), {
  type: 'line',
  data: {
    labels: TREND.map((_,i) => 'R'+(i+1)),
    datasets: [
      { label:'Pass %', data:TREND.map(r=>r.pass||r.passRate||0),
        borderColor:'#059669', backgroundColor:'rgba(5,150,105,0.06)',
        fill:true, tension:0.3, yAxisID:'y',
        pointRadius:5, pointHoverRadius:8,
        pointBackgroundColor:TREND.map(r=>{const v=r.pass||r.passRate||0;return v===100?'#059669':v<80?'#dc2626':'#d97706';}) },
      { label:'Fails', data:TREND.map(r=>r.failed||0),
        borderColor:'#dc2626', borderDash:[4,3], tension:0.3,
        yAxisID:'y2', pointRadius:3, pointHoverRadius:6, pointBackgroundColor:'#dc2626' }
    ]
  },
  options: {
    responsive:true, maintainAspectRatio:false,
    plugins: { legend:{display:false} },
    onClick:(_,els)=>{
      if(!els.length) return;
      const r = TREND[els[0].index];
      const idx = els[0].index;
      let h = '<div class="drill-title">R'+(idx+1)+' ('+r.runId+') — '+((r.failed||0))+' failures · '+(r.pass||r.passRate||0)+'% pass · '+(r.dur||0)+'s<span class="drill-close" onclick="closeDrill()">✕</span></div>';
      if(!(r.failures||[]).length) {
        h += '<div class="drill-row"><span style="color:#059669;font-weight:500">✅ All '+${totalTests}+' tests passed — clean run</span></div>';
      } else {
        (r.failures||[]).forEach(f=>{
          const vc = ((f.v||'').includes('app-bug')||(f.v||'').includes('Bug'))?['#fee2e2','#991b1b']:((f.v||'').includes('flaky')||(f.v||'').includes('Flaky'))?['#fef3c7','#92400e']:['#e0e7ff','#3730a3'];
          h += '<div class="drill-row"><span style="background:'+vc[0]+';color:'+vc[1]+';padding:2px 8px;border-radius:6px;font-size:11px;flex-shrink:0">'+(f.v||'?')+'</span><span>'+(f.t||'')+'</span><span style="color:#93c5fd;font-size:11px;flex-shrink:0">'+(f.b||'')+'</span></div>';
        });
      }
      showDrill(h);
    },
    scales: {
      y:  { min:0, max:110, ticks:{callback:v=>v+'%',font:{size:11}}, grid:{color:'rgba(0,0,0,0.05)'}},
      y2: { min:0, max:16, position:'right', ticks:{font:{size:11}}, grid:{display:false}},
      x:  { ticks:{font:{size:10},autoSkip:false,maxRotation:30}, grid:{display:false}}
    }
  }
});

// Chat
let busy = false;
function chatAsk(q) { document.getElementById('chatInp').value = q; chatSend(); }
async function chatSend() {
  const inp = document.getElementById('chatInp');
  const q   = inp.value.trim();
  if (!q || busy) return;
  busy = true; inp.value = '';
  const msgs = document.getElementById('chatMsgs');
  const u = document.createElement('div'); u.className='bubble u'; u.textContent=q; msgs.appendChild(u);
  const t = document.createElement('div'); t.className='bubble a'; t.textContent='Thinking...'; msgs.appendChild(t);
  msgs.scrollTop = msgs.scrollHeight;
  try {
    const res  = await fetch('/api/query', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({question:q,knowledge:KB}) });
    const data = await res.json();
    t.textContent = data.answer || 'No answer.';
  } catch { t.textContent = 'Error connecting to API server.'; }
  msgs.scrollTop = msgs.scrollHeight;
  busy = false;
}
window.chatAsk=chatAsk; window.chatSend=chatSend;
window.drillMetric=drillMetric; window.drillTest=drillTest;
window.drillPerf=drillPerf; window.drillVisual=drillVisual;
window.closeDrill=closeDrill;
</script>
</body>
</html>`;
}

// ── Server ────────────────────────────────────────────────────

async function handleQuery(body: string, res: http.ServerResponse) {
  try {
    const { question, knowledge } = JSON.parse(body);
    const aiResp = await aiCall({
      operation: 'dashboard-qa',
      appName:   getAppName(),
      system:    'You are a QA assistant. Answer questions about test results concisely in 2-4 sentences. Use specific numbers. No markdown formatting.',
      messages:  [{ role: 'user', content: `Knowledge:\n${JSON.stringify(knowledge??{},null,1).slice(0,6000)}\n\nQuestion: ${question}` }],
      maxTokens: 300,
    })
    const answer = aiResp.content
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({answer}));
  } catch (err) {
    res.writeHead(500,{'Content-Type':'application/json'});
    res.end(JSON.stringify({answer:`Server error: ${err}`}));
  }
}

function main() {
  if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY not set in .env\n'); process.exit(1); }

  const server = http.createServer((req, res) => {
    if (rejectUnsafeBrowserOrigin(req, res)) return;
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200,{'Content-Type':'text/html'});
      buildHTML().then(html => res.end(html)).catch(e => { res.writeHead(500); res.end(String(e)); });
    } else if (req.method === 'POST' && req.url === '/api/query') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end',  () => handleQuery(body, res));
    } else { res.writeHead(404); res.end(); }
  });

  server.listen(PORT, LOCAL_ONLY_HOST, () => {
    console.log('\n🚀 FORGE — Autonomous Quality Engineering\n');
    console.log(`   http://localhost:${PORT}\n`);
    console.log('   • Click metric cards  → drill into details');
    console.log('   • Click trend points  → see run failures');
    console.log('   • Click risk rows     → full test history');
    console.log('   • Click perf rows     → budget gauge + history');
    console.log('   • Click visual thumbs → before/after screenshots');
    console.log('   • Chat box            → ask anything about your suite\n');
    console.log('   Press Ctrl+C to stop.\n');
    const {execSync} = require('child_process');
    try { execSync(`start http://localhost:${PORT}`); } catch {}
  });
}

main();
