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

export type CanonicalSuitePurpose = 'sanity'

export interface SuiteDefinitionAuthority {
  definitionId: string
  definitionSchemaVersion: 2 | 3
  testSetId: string
  testSetRevision: number
  testSetContentHash: string
}

export interface CanonicalSuiteMember {
  ordinal: number
  definitionAuthority: SuiteDefinitionAuthority
}

export interface CanonicalSuiteRevision {
  schemaVersion: 1
  suiteId: string
  projectId: string
  revision: number
  name: string
  purpose: CanonicalSuitePurpose
  members: readonly CanonicalSuiteMember[]
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

export interface CanonicalSuiteCandidate {
  title: string
  definitionAuthority: SuiteDefinitionAuthority
}

export interface CanonicalSuiteCandidateSet {
  projectId: string
  testSetAuthority: Omit<SuiteDefinitionAuthority, 'definitionId'>
  definitions: readonly CanonicalSuiteCandidate[]
}

export type SuiteChangeRequest =
  | {
      kind: 'create'
      changeIntentKey: string
      name: string
      purpose: 'sanity'
      members: readonly SuiteDefinitionAuthority[]
    }
  | {
      kind: 'revise'
      suiteId: string
      expectedRevision: number
      changeIntentKey: string
      name: string
      purpose: 'sanity'
      members: readonly SuiteDefinitionAuthority[]
    }

export interface SuitePresentationIntent {
  suiteId: string
  suiteRevision: number
}

export interface SuiteExecutionStartBody {
  executionIntentKey: string
  selection: { kind: 'suite_revision'; suiteId: string; suiteRevision: number }
}

export interface CanonicalSuiteSelectionAuthority {
  kind: 'suite_revision'
  suiteId: string
  suiteRevision: number
  suiteContentHash: string
  name: string
  purpose: 'sanity'
}

export class SuiteContractError extends Error {
  constructor(message = 'Canonical Suite payload is malformed.') {
    super(message)
    this.name = 'SuiteContractError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const INTENT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const SUITE_ID = /^suite-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UTC_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function record(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SuiteContractError(`${label} must be an object.`)
  const result = value as Record<string, unknown>
  const unexpected = Object.keys(result).find(key => !allowed.includes(key))
  if (unexpected) throw new SuiteContractError(`${label} contains unknown field ${unexpected}.`)
  return result
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new SuiteContractError(`${label} must be a non-empty string.`)
  return value
}

function id(value: unknown, label: string): string {
  const result = text(value, label)
  if (!ID.test(result)) throw new SuiteContractError(`${label} is malformed.`)
  return result
}

function canonicalSuiteId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SUITE_ID.test(value)) throw new SuiteContractError(`${label} is malformed.`)
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new SuiteContractError(`${label} must be a positive integer.`)
  return Number(value)
}

function hash(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SHA256.test(result)) throw new SuiteContractError(`${label} is malformed.`)
  return result
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UTC_ISO_TIMESTAMP.test(value)) throw new SuiteContractError(`${label} is malformed.`)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new SuiteContractError(`${label} is malformed.`)
  return value
}

function decodeDefinitionAuthority(value: unknown, label: string): SuiteDefinitionAuthority {
  const source = record(value, ['definitionId', 'definitionSchemaVersion', 'testSetId', 'testSetRevision', 'testSetContentHash'], label)
  if (source.definitionSchemaVersion !== 2 && source.definitionSchemaVersion !== 3) {
    throw new SuiteContractError(`${label}.definitionSchemaVersion is unsupported.`)
  }
  return Object.freeze({
    definitionId: id(source.definitionId, `${label}.definitionId`),
    definitionSchemaVersion: source.definitionSchemaVersion,
    testSetId: id(source.testSetId, `${label}.testSetId`),
    testSetRevision: positiveInteger(source.testSetRevision, `${label}.testSetRevision`),
    testSetContentHash: hash(source.testSetContentHash, `${label}.testSetContentHash`),
  })
}

function sameTestSet(left: SuiteDefinitionAuthority, right: SuiteDefinitionAuthority): boolean {
  return left.definitionSchemaVersion === right.definitionSchemaVersion
    && left.testSetId === right.testSetId
    && left.testSetRevision === right.testSetRevision
    && left.testSetContentHash === right.testSetContentHash
}

