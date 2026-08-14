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

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { getDatabaseProvenance, getProductDb } from '../storage/db'
import { DatabaseAuthorityMode } from '../storage/DatabaseAuthority'
import type { Database } from '../storage/types'
import type { Transaction } from 'kysely'
import { CRAWL_OBSERVATION_METHOD_VERSIONS, type ObservationBoundary } from './ObservationTypes'
import { ObservationAuthorityError, ObservationContractError, ObservationReplayConflictError } from './ObservationErrors'

export type HistoricalSourceClassification =
  | 'clean'
  | 'migratable'
  | 'ambiguous'
  | 'compatibility_only'
  | 'unsupported'

export type HistoricalSourceKind =
  | 'observation_file'
  | 'bootstrap_evidence'
  | 'agent_memory'
  | 'legacy_app_model_support'
  | 'legacy_evidence_ledger'
  | 'verification_artifact'
  | 'historical_artifact'

export type LegacyImportProvenance =
  | 'clean_direct'
  | 'reconstructed'
  | 'ambiguous'
  | 'bootstrap_projection'
  | 'agent_memory'
  | 'verification_compatibility'
  | 'unsupported'

export interface HistoricalImportItem {
  sourceKind: HistoricalSourceKind
  sourcePath: string
  sourcePathState: 'present' | 'unavailable'
  sourceSchema: string
  originalId: string | null
  originalIdState: 'present' | 'unavailable'
  contentHash: string
  captureTimestamp: string | null
  producerIdentity: string | null
  producerIdentityState: 'present' | 'unavailable'
  classification: HistoricalSourceClassification
  legacyProvenanceClass: LegacyImportProvenance
  reasonCode: string
  importedObservationId: string | null
  importedObservationRunId: string | null
  package: HistoricalObservationImportPackage | null
}

export interface HistoricalImportReport {
  schemaVersion: 'forge-observation-import-report/v1'
  projectId: string
  mode: 'dry_run' | 'import'
  policy: { id: string; version: string }
  recordsScanned: number
  eligible: number
  imported: number
  rejected: number
  ambiguous: number
  compatibilityRetained: number
  unsupported: number
  replayed: number
  items: Array<Omit<HistoricalImportItem, 'package'>>
}

export interface HistoricalObservationImportPackage {
  schemaVersion: 'forge-observation-import/v1'
  projectId: string
  sourceSchema: string
  originalId: string | null
  captureTimestamp: string | null
  producerIdentity: string | null
  legacyProvenanceClass: 'clean_direct' | 'reconstructed' | 'ambiguous'
  run: {
    observationRunId: string
    acquisitionKind: 'web_crawl' | 'api_crawl'
    startedAt: string
    terminalAt: string
    lifecycle: 'completed' | 'blocked' | 'failed' | 'interrupted'
    completeness: 'complete' | 'partial' | 'unobserved'
    safeReasonCode: string | null
    policyId: string
    policyVersion: string
    acquisitionPlanHash: string
  }
  observation: {
    observationId: string
    method: 'browser_dom_inspection' | 'browser_navigation_attempt' | 'http_response_inspection'
    methodVersion: string
    subjectId: string
    predicate: string
    outcome: 'present' | 'absent' | 'indeterminate'
    observedValue: unknown | null
    boundary: ObservationBoundary
    capturedAt: string
    integrityHash: string
    safeReasonCode: string | null
    safeMessage: null
  }
  artifacts: Array<{
    artifactId: string
    sourcePath: string
    sha256: string
    mediaType: string
    byteSize: number
  }>
}

const POLICY_ID = 'forge.historical-observation-import'
const POLICY_VERSION = '1'
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SHA256 = /^[a-f0-9]{64}$/
const IMPORT_PACKAGE_KEYS = [
  'schemaVersion', 'projectId', 'sourceSchema', 'originalId', 'captureTimestamp',
  'producerIdentity', 'legacyProvenanceClass', 'run', 'observation', 'artifacts',
] as const
const RUN_KEYS = [
  'observationRunId', 'acquisitionKind', 'startedAt', 'terminalAt', 'lifecycle',
  'completeness', 'safeReasonCode', 'policyId', 'policyVersion', 'acquisitionPlanHash',
] as const
const OBSERVATION_KEYS = [
  'observationId', 'method', 'methodVersion', 'subjectId', 'predicate', 'outcome',
  'observedValue', 'boundary', 'capturedAt', 'integrityHash', 'safeReasonCode', 'safeMessage',
] as const

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function exactIso(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalize(child)]))
  return value
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function safeStructured(value: unknown, key?: string): boolean {
  if (key && /^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key)$/i.test(key)) return false
  if (typeof value === 'string') {
    return !/https?:\/\/[^\s"'<>]*[?#]/i.test(value)
      && !/\bbearer\s+[A-Za-z0-9._~+\/-]+/i.test(value)
  }
  if (Array.isArray(value)) return value.every(item => safeStructured(item))
  return !isRecord(value) || Object.entries(value).every(([childKey, child]) => safeStructured(child, childKey))
}

