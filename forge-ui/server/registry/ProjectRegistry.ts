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

import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

/**
 * ProjectRegistry — the server's record of onboarded apps. Central JSON file at
 * <home>/.forge/projects.json (TD-097: runtime path resolution). Written when a
 * project is created; read by GET /api/v1/projects. Phase 2 replaces this with
 * per-tenant cloud storage.
 */

/** Ruling J — HOME (Unix) → USERPROFILE (Windows) → os.homedir() fallback. */
function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? os.homedir()
}

export interface ProjectEntry {
  appName: string
  url: string
  workspacePath: string
  createdAt: string
  lastOpenedAt: string
}

export class ProjectRegistry {
  // Resolved lazily (per-call) so the home dir is read at use time, not at
  // construction — keeps the singleton honest across env changes (tests) and
  // avoids stale paths.
  private get registryPath(): string {
    return path.join(homeDir(), '.forge', 'projects.json')
  }

  list(): ProjectEntry[] {
    if (!fs.existsSync(this.registryPath)) return []
    try {
      return JSON.parse(fs.readFileSync(this.registryPath, 'utf-8')) as ProjectEntry[]
    } catch {
      return []   // corrupt registry → empty, never crash the server
    }
  }

  register(entry: ProjectEntry): void {
    const entries = this.list()
    const i = entries.findIndex(e => e.appName === entry.appName)
    if (i >= 0) entries[i] = entry
    else entries.push(entry)
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true })
    fs.writeFileSync(this.registryPath, JSON.stringify(entries, null, 2))
  }

  find(appName: string): ProjectEntry | undefined {
    return this.list().find(e => e.appName === appName)
  }
}

export const projectRegistry = new ProjectRegistry()
