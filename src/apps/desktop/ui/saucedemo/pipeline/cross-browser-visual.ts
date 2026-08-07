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
 * cross-browser-visual.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3.2 – Cross-Browser Visual Diff Reporting
 * FORGE — Autonomous Quality Engineering
 *
 * Captures the same 9 pages in both Chromium and WebKit, then uses
 * Claude Vision to analyse rendering differences between browsers.
 *
 * Usage:
 *   npx tsx src/cross-browser-visual.ts            ← capture + compare + report
 *   npx tsx src/cross-browser-visual.ts --capture  ← capture only (no compare)
 *   npx tsx src/cross-browser-visual.ts --page login ← single page only
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic              from '@anthropic-ai/sdk';
import { chromium, webkit }   from '@playwright/test';
import * as fs                from 'fs';
import * as path              from 'path';
import * as dotenv            from 'dotenv';
import { getBaseUrl } from '../../../../../core/config/appConfig'
dotenv.config();

// ── Types ────────────────────────────────────────────────────────────────────

type DiffSeverity = 'None' | 'Minor' | 'Moderate' | 'Major' | 'Critical';

interface PageSpec {
  id:       string;
  label:    string;
  url:      string;
  setup?:   (page: any) => Promise<void>;
  waitFor?: string;
}

interface BrowserScreenshots {
  chromiumPath: string;
  webkitPath:   string;
}

