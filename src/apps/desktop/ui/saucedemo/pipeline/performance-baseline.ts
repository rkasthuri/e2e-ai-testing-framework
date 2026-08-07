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
 * performance-baseline.ts
 * ─────────────────────────────────────────────────────────────
 * Phase 2 — Performance Baseline Testing
 * Personal AI-Augmented Testing Framework
 *
 * Measures and tracks:
 *   - Page load times (navigation timing API)
 *   - Time to interactive (first key element visible)
 *   - Flow durations (login, cart, checkout end-to-end)
 *   - Core Web Vitals (LCP, FCP, CLS)
 *
 * Usage:
 *   npx tsx src/performance-baseline.ts --baseline  ← establish baseline
 *   npx tsx src/performance-baseline.ts             ← compare vs baseline
 *   npx tsx src/performance-baseline.ts --open      ← open report after
 * ─────────────────────────────────────────────────────────────
 */

import Anthropic       from '@anthropic-ai/sdk';
import { chromium }    from '@playwright/test';
import * as fs         from 'fs';
import * as path       from 'path';
import * as dotenv     from 'dotenv';

dotenv.config();
import { PerfBaselineRepository } from '../../../../../core/storage/repositories/PerfBaselineRepository'
import { getAppName, getBaseUrl } from '../../../../../core/config/appConfig'

// ── Types ────────────────────────────────────────────────────

type RegressionStatus = 'Pass' | 'Warning' | 'Regression' | 'Critical';

interface PageMetrics {
  pageId:            string;
  label:             string;
  url:               string;
  navigationMs:      number;   // full page load
  domContentMs:      number;   // DOM ready
  firstPaintMs:      number;   // first paint
  timeToInteractMs:  number;   // key element visible
  resourceCount:     number;   // number of resources loaded
  timestamp:         string;
}

interface FlowMetrics {
  flowId:    string;
  label:     string;
  totalMs:   number;
  steps:     { label: string; durationMs: number }[];
  timestamp: string;
}

interface PerformanceRun {
  runId:     string;
  timestamp: string;
  pages:     PageMetrics[];
  flows:     FlowMetrics[];
}

interface ComparisonResult {
  pageId:       string;
  label:        string;
  metric:       string;
  baselineMs:   number;
  currentMs:    number;
  deltaMs:      number;
  deltaPercent: number;
  status:       RegressionStatus;
  threshold:    number;
}

// ── Thresholds ────────────────────────────────────────────────
// Warning  → >20% slower than baseline
// Regression → >50% slower
// Critical → >100% slower (2x)

const THRESHOLDS = {
  warning:    0.20,
  regression: 0.50,
  critical:   1.00,
};

// Page load budget (absolute ms — fail if exceeded regardless of baseline)
const BUDGETS: Record<string, number> = {
  navigationMs:     5000,
  domContentMs:     3000,
  timeToInteractMs: 4000,
};

// ── Config ───────────────────────────────────────────────────

