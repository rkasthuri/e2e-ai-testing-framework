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
 * coverage-gap.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3.7 – Test Coverage Gap Analysis via Natural Language
 * FORGE — Autonomous Quality Engineering
 *
 * Reads all spec files, maps every test to a functional area, builds a
 * coverage matrix, and uses Claude AI to identify untested scenarios.
 *
 * Usage:
 *   npx tsx src/coverage-gap.ts                              ← full analysis
 *   npx tsx src/coverage-gap.ts --area=checkout              ← single area
 *   npx tsx src/coverage-gap.ts --query="what login scenarios are missing?"
 *   npx tsx src/coverage-gap.ts --next-id                    ← next test ID
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic   from '@anthropic-ai/sdk';
import * as fs     from 'fs';
import * as path   from 'path';
import * as dotenv from 'dotenv';
dotenv.config();
import { CoverageGapRepository } from '../core/storage/repositories/CoverageGapRepository'
import { getAppName, getBaseUrl } from '../core/config/appConfig'

// ── Types ─────────────────────────────────────────────────────────────────────

type FunctionalArea =
  | 'Login'
  | 'Inventory'
  | 'Cart'
  | 'Checkout'
  | 'API'
  | 'Edge Cases'
  | 'E2E Journey'
  | 'Performance'
  | 'Other';

interface TestEntry {
  id:        string;        // TC001, EC001, AB001 etc
  title:     string;
  file:      string;
  area:      FunctionalArea;
  priority:  string;        // P0, P1, P2 or ''
  tags:      string[];      // @slow @flaky etc
  line:      number;
}

interface CoverageArea {
  area:          FunctionalArea;
  tests:         TestEntry[];
  coveredScenarios: string[];
  gaps:          GapEntry[];
  coverageScore: number;    // 0–100
}

interface GapEntry {
  scenario:    string;
  priority:    'P0' | 'P1' | 'P2';
  suggestedId: string;
  reasoning:   string;
  codeHint:    string;
}

interface CoverageReport {
  generatedAt:   string;
  totalTests:    number;
  totalGaps:     number;
  overallScore:  number;
  areas:         CoverageArea[];
  topGaps:       GapEntry[];
  nextTestId:    string;
  nextEdgeId:    string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TESTS_DIR   = path.join('src', 'tests');
const REPORT_PATH = path.join('reports', 'coverage-gap-report.html');
const JSON_PATH   = path.join('reports', 'coverage-gaps.json');

const AREA_MAP: Record<string, FunctionalArea> = {
  'login.spec.ts':      'Login',
  'loginFast.spec.ts':  'Login',
  'inventory.spec.ts':  'Inventory',
  'cart.spec.ts':       'Cart',
  'checkout.spec.ts':   'Checkout',
  'e2e-journey.spec.ts':'E2E Journey',
  'edgeCases.spec.ts':  'Edge Cases',
  'debug.spec.ts':      'Other',
  'api.spec.ts':        'API',
};

// ── Test Parser ───────────────────────────────────────────────────────────────

function parseSpecFile(filePath: string): TestEntry[] {
  const content  = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const area     = AREA_MAP[fileName] ?? 'Other';
  const entries: TestEntry[] = [];

  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const testMatch = line.match(/test\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (!testMatch) return;

    const title    = testMatch[1];
    const idMatch  = title.match(/^(TC\d+|EC\d+|AB\d+)/i);
    const id       = idMatch ? idMatch[1].toUpperCase() : '';
    const prioMatch = title.match(/\b(P0|P1|P2)\b/);
    const priority  = prioMatch ? prioMatch[1] : '';
    const tags      = (title.match(/@\w+/g) ?? []);

    entries.push({ id, title, file: fileName, area, priority, tags, line: idx + 1 });
  });

  return entries;
}

function loadAllTests(): TestEntry[] {
  const files = fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.spec.ts'));
  return files.flatMap(f => parseSpecFile(path.join(TESTS_DIR, f)));
}