interface CrossBrowserResult {
  pageId:           string;
  label:            string;
  chromiumPath:     string;
  webkitPath:       string;
  severity:         DiffSeverity;
  summary:          string;
  differences:      string[];
  recommendation:   string;
  timestamp:        string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = getBaseUrl()
const CREDENTIALS = {
  username: process.env.APP_USERNAME || 'standard_user',
  password: process.env.APP_PASSWORD || 'secret_sauce',
};

const OUTPUT_DIR  = path.join('reports', 'visual', 'cross-browser');
const CHROMIUM_DIR = path.join(OUTPUT_DIR, 'chromium');
const WEBKIT_DIR   = path.join(OUTPUT_DIR, 'webkit');
const REPORT_PATH  = path.join(OUTPUT_DIR, 'cross-browser-report.html');
const JSON_PATH    = path.join(OUTPUT_DIR, 'cross-browser-results.json');

// ── Page Specs (mirrors visual-regression.ts page set) ────────────────────────

const PAGE_SPECS: PageSpec[] = [
  {
    id:      'login',
    label:   'Login Page',
    url:     `${BASE_URL}/`,
    waitFor: '#user-name',
  },
  {
    id:      'login-error',
    label:   'Login Error State',
    url:     `${BASE_URL}/`,
    setup:   async (page) => {
      await page.fill('#user-name', 'wrong_user');
      await page.fill('#password',  'wrong_pass');
      await page.click('#login-button');
      await page.waitForSelector('[data-test="error"]');
    },
  },
  {
    id:      'inventory',
    label:   'Inventory Page',
    url:     `${BASE_URL}/`,
    setup:   async (page) => {
      await page.fill('#user-name', CREDENTIALS.username);
      await page.fill('#password',  CREDENTIALS.password);
      await page.click('#login-button');
      await page.waitForURL('**/inventory.html');
    },
    waitFor: '.inventory_list',
  },
  {
    id:      'inventory-cart-badge',
    label:   'Inventory with Cart Badge',
    url:     `${BASE_URL}/`,
    setup:   async (page) => {
      await page.fill('#user-name', CREDENTIALS.username);
      await page.fill('#password',  CREDENTIALS.password);
      await page.click('#login-button');
      await page.waitForURL('**/inventory.html');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.waitForSelector('.shopping_cart_badge');
    },
  },
  {
    id:      'cart-with-item',
    label:   'Cart with Item',
    url:     `${BASE_URL}/`,
    setup:   async (page) => {
      await page.fill('#user-name', CREDENTIALS.username);
      await page.fill('#password',  CREDENTIALS.password);
      await page.click('#login-button');
      await page.waitForURL('**/inventory.html');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.click('.shopping_cart_link');
      await page.waitForURL('**/cart.html');
    },
    waitFor: '.cart_list',
  },
  {
    id:      'cart-empty',
    label:   'Empty Cart',
    url:     `${BASE_URL}/`,
    setup:   async (page) => {
      await page.fill('#user-name', CREDENTIALS.username);
      await page.fill('#password',  CREDENTIALS.password);
      await page.click('#login-button');
      await page.waitForURL('**/inventory.html');
      await page.click('.shopping_cart_link');
      await page.waitForURL('**/cart.html');
    },
    waitFor: '.cart_list',
  },
  {
    id:      'checkout-step1',
    label:   'Checkout Step 1 – Info',
    url:     `${BASE_URL}/`,
    setup:   async (page) => {
      await page.fill('#user-name', CREDENTIALS.username);
      await page.fill('#password',  CREDENTIALS.password);
      await page.click('#login-button');
      await page.waitForURL('**/inventory.html');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.click('.shopping_cart_link');
      await page.waitForURL('**/cart.html');
      await page.click('[data-test="checkout"]');
      await page.waitForURL('**/checkout-step-one.html');
    },
    waitFor: '#first-name',
  },
  {
    id:      'checkout-step2',
    label:   'Checkout Step 2 – Overview',
    url:     `${BASE_URL}/`,
    setup:   async (page) => {
      await page.fill('#user-name', CREDENTIALS.username);
      await page.fill('#password',  CREDENTIALS.password);
      await page.click('#login-button');
      await page.waitForURL('**/inventory.html');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.click('.shopping_cart_link');
      await page.waitForURL('**/cart.html');
      await page.click('[data-test="checkout"]');
      await page.waitForURL('**/checkout-step-one.html');
      await page.fill('[data-test="firstName"]', 'Raj');
      await page.fill('[data-test="lastName"]',  'Kasthuri');
      await page.fill('[data-test="postalCode"]', '30040');
      await page.click('[data-test="continue"]');
      await page.waitForURL('**/checkout-step-two.html');
    },
    waitFor: '.checkout_summary_container',
  },
  {
    id:      'checkout-complete',
    label:   'Checkout Complete',
    url:     `${BASE_URL}/`,
    setup:   async (page) => {
      await page.fill('#user-name', CREDENTIALS.username);
      await page.fill('#password',  CREDENTIALS.password);
      await page.click('#login-button');
      await page.waitForURL('**/inventory.html');
      await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
      await page.click('.shopping_cart_link');
      await page.waitForURL('**/cart.html');
      await page.click('[data-test="checkout"]');
      await page.waitForURL('**/checkout-step-one.html');
      await page.fill('[data-test="firstName"]', 'Raj');
      await page.fill('[data-test="lastName"]',  'Kasthuri');
      await page.fill('[data-test="postalCode"]', '30040');
      await page.click('[data-test="continue"]');
      await page.waitForURL('**/checkout-step-two.html');
      await page.click('[data-test="finish"]');
      await page.waitForURL('**/checkout-complete.html');
    },
    waitFor: '.complete-header',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  [OUTPUT_DIR, CHROMIUM_DIR, WEBKIT_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function toBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
}

function severityColor(s: DiffSeverity): string {
  return {
    None:     '#22c55e',
    Minor:    '#84cc16',
    Moderate: '#f59e0b',
    Major:    '#ef4444',
    Critical: '#dc2626',
  }[s] ?? '#6b7280';
}

function severityBg(s: DiffSeverity): string {
  return {
    None:     '#f0fdf4',
    Minor:    '#f7fee7',
    Moderate: '#fffbeb',
    Major:    '#fef2f2',
    Critical: '#fff1f2',
  }[s] ?? '#f9fafb';
}

// ── Screenshot Capture ────────────────────────────────────────────────────────

async function captureScreenshots(
  specs: PageSpec[],
): Promise<Map<string, BrowserScreenshots>> {
  const results = new Map<string, BrowserScreenshots>();

  console.log('\n📸 Capturing screenshots in Chromium...');
  const chromiumBrowser = await chromium.launch({ headless: true });
  for (const spec of specs) {
    const page = await chromiumBrowser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.goto(spec.url, { waitUntil: 'networkidle' });
      if (spec.setup)   await spec.setup(page);
      if (spec.waitFor) await page.waitForSelector(spec.waitFor, { timeout: 15000 });
      await page.waitForTimeout(500);
      const outPath = path.join(CHROMIUM_DIR, `${spec.id}.png`);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`  ✅ [chromium] ${spec.label}`);
      results.set(spec.id, { chromiumPath: outPath, webkitPath: '' });
    } catch (err) {
      console.error(`  ❌ [chromium] ${spec.label}: ${err}`);
    } finally {
      await page.close();
    }
  }
  await chromiumBrowser.close();

  console.log('\n📸 Capturing screenshots in WebKit...');
  const webkitBrowser = await webkit.launch({ headless: true });
  for (const spec of specs) {
    const page = await webkitBrowser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.goto(spec.url, { waitUntil: 'networkidle' });
      if (spec.setup)   await spec.setup(page);
      if (spec.waitFor) await page.waitForSelector(spec.waitFor, { timeout: 15000 });
      await page.waitForTimeout(500);
      const outPath = path.join(WEBKIT_DIR, `${spec.id}.png`);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`  ✅ [webkit]   ${spec.label}`);
      const existing = results.get(spec.id);
      if (existing) existing.webkitPath = outPath;
    } catch (err) {
      console.error(`  ❌ [webkit]   ${spec.label}: ${err}`);
    } finally {
      await page.close();
    }
  }
  await webkitBrowser.close();

  return results;
}

