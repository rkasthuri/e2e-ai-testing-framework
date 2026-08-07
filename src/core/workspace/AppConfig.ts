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
 * TD-108 — AppConfig: the workspace-layer app configuration (JSON, schema-versioned).
 *
 * This is the .forge/config.json shape — the standalone-tool config a Workspace
 * loads/saves. It is deliberately THIN: the rich, hand-curated OnboardingConfig
 * (roles, flow hints, page prerequisites) remains the internal pipeline contract;
 * ConfigAdapter (TD-108 Step 4) converts between the two.
 *
 * Defined in its own file (pulled forward from the WorkspaceManager step) because
 * Bootstrap.generateConfig() returns it — Bootstrap must not depend on the
 * WorkspaceManager implementation, only on this type.
 */
export interface AppConfig {
  schemaVersion: 1;        // literal — versioned from day one; loadConfig() rejects anything else
  appName: string;
  url: string;
  appType: string;
  crawlStrategy: string;
  authType: string;
  credentials?: {
    envKey: string;        // pointer only — the secret itself stays in the environment
  };
  budgets?: {
    maxDepth?: number;
    maxPages?: number;
    aiCalls?: number;   // TD-132 — total Pool A AI budget (default DEFAULT_AI_BUDGET = 150)
  };
  /** TD-120 — Evidence Analysis tuning. minSample: how many executed runs a
   *  test needs before a flaky score is computed (below it, an
   *  insufficient-evidence record persists instead — Nova Q3). Default 10.
   *  NOTE: the CI pipeline's results-store.ts has no workspace and reads the
   *  FLAKY_MIN_SAMPLE env var instead; this field serves the standalone path. */
  analysis?: {
    minSample?: number;
  };
}
