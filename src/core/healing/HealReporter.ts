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

import * as fs from 'fs';
import * as path from 'path';
import { HealReport, HealEvent } from './types';
import { healStore } from './HealStore';

const REPORTS_DIR = path.resolve(process.cwd(), 'reports');

export class HealReporter {
  private events: HealEvent[] = [];
  private visionCallsUsed = 0;
  private runId: string;

  constructor() {
    this.runId = process.env.GITHUB_RUN_NUMBER ?? `local-${Date.now()}`;
  }

  // -- Event collection --

  addEvent(event: HealEvent): void {
    this.events.push(event);
    if (event.source === 'vision') this.visionCallsUsed++;
  }

  addEvents(events: HealEvent[]): void {
    events.forEach(e => this.addEvent(e));
  }

  // -- Report generation --

  generateReport(): HealReport {
    const succeeded = this.events.filter(e => e.healedSelector).length;
    const budget    = parseInt(process.env.VISION_HEAL_BUDGET ?? '5', 10);

    return {
      runId:               this.runId,
      timestamp:           new Date().toISOString(),
      healsAttempted:      this.events.length,
      healsSucceeded:      succeeded,
      healsFailed:         this.events.length - succeeded,
      visionCallsUsed:     this.visionCallsUsed,
      visionBudget:        budget,
      events:              this.events,
      pomUpdateCandidates: healStore.getPomUpdateCandidates(),
    };
  }

  // -- Persistence --

  saveReport(): string {
    const report   = this.generateReport();
    const filename = `heal-report-${this.runId}.json`;
    const jsonPath = path.join(REPORTS_DIR, filename);
    const mdPath   = path.join(REPORTS_DIR, 'heal-report-latest.md');

    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(mdPath, this.generateMarkdown(report), 'utf-8');

    console.log(`[HealReporter] Report saved: ${filename}`);
    this.printSummary(report);

    return jsonPath;
  }

  // -- Markdown summary --

  private generateMarkdown(report: HealReport): string {
    const status = report.healsSucceeded > 0
      ? `${report.healsSucceeded} heal(s) applied`
      : 'No healing required';

    const lines = [
      `# Self-Healing Report - Run #${report.runId}`,
      '',
      `**Status:** ${status}`,
      `**Timestamp:** ${report.timestamp}`,
      '',
      '## Summary',
      '',
      '| Metric | Value |',
      '|---|---|',
      `| Heals attempted | ${report.healsAttempted} |`,
      `| Heals succeeded | ${report.healsSucceeded} |`,
      `| Heals failed | ${report.healsFailed} |`,
      `| Vision calls used | ${report.visionCallsUsed} / ${report.visionBudget} |`,
      `| POM update candidates | ${report.pomUpdateCandidates.length} |`,
    ];

    if (report.events.length > 0) {
      lines.push('', '## Heal Events', '');
      lines.push('| Key | Original | Healed To | Source |');
      lines.push('|---|---|---|---|');
      report.events.forEach(e => {
        lines.push(
          `| ${e.key} | ${e.originalStrategy} | ${e.healedStrategy} (${e.healedSelector}) | ${e.source} |`
        );
      });
    }

    if (report.pomUpdateCandidates.length > 0) {
      lines.push('', '## POM Update Candidates', '');
      lines.push('These selectors have healed 3+ consecutive runs.');
      lines.push('Consider updating the Page Object to use the healed selector.');
      lines.push('');
      report.pomUpdateCandidates.forEach(key => {
        const entry = healStore.getEntry(key);
        lines.push(`- **${key}**: \`${entry?.healedSelector}\` (${entry?.consecutiveSuccesses} consecutive heals)`);
      });
    }

    return lines.join('\n');
  }

  private printSummary(report: HealReport): void {
    if (report.healsSucceeded === 0) {
      console.log('[HealReporter] No healing required this run');
      return;
    }
    console.log(`[HealReporter] ${report.healsSucceeded} heal(s) applied this run`);
    report.events.forEach(e => {
      console.log(`  -> ${e.key}: ${e.originalStrategy} -> ${e.healedStrategy}`);
    });
    if (report.pomUpdateCandidates.length > 0) {
      console.log(`[HealReporter] POM update candidates: ${report.pomUpdateCandidates.join(', ')}`);
    }
  }
}

// Singleton
export const healReporter = new HealReporter();
