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
 * adaptive-fixes.ts
 * ─────────────────────────────────────────────────────────────
 * Step 3 — Adaptive Retry Suggestions
 * Personal AI-Augmented Testing Framework
 *
 * Reads:   reports/triage-report.json   (Step 1 RCA output)
 *          src/tests/<failing>.spec.ts  (actual test source)
 * Writes:  reports/suggested-fixes.md  (human-readable fixes)
 *          reports/suggested-fixes.json (structured, for Step 6)
 *
 * Auto-applies SAFE fixes (timeout/slow tweaks) to a git branch.
 * Flags COMPLEX fixes (logic changes) for human review.
 *
 * Run:  npx tsx src/adaptive-fixes.ts
 *       npx tsx src/adaptive-fixes.ts --dry-run   (no file changes)
 * ─────────────────────────────────────────────────────────────
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { AiTriageRepository } from '../core/storage/repositories/AiTriageRepository'
import { aiCall }             from '../core/ai/AiClient'
import { getAppName, getBaseUrl } from '../core/config/appConfig'
import { TriageCategory, TRIAGE_CATEGORIES, ALL_TRIAGE_CATEGORIES, TRIAGE_DISPLAY } from '../core/triage/taxonomy'

dotenv.config();

// ── Types ────────────────────────────────────────────────────

type RCAVerdict  = TriageCategory;
type RiskLevel   = 'Safe' | 'Review';
type FixCategory = 'timeout' | 'selector' | 'logic' | 'config' | 'skip' | 'bug-report';

interface TriageFailure {
  verdict:         RCAVerdict;
  confidence:      string;
  reasoning:       string;
  suggestedAction: string;
  test: {
    testTitle:    string;
    suiteName:    string;
    file:         string;
    browserName:  string;
    priority:     string;
    errorMessage: string;
    errorStack:   string;
    retries:      number;
    isTaggedFlaky: boolean;
    isTaggedSlow:  boolean;
  };
}

interface TriageReport {
  runTimestamp: string;
  totalFailed:  number;
  summary:      Record<RCAVerdict, number>;
  results:      TriageFailure[];
}

interface FixSuggestion {
  testTitle:      string;
  file:           string;
  browser:        string;
  verdict:        RCAVerdict;
  fixCategory:    FixCategory;
  risk:           RiskLevel;
  explanation:    string;
  currentCode:    string;
  suggestedCode:  string;
  autoApplied:    boolean;
}

// ── Config ───────────────────────────────────────────────────

const CONFIG = {
  triageReport:  'reports/triage-report.json',
  outputMd:      'reports/suggested-fixes.md',
  outputJson:    'reports/suggested-fixes.json',
  model:         'claude-sonnet-4-5' as const,
  dryRun:        process.argv.includes('--dry-run'),
  testsDir:      'src/tests',
};


// ── Entry point ───────────────────────────────────────────────

