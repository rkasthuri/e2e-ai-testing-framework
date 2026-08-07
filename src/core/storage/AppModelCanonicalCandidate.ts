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
import type { AppModel, AppModelCandidate } from '../onboarding/types'
import { validateAppModelStructure } from '../onboarding/ModelValidator'
import { canonicalJson, canonicalizeJson } from './JsonAppModelMigrationPlanner'

export type CanonicalCandidateIssueCategory =
  | 'omitted-optional-object-property'
  | 'undefined-required-property'
  | 'undefined-array-entry'
  | 'unsupported-runtime-value'
  | 'schema-validation'

export type CanonicalCandidateValueType =
  | 'undefined'
  | 'function'
  | 'symbol'
  | 'bigint'
  | 'non-finite-number'
  | 'unsupported-object'
  | 'circular-reference'
  | 'accessor-property'
  | 'non-enumerable-property'
  | 'symbol-key'
  | 'schema-invalid'

export interface CanonicalCandidateIssue {
  path: string
  category: CanonicalCandidateIssueCategory
  valueType: CanonicalCandidateValueType
}

export interface MaterializedAppModelCandidate {
  /** Recursively key-sorted, JSON-compatible, schema-valid candidate. */
  candidate: AppModelCandidate
  /** Exact canonical serialization used to compute candidateHash. */
  canonicalJson: string
  candidateHash: string
  /** Safe structural record of optional properties omitted by policy. */
  omittedOptionalProperties: CanonicalCandidateIssue[]
}

export interface MaterializedAppModelSnapshot {
  /** Canonical candidate plus the repository-allocated modelVersion only. */
  snapshot: AppModel
  /** Exact validated serialization written to app_models.model_json. */
  canonicalJson: string
}

