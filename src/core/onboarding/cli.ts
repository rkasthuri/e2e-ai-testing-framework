#!/usr/bin/env tsx
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

import * as fs   from 'fs'
import * as path from 'path'
import { runMigrations }      from '../storage/migrate'
import { Crawler }            from './Crawler'
import { GeneratorRunner }    from './GeneratorRunner'
import { VerificationRunner } from './VerificationRunner'
import { CrawlRunner }        from '../runner/CrawlRunner'
import { createWorkspace }    from '../workspace/WorkspaceManager'
import { openProjectDatabase } from '../storage/DatabaseFactory'
import { AppModelService, requireProjectedCommit } from '../storage/AppModelService'
import { generateRunId } from './Bootstrap'
import { getDb, initDb }      from '../storage/db'
import { migrateDiskModels, migrateDbBlobs, UnmigratableModelError } from './ModelMigrator'
import { AgentRunner } from '../agent/AgentRunner'
import { JsonAgentMemoryRepository } from '../agent/AgentMemoryRepository'
import { GoalDefinition } from '../agent/AgentPlanner'
import { AgentMode } from '../agent/types'
import { resolveGoalDefinitions } from './goalResolution'

async function resolveConfig(appName: string): Promise<any> {
  // Search for app-specific config under src/apps/**/
  const appsDir = path.resolve('src/apps')

  function findConfig(dir: string): string | null {
    if (!fs.existsSync(dir)) return null
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = findConfig(path.join(dir, entry.name))
        if (found) return found
      } else if (entry.name === `onboarding.${appName}.config.ts`) {
        return path.join(dir, entry.name)
      }
    }
    return null
  }
  const appConfigPath = findConfig(appsDir)

  if (appConfigPath) {
    console.log(`[CLI] Loading config: ${appConfigPath}`)
    const configUrl = new URL(
      `file://${appConfigPath.replace(/\\/g, '/')}`
    )
    const { default: config } = await import(configUrl.href)
    return config
  }
  // Fall back to project root onboarding.config.ts
  console.log(`[CLI] No app config found for "${appName}" \u2014 using root onboarding.config.ts`)
  const rootConfigPath = path.resolve('onboarding.config.ts')
  const rootConfigUrl  = new URL(
    `file://${rootConfigPath.replace(/\\/g, '/')}`
  )
  const { default: config } = await import(rootConfigUrl.href)
  return config
}

/**
 * TD-013 Agent Mode — find + import the hand-authored goal config for an app
 * (goals.<appName>.config.ts under src/apps/**), mirroring resolveConfig's search.
 * Missing goals is a warning, not a crash — the agent runs with an empty goal set.
 */
async function loadGoalDefinitions(appName: string): Promise<GoalDefinition[]> {
  // TD-013 P3 Block 3: precedence-based resolution — hand-authored config >
  // synthesized-goals.json > empty. The find()+import logic moved to goalResolution
  // (shared with CrawlRunner's post-crawl write, so the channel isn't orphaned).
  return resolveGoalDefinitions(appName)
}

