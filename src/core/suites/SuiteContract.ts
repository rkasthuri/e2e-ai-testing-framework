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

export type SuiteRefusalCode =
  | 'stale_suite_authority' | 'suite_members_not_single_test_set' | 'suite_integrity_invalid'
  | 'suite_not_found' | 'suite_revision_not_found' | 'stale_suite_revision' | 'empty_suite'
  | 'too_many_suite_members' | 'duplicate_suite_name' | 'duplicate_suite_member'
  | 'cross_project_definition' | 'definition_authority_not_found' | 'definition_authority_mismatch'
  | 'unsupported_definition_schema' | 'suite_change_intent_conflict' | 'suite_not_execution_eligible'

export interface DefinitionRevisionRef {
  definitionId: string
  definitionSchemaVersion: 2 | 3
  testSetId: string
  testSetRevision: number
  testSetContentHash: string
}

export interface MultiSourceDefinitionRevisionRef extends DefinitionRevisionRef {
  testSetRowId: number
}

interface CanonicalSuiteRevisionBase<TSchema extends 1 | 2, TAuthority extends DefinitionRevisionRef> {
  schemaVersion: TSchema
  suiteId: string
  projectId: string
  revision: number
  name: string
  purpose: 'sanity'
  members: Array<{ ordinal: number; definitionAuthority: TAuthority }>
  createdAt: string
  provenance: {
    source: 'product_api'
    changeKind: 'created' | 'revised'
    priorRevision: number | null
    changeIntentKey: string
    changeIntentFingerprint: string
  }
  contentHash: string
}

export type CanonicalSuiteRevisionV1 = CanonicalSuiteRevisionBase<1, DefinitionRevisionRef>
export type CanonicalSuiteRevisionV2 = CanonicalSuiteRevisionBase<2, MultiSourceDefinitionRevisionRef>
export type CanonicalSuiteRevision = CanonicalSuiteRevisionV1 | CanonicalSuiteRevisionV2

export class SuiteContractError extends Error {
  constructor(readonly code: SuiteRefusalCode, message: string) { super(message); this.name = 'SuiteContractError' }
}

export function normalizeSuiteName(input: string): { name: string; key: string } {
  if (typeof input !== 'string') throw new SuiteContractError('suite_integrity_invalid', 'Suite name is invalid.')
  const normalized = input.normalize('NFKC')
  const name = normalized.trim().replace(/\s+/gu, ' ')
  if (/\p{Cc}/u.test(normalized) || [...name].length < 1 || [...name].length > 120) {
    throw new SuiteContractError('suite_integrity_invalid', 'Suite name is invalid.')
  }
  return { name, key: name.toLocaleLowerCase('en-US') }
}

function definitionRevisionMaterial(value: DefinitionRevisionRef) {
  return {
    definitionId: value.definitionId,
    definitionSchemaVersion: value.definitionSchemaVersion,
    testSetId: value.testSetId,
    testSetRevision: value.testSetRevision,
    testSetContentHash: value.testSetContentHash,
  }
}

function multiSourceDefinitionRevisionMaterial(value: MultiSourceDefinitionRevisionRef) {
  return { testSetRowId: value.testSetRowId, ...definitionRevisionMaterial(value) }
}

export function suiteHash(value: Omit<CanonicalSuiteRevision, 'contentHash'>): string {
  const material = {
    schemaVersion: value.schemaVersion,
    suiteId: value.suiteId,
    projectId: value.projectId,
    revision: value.revision,
    name: value.name,
    purpose: value.purpose,
    members: value.members.map(member => ({
      ordinal: member.ordinal,
      definitionAuthority: value.schemaVersion === 1
        ? definitionRevisionMaterial(member.definitionAuthority)
        : multiSourceDefinitionRevisionMaterial(member.definitionAuthority as MultiSourceDefinitionRevisionRef),
    })),
    createdAt: value.createdAt,
    provenance: {
      source: value.provenance.source,
      changeKind: value.provenance.changeKind,
      priorRevision: value.provenance.priorRevision,
      changeIntentKey: value.provenance.changeIntentKey,
      changeIntentFingerprint: value.provenance.changeIntentFingerprint,
    },
  }
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

export function suiteChangeFingerprint(input: {
  schemaVersion?: 1 | 2
  operation: 'created' | 'revised'; projectId: string; suiteId: string | null; expectedRevision: number | null
  name: string; members: Array<DefinitionRevisionRef | MultiSourceDefinitionRevisionRef>
}): string {
  const schemaVersion = input.schemaVersion ?? 1
  const material = {
    schemaVersion,
    operation: input.operation,
    projectId: input.projectId,
    suiteId: input.suiteId,
    expectedRevision: input.expectedRevision,
    name: input.name,
    purpose: 'sanity',
    members: input.members.map(member => schemaVersion === 1
      ? definitionRevisionMaterial(member)
      : multiSourceDefinitionRevisionMaterial(member as MultiSourceDefinitionRevisionRef)),
  }
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex')
}