export function decodeCanonicalSuiteRevision(value: unknown, expectedProjectId?: string): CanonicalSuiteRevision {
  const source = record(value, ['schemaVersion', 'suiteId', 'projectId', 'revision', 'name', 'purpose', 'members', 'createdAt', 'provenance', 'contentHash'], 'Suite revision')
  if (source.schemaVersion !== 1 || source.purpose !== 'sanity') throw new SuiteContractError('Suite revision schema or purpose is unsupported.')
  const projectId = id(source.projectId, 'Suite revision projectId')
  if (expectedProjectId && projectId !== expectedProjectId) throw new SuiteContractError('Suite revision project identity does not match the request.')
  if (!Array.isArray(source.members) || source.members.length < 1 || source.members.length > 50) throw new SuiteContractError('Suite revision member count is invalid.')
  const members = source.members.map((value, index) => {
    const member = record(value, ['ordinal', 'definitionAuthority'], `members[${index}]`)
    const ordinal = positiveInteger(member.ordinal, `members[${index}].ordinal`)
    if (ordinal !== index + 1) throw new SuiteContractError('Suite revision ordinals must be contiguous and ordered.')
    return Object.freeze({ ordinal, definitionAuthority: decodeDefinitionAuthority(member.definitionAuthority, `members[${index}].definitionAuthority`) })
  })
  if (new Set(members.map(member => member.definitionAuthority.definitionId)).size !== members.length) throw new SuiteContractError('Suite revision contains duplicate Definitions.')
  if (members.some(member => !sameTestSet(member.definitionAuthority, members[0].definitionAuthority))) throw new SuiteContractError('Suite revision members do not share one Test Set authority.')
  const provenance = record(source.provenance, ['source', 'changeKind', 'priorRevision', 'changeIntentKey', 'changeIntentFingerprint'], 'Suite revision provenance')
  if (provenance.source !== 'product_api' || provenance.changeKind !== 'created' && provenance.changeKind !== 'revised') throw new SuiteContractError('Suite revision provenance is unsupported.')
  const priorRevision = provenance.priorRevision === null ? null : positiveInteger(provenance.priorRevision, 'Suite revision priorRevision')
  const revision = positiveInteger(source.revision, 'Suite revision revision')
  if (provenance.changeKind === 'created' && (revision !== 1 || priorRevision !== null)
    || provenance.changeKind === 'revised' && priorRevision !== revision - 1) throw new SuiteContractError('Suite revision provenance does not match revision identity.')
  return Object.freeze({
    schemaVersion: 1,
    suiteId: canonicalSuiteId(source.suiteId, 'Suite revision suiteId'),
    projectId,
    revision,
    name: text(source.name, 'Suite revision name'),
    purpose: 'sanity',
    members: Object.freeze(members),
    createdAt: timestamp(source.createdAt, 'Suite revision createdAt'),
    provenance: Object.freeze({
      source: 'product_api',
      changeKind: provenance.changeKind,
      priorRevision,
      changeIntentKey: id(provenance.changeIntentKey, 'Suite revision changeIntentKey'),
      changeIntentFingerprint: hash(provenance.changeIntentFingerprint, 'Suite revision changeIntentFingerprint'),
    }),
    contentHash: hash(source.contentHash, 'Suite revision contentHash'),
  })
}

export function decodeCanonicalSuiteHeads(value: unknown, expectedProjectId: string): readonly CanonicalSuiteRevision[] {
  const source = record(value, ['suites'], 'Suite heads')
  if (!Array.isArray(source.suites)) throw new SuiteContractError('Suite heads must contain an array.')
  const suites = source.suites.map(item => decodeCanonicalSuiteRevision(item, expectedProjectId))
  if (new Set(suites.map(item => item.suiteId)).size !== suites.length) throw new SuiteContractError('Suite heads contain duplicate Suite identity.')
  return Object.freeze(suites)
}

