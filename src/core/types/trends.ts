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

export interface TrendEntry {
  runId:     string;
  timestamp: string;
  total:     number;
  passed:    number;
  failed:    number;
  skipped:   number;
  duration:  number;
  passRate:  number;
  branch:    string;
}

export interface TrendStore {
  lastUpdated: string;
  totalRuns:   number;
  tests:       Record<string, TrendEntry>;
}

export interface AnalysisSummary {
  trend:          'improving' | 'degrading' | 'stable';
  passRateDelta:  number;
  flakyTestCount: number;
  topFailures:    string[];
  recommendation: string;
}

export interface RunStats {
  total:    number;
  passed:   number;
  failed:   number;
  duration: number;
  passRate: number;
}
