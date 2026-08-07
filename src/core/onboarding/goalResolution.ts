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
 * TD-013 Phase 3 (Block 3) — goal resolution: the WRITE and the READER for auto-discovered
 * goals, kept TOGETHER so the channel is never orphaned (ADR-017: a persisted artifact must
 * have a consumer that ships with it).
 *
 * Two-phase, SUPPLEMENT-with-precedence design (ratified):
 *   - WRITE (synthesizeAndPersistGoals): post-crawl, from the COMMITTED model, gated so a
 *     hand-authored config OVERRIDES (never overwritten). Additive — writes an artifact for
 *     a LATER run; does not change the current run's execution.
 *   - READ (resolveGoalDefinitions): precedence user-authored > synthesized > empty.
 *
 * Grounding + origin are carried through untouched: this module never recomputes or
 * promotes them (the recipe-writer is the sole author of the goals; here they are opaque).
 */

import * as fs from 'fs'
import * as path from 'path'
import { GoalDefinition } from '../agent/AgentPlanner'
import { DefaultGoalSynthesizer } from '../agent/GoalSynthesizer'
import { topologyFromAppModel } from '../agent/TopologyExtractor'
import { Missions } from '../agent/Mission'
import { AppModel } from './types'
import { Workspace, createWorkspace } from '../workspace/WorkspaceManager'

/** GENERATION provenance only — what model produced these goals. NOT execution/validation
 *  history (that is session history; Nova's split — never store one here as the other). */
export interface SynthesizedGoalsEnvelope {
  provenance: {
    sourceApp:           string
    classificationRunId: string | null
    schemaVersion?:      string
    synthesizedAt:       string   // ISO
  }
  goals: GoalDefinition[]
}

/** Locate a hand-authored goals.<appName>.config.ts under src/apps, or null if none. */
export function findHandAuthoredConfig(appName: string): string | null {
  const appsDir = path.resolve('src/apps')
  function find(dir: string): string | null {
    if (!fs.existsSync(dir)) return null
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const found = find(path.join(dir, entry.name))
        if (found) return found
      } else if (entry.name === `goals.${appName}.config.ts`) {
        return path.join(dir, entry.name)
      }
    }
    return null
  }
  return find(appsDir)
}

/** True iff the app has a hand-authored goals config (which OVERRIDES auto-discovery). */
export function hasHandAuthoredConfig(appName: string): boolean {
  return findHandAuthoredConfig(appName) !== null
}

/**
 * WRITE — synthesize goals from the committed model and persist the envelope, UNLESS a
 * hand-authored config exists (precedence: hand-authored wins → skip, return null). Returns
 * the synthesized goals on write, null on skip.
 */
export async function synthesizeAndPersistGoals(
  appName:   string,
  model:     AppModel,
  workspace: Workspace,
): Promise<GoalDefinition[] | null> {
  if (hasHandAuthoredConfig(appName)) {
    console.log(`[goalResolution] Retaining hand-authored goals config for ${appName} — skipping auto-discovery.`)
    return null
  }
  const topology = topologyFromAppModel(model)
  const goals    = new DefaultGoalSynthesizer().synthesizeFromTopology(topology, Missions.crawl())
  const envelope: SynthesizedGoalsEnvelope = {
    provenance: {
      sourceApp:           appName,
      classificationRunId: model.classificationRunId ?? null,
      schemaVersion:       model.schemaVersion,
      synthesizedAt:       new Date().toISOString(),
    },
    goals,
  }
  await workspace.saveSynthesizedGoals(appName, envelope)
  console.log(`[goalResolution] Auto-discovered ${goals.length} goal(s) for ${appName} → models/${appName}/synthesized-goals.json`)
  return goals
}

/**
 * READ — resolve a run's goals by precedence: user-authored config > synthesized envelope >
 * empty. Returns GoalDefinition[] with every field (grounding, origin, actions) intact;
 * never recomputes or strips anything. `root` overrides the workspace root (tests/CI).
 */
export async function resolveGoalDefinitions(appName: string, root?: string): Promise<GoalDefinition[]> {
  const configPath = findHandAuthoredConfig(appName)
  if (configPath) {
    const goalsUrl = new URL(`file://${configPath.replace(/\\/g, '/')}`)
    const { default: goals } = await import(goalsUrl.href)
    return goals as GoalDefinition[]
  }
  const envelope = await createWorkspace(root).loadSynthesizedGoals(appName) as SynthesizedGoalsEnvelope | null
  if (envelope && Array.isArray(envelope.goals)) {
    console.log(`[goalResolution] Using ${envelope.goals.length} auto-discovered goal(s) for ${appName} (no hand-authored config).`)
    return envelope.goals
  }
  console.warn(`[goalResolution] No goals for "${appName}" (no goals.${appName}.config.ts, no synthesized-goals.json) — running with no goals`)
  return []
}
