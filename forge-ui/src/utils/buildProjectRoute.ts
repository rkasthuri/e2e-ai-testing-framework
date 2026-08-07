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
 * Build a project-scoped route by carrying the selected project through the
 * `?project=` URL param — the single source of truth for the active project
 * (TD-UI-022 follow-up). Returns the bare basePath when no project is selected.
 */
export function buildProjectRoute(basePath: string, project: string | null): string {
  return project ? `${basePath}?project=${project}` : basePath
}
