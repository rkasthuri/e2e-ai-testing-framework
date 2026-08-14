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
import { randomUUID } from 'crypto'
import { getDatabaseProvenance } from '../storage/db'
import { DatabaseAuthorityMode } from '../storage/DatabaseAuthority'
import { ObservationRepository } from '../storage/repositories/ObservationRepository'
import { ObservationAuthorityError, ObservationContractError } from './ObservationErrors'
import type {
  ArtifactRedactionState,
  ArtifactReferenceRecord,
  ArtifactRetentionClass,
  ArtifactSensitivityClass,
  PersistedValue,
} from './ObservationTypes'

export interface PersistArtifactInput {
  observationRunId: string
  projectId: string
  mediaType: 'text/html' | 'application/json' | 'text/plain'
  content: string | Buffer
  sensitivityClass: ArtifactSensitivityClass
  redactionState: ArtifactRedactionState
  capturedAt: string
  retentionClass: ArtifactRetentionClass
  retentionPolicyId: string
  retentionPolicyVersion: string
  expiresAt?: string | null
}

export interface ObservationArtifactWriter {
  persist(input: PersistArtifactInput): Promise<PersistedValue<ArtifactReferenceRecord>>
}

const PROHIBITED = [
  /\bauthorization\s*:/i,
  /\bproxy-authorization\s*:/i,
  /\bset-cookie\s*:/i,
  /\bcookie\s*:/i,
  /\bbearer\s+[A-Za-z0-9._~+\/-]+/i,
  /\b(password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key)\s*[=:]\s*[^\s"'<>]+/i,
  /["'](?:password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key)["']\s*:\s*["'][^"']+["']/i,
  /<input\b[^>]*\btype\s*=\s*["']?password["']?[^>]*\bvalue\s*=\s*["'][^"']+["']/i,
  /<input\b[^>]*\bvalue\s*=\s*["'][^"']+["'][^>]*\btype\s*=\s*["']?password["']?/i,
]

const SECRET_JSON_KEY = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key)$/i

function jsonHasSecret(value: unknown, key?: string): boolean {
  if (key && SECRET_JSON_KEY.test(key) && value !== null && value !== '') return true
  if (typeof value === 'string') return PROHIBITED.some(pattern => pattern.test(value))
  if (Array.isArray(value)) return value.some(item => jsonHasSecret(item))
  return !!value && typeof value === 'object'
    && Object.entries(value as Record<string, unknown>).some(([childKey, child]) => jsonHasSecret(child, childKey))
}

function stripUrlQueryAndFragment(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, candidate => {
    try {
      const url = new URL(candidate)
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      return candidate
    }
  })
}

function extension(mediaType: PersistArtifactInput['mediaType']): string {
  if (mediaType === 'text/html') return '.html'
  if (mediaType === 'application/json') return '.json'
  return '.txt'
}

export class ObservationArtifactStore implements ObservationArtifactWriter {
  private readonly root: string

  constructor(
    private readonly projectId: string,
    workspaceRoot: string,
    private readonly repository = new ObservationRepository(projectId),
  ) {
    this.root = path.resolve(workspaceRoot)
  }

  private assertAuthority(projectId: string): void {
    if (projectId !== this.projectId) {
      throw new ObservationAuthorityError('ObservationArtifactStore refused cross-project persistence.')
    }
    const provenance = getDatabaseProvenance()
    if (provenance.authorityMode !== DatabaseAuthorityMode.PRODUCT_WORKSPACE
      || !provenance.productSchemaEligible
      || !provenance.workspaceRoot
      || path.resolve(provenance.workspaceRoot) !== this.root) {
      throw new ObservationAuthorityError(
        'Observation artifacts require the exact selected PRODUCT_WORKSPACE authority.',
      )
    }
  }

  async persist(input: PersistArtifactInput): Promise<PersistedValue<ArtifactReferenceRecord>> {
    this.assertAuthority(input.projectId)
    const run = await this.repository.findRun(input.projectId, input.observationRunId)
    if (!run) throw new ObservationContractError('OBSERVATION_RUN_NOT_FOUND', 'Artifact owning ObservationRun is not durable.')
    if (input.sensitivityClass === 'sensitive' && input.redactionState !== 'redacted') {
      throw new ObservationContractError('OBSERVATION_REDACTION_REQUIRED', 'Sensitive artifacts must be redacted before persistence.')
    }
    if (input.retentionClass === 'forensic_pinned' && input.expiresAt != null) {
      throw new ObservationContractError('OBSERVATION_RETENTION_INVALID', 'Pinned artifacts cannot carry an expiry timestamp.')
    }

    const source = Buffer.isBuffer(input.content) ? input.content.toString('utf8') : input.content
    const sanitized = stripUrlQueryAndFragment(source)
    let structuredSecret = false
    if (input.mediaType === 'application/json') {
      let parsed: unknown
      try { parsed = JSON.parse(sanitized) } catch {
        throw new ObservationContractError('OBSERVATION_ARTIFACT_INVALID', 'JSON artifacts must contain valid governed JSON.')
      }
      structuredSecret = jsonHasSecret(parsed)
    }
    if (structuredSecret || PROHIBITED.some(pattern => pattern.test(sanitized))) {
      throw new ObservationContractError(
        'OBSERVATION_SECRET_PROHIBITED',
        'Artifact persistence refused prohibited credential, token, cookie, or authorization material.',
      )
    }
    const bytes = Buffer.from(sanitized, 'utf8')
    const artifactId = randomUUID()
    const storageKey = path.posix.join(
      '.forge',
      'observation-artifacts',
      input.observationRunId,
      `${artifactId}${extension(input.mediaType)}`,
    )
    const absolutePath = path.resolve(this.root, ...storageKey.split('/'))
    const expectedRoot = path.resolve(this.root, '.forge', 'observation-artifacts')
    if (absolutePath !== expectedRoot && !absolutePath.startsWith(`${expectedRoot}${path.sep}`)) {
      throw new ObservationAuthorityError('Observation artifact storage escaped the selected workspace.')
    }
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    try {
      fs.writeFileSync(absolutePath, bytes, { flag: 'wx', mode: 0o600 })
    } catch (cause) {
      throw new ObservationContractError(
        'OBSERVATION_ARTIFACT_WRITE_FAILED',
        'Observation artifact bytes could not be persisted immutably.',
        { cause },
      )
    }

    try {
      return await this.repository.insertArtifact({
        artifact_id: artifactId,
        observation_run_id: input.observationRunId,
        project_id: input.projectId,
        storage_key: storageKey,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        media_type: input.mediaType,
        byte_size: bytes.byteLength,
        sensitivity_class: input.sensitivityClass,
        redaction_state: sanitized === source ? input.redactionState : 'redacted',
        captured_at: input.capturedAt,
        retention_class: input.retentionClass,
        retention_policy_id: input.retentionPolicyId,
        retention_policy_version: input.retentionPolicyVersion,
        expires_at: input.expiresAt ?? null,
      })
    } catch (cause) {
      try { fs.unlinkSync(absolutePath) } catch { /* no authority row points at the failed new file */ }
      throw cause
    }
  }
}
