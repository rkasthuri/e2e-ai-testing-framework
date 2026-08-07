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

export interface PWSpec {
  title: string;
  ok:    boolean;
  tests: PWTest[];
}

export interface PWTest {
  title:    string;
  ok:       boolean;
  duration: number;
  results:  PWResult[];
}

export interface PWResult {
  status:       string;
  duration:     number;
  retry:        number;
  error?:       { message: string; stack?: string };
  attachments?: { name: string; path?: string; contentType: string }[];
}

export interface PWSuite {
  title:   string;
  file?:   string;
  suites?: PWSuite[];
  specs:   PWSpec[];
}

export interface PWReport {
  stats: {
    expected:   number;
    unexpected: number;
    skipped:    number;
    duration:   number;
  };
  suites: PWSuite[];
}

export interface FailureRecord {
  testId:    string;
  title:     string;
  suite:     string;
  error:     string;
  browser:   string;
  runId:     string;
  timestamp: string;
}

export interface FlakyRecord {
  testId:     string;
  title:      string;
  flakyCount: number;
  totalRuns:  number;
  lastSeen:   string;
}
