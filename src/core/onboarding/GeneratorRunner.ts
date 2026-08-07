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
import * as fs   from 'fs'
import * as os   from 'os'
import { createHash } from 'crypto'
import { performance } from 'perf_hooks'
import { modelHasContent } from './ModelValidator'
import { PomGenerator }     from './generators/PomGenerator'
import { FixtureGenerator } from './generators/FixtureGenerator'
import { SpecGenerator }    from './generators/SpecGenerator'
import { toClassName }      from './generators/EmitHelper'
import { AppModel, OnboardingConfig } from './types'
import { EmptyModelError } from '../errors/OperatorFacingError'
import {
  GenerationManifest,
  GenerationFile,
  GenerationFlow,
  GenerationPage,
  GenerationFileType,
  GENERATION_SCHEMA_VERSION,
} from './GenerationManifest'
import { pathToFileURL }   from 'url'
import { Workspace } from '../workspace/WorkspaceManager'
import { toOnboardingConfig } from '../workspace/ConfigAdapter'
import { AppModelService } from '../storage/AppModelService'

export class GeneratorRunner {

  constructor(private readonly appModels = new AppModelService()) {}

  private findAppDir(appName: string): string {
    const appsDir = path.resolve('src/apps')
    const search  = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (entry.name === appName) return path.join(dir, entry.name)
        const found = search(path.join(dir, entry.name))
        if (found) return found
      }
      return null
    }
    return search(appsDir) || path.resolve(`src/apps/${appName}`)
  }

  async generate(appName: string, workspace?: Workspace): Promise<GenerationManifest | void> {
    // TD-121 Standalone Mode — route generated output through the Workspace
    // (tests/<module>/) instead of the fixture src/apps/ tree.
    // TD-UI-003 Block 2: the workspace branch returns a GenerationManifest; the
    // legacy fixture branch below stays Promise<void> (unchanged) for now.
    if (workspace) {
      return this.generateIntoWorkspace(appName, workspace)
    }

    console.log(`[GeneratorRunner] Loading SQLite App Model for: ${appName}`)
    const model = await this.appModels.requireActive(appName)

    // Load onboarding config so generators can use per-role loginUrl/successUrl
    let config: OnboardingConfig | undefined
    try {
      const appsDir = path.resolve('src/apps')
      const findCfg = (dir: string): string | null => {
        if (!fs.existsSync(dir)) return null
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) { const f = findCfg(path.join(dir, e.name)); if (f) return f }
          else if (e.name === `onboarding.${appName}.config.ts`) return path.join(dir, e.name)
        }
        return null
      }
      const cfgPath = findCfg(appsDir) ?? path.resolve('onboarding.config.ts')
      const { default: cfg } = await import(pathToFileURL(cfgPath).href)
      config = cfg as OnboardingConfig
    } catch (err) {
      console.warn(
        `[GeneratorRunner] Failed to load onboarding config for "${appName}" — ` +
        `successUrl/loginUrl resolution will fall back to defaults for every role:`,
        err,
      )
    }

    const appDir    = this.findAppDir(appName)
    const outputDir = path.join(appDir, 'generated')
    const isApiApp  = (model.app.appType === 'rest-api' || model.app.appType === 'graphql-api')
    fs.mkdirSync(outputDir, { recursive: true })
    if (!isApiApp) {
      fs.mkdirSync(path.join(outputDir, 'pages'), { recursive: true })
      fs.mkdirSync(path.join(outputDir, 'specs'), { recursive: true })
    }

    console.log(`[GeneratorRunner] Output directory: ${outputDir}`)
    console.log(`[GeneratorRunner] Pages:     ${model.pages?.length ?? 0}`)
    console.log(`[GeneratorRunner] Endpoints: ${model.endpoints?.length ?? 0}`)
    console.log(`[GeneratorRunner] Roles:     ${model.roles.length}`)
    console.log(`[GeneratorRunner] Flows:     ${model.flows?.length ?? 0}`)

    const pomGen     = new PomGenerator(model)
    const fixtureGen = new FixtureGenerator(model, config)
    const specGen    = new SpecGenerator(model)

    pomGen.generate(outputDir)
    fixtureGen.generate(outputDir)
    specGen.generate(outputDir)

    console.log(`\n[GeneratorRunner] Generation complete`)
    console.log(`[GeneratorRunner] Review output at: ${outputDir}`)
    console.log(`[GeneratorRunner] Run verify:  npm run onboard:verify -- --app=${appName}`)
  }

  /**
   * TD-121 Standalone Mode — generate into the workspace's tests/ tree.
   *
   * The three generators write files themselves (generate(outputDir)) and are
   * deliberately UNTOUCHED, so this path stages into a throwaway temp dir and
   * then routes every staged file through the Workspace with a mapping that
   * preserves the generated tree's relative imports exactly:
   *   specs/<file>  → tests/<module>/<file>   ('../pages/X', '../fixtures.generated' still resolve)
   *   pages/<file>  → tests/pages/<file>
   *   <root files>  → tests/<file>            (fixtures.generated.ts; API apps' './X' imports preserved)
   *
   * TD-112: the persisted model carries module assignments (classified by the
   * ModelEnrichmentPipeline at crawl time, pre-persistence) — this method is a
   * READ-ONLY consumer and never re-classifies (Nova ruling); pages without a
   * module (pre-TD-112 models) fall back to 'general' with a warning.
   * No src/apps/ search on this path.
   */
  private async generateIntoWorkspace(appName: string, workspace: Workspace): Promise<GenerationManifest> {
    console.log(`[GeneratorRunner] Loading SQLite App Model for: ${appName}`)
    const model = await this.appModels.requireActive(appName)
    // TC-04 (2026-07-13): an authoritative SQLite snapshot can be empty — onboard's bootstrap
    // persists a contentless model (0 pages/flows/endpoints) with crawledAt set.
    // The repository existence check cannot catch that; refuse explicitly rather than
    // "generating" a lone fixtures file for an app FORGE never explored.
    if (!modelHasContent(model)) {
      throw new EmptyModelError(appName, {
        evidenceState: model.app.evidenceState,
        diagnostics:   model.app.crawlMetadata?.crawlDiagnostics ?? null,
      })
    }

    // TIMING (Finn's precision flag): start AFTER the model load so the duration
    // measures generation only — never model I/O, job-queue, or ExecutionContext
    // overhead. The delta is captured immediately before the manifest is built.
    const startedAt = performance.now()

    // TD-112 (Nova ruling): GeneratorRunner is a READ-ONLY consumer of module
    // assignments — the ModelEnrichmentPipeline classified every page at crawl
    // time, pre-persistence. NEVER re-classify here: a missing module is an
    // upstream signal (model predates TD-112), surfaced with a warn + 'general'
    // fallback, not silently recomputed.
    for (const page of model.pages ?? []) {
      if (!page.module) {
        console.warn(
          `[GeneratorRunner] Page ${page.id} has no module assignment — ` +
          `placing in "general". Re-crawl to classify.`,
        )
      }
    }
    const moduleOfFlow = (flowId: string): string => {
      const flow = model.flows?.find(f => f.id === flowId)
      // Anchor on the flow's FIRST step's page (FlowDefinition has no start-page
      // field of its own — steps[].pageId is the real signal).
      const firstPageId = flow?.steps?.[0]?.pageId
      const page = firstPageId ? model.pages?.find(p => p.id === firstPageId) : undefined
      const name = page?.module?.name
      return name && page?.module?.confidence !== 'unknown' ? name : 'general'
    }

    // Config for per-role loginUrl/successUrl: adapt the workspace AppConfig
    // (no onboarding.<app>.config.ts exists in a workspace — don't search src/apps/).
    let config: OnboardingConfig | undefined
    const appConfig = await workspace.loadConfig()
    if (appConfig) config = toOnboardingConfig(appConfig)

    // Reverse map: POM filename -> pageId. PomGenerator names each POM
    // `${toClassName(page.id)}.generated.ts` (PomGenerator.ts:39), so this is the
    // deterministic, honest inverse — no guessing a pageId from the class name.
    const pomFileToPageId = new Map<string, string>()
    for (const page of model.pages ?? []) {
      pomFileToPageId.set(`${toClassName(page.id)}.generated.ts`, page.id)
    }

    // Portable relative path from workspace root (forward slashes), so the
    // manifest never carries an absolute or OS-specific path (Finn's flag).
    const relFromRoot = (abs: string): string =>
      path.relative(workspace.root, abs).split(path.sep).join('/')

    // Stable, deterministic file ID: SHA-256 of the FORWARD-SLASH-NORMALIZED
    // relativePath (relFromRoot already normalizes), so an ID minted on Windows
    // resolves identically on POSIX. The ID — never a path — is the client handle.
    const fileId = (rel: string): string => createHash('sha256').update(rel).digest('hex')

    // Collected as each file is actually written — the manifest describes real
    // output, never a prediction. reason is 'new-flow' for every file in Block 2:
    // real regenerated/unchanged detection needs the PREVIOUS manifest as a
    // baseline, which is Phase 2 Diff View work. We do NOT fake it here.
    const files: GenerationFile[] = []

    // Stage into a temp dir, then route through the workspace.
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gen-'))
    try {
      const isApiApp = (model.app.appType === 'rest-api' || model.app.appType === 'graphql-api')
      if (!isApiApp) {
        fs.mkdirSync(path.join(staging, 'pages'), { recursive: true })
        fs.mkdirSync(path.join(staging, 'specs'), { recursive: true })
      }

      new PomGenerator(model).generate(staging)
      new FixtureGenerator(model, config).generate(staging)
      const specGen = new SpecGenerator(model)   // TD-140: keep the instance to read its refusal tally
      specGen.generate(staging)

      // Root files (fixtures.generated.ts; API apps: ApiClient + api spec) → tests/ root.
      for (const entry of fs.readdirSync(staging, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const name = entry.name
        await workspace.writeTestsFile(name, fs.readFileSync(path.join(staging, name), 'utf-8'))
        // Type derived from the generators' known root-file output contract.
        const type: GenerationFileType =
          name === 'fixtures.generated.ts'    ? 'fixture'    :
          name === 'ApiClient.ts'             ? 'api-client' :
          name.endsWith('.generated.spec.ts') ? 'api-spec'   :  // only API apps emit a spec at root
          (() => { throw new Error(`[GeneratorRunner] Unrecognized root generated file '${name}' — cannot classify for manifest (refusing to guess a type)`) })()
        const rel = relFromRoot(path.join(workspace.testsDir, name))
        files.push({ id: fileId(rel), relativePath: rel, type, reason: 'new-flow' })
      }
      // POMs → tests/pages/ (specs import them as '../pages/X').
      const pagesDir = path.join(staging, 'pages')
      if (fs.existsSync(pagesDir)) {
        for (const f of fs.readdirSync(pagesDir)) {
          await workspace.writeTests('pages', f, fs.readFileSync(path.join(pagesDir, f), 'utf-8'))
          const pageId = pomFileToPageId.get(f)
          if (!pageId) {
            console.warn(`[GeneratorRunner] POM file '${f}' maps to no page id — pageId omitted from manifest (not invented).`)
          }
          const rel = relFromRoot(path.join(workspace.testsDir, 'pages', f))
          files.push({ id: fileId(rel), relativePath: rel, type: 'pom', reason: 'new-flow', pageId })
        }
      }
      // Specs → tests/<module>/ via the flow's start page's module.
      const specsDir = path.join(staging, 'specs')
      if (fs.existsSync(specsDir)) {
        for (const f of fs.readdirSync(specsDir)) {
          const flowId = f.replace(/\.generated\.spec\.ts$/, '')
          const module = moduleOfFlow(flowId)
          await workspace.writeTests(module, f, fs.readFileSync(path.join(specsDir, f), 'utf-8'))
          const rel = relFromRoot(path.join(workspace.testsDir, module, f))
          files.push({ id: fileId(rel), relativePath: rel, type: 'spec', reason: 'new-flow', flowId })
        }
      }

      // ── Build manifest detail arrays from REAL model data + files actually written ──
      // flows[]: one per per-flow spec file that was written. Driving off the
      // written specs (not model.flows blindly) means auth-omitted flows — whose
      // spec is never emitted — are honestly absent, and every entry has a real
      // specFile. API apps write a single shared api.generated.spec.ts (no per-flow
      // spec), so flows[] is empty for them — see report-back.
      const specFileByFlowId = new Map<string, string>()
      for (const file of files) {
        if (file.type === 'spec' && file.flowId) specFileByFlowId.set(file.flowId, file.relativePath)
      }
      const flows: GenerationFlow[] = (model.flows ?? [])
        .filter(fl => specFileByFlowId.has(fl.id))
        .map(fl => ({
          id:                fl.id,
          displayName:       fl.displayName,
          confidence:        fl.confidence,
          source:            fl.source,
          groundingWarnings: fl.groundingWarnings ?? [],   // types.ts:274 optional → honest [] default
          specFile:          specFileByFlowId.get(fl.id)!,
        }))

      // pages[]: one per POM file written. url from PageDefinition.urlPattern
      // (the model has no plain `url` field — see report-back). moduleConfidence
      // is 'unknown' when unassigned — NEVER defaulted to 'high'.
      const pomFileByPageId = new Map<string, string>()
      for (const file of files) {
        if (file.type === 'pom' && file.pageId) pomFileByPageId.set(file.pageId, file.relativePath)
      }
      const pages: GenerationPage[] = (model.pages ?? [])
        .filter(p => pomFileByPageId.has(p.id))
        .map(p => ({
          id:               p.id,
          urlPattern:       p.urlPattern,
          moduleConfidence: p.module?.confidence ?? 'unknown',
          pomFile:          pomFileByPageId.get(p.id)!,
        }))

      // Counts + evidence breakdown — DERIVED from the arrays so they can never
      // disagree with the detail they summarise.
      const specCount    = files.filter(f => f.type === 'spec').length
      const pomCount     = files.filter(f => f.type === 'pom').length
      const fixtureCount = files.filter(f => f.type === 'fixture').length
      const observedFlows = flows.filter(f => f.confidence === 'observed').length
      const partialFlows  = flows.filter(f => f.confidence === 'partial').length
      const unknownFlows  = flows.filter(f => f.confidence === 'unknown').length

      // TD-140 refusal evidence — derived from the generator's structural tally (never by
      // parsing rendered specs). vacuous = zero executable statements → emitted as skip;
      // partial = ≥1 executable AND ≥1 omission; omittedStepCount counts flow-step omissions
      // once per flow (full-flow tests) so a step replayed into critical-elements prefixes is
      // not double-counted. refusals join the vacuous tests to their final module spec path.
      const tally    = specGen.getTestTally()
      const vacuous  = tally.filter(t => t.executableCount === 0)
      const refusals = vacuous.map(t => ({
        testId:          t.testId,
        specFile:        specFileByFlowId.get(t.flowId) ?? '(spec unmapped)',
        omissionReasons: t.omissionReasons,
      }))
      const vacuousTestCount = vacuous.length
      const partialTestCount = tally.filter(t => t.executableCount > 0 && t.omissionCount > 0).length
      const omittedStepCount = tally.filter(t => t.kind === 'full-flow').reduce((n, t) => n + t.omissionCount, 0)
      if (vacuousTestCount > 0) {
        console.log(`[GeneratorRunner] TD-140: ${vacuousTestCount} test(s) refused (zero executable statements) — emitted as skip: ${refusals.map(r => r.testId).join(', ')}`)
      }

      // Capture generation-only duration immediately before building the manifest.
      const durationMs = performance.now() - startedAt

      const manifest: GenerationManifest = {
        schemaVersion:    GENERATION_SCHEMA_VERSION,
        generatorVersion: this.readGeneratorVersion(),
        appName,
        generatedAt:      new Date().toISOString(),
        durationMs,
        // classificationRunId: the run that produced this model snapshot (set by
        // ModelEnrichmentPipeline at crawl time — types.ts:305). NOT a crawl run
        // id (see GenerationManifest comment). Omitted when absent — never invented.
        ...(model.classificationRunId ? { classificationRunId: model.classificationRunId } : {}),
        specCount,
        pomCount,
        fixtureCount,
        filesWritten: files.length,
        observedFlows,
        partialFlows,
        unknownFlows,
        vacuousTestCount,
        partialTestCount,
        omittedStepCount,
        flows,
        pages,
        files,
        refusals,
      }

      // Persist to <workspace>/.forge/generation-manifest.json BEFORE returning.
      // The Workspace owns the .forge write (mirrors saveBootstrapManifest); this
      // uses its own path accessors — no hardcoded paths here.
      await workspace.saveGenerationManifest(manifest)

      console.log(`\n[GeneratorRunner] Generation complete — ${files.length} file(s) written to ${workspace.testsDir}`)
      return manifest
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
  }

  /**
   * generatorVersion for the manifest — the repo package.json "version", located
   * RELATIVE to this module (src/core/onboarding/ → repo root), so there is no
   * hardcoded version string and no hardcoded absolute path. Throws (never
   * invents) if the version can't be read cleanly.
   */
  private readGeneratorVersion(): string {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    if (typeof pkg.version !== 'string') {
      throw new Error(`[GeneratorRunner] package.json at ${pkgPath} has no string "version" — cannot stamp manifest generatorVersion`)
    }
    return pkg.version
  }
}
