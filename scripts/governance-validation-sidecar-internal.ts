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

/**
 * Transactional authority for governed validation evidence.
 *
 * This database is deliberately separate from the Product database. It uses
 * direct better-sqlite3 access and owns no Product tables or migrations.
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import BetterSqlite3 from 'better-sqlite3'
import {
  aggregateValidationStatus,
  deterministicValidationReportJson,
  type FindingKind,
  type ValidationGateResult,
  type ValidationProfile,
  type ValidationReport,
  type ValidationStatus,
} from '../src/core/validation/ValidationBaseline'

const SIDECAR_SCHEMA_VERSION = 1n
const MAX_AUTHORITY_INTEGER = 9_007_199_254_740_991n
const TARGET_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const AUTHORITY_OBJECT_NAMES = Object.freeze([
  'governance_schema',
  'governed_targets',
  'governed_invocations',
  'authority_events',
])

export type GovernedInvocationState =
  | 'ACTIVE'
  | 'COMPLETED'
  | 'RECOVERY_REQUIRED'
  | 'ABANDONED'

export type GovernedInfrastructureStatus = 'HEALTHY' | 'BLOCKED' | 'RECOVERY_REQUIRED'

export interface AcceptedGovernedInvocation {
  readonly targetId: string
  readonly invocationId: string
  readonly sequence: bigint
  readonly stateRevision: bigint
  readonly acceptedAuthorityEpoch: bigint
  readonly lastAuthorityEpoch: bigint
  readonly previousCompletedInvocationId: string | null
}

export interface GovernedInvocationExpectation {
  readonly targetId: string
  readonly invocationId: string
  readonly sequence: bigint
  readonly stateRevision: bigint
  readonly authorityEpoch: bigint
}

export interface GovernedCompletionEvidence {
  readonly reportBytes: Buffer
  readonly reportSha256: string
  readonly resultStatus: ValidationStatus
  readonly terminalAt: string
}

export type GovernedAcceptanceResult =
  | { readonly kind: 'ACCEPTED'; readonly invocation: AcceptedGovernedInvocation }
  | { readonly kind: 'CONFLICT'; readonly invocationId: string; readonly state: 'ACTIVE' | 'RECOVERY_REQUIRED' }

export type GovernedCompletionResult =
  | { readonly kind: 'COMPLETED'; readonly invocation: AcceptedGovernedInvocation; readonly idempotent: boolean }
  | { readonly kind: 'CONFLICT'; readonly reason: string }

export type GovernedRecoveryResult =
  | { readonly kind: 'RECOVERY_REQUIRED'; readonly invocation: AcceptedGovernedInvocation; readonly idempotent: boolean }
  | { readonly kind: 'ABANDONED'; readonly invocation: AcceptedGovernedInvocation; readonly idempotent: boolean }
  | { readonly kind: 'CONFLICT'; readonly reason: string }

export interface GovernanceValidationSidecarHandle {
  readonly databasePath: string
  close(): void
  acceptInvocation(targetId: string, invocationId?: string, acceptedAt?: string): GovernedAcceptanceResult
  completeInvocation(
    expected: GovernedInvocationExpectation,
    evidence: GovernedCompletionEvidence,
    infrastructureStatus?: Exclude<GovernedInfrastructureStatus, 'RECOVERY_REQUIRED'>,
  ): GovernedCompletionResult
  requireRecovery(expected: GovernedInvocationExpectation, recoveryRequestId: string, reason: string): GovernedRecoveryResult
  abandonInvocation(
    expected: GovernedInvocationExpectation,
    recoveryRequestId: string,
    reason: string,
    terminalAt?: string,
  ): GovernedRecoveryResult
  readGovernedCurrent(targetId: string): GovernedAuthorityRead
  readGovernedInvocation(targetId: string, invocationId: string): GovernedAuthorityRead | HistoricalGovernedEvidence
  integrityCheck(): {
    readonly integrity: string
    readonly foreignKeyViolations: readonly unknown[]
    readonly authorityAuditViolations: readonly unknown[]
  }
}

export interface HistoricalGovernedEvidence {
  readonly kind: 'HISTORICAL'
  readonly targetId: string
  readonly invocationId: string
  readonly sequence: bigint
  readonly state: GovernedInvocationState
  readonly report: ValidationReport | null
}

export type GovernedAuthorityRead =
  | { readonly kind: 'NONE'; readonly targetId: string }
  | {
      readonly kind: 'CURRENT_COMPLETED'
      readonly targetId: string
      readonly invocationId: string
      readonly sequence: bigint
      readonly authorityEpoch: bigint
      readonly report: ValidationReport
    }
  | {
      readonly kind: 'INCOMPLETE'
      readonly targetId: string
      readonly invocationId: string
      readonly sequence: bigint
      readonly authorityEpoch: bigint
      readonly lastCompleted: HistoricalGovernedEvidence | null
    }
  | {
      readonly kind: 'RECOVERY_REQUIRED'
      readonly targetId: string
      readonly invocationId: string
      readonly sequence: bigint
      readonly authorityEpoch: bigint
      readonly reason: string
      readonly lastCompleted: HistoricalGovernedEvidence | null
    }
  | {
      readonly kind: 'ABANDONED'
      readonly targetId: string
      readonly invocationId: string
      readonly sequence: bigint
      readonly authorityEpoch: bigint
      readonly lastCompleted: HistoricalGovernedEvidence | null
    }
  | { readonly kind: 'INVALID'; readonly targetId: string; readonly reason: string }
  | { readonly kind: 'UNAVAILABLE'; readonly targetId: string; readonly reason: string }

interface TargetRow {
  target_id: string
  next_sequence: bigint
  authority_epoch: bigint
}

interface InvocationRow {
  invocation_id: string
  target_id: string
  sequence: bigint
  state: GovernedInvocationState
  state_revision: bigint
  accepted_authority_epoch: bigint
  last_authority_epoch: bigint
  previous_completed_invocation_id: string | null
  accepted_at: string
  terminal_at: string | null
  result_status: ValidationStatus | null
  infrastructure_status: GovernedInfrastructureStatus
  report_bytes: Buffer | null
  report_sha256: string | null
  recovery_request_id: string | null
  recovery_reason: string | null
}

interface AuthorityEventRow {
  target_id: string
  authority_epoch: bigint
  invocation_id: string
  sequence: bigint
  state_revision: bigint
  event_type: 'ACCEPTED' | 'COMPLETED' | 'RECOVERY_REQUIRED' | 'ABANDONED'
  prior_state: 'ACTIVE' | 'RECOVERY_REQUIRED' | null
  new_state: GovernedInvocationState
}

const SCHEMA_SQL = `
CREATE TABLE governance_schema (
  component TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK(version BETWEEN 1 AND ${MAX_AUTHORITY_INTEGER})
) STRICT;

CREATE TABLE governed_targets (
  target_id TEXT PRIMARY KEY
    CHECK(length(target_id) BETWEEN 1 AND 64)
    CHECK(target_id = lower(target_id))
    CHECK(target_id NOT GLOB '*[^a-z0-9._-]*')
    CHECK(substr(target_id, 1, 1) GLOB '[a-z0-9]'),
  next_sequence INTEGER NOT NULL
    CHECK(next_sequence BETWEEN 1 AND ${MAX_AUTHORITY_INTEGER}),
  authority_epoch INTEGER NOT NULL
    CHECK(authority_epoch BETWEEN 0 AND ${MAX_AUTHORITY_INTEGER})
) STRICT;

CREATE TABLE governed_invocations (
  invocation_id TEXT PRIMARY KEY CHECK(length(invocation_id) = 36),
  target_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND ${MAX_AUTHORITY_INTEGER}),
  state TEXT NOT NULL CHECK(state IN ('ACTIVE', 'COMPLETED', 'RECOVERY_REQUIRED', 'ABANDONED')),
  state_revision INTEGER NOT NULL CHECK(state_revision BETWEEN 0 AND ${MAX_AUTHORITY_INTEGER}),
  accepted_authority_epoch INTEGER NOT NULL CHECK(accepted_authority_epoch BETWEEN 1 AND ${MAX_AUTHORITY_INTEGER}),
  last_authority_epoch INTEGER NOT NULL CHECK(last_authority_epoch BETWEEN accepted_authority_epoch AND ${MAX_AUTHORITY_INTEGER}),
  previous_completed_invocation_id TEXT,
  accepted_at TEXT NOT NULL CHECK(
    length(accepted_at) = 24
    AND accepted_at GLOB '????-??-??T??:??:??.???Z'
    AND substr(accepted_at, 12, 2) BETWEEN '00' AND '23'
    AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', accepted_at) = accepted_at, 0)
  ),
  terminal_at TEXT CHECK(terminal_at IS NULL OR (
    length(terminal_at) = 24
    AND terminal_at GLOB '????-??-??T??:??:??.???Z'
    AND substr(terminal_at, 12, 2) BETWEEN '00' AND '23'
    AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', terminal_at) = terminal_at, 0)
  )),
  result_status TEXT CHECK(result_status IS NULL OR result_status IN ('PASS', 'FAIL', 'BLOCKED', 'NOT_RUN')),
  infrastructure_status TEXT NOT NULL CHECK(infrastructure_status IN ('HEALTHY', 'BLOCKED', 'RECOVERY_REQUIRED')),
  report_bytes BLOB,
  report_sha256 TEXT CHECK(report_sha256 IS NULL OR (length(report_sha256) = 64 AND report_sha256 NOT GLOB '*[^a-f0-9]*')),
  recovery_request_id TEXT CHECK(recovery_request_id IS NULL OR length(recovery_request_id) = 36),
  recovery_reason TEXT CHECK(recovery_reason IS NULL OR length(recovery_reason) > 0),

  FOREIGN KEY(target_id) REFERENCES governed_targets(target_id),
  FOREIGN KEY(target_id, previous_completed_invocation_id)
    REFERENCES governed_invocations(target_id, invocation_id),
  UNIQUE(target_id, invocation_id),
  UNIQUE(target_id, sequence),

  CHECK(last_authority_epoch = accepted_authority_epoch + state_revision),

  CHECK(
    (state = 'ACTIVE'
      AND state_revision = 0
      AND terminal_at IS NULL
      AND result_status IS NULL
      AND infrastructure_status = 'HEALTHY'
      AND report_bytes IS NULL
      AND report_sha256 IS NULL
      AND recovery_request_id IS NULL
      AND recovery_reason IS NULL)
    OR
    (state = 'COMPLETED'
      AND state_revision = 1
      AND terminal_at IS NOT NULL
      AND result_status IS NOT NULL
      AND infrastructure_status IN ('HEALTHY', 'BLOCKED')
      AND NOT (result_status = 'PASS' AND infrastructure_status = 'BLOCKED')
      AND report_bytes IS NOT NULL
      AND report_sha256 IS NOT NULL
      AND recovery_request_id IS NULL
      AND recovery_reason IS NULL)
    OR
    (state = 'RECOVERY_REQUIRED'
      AND state_revision = 1
      AND terminal_at IS NULL
      AND result_status IS NULL
      AND infrastructure_status = 'RECOVERY_REQUIRED'
      AND report_bytes IS NULL
      AND report_sha256 IS NULL
      AND recovery_request_id IS NOT NULL
      AND recovery_reason IS NOT NULL)
    OR
    (state = 'ABANDONED'
      AND state_revision IN (1, 2)
      AND terminal_at IS NOT NULL
      AND result_status IS NULL
      AND infrastructure_status = 'BLOCKED'
      AND report_bytes IS NULL
      AND report_sha256 IS NULL
      AND recovery_request_id IS NOT NULL
      AND recovery_reason IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX one_live_invocation_per_target
  ON governed_invocations(target_id)
  WHERE state IN ('ACTIVE', 'RECOVERY_REQUIRED');

CREATE TABLE authority_events (
  target_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch BETWEEN 1 AND ${MAX_AUTHORITY_INTEGER}),
  invocation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND ${MAX_AUTHORITY_INTEGER}),
  state_revision INTEGER NOT NULL CHECK(state_revision BETWEEN 0 AND ${MAX_AUTHORITY_INTEGER}),
  event_type TEXT NOT NULL CHECK(event_type IN ('ACCEPTED', 'COMPLETED', 'RECOVERY_REQUIRED', 'ABANDONED')),
  prior_state TEXT CHECK(prior_state IS NULL OR prior_state IN ('ACTIVE', 'RECOVERY_REQUIRED')),
  new_state TEXT NOT NULL CHECK(new_state IN ('ACTIVE', 'COMPLETED', 'RECOVERY_REQUIRED', 'ABANDONED')),
  recovery_request_id TEXT,
  recorded_at TEXT NOT NULL CHECK(
    length(recorded_at) = 24
    AND recorded_at GLOB '????-??-??T??:??:??.???Z'
    AND substr(recorded_at, 12, 2) BETWEEN '00' AND '23'
    AND COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', recorded_at) = recorded_at, 0)
  ),

  PRIMARY KEY(target_id, authority_epoch),
  UNIQUE(invocation_id, state_revision),
  FOREIGN KEY(target_id) REFERENCES governed_targets(target_id),
  FOREIGN KEY(target_id, invocation_id) REFERENCES governed_invocations(target_id, invocation_id)
) STRICT;

-- SQLite forbids schema-qualified DML table names inside trigger programs.
-- These non-TEMP triggers are created in MAIN, so their unqualified body
-- references are resolved within MAIN by SQLite. All application SQL below
-- the schema definition is independently and explicitly MAIN-qualified.

CREATE TRIGGER governance_schema_no_update
BEFORE UPDATE ON governance_schema BEGIN
  SELECT RAISE(ABORT, 'governance schema version is immutable outside explicit migration');
END;

CREATE TRIGGER governance_schema_no_delete
BEFORE DELETE ON governance_schema BEGIN
  SELECT RAISE(ABORT, 'governance schema version cannot be deleted');
END;

CREATE TRIGGER governed_targets_initial_projection
BEFORE INSERT ON governed_targets BEGIN
  SELECT CASE WHEN NEW.next_sequence <> 1 OR NEW.authority_epoch <> 0
    THEN RAISE(ABORT, 'new governed target counters must start at sequence 1 and epoch 0') END;
END;

CREATE TRIGGER governed_targets_projection_guard
BEFORE UPDATE ON governed_targets BEGIN
  SELECT CASE WHEN NEW.target_id <> OLD.target_id
    THEN RAISE(ABORT, 'governed target identity is immutable') END;
  SELECT CASE WHEN NEW.next_sequence <> COALESCE(
      (SELECT MAX(sequence) + 1 FROM governed_invocations WHERE target_id = OLD.target_id), 1)
    THEN RAISE(ABORT, 'governed target sequence projection mismatch') END;
  SELECT CASE WHEN NEW.authority_epoch <> COALESCE(
      (SELECT MAX(last_authority_epoch) FROM governed_invocations WHERE target_id = OLD.target_id), 0)
    THEN RAISE(ABORT, 'governed target authority epoch projection mismatch') END;
END;

CREATE TRIGGER governed_targets_no_delete
BEFORE DELETE ON governed_targets BEGIN
  SELECT RAISE(ABORT, 'governed targets cannot be deleted');
END;

CREATE TRIGGER governed_invocations_validate_insert
BEFORE INSERT ON governed_invocations BEGIN
  SELECT CASE WHEN NEW.state <> 'ACTIVE' OR NEW.state_revision <> 0
    THEN RAISE(ABORT, 'governed invocation must begin ACTIVE at revision 0') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM governed_targets WHERE target_id = NEW.target_id)
    THEN RAISE(ABORT, 'governed invocation target does not exist') END;
  SELECT CASE WHEN NEW.sequence <> (SELECT next_sequence FROM governed_targets WHERE target_id = NEW.target_id)
    THEN RAISE(ABORT, 'governed invocation sequence does not match target projection') END;
  SELECT CASE WHEN NEW.accepted_authority_epoch <> (SELECT authority_epoch + 1 FROM governed_targets WHERE target_id = NEW.target_id)
    OR NEW.last_authority_epoch <> NEW.accepted_authority_epoch
    OR NEW.last_authority_epoch <> NEW.accepted_authority_epoch + NEW.state_revision
    THEN RAISE(ABORT, 'governed invocation accepted epoch does not advance target authority') END;
  SELECT CASE WHEN EXISTS(
      SELECT 1 FROM governed_invocations
      WHERE target_id = NEW.target_id AND state IN ('ACTIVE', 'RECOVERY_REQUIRED'))
    THEN RAISE(ABORT, 'governed target already has a live invocation') END;
  SELECT CASE WHEN NEW.previous_completed_invocation_id IS NOT (
      SELECT invocation_id FROM governed_invocations
      WHERE target_id = NEW.target_id AND state = 'COMPLETED'
      ORDER BY sequence DESC LIMIT 1)
    THEN RAISE(ABORT, 'governed invocation predecessor is not the highest completed invocation') END;
END;

CREATE TRIGGER governed_invocations_after_insert
AFTER INSERT ON governed_invocations BEGIN
  UPDATE governed_targets
     SET next_sequence = NEW.sequence + 1,
         authority_epoch = NEW.last_authority_epoch
   WHERE target_id = NEW.target_id;
  INSERT INTO authority_events(
    target_id, authority_epoch, invocation_id, sequence, state_revision,
    event_type, prior_state, new_state, recovery_request_id, recorded_at
  ) VALUES (
    NEW.target_id, NEW.last_authority_epoch, NEW.invocation_id, NEW.sequence,
    NEW.state_revision, 'ACCEPTED', NULL, 'ACTIVE', NULL, NEW.accepted_at
  );
END;

CREATE TRIGGER governed_invocations_validate_update
BEFORE UPDATE ON governed_invocations BEGIN
  SELECT CASE WHEN NEW.invocation_id <> OLD.invocation_id
    OR NEW.target_id <> OLD.target_id
    OR NEW.sequence <> OLD.sequence
    OR NEW.accepted_authority_epoch <> OLD.accepted_authority_epoch
    OR NEW.accepted_at <> OLD.accepted_at
    OR NEW.previous_completed_invocation_id IS NOT OLD.previous_completed_invocation_id
    THEN RAISE(ABORT, 'governed invocation identity and acceptance metadata are immutable') END;
  SELECT CASE WHEN NOT (
      (OLD.state = 'ACTIVE' AND NEW.state IN ('COMPLETED', 'RECOVERY_REQUIRED', 'ABANDONED'))
      OR (OLD.state = 'RECOVERY_REQUIRED' AND NEW.state = 'ABANDONED'))
    THEN RAISE(ABORT, 'invalid governed invocation state transition') END;
  SELECT CASE WHEN NEW.state_revision <> OLD.state_revision + 1
    THEN RAISE(ABORT, 'governed invocation revision must advance exactly once') END;
  SELECT CASE WHEN OLD.last_authority_epoch <> OLD.accepted_authority_epoch + OLD.state_revision
    OR NEW.last_authority_epoch <> OLD.last_authority_epoch + 1
    OR NEW.last_authority_epoch <> NEW.accepted_authority_epoch + NEW.state_revision
    OR NEW.last_authority_epoch <> (SELECT authority_epoch + 1 FROM governed_targets WHERE target_id = OLD.target_id)
    THEN RAISE(ABORT, 'governed invocation epoch must advance target authority exactly once') END;
  SELECT CASE WHEN OLD.report_bytes IS NOT NULL OR OLD.report_sha256 IS NOT NULL
    THEN RAISE(ABORT, 'completed governed report evidence is immutable') END;
END;

CREATE TRIGGER governed_invocations_after_update
AFTER UPDATE ON governed_invocations BEGIN
  UPDATE governed_targets
     SET authority_epoch = NEW.last_authority_epoch
   WHERE target_id = NEW.target_id;
  INSERT INTO authority_events(
    target_id, authority_epoch, invocation_id, sequence, state_revision,
    event_type, prior_state, new_state, recovery_request_id, recorded_at
  ) VALUES (
    NEW.target_id, NEW.last_authority_epoch, NEW.invocation_id, NEW.sequence,
    NEW.state_revision, NEW.state, OLD.state, NEW.state,
    NEW.recovery_request_id, COALESCE(NEW.terminal_at, NEW.accepted_at)
  );
END;

CREATE TRIGGER governed_invocations_no_delete
BEFORE DELETE ON governed_invocations BEGIN
  SELECT RAISE(ABORT, 'governed invocations cannot be deleted');
END;

CREATE TRIGGER authority_events_validate_insert
BEFORE INSERT ON authority_events BEGIN
  SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM governed_invocations
      WHERE invocation_id = NEW.invocation_id
        AND target_id = NEW.target_id
        AND sequence = NEW.sequence
        AND state_revision = NEW.state_revision
        AND last_authority_epoch = NEW.authority_epoch
        AND state = NEW.new_state)
    THEN RAISE(ABORT, 'authority event does not match invocation transition') END;
  SELECT CASE WHEN NEW.authority_epoch <> (SELECT authority_epoch FROM governed_targets WHERE target_id = NEW.target_id)
    THEN RAISE(ABORT, 'authority event does not match target epoch') END;
  SELECT CASE WHEN (NEW.event_type = 'ACCEPTED' AND (NEW.prior_state IS NOT NULL OR NEW.new_state <> 'ACTIVE'))
      OR (NEW.event_type <> 'ACCEPTED' AND NEW.prior_state IS NULL)
    THEN RAISE(ABORT, 'authority event transition metadata is invalid') END;
  SELECT CASE WHEN (NEW.event_type = 'COMPLETED' AND (NEW.prior_state <> 'ACTIVE' OR NEW.new_state <> 'COMPLETED'))
      OR (NEW.event_type = 'RECOVERY_REQUIRED' AND (NEW.prior_state <> 'ACTIVE' OR NEW.new_state <> 'RECOVERY_REQUIRED'))
      OR (NEW.event_type = 'ABANDONED' AND (NEW.prior_state NOT IN ('ACTIVE', 'RECOVERY_REQUIRED') OR NEW.new_state <> 'ABANDONED'))
    THEN RAISE(ABORT, 'authority event state transition is invalid') END;
  SELECT CASE WHEN NEW.recovery_request_id IS NOT (
      SELECT recovery_request_id FROM governed_invocations WHERE invocation_id = NEW.invocation_id)
    THEN RAISE(ABORT, 'authority event recovery identity mismatch') END;
END;

CREATE TRIGGER authority_events_no_update
BEFORE UPDATE ON authority_events BEGIN
  SELECT RAISE(ABORT, 'authority events are append-only');
END;

CREATE TRIGGER authority_events_no_delete
BEFORE DELETE ON authority_events BEGIN
  SELECT RAISE(ABORT, 'authority events are append-only');
END;
`

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface SchemaObjectIdentity {
  readonly type: string
  readonly name: string
  readonly tableName: string
  readonly sql: string
}

function normalizeSchemaSql(sql: string): string {
  const tokens: string[] = []
  let quote: "'" | '"' | '`' | ']' | null = null
  let token = ''
  const flushToken = (): void => {
    if (token.length === 0) return
    tokens.push(token.toUpperCase())
    token = ''
  }
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    if (quote !== null) {
      token += character
      if (quote === ']' ? character === ']' : character === quote) {
        if (quote !== ']' && sql[index + 1] === quote) {
          token += sql[index + 1]
          index += 1
        } else {
          quote = null
          tokens.push(token)
          token = ''
        }
      }
      continue
    }
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      flushToken()
      quote = character === '[' ? ']' : character
      token = character
      continue
    }
    if (character === '-' && sql[index + 1] === '-') {
      flushToken()
      while (index + 1 < sql.length && sql[index + 1] !== '\n' && sql[index + 1] !== '\r') index += 1
      continue
    }
    if (character === '/' && sql[index + 1] === '*') {
      flushToken()
      index += 2
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) index += 1
      if (index >= sql.length) throw new Error('Governance schema contains an unterminated SQL comment.')
      index += 1
      continue
    }
    if (/\s/.test(character)) {
      flushToken()
      continue
    }
    if (/[A-Za-z0-9_$]/.test(character)) {
      token += character
      continue
    }
    flushToken()
    tokens.push(character)
  }
  if (quote !== null) throw new Error('Governance schema contains unterminated quoted SQL.')
  flushToken()
  while (tokens.at(-1) === ';') tokens.pop()
  return tokens.join(' ')
}

function schemaIdentity(database: BetterSqlite3.Database): {
  readonly fingerprint: string
  readonly objects: readonly SchemaObjectIdentity[]
} {
  const objects = (database.prepare(
    `SELECT type, name, tbl_name AS table_name, sql
       FROM main.sqlite_schema
      WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
      ORDER BY type, name`,
  ).all() as Array<{ type: string; name: string; table_name: string; sql: string }>).map(row => ({
    type: row.type,
    name: row.name,
    tableName: row.table_name,
    sql: normalizeSchemaSql(row.sql),
  }))
  return {
    fingerprint: createHash('sha256').update(JSON.stringify(objects)).digest('hex'),
    objects,
  }
}

let canonicalSchemaIdentity: ReturnType<typeof schemaIdentity> | null = null

function expectedSchemaIdentity(): ReturnType<typeof schemaIdentity> {
  if (canonicalSchemaIdentity) return canonicalSchemaIdentity
  const database = new BetterSqlite3(':memory:')
  try {
    database.exec(SCHEMA_SQL)
    canonicalSchemaIdentity = schemaIdentity(database)
    return canonicalSchemaIdentity
  } finally {
    database.close()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidationStatus(value: unknown): value is ValidationStatus {
  return value === 'PASS' || value === 'FAIL' || value === 'BLOCKED' || value === 'NOT_RUN'
}

function isFindingKind(value: unknown): value is FindingKind {
  return value === 'NONE' || value === 'BASELINE_DEBT' || value === 'NEW_REGRESSION'
}

function validateGate(value: unknown, index: number): ValidationGateResult {
  if (!isRecord(value)) throw new Error(`Validation gate ${index} is not an object.`)
  if (typeof value.id !== 'string' || value.id.length === 0) throw new Error(`Validation gate ${index} has no id.`)
  if (typeof value.title !== 'string' || typeof value.required !== 'boolean') {
    throw new Error(`Validation gate '${value.id}' has invalid identity metadata.`)
  }
  if (!isValidationStatus(value.status) || !isFindingKind(value.findingKind)) {
    throw new Error(`Validation gate '${value.id}' has invalid status or finding kind.`)
  }
  if (value.status !== 'FAIL' && value.findingKind !== 'NONE') {
    throw new Error(`Validation gate '${value.id}' assigns baseline classification to non-FAIL evidence.`)
  }
  if (typeof value.detail !== 'string' || typeof value.fingerprint !== 'string') {
    throw new Error(`Validation gate '${value.id}' has invalid evidence metadata.`)
  }
  if (!SHA256_PATTERN.test(value.fingerprint)) {
    throw new Error(`Validation gate '${value.id}' has an invalid fingerprint.`)
  }
  if (value.status !== 'PASS' && !isRecord(value.remedy)) {
    throw new Error(`Validation gate '${value.id}' lacks a remedy.`)
  }
  if (value.status === 'PASS' && value.remedy !== null) {
    throw new Error(`Validation gate '${value.id}' attaches a remedy to PASS evidence.`)
  }
  if (isRecord(value.remedy)
      && ((value.remedy.tier !== 1 && value.remedy.tier !== 2 && value.remedy.tier !== 3)
        || typeof value.remedy.action !== 'string'
        || value.remedy.action.length === 0)) {
    throw new Error(`Validation gate '${value.id}' has an invalid remedy.`)
  }
  return value as unknown as ValidationGateResult
}

export function decodeGovernedReportBytes(bytes: Buffer): ValidationReport {
  let text: string
  try {
    text = UTF8_DECODER.decode(bytes)
  } catch (cause) {
    throw new Error(`Governed report is not valid UTF-8: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error(`Governed report is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 'forge-validation-baseline/v1') {
    throw new Error('Governed report does not satisfy forge-validation-baseline/v1.')
  }
  if (parsed.profile !== 'offline' && parsed.profile !== 'product' && parsed.profile !== 'full') {
    throw new Error('Governed report has an invalid profile.')
  }
  if (!isRecord(parsed.referenceApplication)
      || parsed.referenceApplication.name !== 'SauceDemo'
      || parsed.referenceApplication.baseUrl !== 'https://www.saucedemo.com'
      || !Array.isArray(parsed.referenceApplication.smokeTests)
      || !parsed.referenceApplication.smokeTests.every(value => typeof value === 'string')) {
    throw new Error('Governed report has invalid reference-application metadata.')
  }
  if (!isRecord(parsed.repository)
      || typeof parsed.repository.commit !== 'string'
      || typeof parsed.repository.dirty !== 'boolean') {
    throw new Error('Governed report has invalid repository metadata.')
  }
  if (!isRecord(parsed.environment)
      || typeof parsed.environment.node !== 'string'
      || typeof parsed.environment.platform !== 'string'
      || typeof parsed.environment.architecture !== 'string') {
    throw new Error('Governed report has invalid environment metadata.')
  }
  if (typeof parsed.databasePath !== 'string'
      || !isRecord(parsed.comparison)
      || (parsed.comparison.mode !== 'none'
        && parsed.comparison.mode !== 'establish'
        && parsed.comparison.mode !== 'baseline')
      || (parsed.comparison.baselinePath !== null && typeof parsed.comparison.baselinePath !== 'string')) {
    throw new Error('Governed report has invalid database/comparison metadata.')
  }
  if (!Array.isArray(parsed.gates)) throw new Error('Governed report gates are missing.')
  const gates = parsed.gates.map(validateGate)
  if (new Set(gates.map(gate => gate.id)).size !== gates.length) {
    throw new Error('Governed report contains duplicate gate identities.')
  }
  if (!isValidationStatus(parsed.overallStatus)) throw new Error('Governed report has an invalid overall status.')
  if (aggregateValidationStatus(gates) !== parsed.overallStatus) {
    throw new Error('Governed report overall status does not match its required gate evidence.')
  }
  const report = parsed as unknown as ValidationReport
  if (deterministicValidationReportJson(report) !== text) {
    throw new Error('Governed report bytes are not the deterministic canonical serialization.')
  }
  return report
}

export function canonicalGovernedReportEvidence(report: ValidationReport): GovernedCompletionEvidence {
  const text = deterministicValidationReportJson(report)
  const bytes = Buffer.from(text, 'utf8')
  const decoded = decodeGovernedReportBytes(bytes)
  if (decoded.overallStatus !== report.overallStatus) {
    throw new Error('Governed report changed during canonical serialization.')
  }
  return Object.freeze({
    reportBytes: bytes,
    reportSha256: sha256(bytes),
    resultStatus: report.overallStatus,
    terminalAt: new Date().toISOString(),
  })
}

function validateTargetId(targetId: string): string {
  if (!TARGET_PATTERN.test(targetId)) {
    throw invalidAuthority(`Invalid governed target id '${targetId}'.`)
  }
  return targetId
}

function validateUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw invalidAuthority(`${label} must be a UUID.`)
  return value
}

function validateCounter(value: bigint, label: string, allowZero = false): bigint {
  const minimum = allowZero ? 0n : 1n
  if (value < minimum || value > MAX_AUTHORITY_INTEGER) {
    throw new Error(`${label} is outside the governed authority integer range.`)
  }
  return value
}

function validateCanonicalTimestamp(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp with millisecond precision.`)
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is not a canonical UTC timestamp.`)
  }
  return value
}

function isCanonicalTimestamp(value: string): boolean {
  try {
    validateCanonicalTimestamp(value, 'Governance timestamp')
    return true
  } catch {
    return false
  }
}

function validateLocalSidecarPath(databasePath: string): string {
  const resolved = path.resolve(databasePath)
  if (resolved.startsWith('\\\\') || resolved.startsWith('\\\\?\\') || resolved.startsWith('\\\\.\\')) {
    throw new Error('Governance sidecar requires a local fixed-disk path; UNC and device paths are unsupported.')
  }
  return resolved
}

function sqliteError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

class GovernanceAuthorityFailure extends Error {
  constructor(
    readonly authorityKind: 'INVALID' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.name = 'GovernanceAuthorityFailure'
  }
}

function invalidAuthority(message: string): GovernanceAuthorityFailure {
  return new GovernanceAuthorityFailure('INVALID', message)
}

function authorityFailureKind(cause: unknown): 'INVALID' | 'UNAVAILABLE' {
  if (cause instanceof GovernanceAuthorityFailure) return cause.authorityKind
  const sqliteCode = cause instanceof Error && 'code' in cause
    ? String((cause as Error & { code?: unknown }).code ?? '')
    : ''
  const invalidSqliteCodes = ['SQLITE_NOTADB', 'SQLITE_CORRUPT', 'SQLITE_FORMAT', 'SQLITE_SCHEMA']
  return invalidSqliteCodes.some(code => sqliteCode === code || sqliteCode.startsWith(`${code}_`))
    ? 'INVALID'
    : 'UNAVAILABLE'
}

function asAccepted(row: InvocationRow): AcceptedGovernedInvocation {
  return Object.freeze({
    targetId: row.target_id,
    invocationId: row.invocation_id,
    sequence: row.sequence,
    stateRevision: row.state_revision,
    acceptedAuthorityEpoch: row.accepted_authority_epoch,
    lastAuthorityEpoch: row.last_authority_epoch,
    previousCompletedInvocationId: row.previous_completed_invocation_id,
  })
}

class GovernanceValidationSidecar implements GovernanceValidationSidecarHandle {
  readonly databasePath: string
  private readonly db: BetterSqlite3.Database

  constructor(databasePath: string) {
    this.databasePath = validateLocalSidecarPath(databasePath)
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true })
    try {
      this.db = new BetterSqlite3(this.databasePath, { timeout: 5_000 })
    } catch (cause) {
      throw new GovernanceAuthorityFailure(
        authorityFailureKind(cause),
        `Governance sidecar could not be opened: ${sqliteError(cause)}`,
      )
    }
    this.db.defaultSafeIntegers(true)
    try {
      this.configureConnection()
      this.initializeOrVerify()
    } catch (cause) {
      this.db.close()
      throw cause
    }
  }

  close(): void {
    if (this.db.open) this.db.close()
  }

  /** Module-internal test harness access; never exposed by a production handle. */
  testDatabase(): BetterSqlite3.Database {
    return this.db
  }

  private configureConnection(): void {
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = DELETE')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('recursive_triggers = ON')
    this.db.pragma('trusted_schema = OFF')
    this.db.pragma('writable_schema = OFF')
    this.verifyConnectionConfiguration()
  }

  private verifyConnectionConfiguration(): void {
    const journalMode = String(this.db.pragma('journal_mode', { simple: true })).toLowerCase()
    const actual = {
      foreignKeys: BigInt(this.db.pragma('foreign_keys', { simple: true }) as number | bigint),
      journalMode,
      synchronous: BigInt(this.db.pragma('synchronous', { simple: true }) as number | bigint),
      busyTimeout: BigInt(this.db.pragma('busy_timeout', { simple: true }) as number | bigint),
      recursiveTriggers: BigInt(this.db.pragma('recursive_triggers', { simple: true }) as number | bigint),
      trustedSchema: BigInt(this.db.pragma('trusted_schema', { simple: true }) as number | bigint),
      writableSchema: BigInt(this.db.pragma('writable_schema', { simple: true }) as number | bigint),
    }
    if (actual.foreignKeys !== 1n
        || actual.journalMode !== 'delete'
        || actual.synchronous !== 2n
        || actual.busyTimeout !== 5_000n
        || actual.recursiveTriggers !== 1n
        || actual.trustedSchema !== 0n
        || actual.writableSchema !== 0n) {
      throw invalidAuthority(`Governance sidecar pragma verification failed: ${JSON.stringify({
        ...actual,
        foreignKeys: actual.foreignKeys.toString(),
        synchronous: actual.synchronous.toString(),
        busyTimeout: actual.busyTimeout.toString(),
        recursiveTriggers: actual.recursiveTriggers.toString(),
        trustedSchema: actual.trustedSchema.toString(),
        writableSchema: actual.writableSchema.toString(),
      })}`)
    }
    const databases = this.db.pragma('database_list') as Array<{ name: string }>
    const unexpectedDatabases = databases.map(database => database.name)
      .filter(name => name !== 'main' && name !== 'temp')
    if (unexpectedDatabases.length > 0) {
      throw invalidAuthority(`Governance sidecar connection has unexpected attached schemas: ${unexpectedDatabases.join(', ')}.`)
    }
    const temporaryAuthorityObjects = this.db.prepare(
      `SELECT type, name, tbl_name AS table_name
         FROM temp.sqlite_schema
        WHERE name IN (${AUTHORITY_OBJECT_NAMES.map(() => '?').join(', ')})
           OR tbl_name IN (${AUTHORITY_OBJECT_NAMES.map(() => '?').join(', ')})`,
    ).all(...AUTHORITY_OBJECT_NAMES, ...AUTHORITY_OBJECT_NAMES) as unknown[]
    if (temporaryAuthorityObjects.length > 0) {
      throw invalidAuthority('Governance sidecar connection contains TEMP authority-schema objects.')
    }
  }

  private initializeOrVerify(): void {
    const initialize = this.db.transaction(() => {
      const existingObjects = this.db.prepare(
        `SELECT name FROM main.sqlite_schema WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%'`,
      ).all() as Array<{ name: string }>
      const schemaTableExists = existingObjects.some(row => row.name === 'governance_schema')
      if (!schemaTableExists) {
        if (existingObjects.length > 0) {
          throw invalidAuthority('Existing governance sidecar has no recognized schema and will not be replaced.')
        }
        this.db.exec(SCHEMA_SQL)
        this.db.prepare(
          `INSERT INTO main.governance_schema(component, version) VALUES ('governance-validation', ?)`,
        ).run(SIDECAR_SCHEMA_VERSION)
      }
    })
    initialize.immediate()
    this.verifySchema()
  }

  private verifySchema(): void {
    this.verifyAuthorityStoreHealth()
    const row = this.db.prepare(
      `SELECT version FROM main.governance_schema WHERE component = 'governance-validation'`,
    ).get() as { version: bigint } | undefined
    if (!row) throw invalidAuthority('Governance sidecar schema version is missing.')
    if (row.version !== SIDECAR_SCHEMA_VERSION) {
      const direction = row.version > SIDECAR_SCHEMA_VERSION ? 'newer' : 'older'
      throw invalidAuthority(`Governance sidecar schema version ${row.version} is ${direction} than supported version ${SIDECAR_SCHEMA_VERSION}; implicit migration is forbidden.`)
    }
  }

  private verifyAuthorityStoreHealth(): void {
    const verify = this.db.transaction(() => this.verifyAuthorityStoreHealthInCurrentSnapshot())
    verify.deferred()
  }

  private verifyAuthorityStoreHealthInCurrentSnapshot(): void {
    this.verifySchemaDefinitions()
    const quickCheck = String(this.db.pragma('quick_check', { simple: true }))
    if (quickCheck !== 'ok') throw invalidAuthority(`Governance sidecar quick_check returned '${quickCheck}'.`)
    const foreignKeyViolations = this.db.pragma('foreign_key_check') as unknown[]
    if (foreignKeyViolations.length > 0) throw invalidAuthority('Governance sidecar contains foreign-key violations.')
    const semanticViolations = this.semanticAuthorityViolations()
    if (semanticViolations.length > 0) {
      throw invalidAuthority(
        `Governance sidecar contains semantic authority epoch/revision violations: ${
          semanticViolations[0]?.reason ?? 'unspecified semantic authority violation.'
        }`,
      )
    }
  }

  private verifySchemaDefinitions(): void {
    this.verifyConnectionConfiguration()
    const expected = expectedSchemaIdentity()
    const actual = schemaIdentity(this.db)
    if (actual.fingerprint !== expected.fingerprint) {
      const expectedByName = new Map(expected.objects.map(object => [`${object.type}:${object.name}`, object.sql]))
      const actualByName = new Map(actual.objects.map(object => [`${object.type}:${object.name}`, object.sql]))
      const changed = new Set<string>()
      for (const [name, sql] of expectedByName) {
        if (actualByName.get(name) !== sql) changed.add(name)
      }
      for (const name of actualByName.keys()) {
        if (!expectedByName.has(name)) changed.add(name)
      }
      throw invalidAuthority(
        `Governance sidecar schema definition fingerprint mismatch (${actual.fingerprint}; expected ${expected.fingerprint}). Changed objects: ${[...changed].sort().join(', ') || 'unknown'}.`,
      )
    }
  }

  acceptInvocation(targetId: string, invocationId = randomUUID(), acceptedAt = new Date().toISOString()): GovernedAcceptanceResult {
    this.verifyAuthorityStoreHealth()
    validateTargetId(targetId)
    validateUuid(invocationId, 'Governed invocation id')
    validateCanonicalTimestamp(acceptedAt, 'Governed invocation acceptance time')
    const accept = this.db.transaction((): GovernedAcceptanceResult => {
      this.db.prepare(
        `INSERT INTO main.governed_targets(target_id, next_sequence, authority_epoch)
         VALUES (?, 1, 0)
         ON CONFLICT(target_id) DO NOTHING`,
      ).run(targetId)
      const target = this.target(targetId)
      const live = this.db.prepare(
        `SELECT invocation_id, state FROM main.governed_invocations
         WHERE target_id = ? AND state IN ('ACTIVE', 'RECOVERY_REQUIRED')`,
      ).get(targetId) as { invocation_id: string; state: 'ACTIVE' | 'RECOVERY_REQUIRED' } | undefined
      if (live) return { kind: 'CONFLICT', invocationId: live.invocation_id, state: live.state }
      if (target.next_sequence >= MAX_AUTHORITY_INTEGER || target.authority_epoch >= MAX_AUTHORITY_INTEGER) {
        throw new Error('Governed authority counters are exhausted.')
      }
      const previous = this.db.prepare(
        `SELECT invocation_id FROM main.governed_invocations
         WHERE target_id = ? AND state = 'COMPLETED'
         ORDER BY sequence DESC LIMIT 1`,
      ).get(targetId) as { invocation_id: string } | undefined
      const acceptedEpoch = target.authority_epoch + 1n
      this.db.prepare(
        `INSERT INTO main.governed_invocations(
          invocation_id, target_id, sequence, state, state_revision,
          accepted_authority_epoch, last_authority_epoch,
          previous_completed_invocation_id, accepted_at, terminal_at,
          result_status, infrastructure_status, report_bytes, report_sha256,
          recovery_request_id, recovery_reason
        ) VALUES (?, ?, ?, 'ACTIVE', 0, ?, ?, ?, ?, NULL, NULL, 'HEALTHY', NULL, NULL, NULL, NULL)`,
      ).run(
        invocationId,
        targetId,
        target.next_sequence,
        acceptedEpoch,
        acceptedEpoch,
        previous?.invocation_id ?? null,
        acceptedAt,
      )
      const row = this.invocation(targetId, invocationId)
      return { kind: 'ACCEPTED', invocation: asAccepted(row) }
    })
    return accept.immediate()
  }

  completeInvocation(
    expected: GovernedInvocationExpectation,
    evidence: GovernedCompletionEvidence,
    infrastructureStatus: Exclude<GovernedInfrastructureStatus, 'RECOVERY_REQUIRED'> = 'HEALTHY',
  ): GovernedCompletionResult {
    this.verifyAuthorityStoreHealth()
    this.validateExpectation(expected)
    if (!SHA256_PATTERN.test(evidence.reportSha256) || sha256(evidence.reportBytes) !== evidence.reportSha256) {
      throw new Error('Governed completion report hash does not match its exact bytes.')
    }
    const decoded = decodeGovernedReportBytes(evidence.reportBytes)
    if (decoded.overallStatus !== evidence.resultStatus) {
      throw new Error('Governed completion result status does not match its report bytes.')
    }
    validateCanonicalTimestamp(evidence.terminalAt, 'Governed completion terminal time')
    if (evidence.resultStatus === 'PASS' && infrastructureStatus !== 'HEALTHY') {
      throw new Error('Governed PASS requires healthy infrastructure.')
    }
    const complete = this.db.transaction((): GovernedCompletionResult => {
      const row = this.invocationOrNull(expected.targetId, expected.invocationId)
      if (!row) return { kind: 'CONFLICT', reason: 'Governed invocation does not exist.' }
      if (row.state === 'COMPLETED') {
        const identical = row.sequence === expected.sequence
          && row.accepted_authority_epoch === expected.authorityEpoch
          && row.state_revision === expected.stateRevision + 1n
          && row.last_authority_epoch === expected.authorityEpoch + 1n
          && row.terminal_at === evidence.terminalAt
          && row.report_sha256 === evidence.reportSha256
          && row.result_status === evidence.resultStatus
          && row.infrastructure_status === infrastructureStatus
          && row.report_bytes !== null
          && row.report_bytes.equals(evidence.reportBytes)
        return identical
          ? { kind: 'COMPLETED', invocation: asAccepted(row), idempotent: true }
          : { kind: 'CONFLICT', reason: 'Completed governed evidence differs from the retry.' }
      }
      const target = this.target(expected.targetId)
      if (row.state !== 'ACTIVE'
          || row.sequence !== expected.sequence
          || row.state_revision !== expected.stateRevision
          || row.last_authority_epoch !== expected.authorityEpoch
          || target.authority_epoch !== expected.authorityEpoch) {
        return { kind: 'CONFLICT', reason: 'Governed completion authority is stale or no longer ACTIVE.' }
      }
      if (target.authority_epoch >= MAX_AUTHORITY_INTEGER || row.state_revision >= MAX_AUTHORITY_INTEGER) {
        throw new Error('Governed authority counters are exhausted.')
      }
      const result = this.db.prepare(
        `UPDATE main.governed_invocations
            SET state = 'COMPLETED',
                state_revision = state_revision + 1,
                last_authority_epoch = ?,
                terminal_at = ?,
                result_status = ?,
                infrastructure_status = ?,
                report_bytes = ?,
                report_sha256 = ?
          WHERE invocation_id = ? AND target_id = ? AND sequence = ?
            AND state = 'ACTIVE' AND state_revision = ? AND last_authority_epoch = ?`,
      ).run(
        target.authority_epoch + 1n,
        evidence.terminalAt,
        evidence.resultStatus,
        infrastructureStatus,
        evidence.reportBytes,
        evidence.reportSha256,
        expected.invocationId,
        expected.targetId,
        expected.sequence,
        expected.stateRevision,
        expected.authorityEpoch,
      )
      if (result.changes !== 1) return { kind: 'CONFLICT', reason: 'Governed completion compare-and-set failed.' }
      return { kind: 'COMPLETED', invocation: asAccepted(this.invocation(expected.targetId, expected.invocationId)), idempotent: false }
    })
    return complete.immediate()
  }

  requireRecovery(
    expected: GovernedInvocationExpectation,
    recoveryRequestId: string,
    reason: string,
  ): GovernedRecoveryResult {
    this.verifyAuthorityStoreHealth()
    this.validateExpectation(expected)
    validateUuid(recoveryRequestId, 'Governed recovery request id')
    if (reason.trim().length === 0) throw new Error('Governed recovery reason is required.')
    const transition = this.db.transaction((): GovernedRecoveryResult => {
      const row = this.invocationOrNull(expected.targetId, expected.invocationId)
      if (!row) return { kind: 'CONFLICT', reason: 'Governed invocation does not exist.' }
      if (row.state === 'RECOVERY_REQUIRED') {
        return row.sequence === expected.sequence
          && row.state_revision === expected.stateRevision + 1n
          && row.last_authority_epoch === expected.authorityEpoch + 1n
          && row.recovery_request_id === recoveryRequestId
          && row.recovery_reason === reason
          ? { kind: 'RECOVERY_REQUIRED', invocation: asAccepted(row), idempotent: true }
          : { kind: 'CONFLICT', reason: 'Governed invocation has a different recovery request.' }
      }
      const target = this.target(expected.targetId)
      if (row.state !== 'ACTIVE'
          || row.sequence !== expected.sequence
          || row.state_revision !== expected.stateRevision
          || row.last_authority_epoch !== expected.authorityEpoch
          || target.authority_epoch !== expected.authorityEpoch) {
        return { kind: 'CONFLICT', reason: 'Governed recovery authority is stale or not ACTIVE.' }
      }
      if (target.authority_epoch >= MAX_AUTHORITY_INTEGER || row.state_revision >= MAX_AUTHORITY_INTEGER) {
        throw new Error('Governed authority counters are exhausted.')
      }
      const result = this.db.prepare(
        `UPDATE main.governed_invocations
            SET state = 'RECOVERY_REQUIRED', state_revision = state_revision + 1,
                last_authority_epoch = ?, infrastructure_status = 'RECOVERY_REQUIRED',
                recovery_request_id = ?, recovery_reason = ?
          WHERE invocation_id = ? AND target_id = ? AND sequence = ?
            AND state = 'ACTIVE' AND state_revision = ? AND last_authority_epoch = ?`,
      ).run(
        target.authority_epoch + 1n,
        recoveryRequestId,
        reason,
        expected.invocationId,
        expected.targetId,
        expected.sequence,
        expected.stateRevision,
        expected.authorityEpoch,
      )
      if (result.changes !== 1) return { kind: 'CONFLICT', reason: 'Governed recovery compare-and-set failed.' }
      return { kind: 'RECOVERY_REQUIRED', invocation: asAccepted(this.invocation(expected.targetId, expected.invocationId)), idempotent: false }
    })
    return transition.immediate()
  }

  abandonInvocation(
    expected: GovernedInvocationExpectation,
    recoveryRequestId: string,
    reason: string,
    terminalAt = new Date().toISOString(),
  ): GovernedRecoveryResult {
    this.verifyAuthorityStoreHealth()
    this.validateExpectation(expected)
    validateUuid(recoveryRequestId, 'Governed abandonment request id')
    if (reason.trim().length === 0) throw new Error('Governed abandonment reason is required.')
    validateCanonicalTimestamp(terminalAt, 'Governed abandonment terminal time')
    const abandon = this.db.transaction((): GovernedRecoveryResult => {
      const row = this.invocationOrNull(expected.targetId, expected.invocationId)
      if (!row) return { kind: 'CONFLICT', reason: 'Governed invocation does not exist.' }
      if (row.state === 'ABANDONED') {
        return row.sequence === expected.sequence
          && row.state_revision === expected.stateRevision + 1n
          && row.last_authority_epoch === expected.authorityEpoch + 1n
          && row.recovery_request_id === recoveryRequestId
          && row.recovery_reason === reason
          && row.terminal_at === terminalAt
          ? { kind: 'ABANDONED', invocation: asAccepted(row), idempotent: true }
          : { kind: 'CONFLICT', reason: 'Governed invocation was abandoned by a different recovery request.' }
      }
      const target = this.target(expected.targetId)
      if ((row.state !== 'ACTIVE' && row.state !== 'RECOVERY_REQUIRED')
          || row.sequence !== expected.sequence
          || row.state_revision !== expected.stateRevision
          || row.last_authority_epoch !== expected.authorityEpoch
          || target.authority_epoch !== expected.authorityEpoch) {
        return { kind: 'CONFLICT', reason: 'Governed abandonment authority is stale or terminal.' }
      }
      if (target.authority_epoch >= MAX_AUTHORITY_INTEGER || row.state_revision >= MAX_AUTHORITY_INTEGER) {
        throw new Error('Governed authority counters are exhausted.')
      }
      const result = this.db.prepare(
        `UPDATE main.governed_invocations
            SET state = 'ABANDONED', state_revision = state_revision + 1,
                last_authority_epoch = ?, terminal_at = ?, infrastructure_status = 'BLOCKED',
                recovery_request_id = ?, recovery_reason = ?
          WHERE invocation_id = ? AND target_id = ? AND sequence = ?
            AND state = ? AND state_revision = ? AND last_authority_epoch = ?`,
      ).run(
        target.authority_epoch + 1n,
        terminalAt,
        recoveryRequestId,
        reason,
        expected.invocationId,
        expected.targetId,
        expected.sequence,
        row.state,
        expected.stateRevision,
        expected.authorityEpoch,
      )
      if (result.changes !== 1) return { kind: 'CONFLICT', reason: 'Governed abandonment compare-and-set failed.' }
      return { kind: 'ABANDONED', invocation: asAccepted(this.invocation(expected.targetId, expected.invocationId)), idempotent: false }
    })
    return abandon.immediate()
  }

  readGovernedCurrent(targetId: string): GovernedAuthorityRead {
    try {
      validateTargetId(targetId)
      const read = this.db.transaction((): GovernedAuthorityRead => {
        this.verifyAuthorityStoreHealthInCurrentSnapshot()
        const target = this.db.prepare(
          `SELECT target_id, next_sequence, authority_epoch FROM main.governed_targets WHERE target_id = ?`,
        ).get(targetId) as TargetRow | undefined
        if (!target) return { kind: 'NONE', targetId }
        const invocations = this.db.prepare(
          `SELECT * FROM main.governed_invocations WHERE target_id = ? ORDER BY sequence ASC`,
        ).all(targetId) as InvocationRow[]
        const events = this.db.prepare(
          `SELECT target_id, authority_epoch, invocation_id, sequence, state_revision,
                  event_type, prior_state, new_state
             FROM main.authority_events
            WHERE target_id = ?
            ORDER BY authority_epoch ASC`,
        ).all(targetId) as AuthorityEventRow[]
        const latest = invocations.at(-1)
        if (!latest) {
          return target.next_sequence === 1n && target.authority_epoch === 0n
            ? { kind: 'NONE', targetId }
            : { kind: 'INVALID', targetId, reason: 'Target counters exist without invocation authority.' }
        }
        const validationError = this.validateAuthorityHistory(target, invocations, events)
        if (validationError) return { kind: 'INVALID', targetId, reason: validationError }
        const lastCompleted = this.historicalCompleted(targetId, latest.state === 'COMPLETED' ? latest.invocation_id : null)
        if (latest.state === 'ACTIVE') {
          return {
            kind: 'INCOMPLETE', targetId, invocationId: latest.invocation_id,
            sequence: latest.sequence, authorityEpoch: target.authority_epoch, lastCompleted,
          }
        }
        if (latest.state === 'RECOVERY_REQUIRED') {
          return {
            kind: 'RECOVERY_REQUIRED', targetId, invocationId: latest.invocation_id,
            sequence: latest.sequence, authorityEpoch: target.authority_epoch,
            reason: latest.recovery_reason ?? 'Recovery reason is missing.', lastCompleted,
          }
        }
        if (latest.state === 'ABANDONED') {
          return {
            kind: 'ABANDONED', targetId, invocationId: latest.invocation_id,
            sequence: latest.sequence, authorityEpoch: target.authority_epoch, lastCompleted,
          }
        }
        try {
          const report = this.decodeCompleted(latest)
          return {
            kind: 'CURRENT_COMPLETED', targetId, invocationId: latest.invocation_id,
            sequence: latest.sequence, authorityEpoch: target.authority_epoch, report,
          }
        } catch (cause) {
          return { kind: 'INVALID', targetId, reason: sqliteError(cause) }
        }
      })
      return read.deferred()
    } catch (cause) {
      const reason = sqliteError(cause)
      return { kind: authorityFailureKind(cause), targetId, reason }
    }
  }

  readGovernedInvocation(targetId: string, invocationId: string): GovernedAuthorityRead | HistoricalGovernedEvidence {
    try {
      validateTargetId(targetId)
      validateUuid(invocationId, 'Governed invocation id')
      const current = this.readGovernedCurrent(targetId)
      if (current.kind === 'INVALID' || current.kind === 'UNAVAILABLE') return current
      if ('invocationId' in current && current.invocationId === invocationId) return current
      const row = this.invocationOrNull(targetId, invocationId)
      if (!row) return { kind: 'INVALID', targetId, reason: 'Governed invocation does not exist.' }
      let report: ValidationReport | null = null
      if (row.state === 'COMPLETED') report = this.decodeCompleted(row)
      return {
        kind: 'HISTORICAL', targetId, invocationId, sequence: row.sequence,
        state: row.state, report,
      }
    } catch (cause) {
      return { kind: 'INVALID', targetId, reason: sqliteError(cause) }
    }
  }

  integrityCheck(): {
    readonly integrity: string
    readonly foreignKeyViolations: readonly unknown[]
    readonly authorityAuditViolations: readonly unknown[]
  } {
    const read = this.db.transaction(() => {
      this.verifySchemaDefinitions()
      return {
        integrity: String(this.db.pragma('integrity_check', { simple: true })),
        foreignKeyViolations: this.db.pragma('foreign_key_check') as unknown[],
        authorityAuditViolations: [
          ...this.db.prepare(
          `SELECT i.invocation_id, i.state_revision, i.last_authority_epoch,
                  COUNT(e.authority_epoch) AS matching_events
             FROM main.governed_invocations i
             LEFT JOIN main.authority_events e
               ON e.target_id = i.target_id
              AND e.invocation_id = i.invocation_id
              AND e.sequence = i.sequence
            GROUP BY i.invocation_id
           HAVING COUNT(e.authority_epoch) <> i.state_revision + 1
               OR SUM(CASE WHEN e.state_revision = i.state_revision
                             AND e.authority_epoch = i.last_authority_epoch
                             AND e.new_state = i.state THEN 1 ELSE 0 END) <> 1`,
          ).all(),
          ...this.semanticAuthorityViolations(),
        ],
      }
    })
    return read.deferred()
  }

  private validateExpectation(expected: GovernedInvocationExpectation): void {
    validateTargetId(expected.targetId)
    validateUuid(expected.invocationId, 'Governed invocation id')
    validateCounter(expected.sequence, 'Governed invocation sequence')
    validateCounter(expected.stateRevision, 'Governed invocation state revision', true)
    validateCounter(expected.authorityEpoch, 'Governed authority epoch')
  }

  private target(targetId: string): TargetRow {
    const row = this.db.prepare(
      `SELECT target_id, next_sequence, authority_epoch FROM main.governed_targets WHERE target_id = ?`,
    ).get(targetId) as TargetRow | undefined
    if (!row) throw new Error(`Governed target '${targetId}' does not exist.`)
    return row
  }

  private invocation(targetId: string, invocationId: string): InvocationRow {
    const row = this.invocationOrNull(targetId, invocationId)
    if (!row) throw new Error(`Governed invocation '${invocationId}' does not exist for target '${targetId}'.`)
    return row
  }

  private invocationOrNull(targetId: string, invocationId: string): InvocationRow | null {
    return (this.db.prepare(
      `SELECT * FROM main.governed_invocations WHERE target_id = ? AND invocation_id = ?`,
    ).get(targetId, invocationId) as InvocationRow | undefined) ?? null
  }

  private validateAuthorityHistory(
    target: TargetRow,
    invocations: readonly InvocationRow[],
    events: readonly AuthorityEventRow[],
  ): string | null {
    if (typeof target.next_sequence !== 'bigint'
        || typeof target.authority_epoch !== 'bigint'
        || target.next_sequence < 1n
        || target.next_sequence > MAX_AUTHORITY_INTEGER
        || target.authority_epoch < 0n
        || target.authority_epoch > MAX_AUTHORITY_INTEGER) {
      return 'Target authority counters are invalid.'
    }
    let expectedSequence = 1n
    let expectedAcceptedEpoch = 1n
    let lastCompletedInvocationId: string | null = null
    for (const invocation of invocations) {
      const bundleError = this.validateInvocationBundle(invocation)
      if (bundleError) return bundleError
      if (invocation.sequence !== expectedSequence) {
        return 'Governed invocation sequence history is not contiguous.'
      }
      if (invocation.accepted_authority_epoch !== expectedAcceptedEpoch) {
        return 'Governed invocation accepted authority epoch history is not contiguous.'
      }
      if (invocation.last_authority_epoch !== invocation.accepted_authority_epoch + invocation.state_revision) {
        return 'Governed invocation authority epoch does not equal its accepted epoch plus state revision.'
      }
      if (invocation.previous_completed_invocation_id !== lastCompletedInvocationId) {
        return 'Governed invocation predecessor is not the highest prior completed authority.'
      }
      if (invocation.state === 'COMPLETED') lastCompletedInvocationId = invocation.invocation_id
      expectedSequence += 1n
      expectedAcceptedEpoch = invocation.last_authority_epoch + 1n
    }
    const latest = invocations.at(-1)
    if (!latest) return 'Target authority history is empty.'
    if (target.next_sequence !== expectedSequence) return 'Target sequence projection does not match invocation history.'
    if (target.authority_epoch !== latest.last_authority_epoch) return 'Target epoch projection does not match invocation history.'
    const eventError = this.validateAuthorityEventHistory(target, invocations, events)
    if (eventError) return eventError
    return null
  }

  private validateAuthorityEventHistory(
    target: TargetRow,
    invocations: readonly InvocationRow[],
    events: readonly AuthorityEventRow[],
  ): string | null {
    const byInvocation = new Map(invocations.map(invocation => [invocation.invocation_id, invocation]))
    let expectedEpoch = 1n
    for (const event of events) {
      if (event.target_id !== target.target_id || event.authority_epoch !== expectedEpoch) {
        return 'Governed authority event epoch history is not contiguous.'
      }
      const invocation = byInvocation.get(event.invocation_id)
      if (!invocation
          || event.sequence !== invocation.sequence
          || event.state_revision < 0n
          || event.state_revision > invocation.state_revision
          || event.authority_epoch !== invocation.accepted_authority_epoch + event.state_revision) {
        return 'Governed authority event does not match its invocation epoch/revision history.'
      }
      const revision = event.state_revision
      const isAccepted = revision === 0n
        && event.event_type === 'ACCEPTED'
        && event.prior_state === null
        && event.new_state === 'ACTIVE'
      const isCompleted = revision === 1n
        && invocation.state === 'COMPLETED'
        && event.event_type === 'COMPLETED'
        && event.prior_state === 'ACTIVE'
        && event.new_state === 'COMPLETED'
      const isRecovery = revision === 1n
        && (invocation.state === 'RECOVERY_REQUIRED'
          || (invocation.state === 'ABANDONED' && invocation.state_revision === 2n))
        && event.event_type === 'RECOVERY_REQUIRED'
        && event.prior_state === 'ACTIVE'
        && event.new_state === 'RECOVERY_REQUIRED'
      const isDirectAbandonment = revision === 1n
        && invocation.state === 'ABANDONED'
        && invocation.state_revision === 1n
        && event.event_type === 'ABANDONED'
        && event.prior_state === 'ACTIVE'
        && event.new_state === 'ABANDONED'
      const isRecoveryAbandonment = revision === 2n
        && invocation.state === 'ABANDONED'
        && invocation.state_revision === 2n
        && event.event_type === 'ABANDONED'
        && event.prior_state === 'RECOVERY_REQUIRED'
        && event.new_state === 'ABANDONED'
      if (!isAccepted && !isCompleted && !isRecovery && !isDirectAbandonment && !isRecoveryAbandonment) {
        return 'Governed authority event encodes an impossible invocation state transition.'
      }
      expectedEpoch += 1n
    }
    if (expectedEpoch !== target.authority_epoch + 1n) {
      return 'Governed authority event history does not cover the target authority epoch.'
    }
    return null
  }

  private semanticAuthorityViolations(): ReadonlyArray<{ target_id: string; reason: string }> {
    const targets = this.db.prepare(
      `SELECT target_id, next_sequence, authority_epoch FROM main.governed_targets ORDER BY target_id`,
    ).all() as TargetRow[]
    const violations: Array<{ target_id: string; reason: string }> = []
    for (const target of targets) {
      const invocations = this.db.prepare(
        `SELECT * FROM main.governed_invocations WHERE target_id = ? ORDER BY sequence ASC`,
      ).all(target.target_id) as InvocationRow[]
      const events = this.db.prepare(
        `SELECT target_id, authority_epoch, invocation_id, sequence, state_revision,
                event_type, prior_state, new_state
           FROM main.authority_events
          WHERE target_id = ?
          ORDER BY authority_epoch ASC`,
      ).all(target.target_id) as AuthorityEventRow[]
      const reason = invocations.length === 0
        ? (target.next_sequence === 1n && target.authority_epoch === 0n
          ? null : 'Target counters exist without invocation authority.')
        : this.validateAuthorityHistory(target, invocations, events)
      if (reason) violations.push({ target_id: target.target_id, reason })
    }
    return violations
  }

  private validateInvocationBundle(row: InvocationRow): string | null {
    if (!UUID_PATTERN.test(row.invocation_id)
        || !TARGET_PATTERN.test(row.target_id)
        || typeof row.sequence !== 'bigint'
        || typeof row.state_revision !== 'bigint'
        || typeof row.accepted_authority_epoch !== 'bigint'
        || typeof row.last_authority_epoch !== 'bigint'
        || row.sequence < 1n
        || row.sequence > MAX_AUTHORITY_INTEGER
        || row.state_revision < 0n
        || row.state_revision > MAX_AUTHORITY_INTEGER
        || row.accepted_authority_epoch < 1n
        || row.last_authority_epoch < row.accepted_authority_epoch
        || row.last_authority_epoch > MAX_AUTHORITY_INTEGER
        || row.last_authority_epoch !== row.accepted_authority_epoch + row.state_revision
        || typeof row.accepted_at !== 'string'
        || (row.previous_completed_invocation_id !== null
          && !UUID_PATTERN.test(row.previous_completed_invocation_id))) {
      return 'Governed invocation identity/counter bundle is invalid.'
    }
    const noReport = row.report_bytes === null && row.report_sha256 === null && row.result_status === null
    if (row.state === 'ACTIVE') {
      return isCanonicalTimestamp(row.accepted_at)
        && row.state_revision === 0n
        && row.terminal_at === null
        && row.infrastructure_status === 'HEALTHY'
        && noReport
        && row.recovery_request_id === null
        && row.recovery_reason === null
        ? null : 'ACTIVE governed invocation has an invalid state bundle.'
    }
    if (row.state === 'COMPLETED') {
      return isCanonicalTimestamp(row.accepted_at)
        && row.state_revision === 1n
        && typeof row.terminal_at === 'string'
        && isCanonicalTimestamp(row.terminal_at)
        && isValidationStatus(row.result_status)
        && (row.infrastructure_status === 'HEALTHY' || row.infrastructure_status === 'BLOCKED')
        && !(row.result_status === 'PASS' && row.infrastructure_status === 'BLOCKED')
        && Buffer.isBuffer(row.report_bytes)
        && typeof row.report_sha256 === 'string'
        && row.recovery_request_id === null
        && row.recovery_reason === null
        ? null : 'COMPLETED governed invocation has an invalid state bundle.'
    }
    if (row.state === 'RECOVERY_REQUIRED') {
      return isCanonicalTimestamp(row.accepted_at)
        && row.state_revision === 1n
        && row.terminal_at === null
        && row.infrastructure_status === 'RECOVERY_REQUIRED'
        && noReport
        && typeof row.recovery_request_id === 'string'
        && UUID_PATTERN.test(row.recovery_request_id)
        && typeof row.recovery_reason === 'string'
        && row.recovery_reason.length > 0
        ? null : 'RECOVERY_REQUIRED governed invocation has an invalid state bundle.'
    }
    if (row.state === 'ABANDONED') {
      return isCanonicalTimestamp(row.accepted_at)
        && (row.state_revision === 1n || row.state_revision === 2n)
        && typeof row.terminal_at === 'string'
        && isCanonicalTimestamp(row.terminal_at)
        && row.infrastructure_status === 'BLOCKED'
        && noReport
        && typeof row.recovery_request_id === 'string'
        && UUID_PATTERN.test(row.recovery_request_id)
        && typeof row.recovery_reason === 'string'
        && row.recovery_reason.length > 0
        ? null : 'ABANDONED governed invocation has an invalid state bundle.'
    }
    return 'Governed invocation state is invalid.'
  }

  private historicalCompleted(targetId: string, excludeInvocationId: string | null): HistoricalGovernedEvidence | null {
    const row = this.db.prepare(
      `SELECT * FROM main.governed_invocations
       WHERE target_id = ? AND state = 'COMPLETED'
         AND (? IS NULL OR invocation_id <> ?)
       ORDER BY sequence DESC LIMIT 1`,
    ).get(targetId, excludeInvocationId, excludeInvocationId) as InvocationRow | undefined
    if (!row) return null
    let report: ValidationReport | null = null
    try { report = this.decodeCompleted(row) } catch { report = null }
    return {
      kind: 'HISTORICAL', targetId, invocationId: row.invocation_id,
      sequence: row.sequence, state: row.state, report,
    }
  }

  private decodeCompleted(row: InvocationRow): ValidationReport {
    if (row.state !== 'COMPLETED'
        || row.report_bytes === null
        || row.report_sha256 === null
        || row.result_status === null) {
      throw new Error('Completed governed invocation has incomplete report evidence.')
    }
    if (!SHA256_PATTERN.test(row.report_sha256) || sha256(row.report_bytes) !== row.report_sha256) {
      throw new Error('Completed governed report hash mismatch.')
    }
    const report = decodeGovernedReportBytes(row.report_bytes)
    if (report.overallStatus !== row.result_status) {
      throw new Error('Completed governed report status does not match stored authority result.')
    }
    return report
  }
}

