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
 * TD-085 — generation eval harness.
 *
 * Measures the BEHAVIORAL PASS RATE of the generator: it executes every SauceDemo
 * generated spec through Playwright and scores one EvalRecord per spec file (pass =
 * the spec's Playwright run exited 0). This is the generation capability's canonical
 * metric — "do the specs the generator emits actually pass when run against the live
 * app?" — emitted through the same shared contract (evals/contract.ts) as triage.
 *
 * Run: npm run eval:generation   (or: npx tsx evals/generation/harness.ts)
 *
 * Cost: ZERO Claude API cost — pure Playwright execution of already-generated specs.
 * The only latent AI path is SmartLocator's Vision escalation on a broken selector;
 * this harness sets HEALING_DISABLED=true so that path is closed and the run is both
 * deterministic and provably free (see TD-085 Commit 4 pre-audit).
 *
 * Isolation / collisions: each spec is run BY FILE PATH (not `-g <id>`). The TC-GEN
 * id namespace restarts per app (orangehrm and saucedemo both emit TC-GEN-001), so a
 * bare `-g` grep would collide across apps; a file path filters to that file only.
 *
 * On-demand only: needs a live browser + https://www.saucedemo.com — NOT part of the
 * fast CI unit gate (scripts/*.test.ts).
 */
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { EvalRecord } from '../contract';
import { runEval, generateRunId } from '../runner';
import { printSummary, printFailures, saveReport } from '../reporter';

const REPO = path.resolve(__dirname, '../..');
// Forward-slash relative path so the Playwright CLI arg is cross-platform (Windows
// accepts it) and matches input.specFile in each record.
const SPECS_REL = 'src/apps/desktop/ui/saucedemo/generated/specs';
const SPECS_DIR = path.join(REPO, SPECS_REL);

// FC representatives proved live during the FC-004a fixes — annotated so the record
// makes clear which honesty-downgrade class each spec exercises. Matched by filename
// prefix; specs with no entry (e.g. login-to-inventory) get an undefined note.
const FC_NOTES: Record<string, string> = {
  'browse-and-cart':            'FC-004a Stage 1 — browse + add-to-cart landing (asserts non-error URL; unverified interactions omitted)',
  'complete-purchase-flow':     'FC-004a Stage 2+3 — full checkout flow (prerequisite-unverified; clicks/URL omitted with reason)',
  'inferred-flow-standardUser': 'FC-004a Stage 2 — inferred builder path (TD-081; interactions never observed, assertions omitted)',
  'direct-checkout':            'FC-004a Stage 1 — direct checkout entry (prerequisite-unverified)',
};
function fcNote(file: string): string | undefined {
  for (const prefix of Object.keys(FC_NOTES)) if (file.startsWith(prefix)) return FC_NOTES[prefix];
  return undefined;
}

function main(): void {
  if (!fs.existsSync(SPECS_DIR)) {
    console.error(`Missing generated specs dir: ${SPECS_DIR}`);
    process.exit(1);
  }
  const specFiles = fs.readdirSync(SPECS_DIR).filter(f => f.endsWith('.spec.ts')).sort();
  if (specFiles.length === 0) {
    console.error(`No generated specs found in ${SPECS_DIR}`);
    process.exit(1);
  }
  console.log(`Generation eval — executing ${specFiles.length} SauceDemo generated specs via Playwright.`);
  console.log('(HEALING_DISABLED=true -> zero AI cost; one Playwright run per spec file.)\n');

  const records: EvalRecord[] = [];
  for (const file of specFiles) {
    const specRel = `${SPECS_REL}/${file}`;
    process.stdout.write(`  running ${file} ... `);

    let pass: boolean;
    let exitCode: number;
    let stderrSnippet = '';
    try {
      execSync(`npx playwright test ${specRel} --project=generated`, {
        cwd: REPO,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
        // Close the Vision-heal escalation so the run is deterministic + free.
        env: { ...process.env, HEALING_DISABLED: 'true' },
      });
      pass = true;
      exitCode = 0;
    } catch (e) {
      // execSync throws on non-zero exit; encoding:'utf8' makes stdout/stderr strings.
      const err = e as { status?: number; stdout?: string; stderr?: string };
      pass = false;
      exitCode = err.status ?? -1;
      stderrSnippet = ((err.stderr || '') + (err.stdout || '')).replace(/\s+/g, ' ').trim().slice(-500);
    }
    console.log(pass ? 'PASS' : `FAIL (exit ${exitCode})`);

    records.push({
      capability: 'generation',
      id: file,
      input: { specFile: specRel },
      expected: { outcome: 'pass' },
      actual: { outcome: pass ? 'pass' : 'fail', exitCode, stderr: stderrSnippet || undefined },
      pass,
      metrics: { primaryScore: pass ? 1 : 0 },
      timestamp: new Date().toISOString(),
      notes: fcNote(file),
    });
  }

  const summary = runEval(records);
  printSummary(summary);
  printFailures(records);
  saveReport(summary, path.join(REPO, 'evals', 'generation', 'report.json'));
  console.log(`\nGeneration eval complete. Run id: ${generateRunId()}`);
}

main();
