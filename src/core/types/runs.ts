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

export type RunStatus   = 'passed' | 'failed' | 'partial' | 'unknown';
/**
 * TD-126: run LIFECYCLE — orthogonal to RunStatus (test outcome). Never mix
 * them: a run can be lifecycle:'completed' with status:'failed' (it finished,
 * and its tests failed). 'interrupted' runs keep completed_at null forever.
 */
export type RunLifecycle = 'created' | 'running' | 'completed' | 'failed' | 'interrupted';
export type TriggeredBy = 'ci' | 'manual' | 'platform' | 'agent';
export type Environment = 'local' | 'ci' | 'staging' | 'production';

export interface RunRecord {
  runId:           string;
  appName:         string;
  branch:          string;
  commitSha:       string;
  environment:     Environment;
  baseUrl:         string;
  triggeredBy:     TriggeredBy;
  reporterVersion: string;
  status:          RunStatus;
  total:           number;
  passed:          number;
  failed:          number;
  skipped:         number;
  duration:        number;
  startTime:       string;
  endTime:         string;
  metadata?:       Record<string, unknown>;
}

export interface RunHistory {
  created: string;
  runs:    RunRecord[];
}

export interface RunStats {
  total:    number;
  passed:   number;
  failed:   number;
  skipped:  number;
  duration: number;
  passRate: number;
}

export interface RunFailure {
  testId:  string;
  title:   string;
  suite:   string;
  error:   string;
  browser: string;
}
