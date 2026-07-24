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

/**
 * TD-108 — CrawlRunner: the single orchestration engine.
 *
 * CLI, future UI, and future REST API all call THIS — never the Crawler,
 * Bootstrap, or AgentRunner directly. It owns the zero-friction decision
 * ("no config? bootstrap first, invisibly") and ALL workspace persistence.
 *
 * Ownership rules (Nova):
 *   - CrawlRunner is the ONLY component that calls workspace.*
 *   - Crawler/Bootstrap/AgentRunner produce data; CrawlRunner persists it.
 *   - No process.exit() anywhere on this path — errors propagate to the caller
 *     (the CLI's catch handler exits; a server would return a 500).
 */
import * as path from 'path'
import { Bootstrap, BootstrapOptions, generateRunId } from '../onboarding/Bootstrap'
import { Crawler } from '../onboarding/Crawler'
import { openProjectDatabase, getMigrationCount } from '../storage/DatabaseFactory'
import { buildProjectManifest } from '../workspace/Project'
import { AgentRunner } from '../agent/AgentRunner'
import { Missions } from '../agent/Mission'
import { GoalDefinition } from '../agent/AgentPlanner'
import { AgentMode } from '../agent/types'
import { AiBudgetTracker, AppModel } from '../onboarding/types'
import { synthesizeAndPersistGoals } from '../onboarding/goalResolution'
import { validateAppModel } from '../onboarding/ModelValidator'
import { AppModelRepository } from '../storage/repositories/AppModelRepository'
import { ModelEnrichmentPipeline } from '../pipeline/ModelEnrichmentPipeline'
import { ModuleClassifierStage } from '../pipeline/stages/ModuleClassifierStage'
import { AiResidueStage } from '../pipeline/stages/AiResidueStage'
import { Workspace, createWorkspace } from '../workspace/WorkspaceManager'
import { WorkspaceMemoryRepository } from '../workspace/WorkspaceMemoryRepository'
import { AppConfig } from '../workspace/AppConfig'
import { toOnboardingConfig } from '../workspace/ConfigAdapter'
import { DEFAULT_AI_BUDGET, DEFAULT_CLASSIFICATION_BUDGET, effectiveAiBudget } from '../config/budgetDefaults'

export interface CrawlRunnerOptions {
  url: string;
  appName?: string;        // derived from the URL hostname if not provided
  username?: string;
  password?: string;
  workspace?: Workspace;   // defaults to createWorkspace(process.cwd())
  mode?: AgentMode;        // 'supervised' (default) | 'autonomous'
  dryRun?: boolean;
  force?: boolean;         // re-bootstrap even if a config exists
  /** Run the goal-directed agent instead of the mechanical crawl (TD-013 path). */
  agent?: boolean;
  /** Goals for the agent path — empty is valid (AgentRunner warns and no-ops). */
  goals?: GoalDefinition[];
  /** TD-132 — total Pool A AI budget; overrides AppConfig.budgets.aiCalls. */
  aiBudget?: number;
  /** TD-131 — run the crawl browser headed (default headless). */
  headed?: boolean;
}

export interface CrawlResult {
  appName: string;
  workspaceRoot: string;
  pagesDiscovered: number;
  testsGenerated: number;   // always 0 today — generation is a separate stage (see run())
  dryRun: boolean;
}

