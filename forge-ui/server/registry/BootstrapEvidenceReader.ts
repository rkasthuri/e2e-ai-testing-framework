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
import { workspaceResolver, type WorkspaceResolver } from '../context/WorkspaceResolver'

export interface SafeBootstrapEvidence {
  id: string
  canonicalSubjectId: string
  capturedAt: string
  observationType: 'direct_observation' | 'indirect_observation' | 'inference' | 'assumption'
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  goalOrigin: 'observed' | 'synthesized' | 'user'
}

export type BootstrapEvidenceRead =
  | { kind: 'ok'; evidence: SafeBootstrapEvidence[] }
  | { kind: 'missing' }
  | { kind: 'malformed' }

const SAFE_SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactIso(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value
}

/**
 * Reads the persisted bootstrap package without ever carrying its unrestricted
 * `value`, `source`, `notes`, or target URL into the presentation projection.
 * The package format has no record identity, so the projection derives a stable,
 * project-scoped identity from non-secret structural fields and labels that fact.
 */
export class BootstrapEvidenceReader {
  constructor(private readonly workspaces: Pick<WorkspaceResolver, 'resolve'> = workspaceResolver) {}

  read(projectId: string): BootstrapEvidenceRead {
    const file = path.join(this.workspaces.resolve(projectId).forgeDir, 'bootstrap-evidence.json')
    if (!fs.existsSync(file)) return { kind: 'missing' }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
      if (!isRecord(parsed)
        || parsed.schemaVersion !== '1.0'
        || parsed.appName !== projectId
        || parsed.missionType !== 'bootstrap'
        || !exactIso(parsed.producedAt)
        || !Array.isArray(parsed.records)) return { kind: 'malformed' }

      const evidence: SafeBootstrapEvidence[] = []
      for (const [index, item] of parsed.records.entries()) {
        if (!isRecord(item)
          || typeof item.field !== 'string' || !SAFE_SUBJECT.test(item.field)
          || !['direct_observation', 'indirect_observation', 'inference', 'assumption'].includes(String(item.observationType))
          || !['high', 'medium', 'low', 'unknown'].includes(String(item.confidence))
          || !['observed', 'synthesized', 'user'].includes(String(item.goalOrigin))
          || !exactIso(item.timestamp)) return { kind: 'malformed' }

        const digest = crypto.createHash('sha256')
          .update(JSON.stringify([projectId, parsed.producedAt, index, item.field, item.timestamp]))
          .digest('hex')
        evidence.push({
          id: `bootstrap-${digest}`,
          canonicalSubjectId: item.field,
          capturedAt: item.timestamp,
          observationType: item.observationType as SafeBootstrapEvidence['observationType'],
          confidence: item.confidence as SafeBootstrapEvidence['confidence'],
          goalOrigin: item.goalOrigin as SafeBootstrapEvidence['goalOrigin'],
        })
      }
      if (new Set(evidence.map(item => item.id)).size !== evidence.length) return { kind: 'malformed' }
      return { kind: 'ok', evidence }
    } catch {
      return { kind: 'malformed' }
    }
  }
}

export const bootstrapEvidenceReader = new BootstrapEvidenceReader()
