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

import { apiClient, ApiError } from './client'
import { decodeCanonicalExecutionStartAccepted, type CanonicalExecutionStartAccepted } from './executionContract'
import {
  buildSuiteExecutionStartBody, decodeCanonicalSuiteCandidateSet, decodeCanonicalSuiteExecutionPreflight,
  decodeCanonicalSuiteHeads, decodeCanonicalSuiteRevision,
  type CanonicalSuiteCandidateSet, type CanonicalSuiteExecutionPreflight, type CanonicalSuiteRevision,
  type SuiteChangeRequest, type SuitePresentationIntent,
} from './suiteContract'

export interface SuiteTransport {
  listHeads(projectId: string): Promise<readonly CanonicalSuiteRevision[]>
  refreshCurrentHead(projectId: string, suiteId: string): Promise<CanonicalSuiteRevision>
  readRevision(projectId: string, suiteId: string, revision: number): Promise<CanonicalSuiteRevision>
  readCandidates(projectId: string): Promise<CanonicalSuiteCandidateSet>
  save(projectId: string, request: SuiteChangeRequest): Promise<CanonicalSuiteRevision>
  preflight(projectId:string,intent:SuitePresentationIntent):Promise<CanonicalSuiteExecutionPreflight>
  start(projectId:string,executionIntentKey:string,intent:SuitePresentationIntent):Promise<CanonicalExecutionStartAccepted>
}

export class SuiteTransportUnavailableError extends Error {
  readonly code = 'M2_CORE_SUITE_TRANSPORT_UNAVAILABLE'
  constructor() {
    super('Saved Suite authority is unavailable because the frozen Core Suite transport has not landed in this branch.')
    this.name = 'SuiteTransportUnavailableError'
  }
}

export class SuiteTransportError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name='SuiteTransportError'}
}

function path(projectId:string):string{return `/api/v1/projects/${encodeURIComponent(projectId)}`}
function normalizeError(cause:unknown):never{
  if(cause instanceof ApiError)throw new SuiteTransportError((cause.code??'SUITE_UNAVAILABLE').toLowerCase(),cause.message)
  throw cause
}

/** Sole production adapter for the frozen M2 Suite HTTP vocabulary. */
const suiteTransportImplementation: SuiteTransport = {
  async listHeads(projectId) {try{return decodeCanonicalSuiteHeads(await apiClient.get<unknown>(`${path(projectId)}/suites`),projectId)}catch(cause){normalizeError(cause)}},
  async refreshCurrentHead(projectId,suiteId) {try{return decodeCanonicalSuiteRevision(await apiClient.get<unknown>(`${path(projectId)}/suites/${encodeURIComponent(suiteId)}`),projectId)}catch(cause){normalizeError(cause)}},
  async readRevision(projectId,suiteId,revision) {try{return decodeCanonicalSuiteRevision(await apiClient.get<unknown>(`${path(projectId)}/suites/${encodeURIComponent(suiteId)}?revision=${revision}`),projectId)}catch(cause){normalizeError(cause)}},
  async readCandidates(projectId) {try{return decodeCanonicalSuiteCandidateSet(await apiClient.get<unknown>(`${path(projectId)}/suites/candidates`),projectId)}catch(cause){normalizeError(cause)}},
  async save(projectId,request) {try{const value=request.kind==='create'?await apiClient.post<unknown>(`${path(projectId)}/suites`,request):await apiClient.put<unknown>(`${path(projectId)}/suites/${encodeURIComponent(request.suiteId)}`,request);return decodeCanonicalSuiteRevision(value,projectId)}catch(cause){normalizeError(cause)}},
  async preflight(projectId,intent){try{return decodeCanonicalSuiteExecutionPreflight(await apiClient.post<unknown>(`${path(projectId)}/execution/preflight`,{selection:{kind:'suite_revision',suiteId:intent.suiteId,suiteRevision:intent.suiteRevision}}),projectId,intent)}catch(cause){normalizeError(cause)}},
  async start(projectId,executionIntentKey,intent){try{return decodeCanonicalExecutionStartAccepted(await apiClient.post<unknown>(`${path(projectId)}/execution/start`,buildSuiteExecutionStartBody(executionIntentKey,intent)))}catch(cause){normalizeError(cause)}},
}

export const suiteTransport: SuiteTransport = Object.freeze(suiteTransportImplementation)