async function main() {
  console.log('\n🔧 Adaptive Fixes — generating suggestions...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set.\n');
    process.exit(1);
  }

  let triage: TriageReport
  const triageRepo = new AiTriageRepository()
  const runIds = [...new Set(
    (fs.existsSync(CONFIG.triageReport)
      ? (JSON.parse(fs.readFileSync(CONFIG.triageReport, 'utf-8')) as TriageReport).results?.map((r: any) => r.test?.runId).filter(Boolean)
      : []) as string[]
  )]
  const dbRows = runIds.length
    ? await triageRepo.findByRun(runIds[0])
    : []
  if (dbRows.length) {
    // Map DB rows to local TriageReport shape
    triage = {
      runTimestamp: new Date().toISOString(),
      totalFailed:  dbRows.length,
      // Count over all canonical categories. Historical rows carry legacy labels
      // ('Bug'/'Flaky'/…) that won't match the new categories — they count 0 here by
      // design (no backfill/migration); current-run rows use the new taxonomy.
      summary:      Object.fromEntries(ALL_TRIAGE_CATEGORIES.map(c => [c, dbRows.filter(r => r.failure_category === c).length] as [TriageCategory, number])) as Record<TriageCategory, number>,
      results: dbRows.map(r => ({
        verdict: r.failure_category as any,
        confidence: r.confidence,
        reasoning: (r as any).root_cause,
        suggestedAction: (r as any).suggested_fix,
        test: { testTitle: r.test_id.split('::')[1]??r.test_id, suiteName: '', file: r.test_id.split('::')[0]??'', browserName: r.test_id.split('::')[2]??'unknown', priority: 'Unknown', errorMessage: '', errorStack: '', retries: 0, isTaggedFlaky: false, isTaggedSlow: false },
      })) as any,
    }
  } else if (fs.existsSync(CONFIG.triageReport)) {
    triage = JSON.parse(fs.readFileSync(CONFIG.triageReport, 'utf-8'))
  } else {
    console.error(`❌ No triage data available. Run triage first.\n`)
    process.exit(1)
  }

  if (!triage.results?.length) {
    console.log('✅ No failures in triage report — nothing to fix!\n');
    process.exit(0);
  }

  // Deduplicate by testTitle (same test, multiple browsers = one fix)
  const uniqueFailures = deduplicateByTest(triage.results);
  console.log(`📋 ${triage.results.length} failure(s) → ${uniqueFailures.length} unique test(s) to fix\n`);

  const suggestions: FixSuggestion[] = [];

  for (let i = 0; i < uniqueFailures.length; i++) {
    const failure = uniqueFailures[i];
    const icon = TRIAGE_DISPLAY[failure.verdict as TriageCategory]?.icon ?? '❓';
    console.log(`  [${i + 1}/${uniqueFailures.length}] ${icon} ${failure.test.testTitle}`);

    const testSource = readTestFile(failure.test.file);
    const suggestion  = await generateFix(failure, testSource);
    suggestions.push(suggestion);

    const riskIcon = suggestion.risk === 'Safe' ? '✅' : '👀';
    console.log(`         → ${riskIcon} ${suggestion.fixCategory} fix (${suggestion.risk})`);
    if (suggestion.autoApplied) {
      console.log(`         → Applied to file automatically`);
    }

    if (i < uniqueFailures.length - 1) await sleep(400);
  }

  // Write reports
  fs.writeFileSync(CONFIG.outputMd,   buildMarkdown(triage, suggestions),      'utf-8');
  fs.writeFileSync(CONFIG.outputJson, JSON.stringify(suggestions, null, 2),    'utf-8');

  // Auto-apply safe fixes
  if (!CONFIG.dryRun) {
    applyFixes(suggestions);
  } else {
    console.log('\n  ℹ️  Dry run — no files modified.');
  }

  printSummary(suggestions);
}

// ── Deduplicate failures by test title ───────────────────────

