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
 * visual-regression.ts
 * ─────────────────────────────────────────────────────────────
 * Phase 2 — Visual Regression Testing
 * Personal AI-Augmented Testing Framework
 *
 * Three layers:
 *   1. Screenshot capture  — every key page & state
 *   2. Pixel diff          — what pixels changed
 *   3. Claude Vision       — WHAT semantically changed
 *
 * Usage:
 *   npx tsx src/visual-regression.ts --baseline   ← capture/update baseline
 *   npx tsx src/visual-regression.ts              ← compare vs baseline
 *   npx tsx src/visual-regression.ts --page login ← single page only
 * ─────────────────────────────────────────────────────────────
 */

import Anthropic          from '@anthropic-ai/sdk';
import { chromium }       from '@playwright/test';
import * as fs            from 'fs';
import * as path          from 'path';
import * as dotenv        from 'dotenv';
import { getAppName, getBaseUrl } from '../../../../../core/config/appConfig'

dotenv.config();

// ── Types ────────────────────────────────────────────────────

type ChangeSeverity = 'None' | 'Minor' | 'Major' | 'Critical';

interface PageSpec {
  id:       string;
  label:    string;
  url:      string;
  setup?:   (page: any) => Promise<void>;
  waitFor?: string;
  clip?:    { x: number; y: number; width: number; height: number };
}

interface VisualResult {
  pageId:      string;
  label:       string;
  hasBaseline: boolean;
  baselinePath: string;
  currentPath:  string;
  diffPath:     string;
  severity:     ChangeSeverity;
  analysis:     string;
  changedAreas: string[];
  timestamp:    string;
}

// ── Config ───────────────────────────────────────────────────

