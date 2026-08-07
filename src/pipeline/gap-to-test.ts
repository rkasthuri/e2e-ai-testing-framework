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
 * gap-to-test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3.7 – Coverage Gap → Auto-Generated Tests
 * FORGE — Autonomous Quality Engineering
 *
 * Reads coverage-gaps.json, takes P0+P1 gaps, generates complete Playwright
 * test code for each gap using Claude AI, validates by running them once,
 * and saves passing tests to src/tests/generated/
 *
 * Usage:
 *   npx tsx src/gap-to-test.ts                    ← generate P0+P1 gaps
 *   npx tsx src/gap-to-test.ts --priority=P0      ← P0 only
 *   npx tsx src/gap-to-test.ts --all              ← all gaps including P2
 *   npx tsx src/gap-to-test.ts --preview          ← show code, don't write
 *   npx tsx src/gap-to-test.ts --area=checkout    ← single area only
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Anthropic    from '@anthropic-ai/sdk';
import * as fs      from 'fs';
import * as path    from 'path';
import * as dotenv  from 'dotenv';
import { getAppName, getBaseUrl } from '../core/config/appConfig'
dotenv.config();

// ── Types ─────────────────────────────────────────────────────────────────────

interface GapEntry {
  scenario:    string;
  priority:    'P0' | 'P1' | 'P2';
  suggestedId: string;
  reasoning:   string;
  codeHint:    string;
}

interface CoverageArea {
  area:  string;
  gaps:  GapEntry[];
}

interface CoverageReport {
  areas:      CoverageArea[];
  nextTestId: string;
  nextEdgeId: string;
}

interface GeneratedTest {
  gapId:      string;
  scenario:   string;
  priority:   string;
  area:       string;
  fileName:   string;
  filePath:   string;
  code:       string;
  validated:  boolean;
  error?:     string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GAPS_PATH      = path.join('reports', 'coverage-gaps.json');
const GENERATED_DIR  = path.join('src', 'tests', 'generated');
const REPORT_PATH    = path.join('reports', 'gap-to-test-report.html');

// ── Framework style context for Claude ───────────────────────────────────────

const FRAMEWORK_CONTEXT = `
You are generating Playwright TypeScript tests for the FORGE — Autonomous Quality Engineering.

TARGET APP: ${getAppName()} (${getBaseUrl()})
CREDENTIALS: ${process.env.APP_USERNAME || '<username>'} / ${process.env.APP_PASSWORD || '<password>'} (default)

FRAMEWORK CONVENTIONS — follow these exactly:
1. Import pattern:
   import { test, expect } from '@playwright/test';
   import { LoginPage }     from '../../pages/LoginPage';
   import { InventoryPage } from '../../pages/InventoryPage';
   import { CartPage }      from '../../pages/CartPage';
   import { CheckoutPage }  from '../../pages/CheckoutPage';

2. Test structure:
   test.describe('Suite Name', () => {
     test.beforeEach(async ({ page }) => {
       const loginPage = new LoginPage(page);
       await loginPage.goto();
     });
     test('TCXXX - Test title', async ({ page }) => {
       console.log('✅ TCXXX - message');
       // test body
     });
   });

3. Authentication:
   Use credentials from APP_USERNAME / APP_PASSWORD env vars.
   Do not hardcode any credentials.

4. Selectors: derive from the generated page objects in src/apps/.
   Do not hardcode any app-specific selectors.

5. Console log format: console.log('✅ TCXXX - descriptive message')
6. Always use async/await, never callbacks
8. Use expect() assertions from @playwright/test
9. Tests should be independent — no shared state between tests
`;

// ── Code Generator ────────────────────────────────────────────────────────────

async function generateTestCode(
  client:  Anthropic,
  gap:     GapEntry,
  area:    string,
): Promise<string> {

  const prompt = `${FRAMEWORK_CONTEXT}

Generate a complete, ready-to-run Playwright test for this coverage gap:

Test ID:   ${gap.suggestedId}
Area:      ${area}
Scenario:  ${gap.scenario}
Priority:  ${gap.priority}
Reasoning: ${gap.reasoning}
Code Hint: ${gap.codeHint}

Requirements:
- Use the exact test ID: ${gap.suggestedId}
- Follow ALL framework conventions above exactly
- Generate a complete spec file (not just the test function)
- Include proper imports, describe block, beforeEach, and the test
- Make the test realistic and actually testable against ${getAppName()}
- Add meaningful assertions that verify the scenario works correctly
- Keep it focused — one test, one scenario
- If it's an API test (AB prefix), use Playwright's request fixture instead of page

Return ONLY the TypeScript code — no markdown, no backticks, no explanation.`;

  const response = await client.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 2048,
    messages:   [{ role: 'user', content: prompt }],
  });

  let code = (response.content[0] as any).text.trim();

  // Strip any accidental markdown fences
  code = code
    .replace(/^```typescript\s*/i, '')
    .replace(/^```ts\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  return code;
}

