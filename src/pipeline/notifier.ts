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
 * notifier.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3.6 – Slack + Email Notifications
 * FORGE — Autonomous Quality Engineering
 *
 * Sends notifications to #all-ryq (Slack) and raj.s.kasthuri@gmail.com
 * with three message levels based on run outcome:
 *
 *   INFO     — all tests passed (green run)
 *   WARNING  — flaky tests detected, pass rate dropped
 *   CRITICAL — bug-verdict failures, CI blocking failures
 *
 * Usage (standalone):
 *   npx tsx src/notifier.ts                  ← auto-detect level from reports
 *   npx tsx src/notifier.ts --level=critical ← force level
 *   npx tsx src/notifier.ts --slack-only     ← skip email
 *   npx tsx src/notifier.ts --email-only     ← skip Slack
 *   npx tsx src/notifier.ts --ci             ← CI mode (only notify on warn/critical)
 *
 * Called automatically by run.ts as Step 6.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs      from 'fs';
import * as path    from 'path';
import * as dotenv  from 'dotenv';
import * as nodemailer from 'nodemailer';
import { RunRepository }     from '../core/storage/repositories/RunRepository'
import { AiTriageRepository } from '../core/storage/repositories/AiTriageRepository'
import { TRIAGE_CATEGORIES } from '../core/triage/taxonomy'
dotenv.config();

// ── Types ─────────────────────────────────────────────────────────────────────

type NotifyLevel = 'info' | 'warning' | 'critical';

interface RunStats {
  total:    number;
  passed:   number;
  failed:   number;
  flaky:    number;
  skipped:  number;
  passRate: string;
}

interface RunFailure {
  testTitle:    string;
  file:         string;
  browser:      string;
  verdict:      string;
  errorMessage: string;
}

interface TriageReport {
  totalFailed: number;
  summary:     { bugs?: number; testDefects?: number; flaky?: number; needsReview?: number };
  failures?:   RunFailure[];
}

interface NotifyPayload {
  level:       NotifyLevel;
  passRate:    string;
  totalTests:  number;
  passed:      number;
  failed:      number;
  flaky:       number;
  bugs:        number;   // real app bugs only (evidence-gated)
  testDefects: number;
  flakyCount:  number;
  needsReview: number;   // infra-defect + insufficient-evidence (+ legacy Environment/Unknown)
  failures:    RunFailure[];
  failuresUnavailable: boolean;   // TD-UI-042: failed run (failed>0||bugs>0) but no enumerable detail
  runId:       string;
  branch:      string;
  durationMs:  number;
  healthScore: number;
  trend:       string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HISTORY_PATH = path.join('reports', 'run-history.json');
const TRIAGE_PATH  = path.join('reports', 'triage-report.json');
const NOTES_PATH   = path.join('reports', 'release-notes.json');

// ── Failure reconstruction (TD-UI-042 / ADR-017) ──────────────────────────────
// RunFailure IS reconstructible from the ai_triage rows the notifier already holds:
// test_id is `${file}::${title}::${browser}` (resultKey.ts) and failure_category is
// the verdict. root_cause serves as errorMessage (not rendered). The pre-fix code
// hardcoded `failures = []` with a FALSE comment claiming the shape wasn't stored.
interface TriageRowLike {
  test_id:          string;
  failure_category: string;
  root_cause?:      string | null;
}

/** Parse a resultKey test_id to its parts. 3-part `file::title::browser` or 2-part
 *  `file::title` (resultKey.ts); a `::` inside the title is preserved (middle-join). */
export function parseTestId(testId: string): { file: string; testTitle: string; browser: string } {
  const parts = testId.split('::');
  if (parts.length >= 3) return { file: parts[0], browser: parts[parts.length - 1], testTitle: parts.slice(1, -1).join('::') };
  if (parts.length === 2) return { file: parts[0], testTitle: parts[1], browser: '' };
  return { file: '', testTitle: testId, browser: '' };
}

export function reconstructFailures(rows: TriageRowLike[]): RunFailure[] {
  return rows.map(r => {
    const { file, testTitle, browser } = parseTestId(r.test_id);
    return { testTitle, file, browser, verdict: r.failure_category, errorMessage: r.root_cause ?? '' };
  });
}

/** TD-UI-042 honest floor: a failed run with no enumerable detail must say it
 *  CANNOT enumerate them (+ remedy) — never "no failures". */
function cannotEnumerateText(payload: NotifyPayload): string {
  const n = payload.failed || payload.bugs;
  return `${n} failure(s) on this run — detail unavailable (no triage rows for run ${payload.runId}). See reports/triage-report.json, or re-run triage.`;
}

const SLACK_WEBHOOK  = process.env.SLACK_WEBHOOK_URL ?? '';
const EMAIL_TO       = process.env.NOTIFY_EMAIL_TO   ?? 'raj.s.kasthuri@gmail.com';
const EMAIL_FROM     = process.env.NOTIFY_EMAIL_FROM ?? 'raj.s.kasthuri@gmail.com';
const GMAIL_PASSWORD = process.env.GMAIL_APP_PASSWORD ?? '';
const SLACK_CHANNEL  = '#all-ryq';

// ── Level detection ───────────────────────────────────────────────────────────

function detectLevel(payload: Omit<NotifyPayload, 'level'>): NotifyLevel {
  if (payload.bugs > 0)                     return 'critical';
  if (payload.failed > 0)                   return 'critical';
  if (payload.needsReview > 0)              return 'warning';
  if (payload.flakyCount > 0)               return 'warning';
  if (parseFloat(payload.passRate) < 90)    return 'warning';
  return 'info';
}

// ── Load report data ──────────────────────────────────────────────────────────

async function loadPayload(): Promise<Omit<NotifyPayload, 'level'>> {
  // Run history
  let stats: RunStats     = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, passRate: '100%' };
  let runId               = new Date().toISOString().slice(0, 19);
  let durationMs          = 0;