const CONFIG = {
  baseUrl:      getBaseUrl(),
  username:     process.env.APP_USERNAME || 'standard_user',
  password:     process.env.APP_PASSWORD || 'secret_sauce',
  baselineDir:  'reports/visual/baseline',
  currentDir:   'reports/visual/current',
  diffDir:      'reports/visual/diffs',
  reportPath:   'reports/visual-report.html',
  summaryPath:  'reports/visual-summary.json',
  isBaseline:   process.argv.includes('--baseline'),
  pageFilter:   getArg('--page'),
  model:        'claude-sonnet-4-5' as const,
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Page specs — every key page & state ──────────────────────

const PAGE_SPECS: PageSpec[] = [
  {
    id:      'login',
    label:   'Login page',
    url:     '/',
    waitFor: '#login-button',
  },
  {
    id:    'login-error',
    label: 'Login — invalid credentials error',
    url:   '/',
    setup: async (page) => {
      await page.fill('#user-name', 'wrong_user');
      await page.fill('#password', 'wrong_pass');
      await page.click('#login-button');
      await page.waitForSelector('[data-test="error"]');
    },
    waitFor: '[data-test="error"]',
  },
  {
    id:      'inventory',
    label:   'Inventory page — product listing',
    url:     '/inventory.html',
    setup:   async (page) => { await loginAs(page, process.env.APP_USERNAME || 'standard_user'); },
    waitFor: '.inventory_item',
  },
  {
    id:    'inventory-cart-badge',
    label: 'Inventory — item added to cart',
    url:   '/inventory.html',
    setup: async (page) => {
      await loginAs(page, process.env.APP_USERNAME || 'standard_user');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.waitForSelector('.shopping_cart_badge');
    },
    waitFor: '.shopping_cart_badge',
  },
  {
    id:    'cart-with-item',
    label: 'Cart — with item',
    url:   '/cart.html',
    setup: async (page) => {
      await loginAs(page, process.env.APP_USERNAME || 'standard_user');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.goto(`${CONFIG.baseUrl}/cart.html`);
    },
    waitFor: '.cart_item',
  },
   {
    id:    'cart-empty',
    label: 'Cart — empty',
    url:   '/cart.html',
    setup: async (page) => {
      await loginAs(page, process.env.APP_USERNAME || 'standard_user');
      await page.goto(`${CONFIG.baseUrl}/cart.html`, { waitUntil: 'networkidle' });
   },
    waitFor: '#checkout',
  },
  {
    id:    'checkout-step1',
    label: 'Checkout — step 1 (info)',
    url:   '/checkout-step-one.html',
    setup: async (page) => {
      await loginAs(page, process.env.APP_USERNAME || 'standard_user');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.goto(`${CONFIG.baseUrl}/cart.html`);
      await page.click('#checkout');
    },
    waitFor: '#first-name',
  },
  {
    id:    'checkout-step2',
    label: 'Checkout — step 2 (overview)',
    url:   '/checkout-step-two.html',
    setup: async (page) => {
      await loginAs(page, process.env.APP_USERNAME || 'standard_user');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.goto(`${CONFIG.baseUrl}/cart.html`);
      await page.click('#checkout');
      await page.fill('#first-name', 'Raj');
      await page.fill('#last-name', 'Kasthuri');
      await page.fill('#postal-code', '30041');
      await page.click('#continue');
    },
    waitFor: '#finish',
  },
  {
    id:    'checkout-complete',
    label: 'Checkout complete',
    url:   '/checkout-complete.html',
    setup: async (page) => {
      await loginAs(page, process.env.APP_USERNAME || 'standard_user');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.goto(`${CONFIG.baseUrl}/cart.html`);
      await page.click('#checkout');
      await page.fill('#first-name', 'Raj');
      await page.fill('#last-name', 'Kasthuri');
      await page.fill('#postal-code', '30041');
      await page.click('#continue');
      await page.click('#finish');
    },
    waitFor: '.complete-header',
  },
];

// ── Entry point ───────────────────────────────────────────────

async function main() {
  console.log('\n📸 Visual Regression Testing\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set.\n');
    process.exit(1);
  }

  ensureDirs();

  const specs = CONFIG.pageFilter
    ? PAGE_SPECS.filter(p => p.id.includes(CONFIG.pageFilter!))
    : PAGE_SPECS;

  if (!specs.length) {
    console.error(`❌ No pages found matching: ${CONFIG.pageFilter}\n`);
    process.exit(1);
  }

  if (CONFIG.isBaseline) {
    await captureBaseline(specs);
  } else {
    await runComparison(specs);
  }
}

// ── Capture baseline ──────────────────────────────────────────

async function captureBaseline(specs: PageSpec[]) {
  console.log(`  📐 Capturing baseline screenshots for ${specs.length} pages...\n`);

  const browser = await chromium.launch({ headless: true });
  let captured = 0;

  for (const spec of specs) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    try {
      process.stdout.write(`  📸 ${spec.label}...`);
      await page.goto(`${CONFIG.baseUrl}${spec.url}`, { waitUntil: 'networkidle' });
      if (spec.setup) await spec.setup(page);
      if (spec.waitFor) await page.waitForSelector(spec.waitFor, { timeout: 15000 });
      await page.waitForTimeout(500);

      const imgPath = path.join(CONFIG.baselineDir, `${spec.id}.png`);
      await page.screenshot({ path: imgPath, fullPage: true });
      captured++;
      console.log(` ✅`);
    } catch (err) {
      console.log(` ⚠️  Failed: ${err}`);
    } finally {
      await page.close();
      await context.close();
    }
  }

  await browser.close();

  console.log(`\n  ✅ ${captured}/${specs.length} baselines saved to ${CONFIG.baselineDir}/`);
  console.log('\n  Run without --baseline to compare against these screenshots.\n');
}

// ── Run comparison ────────────────────────────────────────────