async function main() {
  const command = process.argv[2]
  const args    = process.argv.slice(3)

  const getArg = (flag: string): string | undefined =>
    args.find(a => a.startsWith(`--${flag}=`))
      ?.split('=').slice(1).join('=')

  // TD-108: standalone crawl is selected by --url (app name derived from the
  // URL or --name). TD-121: standalone generate is selected by the ABSENCE of
  // --app (app name derived from the workspace config — it errors with its own
  // message when no workspace exists). Every other path still requires --app.
  const standaloneUrl = getArg('url')
  const appName = getArg('app') || process.env.APP_NAME || ''
  if (!appName && !(command === 'crawl' && standaloneUrl) && command !== 'generate' && command !== 'ui'
      && command !== 'migrate'
      && command !== 'help' && command !== '--help' && command !== '-h' && command !== undefined) {
    console.error('[CLI] --app is required (or --url=<url> for a standalone crawl). Example: npm run onboard -- --app=myapp')
    process.exit(1)
  }

  switch (command) {
    case 'crawl': {
      // TD-108 Standalone Mode — `forge crawl --url=<url>`: zero-friction,
      // workspace-based (.forge/ in the user's cwd), auto-bootstraps when no
      // config exists. ALL orchestration lives in CrawlRunner — this block only
      // parses args and prints the result.
      if (standaloneUrl) {
        // TD-132: --ai-budget=N overrides the total Pool A AI budget for large apps.
        // Reject non-positive/garbage loudly rather than poisoning the budget with NaN (Rule 5).
        const aiBudgetArg = getArg('ai-budget')
        let aiBudget: number | undefined
        if (aiBudgetArg !== undefined) {
          const parsed = parseInt(aiBudgetArg, 10)
          if (Number.isNaN(parsed) || parsed <= 0) {
            console.warn(`[CLI] Ignoring invalid --ai-budget='${aiBudgetArg}' (must be a positive integer).`)
          } else {
            aiBudget = parsed
          }
        }
        const result = await new CrawlRunner().run({
          url:      standaloneUrl,
          appName:  getArg('name') || appName || undefined,
          username: getArg('username'),
          password: getArg('password'),
          // Safe default preserved: supervised unless --autonomous is explicit
          // (the brief's sketch inverted this — flagged and kept safe).
          mode:     args.includes('--autonomous') ? 'autonomous' : 'supervised',
          dryRun:   args.includes('--dry-run'),
          force:    args.includes('--force'),
          agent:    args.includes('--agent'),
          aiBudget,
          headed:   args.includes('--headed'),   // TD-131: default headless
          operationId: getArg('operation-id'),
        })
        console.log(
          result.dryRun
            ? `\n[CLI] Dry-run complete — nothing written | workspace: ${result.workspaceRoot}`
            : `\n[CLI] Crawl complete — ${result.pagesDiscovered} page(s) | app: ${result.appName} | workspace: ${result.workspaceRoot}`,
        )
        break
      }

      // Internal Fixture Mode (regression assets — SauceDemo/OrangeHRM/Restful
      // Booker): `--app=<name>` crawls the hand-curated onboarding.<app>.config.ts
      // exactly as before TD-108. Deliberately NOT routed through CrawlRunner:
      // the rich .ts configs (multi-role, flows, prerequisites) are not
      // representable in AppConfig v1, and these fixtures are pinned as-is.
      await runMigrations()
      const config  = await resolveConfig(appName)

      // TD-013 Agent Mode — run the goal-directed AgentPlanner against a live
      // ExecutionEnvironment (selected by appType) instead of the mechanical crawl.
      // Intercepts AFTER config load (it needs the config); --supervised is the
      // safe default so a user who forgets the flag gets the interactive mode.
      if (args.includes('--agent')) {
        const mode: AgentMode = args.includes('--autonomous') ? 'autonomous' : 'supervised'
        const goals   = await loadGoalDefinitions(appName)
        const runner  = new AgentRunner({ config, goals, mode, repository: new JsonAgentMemoryRepository() })
        const session = await runner.run()
        console.log(`\n[Agent] Session ${session.id} complete.`)
        process.exit(0)
      }

      const fixtureWorkspace = createWorkspace()
      const appModels = new AppModelService()
      const previousModel = await appModels.findActive(appName)
      const crawler = new Crawler(config, { previousModel })
      const candidate = await crawler.crawl()
      const fixtureOperationId = getArg('operation-id') ?? generateRunId()
      const model = requireProjectedCommit(await appModels.commitAndProject(
        candidate,
        fixtureOperationId,
        snapshot => fixtureWorkspace.saveModelProjection(appName, snapshot),
      )).committed.snapshot
      const count = model.endpoints?.length ?? model.pages?.length ?? 0
      const unit  = (model.endpoints?.length ?? 0) > 0 ? 'endpoints' : 'pages'
      console.log(`\n[CLI] Crawl complete \u2014 ${count} ${unit} discovered`)
      console.log(`[CLI] Compatibility projection: models/${model.app.name}/app-model.json`)
      console.log(`[CLI] Next:   npm run onboard:verify -- --app=${model.app.name}`)
      break
    }

    case 'verify': {
      const config = await resolveConfig(appName)
      const runner = new VerificationRunner(
        appName,
        config,
        createWorkspace(),
        undefined,
        getArg('operation-id'),
      )
      await runner.run()
      break
    }

    case 'generate': {
      // TD-121 Standalone Mode — `forge generate` (no --app): app name comes
      // from the workspace config in the current directory; generated tests
      // land in tests/<module>/ via the Workspace.
      if (!appName) {
        const ws  = createWorkspace()
        const cfg = await ws.loadConfig()
        if (!cfg) {
          console.error('[FORGE] No project found in this directory. Run forge crawl first.')
          process.exit(1)
        }
        initDb(ws.dbPath())
        await new GeneratorRunner().generate(cfg.appName, ws)
        console.log(`[FORGE] Tests written to ${ws.testsDir}`)
        break
      }

      // Internal Fixture Mode — `--app=<name>`: unchanged (src/apps/ targeting).
      const runner = new GeneratorRunner()
      await runner.generate(appName)
      break
    }

    case 'refresh': {
      await runMigrations()
      const config = await resolveConfig(appName)
      const workspace = createWorkspace()
      const appModels = new AppModelService()
      const previousModel = await appModels.findActive(appName)
      const crawler = new Crawler(config, { previousModel })
      const candidate = await crawler.crawl()
      requireProjectedCommit(await appModels.commitAndProject(
        candidate,
        getArg('operation-id') ?? generateRunId(),
        snapshot => workspace.saveModelProjection(appName, snapshot),
      ))
      break
    }

    case 'ui': {
      const portArg = getArg('port')
      const requestedPort = portArg ? parseInt(portArg, 10) : 3000
      console.log('[FORGE] Starting UI...')
      // Variable path → root tsc does not pull forge-ui (ESM) into the engine
      // compile; resolved at runtime (tsx). This is the ONE sanctioned
      // engine→forge-ui edge (ruling H); never import forge-ui statically.
      const uiServerPath = '../../../forge-ui/server/index'
      const { startServer } = (await import(uiServerPath)) as { startServer: (p?: number) => Promise<number> }
      const actualPort = await startServer(requestedPort)
      const url = `http://127.0.0.1:${actualPort}`
      // Ruling B: open the browser via platform exec — no 'open' dependency.
      const { exec } = await import('child_process')
      const opener = process.platform === 'win32' ? `start "" "${url}"`
        : process.platform === 'darwin' ? `open "${url}"`
        : `xdg-open "${url}"`
      exec(opener)
      console.log(`[FORGE] UI available at ${url} — press Ctrl-C to stop.`)
      // Keep the process alive. startServer() resolves after binding (so we can
      // open the browser at the actual port), but main() ends with
      // process.exit(0) — which would tear the server down. This never-resolving
      // await parks here; the listening server keeps serving until SIGINT/SIGTERM
      // (handled inside startServer) exits the process.
      await new Promise<void>(() => {})
      break
    }

    case 'migrate': {
      // TD-UI-031 Block 3 — upgrade on-disk models + DB blobs from schema 1.0 → 2.0.
      // Idempotent, backs up each model (<file>.pre-v2.bak) + the DB file, and
      // REFUSES (throws) on any shape it cannot faithfully migrate.
      const workspace = createWorkspace()
      await openProjectDatabase(workspace)   // applies migration 013 (evidence_state column, nullable crawled_at)

      const modelsDir = path.join(workspace.root, 'models')
      // Back up the DB file before mutating blobs (the model files back up per-file).
      let dbBackup: string | null = null
      try {
        const dbPath = workspace.dbPath()
        if (fs.existsSync(dbPath)) { dbBackup = `${dbPath}.pre-v2.bak`; fs.copyFileSync(dbPath, dbBackup) }
      } catch { /* dbPath optional on some workspaces */ }

      try {
        const disk = migrateDiskModels(modelsDir)
        const db   = await migrateDbBlobs(getDb())
        console.log('[migrate] Disk models:')
        for (const r of disk) {
          console.log(`  ${r.changed ? 'migrated' : 'up-to-date'}  ${path.relative(workspace.root, r.file)}  → evidenceState: ${r.evidenceState}`)
        }
        console.log(`[migrate] DB app_models: ${db.migrated} migrated, ${db.skipped} already v2 (of ${db.total}).`)
        if (dbBackup) console.log(`[migrate] DB backup: ${path.relative(workspace.root, dbBackup)}`)
        console.log('[migrate] Done.')
      } catch (e) {
        if (e instanceof UnmigratableModelError) {
          console.error(`[migrate] ABORTED — ${e.message}`)
          process.exit(1)
        }
        throw e
      }
      break
    }

    default:
      console.log(`
FORGE \u2014 Onboarding CLI

Commands:
  npm run onboard              Crawl app and produce App Model
  npm run onboard:verify       Verify App Model against live app
  npm run onboard:generate     Generate POMs, fixtures, and specs
  npm run onboard:refresh      Re-crawl and update App Model
  forge migrate                Upgrade on-disk models + DB blobs to schema 2.0
                               (TD-UI-031; idempotent, backs up to *.pre-v2.bak,
                               refuses any model it cannot faithfully migrate)

Options:
  --app=<name>     App name (required, except with --url). Also reads APP_NAME.

Standalone Mode (TD-108) — zero-friction crawl of any URL:
  forge crawl --url=<url> [--username=<user> --password=<pass>] \\
    [--name=<appName>] [--dry-run] [--force] [--ai-budget=<N>] [--headed] [--agent [--autonomous]]
  --ai-budget=<N>  Total AI call budget for this crawl (default: 150; raise for
                   large apps that exhaust naming budget — see DEGRADED status).
  --headed         Run the browser headed/visible (default: headless — FORGE is
                   invisible). Use for anti-bot sites or visual debugging.
  Auto-bootstraps when no .forge/config.json exists in the current directory,
  then crawls. Artifacts land in the workspace: .forge/ (config, manifest,
  evidence, agent memory), reports/<run-id>/ (run reports), tests/<module>/.
  Credentials are injected in-process for the crawl and NEVER persisted;
  the config stores only a credentialsEnvKey pointer.
  --force re-runs Bootstrap over an existing config.

Platform UI:
  forge ui              Start the FORGE Platform UI
  forge ui --port=3002  Use a specific port (default: auto-detect from 3000,
                        skipping 3001 which is reserved for platform-server)

Agent Mode (TD-013) — goal-directed crawl via the AgentPlanner:
  npm run onboard -- --app=<name> --agent [--autonomous]
  Runs goals.<app>.config.ts against a live ExecutionEnvironment (selected by
  appType). Default is --supervised (interactive decisions); --autonomous logs
  only. Requires a goals.<app>.config.ts (else runs with no goals + a warning).
      `)
  }

  process.exit(0)
}

main().catch(e => {
  console.error('[CLI] Fatal error:', e)
  process.exit(1)
})
