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
 * TD-UI-051 (SECURITY) — appName validation.
 *
 * `appName` is a single filesystem path SEGMENT (~/.forge-projects/<appName>/),
 * never a path. Client-supplied appName (route params + bodies) flows into
 * `path.join(os.homedir(), '.forge-projects', appName)` in WorkspaceResolver — so
 * an unvalidated value like `'../../../etc'` escapes the projects root (path
 * traversal → arbitrary-location read via `readJson`, mkdir via `provision`).
 *
 * Charset (evidence-backed, TD-UI-051 Step 0): a single lowercase alnum-hyphen
 * segment — matches every real appName (a hostname-derived name is a single DNS
 * label; all fixtures are lowercase-hyphen) and CredentialStore's `-`→`_` env
 * prefix assumption. Rejects '.', '..', '/', '\', NUL, uppercase, and empty.
 * Mirrors the containment discipline TestFileResolver applies to the fileId axis.
 */
export class InvalidAppNameError extends Error {
  readonly code = 'INVALID_APP_NAME'
  constructor(public readonly received: unknown) {
    super('Invalid appName: must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, and hyphens; no dots, slashes, or path segments).')
    this.name = 'InvalidAppNameError'
  }
}

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/** True iff `appName` is a single, safe path segment. Type-narrows to string. */
export function isValidAppName(appName: unknown): appName is string {
  return typeof appName === 'string'
    && appName.length > 0
    && !appName.includes('\0')      // belt-and-suspenders (the regex also excludes it)
    && APP_NAME_RE.test(appName)
}

/** Throw InvalidAppNameError unless `appName` is a valid single segment; else return it. */
export function assertValidAppName(appName: unknown): string {
  if (!isValidAppName(appName)) throw new InvalidAppNameError(appName)
  return appName
}
