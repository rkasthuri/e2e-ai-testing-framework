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

import type { M1CertificationCase } from './driver';

const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', 'fixtures', 'm1-certification');
const CASE_ROOT = path.join(FIXTURE_ROOT, 'cases');

let validator: ValidateFunction | null = null;

function caseValidator(): ValidateFunction {
  if (validator !== null) {
    return validator;
  }

  const schemaPath = path.join(FIXTURE_ROOT, 'contract.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
  validator = new Ajv({ allErrors: true, strict: true }).compile(schema);
  return validator;
}

export function loadM1CertificationCase(fileName: string): M1CertificationCase {
  const filePath = path.join(CASE_ROOT, fileName);
  const fixture = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  const validate = caseValidator();
  if (!validate(fixture)) {
    throw new Error(
      `Invalid M1 certification fixture ${fileName}: ${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
  return fixture as M1CertificationCase;
}

export function isValidM1CertificationFixture(value: unknown): boolean {
  return caseValidator()(value) as boolean;
}

export function loadAllM1CertificationCases(): M1CertificationCase[] {
  return readdirSync(CASE_ROOT)
    .filter(fileName => fileName.endsWith('.json'))
    .sort()
    .map(loadM1CertificationCase);
}

export function loadGoldenMatrix(): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'golden-matrix.json'), 'utf8')) as unknown;
}

export function m1CertificationFixtureRoot(): string {
  return FIXTURE_ROOT;
}
