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
 * platform-server.ts
 * ─────────────────────────────────────────────────────────────
 * FORGE — Autonomous Quality Engineering
 * Phase 3.8.a — RUN TESTS tab
 *
 * ARCHITECTURE (the agreed clean split):
 *   - This file is a TypeScript HTTP server + JSON API ONLY.
 *     There are NO HTML/JS strings embedded in this file, which is
 *     what caused the persistent template-literal syntax errors before.
 *   - platform.html  = static HTML, served from disk
 *   - platform.js    = client logic, served from disk
 *
 * RETIRED: This implementation is preserved for history and must not start.
 * Use the canonical platform with: forge ui
 * ─────────────────────────────────────────────────────────────
 */

import * as http   from 'http';
import * as fs     from 'fs';
import * as path   from 'path';
import * as dotenv from 'dotenv';
import { spawn }   from 'child_process';
import Anthropic   from '@anthropic-ai/sdk';
import {
  PAGE_OBJECT_METHODS as SHARED_PAGE_OBJECT_METHODS,
  getLastEcNum as getSharedLastEcNum,
  getLastTcNum as getSharedLastTcNum,
  getSpecSummary,
} from '../core/ai/generation-context';
import { getAppName, getBaseUrl } from '../core/config/appConfig'

console.error('Legacy platform server is retired. Use: forge ui')
process.exit(1)

dotenv.config();

// ── Config ────────────────────────────────────────────────────
const PORT       = 4300;                       // new port — 4280 had baggage
const SRC_DIR    = __dirname;                  // src/  (where platform.html / .js live)
const REPORTS    = path.join(process.cwd(), 'reports');
const HISTORY    = path.join(REPORTS, 'run-history.json');
const TEST_JSON  = path.join(REPORTS, 'test-results.json');

// Suite → base Playwright command. Mirrors run.ts exactly so the
// platform produces identical runs to `npm test` / `npm run test:full`.
const SUITES: Record<string, { label: string; base: string; usesBrowsers: boolean }> = {
  stable: { label: 'Stable', base: 'npx playwright test --grep-invert "@slow|@flaky"', usesBrowsers: true  },
  full:   { label: 'Full',   base: 'npx playwright test',                                usesBrowsers: true  },
  smoke:  { label: 'Smoke',  base: 'npx playwright test loginFast.spec.ts e2e-journey.spec.ts', usesBrowsers: true },
  api:    { label: 'API',    base: 'npx playwright test --project=api',                  usesBrowsers: false },
};

const VALID_BROWSERS = ['chromium', 'webkit'];
const GEN_MARKER     = '@@GEN@@ ';   // client filters these lines from display

// Single in-flight run guard (local, single-user tool).
let isRunning = false;

let onboardRunning  = false;
let onboardOutput:  string[] = [];

// ── Review state ────────────────────────────────────────────────────────────
interface ReviewRecord {
  name:            string
  content:         string
  status:          'pending' | 'promoted' | 'rejected'
  sourcePath:      string
  suggestedTarget: string
  targetFile?:     string
  promotedAt?:     string
}
const reviewStore = new Map<string, ReviewRecord[]>()  // keyed by appName
let onboardStatus:  'idle' | 'running' | 'done' | 'error' = 'idle';

// ── Helpers ───────────────────────────────────────────────────
function load<T>(filePath: string, fallback: T): T {
  try {
    return fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      : fallback;
  } catch { return fallback; }
}

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function serveStatic(res: http.ServerResponse, file: string, contentType: string): void {
  const full = path.join(SRC_DIR, file);
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${file}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
  });
}

/**
 * Build the Playwright command for a suite + selected browsers.
 * API ignores browser selection (uses the `api` project).
 */
function buildPlaywrightCmd(suite: string, browsers: string[]): string {
  const def = SUITES[suite];
  if (!def.usesBrowsers) return def.base;
  const selected = browsers.filter((b) => VALID_BROWSERS.includes(b));
  const list = selected.length ? selected : ['chromium']; // sane default
  const flags = list.map((b) => `--project=${b}`).join(' ');
  return `${def.base} ${flags}`.trim();
}

/**
 * Spawn a shell command and stream its stdout/stderr to the HTTP
 * response as it arrives. Resolves with the exit code.
 * shell:true mirrors run.ts (execSync) which is proven on Raj's Windows box.
 */
function streamCmd(cmd: string, res: http.ServerResponse, label: string): Promise<number> {
  return new Promise((resolve) => {
    res.write(`\n$ ${cmd}\n`);
    const child = spawn(cmd, {
      shell: true,
      cwd: process.cwd(),
      // PLAYWRIGHT_HTML_OPEN=never stops the HTML report popping up and
      // blocking the pipeline (run.ts sets this too).
      // PLATFORM_RUN=1 activates the live-progress reporter (platform-reporter.ts).
      env: { ...process.env, PLAYWRIGHT_HTML_OPEN: 'never', PLATFORM_RUN: '1' },
    });
    child.stdout.on('data', (d) => res.write(d));
    child.stderr.on('data', (d) => res.write(d));
    child.on('error', (err) => {
      res.write(`\n[${label}] spawn error: ${err.message}\n`);
      resolve(1);
    });
    child.on('close', (code) => {
      res.write(`\n[${label}] exited with code ${code ?? 0}\n`);
      resolve(code ?? 0);
    });
  });
}

// ── Auto-open browser ─────────────────────────────────────────
/**
 * Open the default browser at the given URL once the server is up.
 * Skipped in CI or when NO_OPEN is set. Best-effort — failures are silent.
 */
function openBrowser(url: string): void {
  if (process.env.CI || process.env.NO_OPEN) return;
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // `start` is a cmd builtin; the "" is the (empty) window title arg.
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch { /* best-effort only */ }
}

// ── Run summary ───────────────────────────────────────────────
/**
 * Preferred source: the last entry in run-history.json (what results-store.ts
 * writes — same numbers the dashboard shows). Falls back to test-results.json
 * stats if the store step hasn't run yet.
 */
function getLastRunSummary(): any {
  const history = load<any>(HISTORY, { runs: [] });
  const runs = history.runs ?? [];
  const last = runs[runs.length - 1];

  if (last && last.stats) {
    return {
      source:     'history',
      runId:      last.runId ?? null,
      timestamp:  last.timestamp ?? null,
      durationMs: last.durationMs ?? 0,
      stats:      last.stats, // { total, passed, failed, flaky, skipped, passRate }
    };
  }

  // Fallback — derive from raw Playwright JSON reporter output.
  const tr = load<any>(TEST_JSON, null);
  if (tr && tr.stats) {
    const s = tr.stats;
    const passed  = s.expected   ?? 0;
    const failed  = s.unexpected ?? 0;
    const flaky   = s.flaky      ?? 0;
    const skipped = s.skipped    ?? 0;
    const total   = passed + failed + flaky + skipped;
    const ran     = passed + failed + flaky;
    const passRate = ran > 0 ? `${((passed / ran) * 100).toFixed(1)}%` : '0.0%';
    return {
      source:     'test-results',
      runId:      null,
      timestamp:  s.startTime ?? null,
      durationMs: Math.round(s.duration ?? 0),
      stats:      { total, passed, failed, flaky, skipped, passRate },
    };
  }

  return null;
}

