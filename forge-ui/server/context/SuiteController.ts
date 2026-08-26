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

import { fail, ok } from '../http'
import { executionContext, type ExecutionContext } from './ExecutionContext'

export interface SuiteHttpResult { status: number; body: unknown }
type Project = { appName: string }
type SuiteEngine = Pick<ExecutionContext,
  | 'readProductSuiteHeads' | 'readProductSuiteRevision' | 'readProductSuiteCandidates'
  | 'createProductSuite' | 'reviseProductSuite'>

const SUITE_ID = /^suite-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/
const SAFE_INTENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
}

function members(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null
  const parsed: Array<Record<string, unknown>> = []
  for (const member of value) {
    const item = record(member)
    if (!item || !exact(item, ['definitionId','definitionSchemaVersion','testSetId','testSetRevision','testSetContentHash'])
      || typeof item.definitionId !== 'string' || !SAFE_ID.test(item.definitionId)
      || item.definitionSchemaVersion !== 2 && item.definitionSchemaVersion !== 3
      || typeof item.testSetId !== 'string' || !SAFE_ID.test(item.testSetId)
      || !Number.isSafeInteger(item.testSetRevision) || Number(item.testSetRevision) < 1
      || typeof item.testSetContentHash !== 'string' || !SHA256.test(item.testSetContentHash)) return null
    parsed.push(item)
  }
  return parsed
}

function parseChange(body: unknown, kind: 'create' | 'revise', suiteId?: string): Record<string, unknown> | null {
  const value=record(body)
  const keys=kind==='create'
    ? ['kind','changeIntentKey','name','purpose','members']
    : ['kind','suiteId','expectedRevision','changeIntentKey','name','purpose','members']
  if (!value || !exact(value,keys) || value.kind!==kind || value.purpose!=='sanity'
    || typeof value.changeIntentKey!=='string' || !SAFE_INTENT.test(value.changeIntentKey)
    || typeof value.name!=='string' || value.name.length<1
    || kind==='revise' && (value.suiteId!==suiteId || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision)<1)) return null
  const parsedMembers=members(value.members)
  if (!parsedMembers) return null
  return {changeIntentKey:value.changeIntentKey,name:value.name,members:parsedMembers,
    ...(kind==='revise'?{suiteId,expectedRevision:Number(value.expectedRevision)}:{})}
}

function errorResult(cause: unknown): SuiteHttpResult {
  const code=cause && typeof cause==='object' && 'code' in cause ? String((cause as {code:unknown}).code) : ''
  const message=cause instanceof Error ? cause.message : 'Suite authority is temporarily unavailable.'
  if (code==='suite_not_found' || code==='suite_revision_not_found') return {status:404,body:fail(message,code.toUpperCase())}
  if (code==='suite_integrity_invalid') return {status:503,body:fail(message,'SUITE_INTEGRITY_INVALID')}
  if (code==='definition_authority_not_found') return {status:409,body:fail(message,'DEFINITION_AUTHORITY_NOT_FOUND')}
  if (code) return {status:code==='unsupported_definition_schema'?422:409,body:fail(message,code.toUpperCase())}
  return {status:503,body:fail('Suite authority is temporarily unavailable.','SUITE_UNAVAILABLE')}
}

async function projectOr404(appName:string,resolveProject:(appName:string)=>Promise<Project|undefined>):Promise<Project|SuiteHttpResult>{
  return await resolveProject(appName) ?? {status:404,body:fail('Project not found','NOT_FOUND')}
}

function isHttpResult(value: Project | SuiteHttpResult): value is SuiteHttpResult { return 'status' in value }

export async function listSuites(appName:string,resolveProject:(appName:string)=>Promise<Project|undefined>,engine:SuiteEngine=executionContext):Promise<SuiteHttpResult>{
  const project=await projectOr404(appName,resolveProject); if(isHttpResult(project)) return project
  try{return {status:200,body:ok({suites:await engine.readProductSuiteHeads(appName)})}}catch(cause){return errorResult(cause)}
}

export async function readSuiteCandidates(appName:string,resolveProject:(appName:string)=>Promise<Project|undefined>,engine:SuiteEngine=executionContext):Promise<SuiteHttpResult>{
  const project=await projectOr404(appName,resolveProject); if(isHttpResult(project)) return project
  try{return {status:200,body:ok(await engine.readProductSuiteCandidates(appName))}}catch(cause){return errorResult(cause)}
}

export async function readSuite(appName:string,suiteId:string,revisionValue:unknown,resolveProject:(appName:string)=>Promise<Project|undefined>,engine:SuiteEngine=executionContext):Promise<SuiteHttpResult>{
  const project=await projectOr404(appName,resolveProject); if(isHttpResult(project)) return project
  if(!SUITE_ID.test(suiteId)) return {status:404,body:fail('Suite not found','NOT_FOUND')}
  let revision:number|undefined
  if(revisionValue!==undefined){if(typeof revisionValue!=='string'||!/^[1-9]\d*$/.test(revisionValue)||!Number.isSafeInteger(Number(revisionValue))) return {status:400,body:fail('Suite revision must be a positive integer.','INVALID_SUITE_REVISION')};revision=Number(revisionValue)}
  try{return {status:200,body:ok(await engine.readProductSuiteRevision(appName,suiteId,revision))}}catch(cause){return errorResult(cause)}
}

export async function createSuite(appName:string,body:unknown,resolveProject:(appName:string)=>Promise<Project|undefined>,engine:SuiteEngine=executionContext):Promise<SuiteHttpResult>{
  const project=await projectOr404(appName,resolveProject); if(isHttpResult(project)) return project
  const input=parseChange(body,'create'); if(!input)return {status:400,body:fail('Invalid Suite create request.','INVALID_SUITE_REQUEST')}
  try{return {status:201,body:ok(await engine.createProductSuite(appName,input))}}catch(cause){return errorResult(cause)}
}

export async function reviseSuite(appName:string,suiteId:string,body:unknown,resolveProject:(appName:string)=>Promise<Project|undefined>,engine:SuiteEngine=executionContext):Promise<SuiteHttpResult>{
  const project=await projectOr404(appName,resolveProject); if(isHttpResult(project)) return project
  if(!SUITE_ID.test(suiteId)) return {status:404,body:fail('Suite not found','NOT_FOUND')}
  const input=parseChange(body,'revise',suiteId); if(!input)return {status:400,body:fail('Invalid Suite revision request.','INVALID_SUITE_REQUEST')}
  try{return {status:201,body:ok(await engine.reviseProductSuite(appName,input))}}catch(cause){return errorResult(cause)}
}
