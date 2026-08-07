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
 * TD-013 Commit 4 — ApiEnvironment.
 *
 * A Playwright-`APIRequestContext`-backed ExecutionEnvironment for the 'api' type.
 * Structural mirror of WebUIEnvironment: init/close own the request context,
 * observe/act/verify operate over HTTP responses instead of the DOM. Every path
 * returns a value (never undefined); unsupported operations return explicit
 * failed results, never throw silently (Standing Rule 5).
 *
 * Auth (Restful Booker): POST /auth {username,password} -> {token}; the token is
 * attached to authenticated calls as `Cookie: token=<token>`. TD-097: baseUrl is
 * injected, no hardcoded paths. Evidence ids use crypto.randomUUID().
 */
import { request, APIRequestContext, APIResponse } from '@playwright/test'
import * as crypto from 'crypto'
import {
  ExecutionEnvironment, ObservationTarget, ObservationResult,
  AgentAction, ActionResult, EvidenceRecord, Goal,
  EvidenceConfidence, EvidenceObservationType,
} from './types'

export class ApiEnvironment implements ExecutionEnvironment {
  readonly type = 'api' as const
  private context?: APIRequestContext
  private authToken?: string

  constructor(
    private baseUrl: string,
    private credentials?: { username: string; password: string },
  ) {}

  /** Create the request context and, if credentials were given, obtain an auth token. */
  async init(): Promise<void> {
    this.context = await request.newContext({ baseURL: this.baseUrl })
    if (this.credentials) {
      try {
        const response = await this.context.post('/auth', {
          headers: { 'Content-Type': 'application/json' },
          data: { username: this.credentials.username, password: this.credentials.password },
        })
        const body = await this.readBody(response) as { token?: string; reason?: string }
        if (body && typeof body.token === 'string') {
          this.authToken = body.token
        } else {
          console.warn(`[ApiEnvironment] auth failed — no token returned (reason: ${body?.reason ?? 'unknown'})`)
        }
      } catch (e: any) {
        console.warn(`[ApiEnvironment] auth request failed: ${e.message}`)
      }
    }
  }

  /** Dispose the request context. Always call in a finally block. */
  async close(): Promise<void> {
    await this.context?.dispose()
    this.context = undefined
    this.authToken = undefined
  }

  async observe(target: ObservationTarget): Promise<ObservationResult> {
    const timestamp = new Date().toISOString()
    if (!this.context) {
      console.warn('[ApiEnvironment] observe() called before init()')
      return { observed: false, confidence: 'unknown', timestamp }
    }
    switch (target.type) {
      case 'api-response':
      case 'network-request': {
        // Phase 1: 'network-request' is treated as a direct api-response probe —
        // real in-flight network monitoring needs a browser and is deferred to Phase 2.
        try {
          const response = await this.context.get(target.locator, { headers: this.authHeaders() })
          const status = response.status()
          const body = await this.readBody(response)
          return { observed: response.ok(), value: { status, body }, confidence: 'high', timestamp }
        } catch (e: any) {
          return { observed: false, value: { error: e.message }, confidence: 'low', timestamp }
        }
      }
      case 'dom-element':
      case 'page-url':
      default:
        console.warn(`[ApiEnvironment] observe target '${target.type}' not supported in api`)
        return { observed: false, confidence: 'unknown', timestamp }
    }
  }

