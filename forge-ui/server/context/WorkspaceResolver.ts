/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import { createRequire } from 'module'
import * as path from 'path'
import * as os from 'os'
import { assertValidAppName } from './appName'

/**
 * WorkspaceResolver — the per-app UI workspace at ~/.forge-projects/<appName>/
 * (ADR-013). resolve() is PURE (paths only, never mkdirs — a read must not make
 * a not-yet-onboarded app look onboarded); provision() creates .forge/ and
 * returns a real engine Workspace. NO cwd fallback: forge-ui never reads/writes
 * the repo tree. Phase 2: tenant cloud storage.
 *
 * Uses createRequire so the engine is loaded at runtime (under tsx) without
 * forge-ui's tsc pulling the engine into the UI compile — the one-directional
 * boundary holds (forge-ui → src, never the reverse).
 */
const require = createRequire(import.meta.url)

/** Structural slice of the engine Workspace — avoids importing the engine type. */
export interface ResolvedWorkspace {
  root: string
  forgeDir: string
  [key: string]: unknown
}

export class WorkspaceResolver {
  constructor(
    private readonly projectsRoot = path.join(os.homedir(), '.forge-projects'),
  ) {}

  /** PURE — per-app workspace paths. NEVER mkdirs. Use for read-only checks. */
  resolve(appName: string): ResolvedWorkspace {
    assertValidAppName(appName)   // TD-UI-051 backstop — traversal can't reach path.join even if a route forgets to validate
    const root = path.join(this.projectsRoot, appName)
    return { root, forgeDir: path.join(root, '.forge') }
  }

  /** PROVISION — create <root>/.forge/ and return a REAL engine Workspace
   *  (loadConfig/saveConfig/…), as CrawlRunner requires. Call only at
   *  onboard/establishment or when handing the engine a workspace to write. */
  provision(appName: string): ResolvedWorkspace {
    assertValidAppName(appName)   // TD-UI-051 backstop — never mkdir outside the projects root
    const enginePath = '../../../src/core/workspace/WorkspaceManager'
    const { createWorkspace } = require(enginePath)
    const root = path.join(this.projectsRoot, appName)
    return createWorkspace(root) as ResolvedWorkspace
  }
}

export const workspaceResolver = new WorkspaceResolver()
