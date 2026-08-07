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

import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import * as fs from 'fs'
import * as path from 'path'
import { AppModel } from './types'

/**
 * TD-108 smoke finding A (TD-097/TD-109 pattern): the schema SHIPS WITH FORGE —
 * it must resolve from this file's location (src/core/onboarding/), never from
 * process.cwd(). The old cwd-relative resolve crashed every standalone crawl
 * run outside the repo (ENOENT on <workspace>/models/schema/...).
 */
const REPO_ROOT  = path.resolve(__dirname, '../../..')   // onboarding → core → src → repoRoot
const schemaPath = path.join(REPO_ROOT, 'models', 'schema', 'app-model.schema.json')

let _validator: ReturnType<Ajv['compile']> | null = null

function getValidator() {
  if (_validator) return _validator
  const ajv = new Ajv({ allErrors: true, strict: false })
  try {
    addFormats(ajv)
  } catch {
    // ajv-formats optional
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'))
  _validator = ajv.compile(schema)
  return _validator
}

export interface ValidationResult {
  valid:  boolean
  errors: string[]
}

export interface AppModelValidationIssue {
  instancePath: string
  keyword: string
  missingProperty: string | null
}

/**
 * Structural validation details for trusted internal boundaries. This excludes
 * data values and schema parameters other than the name of a required property.
 */
export function validateAppModelStructure(model: unknown): {
  valid: boolean
  issues: AppModelValidationIssue[]
} {
  const validate = getValidator()
  const valid = validate(model) as boolean
  const issues = valid
    ? []
    : (validate.errors || []).map((error: ErrorObject) => ({
        instancePath: error.instancePath || '',
        keyword: error.keyword,
        missingProperty:
          error.keyword === 'required'
          && typeof (error.params as { missingProperty?: unknown }).missingProperty === 'string'
            ? (error.params as { missingProperty: string }).missingProperty
            : null,
      }))
  return { valid, issues }
}

/** Validate an in-memory model object against the canonical App Model schema. */
export function validateAppModelObject(model: unknown): ValidationResult {
  const validate = getValidator()
  const valid = validate(model) as boolean
  const errors = valid
    ? []
    : (validate.errors || []).map(e =>
        `${e.instancePath || '(root)'} ${e.message}`
      )
  return { valid, errors }
}


/**
 * True when the model has generatable/verifiable CONTENT — at least one page,
 * flow, or endpoint. Extracted ONCE and shared by GeneratorRunner and
 * VerificationRunner so the emptiness precondition lives in exactly one place.
 *
 * App-type-agnostic: API apps have endpoints and NO pages, so the endpoints check
 * is REQUIRED, not optional (a pages-only check would silently reject every API
 * app). Deliberately does NOT gate on crawledAt / classificationRunId /
 * pagesDiscovered — TC-04 (2026-07-13) proves all three are set even on an empty
 * bootstrap model and cannot distinguish "never crawled." See TD-UI-028.
 */
export function modelHasContent(model: AppModel): boolean {
  return (model.pages?.length ?? 0) > 0
    || (model.flows?.length ?? 0) > 0
    || (model.endpoints?.length ?? 0) > 0
}