// ── Test Generator (Phase 3.8.c) ─────────────────────────────

let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

// Mirrors the SPEC_REGISTRY in nl-test-generator.ts — kept in sync manually.
const SPEC_REGISTRY: Record<string, { topic: string; describes: string[]; pageObjects: string[] }> = {
  'login.spec.ts':      { topic: 'authentication, login, logout, credentials, locked user', describes: ['P0 - Critical Login Tests', 'P1 - High Priority Tests', 'P2 - Data-Driven Tests'], pageObjects: ['LoginPage', 'InventoryPage'] },
  'inventory.spec.ts':  { topic: 'inventory, products, add to cart, cart badge, menu, sorting', describes: ['Inventory Page Tests'], pageObjects: ['LoginPage', 'InventoryPage'] },
  'cart.spec.ts':       { topic: 'cart, remove items, cart badge, checkout button, item names, prices', describes: ['Cart Functionality Tests'], pageObjects: ['LoginPage', 'InventoryPage', 'CartPage'] },
  'checkout.spec.ts':   { topic: 'checkout, payment, shipping info, order summary, tax, total price, complete order', describes: ['Checkout Flow Tests'], pageObjects: ['LoginPage', 'InventoryPage', 'CartPage', 'CheckoutPage'] },
  'e2e-journey.spec.ts':{ topic: 'end-to-end, full journey, multiple steps, complete workflow', describes: ['E2E User Journey Tests'], pageObjects: ['LoginPage', 'InventoryPage', 'CartPage', 'CheckoutPage'] },
  'edgeCases.spec.ts':  { topic: 'security, SQL injection, XSS, boundary, browser behavior, refresh, back button, self-healing', describes: ['Edge Cases - Security & Boundary Testing', 'Edge Cases - Browser Behavior', 'Edge Cases - Self-Healing Tests'], pageObjects: ['LoginPage', 'TestDataGenerator'] },
};

const PAGE_OBJECT_METHODS = `
LoginPage:
  goto() | login(username, password) | smartLogin(username, password)
  usernameField | passwordField | loginButton | errorMessage
  getErrorMessageText() | isErrorMessageVisible()

InventoryPage:
  pageTitle | shoppingCartLink | menuButton | addToCartButtons | inventoryItems
  addFirstItemToCart() | getInventoryItemCount() | getCartBadgeCount()
  isLoaded() — returns boolean (use instead of waitForLoad)

CartPage:
  pageTitle | cartItems | removeButtons | continueShoppingButton | checkoutButton
  getCartItemCount() | getCartBadgeCount() | getItemNames() | getItemPrices()
  removeFirstItem() | removeAllItems() | continueShopping() | proceedToCheckout() | isCartEmpty()

CheckoutPage:
  fillCheckoutInfo(first, last, zip) | continue() | cancel()
  isErrorVisible() | getErrorMessage()

CheckoutOverviewPage:
  pageTitle | getItemCount() | getItemTotal() | getTax() | getTotal() | finish() | cancel()

CheckoutCompletePage:
  isOrderComplete() | getCompleteMessage() | backToProducts()`;

