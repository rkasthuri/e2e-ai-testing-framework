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

export type RiskCategory   = 'critical' | 'high' | 'medium' | 'low' | 'stable';
export type FlakyTrend     = 'improving' | 'degrading' | 'stable';
export type Recommendation = 'quarantine' | 'monitor' | 'fix-selector' |
                              'fix-timing' | 'stable';

export interface FlakySignals {
  timing:      number;
  selector:    number;
  data:        number;
  env:         number;
  concurrency: number;
  network:     number;
}

export interface PredictorResult {
  testId:         string;
  title:          string;
  flakyScore:     number;
  riskCategory:   RiskCategory;
  signals:        FlakySignals;
  recommendation: Recommendation;
  trend:          FlakyTrend;
  sampleSize:     number;
}