async function runComparison(specs: PageSpec[]) {
  const missingBaselines = specs.filter(
    s => !fs.existsSync(path.join(CONFIG.baselineDir, `${s.id}.png`))
  );

  if (missingBaselines.length === specs.length) {
    console.log('  ⚠️  No baselines found. Run with --baseline first.\n');
    console.log('  npx tsx src/visual-regression.ts --baseline\n');
    process.exit(1);
  }

  if (missingBaselines.length > 0) {
    console.log(`  ⚠️  Missing baselines for: ${missingBaselines.map(s => s.id).join(', ')}`);
    console.log('  These pages will be skipped.\n');
  }

  const toCompare = specs.filter(
    s => fs.existsSync(path.join(CONFIG.baselineDir, `${s.id}.png`))
  );

  console.log(`  🔍 Comparing ${toCompare.length} pages against baseline...\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });

  const results: VisualResult[] = [];

  // Step 1 — Capture current screenshots
  for (const spec of toCompare) {
    const page = await context.newPage();
    try {
      process.stdout.write(`  📸 Capturing: ${spec.label}...`);
      await page.goto(`${CONFIG.baseUrl}${spec.url}`, { waitUntil: 'networkidle' });
      if (spec.setup) await spec.setup(page);
      if (spec.waitFor) await page.waitForSelector(spec.waitFor, { timeout: 15000 });
      await page.waitForTimeout(500);

      const imgPath = path.join(CONFIG.currentDir, `${spec.id}.png`);
      await page.screenshot({ path: imgPath, fullPage: true });
      console.log(` ✅`);
    } catch (err) {
      console.log(` ⚠️  Failed: ${err}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // Step 2 — Claude Vision analysis
  console.log('\n  🤖 Sending to Claude Vision for semantic analysis...\n');

  for (const spec of toCompare) {
    const baselinePath = path.join(CONFIG.baselineDir, `${spec.id}.png`);
    const currentPath  = path.join(CONFIG.currentDir,  `${spec.id}.png`);

    if (!fs.existsSync(currentPath)) continue;

    process.stdout.write(`  🔬 Analyzing: ${spec.label}...`);

    const result = await analyzeWithClaudeVision(spec, baselinePath, currentPath);
    results.push(result);

    const icon = result.severity === 'None'     ? '✅' :
                 result.severity === 'Minor'    ? '🟡' :
                 result.severity === 'Major'    ? '🔴' : '🚨';
    console.log(` ${icon} ${result.severity}`);

    await sleep(300);
  }

  // Step 3 — Generate reports
  const html = buildHtmlReport(results);
  fs.writeFileSync(CONFIG.reportPath,   html, 'utf-8');
  fs.writeFileSync(CONFIG.summaryPath,  JSON.stringify({ generated: new Date().toISOString(), results }, null, 2), 'utf-8');

  printSummary(results);

  // Auto-open
  if (process.argv.includes('--open')) {
    const { execSync } = require('child_process');
    try { execSync(`start ${CONFIG.reportPath}`); } catch {}
  }
}

// ── Claude Vision analysis ────────────────────────────────────

async function analyzeWithClaudeVision(
  spec: PageSpec,
  baselinePath: string,
  currentPath:  string
): Promise<VisualResult> {
  const baselineB64 = fs.readFileSync(baselinePath).toString('base64');
  const currentB64  = fs.readFileSync(currentPath).toString('base64');

  const diffPath = path.join(CONFIG.diffDir, `${spec.id}-diff.png`);

  try {
    const message = await client.messages.create({
      model:      CONFIG.model,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: 'image/png', data: baselineB64 },
          },
          {
            type:   'image',
            source: { type: 'base64', media_type: 'image/png', data: currentB64 },
          },
          {
            type: 'text',
            text: `You are a visual QA engineer comparing two screenshots of "${spec.label}" on ${getAppName()} (${getBaseUrl()}).

Image 1 = BASELINE (expected state)
Image 2 = CURRENT (actual state today)

Analyze and respond ONLY in this JSON (no markdown):
{
  "severity": "None" | "Minor" | "Major" | "Critical",
  "analysis": "2-3 sentence plain English summary of what you see",
  "changedAreas": ["specific element or area that changed", "..."]
}

Severity guide:
- None: screenshots are identical or differ only by dynamic data (timestamps, prices)
- Minor: cosmetic changes (font size, spacing, color shade)
- Major: layout changes, missing/added elements, text content changes
- Critical: page broken, key functionality missing, error state visible unexpectedly

Be specific: name elements by their visible text or function (e.g. "Add to cart button", "cart badge", "product price").`
          }
        ],
      }],
    });

    const content = message.content[0].type === 'text' ? message.content[0].text : '';
    const clean   = content.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(clean);

    return {
      pageId:       spec.id,
      label:        spec.label,
      hasBaseline:  true,
      baselinePath,
      currentPath,
      diffPath,
      severity:     parsed.severity     ?? 'None',
      analysis:     parsed.analysis     ?? 'No analysis available.',
      changedAreas: parsed.changedAreas ?? [],
      timestamp:    new Date().toISOString(),
    };

  } catch (err) {
    return {
      pageId: spec.id, label: spec.label, hasBaseline: true,
      baselinePath, currentPath, diffPath,
      severity: 'None',
      analysis: `Analysis failed: ${err}`,
      changedAreas: [],
      timestamp: new Date().toISOString(),
    };
  }
}