const CONFIG = {
  baseUrl:       getBaseUrl(),
  username:      process.env.APP_USERNAME || 'standard_user',
  password:      process.env.APP_PASSWORD || 'secret_sauce',
  baselinePath:  'reports/perf-baseline.json',
  historyPath:   'reports/perf-history.json',
  reportPath:    'reports/perf-report.html',
  runs:          3,     // average over N runs for stability
  isBaseline:    process.argv.includes('--baseline'),
  openBrowser:   process.argv.includes('--open'),
  model:         'claude-sonnet-4-5' as const,
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Pages to measure ─────────────────────────────────────────

const PAGES = [
  { id: 'login',          label: 'Login page',            url: '/',                        waitFor: '#login-button' },
  { id: 'inventory',      label: 'Inventory page',         url: '/inventory.html',          waitFor: '.inventory_item',   requiresLogin: true },
  { id: 'cart',           label: 'Cart page',              url: '/cart.html',               waitFor: '.cart_list',        requiresLogin: true },
  { id: 'checkout-step1', label: 'Checkout step 1',        url: '/checkout-step-one.html',  waitFor: '#first-name',       requiresLogin: true },
];

// ── User flows to measure ─────────────────────────────────────

async function measureLoginFlow(page: any): Promise<FlowMetrics> {
  const steps: { label: string; durationMs: number }[] = [];

  // Step 1 — Navigate to login
  let t = Date.now();
  await page.goto(`${CONFIG.baseUrl}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#login-button');
  steps.push({ label: 'Page load', durationMs: Date.now() - t });

  // Step 2 — Fill credentials
  t = Date.now();
  await page.fill('#user-name', CONFIG.username);
  await page.fill('#password',  CONFIG.password);
  steps.push({ label: 'Fill credentials', durationMs: Date.now() - t });

  // Step 3 — Submit + wait for inventory
  t = Date.now();
  await page.click('#login-button');
  await page.waitForURL('**/inventory.html');
  await page.waitForSelector('.inventory_item');
  steps.push({ label: 'Login + redirect', durationMs: Date.now() - t });

  return {
    flowId:    'login-flow',
    label:     'Login flow (end-to-end)',
    totalMs:   steps.reduce((s, step) => s + step.durationMs, 0),
    steps,
    timestamp: new Date().toISOString(),
  };
}

async function measureCartFlow(page: any): Promise<FlowMetrics> {
  const steps: { label: string; durationMs: number }[] = [];

  // Login first
  await loginAs(page);

  // Step 1 — Add item to cart
  let t = Date.now();
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.waitForSelector('.shopping_cart_badge');
  steps.push({ label: 'Add item to cart', durationMs: Date.now() - t });

  // Step 2 — Navigate to cart
  t = Date.now();
  await page.click('.shopping_cart_link');
  await page.waitForURL('**/cart.html');
  await page.waitForSelector('.cart_item');
  steps.push({ label: 'Open cart', durationMs: Date.now() - t });

  // Step 3 — Proceed to checkout
  t = Date.now();
  await page.click('#checkout');
  await page.waitForURL('**/checkout-step-one.html');
  await page.waitForSelector('#first-name');
  steps.push({ label: 'Proceed to checkout', durationMs: Date.now() - t });

  return {
    flowId:    'cart-flow',
    label:     'Cart flow (add → view → checkout)',
    totalMs:   steps.reduce((s, step) => s + step.durationMs, 0),
    steps,
    timestamp: new Date().toISOString(),
  };
}

async function measureCheckoutFlow(page: any): Promise<FlowMetrics> {
  const steps: { label: string; durationMs: number }[] = [];

  await loginAs(page);
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.click('.shopping_cart_link');
  await page.waitForURL('**/cart.html');

  // Step 1 — Start checkout
  let t = Date.now();
  await page.click('#checkout');
  await page.waitForURL('**/checkout-step-one.html');
  steps.push({ label: 'Start checkout', durationMs: Date.now() - t });

  // Step 2 — Fill info
  t = Date.now();
  await page.fill('#first-name', 'Raj');
  await page.fill('#last-name',  'Kasthuri');
  await page.fill('#postal-code', '30041');
  await page.click('#continue');
  await page.waitForURL('**/checkout-step-two.html');
  steps.push({ label: 'Fill info + continue', durationMs: Date.now() - t });

  // Step 3 — Review + finish
  t = Date.now();
  await page.click('#finish');
  await page.waitForURL('**/checkout-complete.html');
  await page.waitForSelector('.complete-header');
  steps.push({ label: 'Place order', durationMs: Date.now() - t });

  return {
    flowId:    'checkout-flow',
    label:     'Checkout flow (info → overview → complete)',
    totalMs:   steps.reduce((s, step) => s + step.durationMs, 0),
    steps,
    timestamp: new Date().toISOString(),
  };
}

// ── Measure page metrics ──────────────────────────────────────

async function measurePage(
  browser: any,
  spec: typeof PAGES[0]
): Promise<PageMetrics> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page    = await context.newPage();

  try {
    if (spec.requiresLogin) await loginAs(page);

    const navStart = Date.now();
    await page.goto(`${CONFIG.baseUrl}${spec.url}`, { waitUntil: 'networkidle' });

    // Navigation timing from browser
    const timing = await page.evaluate(() => {
      const t = (performance as Performance & { timing: PerformanceTiming }).timing;
      return {
        navigationMs: t.loadEventEnd - t.navigationStart,
        domContentMs: t.domContentLoadedEventEnd - t.navigationStart,
        firstPaintMs: 0, // filled below
      };
    });

    // First paint from Performance API
    const firstPaint = await page.evaluate(() => {
      const entries = performance.getEntriesByType('paint' as string);
      const fp = entries.find((e: any) => e.name === 'first-paint');
      return fp ? Math.round(fp.startTime) : 0;
    });

    // Time to interactive — when key element appears
    const ttiStart = Date.now();
    if (spec.waitFor) {
      await page.waitForSelector(spec.waitFor, { timeout: 15000 });
    }
    const timeToInteractMs = Date.now() - ttiStart;

    // Resource count
    const resourceCount = await page.evaluate(() =>
      performance.getEntriesByType('resource').length
    );

    return {
      pageId:           spec.id,
      label:            spec.label,
      url:              spec.url,
      navigationMs:     timing.navigationMs || (Date.now() - navStart),
      domContentMs:     timing.domContentMs || 0,
      firstPaintMs:     firstPaint,
      timeToInteractMs,
      resourceCount,
      timestamp:        new Date().toISOString(),
    };
  } finally {
    await page.close();
    await context.close();
  }
}

// ── Average multiple runs ─────────────────────────────────────

async function averageRuns(
  browser: any,
  spec: typeof PAGES[0],
  runs: number
): Promise<PageMetrics> {
  const results: PageMetrics[] = [];

  for (let i = 0; i < runs; i++) {
    try {
      const m = await measurePage(browser, spec);
      results.push(m);
      await sleep(500);
    } catch (err) {
      console.warn(`    Run ${i+1} failed: ${err}`);
    }
  }

  if (!results.length) throw new Error(`All ${runs} runs failed for ${spec.id}`);

  // Average the numeric metrics
  const avg = (key: keyof PageMetrics) =>
    Math.round(results.reduce((s, r) => s + (r[key] as number), 0) / results.length);

  return {
    ...results[0],
    navigationMs:     avg('navigationMs'),
    domContentMs:     avg('domContentMs'),
    firstPaintMs:     avg('firstPaintMs'),
    timeToInteractMs: avg('timeToInteractMs'),
    resourceCount:    avg('resourceCount'),
  };
}

// ── Entry point ───────────────────────────────────────────────

async function main() {
  console.log('\n⚡ Performance Baseline Testing\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set.\n'); process.exit(1);
  }

  ensureDirs();

  const browser = await chromium.launch({ headless: true });

  try {
    if (CONFIG.isBaseline) {
      await captureBaseline(browser);
    } else {
      await runComparison(browser);
    }
  } finally {
    await browser.close();
  }
}

// ── Capture baseline ──────────────────────────────────────────

async function captureBaseline(browser: any) {
  console.log(`  📐 Establishing performance baseline (${CONFIG.runs} runs each)...\n`);

  const pages:  PageMetrics[] = [];
  const flows:  FlowMetrics[] = [];

  // Measure pages
  for (const spec of PAGES) {
    process.stdout.write(`  ⏱️  ${spec.label} (${CONFIG.runs} runs)...`);
    try {
      const metrics = await averageRuns(browser, spec, CONFIG.runs);
      pages.push(metrics);
      console.log(` ✅ ${metrics.navigationMs}ms load · ${metrics.timeToInteractMs}ms TTI`);
    } catch (err) {
      console.log(` ⚠️  Failed: ${err}`);
    }
  }

  // Measure flows
  console.log('');
  const flowDefs = [
    { id: 'login',    fn: measureLoginFlow,    label: 'Login flow' },
    { id: 'cart',     fn: measureCartFlow,     label: 'Cart flow' },
    { id: 'checkout', fn: measureCheckoutFlow, label: 'Checkout flow' },
  ];

  for (const flow of flowDefs) {
    process.stdout.write(`  🔄 ${flow.label}...`);
    try {
      const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const m    = await flow.fn(page);
      await page.close();
      await ctx.close();
      flows.push(m);
      console.log(` ✅ ${m.totalMs}ms total`);
    } catch (err) {
      console.log(` ⚠️  Failed: ${err}`);
    }
  }

  const baseline: PerformanceRun = {
    runId:     new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
    timestamp: new Date().toISOString(),
    pages,
    flows,
  };

  fs.writeFileSync(CONFIG.baselinePath, JSON.stringify(baseline, null, 2), 'utf-8');

  // DB write — dual-write alongside JSON
  try {
    const perfRepo = new PerfBaselineRepository()
    const metrics: (keyof typeof baseline.pages[0])[] = ['navigationMs', 'domContentMs', 'firstPaintMs', 'timeToInteractMs']
    for (const page of baseline.pages) {
      for (const metric of metrics) {
        await perfRepo.upsert({
          app_name:       getAppName(),
          flow_id:        page.pageId,
          metric:         metric as string,
          baseline_value: page[metric] as number,
          threshold_pct:  10,
          current_value:  null,
          status:         'stable',
          run_id:         null,
          recorded_at:    new Date().toISOString(),
        })
      }
    }
    for (const flow of baseline.flows) {
      await perfRepo.upsert({
        app_name:       getAppName(),
        flow_id:        flow.flowId,
        metric:         'totalMs',
        baseline_value: flow.totalMs,
        threshold_pct:  10,
        current_value:  null,
        status:         'stable',
        run_id:         null,
        recorded_at:    new Date().toISOString(),
      })
    }
    console.log('  ✅ Baselines written to DB')
  } catch (dbErr) {
    console.warn('[perf-baseline] DB write failed:', dbErr)
  }

  console.log('\n──────────────────────────────────────');
  console.log('  BASELINE ESTABLISHED');
  console.log('──────────────────────────────────────');
  pages.forEach(p => {
    console.log(`  ${p.label.padEnd(25)} ${p.navigationMs}ms load · ${p.timeToInteractMs}ms TTI`);
  });
  flows.forEach(f => {
    console.log(`  ${f.label.padEnd(25)} ${f.totalMs}ms total`);
  });
  console.log('──────────────────────────────────────');
  console.log(`  📄 ${CONFIG.baselinePath}`);
  console.log('\n  Run without --baseline to compare.\n');
}

// ── Run comparison ────────────────────────────────────────────

async function runComparison(browser: any) {
  if (!fs.existsSync(CONFIG.baselinePath)) {
    console.log('  ⚠️  No baseline found. Run with --baseline first.\n');
    process.exit(1);
  }

  const baseline: PerformanceRun = JSON.parse(
    fs.readFileSync(CONFIG.baselinePath, 'utf-8')
  );

  console.log(`  🔍 Measuring current performance (${CONFIG.runs} runs each)...\n`);

  const currentPages:  PageMetrics[] = [];
  const currentFlows:  FlowMetrics[] = [];

  // Measure pages
  for (const spec of PAGES) {
    process.stdout.write(`  ⏱️  ${spec.label}...`);
    try {
      const metrics = await averageRuns(browser, spec, CONFIG.runs);
      currentPages.push(metrics);
      console.log(` ✅ ${metrics.navigationMs}ms`);
    } catch (err) {
      console.log(` ⚠️  Failed: ${err}`);
    }
  }

  // Measure flows
  console.log('');
  const flowDefs = [
    { id: 'login-flow',    fn: measureLoginFlow,    label: 'Login flow' },
    { id: 'cart-flow',     fn: measureCartFlow,     label: 'Cart flow' },
    { id: 'checkout-flow', fn: measureCheckoutFlow, label: 'Checkout flow' },
  ];

  for (const flow of flowDefs) {
    process.stdout.write(`  🔄 ${flow.label}...`);
    try {
      const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const m    = await flow.fn(page);
      await page.close();
      await ctx.close();
      currentFlows.push(m);
      console.log(` ✅ ${m.totalMs}ms`);
    } catch (err) {
      console.log(` ⚠️  Failed: ${err}`);
    }
  }

  // Compare
  const comparisons = buildComparisons(baseline, currentPages, currentFlows);

  // AI analysis
  console.log('\n  🤖 Generating AI performance analysis...');
  const aiAnalysis = await generateAIAnalysis(baseline, currentPages, currentFlows, comparisons);

  // Append to history
  appendToHistory({ runId: new Date().toISOString(), timestamp: new Date().toISOString(), pages: currentPages, flows: currentFlows });

  // Build report
  const html = buildHtmlReport(baseline, currentPages, currentFlows, comparisons, aiAnalysis);
  fs.writeFileSync(CONFIG.reportPath, html, 'utf-8');

  printSummary(comparisons, aiAnalysis);

  if (CONFIG.openBrowser) {
    const { execSync } = require('child_process');
    try { execSync(`start ${CONFIG.reportPath}`); } catch {}
  }
}

// ── Build comparisons ─────────────────────────────────────────

function buildComparisons(
  baseline: PerformanceRun,
  currentPages: PageMetrics[],
  currentFlows: FlowMetrics[]
): ComparisonResult[] {
  const results: ComparisonResult[] = [];
  const metrics: (keyof PageMetrics)[] = ['navigationMs', 'domContentMs', 'timeToInteractMs'];

  for (const current of currentPages) {
    const base = baseline.pages.find(p => p.pageId === current.pageId);
    if (!base) continue;

    for (const metric of metrics) {
      const baseVal    = base[metric] as number;
      const currentVal = current[metric] as number;
      const delta      = currentVal - baseVal;
      const deltaPct   = baseVal > 0 ? delta / baseVal : 0;

      const status: RegressionStatus =
        deltaPct >= THRESHOLDS.critical   ? 'Critical'   :
        deltaPct >= THRESHOLDS.regression ? 'Regression' :
        deltaPct >= THRESHOLDS.warning    ? 'Warning'    : 'Pass';

      // Also check absolute budget
      const budget = BUDGETS[metric];
      const finalStatus = (budget && currentVal > budget && status === 'Pass')
        ? 'Warning' : status;

      results.push({
        pageId: current.pageId, label: current.label,
        metric: metric.replace('Ms', '').replace(/([A-Z])/g, ' $1').toLowerCase(),
        baselineMs: baseVal, currentMs: currentVal,
        deltaMs: delta, deltaPercent: Math.round(deltaPct * 100),
        status: finalStatus, threshold: Math.round(THRESHOLDS.warning * 100),
      });
    }
  }

  // Flow comparisons
  for (const current of currentFlows) {
    const base = baseline.flows.find(f => f.flowId === current.flowId);
    if (!base) continue;

    const delta    = current.totalMs - base.totalMs;
    const deltaPct = base.totalMs > 0 ? delta / base.totalMs : 0;
    const status: RegressionStatus =
      deltaPct >= THRESHOLDS.critical   ? 'Critical'   :
      deltaPct >= THRESHOLDS.regression ? 'Regression' :
      deltaPct >= THRESHOLDS.warning    ? 'Warning'    : 'Pass';

    results.push({
      pageId: current.flowId, label: current.label,
      metric: 'total flow duration',
      baselineMs: base.totalMs, currentMs: current.totalMs,
      deltaMs: delta, deltaPercent: Math.round(deltaPct * 100),
      status, threshold: Math.round(THRESHOLDS.warning * 100),
    });
  }

  return results;
}

// ── AI analysis ───────────────────────────────────────────────

async function generateAIAnalysis(
  baseline: PerformanceRun,
  currentPages: PageMetrics[],
  currentFlows: FlowMetrics[],
  comparisons: ComparisonResult[]
): Promise<string> {
  try {
    const regressions = comparisons.filter(c => c.status !== 'Pass');
    const summary = currentPages.map(p =>
      `${p.label}: ${p.navigationMs}ms load (baseline: ${baseline.pages.find(b => b.pageId === p.pageId)?.navigationMs ?? '?'}ms)`
    ).join('\n');

    const message = await client.messages.create({
      model: CONFIG.model, max_tokens: 256,
      messages: [{ role: 'user', content:
        `Analyze this web app performance comparison for ${getAppName()} (${getBaseUrl()}).

Current vs baseline:
${summary}

Regressions detected: ${regressions.length}
${regressions.map(r => `- ${r.label} ${r.metric}: ${r.baselineMs}ms → ${r.currentMs}ms (${r.deltaPercent > 0 ? '+' : ''}${r.deltaPercent}%)`).join('\n')}

Write a 2-sentence performance health summary. Be specific with numbers. No markdown.` }]
    });

    return message.content[0].type === 'text' ? message.content[0].text : '';
  } catch {
    return 'Performance analysis complete. Compare the metrics table for detailed regression information.';
  }
}

// ── HTML report ───────────────────────────────────────────────

function buildHtmlReport(
  baseline: PerformanceRun,
  currentPages: PageMetrics[],
  currentFlows: FlowMetrics[],
  comparisons: ComparisonResult[],
  aiAnalysis: string
): string {
  const pass       = comparisons.filter(c => c.status === 'Pass').length;
  const warnings   = comparisons.filter(c => c.status === 'Warning').length;
  const regressions = comparisons.filter(c => c.status === 'Regression').length;
  const critical   = comparisons.filter(c => c.status === 'Critical').length;

  const statusColor = (s: RegressionStatus) =>
    s === 'Pass' ? '#059669' : s === 'Warning' ? '#d97706' : s === 'Regression' ? '#dc2626' : '#7c2d12';
  const statusBg = (s: RegressionStatus) =>
    s === 'Pass' ? '#d1fae5' : s === 'Warning' ? '#fef3c7' : s === 'Regression' ? '#fee2e2' : '#fce7f3';

  const rows = comparisons.map(c => `
<tr>
  <td>${c.label}</td>
  <td>${c.metric}</td>
  <td>${c.baselineMs}ms</td>
  <td>${c.currentMs}ms</td>
  <td style="color:${c.deltaMs > 0 ? '#dc2626' : '#059669'}">${c.deltaMs > 0 ? '+' : ''}${c.deltaMs}ms</td>
  <td style="color:${c.deltaMs > 0 ? '#dc2626' : '#059669'}">${c.deltaPercent > 0 ? '+' : ''}${c.deltaPercent}%</td>
  <td><span style="background:${statusBg(c.status)};color:${statusColor(c.status)};padding:2px 10px;border-radius:12px;font-size:12px">${c.status}</span></td>
</tr>`).join('');

  const flowRows = currentFlows.map(f => {
    const base = baseline.flows.find(b => b.flowId === f.flowId);
    return `
<tr>
  <td colspan="2" style="font-weight:500">${f.label}</td>
  <td>${base?.totalMs ?? '—'}ms</td>
  <td>${f.totalMs}ms</td>
  <td colspan="2" style="color:${f.totalMs > (base?.totalMs ?? 0) ? '#dc2626' : '#059669'}">
    ${base ? `${f.totalMs - base.totalMs > 0 ? '+' : ''}${f.totalMs - base.totalMs}ms` : '—'}
  </td>
  <td></td>
</tr>
${f.steps.map(s => `<tr style="background:#f8f9fa"><td style="padding-left:24px;color:#888">${s.label}</td><td></td><td></td><td>${s.durationMs}ms</td><td colspan="3"></td></tr>`).join('')}`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Performance Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;color:#1a1a1a;padding:2rem}
h1{font-size:22px;font-weight:500;margin-bottom:4px}
.sub{font-size:13px;color:#888;margin-bottom:1.5rem}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:1.5rem}
.metric{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:1rem}
.mlabel{font-size:12px;color:#888;margin-bottom:4px}
.mval{font-size:22px;font-weight:500}
.narrative{background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:1rem;margin-bottom:1.5rem;font-size:13px;color:#1e40af;line-height:1.6}
.nlabel{font-size:12px;color:#1d4ed8;font-weight:500;margin-bottom:6px}
.card{background:#fff;border:1px solid #e8e8e8;border-radius:12px;padding:1.25rem;margin-bottom:1rem}
.card h2{font-size:15px;font-weight:500;margin-bottom:1rem}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;color:#888;font-weight:500;background:#f8f9fa;font-size:12px}
td{padding:8px 12px;border-top:1px solid #f0f0f0}
footer{margin-top:2rem;font-size:12px;color:#aaa;text-align:center}
</style>
</head>
<body>
<h1>Performance Report</h1>
<p class="sub">Generated ${new Date().toLocaleString()} &nbsp;·&nbsp; Baseline: ${new Date(baseline.timestamp).toLocaleDateString()}</p>

<div class="metrics">
  <div class="metric"><div class="mlabel">Checks</div><div class="mval">${comparisons.length}</div></div>
  <div class="metric"><div class="mlabel">Passing</div><div class="mval" style="color:#059669">${pass}</div></div>
  <div class="metric"><div class="mlabel">Warnings</div><div class="mval" style="color:#d97706">${warnings}</div></div>
  <div class="metric"><div class="mlabel">Regressions</div><div class="mval" style="color:${regressions + critical > 0 ? '#dc2626' : '#059669'}">${regressions + critical}</div></div>
</div>

<div class="narrative">
  <div class="nlabel">AI Analysis</div>
  ${aiAnalysis}
</div>

<div class="card">
  <h2>Page metrics vs baseline</h2>
  <table>
    <thead><tr><th>Page</th><th>Metric</th><th>Baseline</th><th>Current</th><th>Delta</th><th>Change</th><th>Status</th></tr></thead>
    <tbody>${rows}${flowRows}</tbody>
  </table>
</div>

<footer>FORGE &nbsp;·&nbsp; Phase 2 Performance Baselines &nbsp;·&nbsp; rkasthuri/forge-framework</footer>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────

async function loginAs(page: any) {
  await page.goto(`${CONFIG.baseUrl}/`, { waitUntil: 'networkidle' });
  await page.fill('#user-name', CONFIG.username);
  await page.fill('#password',  CONFIG.password);
  await page.click('#login-button');
  await page.waitForURL('**/inventory.html', { timeout: 15000 });
  await page.waitForSelector('.inventory_item', { timeout: 15000 });
}

function appendToHistory(run: PerformanceRun) {
  let history: PerformanceRun[] = [];
  if (fs.existsSync(CONFIG.historyPath)) {
    history = JSON.parse(fs.readFileSync(CONFIG.historyPath, 'utf-8'));
  }
  history.push(run);
  if (history.length > 50) history = history.slice(-50);
  fs.writeFileSync(CONFIG.historyPath, JSON.stringify(history, null, 2), 'utf-8');
}

function printSummary(comparisons: ComparisonResult[], analysis: string) {
  const pass       = comparisons.filter(c => c.status === 'Pass').length;
  const warn       = comparisons.filter(c => c.status === 'Warning').length;
  const regression = comparisons.filter(c => c.status !== 'Pass' && c.status !== 'Warning').length;

  console.log('\n──────────────────────────────────────');
  console.log('  PERFORMANCE CHECK COMPLETE');
  console.log('──────────────────────────────────────');
  console.log(`  ✅ Pass:        ${pass}`);
  console.log(`  🟡 Warning:     ${warn}`);
  console.log(`  🔴 Regression:  ${regression}`);
  console.log('──────────────────────────────────────');
  console.log(`  🌐 ${CONFIG.reportPath}`);
  console.log('──────────────────────────────────────\n');
  console.log(`  AI: ${analysis.slice(0, 120)}...\n`);
}

function ensureDirs() {
  ['reports/visual/baseline', 'reports/visual/current', 'reports/visual/diffs']
    .forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
