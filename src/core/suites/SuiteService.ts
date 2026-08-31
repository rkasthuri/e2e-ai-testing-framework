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
import { assertProductDatabaseAuthority } from '../storage/db'
import { runMigrations } from '../storage/migrate'
import { SuiteRepository } from '../storage/repositories/SuiteRepository'
import { TestSetRepository } from '../storage/repositories/TestSetRepository'
import { normalizeSuiteName, SuiteContractError, suiteChangeFingerprint, type CanonicalSuiteRevision, type DefinitionRevisionRef, type MultiSourceDefinitionRevisionRef } from './SuiteContract'

export interface CanonicalSuiteCandidateSet {
  projectId: string
  testSetAuthority: Omit<DefinitionRevisionRef, 'definitionId'>
  definitions: Array<{ title: string; definitionAuthority: DefinitionRevisionRef }>
}

export class SuiteService {
  constructor(
    private readonly repository = new SuiteRepository(),
    private readonly now=()=>new Date().toISOString(),
    private readonly mint=()=>`suite-${crypto.randomUUID()}`,
    private readonly testSets = new TestSetRepository(),
  ) {}
  async create(input:{schemaVersion?:1|2;projectId:string;changeIntentKey:string;name:string;members:Array<DefinitionRevisionRef|MultiSourceDefinitionRevisionRef>}):Promise<CanonicalSuiteRevision>{
    assertProductDatabaseAuthority(); await runMigrations(); const name=normalizeSuiteName(input.name).name; const suiteId=this.mint()
    return this.repository.write({...input,suiteId,expectedRevision:null,name,createdAt:this.now(),changeIntentFingerprint:suiteChangeFingerprint({schemaVersion:input.schemaVersion,operation:'created',projectId:input.projectId,suiteId:null,expectedRevision:null,name,members:input.members})})
  }
  async revise(input:{schemaVersion?:1|2;projectId:string;suiteId:string;expectedRevision:number;changeIntentKey:string;name:string;members:Array<DefinitionRevisionRef|MultiSourceDefinitionRevisionRef>}):Promise<CanonicalSuiteRevision>{
    assertProductDatabaseAuthority(); await runMigrations(); const name=normalizeSuiteName(input.name).name
    return this.repository.write({...input,name,createdAt:this.now(),changeIntentFingerprint:suiteChangeFingerprint({schemaVersion:input.schemaVersion,operation:'revised',projectId:input.projectId,suiteId:input.suiteId,expectedRevision:input.expectedRevision,name,members:input.members})})
  }
  async read(projectId:string,suiteId:string,revision?:number){assertProductDatabaseAuthority();await runMigrations();return this.repository.read(projectId,suiteId,revision)}
  async listHeads(projectId:string):Promise<CanonicalSuiteRevision[]>{assertProductDatabaseAuthority();await runMigrations();return this.repository.listHeads(projectId)}
  async readCandidates(projectId:string):Promise<CanonicalSuiteCandidateSet>{
    assertProductDatabaseAuthority(); await runMigrations()
    const inventory=await this.testSets.readInventory(projectId,{limit:1})
    if ('kind' in inventory || !inventory.current) throw new SuiteContractError('definition_authority_not_found','No current Test Set authority exists for Suite membership.')
    const {testSet}=inventory.current
    if (testSet.schemaVersion!==2 && testSet.schemaVersion!==3) throw new SuiteContractError('unsupported_definition_schema','Only current v2/v3 Definitions are eligible Suite candidates.')
    const testSetAuthority={definitionSchemaVersion:testSet.schemaVersion,testSetId:testSet.testSetId,testSetRevision:testSet.revision,testSetContentHash:inventory.current.contentHash}
    return {projectId,testSetAuthority,definitions:testSet.definitions.map(definition=>({title:definition.title,definitionAuthority:{definitionId:definition.id,...testSetAuthority}}))}
  }
}
