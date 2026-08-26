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
import type { Kysely, Transaction } from 'kysely'
import { getProductDb } from '../db'
import type { Database } from '../types'
import { parseCanonicalTestSet } from '../../test-design/TestDefinitionContract'
import {
  SuiteContractError, normalizeSuiteName, suiteHash, type CanonicalSuiteRevision, type DefinitionRevisionRef,
} from '../../suites/SuiteContract'

const SHA = /^[a-f0-9]{64}$/
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export interface SuiteWriteInput {
  suiteId: string; projectId: string; expectedRevision: number | null; name: string; changeIntentKey: string
  changeIntentFingerprint: string; createdAt: string; members: DefinitionRevisionRef[]
}

export class SuiteRepository {
  constructor(private readonly dbProvider: () => Kysely<Database> = getProductDb) {}

  async listHeads(projectId: string): Promise<CanonicalSuiteRevision[]> {
    try {
      return await this.dbProvider().transaction().execute(async trx => {
        const heads = await trx.selectFrom('suites').selectAll()
          .where('project_id', '=', projectId).orderBy('created_at').orderBy('suite_id').execute()
        const revisions: CanonicalSuiteRevision[] = []
        for (const head of heads) {
          revisions.push(await this.readVerifiedInTransaction(
            trx, projectId, head.suite_id, Number(head.current_revision),
          ))
        }
        return revisions
      })
    } catch (cause) {
      if (cause instanceof SuiteContractError) throw cause
      throw new SuiteContractError('suite_integrity_invalid', 'Suite heads could not be validated safely.')
    }
  }

  async read(projectId: string, suiteId: string, revision?: number): Promise<CanonicalSuiteRevision> {
    try {
      return await this.dbProvider().transaction().execute(async trx => {
        const head = await trx.selectFrom('suites').selectAll().where('project_id','=',projectId).where('suite_id','=',suiteId).executeTakeFirst()
        if (!head) throw new SuiteContractError('suite_not_found','Suite not found.')
        return this.readVerifiedInTransaction(trx, projectId, suiteId, revision ?? Number(head.current_revision))
      })
    } catch(cause) { if(cause instanceof SuiteContractError) throw cause; throw new SuiteContractError('suite_integrity_invalid','Suite persistence could not be validated safely.') }
  }

  async readVerifiedInTransaction(
    trx: Transaction<Database>, projectId: string, suiteId: string, revision: number,
  ): Promise<CanonicalSuiteRevision> {
    try {
      return await this.readInTransaction(trx, projectId, suiteId, revision)
    } catch (cause) {
      if (cause instanceof SuiteContractError) throw cause
      throw new SuiteContractError('suite_integrity_invalid','Suite persistence could not be validated safely.')
    }
  }

