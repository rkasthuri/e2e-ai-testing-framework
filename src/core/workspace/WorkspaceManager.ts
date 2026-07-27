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
 * TD-108 — Workspace: FORGE's working state in the USER'S directory.
 *
 * FORGE is a standalone tool (locked product decision): a QE points it at any
 * external URL, and everything FORGE produces lands in the user's working
 * directory —
 *
 *   <root>/
 *     .forge/                 config.json, bootstrap-manifest.json,
 *                             bootstrap-evidence.json, agent-memory.json
 *     tests/<module>/         generated test files
 *     reports/<run-id>/       triage, verification, heal reports
 *
 * Nothing else in FORGE knows about these paths: components ask the Workspace
 * (saveConfig, saveBootstrapEvidence, writeTests, …) and the Workspace decides
 * where bytes go. Local disk today; S3/cloud later is an implementation detail
 * behind this interface (TD-113).
 *
 * Ownership rule (Nova): CrawlRunner is the ONLY caller of workspace.* —
 * Crawler and Bootstrap produce data; CrawlRunner persists it.
 *
 * PATHS: everything derives from `root` at runtime via path.join — no hardcoded
 * absolute paths (TD-097). `root` itself defaults to process.cwd() BY DESIGN:
 * unlike repo-internal artifacts (where TD-097 bans cwd-dependence), the user's
 * current directory IS the product-defined anchor of a workspace.
 */
import * as fs from 'fs'
import * as path from 'path'
import { AppConfig } from './AppConfig'
import { ProjectManifest } from './Project'
import { AppModel } from '../onboarding/types'
import { GenerationManifest } from '../onboarding/GenerationManifest'

export interface Workspace {
  // Paths (all runtime-derived — TD-097)
  root: string;           // user's working directory
  forgeDir: string;       // <root>/.forge/
  testsDir: string;       // <root>/tests/
  reportsDir: string;     // <root>/reports/

  // Per-app database location (TD-114) — the Workspace owns WHERE the DB
  // lives; DatabaseFactory owns initialization. One Project = one DB.
  dbPath(): string;

  // Project manifest (.forge/project.json — TD-114, projectVersion pattern)
  loadProjectManifest(): Promise<ProjectManifest | null>;
  saveProjectManifest(manifest: ProjectManifest): Promise<void>;

  // Config
  loadConfig(): Promise<AppConfig | null>;
  saveConfig(config: AppConfig): Promise<void>;

  // Bootstrap artifacts
  saveBootstrapManifest(manifest: unknown): Promise<void>;
  saveBootstrapEvidence(pkg: unknown): Promise<void>;

  // Generation manifest (TD-UI-003) — .forge/generation-manifest.json.
  // The producer (GeneratorRunner) describes its own output; the Workspace owns
  // the .forge write. Mirrors saveBootstrapManifest.
  saveGenerationManifest(manifest: GenerationManifest): Promise<void>;

  // Agent memory
  loadMemory(appName: string): Promise<unknown | null>;
  saveMemory(appName: string, memory: unknown): Promise<void>;

  // Generated tests
  writeTests(module: string, filename: string, content: string): Promise<void>;
  /**
   * Generated files that belong at the tests/ ROOT (no module segment) —
   * e.g. fixtures.generated.ts, which specs import as '../fixtures.generated'
   * from tests/<module>/ (TD-121 generator routing, finding D).
   */
  writeTestsFile(filename: string, content: string): Promise<void>;

  /**
   * TD-181 compatibility projection. The caller must supply the exact snapshot
   * returned by the SQLite commit. Runtime code never reads this file.
   */
  saveModelProjection(appName: string, model: AppModel): Promise<void>;

  /**
   * models/<app>/synthesized-goals.json — the auto-discovered goals envelope
   * (TD-013 P3 Block 3). Opaque JSON here (same contract as loadModel): the caller
   * owns the envelope shape. Missing → null; corrupt JSON → throw.
   */
  saveSynthesizedGoals(appName: string, envelope: unknown): Promise<void>;
  loadSynthesizedGoals(appName: string): Promise<unknown | null>;