  async act(action: AgentAction): Promise<ActionResult> {
    const timestamp = new Date().toISOString()
    switch (action.type) {
      case 'api-call': {
        const payload = (action.payload ?? {}) as {
          method?: string; path?: string; body?: unknown; headers?: Record<string, string>
        }
        const method = (payload.method ?? 'GET').toUpperCase()
        // Path may come from payload.path or (per the agent action shape) action.target.
        const path = payload.path ?? action.target ?? '/'
        const headers = { ...this.authHeaders(), ...(payload.headers ?? {}) }
        try {
          const ctx = this.requireContext()
          const response = await ctx.fetch(path, { method, data: payload.body as any, headers })
          const ok = response.ok()
          const evidence = this.newEvidence(
            ok ? 'direct_observation' : 'inference',
            `${method} ${path} -> ${response.status()}`,
            ok ? 'high' : 'low', 'act:api-call', timestamp)
          return { success: ok, evidence, nextState: path }
        } catch (e: any) {
          const evidence = this.newEvidence(
            'inference', `api-call ${method} ${path} failed: ${e.message}`,
            'low', 'act:api-call', timestamp)
          return { success: false, evidence, error: e.message }
        }
      }
      case 'verify': {
        const obs = await this.observe({ type: 'api-response', locator: action.target })
        const evidence = this.newEvidence(
          obs.observed ? 'direct_observation' : 'inference',
          `verify '${action.target}' -> observed=${obs.observed}`,
          obs.confidence, 'act:verify', timestamp)
        return { success: obs.observed, evidence, nextState: action.target }
      }
      case 'wait': {
        await new Promise(r => setTimeout(r, Number(action.payload) || 1000))
        const evidence = this.newEvidence(
          'inference', `waited ${Number(action.payload) || 1000}ms`, 'medium', 'act:wait', timestamp)
        return { success: true, evidence }
      }
      case 'navigate':
      case 'click':
      case 'fill':
      default: {
        // DOM actions are meaningless for a REST API — explicit failed ActionResult
        // (never a throw, never a silent skip), mirroring WebUIEnvironment's api-call.
        console.warn(`[ApiEnvironment] action '${action.type}' not supported in api environment`)
        const evidence = this.newEvidence(
          'direct_observation', `action '${action.type}' unsupported by the api environment`,
          'high', `act:${action.type}`, timestamp)
        return { success: false, evidence, error: `${action.type} not supported in api environment` }
      }
    }
  }

  async verify(goal: Goal): Promise<{ achieved: boolean; evidence: EvidenceRecord }> {
    const timestamp = new Date().toISOString()
    const outcomes: boolean[] = []
    const signals: string[] = []

    for (const criterion of goal.successCriteria) {
      if (criterion.verifier === 'api-response') {
        const obs = await this.observe({ type: 'api-response', locator: criterion.locator ?? '' })
        const val = obs.value as { status?: number; body?: unknown } | undefined
        const met = this.matchExpected(criterion.expectedValue, val?.status, val?.body)
        outcomes.push(met)
        signals.push(`api-response(${criterion.locator ?? ''})=${met}`)
      } else {
        console.warn(`[ApiEnvironment] verifier '${criterion.verifier}' not supported in api`)
        outcomes.push(false)
        signals.push(`${criterion.verifier}=unsupported`)
      }
    }

    const achieved = outcomes.length > 0 && outcomes.every(Boolean)
    const evidence = this.newEvidence(
      achieved ? 'direct_observation' : 'inference',
      `verify(${goal.id}): ${signals.join(', ') || 'no criteria'}`,
      achieved ? 'high' : 'low', `verify:${goal.id}`, timestamp, goal.id)
    return { achieved, evidence }
  }

  // ── internals ───────────────────────────────────────────────────────────────

  /** Auth header (Restful Booker style): Cookie: token=<token> when authenticated. */
  private authHeaders(): Record<string, string> {
    return this.authToken ? { Cookie: `token=${this.authToken}` } : {}
  }

  private requireContext(): APIRequestContext {
    if (!this.context) throw new Error('ApiEnvironment not initialized — call init() before use')
    return this.context
  }

  /** Parse a response body as JSON, falling back to text, then null. */
  private async readBody(response: APIResponse): Promise<unknown> {
    try { return await response.json() }
    catch {
      try { return await response.text() }
      catch { return null }
    }
  }

  /**
   * Match a criterion's expectedValue against an api response:
   *   number -> status code equals it; string -> body contains it;
   *   object -> body contains all of the object's key/values (shallow subset);
   *   undefined/null -> response was 2xx.
   */
  private matchExpected(expected: unknown, status: number | undefined, body: unknown): boolean {
    if (expected === undefined || expected === null) {
      return status !== undefined && status >= 200 && status < 300
    }
    if (typeof expected === 'number') return status === expected
    if (typeof expected === 'string') {
      return JSON.stringify(body ?? '').includes(expected) || String(body ?? '').includes(expected)
    }
    if (typeof expected === 'object') {
      if (body === null || typeof body !== 'object') return false
      const b = body as Record<string, unknown>
      return Object.entries(expected as Record<string, unknown>)
        .every(([k, v]) => JSON.stringify(b[k]) === JSON.stringify(v))
    }
    return false
  }

  private newEvidence(
    observationType: EvidenceObservationType,
    signal: string,
    confidence: EvidenceConfidence,
    source: string,
    timestamp: string,
    goalId = '',
  ): EvidenceRecord {
    return {
      id: crypto.randomUUID(),
      observationType,
      signal,
      confidence,
      source,
      timestamp,
      goalId,
      preconditionEvidenceIds: [],
    }
  }
}
