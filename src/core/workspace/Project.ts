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
 * Project — the top-level FORGE abstraction.
 * Nova-approved (Per-App DB Isolation design review, TD-114/117/118).
 *
 *   Mission   → why the Agent is running
 *   Workspace → where artifacts live
 *   Project   → what all those artifacts belong to
 *
 * One Project = One Workspace = One Database (.forge/forge.db).
 *
 * The manifest (.forge/project.json) is the canonical handshake for future
 * version compatibility — schemaVersion pattern, same as AppConfig: versioned
 * from day one, wrong version throws, missing returns null.
 */
import * as fs from 'fs'
import * as path from 'path'
import { Workspace } from './WorkspaceManager'

export interface ProjectManifest {
  projectVersion: 1;        // literal — versioned from day one
  frameworkVersion: string; // from package.json at write time
  appName: string;
  url: string;
  createdAt: string;        // ISO — set once, never changes after first write
  lastOpenedAt: string;     // ISO — updated on every open
  databaseVersion: number;  // migration count at last open
}

export interface Project {
  manifest: ProjectManifest;
  workspace: Workspace;
}

/**
 * FORGE's own version, read from package.json at runtime.
 * TD-097: repo root from THIS file's location (src/core/workspace/), never
 * process.cwd() — a standalone run's cwd is the USER'S project, which has no
 * (or a different) package.json.
 */
export function getFrameworkVersion(): string {
  const pkgPath = path.resolve(__dirname, '../../..', 'package.json')   // workspace → core → src → repoRoot
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string }
  return pkg.version ?? '0.0.0'
}

/**
 * Build the manifest for an open: createdAt is written ONCE (preserved from
 * the existing manifest forever after); lastOpenedAt refreshes on every open;
 * databaseVersion records the migration count of this open. Extracted from
 * CrawlRunner so the preserve-semantics are unit-testable as production code.
 */
export function buildProjectManifest(
  existing: ProjectManifest | null,
  fields: { appName: string; url: string; databaseVersion: number },
): ProjectManifest {
  const now = new Date().toISOString()
  return {
    projectVersion:   1,
    frameworkVersion: getFrameworkVersion(),
    appName:          fields.appName,
    url:              fields.url,
    createdAt:        existing?.createdAt ?? now,
    lastOpenedAt:     now,
    databaseVersion:  fields.databaseVersion,
  }
}
