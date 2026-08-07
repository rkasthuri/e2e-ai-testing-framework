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
 * impact-analysis.ts
 * ─────────────────────────────────────────────────────────────
 * Step 4 — Impact Analysis / Intelligent Test Selection
 * Personal AI-Augmented Testing Framework
 *
 * What it does:
 *   - Reads git diff to find changed files since last commit
 *   - Maps changed files → affected test suites using static
 *     dependency map + Claude AI for ambiguous cases
 *   - Generates a targeted test run command
 *   - Updates run.ts to use targeted selection automatically
 *
 * Outputs:
 *   reports/impact-report.json  — structured impact data
 *   reports/impact-report.md    — human-readable summary
 *
 * Usage:
 *   npx tsx src/impact-analysis.ts              — diff vs HEAD~1
 *   npx tsx src/impact-analysis.ts --base main  — diff vs main branch
 *   npx tsx src/impact-analysis.ts --dry-run    — show without running
 * ─────────────────────────────────────────────────────────────
 */

import Anthropic       from '@anthropic-ai/sdk';
import { execSync }    from 'child_process';
import * as fs         from 'fs';
import * as dotenv     from 'dotenv';

dotenv.config();

// ── Types ────────────────────────────────────────────────────

interface ChangedFile {
  path:      string;
  changeType: 'modified' | 'added' | 'deleted' | 'renamed';
}

interface ImpactResult {
  changedFiles:      ChangedFile[];
  affectedSuites:    string[];
  skippedSuites:     string[];
  runCommand:        string;
  coveragePercent:   number;
  reasoning:         string;
  aiAssisted:        boolean;
  timestamp:         string;
}

// ── Dependency map — your exact framework structure ───────────
// Key: source file (page object, util, config)
// Value: test spec files that depend on it

const DEPENDENCY_MAP: Record<string, string[]> = {
  // Page objects → specs that import them
  'src/pages/LoginPage.ts': [
    'login.spec.ts',
    'loginFast.spec.ts',
    'cart.spec.ts',        // cart beforeEach logs in
    'checkout.spec.ts',    // checkout beforeEach logs in
    'inventory.spec.ts',   // inventory beforeEach logs in
    'e2e-journey.spec.ts',
    'edgeCases.spec.ts',
  ],
  'src/pages/InventoryPage.ts': [
    'inventory.spec.ts',
    'cart.spec.ts',        // cart beforeEach uses InventoryPage
    'checkout.spec.ts',    // checkout beforeEach uses InventoryPage
    'e2e-journey.spec.ts',
    'edgeCases.spec.ts',
  ],
  'src/pages/CartPage.ts': [
    'cart.spec.ts',
    'checkout.spec.ts',    // checkout beforeEach uses CartPage
    'e2e-journey.spec.ts',
    'edgeCases.spec.ts',
  ],
  'src/pages/CheckoutPage.ts': [
    'checkout.spec.ts',
    'e2e-journey.spec.ts',
    'edgeCases.spec.ts',
  ],

  // Utils → specs that use them
  'src/utils/testDataGenerator.ts': [
    'login.spec.ts',
    'edgeCases.spec.ts',
  ],

  // Config — changes here affect everything
  'playwright.config.ts': [
    'login.spec.ts',
    'loginFast.spec.ts',
    'inventory.spec.ts',
    'cart.spec.ts',
    'checkout.spec.ts',
    'e2e-journey.spec.ts',
    'edgeCases.spec.ts',
  ],
  'tsconfig.json': [
    'login.spec.ts',
    'loginFast.spec.ts',
    'inventory.spec.ts',
    'cart.spec.ts',
    'checkout.spec.ts',
    'e2e-journey.spec.ts',
    'edgeCases.spec.ts',
  ],
  'package.json': [
    'login.spec.ts',
    'loginFast.spec.ts',
    'inventory.spec.ts',
    'cart.spec.ts',
    'checkout.spec.ts',
    'e2e-journey.spec.ts',
    'edgeCases.spec.ts',
  ],
};

// All known stable test specs
const ALL_STABLE_SPECS = [
  'loginFast.spec.ts',
  'login.spec.ts',
  'inventory.spec.ts',
  'cart.spec.ts',
  'checkout.spec.ts',
  'e2e-journey.spec.ts',
  'edgeCases.spec.ts',
];

// Config ──────────────────────────────────────────────────────

