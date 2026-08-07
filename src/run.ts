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
 * run.ts — Test Orchestrator
 * ─────────────────────────────────────────────────────────────
 * Runs the full pipeline sequentially regardless of test failures:
 *   1. playwright test  (failures are OK — we want to triage them)
 *   2. ai-triage.ts     (always runs)
 *   3. results-store.ts (always runs)
 *
 * Usage:
 *   npx tsx src/run.ts           — run all tests
 *   npx tsx src/run.ts --smoke   — run smoke tests only
 * ─────────────────────────────────────────────────────────────
 */

import { execSync } from 'child_process';


// Prevent HTML report from auto-opening and blocking the pipeline
process.env['PLAYWRIGHT_HTML_OPEN'] = 'never';

const isSmoke  = process.argv.includes('--smoke');
const isFull   = process.argv.includes('--full');
const isStable = process.argv.includes('--stable');

const playwrightCmd = isSmoke
  ? 'npx playwright test loginFast.spec.ts e2e-journey.spec.ts'
  : isFull
  ? 'npx playwright test'
  : 'npx playwright test --grep-invert "@slow|@flaky"'; // default: stable only

function run(label: string, cmd: string): number {
  console.log(`\n▶  ${label}`);
  console.log(`   ${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    return 0;
  } catch (err: any) {
    // execSync throws on non-zero exit — that's fine for test failures
    return err.status ?? 1;
  }
}

// TD-070: establish ONE canonical run id at run-start; every child stage spawned
// below inherits it via env and CONSUMES it — no stage re-derives a key from a
// time source. Same shape as runs.run_id (timestamp-at-run-start), generated once.
const canonicalRunId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
process.env.CURRENT_RUN_ID = canonicalRunId;
console.log(`\n🔖 Canonical run id: ${canonicalRunId}`);

// Step 1 — Run tests (exit code ignored — failures are expected)
const testExit = run('Running Playwright tests...', playwrightCmd);

if (testExit === 0) {
  console.log('\n✅ All tests passed.');
} else {
  console.log(`\n⚠️  Tests completed with ${testExit !== 1 ? testExit + ' failures' : 'failures'} — continuing to triage...`);
}

// Step 2 — Always triage (even if tests failed)
run('Running AI Triage / RCA...', 'npx tsx src/pipeline/ai-triage.ts');

// Step 3 — Always store results
run('Storing results...', 'npx tsx src/pipeline/results-store.ts');

// Step 4 — Generate adaptive fix suggestions
run('Generating adaptive fixes...', 'npx tsx src/pipeline/adaptive-fixes.ts');

// Step 5 — Generate release notes
run('Generating release notes...', 'npx tsx src/pipeline/release-notes.ts');

// Step 6 — Send notifications
run('Sending notifications...', 'npx tsx src/pipeline/notifier.ts');

console.log('\n🏁 Pipeline complete.\n');