function sealHandle(sidecar: GovernanceValidationSidecar): GovernanceValidationSidecarHandle {
  return Object.freeze({
    databasePath: sidecar.databasePath,
    close: () => sidecar.close(),
    acceptInvocation: sidecar.acceptInvocation.bind(sidecar),
    completeInvocation: sidecar.completeInvocation.bind(sidecar),
    requireRecovery: sidecar.requireRecovery.bind(sidecar),
    abandonInvocation: sidecar.abandonInvocation.bind(sidecar),
    readGovernedCurrent: sidecar.readGovernedCurrent.bind(sidecar),
    readGovernedInvocation: sidecar.readGovernedInvocation.bind(sidecar),
    integrityCheck: sidecar.integrityCheck.bind(sidecar),
  })
}

/** Internal construction boundary used only by the fixed production facade and test support. */
export function openGovernanceSidecarAtPathInternal(databasePath: string): GovernanceValidationSidecarHandle {
  return sealHandle(new GovernanceValidationSidecar(databasePath))
}

/** Internal hostile-test boundary. The raw connection never crosses the production facade. */
export function openGovernanceSidecarHarnessAtPathInternal(databasePath: string): {
  readonly handle: GovernanceValidationSidecarHandle
  readonly database: BetterSqlite3.Database
} {
  const sidecar = new GovernanceValidationSidecar(databasePath)
  return Object.freeze({ handle: sealHandle(sidecar), database: sidecar.testDatabase() })
}

