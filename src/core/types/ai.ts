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

export type AiOperation =
  | 'triage'
  | 'vision-heal'
  | 'test-gen'
  | 'rca'
  | 'crawl-classify'
  | 'module-classify'   // TD-112: page→module AI residue (distinct from crawl-classify element naming)
  | 'flow-detect'
  | 'trend-narrative'
  | 'flaky-score'
  | 'release-notes'
  | 'knowledge-qa'
  | 'perf-analysis'
  | 'visual-diff'
  | 'impact-analysis'
  | 'fix-suggestion'
  | 'gap-analysis'
  | 'dashboard-qa';

export interface AiUsageRecord {
  runId?:           string;
  appName:          string;
  operation:        AiOperation;
  model:            string;
  inputTokens:      number;
  outputTokens:     number;
  totalTokens:      number;
  estimatedCostUsd: number;
  durationMs:       number;
  triggeredBy:      string;
  success:          boolean;
  recordedAt:       string;
}

export interface AiResponse {
  content:      string;
  inputTokens:  number;
  outputTokens: number;
  model:        string;
  durationMs:   number;
}

export type AiProvider = 'claude' | 'ollama';

export interface AiCallParams {
  operation:  AiOperation;
  messages:   { role: 'user' | 'assistant'; content: string | any[] }[];
  system?:    string;
  maxTokens?: number;
  runId?:     string;
  appName:    string;
  provider?:  AiProvider;   // explicit provider override
  stage?:     string;       // stage key for PROVIDER_BY_STAGE routing
}