function getLastTcNum(): number {
  let max = 0;
  try {
    const dir = path.join(process.cwd(), 'src', 'tests');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.spec.ts'));
    for (const file of files) {
      const c = fs.readFileSync(path.join(dir, file), 'utf-8');
      for (const m of c.match(/test\([`'"]TC(\d+)/g) ?? []) {
        const n = parseInt(m.replace(/test\([`'"]TC/, ''));
        if (n > max) max = n;
      }
    }
  } catch { /* first run — no files yet */ }
  return max;
}

function getLastEcNum(): number {
  let max = 0;
  try {
    const c = fs.readFileSync(path.join(process.cwd(), 'src', 'tests', 'edgeCases.spec.ts'), 'utf-8');
    for (const m of c.match(/test\([`'"]EC(\d+)/g) ?? []) {
      const n = parseInt(m.replace(/test\([`'"]EC/, ''));
      if (n > max) max = n;
    }
  } catch {}
  return max;
}

function buildSpecFile(decision: any, generated: any): string {
  const base = [
    "import { test, expect } from '@playwright/test';",
    "import { LoginPage } from '../../pages/LoginPage';",
  ];
  const extras = (generated.imports ?? []).filter((imp: string) =>
    !base.some(b => b.includes((imp.match(/\{[^}]+\}/)?.[0] ?? '@@').replace(/[{}]/g,'').trim()))
  );
  const imports = [...base, ...extras].join('\n');

  // Indent the test block inside the describe
  const indented = (generated.testCode ?? '')
    .split('\n').map((l: string) => '  ' + l).join('\n');

  return [
    imports, '',
    `test.describe('${decision.describeBlock}', () => {`,
    `  // Generated by FORGE — ${new Date().toLocaleString()}`,
    `  // Prompt: ${decision._prompt ?? ''}`, '',
    indented,
    '});', '',
  ].join('\n');
}

/**
 * Makes the two Claude API calls (decide placement → generate code),
 * streams progress text to `res`, and ends with a @@GEN@@ JSON marker
 * that the client parses to populate the code editor and placement card.
 */
async function handleGeneratePreview(
  req: http.IncomingMessage, res: http.ServerResponse
): Promise<void> {
  const body = await readBody(req);
  const prompt = String(body.prompt ?? '').trim();
  if (!prompt) return sendJson(res, 400, { error: 'prompt is required' });

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
  });

  const write = (s: string) => res.write(s);

  write(`════════════════════════════════════════════════\n`);
  write(` FORGE Test Generator — ${new Date().toLocaleString()}\n`);
  write(`════════════════════════════════════════════════\n\n`);
  write(`Prompt: "${prompt}"\n\n`);

  try {
    const ai = getAnthropic();
    const lastTc = getSharedLastTcNum();
    const lastEc = getSharedLastEcNum();
    const specSummary = getSpecSummary();

    // ── Step 1: Decide placement ───────────────────────────────
    write('[1/2] Deciding test placement...\n');
    const msg1 = await ai.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You are deciding where a new Playwright test belongs in a test framework for ${getAppName()}.

Spec files and their topics:
${specSummary}

Current TC/EC numbering:
Global last TC number: TC${String(lastTc).padStart(3,'0')} — next is TC${String(lastTc+1).padStart(3,'0')}
Global last EC number: EC${String(lastEc).padStart(3,'0')} — next is EC${String(lastEc+1).padStart(3,'0')}

User wants to create this test:
"${prompt}"

Decide:
1. Which spec file it belongs in
2. Which describe block within that file
3. What TC/EC number to assign (next available after the last)
4. Priority: P0=critical auth/core flow, P1=high priority, P2=data-driven, EC=edge case

Respond ONLY in this JSON (no markdown):
{"specFile":"filename.spec.ts","describeBlock":"exact describe block name","testId":"TC066","priority":"P0","reasoning":"one sentence why"}
CRITICAL: 3-digit zero-padded — TC066 ✓ not TC66. EC013 ✓ not EC13.`,
      }],
    });
    const d1 = msg1.content[0].type === 'text' ? msg1.content[0].text : '{}';
    const decision = JSON.parse(d1.replace(/```json|```/g, '').trim());
    decision._prompt = prompt;

    write(`      → ${decision.testId} in ${decision.specFile} (${decision.priority})\n`);
    write(`      → ${decision.reasoning}\n\n`);

    // ── Step 2: Generate code ──────────────────────────────────
    write('[2/2] Generating test code...\n');
    const msg2 = await ai.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: `You are a senior QA automation engineer writing Playwright tests for ${getAppName()} (${getBaseUrl()}).

STRICT STYLE RULES:
1. test('${decision.testId} - Description', async ({ page }) => {
2. End every test with: console.log('✅ ${decision.testId} - Brief success message');
3. Use Page Object Model — never raw selectors in tests.
4. Login pattern: new LoginPage(page) → goto() → login(username, password)
   where credentials come from APP_USERNAME / APP_PASSWORD env vars
5. TypeScript, properly typed. Short inline comment on every action line (max 8 words).
6. Use isLoaded() to check inventory page readiness — never call waitForLoad() (it does not exist).

Available Page Object methods:
${SHARED_PAGE_OBJECT_METHODS}

Base URL: ${getBaseUrl()}`,
      messages: [{
        role: 'user',
        content: `Generate a Playwright test for: "${prompt}"

Placement: ${decision.testId} in ${decision.specFile} → "${decision.describeBlock}" (${decision.priority})

Respond ONLY in this JSON (no markdown):
{"imports":["import { CartPage } from '../../pages/CartPage';"],"testCode":"the complete test() block","newMethods":["list any Page Object methods needed that do not yet exist — empty array if none"]}`,
      }],
    });
    const d2 = msg2.content[0].type === 'text' ? msg2.content[0].text : '{}';
    const generated = JSON.parse(d2.replace(/```json|```/g, '').trim());

    write(`      → ${(generated.testCode ?? '').split('\n').length} lines generated\n`);
    if ((generated.newMethods ?? []).length > 0) {
      write(`\n      ⚠️  New Page Object methods needed:\n`);
      generated.newMethods.forEach((m: string) => write(`         • ${m}\n`));
    }

    // Build standalone spec file content
    const area = decision.specFile.replace('.spec.ts', '')
      .replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    const fileName = `${decision.testId.toLowerCase()}-${area}.spec.ts`;
    const fullCode = buildSpecFile(decision, generated);

    write('\n════════════════════════════════════════════════\n');
    write(` Generation complete — ${fileName}\n`);
    write(`════════════════════════════════════════════════\n`);

    // Structured result for client — filtered from display
    const result = { type: 'gen-result', decision, code: fullCode, newMethods: generated.newMethods ?? [], fileName };
    res.write(`${GEN_MARKER}${JSON.stringify(result)}\n`);
  } catch (err: any) {
    write(`\n❌ Error: ${err?.message ?? err}\n`);
    res.write(`${GEN_MARKER}${JSON.stringify({ type: 'gen-error', message: err?.message ?? 'unknown' })}\n`);
  } finally {
    res.end();
  }
}

async function handleGenerateSave(
  req: http.IncomingMessage, res: http.ServerResponse
): Promise<void> {
  const body  = await readBody(req);
  const code  = String(body.code ?? '').trim();
  const raw   = String(body.fileName ?? '').trim();
  if (!code || !raw) return sendJson(res, 400, { error: 'code and fileName are required' });

  const fileName = path.basename(raw).replace(/[^a-z0-9\-_.]/gi, '-');
  if (!fileName.endsWith('.spec.ts')) return sendJson(res, 400, { error: 'fileName must end with .spec.ts' });

  const genDir  = path.join(process.cwd(), 'src', 'tests', 'generated');
  const outPath = path.join(genDir, fileName);
  fs.mkdirSync(genDir, { recursive: true });
  fs.writeFileSync(outPath, code, 'utf-8');

  sendJson(res, 200, { success: true, path: `src/tests/generated/${fileName}`, fileName });
}

async function handleGenerateRun(
  req: http.IncomingMessage, res: http.ServerResponse
): Promise<void> {
  const body = await readBody(req);
  const raw  = String(body.fileName ?? '').trim();
  if (!raw) return sendJson(res, 400, { error: 'fileName is required' });

  const fileName = path.basename(raw).replace(/[^a-z0-9\-_.]/gi, '-');
  if (!fileName.endsWith('.spec.ts')) return sendJson(res, 400, { error: 'fileName must end with .spec.ts' });

  const testPath = path.join(process.cwd(), 'src', 'tests', 'generated', fileName);
  if (!fs.existsSync(testPath)) return sendJson(res, 404, { error: `File not found: src/tests/generated/${fileName}` });

  if (isRunning) return sendJson(res, 409, { error: 'A run is already in progress.' });

  isRunning = true;
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
  });

  res.write(`\n════════════════════════════════════════════════\n`);
  res.write(` Validating: ${fileName}\n`);
  res.write(` Suite: Chromium only (quick validation)\n`);
  res.write(`════════════════════════════════════════════════\n`);

  try {
    // Use playwright.generated.config.ts so testIgnore: ['**/generated/**']
    // in the main config does not block explicitly-specified generated tests.
    await streamCmd(
      `npx playwright test ${fileName} --config=playwright.generated.config.ts --project=chromium`,
      res, 'validate'
    );
  } finally {
    isRunning = false;
    res.end();
  }
}

// ── Dashboard data ────────────────────────────────────────────

/**
 * Compute failure hotspots in both ranking modes from the full run history.
 * Both arrays are computed in one pass so the client can toggle instantly.
 *
 * Recent-weighted: most recent run = weight 1.0, decays by 0.1 per step
 *   toward a floor of 0.1 — a test failing 5× last week beats one failing
 *   10× six months ago.
 * All-time: raw failure count across every run.
 */
function computeHotspots(allRuns: any[]): { recent: any[]; all: any[] } {
  const n = allRuns.length;
  const map: Record<string, { title: string; count: number; score: number; lastSeen: string }> = {};

  allRuns.forEach((run, i) => {
    // i=0 is oldest; most recent run = index n-1 → weight 1.0
    const age = (n - 1) - i;                          // 0 = newest
    const weight = Math.max(0.1, 1 - age * 0.1);
    for (const f of run.failures ?? []) {
      const key = String(f.testTitle ?? f.title ?? '(unknown)');
      if (!map[key]) map[key] = { title: key, count: 0, score: 0, lastSeen: run.timestamp };
      map[key].count++;
      map[key].score += weight;
      if (new Date(run.timestamp) > new Date(map[key].lastSeen)) map[key].lastSeen = run.timestamp;
    }
  });

  const items = Object.values(map);
  return {
    recent: [...items].sort((a, b) => b.score - a.score).slice(0, 10),
    all:    [...items].sort((a, b) => b.count  - a.count).slice(0, 10),
  };
}

/**
 * Assemble the full dashboard payload. Called for every poll and manual refresh.
 * depth: how many recent runs to include in the trend chart (1–50).
 */
function getDashboardData(depth: number): any {
  const history  = load<any>(HISTORY, { runs: [] });
  const allRuns: any[] = history.runs ?? [];
  const chartRuns = allRuns.slice(-depth);          // last N for trend

  // ── Health snapshot (latest run + delta vs. previous) ──────
  const latest = allRuns[allRuns.length - 1] ?? null;
  const prev   = allRuns[allRuns.length - 2] ?? null;
  let health: any = null;
  if (latest) {
    const s = latest.stats;
    const delta = prev ? {
      passed:   s.passed   - prev.stats.passed,
      failed:   s.failed   - prev.stats.failed,
      flaky:    s.flaky    - prev.stats.flaky,
      passRate: (parseFloat(s.passRate) - parseFloat(prev.stats.passRate)).toFixed(1),
    } : null;
    health = { stats: s, durationMs: latest.durationMs, timestamp: latest.timestamp, runId: latest.runId, delta };
  }

  // ── Hotspots (computed over full history for meaningful signal) ─
  const hotspots = allRuns.length ? computeHotspots(allRuns) : { recent: [], all: [] };

  // ── Coverage gaps (optional — generated by coverage-gap.ts) ──
  const covRaw = load<any>(path.join(REPORTS, 'coverage-gaps.json'), null);
  let coverage: any = null;
  if (covRaw?.areas) {
    const areas = covRaw.areas as any[];
    coverage = {
      totalAreas: areas.length,
      totalGaps:  areas.reduce((a, ar) => a + (ar.gaps?.length ?? 0), 0),
      avgScore:   areas.length
        ? Math.round(areas.reduce((a, ar) => a + (ar.coverageScore ?? 0), 0) / areas.length)
        : 0,
      areas: areas.map(ar => ({ area: ar.area, score: ar.coverageScore ?? 0, gaps: ar.gaps?.length ?? 0 })),
    };
  }

  // ── Release notes (optional — generated by release-notes.ts) ─
  const relRaw = load<any>(path.join(REPORTS, 'release-notes.json'), null);
  const release = relRaw ? {
    version:       relRaw.version,
    period:        relRaw.period,
    healthScore:   relRaw.healthScore,
    trend:         relRaw.trend,
    passRateTrend: relRaw.passRateTrend,
    runsAnalysed:  relRaw.runsAnalysed,
    generatedAt:   relRaw.generatedAt ?? relRaw.lastUpdated,
  } : null;

  return { chartRuns, health, hotspots, coverage, release, totalRuns: allRuns.length };
}

// ── Per-test drilldown ────────────────────────────────────────
/**
 * Parse test-results.json (Playwright JSON reporter) into categorized
 * per-test lists for the Last Run drilldown. test.status is the outcome:
 *   expected → passed, unexpected → failed, flaky → flaky, skipped → skipped.
 */
function getLastRunTests(): any {
  const empty = { total: 0, passed: [], failed: [], flaky: [], skipped: [] };
  const tr = load<any>(TEST_JSON, null);
  if (!tr || !tr.suites) return empty;

  const passed: any[] = [], failed: any[] = [], flaky: any[] = [], skipped: any[] = [];

  // Playwright embeds ANSI color codes in error messages; strip them so the
  // assertion diff renders cleanly in the browser.
  const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '');

  function walk(suites: any[], parentFile: string | null): void {
    for (const s of suites ?? []) {
      const file = s.file ?? parentFile;
      for (const sp of s.specs ?? []) {
        for (const t of sp.tests ?? []) {
          const results = t.results ?? [];
          const durationMs = Math.round(results.reduce((a: number, r: any) => a + (r.duration ?? 0), 0));
          const last = results[results.length - 1] ?? {};

          // Collect every error on the final attempt (full message + stack).
          const errs = (last.errors && last.errors.length)
            ? last.errors
            : (last.error ? [last.error] : []);
          let errorFull = errs
            .map((e: any) => stripAnsi(String(e?.message ?? e?.stack ?? '')))
            .filter(Boolean)
            .join('\n\n────────\n\n');
          if (errorFull.length > 6000) errorFull = errorFull.slice(0, 6000) + '\n… (truncated)';
          const error = errorFull ? errorFull.split('\n')[0] : '';

          const item = {
            title:      sp.title ?? '(untitled)',
            project:    t.projectName ?? '',
            file:       file ? path.basename(file) : '',
            line:       sp.line ?? 0,
            durationMs,
            status:     t.status,
            error,        // first line — shown on the row
            errorFull,    // full assertion/failure detail — shown when expanded
          };
          if      (t.status === 'expected')   passed.push(item);
          else if (t.status === 'unexpected') failed.push(item);
          else if (t.status === 'flaky')      flaky.push(item);
          else if (t.status === 'skipped')    skipped.push(item);
          else                                passed.push(item);
        }
      }
      if (s.suites) walk(s.suites, file);
    }
  }

  walk(tr.suites, null);
  const total = passed.length + failed.length + flaky.length + skipped.length;
  return { total, passed, failed, flaky, skipped };
}

// ── Review helpers ──────────────────────────────────────────────────────────
  function suggestTarget(content: string, appType: string): string {
    if (/\/pim\//i.test(content)         || /pim/i.test(content))         return 'pim.spec.ts'
    if (/\/leave\//i.test(content)       || /leave/i.test(content))       return 'leave.spec.ts'
    if (/\/time\//i.test(content)        || /time/i.test(content))        return 'time.spec.ts'
    if (/\/admin\//i.test(content)       || /admin/i.test(content))       return 'admin.spec.ts'
    if (/\/recruitment\//i.test(content) || /recruit/i.test(content))     return 'recruitment.spec.ts'
    if (/\/performance\//i.test(content) || /performance/i.test(content)) return 'performance.spec.ts'
    if (/\/auth|\/login/i.test(content)  || /auth|login/i.test(content))  return 'auth.spec.ts'
    if (/\/booking/i.test(content)       || /booking/i.test(content))     return 'api-booking.spec.ts'
    if (/\/inventory|\/cart|\/checkout/i.test(content))                   return 'e2e.spec.ts'
    return 'promoted.spec.ts'
  }
  function getGeneratedSpecs(appName: string): ReviewRecord[] {
    const appDirs = [
      path.join(process.cwd(), 'src', 'apps', 'desktop', 'ui', appName, 'generated', 'specs'),
      path.join(process.cwd(), 'src', 'apps', 'desktop', 'api', appName, 'generated'),
    ]
    const records: ReviewRecord[] = reviewStore.get(appName) ? [...reviewStore.get(appName)!] : []
    const knownNames = new Set(records.map(r => r.name))
    for (const dir of appDirs) {
      if (!fs.existsSync(dir)) continue
      const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.spec.ts') || f.endsWith('.generated.spec.ts'))
      for (const file of files) {
        const filePath = path.join(dir, file)
        const content  = fs.readFileSync(filePath, 'utf-8')
        const lines    = content.split('\n')
        let   i        = 0
        while (i < lines.length) {
          const line = lines[i]
          const m    = line.match(/^\s*test\(['"](.+?)['"]/)
          if (m) {
            const testName = m[1]
            if (!knownNames.has(testName)) {
              const prevLine = i > 0 ? lines[i-1] : ''
              const status: 'pending' | 'promoted' | 'rejected' =
                prevLine.includes('@promoted') ? 'promoted' :
                prevLine.includes('@rejected') ? 'rejected' : 'pending'
              let depth = 0, start = i, end = i
              for (let j = i; j < lines.length; j++) {
                depth += (lines[j].match(/\{/g) || []).length
                depth -= (lines[j].match(/\}/g) || []).length
                if (j > start && depth <= 0) { end = j; break }
              }
              const testContent = lines.slice(start, end + 1).join('\n')
              records.push({
                name:            testName,
                content:         testContent,
                status,
                sourcePath:      filePath,
                suggestedTarget: suggestTarget(testContent, appName),
              })
              knownNames.add(testName)
            }
          }
          i++
        }
      }
    }
    reviewStore.set(appName, records)
    return records
  }
  function promoteTest(
    appName:    string,
    name:       string,
    sourcePath: string,
    content:    string,
    targetFile: string
  ): void {
    const isApi    = sourcePath.includes('/api/')
    const testsDir = isApi
      ? path.join(process.cwd(), 'src', 'apps', 'desktop', 'api', appName, 'tests')
      : path.join(process.cwd(), 'src', 'apps', 'desktop', 'ui', appName, 'tests')
    fs.mkdirSync(testsDir, { recursive: true })
    const targetPath = path.join(testsDir, targetFile)
    const date  = new Date().toISOString().split('T')[0]
    const block = `\n// ── Promoted from generated · ${date} ──────────────────────────\n${content}\n`
    if (!fs.existsSync(targetPath)) {
      const fixturesPath = isApi
        ? `'../generated/fixtures'`
        : `'../generated/fixtures.generated'`
      const header = `import { test, expect } from ${fixturesPath}\n`
      fs.writeFileSync(targetPath, header + block, 'utf-8')
    } else {
      fs.appendFileSync(targetPath, block, 'utf-8')
    }
    if (fs.existsSync(sourcePath)) {
      const src     = fs.readFileSync(sourcePath, 'utf-8')
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const updated = src.replace(
        new RegExp(`(\\s*test\\(['"]${escaped}['"])`),
        `\n// @promoted → ${targetFile} · ${date}$1`
      )
      fs.writeFileSync(sourcePath, updated, 'utf-8')
    }
    const records = reviewStore.get(appName) || []
    const rec     = records.find(r => r.name === name)
    if (rec) {
      rec.status     = 'promoted'
      rec.targetFile = targetFile
      rec.promotedAt = date
    }
    reviewStore.set(appName, records)
  }
  // ── Review route handlers ───────────────────────────────────────────────────
  async function handleReviewApps(
    _req: http.IncomingMessage,
    res:  http.ServerResponse
  ): Promise<void> {
    const appsRoot = path.join(process.cwd(), 'src', 'apps')
    const apps: string[] = []
    for (const platform of ['desktop']) {
      for (const type of ['ui', 'api']) {
        const dir = path.join(appsRoot, platform, type)
        if (!fs.existsSync(dir)) continue
        for (const appName of fs.readdirSync(dir)) {
          const genDir1 = path.join(dir, appName, 'generated', 'specs')
          const genDir2 = path.join(dir, appName, 'generated')
          const hasSpecs =
            (fs.existsSync(genDir1) && fs.readdirSync(genDir1).some((f: string) => f.endsWith('.spec.ts'))) ||
            (fs.existsSync(genDir2) && fs.readdirSync(genDir2).some((f: string) => f.endsWith('.spec.ts')))
          if (hasSpecs && !apps.includes(appName)) apps.push(appName)
        }
      }
    }
    sendJson(res, 200, { apps })
  }
  async function handleReviewTests(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const parsedUrl = new URL(req.url ?? '', 'http://localhost')
    const appName   = parsedUrl.searchParams.get('app') ?? ''
    if (!appName) { sendJson(res, 400, { error: 'app required' }); return }
    const tests = getGeneratedSpecs(appName)
    sendJson(res, 200, { tests })
  }
  async function handleReviewTargets(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const parsedUrl = new URL(req.url ?? '', 'http://localhost')
    const appName   = parsedUrl.searchParams.get('app') ?? ''
    if (!appName) { sendJson(res, 400, { error: 'app required' }); return }
    const targets: string[] = []
    for (const type of ['ui', 'api']) {
      const testsDir = path.join(process.cwd(), 'src', 'apps', 'desktop', type, appName, 'tests')
      if (!fs.existsSync(testsDir)) continue
      fs.readdirSync(testsDir)
        .filter((f: string) => f.endsWith('.spec.ts') && !f.includes('.generated.'))
        .forEach((f: string) => { if (!targets.includes(f)) targets.push(f) })
    }
    sendJson(res, 200, { targets })
  }
  async function handleReviewExecute(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body       = await readBody(req)
    const appName    = String(body.app        ?? '').trim()
    const name       = String(body.name       ?? '').trim()
    const content    = String(body.content    ?? '').trim()
    const sourcePath = String(body.sourcePath ?? '').trim()
    if (!appName || !content) {
      sendJson(res, 400, { error: 'app and content required' })
      return
    }
    // Use repo root temp folder — no dots, no deep nesting, safe on Windows
    const tempDir  = path.join(process.cwd(), 'forge-temp')
    fs.mkdirSync(tempDir, { recursive: true })
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)
    const tempFile = path.join(tempDir, `${safeName}.spec.ts`)
    // Copy all dependency files (fixtures, page objects, api clients) into forge-temp
    // so the spec can use simple relative imports without path rewriting
    const copiedFiles = new Set<string>()
    function copyDep(depPath: string): string | null {
      if (!depPath || !fs.existsSync(depPath)) return null
      if (fs.statSync(depPath).isDirectory()) return null
      const destName = path.basename(depPath)
      const destPath = path.join(tempDir, destName)
      if (!copiedFiles.has(destPath)) {
        let depContent = fs.readFileSync(depPath, 'utf-8')
        // Recursively resolve any imports in this dependency
        const depDir = path.dirname(depPath)
        depContent = depContent.replace(/from ['"](\.[^'"]+)['"]/g, (_: string, rel: string) => {
          const absRel = path.resolve(depDir, rel)
          for (const ext of ['.ts', '.js', '']) {
            const candidate = absRel + ext
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
              copyDep(candidate)
              return `from './${path.basename(candidate)}'`
            }
          }
          if (fs.existsSync(absRel) && fs.statSync(absRel).isFile()) {
            copyDep(absRel)
            return `from './${path.basename(absRel)}'`
          }
          return `from '${rel}'`
        })
        fs.writeFileSync(destPath, depContent, 'utf-8')
        copiedFiles.add(destPath)
      }
      return path.basename(destPath)
    }
    // Build spec content with corrected relative imports
    let imports = ''
    if (sourcePath && fs.existsSync(sourcePath)) {
      const src = fs.readFileSync(sourcePath, 'utf-8')
      const sourceDir = path.dirname(sourcePath)
      // Process each import line — copy dependency into forge-temp
      const importLines = src
        .split('\n')
        .filter((l: string) => l.trim().startsWith('import '))
        .map((l: string) => {
          return l.replace(/from ['"](\.[^'"]+)['"]/g, (_: string, rel: string) => {
            const absPath = path.resolve(sourceDir, rel)
            for (const ext of ['', '.ts', '.js']) {
              const candidate = absPath + ext
              if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                copyDep(candidate)
                return `from './${path.basename(candidate).replace(/\.ts$/, '')}'`
              }
            }
            return `from '${rel}'`
          })
        })
        .join('\n')
      if (importLines) imports = importLines + '\n\n'
    }
    if (!imports) {
      imports = "import { test, expect } from '@playwright/test'\n\n"
    }
    // Write the spec file with corrected imports
    fs.writeFileSync(tempFile, imports + content, 'utf-8')
    console.log('[debug] temp file content:', fs.readFileSync(tempFile, 'utf-8'))
    // Build a minimal playwright config inline to avoid testIgnore blocking
    const tempConfig = path.join(tempDir, 'pw.config.ts')
    fs.writeFileSync(tempConfig, `
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '${tempDir.replace(/\\/g, '\\\\')}',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'https://www.saucedemo.com',
    headless: true,
  },
})
`, 'utf-8')
    const { execSync } = require('child_process')
    let output  = ''
    let passed  = false
    let summary = ''
    try {
      const configPath = tempConfig.replace(/\\/g, '/')
      const cmd = `npx playwright test --config="${configPath}" --reporter=list`
      output = execSync(cmd, {
        cwd:      process.cwd(),
        encoding: 'utf-8',
        timeout:  60000,
        shell:    true,
        env:      { ...process.env }
      })
      passed  = true
      const m = output.match(/(\d+) passed/)
      summary = m ? `${m[1]} passed` : 'passed'
    } catch (e: any) {
      output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n')
      passed  = false
    } finally {
      try { fs.unlinkSync(tempFile)   } catch {}
      try { fs.unlinkSync(tempConfig) } catch {}
      // Clean up copied dependency files
      copiedFiles.forEach((f: string) => { try { fs.unlinkSync(f) } catch {} })
    }
    sendJson(res, 200, { passed, output, summary })
  }
  async function handleReviewSave(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body       = await readBody(req)
    const appName    = String(body.app        ?? '').trim()
    const name       = String(body.name       ?? '').trim()
    const sourcePath = String(body.sourcePath ?? '').trim()
    const content    = String(body.content    ?? '').trim()
    if (!appName || !sourcePath || !content) { sendJson(res, 400, { error: 'missing fields' }); return }
    if (fs.existsSync(sourcePath)) {
      const src     = fs.readFileSync(sourcePath, 'utf-8')
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const srcLines = src.split('\n')
      let start = -1, end = -1, depth = 0
      for (let i = 0; i < srcLines.length; i++) {
        if (start === -1 && srcLines[i].match(new RegExp(`test\\(['"]${escaped}['"]`))) {
          start = i
        }
        if (start !== -1) {
          depth += (srcLines[i].match(/\{/g) || []).length
          depth -= (srcLines[i].match(/\}/g) || []).length
          if (i > start && depth <= 0) { end = i; break }
        }
      }
      if (start !== -1 && end !== -1) {
        const updated = [...srcLines.slice(0, start), ...content.split('\n'), ...srcLines.slice(end + 1)]
        fs.writeFileSync(sourcePath, updated.join('\n'), 'utf-8')
      }
    }
    const records = reviewStore.get(appName) || []
    const rec     = records.find(r => r.name === name)
    if (rec) rec.content = content
    reviewStore.set(appName, records)
    sendJson(res, 200, { ok: true })
  }
  async function handleReviewPromote(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body       = await readBody(req)
    const appName    = String(body.app        ?? '').trim()
    const name       = String(body.name       ?? '').trim()
    const sourcePath = String(body.sourcePath ?? '').trim()
    const content    = String(body.content    ?? '').trim()
    const targetFile = String(body.targetFile ?? 'promoted.spec.ts').trim()
    if (!appName || !name || !content) { sendJson(res, 400, { error: 'missing fields' }); return }
    promoteTest(appName, name, sourcePath, content, targetFile)
    sendJson(res, 200, { ok: true, targetFile })
  }
  async function handleReviewReject(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body       = await readBody(req)
    const appName    = String(body.app        ?? '').trim()
    const name       = String(body.name       ?? '').trim()
    const sourcePath = String(body.sourcePath ?? '').trim()
    if (!appName || !name) { sendJson(res, 400, { error: 'missing fields' }); return }
    if (fs.existsSync(sourcePath)) {
      const src     = fs.readFileSync(sourcePath, 'utf-8')
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const updated = src.replace(
        new RegExp(`(\\s*test\\(['"]${escaped}['"])`),
        `\n// @rejected · ${new Date().toISOString().split('T')[0]}$1`
      )
      fs.writeFileSync(sourcePath, updated, 'utf-8')
    }
    const records = reviewStore.get(appName) || []
    const rec     = records.find(r => r.name === name)
    if (rec) rec.status = 'rejected'
    reviewStore.set(appName, records)
    sendJson(res, 200, { ok: true })
  }
  async function handleReviewPromoteBulk(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body    = await readBody(req)
    const appName = String(body.app ?? '').trim()
    const tests   = Array.isArray(body.tests) ? body.tests : []
    if (!appName || tests.length === 0) { sendJson(res, 400, { error: 'missing fields' }); return }
    const results: { name: string; targetFile: string }[] = []
    for (const t of tests) {
      const name       = String(t.name       ?? '')
      const sourcePath = String(t.sourcePath ?? '')
      const content    = String(t.content    ?? '')
      const targetFile = String(t.targetFile ?? 'promoted.spec.ts')
      if (!name || !content) continue
      promoteTest(appName, name, sourcePath, content, targetFile)
      results.push({ name, targetFile })
    }
    sendJson(res, 200, { results })
  }
// ── Onboard handlers ─────────────────────────────────────────────────────
async function handleOnboardStart(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (onboardRunning) {
    sendJson(res, 409, { error: 'An onboard run is already in progress.' });
    return;
  }
  const body    = await readBody(req);
  const command = String(body.command ?? 'crawl');
  const appName = String(body.appName ?? '').trim();
  const baseUrl = String(body.baseUrl ?? '').trim();
  const appType = String(body.appType ?? 'web-ui').trim();
  const roles   = Array.isArray(body.roles) ? body.roles : [];
  if (!appName) {
    sendJson(res, 400, { error: 'appName is required' });
    return;
  }
  // ── Write credentials to .env and build env vars for child process ──────
  const childEnv: Record<string, string> = { ...process.env as any };
  const envPath = path.join(process.cwd(), '.env');
  for (const role of roles) {
    const roleId   = String(role.roleId   ?? '').trim()
    const username = String(role.username ?? '').trim()
    const password = String(role.password ?? '').trim()
    if (!roleId || !username || !password) continue
    const envKey = `${appName}_${roleId}_CREDENTIALS`
      .toUpperCase()
      .replace(/-/g, '_')
    const envVal = `${username}:${password}`
    childEnv[envKey] = envVal
    try {
      const existing = fs.existsSync(envPath)
        ? fs.readFileSync(envPath, 'utf-8')
        : ''
      if (!existing.includes(envKey)) {
        fs.appendFileSync(envPath, `\n${envKey}=${envVal}`)
        onboardOutput.push(`[env] Written ${envKey} to .env`)
      }
    } catch (e: any) {
      onboardOutput.push(`[env] Warning: could not write to .env — ${e.message}`)
    }
  }
  // ── Auto-generate onboarding config if it does not exist ────────────────
  if (command === 'crawl' && appType && appName && baseUrl) {
    const configDir  = path.join(process.cwd(), 'src', 'apps', 'desktop',
      appType === 'rest-api' ? 'api' : 'ui', appName)
    const configFile = path.join(configDir, `onboarding.${appName}.config.ts`)
    if (!fs.existsSync(configFile)) {
      fs.mkdirSync(configDir, { recursive: true })
      const roleConfigs = roles.map((r: any) => {
        const roleId     = String(r.roleId     ?? '').trim()
        const envKey     = `${appName}_${roleId}_CREDENTIALS`
          .toUpperCase().replace(/-/g, '_')
        const loginUrl   = String(r.loginUrl   ?? '').trim()
        const successUrl = String(r.successUrl ?? '').trim()
        return `    {
      id:                '${roleId}',
      displayName:       '${roleId}',
      authFlow:          '${appType === 'rest-api' ? 'api-key' : 'form-login'}',
      credentialsEnvKey: '${envKey}',${loginUrl   ? `\n      loginUrl:          '${loginUrl}',`   : ''}${successUrl ? `\n      successUrl:        '${successUrl}',` : ''}
    }`
      }).join(',\n')
      const configContent = `import { OnboardingConfig } from '../../../../core/onboarding/types'
const config: OnboardingConfig = {
  app: {
    name:    '${appName}',
    baseUrl: '${baseUrl}',
    appType: '${appType}',
  },
  appType: '${appType}',
  roles: [
${roleConfigs}
  ],
  flows: [],
  budgets: {
    maxPages: 30,
    maxDepth: 3,
    aiCalls:  30,
  },
}
export default config
`
      try {
        fs.writeFileSync(configFile, configContent, 'utf-8')
        onboardOutput.push(`[config] Generated ${configFile}`)
      } catch (e: any) {
        onboardOutput.push(`[config] Warning: could not write config — ${e.message}`)
      }
    }
  }
  const subcommandMap: Record<string, string> = {
    crawl:    'crawl',
    verify:   'verify',
    generate: 'generate',
  };
  const subcommand = subcommandMap[command] ?? 'crawl';
  const cmd = `npx tsx src/core/onboarding/cli.ts ${subcommand} --app=${appName}`;
  onboardRunning = true;
  onboardOutput  = [];
  onboardStatus  = 'running';
  sendJson(res, 200, { ok: true });
  const child = spawn(cmd, {
    shell: true,
    cwd:   process.cwd(),
    env:   childEnv,
  });
  child.stdout.on('data', (d: Buffer) => {
    const lines = d.toString().split('\n').filter((l: string) => l.length > 0);
    onboardOutput.push(...lines);
  });
  child.stderr.on('data', (d: Buffer) => {
    const lines = d.toString().split('\n').filter((l: string) => l.length > 0);
    onboardOutput.push(...lines);
  });
  child.on('error', (err: Error) => {
    onboardOutput.push(`[error] ${err.message}`);
    onboardStatus  = 'error';
    onboardRunning = false;
  });
  child.on('close', (code: number | null) => {
    onboardOutput.push(`[done] exited with code ${code ?? 0}`);
    onboardStatus  = code === 0 ? 'done' : 'error';
    onboardRunning = false;
  });
}

function handleOnboardOutput(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const lines = [...onboardOutput];
  onboardOutput = [];
  sendJson(res, 200, { lines, status: onboardStatus });
}

async function handleOnboardReport(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const parsedUrl = new URL(req.url ?? '', `http://localhost`);
  const appName   = parsedUrl.searchParams.get('app') ?? '';
  if (!appName) {
    sendJson(res, 400, { error: 'app query param is required' });
    return;
  }
  const reportPath = path.join(
    process.cwd(),
    'models',
    appName,
    'verification-report.json'
  );
  try {
    const raw    = fs.readFileSync(reportPath, 'utf-8');
    const report = JSON.parse(raw);
    sendJson(res, 200, report);
  } catch {
    sendJson(res, 404, { error: `No verification report found for app: ${appName}` });
  }
}

// ── Run handler (streaming) ───────────────────────────────────
async function handleRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (isRunning) {
    sendJson(res, 409, { error: 'A run is already in progress.' });
    return;
  }

  const body = await readBody(req);
  const suite = String(body.suite ?? 'stable');
  if (!SUITES[suite]) {
    sendJson(res, 400, { error: `Unknown suite: ${suite}` });
    return;
  }
  const browsers: string[] = Array.isArray(body.browsers)
    ? body.browsers.map((b: unknown) => String(b))
    : [];
  const fullPipeline = Boolean(body.fullPipeline);

  isRunning = true;
  // Plain-text chunked stream — the client reads the body progressively.
  res.writeHead(200, {
    'Content-Type':      'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'Cache-Control':     'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  const def = SUITES[suite];
  const cmd = buildPlaywrightCmd(suite, browsers);

  res.write(`════════════════════════════════════════════════════════\n`);
  res.write(` FORGE — Run started ${new Date().toLocaleString()}\n`);
  res.write(` Suite: ${def.label}`);
  if (def.usesBrowsers) {
    const sel = browsers.filter((b) => VALID_BROWSERS.includes(b));
    res.write(`   Browsers: ${(sel.length ? sel : ['chromium']).join(', ')}`);
  }
  res.write(`   Full pipeline: ${fullPipeline ? 'yes' : 'no'}\n`);
  res.write(`════════════════════════════════════════════════════════\n`);

  try {
    // 1) Tests (failures are fine — we still triage/store).
    await streamCmd(cmd, res, 'tests');

    // 2) Triage — only when full pipeline is requested (per run.ts order).
    if (fullPipeline) {
      await streamCmd('npx tsx src/ai-triage.ts', res, 'triage');
    }

    // 3) Store results — ALWAYS (Run Tests tab auto-stores every run).
    await streamCmd('npx tsx src/results-store.ts', res, 'store');

    // 4) Release notes — only when full pipeline is requested.
    //    (no --open: this is a headless server context)
    if (fullPipeline) {
      await streamCmd('npx tsx src/release-notes.ts', res, 'release-notes');
    }

    res.write(`\n════════════════════════════════════════════════════════\n`);
    res.write(` Run complete. Results stored to reports/run-history.json\n`);
    res.write(`════════════════════════════════════════════════════════\n`);
  } catch (err: any) {
    res.write(`\n[platform] unexpected error: ${err?.message ?? err}\n`);
  } finally {
    isRunning = false;
    res.end();
  }
}

// ── Router ────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = (req.url ?? '/').split('?')[0];
  const method = req.method ?? 'GET';
  const qs     = req.url?.includes('?') ? req.url.split('?')[1] : '';

  console.log(`[${new Date().toLocaleTimeString()}] ${method} ${req.url}`);

  try {

  // Static assets
  if (method === 'GET' && url.startsWith('/assets/')) {
    const assetPath = path.join(process.cwd(), 'src', 'platform', url)
    if (fs.existsSync(assetPath)) {
      const ext  = path.extname(assetPath).toLowerCase()
      const mime = ext === '.png'  ? 'image/png'
                 : ext === '.jpg'  ? 'image/jpeg'
                 : ext === '.svg'  ? 'image/svg+xml'
                 : 'application/octet-stream'
      const data = fs.readFileSync(assetPath)
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' })
      res.end(data)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end(`Asset not found: ${url}`)
    }
    return
  }
  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    return serveStatic(res, 'platform.html', 'text/html; charset=utf-8');
  }
  if (method === 'GET' && url === '/platform.js') {
    return serveStatic(res, 'platform.js', 'text/javascript; charset=utf-8');
  }

  // API
  if (method === 'GET' && url === '/api/health') {
    return sendJson(res, 200, { ok: true, running: isRunning });
  }
  if (method === 'GET' && url === '/api/last-run') {
    return sendJson(res, 200, getLastRunSummary());
  }
  if (method === 'GET' && url === '/api/last-run-tests') {
    return sendJson(res, 200, getLastRunTests());
  }
  if (method === 'GET' && url.startsWith('/api/dashboard')) {
    const params = new URLSearchParams(qs);
    const depth = Math.min(50, Math.max(1, parseInt(params.get('depth') ?? '10', 10) || 10));
    return sendJson(res, 200, getDashboardData(depth));
  }
  if (method === 'POST' && url === '/api/generate/preview') {
    return handleGeneratePreview(req, res);
  }
  if (method === 'POST' && url === '/api/generate/save') {
    return handleGenerateSave(req, res);
  }
  if (method === 'POST' && url === '/api/generate/run') {
    return handleGenerateRun(req, res);
  }
  if (method === 'POST' && url === '/api/onboard/start') {
    return handleOnboardStart(req, res);
  }
  if (method === 'GET' && url === '/api/onboard/output') {
    return handleOnboardOutput(req, res);
  }
  if (method === 'GET' && url.startsWith('/api/onboard/report')) {
    return handleOnboardReport(req, res);
  }
  if (method === 'GET'  && url === '/api/review/apps')            { return handleReviewApps(req, res); }
  if (method === 'GET'  && url.startsWith('/api/review/tests'))   { return handleReviewTests(req, res); }
  if (method === 'GET'  && url.startsWith('/api/review/targets')) { return handleReviewTargets(req, res); }
  if (method === 'POST' && url === '/api/review/execute')         { return handleReviewExecute(req, res); }
  if (method === 'POST' && url === '/api/review/save')            { return handleReviewSave(req, res); }
  if (method === 'POST' && url === '/api/review/promote')         { return handleReviewPromote(req, res); }
  if (method === 'POST' && url === '/api/review/reject')          { return handleReviewReject(req, res); }
  if (method === 'POST' && url === '/api/review/promote-bulk')    { return handleReviewPromoteBulk(req, res); }
  if (method === 'POST' && url === '/api/run') {
    return handleRun(req, res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');

  } catch (err: any) {
    console.error('[platform-server] unhandled error:', err?.message ?? err, err?.stack ?? '');
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message ?? 'internal server error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │  FORGE · Autonomous Quality Engineering        │');
  console.log('  │  Phase 3.8.a  ·  Run Tests                     │');
  console.log(`  │  ▶  http://localhost:${PORT}                       │`);
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
  openBrowser(`http://localhost:${PORT}`);
});
