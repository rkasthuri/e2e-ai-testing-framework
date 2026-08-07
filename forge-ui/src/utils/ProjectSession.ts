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

const KEY = 'forge:currentProject'

/**
 * Session-scoped memory of the selected project — a fallback for routes that
 * arrive without the `?project=` param (e.g. a bare tab click). The URL param
 * remains the primary source of truth; this only preserves the last selection
 * within the browser session (TD-UI-022 follow-up).
 */
export const ProjectSession = {
  getCurrent: (): string | null => sessionStorage.getItem(KEY),
  setCurrent: (project: string): void => { sessionStorage.setItem(KEY, project) },
  clear: (): void => { sessionStorage.removeItem(KEY) },
}