  async write(input: SuiteWriteInput): Promise<CanonicalSuiteRevision> {
    if (!SAFE_KEY.test(input.changeIntentKey) || !SHA.test(input.changeIntentFingerprint)) throw new SuiteContractError('suite_integrity_invalid','Suite change intent is invalid.')
    try {
      return await this.dbProvider().transaction().execute(async trx => {
        const replay = await trx.selectFrom('suite_revisions').selectAll().where('project_id','=',input.projectId).where('change_intent_key','=',input.changeIntentKey).executeTakeFirst()
        if (replay) {
          if (replay.change_intent_fingerprint !== input.changeIntentFingerprint) throw new SuiteContractError('suite_change_intent_conflict','Suite change intent was reused with different semantics.')
          return this.readInTransaction(trx,input.projectId,replay.suite_id,Number(replay.revision))
        }
        const { name, key } = normalizeSuiteName(input.name)
        if (input.members.length === 0) throw new SuiteContractError('empty_suite','A Suite requires at least one member.')
        if (input.members.length > 50) throw new SuiteContractError('too_many_suite_members','A Suite supports at most 50 members.')
        if (new Set(input.members.map(m=>m.definitionId)).size !== input.members.length) throw new SuiteContractError('duplicate_suite_member','Suite members must be unique.')
        const first = input.members[0]
        if (![2,3].includes(Number(first.definitionSchemaVersion)) || input.members.some(m=>![2,3].includes(Number(m.definitionSchemaVersion)))) throw new SuiteContractError('unsupported_definition_schema','Only v2/v3 Definitions are supported.')
        if (input.members.some(m => m.testSetId!==first.testSetId || m.testSetRevision!==first.testSetRevision || m.testSetContentHash!==first.testSetContentHash || m.definitionSchemaVersion!==first.definitionSchemaVersion)) {
          throw new SuiteContractError('suite_members_not_single_test_set','All Suite members must share one Test Set authority.')
        }
        const claimed = await trx.selectFrom('test_set_revisions').selectAll().where('test_set_id','=',first.testSetId).where('revision','=',first.testSetRevision).where('content_hash','=',first.testSetContentHash).execute()
        if (!claimed.some(row=>row.project_id===input.projectId)) {
          if (claimed.length > 0) throw new SuiteContractError('cross_project_definition','A Definition authority belongs to another project.')
          throw new SuiteContractError('definition_authority_not_found','The claimed Definition authority does not exist.')
        }
        const current = await trx.selectFrom('test_set_revisions').selectAll().where('project_id','=',input.projectId).orderBy('revision','desc').limit(1).executeTakeFirst()
        if (!current || current.test_set_id!==first.testSetId || Number(current.revision)!==first.testSetRevision || Number(current.schema_version)!==first.definitionSchemaVersion || current.content_hash!==first.testSetContentHash) {
          throw new SuiteContractError('stale_suite_authority','The pinned Test Set authority is no longer current.')
        }
        const parsed = parseCanonicalTestSet(current.payload_json)
        if (parsed.fingerprint!==current.content_hash || parsed.value.projectId!==input.projectId
          || parsed.value.testSetId!==current.test_set_id || parsed.value.revision!==Number(current.revision)
          || parsed.value.schemaVersion!==Number(current.schema_version)
          || parsed.value.definitions.length!==Number(current.definition_count)) {
          throw new SuiteContractError('suite_integrity_invalid','Current Test Set integrity failed.')
        }
        const ids = new Set(parsed.value.definitions.map(d=>d.id))
        if (input.members.some(m=>!ids.has(m.definitionId))) throw new SuiteContractError('definition_authority_mismatch','A Definition does not belong to the pinned Test Set.')
        const head = await trx.selectFrom('suites').selectAll()
          .where('suite_id','=',input.suiteId).where('project_id','=',input.projectId).executeTakeFirst()
        if (!head && input.expectedRevision!==null) throw new SuiteContractError('suite_not_found','Suite not found.')
        const revision = head ? Number(head.current_revision)+1 : 1
        if (head ? input.expectedRevision!==Number(head.current_revision) : input.expectedRevision!==null) throw new SuiteContractError('stale_suite_revision','Suite edit authority is stale.')
        const base = {
          schemaVersion: 1 as const, suiteId: input.suiteId, projectId: input.projectId, revision, name, purpose: 'sanity' as const,
          members: input.members.map((definitionAuthority,index)=>({ordinal:index+1,definitionAuthority})), createdAt: input.createdAt,
          provenance: { source:'product_api' as const, changeKind: head ? 'revised' as const : 'created' as const, priorRevision: head ? Number(head.current_revision) : null,
            changeIntentKey: input.changeIntentKey, changeIntentFingerprint: input.changeIntentFingerprint },
        }
        const value: CanonicalSuiteRevision = {...base,contentHash:suiteHash(base)}
        if (!head) await trx.insertInto('suites').values({suite_id:input.suiteId,project_id:input.projectId,current_revision:1,name_key:key,created_at:input.createdAt}).execute()
        await trx.insertInto('suite_revisions').values({suite_id:input.suiteId,revision,project_id:input.projectId,name,name_key:key,purpose:'sanity',definition_schema_version:first.definitionSchemaVersion,test_set_row_id:Number(current.id),test_set_id:first.testSetId,test_set_revision:first.testSetRevision,test_set_content_hash:first.testSetContentHash,created_at:input.createdAt,provenance_source:'product_api',change_kind:head?'revised':'created',prior_revision:head?Number(head.current_revision):null,change_intent_key:input.changeIntentKey,change_intent_fingerprint:input.changeIntentFingerprint,member_count:input.members.length,content_hash:value.contentHash}).execute()
        await trx.insertInto('suite_revision_members').values(value.members.map(m=>({suite_id:input.suiteId,suite_revision:revision,member_ordinal:m.ordinal,definition_id:m.definitionAuthority.definitionId}))).execute()
        if (head) {
          const advanced = await trx.updateTable('suites').set({current_revision:revision,name_key:key})
            .where('suite_id','=',input.suiteId).where('project_id','=',input.projectId)
            .where('current_revision','=',input.expectedRevision!).executeTakeFirst()
          if (Number(advanced.numUpdatedRows)!==1) throw new SuiteContractError('stale_suite_revision','Suite edit authority is stale.')
        }
        return value
      })
    } catch (cause) {
      if (cause instanceof SuiteContractError) throw cause
      if (/UNIQUE constraint failed: suites\.project_id, suites\.name_key/i.test(String(cause))) throw new SuiteContractError('duplicate_suite_name','A Suite with this normalized name already exists.')
      throw new SuiteContractError('suite_integrity_invalid','Suite persistence could not be validated safely.')
    }
  }

