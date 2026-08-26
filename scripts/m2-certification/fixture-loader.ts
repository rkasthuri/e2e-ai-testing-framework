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

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';

import type { M2CertificationCase } from './driver';

const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', 'fixtures', 'm2-certification');
const CASE_ROOT = path.join(FIXTURE_ROOT, 'cases');
let validator: ValidateFunction | null = null;

function caseValidator(): ValidateFunction {
  if (validator) return validator;
  const schema = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'contract.schema.json'), 'utf8')) as object;
  validator = new Ajv({ allErrors: true, strict: true }).compile(schema);
  return validator;
}

function hasFrozenOneBasedOrdinals(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const suite = (value as { suite?: unknown }).suite;
  if (typeof suite !== 'object' || suite === null) return false;
  const { orderedDefinitionIds, expectedOrdinals } = suite as {
    orderedDefinitionIds?: unknown;
    expectedOrdinals?: unknown;
  };
  return Array.isArray(orderedDefinitionIds)
    && Array.isArray(expectedOrdinals)
    && expectedOrdinals.length === orderedDefinitionIds.length
    && expectedOrdinals.every((ordinal, index) => Number.isSafeInteger(ordinal) && ordinal === index + 1);
}

export function loadM2CertificationCase(fileName: string): M2CertificationCase {
  const fixture = JSON.parse(readFileSync(path.join(CASE_ROOT, fileName), 'utf8')) as unknown;
  const validate = caseValidator();
  const structurallyValid = validate(fixture) as boolean;
  if (!structurallyValid || !hasFrozenOneBasedOrdinals(fixture)) {
    const detail = structurallyValid
      ? 'suite.expectedOrdinals must equal the contiguous positive sequence 1..N for orderedDefinitionIds'
      : JSON.stringify(validate.errors, null, 2);
    throw new Error(`Invalid M2 certification fixture ${fileName}: ${detail}`);
  }
  return fixture as M2CertificationCase;
}

export function loadAllM2CertificationCases(): M2CertificationCase[] {
  return readdirSync(CASE_ROOT)
    .filter(fileName => fileName.endsWith('.json'))
    .sort()
    .map(loadM2CertificationCase);
}

export function isValidM2CertificationFixture(value: unknown): boolean {
  return caseValidator()(value) as boolean && hasFrozenOneBasedOrdinals(value);
}

export function loadM2GoldenMatrix(): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'golden-matrix.json'), 'utf8')) as unknown;
}

export function m2CertificationFixtureRoot(): string {
  return FIXTURE_ROOT;
}