function safeRelativePath(workspaceRoot: string, absolutePath: string): string {
  const root = path.resolve(workspaceRoot)
  const resolved = path.resolve(absolutePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new ObservationAuthorityError('Historical import source escaped the selected Product workspace.')
  }
  return path.relative(root, resolved).replace(/\\/g, '/')
}

function fileHash(file: string): string {
  return sha256(fs.readFileSync(file))
}

export function historicalObservationImportIntegrityHash(pkg: HistoricalObservationImportPackage): string {
  const provenanceClass = pkg.legacyProvenanceClass === 'clean_direct'
    ? 'legacy_direct'
    : 'legacy_reconstructed'
  return sha256(canonicalJson({
    schemaVersion: 'forge-observation/v1',
    observationRunId: pkg.run.observationRunId,
    projectId: pkg.projectId,
    producer: pkg.producerIdentity,
    producerVersion: pkg.sourceSchema,
    method: pkg.observation.method,
    methodVersion: pkg.observation.methodVersion,
    subjectId: pkg.observation.subjectId,
    predicate: pkg.observation.predicate,
    outcome: pkg.observation.outcome,
    observedValue: pkg.observation.observedValue,
    boundary: pkg.observation.boundary,
    capturedAt: pkg.observation.capturedAt,
    provenanceClass,
    safeReasonCode: pkg.observation.safeReasonCode,
    artifactHashes: [],
  }))
}

function withoutPackage(item: HistoricalImportItem): Omit<HistoricalImportItem, 'package'> {
  const { package: _package, ...safe } = item
  return safe
}

function emptyItem(input: Pick<HistoricalImportItem,
  'sourceKind' | 'sourcePath' | 'sourceSchema' | 'contentHash' | 'classification'
  | 'legacyProvenanceClass' | 'reasonCode'> & Partial<HistoricalImportItem>): HistoricalImportItem {
  return {
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    sourcePathState: input.sourcePathState ?? 'present',
    sourceSchema: input.sourceSchema,
    originalId: input.originalId ?? null,
    originalIdState: input.originalId ? 'present' : 'unavailable',
    contentHash: input.contentHash,
    captureTimestamp: input.captureTimestamp ?? null,
    producerIdentity: input.producerIdentity ?? null,
    producerIdentityState: input.producerIdentity ? 'present' : 'unavailable',
    classification: input.classification,
    legacyProvenanceClass: input.legacyProvenanceClass,
    reasonCode: input.reasonCode,
    importedObservationId: null,
    importedObservationRunId: null,
    package: input.package ?? null,
  }
}

export class ObservationImportService {
  private readonly root: string

  constructor(readonly projectId: string, workspaceRoot: string) {
    this.root = path.resolve(workspaceRoot)
  }

  private assertAuthority(): void {
    const provenance = getDatabaseProvenance()
    if (provenance.authorityMode !== DatabaseAuthorityMode.PRODUCT_WORKSPACE
      || !provenance.productSchemaEligible
      || !provenance.workspaceRoot
      || path.resolve(provenance.workspaceRoot) !== this.root) {
      throw new ObservationAuthorityError('Historical import requires the exact selected PRODUCT_WORKSPACE authority.')
    }
    if (!SAFE_ID.test(this.projectId)) {
      throw new ObservationContractError('OBSERVATION_IMPORT_PROJECT_INVALID', 'Historical import project identity is invalid.')
    }
  }

  async dryRun(): Promise<HistoricalImportReport> {
    this.assertAuthority()
    return this.report(await this.inventory(), 'dry_run', 0, 0)
  }