export class CrawlRunner {
  async run(options: CrawlRunnerOptions): Promise<CrawlResult> {
    // 1. Resolve the workspace (auto-init happens inside on first write).
    const workspace = options.workspace ?? createWorkspace()

    // 1b. TD-114: scope the DB singleton to THIS project (.forge/forge.db) and
    //     run lazy migrations — BEFORE anything downstream can touch getDb()
    //     (a first touch at the legacy cwd default would lock the singleton
    //     there and make initDb throw). All 16 repositories then transparently
    //     use the per-app DB. NOTE: this runs before the dry-run gate, so a
    //     --dry-run creates .forge/forge.db (infrastructure, not an artifact);
    //     pre-TD-114 dry-runs created ./forge-framework.db in the cwd instead.
    await openProjectDatabase(workspace)

    // 2. Load config; null means "never bootstrapped here" — NOT an error.
    let config = await workspace.loadConfig()

    // 3. Zero-friction auto-bootstrap: no config, or an explicit --force.
    if (!config || options.force) {
      console.log(
        config
          ? '[CrawlRunner] --force: re-running Bootstrap over the existing config.'
          : '[CrawlRunner] No config found — running Bootstrap first.',
      )
      const bootstrapped = await this.bootstrap(workspace, options)
      if (bootstrapped === null) {
        // --dry-run: Bootstrap previewed (synthesized goals already logged by the
        // agent phase); nothing was written, nothing crawls.
        console.log('[CrawlRunner] --dry-run: bootstrap previewed, nothing written, no crawl.')
        return {
          appName: options.appName ?? '(dry-run)', workspaceRoot: workspace.root,
          pagesDiscovered: 0, testsGenerated: 0, dryRun: true,
        }
      }
      config = bootstrapped
    }

    // 3b. TD-114: project.json — the canonical Project handshake. createdAt is
    //     written once and preserved forever; lastOpenedAt updates on EVERY
    //     open; databaseVersion records the migration count of this open.
    //     (After the dry-run gate on purpose: dry-runs write no artifacts.)
    const existingManifest = await workspace.loadProjectManifest()
    await workspace.saveProjectManifest(buildProjectManifest(existingManifest, {
      appName:         config.appName,
      url:             options.url,
      databaseVersion: await getMigrationCount(),
    }))

    // Zero-friction credentials: secrets given on the command line are injected
    // into THIS process's env under the config's envKey (the exact place
    // AuthManager.resolveCredentials reads, 'user:pass' format) — in-process
    // only, NEVER persisted. Without this, `forge crawl --username --password`
    // would bootstrap fine and then crawl unauthenticated.
    if (options.username && options.password && config.credentials?.envKey) {
      process.env[config.credentials.envKey] = `${options.username}:${options.password}`
      console.log(`[CrawlRunner] Credentials injected in-process under env key '${config.credentials.envKey}' (never persisted).`)
    }

    // 4. Convert to the rich config the existing pipeline consumes.
    const onboardingConfig = toOnboardingConfig(config)

    // TD-132: size Pool A (naming) to the page cap — the thing that actually
    // drives naming demand (~2 batches/page) — capped at the user's budget.
    // effectiveBudget = min(userBudget, max(MIN_AI_BUDGET, maxPages × 2)).
    // Injected into onboardingConfig.budgets.aiCalls so Crawler (Pool A) picks
    // it up. Pool B (buildClassificationBudget) reads DEFAULT_CLASSIFICATION_BUDGET
    // instead — NOT this field — so it stays 50 ("Pool B untouched", ruling B).
    const maxPages   = config.budgets?.maxPages ?? 50
    const userBudget = options.aiBudget ?? config.budgets?.aiCalls ?? DEFAULT_AI_BUDGET
    const effectiveBudget = effectiveAiBudget(userBudget, maxPages)
    // toOnboardingConfig always produces a full budgets object (maxPages/maxDepth/aiCalls).
    onboardingConfig.budgets = { ...onboardingConfig.budgets!, aiCalls: effectiveBudget }
    console.log(
      `[CrawlRunner] AI budget: ${effectiveBudget} calls ` +
      `(maxPages: ${maxPages}, user limit: ${userBudget})`
    )
    const runId = generateRunId()

    // 5. Dispatch: agent path or the mechanical crawl.
    if (options.agent) {
      const runner = new AgentRunner({
        config:     onboardingConfig,
        goals:      options.goals ?? [],
        mode:       options.mode ?? 'supervised',
        mission:    Missions.crawl(),
        repository: new WorkspaceMemoryRepository(workspace),   // memory → .forge/agent-memory.json
      })
      const session = await runner.run()
      // Agent memory was persisted by AgentRunner through the workspace-backed
      // repository above — that IS this run's workspace.saveMemory() call.
      await workspace.saveReport(runId, 'agent-session', {
        sessionId: session.id, appName: config.appName, url: config.url,
        mode: session.mode, goals: session.goals.map(g => ({ id: g.id, status: g.status, origin: g.origin })),
        limitations: session.limitations,
      })
      console.log(`[CrawlRunner] Agent session ${session.id} complete — report: reports/${runId}/agent-session.json`)
      return {
        appName: config.appName, workspaceRoot: workspace.root,
        pagesDiscovered: 0, testsGenerated: 0, dryRun: false,
      }
    }

    // TD-121: workspace-derived artifact placement — the model is visible
    // output (workspace root), session tokens are secrets (.forge/auth/).
    // Both runtime-resolved from the workspace; Crawler still never sees
    // the Workspace itself (path-scoping, Option A).
    const crawler = new Crawler(onboardingConfig, {
      modelsDir:    path.join(workspace.root, 'models'),
      authStateDir: path.join(workspace.forgeDir, 'auth'),
      headed:       options.headed ?? false,   // TD-131: headless unless --headed
    })
    const model   = await crawler.crawl()

    // 6. TD-112: enrichment — the pipeline classifies every page (rule pass)
    //    then AI-classifies the unknown residue, budget-gated, BEFORE the
    //    model is persisted. One crawl = one immutable, fully-enriched
    //    snapshot (Nova ruling). Classification budget is a SEPARATE pool
    //    from the crawl's internal tracker (Step-0 finding D) — fresh limit,
    //    runId/appName bound for ai_usage attribution.
    // TD-132 (ruling B): Pool B is decoupled from Pool A's dynamic aiCalls —
    // it uses its own constant so the Pool-A sizing above never resizes it.
    const classificationBudget = this.buildClassificationBudget(
      DEFAULT_CLASSIFICATION_BUDGET, runId, config.appName,
    )
    await new ModelEnrichmentPipeline()
      .addStage(new ModuleClassifierStage())
      .addStage(new AiResidueStage())
      .run(model, { runId, appName: config.appName, budgetTracker: classificationBudget })

    const pages = model.pages ?? []
    const unassigned = pages.filter(p => p.module?.confidence === 'unknown').map(p => p.id)
    if (pages.length > 0) {
      console.log(
        `[CrawlRunner] Module classification: ${pages.length - unassigned.length}/${pages.length} page(s) assigned` +
        (unassigned.length > 0 ? `, ${unassigned.length} unknown (honest)` : ''),
      )
    }

    // 7. TD-122: persist — the pre-TD-122 Crawler.saveModel triple effect,
    //    relocated to the single persistence owner (ruling B):
    //    file write → schema validation → DB upsert.
    await workspace.saveModel(config.appName, model)
    const modelPath = path.join(workspace.root, 'models', config.appName, 'app-model.json')
    const { valid, errors } = validateAppModel(modelPath)
    if (!valid) {
      console.error('[CrawlRunner] Model validation failed:')
      errors.forEach(e => console.error(' ', e))
    } else {
      console.log('[CrawlRunner] Model validated successfully')
    }
    try {
      await new AppModelRepository().upsert(model)
      console.log('[CrawlRunner] Model persisted to DB')
    } catch (e) {
      console.warn('[CrawlRunner] DB persist failed (non-fatal):', e)
    }

    // 7b. TD-013 Phase 3 (Block 3) — post-crawl goal auto-discovery. SUPPLEMENT with
    //     precedence (hand-authored config OVERRIDES). Reads the COMMITTED model back via
    //     workspace.loadModel (the audit-honest round-trip — NOT the in-memory object), then
    //     persists a synthesized-goals envelope for a LATER run. ADDITIVE: writes an
    //     artifact only; it does NOT alter THIS run's execution (consumer is a re-run).
    try {
      const committed = await workspace.loadModel(config.appName) as unknown as AppModel | null
      if (committed) {
        await synthesizeAndPersistGoals(config.appName, committed, workspace)
      }
    } catch (e) {
      // Explicit, never silent (Rule 2): auto-discovery is best-effort and must never
      // fail the crawl — the model is already committed. Log and continue.
      console.warn('[CrawlRunner] Goal auto-discovery failed (non-fatal):', e)
    }

    // Run summary — module assignments now read straight off the persisted model.
    const pagesDiscovered = model.pages?.length ?? model.endpoints?.length ?? 0
    await workspace.saveReport(runId, 'crawl-summary', {
      runId, appName: config.appName, url: config.url,
      crawlMode: onboardingConfig.crawlMode,
      pagesDiscovered,
      classificationRunId: model.classificationRunId,
      moduleAssignments: pages.map(p => ({ pageId: p.id, urlPattern: p.urlPattern, module: p.module })),
      unassignedPages: unassigned,
    })
    console.log(`[CrawlRunner] Crawl complete — ${pagesDiscovered} page(s), report: reports/${runId}/crawl-summary.json`)

    // 8. Summary for the caller.
    return {
      appName: config.appName, workspaceRoot: workspace.root,
      pagesDiscovered,
      testsGenerated: 0,   // generation (GeneratorRunner) is a separate pipeline stage, not run here
      dryRun: false,
    }
  }