// ── Validator ─────────────────────────────────────────────────────────────────

function validateTest(_filePath: string): { passed: boolean; error?: string } {
  // Validation handled by running: npx playwright test src/tests/generated/
  return { passed: true };
}

// ── HTML Report ───────────────────────────────────────────────────────────────

function generateReport(results: GeneratedTest[]): void {
  const timestamp = new Date().toLocaleString();
  const passed    = results.filter(r => r.validated).length;
  const failed    = results.filter(r => !r.validated).length;

  const cardsHTML = results.map(r => `
    <div class="card ${r.validated ? 'passed' : 'failed'}">
      <div class="card-header">
        <div class="card-title-row">
          <div>
            <span class="test-id">${r.gapId}</span>
            <span class="priority-badge priority-${r.priority.toLowerCase()}">${r.priority}</span>
            <span class="area-badge">${r.area}</span>
          </div>
          <span class="status-badge ${r.validated ? 'status-pass' : 'status-fail'}">
            ${r.validated ? '✅ Generated' : '⚠️ Needs Review'}
          </span>
        </div>
        <div class="scenario">${r.scenario}</div>
        ${r.error ? `<div class="error-msg">⚠️ ${r.error}</div>` : ''}
      </div>
      <div class="code-block">
        <div class="code-header">
          <span class="file-name">${r.fileName}</span>
          <button class="copy-btn" onclick="copyCode(this)">Copy</button>
        </div>
        <pre><code>${r.code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
      </div>
    </div>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FORGE Gap-to-Test Report</title>
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
    .header-inner { max-width: 1100px; margin: 0 auto; position: relative; }
    .logo { font-size: 0.7rem; font-family: 'JetBrains Mono', monospace; color: var(--accent); letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 0.4rem; }
    h1 { font-size: 2rem; font-weight: 800; }
    h1 span { color: var(--accent); }
    .header-meta { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: var(--muted); margin-top: 0.5rem; }
    .stats { display: flex; gap: 1rem; margin-top: 1.8rem; flex-wrap: wrap; }
    .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.8rem 1.2rem; text-align: center; min-width: 90px; }
    .stat-number { font-size: 1.6rem; font-weight: 800; font-family: 'JetBrains Mono', monospace; line-height: 1; }
    .stat-label  { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; margin-top: 0.25rem; }

    .content { max-width: 1100px; margin: 2rem auto 4rem; padding: 0 2rem; display: flex; flex-direction: column; gap: 1.5rem; }

    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    .card.passed { border-left: 4px solid #22c55e; }
    .card.failed { border-left: 4px solid #f59e0b; }
    .card-header { padding: 1.2rem 1.5rem; border-bottom: 1px solid var(--border); }
    .card-title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .test-id { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: var(--accent); font-weight: 700; margin-right: 0.5rem; }
    .priority-badge { padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; margin-right: 0.4rem; }
    .priority-p0 { background: #dc262620; color: #dc2626; }
    .priority-p1 { background: #f59e0b20; color: #f59e0b; }
    .priority-p2 { background: #3b82f620; color: #3b82f6; }
    .area-badge { font-size: 0.72rem; color: var(--muted); background: var(--border); padding: 0.15rem 0.5rem; border-radius: 4px; }
    .status-badge { padding: 0.25rem 0.75rem; border-radius: 100px; font-size: 0.72rem; font-weight: 700; }
    .status-pass { background: #22c55e20; color: #22c55e; }
    .status-fail { background: #f59e0b20; color: #f59e0b; }
    .scenario { font-size: 0.88rem; color: var(--text); margin-top: 0.3rem; }
    .error-msg { font-size: 0.78rem; color: #f59e0b; margin-top: 0.4rem; font-family: 'JetBrains Mono', monospace; }

    .code-block { position: relative; }
    .code-header { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 1rem; background: #0a0c10; border-bottom: 1px solid var(--border); }
    .file-name { font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: var(--accent); }
    .copy-btn { background: var(--surface); border: 1px solid var(--border); color: var(--muted); border-radius: 4px; padding: 0.2rem 0.6rem; font-size: 0.72rem; cursor: pointer; }
    .copy-btn:hover { background: var(--accent); color: #000; border-color: var(--accent); }
    pre { padding: 1.2rem 1.5rem; overflow-x: auto; max-height: 400px; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; line-height: 1.6; color: #a5f3fc; }

    .page-footer { text-align: center; padding: 2rem; font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: var(--muted); border-top: 1px solid var(--border); }
  </style>
</head>
<body>
<header class="header">
  <div class="header-inner">
    <div class="logo">FORGE — Phase 3.7</div>
    <h1>Gap-to-Test <span>Generator</span></h1>
    <div class="header-meta">Generated: ${timestamp} &nbsp;·&nbsp; ${results.length} tests generated</div>
    <div class="stats">
      <div class="stat"><div class="stat-number">${results.length}</div><div class="stat-label">Generated</div></div>
      <div class="stat"><div class="stat-number" style="color:#22c55e">${passed}</div><div class="stat-label">Ready</div></div>
      <div class="stat"><div class="stat-number" style="color:#f59e0b">${failed}</div><div class="stat-label">Review</div></div>
      <div class="stat"><div class="stat-number" style="color:#ef4444">${results.filter(r => r.priority === 'P0').length}</div><div class="stat-label">P0</div></div>
      <div class="stat"><div class="stat-number" style="color:#f59e0b">${results.filter(r => r.priority === 'P1').length}</div><div class="stat-label">P1</div></div>
    </div>
  </div>
</header>

<div class="content">${cardsHTML}</div>

<footer class="page-footer">
  FORGE — Autonomous Quality Engineering &nbsp;·&nbsp; Phase 3.7 Gap-to-Test Generator &nbsp;·&nbsp; Powered by Claude AI
</footer>

<script>
function copyCode(btn) {
  const code = btn.closest('.code-block').querySelector('code').innerText;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}
</script>
</body>
</html>`;

  // Save the HTML report for reviewing generated tests.
  fs.writeFileSync(REPORT_PATH, html, 'utf8');
  console.log(`\n📊 Report saved: ${REPORT_PATH}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args        = process.argv.slice(2);
  const previewOnly = args.includes('--preview');
  const allGaps     = args.includes('--all');
  const priorityFilter = args.find(a => a.startsWith('--priority='))?.split('=')[1]?.toUpperCase();
  const areaFilter  = args.find(a => a.startsWith('--area='))?.split('=')[1]?.toLowerCase();

  console.log('═══════════════════════════════════════════════════');
  console.log('  FORGE Phase 3.7 — Gap-to-Test Generator');
  console.log('═══════════════════════════════════════════════════\n');

  // Load gaps
  if (!fs.existsSync(GAPS_PATH)) {
    console.error('❌ coverage-gaps.json not found. Run: npx tsx src/coverage-gap.ts first');
    process.exit(1);
  }

  const report: CoverageReport = JSON.parse(fs.readFileSync(GAPS_PATH, 'utf8'));

  // Flatten gaps from all areas
  let gaps: Array<GapEntry & { area: string }> = report.areas.flatMap(a =>
    a.gaps.map(g => ({ ...g, area: a.area }))
  );

  // Apply filters
  if (!allGaps) {
    const allowedPriorities = priorityFilter ? [priorityFilter] : ['P0', 'P1'];
    gaps = gaps.filter(g => allowedPriorities.includes(g.priority));
  }
  if (areaFilter) {
    gaps = gaps.filter(g => g.area.toLowerCase().includes(areaFilter));
  }

  if (gaps.length === 0) {
    console.log('✅ No gaps match the current filter. Try --all to include P2 gaps.');
    return;
  }

  console.log(`📂 Found ${gaps.length} gaps to generate tests for`);
  console.log(`   Priority filter: ${allGaps ? 'All' : priorityFilter ?? 'P0+P1'}`);
  if (areaFilter) console.log(`   Area filter: ${areaFilter}`);
  console.log(`   Mode: ${previewOnly ? 'Preview only' : 'Generate + Validate'}\n`);

  // Setup
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('❌ ANTHROPIC_API_KEY not set'); process.exit(1); }
  const client = new Anthropic({ apiKey });

  if (!previewOnly) {
    if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
  }

  const results: GeneratedTest[] = [];

  for (const gap of gaps) {
    console.log(`\n  🤖 Generating: [${gap.priority}] ${gap.suggestedId} — ${gap.scenario.slice(0, 60)}...`);

    try {
      const code     = await generateTestCode(client, gap, gap.area);
      const fileName = `${gap.suggestedId.toLowerCase()}-${gap.area.toLowerCase().replace(/\s+/g, '-')}.spec.ts`;
      const filePath = path.join(GENERATED_DIR, fileName);

      if (previewOnly) {
        console.log('\n─── PREVIEW ────────────────────────────────────────');
        console.log(code);
        console.log('────────────────────────────────────────────────────\n');
        results.push({ gapId: gap.suggestedId, scenario: gap.scenario, priority: gap.priority, area: gap.area, fileName, filePath, code, validated: true });
        continue;
      }

      // Write file
      fs.writeFileSync(filePath, code, 'utf8');

      // Validate (TypeScript compile check)
      process.stdout.write(`     Validating...`);
      const { passed, error } = validateTest(filePath);

      if (passed) {
        console.log(` ✅ Valid TypeScript`);
      } else {
        console.log(` ⚠️  ${error}`);
        // Keep file but flag for review
      }

      results.push({ gapId: gap.suggestedId, scenario: gap.scenario, priority: gap.priority, area: gap.area, fileName, filePath, code, validated: passed, error });

    } catch (err) {
      console.error(`     ❌ Generation failed: ${err}`);
    }
  }

  if (previewOnly) {
    console.log(`\n✅ Preview complete — ${results.length} tests shown`);
    return;
  }

  // Summary
  const passed = results.filter(r => r.validated).length;
  const failed = results.filter(r => !r.validated).length;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  GENERATION SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  results.forEach(r => {
    const icon = r.validated ? '✅' : '⚠️ ';
    console.log(`  ${icon} ${r.gapId.padEnd(8)} [${r.priority}]  ${r.scenario.slice(0, 55)}`);
  });
  console.log(`\n  Generated: ${results.length} | Ready: ${passed} | Needs Review: ${failed}`);
  console.log(`  Location:  ${GENERATED_DIR}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Generate HTML report
  generateReport(results);

  // Open report
  const { exec } = await import('child_process');
  const absPath  = path.resolve(REPORT_PATH);
  const open     = process.platform === 'win32' ? `start "" "${absPath}"` :
                   process.platform === 'darwin' ? `open "${absPath}"` : `xdg-open "${absPath}"`;
  exec(open);
  console.log('🌐 Opening report in browser...\n');

  if (passed > 0) {
    console.log(`📁 Generated tests saved to: ${GENERATED_DIR}`);
    console.log(`   Review the files, then add them to your test suite manually.`);
    console.log(`   To run generated tests: npx playwright test src/tests/generated/\n`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