  async import(): Promise<HistoricalImportReport> {
    this.assertAuthority()
    const items = await this.inventory()
    const importedAt = new Date().toISOString()
    let imported = 0
    let replayed = 0
    await getProductDb().transaction().execute(async trx => {
      for (const item of items) {
        const existing = await trx.selectFrom('observation_import_sources').selectAll()
          .where('project_id', '=', this.projectId)
          .where('source_kind', '=', item.sourceKind)
          .where('source_path', '=', item.sourcePath)
          .where('content_hash', '=', item.contentHash)
          .executeTakeFirst()
        if (existing) {
          replayed += 1
          item.importedObservationId = existing.imported_observation_id
          item.importedObservationRunId = existing.imported_observation_run_id
          continue
        }
        if ((item.classification === 'clean' || item.classification === 'migratable') && item.package) {
          await this.persistEligible(trx, item)
          imported += 1
        }
        await trx.insertInto('observation_import_sources').values({
          project_id: this.projectId,
          source_kind: item.sourceKind,
          source_path: item.sourcePath,
          source_path_state: item.sourcePathState,
          source_schema: item.sourceSchema,
          original_id: item.originalId,
          original_id_state: item.originalIdState,
          content_hash: item.contentHash,
          capture_timestamp: item.captureTimestamp,
          workspace_authority: 'PRODUCT_WORKSPACE',
          producer_identity: item.producerIdentity,
          producer_identity_state: item.producerIdentityState,
          classification: item.classification,
          legacy_provenance_class: item.legacyProvenanceClass,
          reason_code: item.reasonCode,
          imported_observation_id: item.importedObservationId,
          imported_observation_run_id: item.importedObservationRunId,
          imported_at: importedAt,
          import_policy_id: POLICY_ID,
          import_policy_version: POLICY_VERSION,
        }).execute()
      }
    })
    return this.report(items, 'import', imported, replayed)
  }