export function decodeCanonicalSuiteCandidateSet(value: unknown, expectedProjectId: string): CanonicalSuiteCandidateSet {
  const source = record(value, ['projectId', 'testSetAuthority', 'definitions'], 'Suite candidates')
  const projectId = id(source.projectId, 'Suite candidates projectId')
  if (projectId !== expectedProjectId) throw new SuiteContractError('Suite candidate project identity does not match the request.')
  const authority = record(source.testSetAuthority, ['definitionSchemaVersion', 'testSetId', 'testSetRevision', 'testSetContentHash'], 'Suite candidate Test Set authority')
  if (authority.definitionSchemaVersion !== 2 && authority.definitionSchemaVersion !== 3) throw new SuiteContractError('Suite candidate schema is unsupported.')
  const testSetAuthority = Object.freeze({
    definitionSchemaVersion: authority.definitionSchemaVersion,
    testSetId: id(authority.testSetId, 'Suite candidate testSetId'),
    testSetRevision: positiveInteger(authority.testSetRevision, 'Suite candidate testSetRevision'),
    testSetContentHash: hash(authority.testSetContentHash, 'Suite candidate testSetContentHash'),
  })
  if (!Array.isArray(source.definitions)) throw new SuiteContractError('Suite candidate Definitions must be an array.')
  const definitions = source.definitions.map((value, index) => {
    const candidate = record(value, ['title', 'definitionAuthority'], `definitions[${index}]`)
    const definitionAuthority = decodeDefinitionAuthority(candidate.definitionAuthority, `definitions[${index}].definitionAuthority`)
    if (!sameTestSet(definitionAuthority, { ...testSetAuthority, definitionId: definitionAuthority.definitionId })) throw new SuiteContractError('Suite candidate does not match the singular Test Set authority.')
    return Object.freeze({ title: text(candidate.title, `definitions[${index}].title`), definitionAuthority })
  })
  if (new Set(definitions.map(item => item.definitionAuthority.definitionId)).size !== definitions.length) throw new SuiteContractError('Suite candidates contain duplicate Definitions.')
  return Object.freeze({ projectId, testSetAuthority, definitions: Object.freeze(definitions) })
}

export function parseSuitePresentationIntent(params: URLSearchParams): SuitePresentationIntent | null {
  const suiteId = params.get('suiteId')
  const revisionText = params.get('suiteRevision')
  if (suiteId === null && revisionText === null) return null
  if (!revisionText || !/^[1-9]\d*$/.test(revisionText)) throw new SuiteContractError('Suite Run presentation intent is malformed.')
  const suiteRevision = Number(revisionText)
  if (!Number.isSafeInteger(suiteRevision)) throw new SuiteContractError('Suite Run presentation intent revision is malformed.')
  return Object.freeze({ suiteId: canonicalSuiteId(suiteId, 'Suite Run presentation intent suiteId'), suiteRevision })
}

export function buildSuiteExecutionStartBody(executionIntentKey: string, intent: SuitePresentationIntent): SuiteExecutionStartBody {
  if (!INTENT_KEY.test(executionIntentKey) || !Number.isSafeInteger(intent.suiteRevision) || intent.suiteRevision < 1) throw new SuiteContractError('Suite execution intent is malformed.')
  const suiteId = canonicalSuiteId(intent.suiteId, 'Suite execution intent suiteId')
  return Object.freeze({
    executionIntentKey,
    selection: Object.freeze({ kind: 'suite_revision', suiteId, suiteRevision: intent.suiteRevision }),
  })
}

export function decodeCanonicalSuiteSelectionAuthority(value: unknown): CanonicalSuiteSelectionAuthority {
  const source = record(value, ['kind', 'suiteId', 'suiteRevision', 'suiteContentHash', 'name', 'purpose'], 'Suite selection authority')
  if (source.kind !== 'suite_revision' || source.purpose !== 'sanity') throw new SuiteContractError('Suite selection authority kind or purpose is unsupported.')
  return Object.freeze({
    kind: 'suite_revision',
    suiteId: canonicalSuiteId(source.suiteId, 'Suite selection authority suiteId'),
    suiteRevision: positiveInteger(source.suiteRevision, 'Suite selection authority suiteRevision'),
    suiteContentHash: hash(source.suiteContentHash, 'Suite selection authority suiteContentHash'),
    name: text(source.name, 'Suite selection authority name'),
    purpose: 'sanity',
  })
}

export function validateSuiteDraft(name: string, members: readonly SuiteDefinitionAuthority[]): string | null {
  const normalized = name.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!normalized || [...normalized].length > 120 || /\p{Cc}/u.test(normalized)) return 'Enter a Suite name from 1 through 120 characters without control characters.'
  if (members.length < 1) return 'Select at least one Definition.'
  if (members.length > 50) return 'A Sanity Suite can contain at most 50 Definitions.'
  if (new Set(members.map(member => member.definitionId)).size !== members.length) return 'A Definition can appear only once.'
  if (members.some(member => !sameTestSet(member, members[0]))) return 'All members must share one exact Test Set authority.'
  return null
}
