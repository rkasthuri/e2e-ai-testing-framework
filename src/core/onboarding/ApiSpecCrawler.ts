/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import * as fs   from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import {
  OnboardingConfig, AppModel, AppModelCandidate,
  EndpointDefinition, FlowDefinition,
  RoleDefinition
} from './types'
import { FlowDetector }       from './FlowDetector'

export class ApiSpecCrawler {

  /** TD-181: previous runtime truth is injected from SQLite, never loaded from JSON. */
  private previousModel: AppModel | null

  constructor(
    private config: OnboardingConfig,
    opts: { previousModel?: AppModel | null } = {},
  ) {
    this.previousModel = opts.previousModel ?? null
  }

  async crawl(): Promise<AppModelCandidate> {
    const startTime = Date.now()

    const endpoints = await this.loadEndpoints()

    const detector = new FlowDetector(
      { nodes: new Map(), edges: [] },
      [],
      [],
      this.config,
      { remaining: 0, consume: () => false, isExhausted: () => true },
      endpoints
    )
    const flows = await detector.detectFlows()

    const model = this.buildModel(endpoints, flows, startTime)
    // TD-181: no internal persistence Ã¢â‚¬â€ the candidate is returned to the
    // caller, which commits through AppModelService before JSON projection.
    return model
  }

  // ── Endpoint loading — priority: inline → file → url ──────────────────────

  private async loadEndpoints(): Promise<EndpointDefinition[]> {
    if (this.config.apiEndpoints && this.config.apiEndpoints.length > 0) {
      console.log(
        `[ApiSpecCrawler] Using inline endpoint definitions — ` +
        `${this.config.apiEndpoints.length} endpoints`
      )
      return this.config.apiEndpoints
    }

    if (this.config.apiSpecFile) {
      console.log(`[ApiSpecCrawler] Reading spec from file: ${this.config.apiSpecFile}`)
      const raw = fs.readFileSync(
        path.resolve(this.config.apiSpecFile), 'utf-8'
      )
      const spec = JSON.parse(raw)
      return this.parseOpenApiSpec(spec)
    }

    if (this.config.apiSpecUrl) {
      console.log(`[ApiSpecCrawler] Fetching spec from: ${this.config.apiSpecUrl}`)
      const res  = await fetch(this.config.apiSpecUrl)
      const spec = await res.json()
      return this.parseOpenApiSpec(spec)
    }

    console.warn('[ApiSpecCrawler] No endpoint source configured — returning empty list')
    return []
  }

  // ── OpenAPI 2.x / 3.x parser ──────────────────────────────────────────────

  private parseOpenApiSpec(spec: any): EndpointDefinition[] {
    const is3x = !!spec.openapi
    const is2x = !!spec.swagger
    if (!is3x && !is2x) {
      console.warn('[ApiSpecCrawler] Unknown spec format — expected openapi or swagger key')
    }

    const endpoints: EndpointDefinition[] = []
    const paths: Record<string, any> = spec.paths || {}

    const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

    for (const [pathStr, pathItem] of Object.entries(paths)) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method]
        if (!operation) continue

        // Auth detection — any security entry on the operation
        const security: any[] = operation.security ?? spec.security ?? []
        const auth = Array.isArray(security) && security.length > 0

        // Parameters
        const rawParams: any[] = [
          ...(pathItem.parameters || []),
          ...(operation.parameters || []),
        ]
        const parameters = rawParams.map((p: any) => ({
          name:     p.name as string,
          in:       (p.in === 'body' ? 'body' : p.in) as 'path' | 'query' | 'header' | 'body',
          required: !!p.required,
        }))

        // Request body
        let requestBody: { schema: Record<string, any> } | null = null
        if (is3x && operation.requestBody?.content) {
          const mediaType =
            operation.requestBody.content['application/json'] ||
            Object.values(operation.requestBody.content)[0] as any
          if (mediaType?.schema) {
            requestBody = { schema: mediaType.schema }
          }
        } else if (is2x) {
          const bodyParam = rawParams.find((p: any) => p.in === 'body')
          if (bodyParam?.schema) {
            requestBody = { schema: bodyParam.schema }
          }
        }

        // Responses
        const responses = operation.responses || {}

        endpoints.push({
          method:      method.toUpperCase() as EndpointDefinition['method'],
          path:        pathStr,
          summary:     operation.summary || operation.operationId || `${method.toUpperCase()} ${pathStr}`,
          auth,
          parameters:  parameters.length > 0 ? parameters : undefined,
          requestBody,
          responses,
        })
      }
    }

    console.log(`[ApiSpecCrawler] Found ${endpoints.length} endpoints`)
    return endpoints
  }

  // ── Model building ─────────────────────────────────────────────────────────

  private buildModel(
    endpoints: EndpointDefinition[],
    flows:     FlowDefinition[],
    startTime: number
  ): AppModelCandidate {
    const existing = this.previousModel
    const appType = this.config.appType || this.config.app.appType

    return {
      schemaVersion: '2.0',
      generatedAt:   new Date().toISOString(),
      generatedBy:   'agent',
      app: {
        name:             this.config.app.name,
        displayName:      this.toDisplayName(this.config.app.name),
        baseUrl:          this.config.app.baseUrl,
        appType,
        spaConfig:        null,
        // TD-UI-031: content is app-type-agnostic — an API's evidence is its
        // endpoints (it has no pages). A spec parse that yielded zero endpoints
        // is crawled-empty, exactly as a UI crawl with zero pages.
        evidenceState:    endpoints.length > 0 ? 'crawled' : 'crawled-empty',
        crawlMetadata: {
          crawlConfigHash:  this.hashConfig(),
          crawledAt:        new Date().toISOString(),
          crawledBy:        'agent',
          crawlDurationMs:  Date.now() - startTime,
          pagesBudget:      0,
          pagesDiscovered:  0,
          pagesSkipped:     null,   // not measured (an API spec has no page frontier) — TD-UI-054; NOT 0
          // NOTE: literal 'within-budget' is correct for spec intake (no crawl AI
          // budget is consumed here; the tracker is a fixed stub). The two-pool
          // ADR-018 fix applies to Crawler.ts (a real crawl), not this path.
          aiBudgetStatus:   'within-budget',
          crawlDiagnostics: null,
        },
      },
      roles:     [],
      pages:     null,
      flows:     flows.length > 0 ? flows : null,
      endpoints: endpoints.length > 0 ? endpoints : null,
      api:       null,
      diff:      existing
        ? {
            previousModelVersion:  existing.app.modelVersion,
            diffGeneratedAt:       new Date().toISOString(),
            pagesAdded:            [],   // API models have no pages; [] is structural, not a dropped diff
            pagesRemoved:          [],
            // null = NOT DIFFED (never computed for spec intake). [] would be the lie.
            pagesModified:         null,
            elementsAdded:         null,
            elementsRemoved:       null,
            strategiesInvalidated: null,
            flowsAdded:            null,
            flowsRemoved:          null,
          }
        : null,
    }
  }

  private toDisplayName(id: string): string {
    return id
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }

  private hashConfig(): string {
    const str = JSON.stringify(this.config)
    return 'sha256:' + crypto
      .createHash('sha256')
      .update(str)
      .digest('hex')
      .slice(0, 16)
  }
}