function deduplicateByTest(results: TriageFailure[]): TriageFailure[] {
  const seen = new Set<string>();
  return results.filter(r => {
    const key = `${r.test.file}::${r.test.testTitle}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Read test source file ─────────────────────────────────────

function readTestFile(relativeFile: string): string {
  // Try both relative and src/tests/ paths
  const candidates = [
    path.join(CONFIG.testsDir, relativeFile),
    relativeFile,
    path.join('src', 'tests', path.basename(relativeFile)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf-8');
    }
  }

  return '// Could not read test file — suggestions based on error only';
}

// ── System prompt ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior QA automation engineer fixing failing Playwright tests.

Framework context:
- Playwright 1.58, TypeScript, ${getAppName()} (${getBaseUrl()})
- playwright.config.ts: actionTimeout: 15000 (15s per action), retries: 1
- test.setTimeout() overrides the TOTAL test timeout but NOT the per-action timeout
- To fix action timeouts, use: page.setDefaultTimeout(N) inside the test body
- Known slow users: performance_glitch_user (very slow), problem_user (broken images)

Fix categories:
- "timeout"   — add/increase page.setDefaultTimeout() or action-specific timeout
- "selector"  — improve selector stability
- "logic"     — fix test assertion or flow logic  
- "config"    — change test.setTimeout or test.slow()
- "skip"      — mark as test.skip() with clear reason
- "bug-report"— no code fix; describe the bug for the dev team

Risk levels:
- "Safe"   — pure timeout/wait change, cannot break other tests, safe to auto-apply
- "Review" — logic/selector/assertion change, needs human review before applying

Respond ONLY in this exact JSON (no markdown, no preamble):
{
  "fixCategory": "timeout" | "selector" | "logic" | "config" | "skip" | "bug-report",
  "risk": "Safe" | "Review",
  "explanation": "2-3 sentences: root cause + what the fix does + why it's safe/needs review.",
  "currentCode": "The exact lines to replace (copy from source, max 15 lines)",
  "suggestedCode": "The replacement code (same structure, with fix applied)"
}

For bug-report: set currentCode and suggestedCode to empty string "".`;

// ── Generate fix via Claude ───────────────────────────────────

async function generateFix(failure: TriageFailure, testSource: string): Promise<FixSuggestion> {
  const testSnippet = extractTestSnippet(testSource, failure.test.testTitle);

  const prompt = `Fix this failing Playwright test:

Test:     ${failure.test.testTitle}
File:     ${failure.test.file}
Suite:    ${failure.test.suiteName}
Verdict:  ${failure.verdict} (${failure.confidence} confidence)
Browser:  ${failure.test.browserName}
Tags:     ${[failure.test.isTaggedFlaky && '@flaky', failure.test.isTaggedSlow && '@slow'].filter(Boolean).join(', ') || 'none'}
Retries:  ${failure.test.retries}

Error:
${failure.test.errorMessage}

RCA reasoning: ${failure.reasoning}
Suggested action: ${failure.suggestedAction}

Current test code:
\`\`\`typescript
${testSnippet}
\`\`\`

Generate the fix.`;

  try {
    const aiResp = await aiCall({
      operation: 'fix-suggestion',
      appName:   getAppName(),
      system:    SYSTEM_PROMPT,
      messages:  [{ role: 'user', content: prompt }],
      maxTokens: 1024,
    })

    const content = aiResp.content
    const parsed  = parseFixResponse(content);

    return {
      testTitle:     failure.test.testTitle,
      file:          failure.test.file,
      browser:       failure.test.browserName,
      verdict:       failure.verdict,
      fixCategory:   parsed.fixCategory,
      risk:          parsed.risk,
      explanation:   parsed.explanation,
      currentCode:   parsed.currentCode,
      suggestedCode: parsed.suggestedCode,
      autoApplied:   false, // set later in applyFixes
    };

  } catch (err) {
    console.warn(`  ⚠️  Claude API error: ${err}`);
    return {
      testTitle:     failure.test.testTitle,
      file:          failure.test.file,
      browser:       failure.test.browserName,
      verdict:       failure.verdict,
      fixCategory:   'skip',
      risk:          'Review',
      explanation:   'API error — review manually.',
      currentCode:   '',
      suggestedCode: '',
      autoApplied:   false,
    };
  }
}

// ── Extract relevant test snippet from source ─────────────────

function extractTestSnippet(source: string, testTitle: string): string {
  // Find the test by title and extract ~30 lines around it
  const lines  = source.split('\n');
  const titleQ = testTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex  = new RegExp(`test\\(.*${titleQ}`);

  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) { startLine = i; break; }
  }

  if (startLine === -1) {
    // Fallback: return first 40 lines
    return lines.slice(0, 40).join('\n');
  }

  // Find closing brace of this test block
  let braceDepth = 0;
  let endLine    = startLine;
  for (let i = startLine; i < lines.length; i++) {
    braceDepth += (lines[i].match(/{/g) ?? []).length;
    braceDepth -= (lines[i].match(/}/g) ?? []).length;
    if (braceDepth === 0 && i > startLine) { endLine = i; break; }
  }

  return lines.slice(startLine, endLine + 1).join('\n');
}

// ── Parse Claude's JSON response ──────────────────────────────

function parseFixResponse(content: string): {
  fixCategory: FixCategory;
  risk: RiskLevel;
  explanation: string;
  currentCode: string;
  suggestedCode: string;
} {
  try {
    const clean  = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      fixCategory:   parsed.fixCategory   ?? 'skip',
      risk:          parsed.risk          ?? 'Review',
      explanation:   parsed.explanation   ?? '',
      currentCode:   parsed.currentCode   ?? '',
      suggestedCode: parsed.suggestedCode ?? '',
    };
  } catch {
    return {
      fixCategory: 'skip', risk: 'Review',
      explanation: `Parse error: ${content.slice(0, 100)}`,
      currentCode: '', suggestedCode: '',
    };
  }
}

// ── Auto-apply safe fixes ─────────────────────────────────────

function applyFixes(suggestions: FixSuggestion[]) {
  const safeFixes = suggestions.filter(
    s => s.risk === 'Safe' && s.currentCode && s.suggestedCode && s.currentCode !== s.suggestedCode
  );

  if (safeFixes.length === 0) {
    console.log('\n  ℹ️  No safe fixes to auto-apply — all require review.');
    return;
  }

  console.log(`\n🔨 Auto-applying ${safeFixes.length} safe fix(es)...\n`);

  for (const fix of safeFixes) {
    const filePath = findTestFilePath(fix.file);
    if (!filePath) {
      console.log(`  ⚠️  Could not find file: ${fix.file}`);
      continue;
    }

    try {
      const source  = fs.readFileSync(filePath, 'utf-8');
      // WITH this (normalizes line endings before matching):
	  const normalizedSource  = source.replace(/\r\n/g, '\n');
	  const normalizedCurrent = fix.currentCode.replace(/\r\n/g, '\n');
	  const normalizedSuggested = fix.suggestedCode.replace(/\r\n/g, '\n');
	  const updated = normalizedSource.includes(normalizedCurrent)
		? source.replace(fix.currentCode.replace(/\r\n/g, '\n'), normalizedSuggested)
		: source;

      if (updated === source) {
        console.log(`  ⚠️  Could not apply fix to ${fix.testTitle} — code not found verbatim`);
        continue;
      }

      fs.writeFileSync(filePath, updated, 'utf-8');
      fix.autoApplied = true;
      console.log(`  ✅ Applied: ${fix.testTitle}`);

    } catch (err) {
      console.log(`  ❌ Failed to apply fix to ${fix.file}: ${err}`);
    }
  }
}

