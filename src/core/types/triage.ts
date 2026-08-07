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

export type RCAVerdict = 'selector-change' | 'timing' | 'data' | 'env' |
                         'app-bug' | 'test-bug' | 'unknown';
export type Priority   = 'critical' | 'high' | 'medium' | 'low';
export type Confidence = 'high' | 'medium' | 'low';
export type RiskLevel  = 'high' | 'medium' | 'low';

export interface FailedTest {
  testId:  string;
  title:   string;
  suite:   string;
  error:   string;
  browser: string;
}

export interface TriageResult {
  testId:          string;
  verdict:         RCAVerdict;
  confidence:      Confidence;
  rootCause:       string;
  suggestedFix:    string;
  priority:        Priority;
  similarFailures: string[];
}

export interface TriageReport {
  runId:     string;
  timestamp: string;
  results:   TriageResult[];
  summary:   string;
}

export interface FixSuggestion {
  testId:    string;
  fix:       string;
  riskLevel: RiskLevel;
  autoApply: boolean;
}