  // Reports
  saveReport(runId: string, name: string, content: unknown): Promise<void>;
}

export class WorkspaceManager implements Workspace {
  readonly root: string
  readonly forgeDir: string
  readonly testsDir: string
  readonly reportsDir: string

  constructor(root: string = process.cwd()) {
    this.root       = path.resolve(root)
    this.forgeDir   = path.join(this.root, '.forge')
    this.testsDir   = path.join(this.root, 'tests')
    this.reportsDir = path.join(this.root, 'reports')
  }

  /**
   * Auto-init (locked product decision: no `forge init` required) — the three
   * workspace directories are created on first use; every operation below calls
   * this, so a fresh directory Just Works and an existing one is untouched
   * (mkdirSync recursive is idempotent).
   */
  private ensureDirs(): void {
    fs.mkdirSync(this.forgeDir,   { recursive: true })
    fs.mkdirSync(this.testsDir,   { recursive: true })
    fs.mkdirSync(this.reportsDir, { recursive: true })
  }

  /**
   * Guard a user-influenced path SEGMENT (module names, filenames, run ids):
   * reject separators and '..' so no caller can write outside the workspace.
   * Throws — never silently sanitizes (Rule 5).
   */
  private safeSegment(segment: string, what: string): string {
    if (!segment || segment.includes('/') || segment.includes('\\') || segment.includes('..')) {
      throw new Error(`[Workspace] Invalid ${what} '${segment}' — must be a single path segment (no separators, no '..')`)
    }
    return segment
  }

  private get configPath(): string {
    return path.join(this.forgeDir, 'config.json')
  }

  /**
   * Missing file → null (NOT an error — it is the auto-bootstrap trigger).
   * Present-but-unreadable or wrong schemaVersion → THROW: a config that exists
   * but can't be trusted must never be silently regenerated over (that would
   * clobber user edits); the error tells the user exactly what to fix.
   */
  async loadConfig(): Promise<AppConfig | null> {
    if (!fs.existsSync(this.configPath)) return null
    const raw = fs.readFileSync(this.configPath, 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e: any) {
      throw new Error(`[Workspace] ${this.configPath} is not valid JSON (${e.message}) — fix or delete it, then re-run`)
    }
    const config = parsed as AppConfig
    if (config.schemaVersion !== 1) {
      throw new Error(
        `[Workspace] ${this.configPath} has schemaVersion '${(config as any).schemaVersion}' — ` +
        `this FORGE version supports schemaVersion 1 only`,
      )
    }
    return config
  }