  const runRepo = new RunRepository()
  const dbRuns  = await runRepo.findRecent(10)
  if (dbRuns.length > 0) {
    const last = dbRuns[0]  // findRecent returns desc order
    runId      = last.run_id
    durationMs = last.duration_ms ?? 0
    stats = {
      total:    last.total_tests ?? 0,
      passed:   last.passed      ?? 0,
      failed:   last.failed      ?? 0,
      flaky:    0,
      skipped:  last.skipped     ?? 0,
      passRate: (last.total_tests ?? 0) > 0
        ? `${(((last.passed ?? 0) / last.total_tests) * 100).toFixed(1)}%`
        : '100%',
    }
  }

  // Triage report
  let bugs        = 0;
  let testDefects = 0;
  let flakyCount  = 0;
  let needsReview = 0;
  let failures:  RunFailure[] = [];

  const triageRepo = new AiTriageRepository()
  const triageRows = await triageRepo.findByRun(runId)
  // New taxonomy + legacy tolerance — historical rows still carry old labels
  // ('Bug'/'Environment'/'Flaky'/'Unknown'); no migration/backfill.
  const isCat = (r: { failure_category: string }, ...names: string[]) => names.includes(r.failure_category)
  bugs        = triageRows.filter(r => isCat(r, TRIAGE_CATEGORIES.APP_BUG, 'Bug')).length             // real bugs only (evidence-gated)
  testDefects = triageRows.filter(r => isCat(r, TRIAGE_CATEGORIES.TEST_DEFECT)).length
  flakyCount  = triageRows.filter(r => isCat(r, TRIAGE_CATEGORIES.FLAKY, 'Flaky')).length
  needsReview = triageRows.filter(r => isCat(r, TRIAGE_CATEGORIES.INFRA_DEFECT, TRIAGE_CATEGORIES.INSUFFICIENT_EVIDENCE, 'Environment', 'Unknown')).length
  failures    = reconstructFailures(triageRows)   // TD-UI-042: it IS in the rows (test_id + failure_category)

  // Release notes for health score + trend
  let healthScore = 100;
  let trend       = 'Stable';