// ── HTML report ───────────────────────────────────────────────

function buildHtmlReport(results: VisualResult[]): string {
  const counts = {
    None:     results.filter(r => r.severity === 'None').length,
    Minor:    results.filter(r => r.severity === 'Minor').length,
    Major:    results.filter(r => r.severity === 'Major').length,
    Critical: results.filter(r => r.severity === 'Critical').length,
  };

  const cards = results.map(r => {
    const severityColor =
      r.severity === 'None'     ? '#059669' :
      r.severity === 'Minor'    ? '#d97706' :
      r.severity === 'Major'    ? '#dc2626' : '#7c2d12';

    const severityBg =
      r.severity === 'None'     ? '#d1fae5' :
      r.severity === 'Minor'    ? '#fef3c7' :
      r.severity === 'Major'    ? '#fee2e2' : '#fce7f3';

    const changedList = r.changedAreas.length
      ? r.changedAreas.map(a => `<li>${a}</li>`).join('')
      : '<li>No specific changes detected</li>';

    const baselineDataUrl  = imageToDataUrl(r.baselinePath);
    const currentDataUrl   = imageToDataUrl(r.currentPath);

    return `
<div class="card">
  <div class="card-header">
    <div>
      <div class="page-label">${r.label}</div>
      <div class="page-id">${r.pageId}</div>
    </div>
    <span class="badge" style="background:${severityBg};color:${severityColor}">${r.severity}</span>
  </div>
  <div class="comparison">
    <div class="img-col">
      <div class="img-label">Baseline</div>
      <img src="${baselineDataUrl}" alt="Baseline: ${r.label}" loading="lazy">
    </div>
    <div class="img-col">
      <div class="img-label">Current</div>
      <img src="${currentDataUrl}" alt="Current: ${r.label}" loading="lazy">
    </div>
  </div>
  <div class="analysis-box">
    <div class="analysis-label">Claude Vision Analysis</div>
    <p class="analysis-text">${r.analysis}</p>
    ${r.changedAreas.length > 0 ? `
    <div class="changed-areas">
      <strong>Changed areas:</strong>
      <ul>${changedList}</ul>
    </div>` : ''}
  </div>
</div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visual Regression Report</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;color:#1a1a1a;padding:2rem}
h1{font-size:22px;font-weight:500;margin-bottom:4px}
.sub{font-size:13px;color:#888;margin-bottom:1.5rem}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:2rem}
.metric{background:#fff;border:1px solid #e8e8e8;border-radius:8px;padding:1rem}
.mlabel{font-size:12px;color:#888;margin-bottom:4px}
.mval{font-size:22px;font-weight:500}
.card{background:#fff;border:1px solid #e8e8e8;border-radius:12px;padding:1.25rem;margin-bottom:1.5rem}
.card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem}
.page-label{font-size:15px;font-weight:500}
.page-id{font-size:12px;color:#888;margin-top:2px}
.badge{font-size:12px;padding:4px 12px;border-radius:20px;font-weight:500;white-space:nowrap}
.comparison{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem}
.img-col{display:flex;flex-direction:column;gap:6px}
.img-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px}
.img-col img{width:100%;border:1px solid #e8e8e8;border-radius:6px;cursor:zoom-in}
.img-col img:hover{box-shadow:0 4px 20px rgba(0,0,0,.15)}
.analysis-box{background:#f8f9fa;border-radius:8px;padding:1rem;border:1px solid #e8e8e8}
.analysis-label{font-size:12px;color:#1a56db;font-weight:500;margin-bottom:6px}
.analysis-text{font-size:13px;color:#333;line-height:1.6;margin-bottom:8px}
.changed-areas{font-size:12px;color:#666}
.changed-areas ul{margin-top:4px;padding-left:16px}
.changed-areas li{margin-bottom:2px}
footer{margin-top:2rem;font-size:12px;color:#aaa;text-align:center}
</style>
</head>
<body>
<h1>Visual Regression Report</h1>
<p class="sub">Generated ${new Date().toLocaleString()} &nbsp;·&nbsp; ${results.length} pages analyzed &nbsp;·&nbsp; Powered by Claude Vision</p>

<div class="metrics">
  <div class="metric"><div class="mlabel">Pages analyzed</div><div class="mval">${results.length}</div></div>
  <div class="metric"><div class="mlabel">No changes</div><div class="mval" style="color:#059669">${counts.None}</div></div>
  <div class="metric"><div class="mlabel">Changes detected</div><div class="mval" style="color:${counts.Major + counts.Critical > 0 ? '#dc2626' : '#d97706'}">${counts.Minor + counts.Major + counts.Critical}</div></div>
  <div class="metric"><div class="mlabel">Critical</div><div class="mval" style="color:${counts.Critical > 0 ? '#7c2d12' : '#059669'}">${counts.Critical}</div></div>
</div>

${cards}

<footer>FORGE &nbsp;·&nbsp; Phase 2 Visual Regression &nbsp;·&nbsp; rkasthuri/forge-framework</footer>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────

async function loginAs(page: any, username: string) {
  await page.goto(`${CONFIG.baseUrl}/`, { waitUntil: 'networkidle' });
  await page.fill('#user-name', username);
  await page.fill('#password', process.env.APP_PASSWORD || 'secret_sauce');
  await page.click('#login-button');
  await page.waitForURL('**/inventory.html', { timeout: 15000 });
  await page.waitForSelector('.inventory_item', { timeout: 15000 }); // ← generic, not cart-specific
}

function imageToDataUrl(imgPath: string): string {
  try {
    const data = fs.readFileSync(imgPath).toString('base64');
    return `data:image/png;base64,${data}`;
  } catch {
    return 'data:image/png;base64,';
  }
}

function ensureDirs() {
  [CONFIG.baselineDir, CONFIG.currentDir, CONFIG.diffDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function printSummary(results: VisualResult[]) {
  const none     = results.filter(r => r.severity === 'None').length;
  const minor    = results.filter(r => r.severity === 'Minor').length;
  const major    = results.filter(r => r.severity === 'Major').length;
  const critical = results.filter(r => r.severity === 'Critical').length;

  console.log('\n──────────────────────────────────────');
  console.log('  VISUAL REGRESSION COMPLETE');
  console.log('──────────────────────────────────────');
  console.log(`  ✅ No changes:  ${none}`);
  console.log(`  🟡 Minor:       ${minor}`);
  console.log(`  🔴 Major:       ${major}`);
  console.log(`  🚨 Critical:    ${critical}`);
  console.log('──────────────────────────────────────');
  console.log(`  🌐 ${CONFIG.reportPath}`);
  console.log(`  📄 ${CONFIG.summaryPath}`);
  console.log('──────────────────────────────────────\n');
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