const CONFIG = {
  baseBranch:   getArg('--base') ?? 'HEAD',
  outputJson:   'reports/impact-report.json',
  outputMd:     'reports/impact-report.md',
  model:        'claude-sonnet-4-5' as const,
  dryRun:       process.argv.includes('--dry-run'),
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Entry point ───────────────────────────────────────────────

async function main() {
  console.log('\n🎯 Impact Analysis — identifying affected tests...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set.\n');
    process.exit(1);
  }

  // Step 1 — Get changed files from git
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    console.log('✅ No changes detected — nothing to analyze.\n');
    console.log('   Tip: commit your changes first, then run impact analysis.\n');
    process.exit(0);
  }

  console.log(`📂 ${changedFiles.length} file(s) changed:\n`);
  for (const f of changedFiles) {
    const icon = f.changeType === 'added' ? '➕' :
                 f.changeType === 'deleted' ? '➖' :
                 f.changeType === 'renamed' ? '🔄' : '✏️';
    console.log(`   ${icon} ${f.path}`);
  }
  console.log('');

  // Step 2 — Static dependency map lookup
  const { affectedSuites, unknownFiles } = staticImpactLookup(changedFiles);

  // Step 3 — AI analysis for unknown/ambiguous files
  let aiAssisted = false;
  let aiReasoning = 'Determined via static dependency map.';

  if (unknownFiles.length > 0) {
    console.log(`🤖 ${unknownFiles.length} file(s) need AI analysis...\n`);
    const aiResult = await aiImpactAnalysis(unknownFiles, affectedSuites);
    aiResult.additionalSuites.forEach(s => affectedSuites.add(s));
    aiReasoning = aiResult.reasoning;
    aiAssisted  = true;
  }

  // Step 4 — Build results
  const affected = Array.from(affectedSuites).sort();
  const skipped  = ALL_STABLE_SPECS.filter(s => !affected.includes(s));

  // If ALL specs are affected, just run the full stable suite
  const runAll   = affected.length === ALL_STABLE_SPECS.length;
  const runCommand = buildRunCommand(affected, runAll);
  const coveragePct = runAll ? 100 :
    Math.round((affected.length / ALL_STABLE_SPECS.length) * 100);

  const result: ImpactResult = {
    changedFiles,
    affectedSuites: affected,
    skippedSuites:  skipped,
    runCommand,
    coveragePercent: coveragePct,
    reasoning: aiReasoning,
    aiAssisted,
    timestamp: new Date().toISOString(),
  };

  // Step 5 — Write reports
  fs.writeFileSync(CONFIG.outputJson, JSON.stringify(result, null, 2), 'utf-8');
  fs.writeFileSync(CONFIG.outputMd,   buildMarkdown(result),           'utf-8');

  printSummary(result);

  // Step 6 — Execute unless dry run
  if (!CONFIG.dryRun && affected.length > 0) {
    console.log('▶  Running targeted tests...\n');
    console.log(`   ${runCommand}\n`);
    try {
      execSync(runCommand, { stdio: 'inherit' });
    } catch {
      // Test failures are OK — pipeline continues
    }
  } else if (CONFIG.dryRun) {
    console.log('ℹ️  Dry run — tests not executed.\n');
    console.log(`   Would run: ${runCommand}\n`);
  }
}

// ── Get changed files from git diff ──────────────────────────

function getChangedFiles(): ChangedFile[] {
  try {
    const output = execSync(
      `git diff --name-status ${CONFIG.baseBranch}`,
      { encoding: 'utf-8' }
    ).trim();

    if (!output) return [];

    return output.split('\n').map(line => {
      const parts = line.trim().split(/\s+/);
      const status = parts[0];
      const path   = parts[parts.length - 1]; // handles renames

      const changeType: ChangedFile['changeType'] =
        status.startsWith('A') ? 'added'    :
        status.startsWith('D') ? 'deleted'  :
        status.startsWith('R') ? 'renamed'  : 'modified';

      return { path, changeType };
    }).filter(f => f.path);

  } catch (err) {
    console.warn('  ⚠️  git diff failed — are you in a git repo?');
    console.warn(`  ${err}`);
    return [];
  }
}

// ── Static lookup ─────────────────────────────────────────────

function staticImpactLookup(files: ChangedFile[]): {
  affectedSuites: Set<string>;
  unknownFiles:   ChangedFile[];
} {
  const affectedSuites = new Set<string>();
  const unknownFiles:   ChangedFile[] = [];

  for (const file of files) {
    const { path } = file;

    // Direct spec file change — always include itself
    if (path.endsWith('.spec.ts')) {
      const specName = path.split('/').pop()!;
      if (ALL_STABLE_SPECS.includes(specName)) {
        affectedSuites.add(specName);
      }
      continue;
    }

    // Framework AI files — don't affect test specs
    if (
      path.startsWith('src/ai-triage') ||
      path.startsWith('src/results-store') ||
      path.startsWith('src/adaptive-fixes') ||
      path.startsWith('src/run') ||
      path.startsWith('src/impact-analysis') ||
      path.startsWith('reports/')
    ) {
      continue;
    }

    // Known dependency map lookup
    const mapped = DEPENDENCY_MAP[path];
    if (mapped !== undefined) {
      mapped.forEach(s => affectedSuites.add(s));
      continue;
    }

    // Unknown file — needs AI
    unknownFiles.push(file);
  }

  return { affectedSuites, unknownFiles };
}