  private async inventory(): Promise<HistoricalImportItem[]> {
    const items: HistoricalImportItem[] = []
    this.inventoryLegacyObservationFiles(items)
    this.inventorySingleCompatibilityFile(items, '.forge/bootstrap-evidence.json', 'bootstrap_evidence', 'bootstrap-evidence/v1', 'bootstrap_projection', 'bootstrap_identity_unavailable')
    this.inventorySingleCompatibilityFile(items, '.forge/agent-memory.json', 'agent_memory', 'agent-memory/unversioned', 'agent_memory', 'agent_memory_experimental')
    this.inventoryImportPackages(items)
    await this.inventoryLegacyAppModelSupport(items)
    items.push(emptyItem({
      sourceKind: 'legacy_evidence_ledger',
      sourcePath: 'unavailable',
      sourcePathState: 'unavailable',
      sourceSchema: 'presenter-projection/v1',
      contentHash: sha256('legacy-evidence-ledger-presenter-projection/v1'),
      classification: 'unsupported',
      legacyProvenanceClass: 'unsupported',
      reasonCode: 'projection_is_not_persisted_source',
    }))
    this.inventoryWorkspaceReports(items)
    return items.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)
      || left.sourceKind.localeCompare(right.sourceKind))
  }

  private inventoryLegacyObservationFiles(items: HistoricalImportItem[]): void {
    const root = path.join(this.root, '.forge', 'observations')
    if (!fs.existsSync(root)) return
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
      const directory = path.join(root, entry.name)
      const started = path.join(directory, 'started.json')
      const terminal = path.join(directory, 'terminal.json')
      const bytes = Buffer.concat([
        fs.existsSync(started) ? fs.readFileSync(started) : Buffer.alloc(0),
        Buffer.from('\n--terminal--\n'),
        fs.existsSync(terminal) ? fs.readFileSync(terminal) : Buffer.alloc(0),
      ])
      let parsed: any = null
      try { parsed = fs.existsSync(terminal) ? JSON.parse(fs.readFileSync(terminal, 'utf8')) : null } catch { /* classified below */ }
      items.push(emptyItem({
        sourceKind: 'observation_file',
        sourcePath: safeRelativePath(this.root, directory),
        sourceSchema: parsed?.schemaVersion === 1 ? 'legacy-observation-store/v1' : 'legacy-observation-store/unknown',
        originalId: typeof parsed?.observationId === 'string' ? parsed.observationId : entry.name,
        contentHash: sha256(bytes),
        captureTimestamp: exactIso(parsed?.completedAt) ? parsed.completedAt : null,
        producerIdentity: null,
        classification: parsed?.schemaVersion === 1 ? 'compatibility_only' : 'unsupported',
        legacyProvenanceClass: parsed?.schemaVersion === 1 ? 'reconstructed' : 'unsupported',
        reasonCode: parsed?.schemaVersion === 1
          ? 'legacy_fact_identity_or_method_proof_unavailable'
          : 'legacy_observation_malformed',
      }))
    }
  }

  private inventorySingleCompatibilityFile(
    items: HistoricalImportItem[], relative: string, sourceKind: HistoricalSourceKind,
    sourceSchema: string, provenance: LegacyImportProvenance, reasonCode: string,
  ): void {
    const file = path.join(this.root, ...relative.split('/'))
    if (!fs.existsSync(file)) return
    let parsed: any = null
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* retained as unsupported */ }
    const expectedProject = sourceKind === 'bootstrap_evidence' ? parsed?.appName : parsed?.appId
    const validOwner = expectedProject === this.projectId
    items.push(emptyItem({
      sourceKind,
      sourcePath: relative,
      sourceSchema: typeof parsed?.schemaVersion === 'string' ? `${sourceSchema}:${parsed.schemaVersion}` : sourceSchema,
      contentHash: fileHash(file),
      captureTimestamp: exactIso(parsed?.producedAt) ? parsed.producedAt : null,
      classification: parsed && validOwner ? 'compatibility_only' : 'unsupported',
      legacyProvenanceClass: parsed && validOwner ? provenance : 'unsupported',
      reasonCode: parsed && validOwner ? reasonCode : 'workspace_or_schema_mismatch',
    }))
  }

  private inventoryImportPackages(items: HistoricalImportItem[]): void {
    const root = path.join(this.root, '.forge', 'observation-import')
    if (!fs.existsSync(root)) return
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const file = path.join(root, entry.name)
      const relative = safeRelativePath(this.root, file)
      const actualHash = fileHash(file)
      const sidecar = `${file}.sha256`
      const expectedHash = fs.existsSync(sidecar) ? fs.readFileSync(sidecar, 'utf8').trim().toLowerCase() : null
      let parsed: unknown = null
      try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* classified below */ }
      const assessed = this.assessPackage(parsed, expectedHash, actualHash, relative)
      items.push(assessed)
    }
  }

  private assessPackage(parsed: unknown, expectedHash: string | null, actualHash: string, sourcePath: string): HistoricalImportItem {
    const declaredSchema = isRecord(parsed) && typeof parsed.sourceSchema === 'string' && SAFE_ID.test(parsed.sourceSchema)
      ? parsed.sourceSchema
      : 'unavailable'
    const base = {
      sourceKind: 'observation_file' as const,
      sourcePath,
      sourceSchema: declaredSchema,
      contentHash: actualHash,
    }
    if (!expectedHash || !SHA256.test(expectedHash)) return emptyItem({ ...base, classification: 'ambiguous', legacyProvenanceClass: 'ambiguous', reasonCode: 'content_hash_missing' })
    if (expectedHash !== actualHash) return emptyItem({ ...base, classification: 'unsupported', legacyProvenanceClass: 'unsupported', reasonCode: 'content_hash_mismatch' })
    if (!isRecord(parsed) || !exactKeys(parsed, IMPORT_PACKAGE_KEYS)
      || parsed.schemaVersion !== 'forge-observation-import/v1'
      || !isRecord(parsed.run) || !exactKeys(parsed.run, RUN_KEYS)
      || !isRecord(parsed.observation) || !exactKeys(parsed.observation, OBSERVATION_KEYS)
      || !Array.isArray(parsed.artifacts)) {
      return emptyItem({ ...base, classification: 'unsupported', legacyProvenanceClass: 'unsupported', reasonCode: 'import_package_malformed' })
    }
    const pkg = parsed as HistoricalObservationImportPackage
    const identity = typeof pkg.originalId === 'string' && UUID_V4.test(pkg.originalId) ? pkg.originalId : null
    const producer = typeof pkg.producerIdentity === 'string' && SAFE_ID.test(pkg.producerIdentity)
      ? pkg.producerIdentity
      : null
    const common = {
      ...base,
      originalId: identity,
      captureTimestamp: exactIso(pkg.captureTimestamp) ? pkg.captureTimestamp : null,
      producerIdentity: producer,
    }
    if (pkg.projectId !== this.projectId) return emptyItem({ ...common, classification: 'unsupported', legacyProvenanceClass: 'unsupported', reasonCode: 'workspace_mismatch' })
    if (!identity || identity !== pkg.observation.observationId) {
      return emptyItem({ ...common, classification: 'ambiguous', legacyProvenanceClass: 'ambiguous', reasonCode: 'original_identity_missing_or_invalid' })
    }
    if (!producer) return emptyItem({ ...common, classification: 'ambiguous', legacyProvenanceClass: 'ambiguous', reasonCode: 'producer_identity_unavailable' })
    if (!['clean_direct', 'reconstructed', 'ambiguous'].includes(pkg.legacyProvenanceClass)) {
      return emptyItem({ ...common, classification: 'unsupported', legacyProvenanceClass: 'unsupported', reasonCode: 'legacy_provenance_unsupported' })
    }
    if (pkg.legacyProvenanceClass === 'ambiguous') return emptyItem({ ...common, classification: 'ambiguous', legacyProvenanceClass: 'ambiguous', reasonCode: 'legacy_provenance_ambiguous' })
    if (pkg.artifacts.length > 0) {
      for (const artifact of pkg.artifacts) {
        if (!isRecord(artifact) || !UUID_V4.test(String(artifact.artifactId)) || !SHA256.test(String(artifact.sha256))) {
          return emptyItem({ ...common, classification: 'unsupported', legacyProvenanceClass: 'unsupported', reasonCode: 'artifact_metadata_invalid' })
        }
        const artifactPath = path.resolve(this.root, ...String(artifact.sourcePath).split('/'))
        if (!artifactPath.startsWith(`${this.root}${path.sep}`) || !fs.existsSync(artifactPath)
          || fileHash(artifactPath) !== artifact.sha256 || fs.statSync(artifactPath).size !== artifact.byteSize) {
          return emptyItem({ ...common, classification: 'unsupported', legacyProvenanceClass: 'unsupported', reasonCode: 'artifact_hash_or_workspace_mismatch' })
        }
      }
      return emptyItem({ ...common, classification: 'compatibility_only', legacyProvenanceClass: 'reconstructed', reasonCode: 'historical_artifact_external_reference_only' })
    }
    if (!this.validPackageContract(pkg)) return emptyItem({ ...common, classification: 'unsupported', legacyProvenanceClass: 'unsupported', reasonCode: 'canonical_observation_contract_invalid' })
    const classification = pkg.legacyProvenanceClass === 'clean_direct' ? 'clean' : 'migratable'
    return emptyItem({
      ...common,
      classification,
      legacyProvenanceClass: pkg.legacyProvenanceClass,
      reasonCode: classification === 'clean' ? 'eligible_clean_direct' : 'eligible_legacy_reconstructed',
      package: pkg,
    })
  }

  private validPackageContract(pkg: HistoricalObservationImportPackage): boolean {
    const run = pkg.run
    const observation = pkg.observation
    if (!UUID_V4.test(run.observationRunId)
      || !exactIso(run.startedAt) || !exactIso(run.terminalAt) || run.terminalAt < run.startedAt
      || !['web_crawl', 'api_crawl'].includes(run.acquisitionKind)
      || !['completed', 'blocked', 'failed', 'interrupted'].includes(run.lifecycle)
      || !['complete', 'partial', 'unobserved'].includes(run.completeness)
      || !SAFE_ID.test(run.policyId) || !SAFE_ID.test(run.policyVersion) || !SHA256.test(run.acquisitionPlanHash)
      || run.lifecycle !== 'completed' || run.completeness !== 'complete'
      || run.safeReasonCode !== null || !SAFE_ID.test(pkg.sourceSchema)) return false
    if (!UUID_V4.test(observation.observationId)
      || !SAFE_ID.test(observation.subjectId) || !SAFE_ID.test(observation.predicate)
      || !exactIso(observation.capturedAt) || observation.capturedAt < run.startedAt || observation.capturedAt > run.terminalAt
      || CRAWL_OBSERVATION_METHOD_VERSIONS[observation.method] !== observation.methodVersion
      || observation.safeMessage !== null || !safeStructured(observation.observedValue)
      || observation.safeReasonCode !== null
      || !this.validBoundary(observation.method, observation.boundary)) return false
    // B3 imports only the already-adopted, artifact-free positive page fact.
    if (observation.method !== 'browser_dom_inspection' || observation.predicate !== 'page.discovered'
      || observation.outcome !== 'present' || !isRecord(observation.observedValue)) return false
    const value = observation.observedValue
    if (!exactKeys(value, Object.hasOwn(value, 'roleId')
      ? ['urlPattern', 'elementCount', 'fingerprint', 'roleId']
      : ['urlPattern', 'elementCount', 'fingerprint'])
      || typeof value.urlPattern !== 'string' || !value.urlPattern.startsWith('/') || /[?#]/.test(value.urlPattern)
      || !Number.isInteger(value.elementCount) || value.elementCount < 0
      || typeof value.fingerprint !== 'string' || !SHA256.test(value.fingerprint)
      || (Object.hasOwn(value, 'roleId') && (typeof value.roleId !== 'string' || !SAFE_ID.test(value.roleId)))) return false
    return observation.integrityHash === historicalObservationImportIntegrityHash(pkg)
  }

  private validBoundary(method: string, boundary: ObservationBoundary): boolean {
    if (!isRecord(boundary) || !exactKeys(boundary as unknown as Record<string, unknown>, [
      'schemaVersion', 'kind', 'scope', 'startedAt', 'endedAt', 'completion', 'policyId', 'policyVersion',
    ])) return false
    if (boundary.schemaVersion !== 'forge-observation-boundary/v1'
      || method !== 'browser_dom_inspection' || boundary.kind !== 'document'
      || !exactIso(boundary.startedAt) || !exactIso(boundary.endedAt) || boundary.endedAt < boundary.startedAt
      || boundary.completion !== 'complete' || !SAFE_ID.test(boundary.policyId)
      || !SAFE_ID.test(boundary.policyVersion) || !isRecord(boundary.scope)
      || !exactKeys(boundary.scope, Object.hasOwn(boundary.scope, 'roleId') ? ['acquisitionKind', 'roleId'] : ['acquisitionKind'])
      || boundary.scope.acquisitionKind !== 'web_crawl') return false
    return safeStructured(boundary)
  }

  private async inventoryLegacyAppModelSupport(items: HistoricalImportItem[]): Promise<void> {
    const rows = await getProductDb().selectFrom('app_models').select(['id', 'operation_id', 'status'])
      .where('app_name', '=', this.projectId).where('operation_id', 'is not', null).execute()
    for (const row of rows) {
      const seal = await getProductDb().selectFrom('app_model_support_seals').select('model_row_id')
        .where('model_row_id', '=', Number(row.id)).executeTakeFirst()
      if (seal) continue
      const content = canonicalJson({ id: Number(row.id), operationId: row.operation_id, status: row.status })
      items.push(emptyItem({
        sourceKind: 'legacy_app_model_support',
        sourcePath: `database/app_models/${row.id}`,
        sourceSchema: 'app-model-operation-provenance/v1',
        originalId: String(row.id),
        contentHash: sha256(content),
        classification: 'ambiguous',
        legacyProvenanceClass: 'ambiguous',
        reasonCode: 'operation_id_is_not_exact_observation_provenance',
      }))
    }
  }

  private inventoryWorkspaceReports(items: HistoricalImportItem[]): void {
    const reports = path.join(this.root, 'reports')
    if (!fs.existsSync(reports)) return
    const visit = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) visit(full)
        else if (/verify-report\.json$/i.test(entry.name)) {
          items.push(emptyItem({
            sourceKind: 'verification_artifact', sourcePath: safeRelativePath(this.root, full),
            sourceSchema: 'verification-report/compatibility', contentHash: fileHash(full),
            classification: 'compatibility_only', legacyProvenanceClass: 'verification_compatibility',
            reasonCode: 'verification_identity_or_boundary_unavailable',
          }))
        } else if (/\.(png|html)$/i.test(entry.name)) {
          items.push(emptyItem({
            sourceKind: 'historical_artifact', sourcePath: safeRelativePath(this.root, full),
            sourceSchema: 'unlinked-historical-artifact', contentHash: fileHash(full),
            classification: 'unsupported', legacyProvenanceClass: 'unsupported',
            reasonCode: 'artifact_metadata_or_observation_link_unavailable',
          }))
        }
      }
    }
    visit(reports)
  }

  private async persistEligible(trx: Transaction<Database>, item: HistoricalImportItem): Promise<void> {
    const pkg = item.package!
    const run = await trx.selectFrom('observation_runs').selectAll()
      .where('project_id', '=', this.projectId)
      .where('observation_run_id', '=', pkg.run.observationRunId).executeTakeFirst()
    if (run) {
      if (run.producer !== pkg.producerIdentity || run.acquisition_plan_hash !== pkg.run.acquisitionPlanHash
        || run.started_at !== pkg.run.startedAt || run.terminal_at !== pkg.run.terminalAt) {
        throw new ObservationReplayConflictError('run', pkg.run.observationRunId)
      }
    } else {
      await trx.insertInto('observation_runs').values({
        observation_run_id: pkg.run.observationRunId,
        project_id: this.projectId,
        workspace_authority: 'PRODUCT_WORKSPACE',
        operation_id: `legacy-import:${item.contentHash}`,
        producer: pkg.producerIdentity!,
        producer_version: pkg.sourceSchema,
        producer_instance_id: crypto.randomUUID(),
        producer_process_id: process.pid,
        acquisition_kind: pkg.run.acquisitionKind,
        started_at: pkg.run.startedAt,
        terminal_at: pkg.run.terminalAt,
        lifecycle: pkg.run.lifecycle,
        completeness: pkg.run.completeness,
        safe_reason_code: pkg.run.safeReasonCode,
        safe_message: null,
        policy_id: pkg.run.policyId,
        policy_version: pkg.run.policyVersion,
        acquisition_plan_hash: pkg.run.acquisitionPlanHash,
      }).execute()
    }
    const observation = await trx.selectFrom('observations').selectAll()
      .where('project_id', '=', this.projectId)
      .where('observation_id', '=', pkg.observation.observationId).executeTakeFirst()
    if (observation) {
      if (observation.integrity_hash !== pkg.observation.integrityHash) {
        throw new ObservationReplayConflictError('observation', pkg.observation.observationId)
      }
    } else {
      await trx.insertInto('observations').values({
        observation_id: pkg.observation.observationId,
        observation_run_id: pkg.run.observationRunId,
        project_id: this.projectId,
        producer: pkg.producerIdentity!,
        producer_version: pkg.sourceSchema,
        method: pkg.observation.method,
        method_version: pkg.observation.methodVersion,
        subject_id: pkg.observation.subjectId,
        predicate: pkg.observation.predicate,
        outcome: pkg.observation.outcome,
        observed_value_json: canonicalJson(pkg.observation.observedValue),
        boundary_json: canonicalJson(pkg.observation.boundary),
        captured_at: pkg.observation.capturedAt,
        idempotency_key: `legacy-import:${item.contentHash}`,
        integrity_hash: pkg.observation.integrityHash,
        provenance_class: pkg.legacyProvenanceClass === 'clean_direct' ? 'legacy_direct' : 'legacy_reconstructed',
        safe_reason_code: pkg.observation.safeReasonCode,
        safe_message: null,
        artifact_links_sealed: 1,
      }).execute()
    }
    item.importedObservationId = pkg.observation.observationId
    item.importedObservationRunId = pkg.run.observationRunId
  }

  private report(items: HistoricalImportItem[], mode: 'dry_run' | 'import', imported: number, replayed: number): HistoricalImportReport {
    return {
      schemaVersion: 'forge-observation-import-report/v1',
      projectId: this.projectId,
      mode,
      policy: { id: POLICY_ID, version: POLICY_VERSION },
      recordsScanned: items.length,
      eligible: items.filter(item => item.classification === 'clean' || item.classification === 'migratable').length,
      imported,
      rejected: items.filter(item => item.classification === 'ambiguous' || item.classification === 'unsupported').length,
      ambiguous: items.filter(item => item.classification === 'ambiguous').length,
      compatibilityRetained: items.filter(item => item.classification === 'compatibility_only').length,
      unsupported: items.filter(item => item.classification === 'unsupported').length,
      replayed,
      items: items.map(withoutPackage),
    }
  }
}