function getNextIds(tests: TestEntry[]): { nextTC: string; nextEC: string } {
  const tcNums = tests
    .filter(t => t.id.startsWith('TC'))
    .map(t => parseInt(t.id.replace('TC', '')))
    .filter(n => !isNaN(n));
  const ecNums = tests
    .filter(t => t.id.startsWith('EC'))
    .map(t => parseInt(t.id.replace('EC', '')))
    .filter(n => !isNaN(n));

  const maxTC = tcNums.length > 0 ? Math.max(...tcNums) : 38;
  const maxEC = ecNums.length > 0 ? Math.max(...ecNums) : 12;

  return {
    nextTC: `TC${String(maxTC + 1).padStart(3, '0')}`,
    nextEC: `EC${String(maxEC + 1).padStart(3, '0')}`,
  };
}

// ── Claude AI Analysis ────────────────────────────────────────────────────────

async function analyseArea(
  client:  Anthropic,
  area:    FunctionalArea,
  tests:   TestEntry[],
  idStart: number,
  ecStart: number,
): Promise<{ gaps: GapEntry[]; coveredScenarios: string[]; score: number }> {

  const testList = tests.map(t => `- ${t.id || '?'}: ${t.title}`).join('\n');

  const prompt = `You are a senior QA engineer analysing test coverage gaps for a web application.

Application: ${getAppName()} (${getBaseUrl()}) — an e-commerce demo app
Functional Area: ${area}
Target: Identify what's NOT tested

EXISTING TESTS IN THIS AREA (${tests.length} tests):
${testList || '(none)'}

CONTEXT:
- Login: use credentials from APP_USERNAME / APP_PASSWORD env vars
- Inventory: 6 products, sort by name/price, add/remove from cart, product detail pages
- Cart: add/remove items, quantities, continue shopping, proceed to checkout
- Checkout: 3-step flow (info → overview → complete), form validation, price calculation
- API endpoints: target URL from APP_BASE_URL env var
- Edge Cases: security, boundary, browser behavior, self-healing

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "coveredScenarios": ["what is already tested — be specific"],
  "gaps": [
    {
      "scenario": "specific untested scenario description",
      "priority": "P0|P1|P2",
      "reasoning": "why this matters",
      "codeHint": "brief hint for test implementation e.g. 'sort dropdown → price low-high → verify order'"
    }
  ],
  "coverageScore": 0-100
}

Priority guide:
  P0 — critical path not tested, would block release if broken
  P1 — important scenario missing, high business value
  P2 — nice-to-have, edge case or low-frequency path

List maximum 6 gaps. Be specific and actionable.`;

  try {
    const response = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw     = (response.content[0] as any).text.trim();
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    // Assign test IDs to gaps
    let tcCounter = idStart;
    let ecCounter = ecStart;

    const gaps: GapEntry[] = (parsed.gaps ?? []).map((g: any) => {
      const isEdge = area === 'Edge Cases';
      const suggestedId = isEdge
        ? `EC${String(ecCounter++).padStart(3, '0')}`
        : `TC${String(tcCounter++).padStart(3, '0')}`;
      return {
        scenario:    g.scenario    ?? '',
        priority:    g.priority    ?? 'P2',
        suggestedId,
        reasoning:   g.reasoning   ?? '',
        codeHint:    g.codeHint    ?? '',
      };
    });

    return {
      gaps,
      coveredScenarios: parsed.coveredScenarios ?? [],
      score:            parsed.coverageScore    ?? 50,
    };
  } catch (err) {
    console.error(`  ⚠️  Analysis error for ${area}: ${err}`);
    return { gaps: [], coveredScenarios: [], score: 0 };
  }
}

