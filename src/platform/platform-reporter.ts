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
 * platform-reporter.ts
 * ─────────────────────────────────────────────────────────────
 * FORGE — live progress reporter
 *
 * Emits one newline-delimited marker per test as it finishes, so the
 * platform UI can update the Last Run card in real time. Markers are
 * prefixed with "@@RYQ@@ " and the FORGE client filters them out of
 * the visible console.
 *
 * SAFETY: this reporter is INERT unless process.env.PLATFORM_RUN is set.
 * platform-server.ts sets PLATFORM_RUN=1 when it spawns a run, so normal
 * `npm test`, run.ts, and CI runs produce NO extra output.
 * ─────────────────────────────────────────────────────────────
 */

import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import * as path from 'path';

const PREFIX = '@@RYQ@@ ';

function active(): boolean {
  return !!process.env.PLATFORM_RUN;
}

function emit(obj: unknown): void {
  try { process.stdout.write(PREFIX + JSON.stringify(obj) + '\n'); }
  catch { /* never break a run over a log line */ }
}

/** Resolve the project (browser) name by walking up the suite tree. */
function projectName(test: TestCase): string {
  let s: any = (test as any).parent;
  while (s) {
    if (typeof s.project === 'function') {
      const p = s.project();
      if (p && p.name) return p.name;
    }
    s = s.parent;
  }
  return '';
}

class PlatformReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    if (!active()) return;
    const project = projectName(test);
    const file = test.location?.file ? path.basename(test.location.file) : '';
    const id = `${file}::${test.title}::${project}`;
    const err = result.error?.message ? String(result.error.message).split('\n')[0] : '';
    emit({
      type:       'test',
      id,
      title:      test.title,
      project,
      file,
      line:       test.location?.line ?? 0,
      status:     result.status,   // passed | failed | timedOut | interrupted | skipped
      retry:      result.retry,
      durationMs: result.duration,
      error:      err,
    });
  }

  onEnd(result: FullResult): void {
    if (!active()) return;
    emit({ type: 'done', status: result.status });
  }
}

export default PlatformReporter;