// ── Claude Vision Analysis ────────────────────────────────────────────────────

async function analyseWithClaude(
  client:       Anthropic,
  spec:         PageSpec,
  screenshots:  BrowserScreenshots,
): Promise<CrossBrowserResult> {
  console.log(`  🤖 Analysing: ${spec.label}`);

  const chromiumB64 = toBase64(screenshots.chromiumPath);
  const webkitB64   = toBase64(screenshots.webkitPath);

  const prompt = `You are a cross-browser QA expert comparing how a web page renders in Chromium vs WebKit.

Page: "${spec.label}"
URL:  ${spec.url}

I am giving you two screenshots:
  Image 1: Chromium rendering
  Image 2: WebKit rendering

Analyse the visual differences and respond ONLY with valid JSON (no markdown, no backticks):

{
  "severity": "None | Minor | Moderate | Major | Critical",
  "summary": "One sentence describing the overall rendering difference",
  "differences": ["specific difference 1", "specific difference 2"],
  "recommendation": "What a QA engineer should do about this"
}

Severity guide:
  None     – Pixel-perfect match, no visible differences
  Minor    – Subtle differences (sub-pixel rendering, font hinting) — no user impact
  Moderate – Noticeable differences (spacing, colours) — low user impact  
  Major    – Layout or component differences — may affect usability
  Critical – Broken layout or missing elements — immediate fix required`;

  try {
    const response = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{
        role:    'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: chromiumB64 } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: webkitB64   } },
          { type: 'text',  text: prompt },
        ],
      }],
    });

    const raw     = (response.content[0] as any).text.trim();
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const json = JSON.parse(cleaned);

    return {
      pageId:         spec.id,
      label:          spec.label,
      chromiumPath:   screenshots.chromiumPath,
      webkitPath:     screenshots.webkitPath,
      severity:       json.severity       ?? 'Minor',
      summary:        json.summary        ?? 'Analysis complete.',
      differences:    json.differences    ?? [],
      recommendation: json.recommendation ?? 'No action required.',
      timestamp:      new Date().toISOString(),
    };
  } catch (err) {
    console.error(`    ⚠️  Claude Vision error for ${spec.id}: ${err}`);
    return {
      pageId:         spec.id,
      label:          spec.label,
      chromiumPath:   screenshots.chromiumPath,
      webkitPath:     screenshots.webkitPath,
      severity:       'Minor',
      summary:        'Analysis could not be completed.',
      differences:    [],
      recommendation: 'Manual review recommended.',
      timestamp:      new Date().toISOString(),
    };
  }
}

// ── HTML Report Generator ─────────────────────────────────────────────────────