  if (fs.existsSync(NOTES_PATH)) {
    const notes = JSON.parse(fs.readFileSync(NOTES_PATH, 'utf8'));
    healthScore = notes.healthScore ?? 100;
    trend       = notes.trend       ?? 'Stable';
  }

  // Git branch
  let branch = 'main';
  try {
    const { execSync } = require('child_process');
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch { /* ignore */ }

  // TD-UI-042 honest floor: a failed run with no enumerable detail must NOT read as
  // "no failures". Survives the reconstruction above — a runId mismatch (TD-069/070)
  // leaves triageRows empty while runs.failed > 0.
  const failuresUnavailable = (stats.failed > 0 || bugs > 0) && failures.length === 0

  return {
    passRate:   stats.passRate,
    totalTests: stats.total,
    passed:     stats.passed,
    failed:     stats.failed,
    flaky:      stats.flaky,
    bugs,
    testDefects,
    flakyCount,
    needsReview,
    failures,                          // full list; renderers cap at 5 with "+N more"
    failuresUnavailable,
    runId,
    branch,
    durationMs,
    healthScore,
    trend,
  };
}

// ── Slack Notification ────────────────────────────────────────────────────────

function slackColor(level: NotifyLevel): string {
  return { info: '#22c55e', warning: '#f59e0b', critical: '#ef4444' }[level];
}

function slackIcon(level: NotifyLevel): string {
  return { info: '✅', warning: '⚠️', critical: '🚨' }[level];
}

function slackLevelLabel(level: NotifyLevel): string {
  return { info: 'PASSED', warning: 'WARNING', critical: 'CRITICAL' }[level];
}

/** Pure — builds the Slack attachment (color + blocks). Exported for tests
 *  (mirrors emailHtml). No network. */
export function buildSlackBlocks(payload: NotifyPayload): { color: string; blocks: unknown[] } {
  const icon       = slackIcon(payload.level);
  const color      = slackColor(payload.level);
  const label      = slackLevelLabel(payload.level);
  const durationS  = Math.round(payload.durationMs / 1000);
  const trendIcon  = payload.trend === 'Improving' ? '📈' : payload.trend === 'Degrading' ? '📉' : '➡️';

  const shown = payload.failures.slice(0, 5);
  const more  = payload.failures.length - shown.length;
  const failureLines =
    payload.failures.length > 0
      ? shown.map(f => `• \`${f.testTitle}\` [${f.browser}] — ${f.verdict}`).join('\n')
        + (more > 0 ? `\n• …and ${more} more` : '')
      : payload.failuresUnavailable
        ? `⚠️ ${cannotEnumerateText(payload)}`
        : '• None';

  const blocks = [
    {
      type: 'header',
      text: {
        type:  'plain_text',
        text:  `${icon} FORGE Pipeline — ${label}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Pass Rate*\n${payload.passRate}` },
        { type: 'mrkdwn', text: `*Health Score*\n${payload.healthScore}/100` },
        { type: 'mrkdwn', text: `*Tests*\n${payload.passed}/${payload.totalTests} passed` },
        { type: 'mrkdwn', text: `*Trend*\n${trendIcon} ${payload.trend}` },
        { type: 'mrkdwn', text: `*Branch*\n\`${payload.branch}\`` },
        { type: 'mrkdwn', text: `*Duration*\n${durationS}s` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*🐛 App Bugs*\n${payload.bugs}` },
        { type: 'mrkdwn', text: `*🔧 Test Defects*\n${payload.testDefects}` },
        { type: 'mrkdwn', text: `*🟡 Flaky*\n${payload.flakyCount}` },
        { type: 'mrkdwn', text: `*❓ Needs Review*\n${payload.needsReview}` },
      ],
    },
    ...(payload.level !== 'info' ? [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Failures Detected:*\n${failureLines}`,
      },
    }] : []),
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `FORGE · Run \`${payload.runId}\` · ${new Date().toLocaleString()}`,
      }],
    },
    { type: 'divider' },
  ];

  return { color, blocks };
}

