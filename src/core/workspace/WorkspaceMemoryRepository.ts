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
 * TD-108 — WorkspaceMemoryRepository: AgentMemoryRepository over a Workspace.
 *
 * Resolution of Step-0 finding B: AgentRunner stays UNCHANGED — it already
 * depends only on the AgentMemoryRepository seam (TD-013 design), so routing
 * agent memory into the workspace (.forge/agent-memory.json) is just another
 * implementation of that seam. No path logic here: the Workspace owns paths.
 */
import { AgentMemory, Goal } from '../agent/types'
import { AgentMemoryRepository, filterStaleGoals } from '../agent/AgentMemoryRepository'
import { Workspace } from './WorkspaceManager'

export class WorkspaceMemoryRepository implements AgentMemoryRepository {
  constructor(private workspace: Workspace) {}

  async load(appId: string): Promise<AgentMemory | null> {
    const raw = await this.workspace.loadMemory(appId)
    if (raw === null) return null
    const memory = raw as AgentMemory
    // Single-app-workspace safeguard: the workspace holds ONE memory file; if it
    // belongs to a different app, say so and treat as no-memory — never silently
    // hand app A's goals/evidence to app B (Rule 5).
    if (memory.appId !== appId) {
      console.warn(
        `[WorkspaceMemory] .forge/agent-memory.json belongs to '${memory.appId}', ` +
        `not '${appId}' — ignoring it (single-app workspace safeguard)`,
      )
      return null
    }
    return memory
  }

  async save(memory: AgentMemory): Promise<void> {
    await this.workspace.saveMemory(memory.appId, memory)
  }

  async findStaleGoals(appId: string, staleAfter: Date): Promise<Goal[]> {
    const memory = await this.load(appId)
    if (!memory) return []
    return filterStaleGoals(memory, staleAfter)
  }
}