export class AppModelCanonicalCandidateError extends Error {
  constructor(readonly issues: CanonicalCandidateIssue[]) {
    super('App Model candidate is not a supported canonical JSON structure.')
    this.name = 'AppModelCanonicalCandidateError'
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function childPath(parent: string, child: string | number): string {
  return `${parent}/${pointerSegment(String(child))}`
}

function displayPath(path: string): string {
  return path || '/'
}

function comparePaths(left: CanonicalCandidateIssue, right: CanonicalCandidateIssue): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1
    : left.category < right.category ? -1 : left.category > right.category ? 1
      : left.valueType < right.valueType ? -1 : left.valueType > right.valueType ? 1 : 0
}

function uniqueIssues(issues: CanonicalCandidateIssue[]): CanonicalCandidateIssue[] {
  const seen = new Set<string>()
  return issues.filter(issue => {
    const key = `${issue.path}\u0000${issue.category}\u0000${issue.valueType}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort(comparePaths)
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function materializeJsonCompatible(source: unknown): {
  value: JsonValue
  omittedUndefined: CanonicalCandidateIssue[]
  rejected: CanonicalCandidateIssue[]
} {
  const omittedUndefined: CanonicalCandidateIssue[] = []
  const rejected: CanonicalCandidateIssue[] = []
  const ancestors = new Set<object>()

  const reject = (
    path: string,
    category: CanonicalCandidateIssueCategory,
    valueType: CanonicalCandidateValueType,
  ): null => {
    rejected.push({ path: displayPath(path), category, valueType })
    return null
  }

  const visit = (value: unknown, path: string, inArray: boolean): JsonValue | undefined => {
    if (value === undefined) {
      if (inArray) return reject(path, 'undefined-array-entry', 'undefined')
      omittedUndefined.push({
        path: displayPath(path),
        category: 'omitted-optional-object-property',
        valueType: 'undefined',
      })
      return undefined
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return reject(path, 'unsupported-runtime-value', 'non-finite-number')
      }
      // JSON has one zero representation; this is the only numeric normalization.
      return Object.is(value, -0) ? 0 : value
    }
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      const valueType = typeof value as 'function' | 'symbol' | 'bigint'
      return reject(path, 'unsupported-runtime-value', valueType)
    }
    if (typeof value !== 'object') {
      return reject(path, 'unsupported-runtime-value', 'unsupported-object')
    }
    if (ancestors.has(value)) {
      return reject(path, 'unsupported-runtime-value', 'circular-reference')
    }

    const prototype = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      return reject(path, 'unsupported-runtime-value', 'unsupported-object')
    }

    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        const result: JsonValue[] = []
        for (let index = 0; index < value.length; index++) {
          const itemPath = childPath(path, index)
          if (!Object.hasOwn(value, index)) {
            result.push(reject(itemPath, 'undefined-array-entry', 'undefined'))
            continue
          }
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
          if (!descriptor || !('value' in descriptor)) {
            result.push(reject(itemPath, 'unsupported-runtime-value', 'accessor-property'))
            continue
          }
          result.push(visit(descriptor.value, itemPath, true) ?? null)
        }
        const extraKeys = Reflect.ownKeys(value).filter(key =>
          key !== 'length'
          && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length),
        )
        for (const key of extraKeys) {
          reject(
            typeof key === 'symbol' ? childPath(path, '$symbol') : childPath(path, key),
            'unsupported-runtime-value',
            typeof key === 'symbol' ? 'symbol-key' : 'unsupported-object',
          )
        }
        return result
      }

      const result = Object.create(null) as Record<string, JsonValue>
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key === 'symbol') {
          reject(childPath(path, '$symbol'), 'unsupported-runtime-value', 'symbol-key')
          continue
        }
        const propertyPath = childPath(path, key)
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor) continue
        if (!descriptor.enumerable) {
          reject(propertyPath, 'unsupported-runtime-value', 'non-enumerable-property')
          continue
        }
        if (!('value' in descriptor)) {
          reject(propertyPath, 'unsupported-runtime-value', 'accessor-property')
          continue
        }
        const item = visit(descriptor.value, propertyPath, false)
        if (item !== undefined) result[key] = item
      }
      return result
    } finally {
      ancestors.delete(value)
    }
  }

  const value = visit(source, '', false)
  return {
    value: value ?? null,
    omittedUndefined,
    rejected: rejected.sort(comparePaths),
  }
}

function requiredPath(instancePath: string, missingProperty: string): string {
  return childPath(instancePath, missingProperty)
}

/**
 * Authoritative candidate boundary. Optional undefined object properties are
 * omitted; every other non-JSON runtime shape fails closed. The materialized
 * representation is then schema-validated, canonically serialized, and hashed.
 */
export function materializeAppModelCandidate(source: unknown): MaterializedAppModelCandidate {
  const materialized = materializeJsonCompatible(source)
  const validationSnapshot = materialized.value && typeof materialized.value === 'object'
    && !Array.isArray(materialized.value)
    ? {
        ...materialized.value,
        app: materialized.value.app && typeof materialized.value.app === 'object'
          && !Array.isArray(materialized.value.app)
          ? { ...materialized.value.app, modelVersion: '0.0.0' }
          : materialized.value.app,
      }
    : materialized.value
  const validation = validateAppModelStructure(validationSnapshot)
  const omittedByPath = new Map(materialized.omittedUndefined.map(issue => [issue.path, issue]))
  const requiredUndefined = new Set<string>()
  const schemaIssues: CanonicalCandidateIssue[] = []
  for (const issue of validation.issues) {
    if (issue.keyword === 'required' && issue.missingProperty !== null) {
      const path = displayPath(requiredPath(issue.instancePath, issue.missingProperty))
      if (omittedByPath.has(path)) {
        requiredUndefined.add(path)
        schemaIssues.push({
          path,
          category: 'undefined-required-property',
          valueType: 'undefined',
        })
        continue
      }
    }
    // Runtime-structure rejections use temporary null placeholders solely so
    // scanning can continue. Do not report the resulting AJV cascade as if it
    // were an independent model defect; the precise runtime path is authority.
    if (materialized.rejected.length === 0) {
      schemaIssues.push({
        path: displayPath(issue.instancePath),
        category: 'schema-validation',
        valueType: 'schema-invalid',
      })
    }
  }
  const omittedOptionalProperties = materialized.omittedUndefined
    .filter(issue => !requiredUndefined.has(issue.path))
    .sort(comparePaths)
  const rejected = uniqueIssues([...materialized.rejected, ...schemaIssues])
  if (rejected.length > 0 || !validation.valid) {
    throw new AppModelCanonicalCandidateError(rejected)
  }

  const candidate = canonicalizeJson(materialized.value) as unknown as AppModelCandidate
  const serialized = canonicalJson(candidate)
  return {
    candidate,
    canonicalJson: serialized,
    candidateHash: sha256(serialized),
    omittedOptionalProperties,
  }
}

/**
 * Apply the sole transaction-time augmentation to the already materialized
 * candidate, then validate and serialize the exact snapshot SQLite will store.
 */
export function materializeAppModelSnapshot(
  source: MaterializedAppModelCandidate,
  modelVersion: string,
): MaterializedAppModelSnapshot {
  const snapshot = canonicalizeJson({
    ...source.candidate,
    app: {
      ...source.candidate.app,
      modelVersion,
    },
  }) as unknown as AppModel
  const validation = validateAppModelStructure(snapshot)
  if (!validation.valid) {
    throw new AppModelCanonicalCandidateError(
      validation.issues.map((issue): CanonicalCandidateIssue => ({
        path: displayPath(issue.instancePath),
        category: 'schema-validation',
        valueType: 'schema-invalid',
      })).sort(comparePaths),
    )
  }
  return { snapshot, canonicalJson: canonicalJson(snapshot) }
}