async function sendSlack(payload: NotifyPayload): Promise<void> {
  if (!SLACK_WEBHOOK) {
    console.warn('  ⚠️  SLACK_WEBHOOK_URL not set — skipping Slack');
    return;
  }
  const { color, blocks } = buildSlackBlocks(payload);
  const body = JSON.stringify({
    channel:     SLACK_CHANNEL,
    attachments: [{ color, blocks }],
  });

  const response = await fetch(SLACK_WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Slack responded with ${response.status}: ${await response.text()}`);
  }
}

// ── Email Notification ────────────────────────────────────────────────────────

function emailSubject(payload: NotifyPayload): string {
  const icon = { info: '✅', warning: '⚠️', critical: '🚨' }[payload.level];
  return `${icon} FORGE Pipeline — ${payload.passRate} Pass Rate | ${payload.level.toUpperCase()} | ${payload.branch}`;
}

export function emailHtml(payload: NotifyPayload): string {
  const color     = slackColor(payload.level);
  const durationS = Math.round(payload.durationMs / 1000);
  const trendIcon = payload.trend === 'Improving' ? '📈' : payload.trend === 'Degrading' ? '📉' : '➡️';

  const shownRows = payload.failures.slice(0, 5);
  const moreRows  = payload.failures.length - shownRows.length;
  const failureRows =
    payload.failures.length > 0
      ? shownRows.map(f => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #1e2330;font-family:monospace;font-size:13px;color:#e2e8f0">${f.testTitle}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e2330;font-size:13px;color:#94a3b8">${f.browser}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e2330;font-size:13px;color:${(f.verdict === 'app-bug' || f.verdict === 'Bug') ? '#ef4444' : (f.verdict === 'test-defect' || f.verdict === 'flaky' || f.verdict === 'Flaky') ? '#f59e0b' : '#94a3b8'}">${f.verdict}</td>
        </tr>`).join('')
        + (moreRows > 0 ? `<tr><td colspan="3" style="padding:8px 12px;color:#64748b;font-size:12px;text-align:center">…and ${moreRows} more</td></tr>` : '')
      : payload.failuresUnavailable
        ? `<tr><td colspan="3" style="padding:12px;color:#f59e0b;text-align:center">⚠️ ${cannotEnumerateText(payload)}</td></tr>`
        : `<tr><td colspan="3" style="padding:12px;color:#64748b;text-align:center">No failures detected</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0d0f14;font-family:'Segoe UI',sans-serif;color:#e2e8f0">
  <div style="max-width:640px;margin:0 auto;padding:24px">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#13161d,#1e2330);border:1px solid #1e2330;border-radius:12px;padding:24px;margin-bottom:16px">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#38bdf8;margin-bottom:8px">FORGE — Phase 3.6</div>
      <div style="font-size:24px;font-weight:800;margin-bottom:4px">Pipeline <span style="color:#38bdf8">Notification</span></div>
      <div style="display:inline-block;padding:4px 12px;background:${color};border-radius:100px;font-size:12px;font-weight:700;color:#fff;letter-spacing:0.05em">${payload.level.toUpperCase()}</div>
    </div>

    <!-- KPI Grid -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${[
        { label: 'Pass Rate',     value: payload.passRate,            color: color },
        { label: 'Health Score',  value: `${payload.healthScore}/100`, color: color },
        { label: 'Tests Passed',  value: `${payload.passed}/${payload.totalTests}`, color: '#38bdf8' },
        { label: 'Trend',         value: `${trendIcon} ${payload.trend}`, color: '#94a3b8' },
        { label: '🐛 App Bugs',     value: String(payload.bugs),        color: payload.bugs > 0 ? '#ef4444' : '#22c55e' },
        { label: '🔧 Test Defects', value: String(payload.testDefects), color: payload.testDefects > 0 ? '#f59e0b' : '#22c55e' },
        { label: '🟡 Flaky',        value: String(payload.flakyCount),  color: payload.flakyCount > 0 ? '#f59e0b' : '#22c55e' },
        { label: '❓ Needs Review',  value: String(payload.needsReview), color: payload.needsReview > 0 ? '#94a3b8' : '#22c55e' },
        { label: '⏱ Duration',      value: `${durationS}s`,             color: '#94a3b8' },
      ].map(k => `
        <div style="background:#13161d;border:1px solid #1e2330;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:${k.color}">${k.value}</div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-top:4px">${k.label}</div>
        </div>`).join('')}
    </div>

    <!-- Run Info -->
    <div style="background:#13161d;border:1px solid #1e2330;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b;margin-bottom:8px">Run Details</div>
      <div style="font-size:13px;color:#94a3b8">Run ID: <code style="color:#38bdf8">${payload.runId}</code></div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px">Branch: <code style="color:#38bdf8">${payload.branch}</code></div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px">Generated: ${new Date().toLocaleString()}</div>
    </div>

    <!-- Failures Table -->
    <div style="background:#13161d;border:1px solid #1e2330;border-radius:8px;overflow:hidden;margin-bottom:16px">
      <div style="padding:12px 16px;border-bottom:1px solid #1e2330;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#64748b">
        Failures Detected (top 5)
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#0d0f14">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em">Test</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em">Browser</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em">Verdict</th>
          </tr>
        </thead>
        <tbody>${failureRows}</tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="text-align:center;font-size:11px;color:#475569;padding:16px 0">
      FORGE — Autonomous Quality Engineering &nbsp;·&nbsp; Phase 3.6 Notifications &nbsp;·&nbsp; #all-ryq
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(payload: NotifyPayload): Promise<void> {
  if (!GMAIL_PASSWORD) {
    console.warn('  ⚠️  GMAIL_APP_PASSWORD not set — skipping email');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_FROM,
      pass: GMAIL_PASSWORD,
    },
  });

  await transporter.sendMail({
    from:    `"FORGE Pipeline" <${EMAIL_FROM}>`,
    to:      EMAIL_TO,
    subject: emailSubject(payload),
    html:    emailHtml(payload),
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args       = process.argv.slice(2);
  const forceLevel = args.find(a => a.startsWith('--level='))?.split('=')[1] as NotifyLevel | undefined;
  const slackOnly  = args.includes('--slack-only');
  const emailOnly  = args.includes('--email-only');
  const ciMode     = args.includes('--ci');

  console.log('═══════════════════════════════════════════════════');
  console.log('  FORGE Phase 3.6 — Notifications');
  console.log('═══════════════════════════════════════════════════\n');

  const base    = await loadPayload();
  const level   = forceLevel ?? detectLevel(base);
  const payload: NotifyPayload = { ...base, level };

  console.log(`  Level:      ${level.toUpperCase()}`);
  console.log(`  Pass Rate:  ${payload.passRate}`);
  console.log(`  Health:     ${payload.healthScore}/100`);
  console.log(`  App Bugs:     ${payload.bugs}`);
  console.log(`  Test Defects: ${payload.testDefects}`);
  console.log(`  Flaky:        ${payload.flakyCount}`);
  console.log(`  Needs Review: ${payload.needsReview}`);
  console.log(`  Branch:     ${payload.branch}\n`);

  // CI mode — only notify on warning or critical
  if (ciMode && level === 'info') {
    console.log('  ✅ CI mode — all green, skipping notification (info level)');
    console.log('  (use --level=info to force notify on green runs)\n');
    return;
  }

  const sendToSlack = !emailOnly;
  const sendToEmail = !slackOnly;

  // Send Slack
  if (sendToSlack) {
    process.stdout.write('  📨 Sending Slack notification...');
    try {
      await sendSlack(payload);
      console.log(' ✅ Sent to #all-ryq');
    } catch (err) {
      console.error(` ❌ Failed: ${err}`);
    }
  }

  // Send Email
  if (sendToEmail) {
    process.stdout.write('  📧 Sending email notification...');
    try {
      await sendEmail(payload);
      console.log(` ✅ Sent to ${EMAIL_TO}`);
    } catch (err) {
      console.error(` ❌ Failed: ${err}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════\n');
}

// TD-UI-042: run the pipeline only as the entry point — importing the pure
// render helpers (buildSlackBlocks / emailHtml / reconstructFailures) for tests
// must not execute main() (DB reads + live sends).
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
