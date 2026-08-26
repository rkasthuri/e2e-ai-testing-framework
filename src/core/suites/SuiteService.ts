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
import { normalizeSuiteName, suiteChangeFingerprint, type CanonicalSuiteRevision, type DefinitionRevisionRef } from './SuiteContract'

export class SuiteService {
  constructor(private readonly repository = new SuiteRepository(), private readonly now=()=>new Date().toISOString(), private readonly mint=()=>`suite-${crypto.randomUUID()}`) {}
  async create(input:{projectId:string;changeIntentKey:string;name:string;members:DefinitionRevisionRef[]}):Promise<CanonicalSuiteRevision>{
    assertProductDatabaseAuthority(); await runMigrations(); const name=normalizeSuiteName(input.name).name; const suiteId=this.mint()
    return this.repository.write({...input,suiteId,expectedRevision:null,name,createdAt:this.now(),changeIntentFingerprint:suiteChangeFingerprint({operation:'created',projectId:input.projectId,suiteId:null,expectedRevision:null,name,members:input.members})})
  }
  async revise(input:{projectId:string;suiteId:string;expectedRevision:number;changeIntentKey:string;name:string;members:DefinitionRevisionRef[]}):Promise<CanonicalSuiteRevision>{
    assertProductDatabaseAuthority(); await runMigrations(); const name=normalizeSuiteName(input.name).name
    return this.repository.write({...input,name,createdAt:this.now(),changeIntentFingerprint:suiteChangeFingerprint({operation:'revised',projectId:input.projectId,suiteId:input.suiteId,expectedRevision:input.expectedRevision,name,members:input.members})})
  }
  async read(projectId:string,suiteId:string,revision?:number){assertProductDatabaseAuthority();await runMigrations();return this.repository.read(projectId,suiteId,revision)}
}
