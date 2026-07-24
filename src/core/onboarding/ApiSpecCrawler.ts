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
  OnboardingConfig, AppModel,
  EndpointDefinition, FlowDefinition,
  RoleDefinition
} from './types'
import { validateAppModel }   from './ModelValidator'
import { FlowDetector }       from './FlowDetector'
import { AppModelRepository } from '../storage/repositories/AppModelRepository'

export class ApiSpecCrawler {

  /** TD-121 path-scoping: default = cwd behavior (fixtures byte-identical). Threaded from Crawler. */
  private modelsDir: string

  constructor(
    private config: OnboardingConfig,
    opts: { modelsDir?: string } = {},
  ) {
    this.modelsDir = opts.modelsDir ?? path.resolve('models')
  }

  async crawl(): Promise<AppModel> {
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
    // TD-122: no internal save — the model is RETURNED and the caller persists
    // (CrawlRunner via workspace.saveModel; fixture cli via crawler.saveModel).
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
  ): AppModel {
    const existing = this.loadExistingModel()
    const version  = existing
      ? this.bumpModelVersion(existing.app.modelVersion)
      : '1.0.0'

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
        modelVersion:     version,
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

  // ── Persistence ────────────────────────────────────────────────────────────

  /**
   * TD-122: used by FIXTURE flows only, via Crawler.saveModel's API-type
   * delegation (cli.ts holds the Crawler, not this class) — crawl() no longer
   * saves internally. Triple effect intact: file + validation + DB upsert
   * (intake_mode 'spec-driven', endpoint counts). Standalone tool persists via
   * CrawlRunner instead.
   */
  async saveModel(model: AppModel): Promise<void> {
    const dir       = path.join(this.modelsDir, model.app.name)   // TD-121: was cwd-relative path.resolve
    const modelPath = path.join(dir, 'app-model.json')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(modelPath, JSON.stringify(model, null, 2))
    console.log(`[ApiSpecCrawler] Model written to ${modelPath}`)

    const { valid, errors } = validateAppModel(modelPath)
    if (!valid) {
      console.error('[ApiSpecCrawler] Model validation warnings:')
      errors.forEach(e => console.error(' ', e))
    }

    try {
      const repo = new AppModelRepository()
      await repo.upsert(model)
      console.log('[ApiSpecCrawler] Model persisted to DB')
    } catch (e) {
      console.warn('[ApiSpecCrawler] DB persist failed (non-fatal):', e)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private loadExistingModel(): AppModel | null {
    const modelPath = path.join(   // TD-121: was cwd-relative path.resolve
      this.modelsDir, this.config.app.name, 'app-model.json',
    )
    if (!fs.existsSync(modelPath)) return null
    try {
      return JSON.parse(fs.readFileSync(modelPath, 'utf-8'))
    } catch {
      return null
    }
  }

  private toDisplayName(id: string): string {
    return id
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }

  private bumpModelVersion(version: string): string {
    const parts = version.split('.').map(Number)
    parts[2]    = (parts[2] || 0) + 1
    return parts.join('.')
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