function generateReport(results: CrossBrowserResult[]): void {
  const timestamp   = new Date().toLocaleString();
  const total       = results.length;
  const bySeverity  = (s: DiffSeverity) => results.filter(r => r.severity === s).length;
  const critical    = bySeverity('Critical');
  const major       = bySeverity('Major');
  const moderate    = bySeverity('Moderate');
  const minor       = bySeverity('Minor');
  const none        = bySeverity('None');

  const overallSeverity: DiffSeverity =
    critical > 0 ? 'Critical' :
    major    > 0 ? 'Major'    :
    moderate > 0 ? 'Moderate' :
    minor    > 0 ? 'Minor'    : 'None';

  // inline screenshots as base64 so the report is self-contained
  const cardHTML = results.map(r => {
    const cB64 = fs.existsSync(r.chromiumPath) ? toBase64(r.chromiumPath) : '';
    const wB64 = fs.existsSync(r.webkitPath)   ? toBase64(r.webkitPath)   : '';
    const diffsHTML = r.differences.length
      ? r.differences.map(d => `<li>${d}</li>`).join('')
      : '<li>No differences detected</li>';

    return `
    <div class="card" data-severity="${r.severity}">
      <div class="card-header" style="border-left: 4px solid ${severityColor(r.severity)}; background: ${severityBg(r.severity)};">
        <div class="card-title-row">
          <h3 class="card-title">${r.label}</h3>
          <span class="badge" style="background:${severityColor(r.severity)}">${r.severity}</span>
        </div>
        <p class="card-summary">${r.summary}</p>
      </div>
      <div class="screenshots">
        <div class="screenshot-col">
          <div class="browser-label chromium-label">🔵 Chromium</div>
          ${cB64 ? `<img src="data:image/png;base64,${cB64}" alt="Chromium screenshot" />` : '<div class="no-screenshot">Screenshot unavailable</div>'}
        </div>
        <div class="screenshot-col">
          <div class="browser-label webkit-label">🟠 WebKit</div>
          ${wB64 ? `<img src="data:image/png;base64,${wB64}" alt="WebKit screenshot" />` : '<div class="no-screenshot">Screenshot unavailable</div>'}
        </div>
      </div>
      <div class="card-footer">
        <div class="differences">
          <h4>Differences Found</h4>
          <ul>${diffsHTML}</ul>
        </div>
        <div class="recommendation">
          <h4>Recommendation</h4>
          <p>${r.recommendation}</p>
        </div>
      </div>
    </div>`;
  }).join('\n');

  const filterBtns = ['All', 'Critical', 'Major', 'Moderate', 'Minor', 'None'].map(s => `
    <button class="filter-btn ${s === 'All' ? 'active' : ''}" onclick="filterCards('${s}')">${s}</button>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FORGE — Cross-Browser Visual Diff Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@400;600;800&display=swap');

    :root {
      --bg:        #0d0f14;
      --surface:   #13161d;
      --border:    #1e2330;
      --text:      #e2e8f0;
      --muted:     #64748b;
      --accent:    #38bdf8;
      --chromium:  #4285f4;
      --webkit:    #ff6b35;
      --none:      #22c55e;
      --minor:     #84cc16;
      --moderate:  #f59e0b;
      --major:     #ef4444;
      --critical:  #dc2626;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Syne', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    /* ── Header ── */
    .header {
      background: linear-gradient(135deg, #0d0f14 0%, #111827 50%, #0d0f14 100%);
      border-bottom: 1px solid var(--border);
      padding: 2.5rem 2rem 2rem;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse 60% 80% at 50% -20%, rgba(56,189,248,0.08) 0%, transparent 70%);
    }
    .header-inner {
      max-width: 1400px;
      margin: 0 auto;
      position: relative;
    }
    .header-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .logo {
      font-size: 0.7rem;
      font-family: 'JetBrains Mono', monospace;
      color: var(--accent);
      letter-spacing: 0.2em;
      text-transform: uppercase;
      margin-bottom: 0.4rem;
    }
    h1 {
      font-size: 2rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    h1 span { color: var(--accent); }
    .header-meta {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: var(--muted);
      margin-top: 0.5rem;
    }
    .overall-badge {
      padding: 0.4rem 1.2rem;
      border-radius: 100px;
      font-weight: 700;
      font-size: 0.85rem;
      letter-spacing: 0.05em;
      color: #fff;
      background: ${severityColor(overallSeverity)};
      align-self: center;
    }

    /* ── Stats ── */
    .stats {
      display: flex;
      gap: 1rem;
      margin-top: 1.8rem;
      flex-wrap: wrap;
    }
    .stat {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.8rem 1.2rem;
      min-width: 90px;
      text-align: center;
    }
    .stat-number {
      font-size: 1.6rem;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
      line-height: 1;
    }
    .stat-label {
      font-size: 0.65rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-top: 0.2rem;
    }

    /* ── Filters ── */
    .filters {
      max-width: 1400px;
      margin: 1.5rem auto 0;
      padding: 0 2rem;
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .filter-btn {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 6px;
      padding: 0.4rem 1rem;
      font-family: 'Syne', sans-serif;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.15s;
    }
    .filter-btn:hover, .filter-btn.active {
      background: var(--accent);
      border-color: var(--accent);
      color: #000;
    }

    /* ── Cards ── */
    .cards {
      max-width: 1400px;
      margin: 1.5rem auto 3rem;
      padding: 0 2rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      transition: opacity 0.2s;
    }
    .card.hidden { display: none; }

    .card-header {
      padding: 1.2rem 1.5rem;
    }
    .card-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .card-title {
      font-size: 1.05rem;
      font-weight: 600;
    }
    .badge {
      padding: 0.25rem 0.75rem;
      border-radius: 100px;
      font-size: 0.72rem;
      font-weight: 700;
      color: #fff;
      letter-spacing: 0.05em;
      white-space: nowrap;
    }
    .card-summary {
      font-size: 0.85rem;
      color: var(--muted);
      margin-top: 0.4rem;
      line-height: 1.5;
    }

    /* ── Screenshots ── */
    .screenshots {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .screenshot-col {
      position: relative;
    }
    .screenshot-col:first-child {
      border-right: 1px solid var(--border);
    }
    .browser-label {
      position: absolute;
      top: 0.6rem;
      left: 0.6rem;
      z-index: 2;
      font-size: 0.72rem;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 4px;
      backdrop-filter: blur(8px);
    }
    .chromium-label {
      background: rgba(66,133,244,0.85);
      color: #fff;
    }
    .webkit-label {
      background: rgba(255,107,53,0.85);
      color: #fff;
    }
    .screenshot-col img {
      width: 100%;
      display: block;
      max-height: 400px;
      object-fit: cover;
      object-position: top;
    }
    .no-screenshot {
      height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-size: 0.85rem;
      background: #0a0c10;
    }

    /* ── Card Footer ── */
    .card-footer {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
    }
    .differences, .recommendation {
      padding: 1rem 1.5rem;
    }
    .differences {
      border-right: 1px solid var(--border);
    }
    .card-footer h4 {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      margin-bottom: 0.6rem;
    }
    .differences ul {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .differences li {
      font-size: 0.82rem;
      color: var(--text);
      padding-left: 1rem;
      position: relative;
      line-height: 1.4;
    }
    .differences li::before {
      content: '▸';
      position: absolute;
      left: 0;
      color: var(--accent);
    }
    .recommendation p {
      font-size: 0.82rem;
      color: var(--text);
      line-height: 1.5;
    }

    /* ── Footer ── */
    .page-footer {
      text-align: center;
      padding: 2rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      color: var(--muted);
      border-top: 1px solid var(--border);
    }

    @media (max-width: 768px) {
      .screenshots, .card-footer { grid-template-columns: 1fr; }
      .differences { border-right: none; border-bottom: 1px solid var(--border); }
      h1 { font-size: 1.4rem; }
    }
  </style>
</head>
<body>

<header class="header">
  <div class="header-inner">
    <div class="header-top">
      <div>
        <div class="logo">FORGE — Phase 3.2</div>
        <h1>Cross-Browser <span>Visual Diff</span></h1>
        <div class="header-meta">Generated: ${timestamp} &nbsp;|&nbsp; Target: ${getBaseUrl()} &nbsp;|&nbsp; ${total} pages compared</div>
      </div>
      <span class="overall-badge">Overall: ${overallSeverity}</span>
    </div>
    <div class="stats">
      <div class="stat">
        <div class="stat-number">${total}</div>
        <div class="stat-label">Pages</div>
      </div>
      <div class="stat">
        <div class="stat-number" style="color:var(--none)">${none}</div>
        <div class="stat-label">None</div>
      </div>
      <div class="stat">
        <div class="stat-number" style="color:var(--minor)">${minor}</div>
        <div class="stat-label">Minor</div>
      </div>
      <div class="stat">
        <div class="stat-number" style="color:var(--moderate)">${moderate}</div>
        <div class="stat-label">Moderate</div>
      </div>
      <div class="stat">
        <div class="stat-number" style="color:var(--major)">${major}</div>
        <div class="stat-label">Major</div>
      </div>
      <div class="stat">
        <div class="stat-number" style="color:var(--critical)">${critical}</div>
        <div class="stat-label">Critical</div>
      </div>
    </div>
  </div>
</header>

<div class="filters">
  ${filterBtns}
</div>

<div class="cards" id="cards">
  ${cardHTML}
</div>

<footer class="page-footer">
  FORGE — Autonomous Quality Engineering &nbsp;·&nbsp; Phase 3.2 Cross-Browser Visual Diff &nbsp;·&nbsp; Powered by Claude Vision
</footer>

<script>
  function filterCards(severity) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.card').forEach(card => {
      if (severity === 'All' || card.dataset.severity === severity) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    });
  }
</script>

</body>
</html>`;

  fs.writeFileSync(REPORT_PATH, html, 'utf8');
  console.log(`\n📊 Report saved: ${REPORT_PATH}`);
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args        = process.argv.slice(2);
  const captureOnly = args.includes('--capture');
  const pageFilter  = args.find(a => a.startsWith('--page='))?.split('=')[1]
                   ?? (args[args.indexOf('--page') + 1] !== undefined && !args[args.indexOf('--page') + 1].startsWith('--')
                       ? args[args.indexOf('--page') + 1]
                       : undefined);

  const specs = pageFilter
    ? PAGE_SPECS.filter(s => s.id === pageFilter)
    : PAGE_SPECS;

  if (specs.length === 0) {
    console.error(`❌ No page found with id "${pageFilter}". Available: ${PAGE_SPECS.map(s => s.id).join(', ')}`);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('  FORGE Phase 3.2 — Cross-Browser Visual Diff');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Pages:   ${specs.length}`);
  console.log(`  Browsers: Chromium + WebKit`);
  console.log(`  Output:  ${OUTPUT_DIR}`);
  console.log('═══════════════════════════════════════════════════\n');

  ensureDirs();

  // Step 1 — Capture
  const screenshots = await captureScreenshots(specs);

  if (captureOnly) {
    console.log('\n✅ Capture complete (--capture flag set, skipping analysis)');
    return;
  }

  // Step 2 — Claude Vision Analysis
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY not set in .env');
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  console.log('\n🤖 Running Claude Vision cross-browser analysis...');
  const results: CrossBrowserResult[] = [];

  for (const spec of specs) {
    const shots = screenshots.get(spec.id);
    if (!shots || !shots.chromiumPath || !shots.webkitPath) {
      console.warn(`  ⚠️  Skipping ${spec.id} — missing one or both screenshots`);
      continue;
    }
    if (!fs.existsSync(shots.chromiumPath) || !fs.existsSync(shots.webkitPath)) {
      console.warn(`  ⚠️  Skipping ${spec.id} — screenshot file(s) not found on disk`);
      continue;
    }
    const result = await analyseWithClaude(client, spec, shots);
    results.push(result);
  }

  // Step 3 — Save JSON
  fs.writeFileSync(JSON_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log(`📁 JSON results: ${JSON_PATH}`);

  // Step 4 — Generate HTML report
  generateReport(results);

  // Step 5 — Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  CROSS-BROWSER DIFF SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  results.forEach(r => {
    const icon = { None: '✅', Minor: '🟡', Moderate: '🟠', Major: '🔴', Critical: '💥' }[r.severity] ?? '⚪';
    console.log(`  ${icon} [${r.severity.padEnd(8)}] ${r.label}`);
  });

  const critical = results.filter(r => r.severity === 'Critical').length;
  const major    = results.filter(r => r.severity === 'Major').length;
  console.log('\n  ─────────────────────────────────────────────────');
  console.log(`  Total: ${results.length} pages | Critical: ${critical} | Major: ${major}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Step 6 — Open report
  const { exec } = await import('child_process');
  const absPath  = path.resolve(REPORT_PATH);
  const open     = process.platform === 'win32' ? `start "" "${absPath}"` :
                   process.platform === 'darwin' ? `open "${absPath}"` : `xdg-open "${absPath}"`;
  exec(open);
  console.log('🌐 Opening report in browser...\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