async function answerNLQuery(
  client: Anthropic,
  query:  string,
  report: CoverageReport,
): Promise<string> {
  const context = report.areas.map(a =>
    `${a.area} (score: ${a.coverageScore}/100, ${a.tests.length} tests, ${a.gaps.length} gaps):\n` +
    `  Gaps: ${a.gaps.map(g => g.scenario).join('; ')}`
  ).join('\n\n');

  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{
      role:    'user',
      content: `You are a QA coverage expert. Answer this question about test coverage:\n\nQuestion: ${query}\n\nCoverage Data:\n${context}\n\nGive a specific, helpful answer. Reference test IDs and scenarios where relevant.`,
    }],
  });

  return (response.content[0] as any).text.trim();
}

// ── HTML Report ───────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#84cc16';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function priorityColor(p: string): string {
  return { P0: '#dc2626', P1: '#f59e0b', P2: '#3b82f6' }[p] ?? '#6b7280';
}

function generateReport(report: CoverageReport): void {
  const timestamp = new Date().toLocaleString();

  const areaCardsHTML = report.areas.map(area => {
    const gapsHTML = area.gaps.length > 0
      ? area.gaps.map(g => `
        <div class="gap-item">
          <div class="gap-header">
            <span class="gap-id">${g.suggestedId}</span>
            <span class="priority-badge" style="background:${priorityColor(g.priority)}20;color:${priorityColor(g.priority)};border:1px solid ${priorityColor(g.priority)}40">${g.priority}</span>
            <span class="gap-scenario">${g.scenario}</span>
          </div>
          <div class="gap-details">
            <div class="gap-reasoning">💡 ${g.reasoning}</div>
            <div class="gap-hint">🔧 ${g.codeHint}</div>
          </div>
        </div>`).join('')
      : '<div class="no-gaps">✅ No significant gaps detected</div>';

    const coveredHTML = area.coveredScenarios.slice(0, 5).map(s =>
      `<li>${s}</li>`).join('');

    return `
    <div class="area-card" data-score="${area.coverageScore}">
      <div class="area-header">
        <div class="area-title-row">
          <h3 class="area-title">${area.area}</h3>
          <div class="area-score" style="color:${scoreColor(area.coverageScore)}">${area.coverageScore}<span class="score-label">/100</span></div>
        </div>
        <div class="score-bar-wrap">
          <div class="score-bar" style="width:${area.coverageScore}%;background:${scoreColor(area.coverageScore)}"></div>
        </div>
        <div class="area-meta">${area.tests.length} tests · ${area.gaps.length} gaps identified</div>
      </div>
      <div class="area-body">
        <div class="covered-section">
          <h4>✅ Currently Covered</h4>
          <ul class="covered-list">${coveredHTML}</ul>
        </div>
        <div class="gaps-section">
          <h4>⚠️ Coverage Gaps</h4>
          ${gapsHTML}
        </div>
      </div>
    </div>`;
  }).join('\n');

  const topGapsHTML = report.topGaps.slice(0, 8).map(g => `
    <tr>
      <td><span class="gap-id-sm">${g.suggestedId}</span></td>
      <td><span class="priority-badge-sm" style="background:${priorityColor(g.priority)}20;color:${priorityColor(g.priority)}">${g.priority}</span></td>
      <td>${g.scenario}</td>
      <td class="hint-col">${g.codeHint}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FORGE Coverage Gap Analysis</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@400;600;800&display=swap');
    :root {
      --bg:      #0d0f14;
      --surface: #13161d;
      --border:  #1e2330;
      --text:    #e2e8f0;
      --muted:   #64748b;
      --accent:  #38bdf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Syne', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

    .header {
      background: linear-gradient(135deg, #0d0f14, #111827, #0d0f14);
      border-bottom: 1px solid var(--border);
      padding: 2.5rem 2rem 2rem;
      position: relative; overflow: hidden;
    }
    .header::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(ellipse 60% 80% at 50% -20%, rgba(56,189,248,0.08), transparent 70%);
    }
    .header-inner { max-width: 1200px; margin: 0 auto; position: relative; }
    .logo { font-size: 0.7rem; font-family: 'JetBrains Mono', monospace; color: var(--accent); letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 0.4rem; }
    h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; }
    h1 span { color: var(--accent); }
    .header-meta { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--muted); margin-top: 0.5rem; }

    .stats { display: flex; gap: 1rem; margin-top: 1.8rem; flex-wrap: wrap; }
    .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.8rem 1.2rem; text-align: center; min-width: 100px; }
    .stat-number { font-size: 1.6rem; font-weight: 800; font-family: 'JetBrains Mono', monospace; line-height: 1; }
    .stat-label  { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; margin-top: 0.25rem; }

    .content { max-width: 1200px; margin: 2rem auto 4rem; padding: 0 2rem; }

    /* Top gaps table */
    .top-gaps { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 2rem; }
    .section-header { padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); }
    .section-title { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 0.6rem 1rem; text-align: left; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); background: #0d0f14; }
    td { padding: 0.75rem 1rem; border-top: 1px solid var(--border); font-size: 0.83rem; vertical-align: top; }
    .hint-col { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--muted); }
    .gap-id-sm { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--accent); }
    .priority-badge-sm { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; }

    /* Area cards */
    .areas { display: flex; flex-direction: column; gap: 1.5rem; }
    .area-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    .area-header { padding: 1.2rem 1.5rem 1rem; border-bottom: 1px solid var(--border); }
    .area-title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
    .area-title { font-size: 1rem; font-weight: 700; }
    .area-score { font-size: 1.8rem; font-weight: 800; font-family: 'JetBrains Mono', monospace; line-height: 1; }
    .score-label { font-size: 0.85rem; color: var(--muted); }
    .score-bar-wrap { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-bottom: 0.5rem; }
    .score-bar { height: 100%; border-radius: 2px; }
    .area-meta { font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: var(--muted); }

    .area-body { display: grid; grid-template-columns: 1fr 1fr; }
    .covered-section, .gaps-section { padding: 1.2rem 1.5rem; }
    .covered-section { border-right: 1px solid var(--border); }
    .covered-section h4, .gaps-section h4 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 0.8rem; }
    .covered-list { list-style: none; display: flex; flex-direction: column; gap: 0.3rem; }
    .covered-list li { font-size: 0.8rem; padding-left: 1rem; position: relative; line-height: 1.4; }
    .covered-list li::before { content: '✓'; position: absolute; left: 0; color: #22c55e; font-size: 0.7rem; }

    .gap-item { background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 8px; padding: 0.8rem; margin-bottom: 0.6rem; }
    .gap-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
    .gap-id { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--accent); font-weight: 700; }
    .priority-badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.68rem; font-weight: 700; }
    .gap-scenario { font-size: 0.82rem; font-weight: 600; flex: 1; }
    .gap-details { display: flex; flex-direction: column; gap: 0.25rem; }
    .gap-reasoning, .gap-hint { font-size: 0.78rem; color: var(--muted); line-height: 1.4; }
    .no-gaps { font-size: 0.82rem; color: #22c55e; padding: 0.5rem 0; }

    .page-footer { text-align: center; padding: 2rem; font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: var(--muted); border-top: 1px solid var(--border); }

    @media (max-width: 768px) {
      .area-body { grid-template-columns: 1fr; }
      .covered-section { border-right: none; border-bottom: 1px solid var(--border); }
    }
  </style>
</head>
<body>
<header class="header">
  <div class="header-inner">
    <div class="logo">FORGE — Phase 3.7</div>
    <h1>Coverage <span>Gap Analysis</span></h1>
    <div class="header-meta">Generated: ${timestamp} &nbsp;·&nbsp; ${report.totalTests} tests analysed &nbsp;·&nbsp; ${report.totalGaps} gaps identified</div>
    <div class="stats">
      <div class="stat">
        <div class="stat-number">${report.totalTests}</div>
        <div class="stat-label">Total Tests</div>
      </div>
      <div class="stat">
        <div class="stat-number" style="color:${scoreColor(report.overallScore)}">${report.overallScore}</div>
        <div class="stat-label">Overall Score</div>
      </div>
      <div class="stat">
        <div class="stat-number" style="color:#ef4444">${report.topGaps.filter(g => g.priority === 'P0').length}</div>
        <div class="stat-label">P0 Gaps</div>
      </div>
      <div class="stat">
        <div class="stat-number" style="color:#f59e0b">${report.topGaps.filter(g => g.priority === 'P1').length}</div>
        <div class="stat-label">P1 Gaps</div>
      </div>
      <div class="stat">
        <div class="stat-number" style="color:#38bdf8">${report.nextTestId}</div>
        <div class="stat-label">Next TC ID</div>
      </div>
    </div>
  </div>
</header>

<div class="content">
  <div class="top-gaps">
    <div class="section-header">
      <div class="section-title">🎯 Priority Gaps — Implement These First</div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:8%">ID</th>
          <th style="width:6%">Priority</th>
          <th style="width:40%">Missing Scenario</th>
          <th style="width:46%">Implementation Hint</th>
        </tr>
      </thead>
      <tbody>${topGapsHTML}</tbody>
    </table>
  </div>

  <div class="areas">${areaCardsHTML}</div>
</div>

<footer class="page-footer">
  FORGE — Autonomous Quality Engineering &nbsp;·&nbsp; Phase 3.7 Coverage Gap Analysis &nbsp;·&nbsp; Powered by Claude AI
</footer>
</body>
</html>`;

  fs.writeFileSync(REPORT_PATH, html, 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args      = process.argv.slice(2);
  const areaFilter = args.find(a => a.startsWith('--area='))?.split('=')[1];
  const nlQuery    = args.find(a => a.startsWith('--query='))?.split('=')[1];
  const nextIdOnly = args.includes('--next-id');

  console.log('═══════════════════════════════════════════════════');
  console.log('  FORGE Phase 3.7 — Coverage Gap Analysis');
  console.log('═══════════════════════════════════════════════════\n');

  const allTests = loadAllTests();
  const { nextTC, nextEC } = getNextIds(allTests);

  if (nextIdOnly) {
    console.log(`  Next TC ID: ${nextTC}`);
    console.log(`  Next EC ID: ${nextEC}`);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('❌ ANTHROPIC_API_KEY not set'); process.exit(1); }
  const client = new Anthropic({ apiKey });

  // Group tests by area
  const areaMap = new Map<FunctionalArea, TestEntry[]>();
  const allAreas: FunctionalArea[] = ['Login', 'Inventory', 'Cart', 'Checkout', 'API', 'Edge Cases', 'E2E Journey'];

  allAreas.forEach(area => areaMap.set(area, []));
  allTests.forEach(t => {
    const list = areaMap.get(t.area) ?? [];
    list.push(t);
    areaMap.set(t.area, list);
  });

  // Filter if --area flag provided
  const areasToAnalyse = areaFilter
    ? allAreas.filter(a => a.toLowerCase() === areaFilter.toLowerCase())
    : allAreas;

  if (areasToAnalyse.length === 0) {
    console.error(`❌ Unknown area "${areaFilter}". Valid: ${allAreas.join(', ')}`);
    process.exit(1);
  }

  console.log(`📂 Loaded ${allTests.length} tests across ${areaMap.size} areas`);
  console.log(`🔍 Analysing: ${areasToAnalyse.join(', ')}\n`);

  // Analyse each area
  const coverageAreas: CoverageArea[] = [];
  let tcCounter = parseInt(nextTC.replace('TC', ''));
  let ecCounter = parseInt(nextEC.replace('EC', ''));

  for (const area of areasToAnalyse) {
    const tests = areaMap.get(area) ?? [];
    process.stdout.write(`  🤖 Analysing ${area} (${tests.length} tests)...`);

    const { gaps, coveredScenarios, score } = await analyseArea(
      client, area, tests, tcCounter, ecCounter
    );

    // Advance counters
    const tcGaps = gaps.filter(g => g.suggestedId.startsWith('TC')).length;
    const ecGaps = gaps.filter(g => g.suggestedId.startsWith('EC')).length;
    tcCounter += tcGaps;
    ecCounter += ecGaps;

    coverageAreas.push({ area, tests, coveredScenarios, gaps, coverageScore: score });
    console.log(` Score: ${score}/100, Gaps: ${gaps.length}`);
  }

  // Build report
  const allGaps    = coverageAreas.flatMap(a => a.gaps);
  const topGaps    = allGaps
    .sort((a, b) => {
      const order = { P0: 0, P1: 1, P2: 2 };
      return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
    })
    .slice(0, 15);

  const overallScore = Math.round(
    coverageAreas.reduce((sum, a) => sum + a.coverageScore, 0) / coverageAreas.length
  );

  const report: CoverageReport = {
    generatedAt:  new Date().toISOString(),
    totalTests:   allTests.length,
    totalGaps:    allGaps.length,
    overallScore,
    areas:        coverageAreas,
    topGaps,
    nextTestId:   nextTC,
    nextEdgeId:   nextEC,
  };

  // Handle NL query mode
  if (nlQuery) {
    console.log(`\n🔍 Query: "${nlQuery}"\n`);
    const answer = await answerNLQuery(client, nlQuery, report);
    console.log('─────────────────────────────────────────────────');
    console.log(answer);
    console.log('─────────────────────────────────────────────────\n');
  // DB write — dual-write alongside JSON (Wave 2 will remove JSON write)
  try {
    const gapRepo = new CoverageGapRepository()
    await gapRepo.insertBatch(allGaps.map(gap => ({
      app_name:       getAppName(),
      gap_id:         gap.suggestedId,
      gap_type:       'test-case',
      description:    gap.scenario,
      priority:       gap.priority.toLowerCase(),
      suggested_spec: 'e2e-journey.spec.ts',
      status:         'open',
      identified_at:  new Date().toISOString(),
      closed_at:      null,
      closed_by_test: null,
    })))
  } catch (dbErr) {
    console.warn('[coverage-gap] DB write failed:', dbErr)
  }
    fs.writeFileSync(JSON_PATH, JSON.stringify(report, null, 2), 'utf8');
    return;
  }

  // Save outputs
  // DB write — dual-write alongside JSON (Wave 2 will remove JSON write)
  try {
    const gapRepo = new CoverageGapRepository()
    await gapRepo.insertBatch(allGaps.map(gap => ({
      app_name:       getAppName(),
      gap_id:         gap.suggestedId,
      gap_type:       'test-case',
      description:    gap.scenario,
      priority:       gap.priority.toLowerCase(),
      suggested_spec: 'e2e-journey.spec.ts',
      status:         'open',
      identified_at:  new Date().toISOString(),
      closed_at:      null,
      closed_by_test: null,
    })))
  } catch (dbErr) {
    console.warn('[coverage-gap] DB write failed:', dbErr)
  }
  fs.writeFileSync(JSON_PATH, JSON.stringify(report, null, 2), 'utf8');
  generateReport(report);

  // Terminal summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  COVERAGE GAP SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  coverageAreas.forEach(a => {
    const bar  = '█'.repeat(Math.round(a.coverageScore / 10)).padEnd(10, '░');
    const icon = a.coverageScore >= 80 ? '✅' : a.coverageScore >= 60 ? '🟡' : '🔴';
    console.log(`  ${icon} ${bar} ${String(a.coverageScore).padStart(3)}/100  ${a.area} (${a.gaps.length} gaps)`);
  });
  console.log(`\n  Overall Score: ${overallScore}/100`);
  console.log(`  Total Gaps:    ${allGaps.length}`);
  console.log(`  P0 Gaps:       ${allGaps.filter(g => g.priority === 'P0').length}`);
  console.log(`  Next Test ID:  ${nextTC}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Open report
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