// ── AI analysis for unknown files ─────────────────────────────

async function aiImpactAnalysis(
  unknownFiles: ChangedFile[],
  alreadyAffected: Set<string>
): Promise<{ additionalSuites: string[]; reasoning: string }> {

  const prompt = `You are a QA automation expert analyzing test impact for a Playwright framework.

Known test specs (stable suite):
${ALL_STABLE_SPECS.map(s => `  - ${s}`).join('\n')}

Already affected by static analysis:
${Array.from(alreadyAffected).map(s => `  - ${s}`).join('\n') || '  (none yet)'}

These files were changed but are NOT in the dependency map:
${unknownFiles.map(f => `  - [${f.changeType}] ${f.path}`).join('\n')}

Based on the file paths and names, which additional test specs might be affected?
Consider: utility files, helper functions, configuration, test data files.

Respond ONLY in this JSON format:
{
  "additionalSuites": ["spec1.spec.ts", "spec2.spec.ts"],
  "reasoning": "2-3 sentence explanation of why these specs are affected."
}

If no additional specs are affected, return empty array for additionalSuites.`;

  try {
    const message = await client.messages.create({
      model:      CONFIG.model,
      max_tokens: 256,
      messages:   [{ role: 'user', content: prompt }],
    });

    const content = message.content[0].type === 'text' ? message.content[0].text : '';
    const clean   = content.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(clean);

    return {
      additionalSuites: parsed.additionalSuites ?? [],
      reasoning:        parsed.reasoning        ?? 'AI analysis completed.',
    };

  } catch (err) {
    console.warn(`  ⚠️  AI analysis failed: ${err}`);
    return { additionalSuites: [], reasoning: 'AI analysis failed — used static map only.' };
  }
}

// ── Build playwright run command ──────────────────────────────

function buildRunCommand(specs: string[], runAll: boolean): string {
  if (runAll) {
    return 'npx playwright test --grep-invert "@slow|@flaky"';
  }
  return `npx playwright test ${specs.join(' ')}`;
}

// ── Markdown report ───────────────────────────────────────────

function buildMarkdown(result: ImpactResult): string {
  const saved = 100 - result.coveragePercent;
  const lines = [
    '# Impact Analysis Report',
    '',
    `**Generated:** ${new Date(result.timestamp).toLocaleString()}  `,
    `**Base:** \`${CONFIG.baseBranch}\`  `,
    `**AI Assisted:** ${result.aiAssisted ? 'Yes' : 'No (static map only)'}`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Files changed | ${result.changedFiles.length} |`,
    `| Suites to run | ${result.affectedSuites.length} of ${ALL_STABLE_SPECS.length} |`,
    `| Suites skipped | ${result.skippedSuites.length} |`,
    `| Test coverage | ${result.coveragePercent}% of stable suite |`,
    `| Time saved | ~${saved}% faster than full run |`,
    '',
    '## Changed Files',
    '',
    ...result.changedFiles.map(f => `- \`[${f.changeType}]\` \`${f.path}\``),
    '',
    '## Suites to Run ✅',
    '',
    ...result.affectedSuites.map(s => `- \`${s}\``),
    '',
    '## Suites Skipped ⏭️',
    '',
    ...(result.skippedSuites.length
      ? result.skippedSuites.map(s => `- \`${s}\``)
      : ['- *(none — full suite required)*']),
    '',
    '## Run Command',
    '',
    '```cmd',
    result.runCommand,
    '```',
    '',
    '## Reasoning',
    '',
    result.reasoning,
  ];

  return lines.join('\n');
}

// ── Console summary ───────────────────────────────────────────

function printSummary(result: ImpactResult) {
  const saved = 100 - result.coveragePercent;
  console.log('\n──────────────────────────────────────');
  console.log('  IMPACT ANALYSIS COMPLETE');
  console.log('──────────────────────────────────────');
  console.log(`  📂 Changed:  ${result.changedFiles.length} file(s)`);
  console.log(`  ✅ Running:  ${result.affectedSuites.length}/${ALL_STABLE_SPECS.length} suites`);
  console.log(`  ⏭️  Skipped:  ${result.skippedSuites.length} suites`);
  console.log(`  ⚡ Saving:   ~${saved}% of test time`);
  console.log('──────────────────────────────────────');
  if (result.affectedSuites.length) {
    console.log('  Suites to run:');
    result.affectedSuites.forEach(s => console.log(`    • ${s}`));
  }
  console.log('──────────────────────────────────────');
  console.log(`  📄 ${CONFIG.outputJson}`);
  console.log(`  📝 ${CONFIG.outputMd}`);
  console.log('──────────────────────────────────────\n');
}

// ── Helpers ───────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