  /**
   * Run Bootstrap and persist its artifacts through the workspace.
   * Returns the fresh AppConfig, or null when --dry-run previewed only.
   */
  private async bootstrap(workspace: Workspace, options: CrawlRunnerOptions): Promise<AppConfig | null> {
    const bootstrapOptions: BootstrapOptions = {
      url:          options.url,
      // Single command-line credential pair → one role, id 'user' (envKey
      // USER_CREDENTIALS). Multi-role stays a .ts-fixture / schema-v2 concern.
      credentials:  options.username && options.password
        ? [{ role: 'user', username: options.username, password: options.password }]
        : [],
      nameOverride: options.appName,
      dryRun:       options.dryRun,
      force:        options.force,
      // TD-115: bootstrap agent memory persists into THIS workspace
      // (.forge/agent-memory.json), never into the FORGE repo.
      repository:   new WorkspaceMemoryRepository(workspace),
    }

    const bootstrap = new Bootstrap()
    const detection = await bootstrap.detect(bootstrapOptions)
    const artifacts = bootstrap.generateConfig(detection, bootstrapOptions, '.forge/config.json')

    if (artifacts.dryRun) return null

    await workspace.saveConfig(artifacts.config)
    if (artifacts.evidence) {
      await workspace.saveBootstrapEvidence(artifacts.evidence)
      artifacts.manifest.evidencePackagePath = '.forge/bootstrap-evidence.json'
    }
    await workspace.saveBootstrapManifest(artifacts.manifest)
    console.log(`[CrawlRunner] Bootstrap complete — config: .forge/config.json (app: ${artifacts.config.appName})`)
    return artifacts.config
  }

  /** Rule-based module pass over every discovered page; mutates page.module. */
  /**
   * TD-112 (finding D): the CLASSIFICATION budget — a fresh AiBudgetTracker
   * pool, independent of the crawl's internal tracker (which is private to
   * Crawler and whose WITHIN-BUDGET/DEGRADED banner has already printed).
   * Same shape Crawler's ctor builds; runId/appName bound for attribution.
   */
  private buildClassificationBudget(limit: number, runId: string, appName: string): AiBudgetTracker {
    const tracker = { remaining: limit }
    return {
      runId,
      appName,
      get remaining() { return tracker.remaining },
      consume(n: number) {
        if (tracker.remaining <= 0) return false
        tracker.remaining -= n
        return true
      },
      isExhausted() { return tracker.remaining <= 0 },
    }
  }
}