  private async readInTransaction(trx: Transaction<Database>, projectId:string, suiteId:string, revision:number): Promise<CanonicalSuiteRevision> {
    const row = await trx.selectFrom('suite_revisions').selectAll().where('project_id','=',projectId).where('suite_id','=',suiteId).where('revision','=',revision).executeTakeFirst()
    if (!row) throw new SuiteContractError('suite_revision_not_found','Suite revision not found.')
    const identity = await trx.selectFrom('suites').selectAll()
      .where('suite_id','=',suiteId).where('project_id','=',projectId).executeTakeFirst()
    const normalizedName = normalizeSuiteName(row.name)
    const provenanceValid = row.provenance_source==='product_api'
      && (revision===1 ? row.change_kind==='created' && row.prior_revision===null
        : row.change_kind==='revised' && Number(row.prior_revision)===revision-1)
      && SAFE_KEY.test(row.change_intent_key) && SHA.test(row.change_intent_fingerprint)
    if (!identity || identity.project_id!==projectId || Number(identity.current_revision)<revision
      || Number(identity.current_revision)===revision && identity.name_key!==row.name_key
      || normalizedName.name!==row.name || normalizedName.key!==row.name_key
      || row.purpose!=='sanity' || !provenanceValid
      || Number.isNaN(Date.parse(row.created_at)) || new Date(row.created_at).toISOString()!==row.created_at) {
      throw new SuiteContractError('suite_integrity_invalid','Suite revision identity is invalid.')
    }
    const members = await trx.selectFrom('suite_revision_members').selectAll().where('suite_id','=',suiteId).where('suite_revision','=',revision).orderBy('member_ordinal').execute()
    if (!Number.isSafeInteger(Number(row.member_count)) || Number(row.member_count)<1 || Number(row.member_count)>50
      || members.length!==Number(row.member_count) || members.some((m,i)=>Number(m.member_ordinal)!==i+1)
      || new Set(members.map(m=>m.definition_id)).size!==members.length) {
      throw new SuiteContractError('suite_integrity_invalid','Suite membership integrity failed.')
    }
    const testSet = await trx.selectFrom('test_set_revisions').selectAll().where('id','=',Number(row.test_set_row_id)).executeTakeFirst()
    if (!testSet || testSet.project_id!==projectId || testSet.test_set_id!==row.test_set_id || Number(testSet.revision)!==Number(row.test_set_revision) || Number(testSet.schema_version)!==Number(row.definition_schema_version) || testSet.content_hash!==row.test_set_content_hash) throw new SuiteContractError('suite_integrity_invalid','Suite Test Set authority integrity failed.')
    const parsed = parseCanonicalTestSet(testSet.payload_json); const ids=new Set(parsed.value.definitions.map(d=>d.id))
    if (parsed.fingerprint!==testSet.content_hash || parsed.value.projectId!==projectId
      || parsed.value.testSetId!==testSet.test_set_id || parsed.value.revision!==Number(testSet.revision)
      || parsed.value.schemaVersion!==Number(testSet.schema_version)
      || parsed.value.definitions.length!==Number(testSet.definition_count)
      || members.some(m=>!ids.has(m.definition_id))) {
      throw new SuiteContractError('suite_integrity_invalid','Suite Definition authority integrity failed.')
    }
    const base = {schemaVersion:1 as const,suiteId,projectId,revision:Number(row.revision),name:row.name,purpose:'sanity' as const,members:members.map(m=>({ordinal:Number(m.member_ordinal),definitionAuthority:{definitionId:m.definition_id,definitionSchemaVersion:Number(row.definition_schema_version) as 2|3,testSetId:row.test_set_id,testSetRevision:Number(row.test_set_revision),testSetContentHash:row.test_set_content_hash}})),createdAt:row.created_at,provenance:{source:'product_api' as const,changeKind:row.change_kind as 'created'|'revised',priorRevision:row.prior_revision===null?null:Number(row.prior_revision),changeIntentKey:row.change_intent_key,changeIntentFingerprint:row.change_intent_fingerprint}}
    if (suiteHash(base)!==row.content_hash) throw new SuiteContractError('suite_integrity_invalid','Suite content hash integrity failed.')
    return {...base,contentHash:row.content_hash}
  }
}