  async saveConfig(config: AppConfig): Promise<void> {
    this.ensureDirs()
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  /** TD-114: the per-app SQLite database — one Project, one DB, inside .forge/. */
  dbPath(): string {
    return path.join(this.forgeDir, 'forge.db')
  }

  private get projectManifestPath(): string {
    return path.join(this.forgeDir, 'project.json')
  }

  /**
   * Same contract as loadConfig(): missing file → null (first open — the
   * caller creates it); unparseable or wrong projectVersion → THROW loudly,
   * never silently regenerate over an existing manifest.
   */
  async loadProjectManifest(): Promise<ProjectManifest | null> {
    if (!fs.existsSync(this.projectManifestPath)) return null
    const raw = fs.readFileSync(this.projectManifestPath, 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e: any) {
      throw new Error(`[Workspace] ${this.projectManifestPath} is not valid JSON (${e.message}) — fix or delete it, then re-run`)
    }
    const manifest = parsed as ProjectManifest
    if (manifest.projectVersion !== 1) {
      throw new Error(
        `[Workspace] ${this.projectManifestPath} has projectVersion '${(manifest as any).projectVersion}' — ` +
        `this FORGE version supports projectVersion 1 only`,
      )
    }
    return manifest
  }

  async saveProjectManifest(manifest: ProjectManifest): Promise<void> {
    this.ensureDirs()
    fs.writeFileSync(this.projectManifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  }

  async saveBootstrapManifest(manifest: unknown): Promise<void> {
    this.ensureDirs()
    fs.writeFileSync(path.join(this.forgeDir, 'bootstrap-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  }

  async saveBootstrapEvidence(pkg: unknown): Promise<void> {
    this.ensureDirs()
    fs.writeFileSync(path.join(this.forgeDir, 'bootstrap-evidence.json'), JSON.stringify(pkg, null, 2), 'utf-8')
  }

  async saveGenerationManifest(manifest: GenerationManifest): Promise<void> {
    this.ensureDirs()
    fs.writeFileSync(path.join(this.forgeDir, 'generation-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  }

  /**
   * Agent memory lives at .forge/agent-memory.json (locked workspace layout —
   * ONE app per workspace, so one memory file). appName is accepted for the
   * AgentMemoryRepository seam's signature but does not shard the path today;
   * WorkspaceMemoryRepository verifies the loaded memory's appId matches.
   */
  private get memoryPath(): string {
    return path.join(this.forgeDir, 'agent-memory.json')
  }

  async loadMemory(_appName: string): Promise<unknown | null> {
    if (!fs.existsSync(this.memoryPath)) return null
    return JSON.parse(fs.readFileSync(this.memoryPath, 'utf-8'))
  }

  async saveMemory(_appName: string, memory: unknown): Promise<void> {
    this.ensureDirs()
    fs.writeFileSync(this.memoryPath, JSON.stringify(memory, null, 2), 'utf-8')
  }

  /** tests/<module>/<filename> — module comes from ModuleAssignment.name. */
  async writeTests(module: string, filename: string, content: string): Promise<void> {
    this.ensureDirs()
    const moduleDir = path.join(this.testsDir, this.safeSegment(module, 'module'))
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(path.join(moduleDir, this.safeSegment(filename, 'filename')), content, 'utf-8')
  }

  /** tests/<filename> — root-level generated support files (see interface doc). */
  async writeTestsFile(filename: string, content: string): Promise<void> {
    this.ensureDirs()
    fs.writeFileSync(path.join(this.testsDir, this.safeSegment(filename, 'filename')), content, 'utf-8')
  }

  /** models/<appName>/app-model.json — write-only compatibility projection. */
  async saveModelProjection(appName: string, model: AppModel): Promise<void> {
    const dir = path.join(this.root, 'models', this.safeSegment(appName, 'appName'))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'app-model.json'), JSON.stringify(model, null, 2), 'utf-8')
  }

  /** models/<appName>/synthesized-goals.json — auto-discovered goals envelope (TD-013 P3 Block 3). */
  async saveSynthesizedGoals(appName: string, envelope: unknown): Promise<void> {
    const dir = path.join(this.root, 'models', this.safeSegment(appName, 'appName'))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'synthesized-goals.json'), JSON.stringify(envelope, null, 2), 'utf-8')
  }

  /** Read the synthesized-goals envelope, or null if none. Corrupt JSON → throw (loud-failure contract). */
  async loadSynthesizedGoals(appName: string): Promise<unknown | null> {
    const p = path.join(this.root, 'models', this.safeSegment(appName, 'appName'), 'synthesized-goals.json')
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf-8')
    try {
      return JSON.parse(raw)
    } catch (e: any) {
      throw new Error(`[Workspace] ${p} is not valid JSON (${e.message}) — re-run forge crawl`)
    }
  }

  /** reports/<runId>/<name> — '.json' appended when name carries no extension. */
  async saveReport(runId: string, name: string, content: unknown): Promise<void> {
    this.ensureDirs()
    const runDir = path.join(this.reportsDir, this.safeSegment(runId, 'runId'))
    fs.mkdirSync(runDir, { recursive: true })
    const file = this.safeSegment(name, 'report name')
    const filename = file.includes('.') ? file : `${file}.json`
    fs.writeFileSync(path.join(runDir, filename), JSON.stringify(content, null, 2), 'utf-8')
  }
}

/** Factory — the standard way to obtain a workspace (defaults to the user's cwd). */
export function createWorkspace(root?: string): WorkspaceManager {
  return new WorkspaceManager(root)
}