/**
 * Canonical fail-closed reader for callers that do not already own an open
 * sidecar connection. Opening/verification failures are authority results,
 * never exceptions that invite a fallback to generated JSON.
 */
export function readGovernedCurrentAtPathInternal(
  databasePath: string,
  targetId: string,
): GovernedAuthorityRead {
  let sidecar: GovernanceValidationSidecar | null = null
  try {
    validateTargetId(targetId)
    const resolved = validateLocalSidecarPath(databasePath)
    if (!fs.existsSync(resolved)) return { kind: 'NONE', targetId }
    const file = fs.statSync(resolved)
    if (!file.isFile()) throw new Error('Governance sidecar path is not a regular file.')
    if (file.size === 0) return { kind: 'NONE', targetId }
    sidecar = new GovernanceValidationSidecar(databasePath)
    return sidecar.readGovernedCurrent(targetId)
  } catch (cause) {
    const reason = sqliteError(cause)
    return {
      kind: authorityFailureKind(cause),
      targetId,
      reason,
    }
  } finally {
    sidecar?.close()
  }
}

/** Internal fail-closed path reader for a specific governed invocation. */
export function readGovernedInvocationAtPathInternal(
  databasePath: string,
  targetId: string,
  invocationId: string,
): GovernedAuthorityRead | HistoricalGovernedEvidence {
  let sidecar: GovernanceValidationSidecar | null = null
  try {
    validateTargetId(targetId)
    validateUuid(invocationId, 'Governed invocation id')
    const resolved = validateLocalSidecarPath(databasePath)
    if (!fs.existsSync(resolved)) {
      return { kind: 'INVALID', targetId, reason: 'Governance sidecar does not contain the requested invocation.' }
    }
    const file = fs.statSync(resolved)
    if (!file.isFile()) throw new Error('Governance sidecar path is not a regular file.')
    if (file.size === 0) {
      return { kind: 'INVALID', targetId, reason: 'Governance sidecar does not contain the requested invocation.' }
    }
    sidecar = new GovernanceValidationSidecar(databasePath)
    return sidecar.readGovernedInvocation(targetId, invocationId)
  } catch (cause) {
    const reason = sqliteError(cause)
    return {
      kind: authorityFailureKind(cause),
      targetId,
      reason,
    }
  } finally {
    sidecar?.close()
  }
}

export const GOVERNANCE_SIDECAR_LIMITS = Object.freeze({
  schemaVersion: SIDECAR_SCHEMA_VERSION,
  maxAuthorityInteger: MAX_AUTHORITY_INTEGER,
  schemaFingerprint: expectedSchemaIdentity().fingerprint,
})