function findTestFilePath(relativeFile: string): string | null {
  const candidates = [
    path.join(CONFIG.testsDir, relativeFile),
    relativeFile,
    path.join('src', 'tests', path.basename(relativeFile)),
  ];
  return candidates.find(c => fs.existsSync(c)) ?? null;
}

// ── Markdown report ───────────────────────────────────────────

function buildMarkdown(triage: TriageReport, suggestions: FixSuggestion[]): string {
  const safe    = suggestions.filter(s => s.risk === 'Safe');
  const review  = suggestions.filter(s => s.risk === 'Review');
  const applied = suggestions.filter(s => s.autoApplied);

  const lines = [
    '# Adaptive Fix Suggestions',
    '',
    `**Generated:** ${new Date().toLocaleString()}  `,
    `**Based on:** ${triage.totalFailed} failure(s) from triage report`,
    '',
    '## Summary',
    '',
    '| Category | Count |',
    '|---|---|',
    `| ✅ Safe fixes (auto-applied) | ${applied.length} |`,
    `| 👀 Needs review | ${review.length} |`,
    `| Total suggestions | ${suggestions.length} |`,
    '',
    '---',
    '',
  ];

  if (applied.length > 0) {
    lines.push('## ✅ Auto-Applied Fixes', '');
    lines.push('> These were applied directly to the test files. Run tests to verify.', '');
    for (const s of applied) {
      lines.push(...formatFixBlock(s));
    }
  }

  if (safe.filter(s => !s.autoApplied).length > 0) {
    lines.push('## ✅ Safe Fixes (not yet applied)', '');
    for (const s of safe.filter(x => !x.autoApplied)) {
      lines.push(...formatFixBlock(s));
    }
  }

  if (review.length > 0) {
    lines.push('## 👀 Needs Human Review', '');
    lines.push('> These changes involve logic, selectors, or assertions — verify before applying.', '');
    for (const s of review) {
      lines.push(...formatFixBlock(s));
    }
  }

  return lines.join('\n');
}

function formatFixBlock(s: FixSuggestion): string[] {
  const categoryIcon: Record<FixCategory, string> = {
    timeout: '⏱️', selector: '🎯', logic: '🧠',
    config: '⚙️', skip: '⏭️', 'bug-report': '🐛',
  };

  const lines = [
    `### ${categoryIcon[s.fixCategory]} \`${s.testTitle}\``,
    `- **File:** \`${s.file}\``,
    `- **Verdict:** ${s.verdict} · **Fix type:** ${s.fixCategory} · **Risk:** ${s.risk}`,
    `- **Explanation:** ${s.explanation}`,
    '',
  ];

  if (s.currentCode && s.suggestedCode) {
    lines.push(
      '**Before:**',
      '```typescript',
      s.currentCode,
      '```',
      '',
      '**After:**',
      '```typescript',
      s.suggestedCode,
      '```',
      '',
    );
  }

  if (s.autoApplied) {
    lines.push('> ✅ **Auto-applied to file**', '');
  }

  lines.push('---', '');
  return lines;
}

// ── Console summary ───────────────────────────────────────────

function printSummary(suggestions: FixSuggestion[]) {
  const applied = suggestions.filter(s => s.autoApplied).length;
  const review  = suggestions.filter(s => s.risk === 'Review').length;

  console.log('\n──────────────────────────────────');
  console.log('  ADAPTIVE FIXES COMPLETE');
  console.log('──────────────────────────────────');
  console.log(`  ✅ Auto-applied:   ${applied}`);
  console.log(`  👀 Needs review:  ${review}`);
  console.log('──────────────────────────────────');
  console.log(`  📝 ${CONFIG.outputMd}`);
  console.log(`  📄 ${CONFIG.outputJson}`);
  console.log('──────────────────────────────────\n');

  if (applied > 0) {
    console.log('  💡 Fixes applied — run npm run test:all to verify.\n');
  }
  if (review > 0) {
    console.log('  💡 Review suggested-fixes.md before applying manual fixes.\n');
  }
}

// ── Helpers ───────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
