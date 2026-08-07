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
 * TD-013 Phase 2 Commit 1 — AgentMemoryRepository.
 *
 * Persistence seam for cross-session AgentMemory. The planner and AgentRunner
 * depend ONLY on the AgentMemoryRepository interface, never on storage details —
 * so swapping JsonAgentMemoryRepository (Phase 1) for a future SqliteAgentMemory-
 * Repository (TD-103) requires zero planner changes.
 *
 * TD-097 (portability): all paths are derived at runtime from __dirname/REPO_ROOT
 * via path.join; no hardcoded or OS-specific paths.
 */
import * as fs from 'fs'
import * as path from 'path'
import { AgentMemory, Goal } from './types'

// Repo root from THIS file's location (src/core/agent/), not process.cwd().
const REPO_ROOT = path.resolve(__dirname, '../../..')   // agent -> core -> src -> repoRoot

// ── PART 1 — Repository interface ─────────────────────────────────────────────

export interface AgentMemoryRepository {
  load(appId: string): Promise<AgentMemory | null>
  save(memory: AgentMemory): Promise<void>
  findStaleGoals(appId: string, staleAfter: Date): Promise<Goal[]>
}

/**
 * The staleness rule, shared by every repository implementation (TD-108: also
 * WorkspaceMemoryRepository) so the definition of "stale" cannot drift between
 * storage backends: an ACHIEVED goal is stale when any of its evidence expired
 * before `staleAfter`.
 */
export function filterStaleGoals(memory: AgentMemory, staleAfter: Date): Goal[] {
  return memory.goals.filter(g =>
    g.status === 'achieved' &&
    g.evidenceChain.some(e => e.expiresAt && new Date(e.expiresAt) < staleAfter),
  )
}

// ── PART 2 — JSON implementation (Phase 1) ────────────────────────────────────

export class JsonAgentMemoryRepository implements AgentMemoryRepository {
  /** models/<appId>/agent-memory.json — runtime-derived, no hardcoded paths. */
  private getPath(appId: string): string {
    return path.join(REPO_ROOT, 'models', appId, 'agent-memory.json')
  }

  async load(appId: string): Promise<AgentMemory | null> {
    const p = this.getPath(appId)
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as AgentMemory
  }

  async save(memory: AgentMemory): Promise<void> {
    const p = this.getPath(memory.appId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(memory, null, 2), 'utf-8')
    console.log(`[AgentMemory] Saved to: ${path.relative(REPO_ROOT, p).replace(/\\/g, '/')}`)
  }

  async findStaleGoals(appId: string, staleAfter: Date): Promise<Goal[]> {
    const memory = await this.load(appId)
    if (!memory) return []
    return filterStaleGoals(memory, staleAfter)
  }
}
