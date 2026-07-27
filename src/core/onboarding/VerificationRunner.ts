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

import { chromium, request, Browser, BrowserContext, Page } from '@playwright/test'
import * as fs   from 'fs'
import * as path from 'path'
import {
  AppModel, AppModelCandidate, PageDefinition, ElementDefinition,
  FlowDefinition, FlowStep, Strategy, OnboardingConfig
} from './types'
import { modelHasContent } from './ModelValidator'
import { EmptyModelError }    from '../errors/OperatorFacingError'
import { escapeRoleAccessibleName } from './generators/EmitHelper'
import { RunRepository }      from '../storage/repositories/RunRepository'
import { runMigrations }      from '../storage/migrate'
import { AppModelService, requireProjectedCommit } from '../storage/AppModelService'
import { Workspace, createWorkspace } from '../workspace/WorkspaceManager'
import * as dotenv from 'dotenv'
dotenv.config()

/**
 * TD-109 (TD-097 portability): repo root from THIS file's location
 * (src/core/onboarding/), not process.cwd() — the three path sites below were
 * the last cwd-relative resolves in this file (screenshotDir, model write-back,
 * verify report). No behavioral change when run from the repo root, which was
 * the only place they ever worked.
 */
const REPO_ROOT = path.resolve(__dirname, '../../..')

// ── Result types ──────────────────────────────────────────────────────────────

// CONTRACT (TD-033 / TD-047 — design decision, not a defect fix): this report's
// two result arrays carry two genuinely different verification mechanisms, and
// the `verificationTier` field on each says which one produced that entry —
// honestly, not implying more nuance than exists:
//   - `elementResults` ('dom-presence' | 'http-status'): for web-ui apps,
//     `verifyElement()` confirms an element is correctly modeled and present
//     in the DOM at its expected URL. It does NOT confirm the element will be
//     visible/interactable in a real user session — navigation there is a
//     direct `page.goto()` reload per page, not real in-app traversal, and
//     SPA-runtime state (e.g. a burger-menu's hidden styling) does not
//     reliably reach the same state via a reload that it does via real
//     navigation. See TD-047 for the live, isolated repro. For rest-api/
//     graphql-api apps, the same array instead carries `'http-status'`
//     entries — an HTTP fetch + status-code check, not a DOM check at all.
//   - `flowResults` ('interaction'): flow verification is a different,
//     stronger mechanism — `executeStep()` performs real `click`/`fill`/
//     `selectOption` calls and includes a real `state: 'visible'` wait for
//     `assert-element-visible` steps. This is closer to real user behavior
//     than `dom-presence`, though it still arrives at a flow's starting page
//     via `page.goto()`, so it is not claimed to be fully equivalent to a
//     real user session either.
// `confidenceScore`/`confidenceLevel` (see `buildReport()`) is a 0.6/0.4 blend
// of these two different-strength signals — it indicates how well the model
// matches what's actually on the page, not whether a real user session would
// see/use these elements successfully. That is the generated-spec CI run's
// job, not verification's. Per the TD-047 design decision, the navigation
// pattern itself is staying as-is — this is a documentation/contract change,
// not a behavior change.

export interface ElementResult {
  elementId:        string
  name:             string
  pageId:           string
  // 'could-not-verify' (ADR-015 / Block B): FORGE could not LOOK (page load
  // failed, timeout, auth wall) — distinct from 'failed' (looked, model is wrong)
  // and 'passed'. Counts in elementsTotal, contributes 0 to elementsPassed. A
  // model defect and a verification failure are different diagnoses.
  status:           'passed' | 'failed' | 'healed' | 'could-not-verify'
  strategyUsed:     Strategy | null
  durationMs:       number
  error:            string | null
  screenshotPath:   string | null
  nearestMatch:     string | null
  verificationTier: 'dom-presence' | 'http-status'
}

export interface SetupFailure {
  pageId:         string
  roleId:         string | null
  stepIndex:      number
  action:         string
  error:          string
  screenshotPath: string | null
}

export interface FlowResult {
  flowId:           string
  displayName:      string
  // LIE-2 (Option B): 'could-not-verify' — a step executed NO assertion (missing
  // elementId / unknown action / empty nav pattern). Counted in flowsTotal, never
  // in flowsPassed — the same honest mechanic ElementResult already uses.
  status:           'passed' | 'failed' | 'could-not-verify'
  stepsTotal:       number
  stepsPassed:      number
  failedAtStep:     number | null
  unverifiedAtStep?: number   // LIE-2: index where the flow went blind (sibling to failedAtStep)
  error:            string | null
  screenshotPath:   string | null
  durationMs:       number
  verificationTier: 'interaction'
}

export interface VerificationReport {
  appName:          string
  modelVersion:     string
  runId:            string
  startedAt:        string
  completedAt:      string
  elementResults:   ElementResult[]
  flowResults:      FlowResult[]
  setupFailures:    SetupFailure[]
  elementsPassed:   number
  elementsTotal:    number
  elementsCouldNotVerify: number   // Block B — FORGE could not look (distinct from failed)
  flowsPassed:      number
  flowsTotal:       number
  // Path B/D visible gaps (Nova/Finn): a crawl-worthy page with 0 critical
  // elements is likely under-classified; a skipped mutation is a real coverage gap.
  pagesWithNoCriticalElements: string[]   // Path B — page ids skipped for 0 critical elements
  endpointsSkipped: number                // Path D — mutations/path-param endpoints NOT verified
  confidenceScore:  number | null   // null = insufficient-evidence (ADR-015); never a default
  confidenceLevel:  'HIGH' | 'MEDIUM' | 'LOW' | 'insufficient-evidence'
  recommendation:   string
}

/**
 * ADR-015 — Applicability ≠ Evidence ≠ Outcome; these must never share one
 * variable (the old 0.6 literal was all three at once — weight, default, result).
 * A confidence component is scored ONLY when it is APPLICABLE (structurally
 * relevant to this app type) AND gathered evidence:
 *   - not applicable         → excluded from numerator AND denominator (no penalty)
 *   - applicable, total === 0 → evidence was expected but not gathered: contributes
 *                               0, but KEEPS its weight in the denominator
 *   - applicable, total  >  0 → (passed / total) * weight
 * Score = Σ(earned) / Σ(applicable weights), renormalised. Returns null when NO
 * applicable component gathered any evidence — never 0.0, never a sentinel.
 */
export interface ScoreComponent {
  applicable: boolean
  total:      number
  passed:     number
  weight:     number
}

export function computeConfidence(components: ScoreComponent[]): number | null {
  const applicable = components.filter(c => c.applicable)
  // No applicable component gathered ANY evidence → insufficient evidence.
  if (!applicable.some(c => c.total > 0)) return null
  const denom = applicable.reduce((s, c) => s + c.weight, 0)
  if (denom === 0) return null
  const earned = applicable.reduce(
    (s, c) => s + (c.total > 0 ? (c.passed / c.total) * c.weight : 0),
    0,
  )
  return Math.round((earned / denom) * 100) / 100
}

// ── LIE-1: endpoint status routing (Verify) ──────────────────────────────────
// Governing rule: aggregate to the weakest truth (failed > could-not-verify >
// passed). Only a 2xx is a PROVEN success. 5xx / network / timeout is a real
// server-side failure. Everything else — 4xx (incl. 401/403) and any unexpected
// 1xx/3xx — is could-not-verify: FORGE has NO expected-response contract for the
// endpoint (EndpointDefinition.responses is empty in every current model), so it
// cannot confirm success, yet a client-side status is not a server failure either.
// The remedy text lives in `error` for now — ElementResult has no dedicated remedy
// field; a machine-readable remedy field is the ADR-016-correct home (see the
// follow-up flag in the TD). Pure + exported so the V-suite asserts it directly.
export function classifyEndpointResult(
  probe: { status: number } | { error: string },
): { status: ElementResult['status']; error: string | null } {
  if ('error' in probe) return { status: 'failed', error: probe.error }
  const s = probe.status
  if (s >= 200 && s < 300)     return { status: 'passed', error: null }
  if (s >= 500)                return { status: 'failed', error: `HTTP ${s}` }
  if (s === 401 || s === 403)  return {
    status: 'could-not-verify',
    error:  `HTTP ${s} (auth wall). Provide auth headers or a valid session in project config to verify this endpoint.`,
  }
  return {
    status: 'could-not-verify',
    error:  `HTTP ${s}. No expected-response contract in the endpoint model — cannot confirm success. Populate endpoint \`responses\` (expected status) to enable a pass/fail verdict.`,
  }
}

// ── LIE-2: no-op steps → flow could-not-verify (Verify) ──────────────────────
export type StepOutcome = 'executed' | 'no-op'

const KNOWN_STEP_ACTIONS = new Set<string>([
  'navigate', 'fill', 'click', 'assert-navigation', 'assert-element-visible', 'select',
])

// A step that performs NO real work / executes NO assertion — the SINGLE source
// of truth for the no-op decision (executeStep delegates here; the V-suite asserts
// it directly). ADR-015(b): a step FORGE could not perform is NOT evidence of
// success. The exact case list is locked (Nova + Finn); do not re-derive.
export function isNoOpStep(step: FlowStep): boolean {
  switch (step.action) {
    case 'navigate':               return false
    case 'fill':
    case 'click':
    case 'assert-element-visible': return !step.elementId
    case 'select':                 return !step.elementId || !step.value
    case 'assert-navigation':      return !step.value   // empty pattern → waitForURL(includes('')) is always-true → no-op, NOT a pass
    default:                       return true          // unknown action
  }
}

// Weakest-truth precedence for the flow verdict: a hard failure dominates a blind
// (could-not-verify) step, which dominates a clean pass. Pure + exported (V-suite).
export function finalizeFlowStatus(
  failedAtStep: number | null,
  unverifiedAtStep: number | null,
): FlowResult['status'] {
  if (failedAtStep !== null)     return 'failed'
  if (unverifiedAtStep !== null) return 'could-not-verify'
  return 'passed'
}

// Readiness verdict + human-facing gap list (ADR-015 "readiness is EARNED"). The
// element and flow axes are handled ADJACENTLY so they mirror EXACTLY: a
// could-not-verify (FORGE could not look / execute an assertion) is NEVER a
// failure — it is excluded from the failed count and labeled distinctly — yet it
// STILL blocks 'ready' (ADR-016). Pure + exported so the V-suite asserts the gate
// and the (distinct) could-not-verify vs failed messages directly.
export function assessReadiness(input: {
  confidenceScore:         number | null
  anyApplicableUnmeasured: boolean
  elementsTotal:           number
  elementsPassed:          number
  elementsCouldNotVerify:  number
  flowsTotal:              number
  flowsPassed:             number
  flowsCouldNotVerify:     number
  setupFailures:           SetupFailure[]
}): { modelReady: boolean; notReady: string[]; failedElements: number; failedFlows: number } {
  const failedElements = input.elementsTotal - input.elementsPassed - input.elementsCouldNotVerify
  const failedFlows    = input.flowsTotal    - input.flowsPassed    - input.flowsCouldNotVerify

  const notReady: string[] = []
  if (input.confidenceScore === null)   notReady.push('insufficient evidence — no applicable component gathered any evidence')
  if (input.anyApplicableUnmeasured)    notReady.push('an applicable component was expected but not measured (0 elements or 0 flows where evidence was due)')
  if (input.elementsCouldNotVerify > 0) notReady.push(`${input.elementsCouldNotVerify} element(s) could-not-verify (FORGE could not look)`)
  if (failedElements > 0)               notReady.push(`${failedElements} element check(s) failed`)
  if (input.flowsCouldNotVerify > 0)    notReady.push(`${input.flowsCouldNotVerify} flow(s) could not be verified (a step executed no assertion) — model not ready until resolved`)
  if (failedFlows > 0)                  notReady.push(`${failedFlows} flow(s) failed`)
  if (input.setupFailures.length > 0)   notReady.push(`${input.setupFailures.length} page(s) had failed prerequisites (${input.setupFailures.map(f => f.pageId).join(', ')})`)

  const modelReady =
    input.confidenceScore !== null &&
    !input.anyApplicableUnmeasured &&
    input.elementsCouldNotVerify === 0 &&
    input.flowsCouldNotVerify === 0 &&
    failedElements === 0 &&
    failedFlows === 0 &&
    input.setupFailures.length === 0

  return { modelReady, notReady, failedElements, failedFlows }
}

// ── VerificationRunner ────────────────────────────────────────────────────────

export class VerificationRunner {

  private screenshotDir: string
  private runId:         string

  constructor(
    private appName: string,
    private config?: OnboardingConfig,
    private workspace: Workspace = createWorkspace(REPO_ROOT),
    private appModels: AppModelService = new AppModelService(),
    operationId?: string,
  ) {
    this.runId         = operationId ?? `verify-${appName}-${Date.now()}`
    this.screenshotDir = path.join(REPO_ROOT, 'reports', 'verify')
    fs.mkdirSync(this.screenshotDir, { recursive: true })
  }

  async run(): Promise<VerificationReport> {
    const model = await this.appModels.requireActive(this.appName)

    // TC-04 (2026-07-13): refuse to emit a "verification report" for an app FORGE
    // never explored. An authoritative snapshot can be contentless after
    // bootstrap. Same emptiness precondition + error as the
    // generator. Thrown BEFORE any browser launch; on the OperatorFacingError rail
    // (ExecutionContext's verify case + CLI both surface it).
    if (!modelHasContent(model)) {
      throw new EmptyModelError(this.appName, {
        evidenceState: model.app.evidenceState,
        diagnostics:   model.app.crawlMetadata?.crawlDiagnostics ?? null,
      })
    }

    const pages     = model.pages  || []
    const flows     = model.flows  || []
    const startedAt = new Date().toISOString()

    this.printHeader(model)

    const isApi          = model.app.appType === 'rest-api' || model.app.appType === 'graphql-api'
    let   browser: Browser | null = null
    const elementResults: ElementResult[] = []
    const flowResults:    FlowResult[]    = []
    const setupFailures:  SetupFailure[]  = []
    // Path B / Path D surfacing (Nova/Finn rulings) — make FORGE's own gaps
    // VISIBLE rather than hidden behind a number.
    const noCriticalPages: string[] = []   // pages skipped for 0 critical elements (Path B)
    let   endpointsSkipped = 0             // mutations / path-param endpoints not verified (Path D)

    try {
      // ── Element verification ──────────────────────────────────────────
      console.log('\nELEMENTS\n')

      // ── API endpoint verification (rest-api / graphql-api) ──────────────────
      if (isApi) {
        const endpoints = model.endpoints ?? []
        for (const endpoint of endpoints) {
          const start  = Date.now()
          const label  = `${endpoint.method} ${endpoint.path}`
          try {
            if ((endpoint.method === 'GET' || endpoint.path === '/ping') && !endpoint.path.includes('{')) {
              const apiContext = await request.newContext({
                baseURL: model.app.baseUrl,
              })
              const res = await apiContext.fetch(endpoint.path, {
                method:  endpoint.method,
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000,
              })
              const status     = res.status()
              const durationMs = Date.now() - start
              const verdict    = classifyEndpointResult({ status })   // LIE-1: weakest-truth routing
              const icon       = verdict.status === 'passed' ? '✓' : verdict.status === 'failed' ? '✗' : '?'
              console.log(`  ${icon} ${label.padEnd(40)} ${status}  (${durationMs}ms)`)
              elementResults.push({
                elementId:        `endpoint:${endpoint.method}:${endpoint.path}`,
                name:             label,
                pageId:           'api',
                status:           verdict.status,
                strategyUsed:     null,
                durationMs,
                error:            verdict.error,
                screenshotPath:   null,
                nearestMatch:     null,
                verificationTier: 'http-status',
              })
              await apiContext.dispose()
            } else {
              const reason = endpoint.path.includes('{') ? 'path param — needs ID' : `${endpoint.method} skipped (mutation)`
              console.log(`  [skip] ${label} — ${reason}`)
              endpointsSkipped++   // Path D: NOT APPLICABLE (deliberate safety skip), surfaced not hidden
            }
          } catch (e: any) {
            const durationMs = Date.now() - start
            const verdict    = classifyEndpointResult({ error: e.message })   // network/timeout → failed (unchanged)
            console.log(`  ✗ ${label.padEnd(40)} error  (${durationMs}ms) — ${e.message}`)
            elementResults.push({
              elementId:        `endpoint:${endpoint.method}:${endpoint.path}`,
              name:             label,
              pageId:           'api',
              status:           verdict.status,
              strategyUsed:     null,
              durationMs,
              error:            verdict.error,
              screenshotPath:   null,
              nearestMatch:     null,
              verificationTier: 'http-status',
            })
          }
          console.log('')
        }
        console.log('')
      }

      // ── Browser-based page element verification (web-ui only) ───────────────
      if (!isApi) {
        if (!browser) browser = await chromium.launch({ headless: true })
        for (const page of pages) {
          const critical = page.elements.filter(e => e.critical)
          if (critical.length === 0) { noCriticalPages.push(page.id); continue }   // Path B

          console.log(`  ${page.displayName.toUpperCase()}`)

          const context = await this.createContext(model, browser)
          const pw      = await context.newPage()

          try {
            // Authenticate if page requires it
            const authenticatedRoleId = await this.authenticateForPage(pw, page, model)

            // Run any declared prerequisite steps to establish required app
            // state (e.g. add an item to the cart) before checking elements.
            // Direct navigation alone can't reproduce state that only exists
            // after an in-app action — see TD-013.
            const prerequisiteSteps = (page.prerequisites ?? [])
              .find(p => !p.roleId || p.roleId === authenticatedRoleId)
              ?.steps ?? []

            let setupFailed = false
            for (const step of prerequisiteSteps) {
              try {
                await this.executeStep(pw, step, model)
              } catch (e: any) {
                const screenshotPath = await this.takeScreenshot(
                  pw, `setup-${page.id}-step${step.stepIndex}`
                )
                setupFailures.push({
                  pageId:    page.id,
                  roleId:    authenticatedRoleId,
                  stepIndex: step.stepIndex,
                  action:    step.action,
                  error:     e.message,
                  screenshotPath,
                })
                console.log(
                  `  ⚠ Prerequisite step ${step.stepIndex} (${step.action}) failed — ` +
                  `element checks skipped for ${page.displayName}: ${e.message}`
                )
                setupFailed = true
                break
              }
            }

            if (!setupFailed) {
              // Navigate to target page
              const targetUrl = page.urlPattern === '/'
                ? model.app.baseUrl
                : `${model.app.baseUrl}${page.urlPattern}`

              await pw.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout:   30000,
              })

              // Confirm we are not on the login page
              const currentUrl = pw.url()
              const redirectedToLogin = /\/$/.test(new URL(currentUrl).pathname) &&
                page.urlPattern !== '/'

              if (redirectedToLogin) {
                console.log(
                  `  ⚠ Redirected to login — credentials may be wrong for this page`
                )
              }

              for (const el of critical) {
                const result = await this.verifyElement(pw, el, page.id, model)
                elementResults.push(result)
                this.printElementResult(result)
              }
            }
          } catch (e: any) {
            console.log(`  ⚠ Could not load ${page.displayName}: ${e.message}`)
            // ADR-015 / Block B — absence must never read as perfection. A page
            // that failed to load emits a could-not-verify result for EACH of its
            // critical elements: they COUNT in elementsTotal and contribute 0 to
            // elementsPassed (so the score drops honestly), but are a distinct
            // diagnosis — "FORGE could not look" — not a model failure. Without
            // this, a run where every page failed to load pushed zero results and
            // scored 1.0/HIGH/"Model is ready" for an app that never opened.
            for (const el of critical) {
              elementResults.push({
                elementId:        el.id,
                name:             el.name,
                pageId:           page.id,
                status:           'could-not-verify',
                strategyUsed:     null,
                durationMs:       0,
                error:            `page load failed: ${e.message}`,
                screenshotPath:   null,
                nearestMatch:     null,
                verificationTier: 'dom-presence',
              })
            }
          } finally {
            await pw.close()
            await context.close()
          }

          console.log('')
        }
      }

      // ── Flow verification ─────────────────────────────────────────────
      console.log('FLOWS\n')
      if (isApi) {
        console.log('  [skip] Flow verification not applicable for API app types\n')
      }
      for (const flow of flows.filter(() => !isApi)) {
        if (!browser) browser = await chromium.launch({ headless: true })
        const context = await this.createContext(model, browser)
        const pw      = await context.newPage()

        try {
          // Authenticate for the flow's role if needed
          const role = model.roles.find(r => r.id === flow.roleId)
          if (role && role.authFlow !== 'none' && role.credentialsEnvKey) {
            const raw = process.env[role.credentialsEnvKey]
            if (raw) {
              const [username, password] = raw.split(':')
              const loginPage = (model.pages || []).find(p => p.isAuthPage)
              if (loginPage && username && password) {
                const usernameEl = loginPage.elements.find(
                  e => e.name.toLowerCase().includes('username')
                )
                const passwordEl = loginPage.elements.find(
                  e => e.name.toLowerCase().includes('password')
                )
                const submitEl = loginPage.elements.find(
                  e => e.kind === 'button' && e.critical
                )
                // Resolve selectors: role config → model elements → generic fallback
                const configRole    = (this.config?.roles ?? []).find((r: any) => r.id === role.id)
                const roleSelectors = (configRole as any)?.selectors ?? {}
                const userSel = roleSelectors.username
                  ?? (usernameEl ? this.strategyToSelector(usernameEl.strategies[0]) : 'input[placeholder*=user i]')
                const passSel = roleSelectors.password
                  ?? (passwordEl ? this.strategyToSelector(passwordEl.strategies[0]) : 'input[type=password]')
                const submitSel = roleSelectors.submit
                  ?? (submitEl ? this.strategyToSelector(submitEl.strategies[0]) : 'button[type=submit]')
                // Use role.loginUrl if defined, fall back to baseUrl
                const loginUrl = (configRole as any)?.loginUrl ?? model.app.baseUrl
                await pw.goto(loginUrl, { waitUntil: 'domcontentloaded' })
                const usernameLocator = pw.locator(userSel).first()
                await usernameLocator.waitFor({ state: 'visible', timeout: 15000 })
                await usernameLocator.fill(username)
                await pw.locator(passSel).first().fill(password)
                const successUrl = (configRole as any)?.successUrl ?? null
                await pw.locator(submitSel).first().click()
                // Wait for SPA route change; fall back to networkidle
                try {
                  if (successUrl) {
                    await pw.waitForURL(`**${successUrl}**`, { timeout: 20000 })
                  } else {
                    await pw.waitForURL(url => url.href !== loginUrl, { timeout: 15000 })
                  }
                } catch {
                  await pw.waitForLoadState('domcontentloaded', { timeout: 15000 })
                  await pw.waitForTimeout(1500)
                }
                const currentUrl = pw.url()
                if (successUrl && !currentUrl.includes(successUrl)) {
                  console.warn(`  ⚠ Auth may have failed — expected URL to contain ${successUrl}, got ${currentUrl}`)
                } else {
                  console.log(`  [auth] Flow authenticated as ${role.id} — URL: ${currentUrl}`)
                }

                // After auth, navigate to the flow's starting page
                const firstFlowStep = (flow.steps || [])[0]
                if (firstFlowStep && firstFlowStep.pageId) {
                  const startPage = (model.pages || []).find(
                    p => p.id === firstFlowStep.pageId
                  )
                  if (startPage && !startPage.isAuthPage && startPage.urlPattern) {
                    try {
                      await pw.goto(
                        `${model.app.baseUrl}${startPage.urlPattern}`,
                        { waitUntil: 'domcontentloaded', timeout: 15000 }
                      )
                    } catch { /* redirect on base url is OK */ }
                  }
                }
              }
            }
          }

          const result = await this.verifyFlow(pw, flow, model)
          flowResults.push(result)
          this.printFlowResult(result)
        } catch (e: any) {
          flowResults.push({
            flowId:           flow.id,
            displayName:      flow.displayName,
            status:           'failed',
            stepsTotal:       (flow.steps || []).length,
            stepsPassed:      0,
            failedAtStep:     0,
            error:            e.message,
            screenshotPath:   null,
            durationMs:       0,
            verificationTier: 'interaction',
          })
          console.log(`  ✗ ${flow.displayName} — setup failed: ${e.message}`)
        } finally {
          await pw.close()
          await context.close()
        }
      }

    } finally {
      if (browser) await browser.close()
    }

    const report = this.buildReport(
      model, elementResults, flowResults, setupFailures, startedAt,
      endpointsSkipped, noCriticalPages,
    )

    await this.saveReport(report)
    this.printSummary(report)

    // Write model back if any heals occurred
    const healed = elementResults.filter(r => r.status === 'healed')
    if (healed.length > 0) {
      await this.writeModelHealbacks(model, healed)
    }

    return report
  }

  // ── Element verification ────────────────────────────────────────────────────

  private async verifyElement(
    page:    Page,
    el:      ElementDefinition,
    pageId:  string,
    model:   AppModel
  ): Promise<ElementResult> {
    const start = Date.now()

    // TD-033/TD-047 contract: this only ever confirms the element is present
    // in the DOM at this URL (`state: 'attached'`) — it does not, and per the
    // Option D design decision will not, confirm real-session visibility or
    // interactability. That gap is documented on `ElementResult`'s
    // `verificationTier` field above, not closed here.
    for (const strategy of el.strategies) {
      const selector = this.strategyToSelector(strategy)
      try {
        const locator = page.locator(selector).first()
        await locator.waitFor({ state: 'attached', timeout: 5000 })

        return {
          elementId:        el.id,
          name:             el.name,
          pageId,
          status:           strategy === el.strategies[0] ? 'passed' : 'healed',
          strategyUsed:     strategy,
          durationMs:       Date.now() - start,
          error:            null,
          screenshotPath:   null,
          nearestMatch:     null,
          verificationTier: 'dom-presence',
        }
      } catch {
        // try next strategy
      }
    }

    // All strategies failed — take screenshot and find nearest match
    const screenshotPath = await this.takeScreenshot(page, `el-${el.name}`)
    const nearestMatch   = await this.findNearestMatch(page, el)

    return {
      elementId:        el.id,
      name:             el.name,
      pageId,
      status:           'failed',
      strategyUsed:     null,
      durationMs:       Date.now() - start,
      error:            `All ${el.strategies.length} strategies failed`,
      screenshotPath,
      nearestMatch,
      verificationTier: 'dom-presence',
    }
  }

  private async findNearestMatch(
    page: Page,
    el:   ElementDefinition
  ): Promise<string | null> {
    try {
      const dataTestEls = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-test]'))
          .map(e => e.getAttribute('data-test'))
          .filter(Boolean)
          .slice(0, 10)
      })
      if (dataTestEls.length > 0) {
        return `data-test candidates: ${dataTestEls.join(', ')}`
      }
    } catch {}
    return null
  }

  // ── Flow verification ───────────────────────────────────────────────────────

  // TD-033/TD-047 contract: unlike verifyElement()'s DOM-presence-only check,
  // this performs real interaction via executeStep() — actual click/fill/
  // selectOption calls and a real visibility wait for assert-element-visible
  // steps — a stronger, different-mechanism signal. Still not a full
  // real-user-session guarantee: it arrives at the flow's starting page via
  // page.goto(), same as element verification, just once per flow rather than
  // once per page. See the `verificationTier` field on ElementResult/
  // FlowResult above for how this is represented in the report.
  private async verifyFlow(
    page:  Page,
    flow:  FlowDefinition,
    model: AppModel
  ): Promise<FlowResult> {
    const start       = Date.now()
    let stepsPassed   = 0
    let failedAtStep:     number | null = null
    let unverifiedAtStep: number | null = null   // LIE-2: index where the flow went blind
    let error:        string | null = null
    let screenshotPath: string | null = null

    const firstStep    = (flow.steps || [])[0]
    const firstPageDef = (model.pages || []).find(p => p.id === firstStep?.pageId)
    const startsOnAuth = firstPageDef?.isAuthPage ?? true

    if (startsOnAuth) {
      await page.goto(model.app.baseUrl, { waitUntil: 'domcontentloaded' })
    }

    // Three-way tally (Nova + Finn, weakest-truth): a hard failure (throw) breaks
    // and dominates; a no-op step (executed NO assertion) breaks and records the
    // flow as could-not-verify — it is NOT counted as a passed step. Only a genuine
    // 'executed' outcome increments stepsPassed.
    for (const step of (flow.steps || [])) {
      try {
        const outcome = await this.executeStep(page, step, model)
        if (outcome === 'no-op') {
          unverifiedAtStep = step.stepIndex
          error = `Step ${step.stepIndex} (${step.action}) executed no assertion — elementId missing from runtime DOM (selector may have changed, or element is dynamic/un-hydrated). Update the selector in the model, or use agentic exploration to reach the element before asserting.`
          break   // stop — the flow is unproven from here
        }
        stepsPassed++
      } catch (e: any) {
        failedAtStep   = step.stepIndex
        error          = e.message
        screenshotPath = await this.takeScreenshot(
          page, `flow-${flow.id}-step${step.stepIndex}`
        )
        break   // hard fail — dominates
      }
    }

    return {
      flowId:           flow.id,
      displayName:      flow.displayName,
      status:           finalizeFlowStatus(failedAtStep, unverifiedAtStep),
      stepsTotal:       (flow.steps || []).length,
      stepsPassed,
      failedAtStep,
      unverifiedAtStep: unverifiedAtStep ?? undefined,
      error,
      screenshotPath,
      durationMs:       Date.now() - start,
      verificationTier: 'interaction',
    }
  }

  private async executeStep(
    page:  Page,
    step:  FlowStep,
    model: AppModel
  ): Promise<StepOutcome> {
    // LIE-2: a no-op step performs no assertion — report it as such (do NOT throw,
    // do NOT silently succeed). isNoOpStep is the single source of truth for the
    // decision; below the guard every case does REAL work and returns 'executed'.
    if (isNoOpStep(step)) {
      if (!KNOWN_STEP_ACTIONS.has(step.action)) {
        console.log(`    [skip] Unknown action: ${(step as any).action}`)
      }
      return 'no-op'
    }

    const timeout = 10000

    switch (step.action) {
      case 'navigate': {
        await page.goto(
          `${model.app.baseUrl}${step.value || ''}`,
          { waitUntil: 'domcontentloaded', timeout }
        )
        return 'executed'
      }

      case 'fill': {
        const el       = this.findElement(step.elementId!, model)
        const selector = el ? this.strategyToSelector(el.strategies[0]) : step.elementId!
        const value    = this.resolveValue(step.value || '')
        await page.fill(selector, value, { timeout })
        return 'executed'
      }

      case 'click': {
        const el       = this.findElement(step.elementId!, model)
        const selector = el ? this.strategyToSelector(el.strategies[0]) : step.elementId!
        await page.click(selector, { timeout })
        return 'executed'
      }

      case 'assert-navigation': {
        const pattern = step.value!   // isNoOpStep guaranteed a non-empty pattern
        try {
          await page.waitForURL(
            url => url.href.includes(pattern),
            { timeout }
          )
        } catch {
          // fallback — check current URL contains pattern
          const current = page.url()
          if (!current.includes(pattern)) {
            throw new Error(
              `Expected URL to contain "${pattern}" but got "${current}"`
            )
          }
        }
        return 'executed'
      }

      case 'assert-element-visible': {
        const el       = this.findElement(step.elementId!, model)
        const selector = el ? this.strategyToSelector(el.strategies[0]) : step.elementId!
        await page.locator(selector).waitFor({ state: 'visible', timeout })
        return 'executed'
      }

      case 'select': {
        const el       = this.findElement(step.elementId!, model)
        const selector = el ? this.strategyToSelector(el.strategies[0]) : step.elementId!
        await page.selectOption(selector, step.value!)
        return 'executed'
      }

      default:
        // Unreachable: isNoOpStep already returned 'no-op' for unknown actions.
        return 'no-op'
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async createContext(
    model:   AppModel,
    browser: Browser
  ): Promise<BrowserContext> {
    return browser.newContext({
      baseURL: model.app.baseUrl,
    })
  }

  private async authenticateForPage(
    page:     Page,
    pageDef:  PageDefinition,
    model:    AppModel
  ): Promise<string | null> {
    // Login page and guest-accessible pages need no auth
    if (pageDef.isAuthPage) return null
    if (pageDef.accessibleByRoles.includes('guestPage') &&
        pageDef.accessibleByRoles.length === 1) return null

    // Find a non-guest role that can access this page
    const roleId = pageDef.accessibleByRoles.find(r => r !== 'guestPage')
    if (!roleId) return null

    const role = model.roles.find(r => r.id === roleId)
    if (!role || role.authFlow === 'none') return null
    if (!role.credentialsEnvKey) return null

    const raw = process.env[role.credentialsEnvKey]
    if (!raw) {
      console.log(
        `  ⚠ Missing env var ${role.credentialsEnvKey} — skipping auth`
      )
      return null
    }

    const [username, password] = raw.split(':')
    if (!username || !password) return null

    // Find login page
    const loginPage = (model.pages || []).find(p => p.isAuthPage)
    if (!loginPage) return null

    // Find login elements from model
    const usernameEl = loginPage.elements.find(
      e => e.name.toLowerCase().includes('username') ||
           e.name.toLowerCase().includes('user')
    )
    const passwordEl = loginPage.elements.find(
      e => e.name.toLowerCase().includes('password') ||
           e.name.toLowerCase().includes('pass')
    )
    const submitEl = loginPage.elements.find(
      e => e.kind === 'button' && e.critical
    )

    // Resolve selectors: role config → model elements → generic fallback
    const configRole    = (this.config?.roles ?? []).find((r: any) => r.id === roleId)
    const roleSelectors = (configRole as any)?.selectors ?? {}
    const userSelector = roleSelectors.username
      ?? (usernameEl ? this.strategyToSelector(usernameEl.strategies[0]) : 'input[placeholder*=user i]')
    const passSelector = roleSelectors.password
      ?? (passwordEl ? this.strategyToSelector(passwordEl.strategies[0]) : 'input[type=password]')
    const submitSelector = roleSelectors.submit
      ?? (submitEl ? this.strategyToSelector(submitEl.strategies[0]) : 'button[type=submit]')
    // Use role.loginUrl if defined, fall back to baseUrl
    const loginUrl = (configRole as any)?.loginUrl ?? model.app.baseUrl
    try {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
      const usernameLocator = page.locator(userSelector).first()
      await usernameLocator.waitFor({ state: 'visible', timeout: 15000 })
      await usernameLocator.fill(username)
      await page.locator(passSelector).first().fill(password)
      const authSuccessUrl = (configRole as any)?.successUrl ?? null
      await page.locator(submitSelector).first().click()
      try {
        if (authSuccessUrl) {
          await page.waitForURL(`**${authSuccessUrl}**`, { timeout: 20000 })
        } else {
          await page.waitForURL(url => url.href !== loginUrl, { timeout: 15000 })
        }
      } catch {
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 })
      }
      console.log(`  [auth] Authenticated as ${roleId} — URL: ${page.url()}`)
      return roleId
    } catch (e: any) {
      console.log(`  ⚠ Auth failed for ${roleId}: ${e.message}`)
      return null
    }
  }

  private findElement(
    elementId: string,
    model:     AppModel
  ): ElementDefinition | null {
    for (const page of (model.pages || [])) {
      const el = page.elements.find(e => e.id === elementId)
      if (el) return el
    }
    return null
  }

  private strategyToSelector(strategy: Strategy): string {
    switch (strategy.type) {
      case 'data-test': return `[data-test="${strategy.value}"]`
      case 'id':        return `#${strategy.value}`
      case 'role':      return this.roleStrategyToSelector(strategy)
      case 'text':      return `text="${strategy.value}"`
      case 'css':       return strategy.value
      default:          return strategy.value
    }
  }

  // See TD-029 — builds Playwright's `role=` selector-engine string (the
  // string-selector equivalent of getByRole(role, { name })) from the two
  // clean fields, instead of guessing/parsing a compound value.
  private roleStrategyToSelector(strategy: Strategy): string {
    if (/[[\]'"]/.test(strategy.value)) {
      throw new Error(
        `[VerificationRunner] Role strategy value "${strategy.value}" is compound (contains '[', ']', or a quote) ` +
        `— expected a bare ARIA role token with accessibleName as a separate field (see TD-029). This indicates ` +
        `ElementClassifier.buildRoleSelector() regressed to the pre-fix compound-string format, or this model ` +
        `predates TD-029 — re-run the crawl step to refresh it.`
      )
    }
    return strategy.accessibleName
      ? `role=${strategy.value}[name="${escapeRoleAccessibleName(strategy.accessibleName)}"]`
      : `role=${strategy.value}`
  }


  private resolveValue(value: string): string {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (process.env[key]) return process.env[key]!

      const credKey = key
        .replace(/_USERNAME$/, '_CREDENTIALS')
        .replace(/_PASSWORD$/, '_CREDENTIALS')
      const raw = process.env[credKey]
      if (raw) {
        const [username, password] = raw.split(':')
        if (key.endsWith('_USERNAME')) return username || ''
        if (key.endsWith('_PASSWORD')) return password || ''
      }

      // Also handle CHECKOUT_ prefix vars directly
      return process.env[key] || ''
    })
  }

  private async takeScreenshot(page: Page, name: string): Promise<string> {
    const fileName = `${name}-${Date.now()}.png`
    const filePath = path.join(this.screenshotDir, fileName)
    try {
      await page.screenshot({ path: filePath, fullPage: false })
      return filePath
    } catch {
      return ''
    }
  }

  private async writeModelHealbacks(
    model:  AppModel,
    healed: ElementResult[]
  ): Promise<void> {
    const operationId = `${this.runId}:healback`
    const replay = await this.appModels.replayCommittedOperation(
      model.app.name,
      operationId,
      snapshot => this.workspace.saveModelProjection(model.app.name, snapshot),
    )
    if (replay) {
      const commit = requireProjectedCommit(replay)
      console.log(
        `[Verify] Healback operation ${commit.outcome}; skipped candidate rebuild ` +
        `and projected SQLite row ${commit.committed.rowId} ` +
        `v${commit.committed.snapshot.app.modelVersion}.`,
      )
      return
    }

    let changed = false

    for (const result of healed) {
      if (!result.strategyUsed) continue
      const [pageId, elName] = result.elementId.split(':')
      const page = (model.pages || []).find(p => p.id === pageId)
      if (!page) continue
      const el = page.elements.find(e => e.name === elName)
      if (!el) continue

      // Promote healed strategy to primary — but never let a low-confidence
      // text heal displace a structurally reliable data-test/id strategy.
      // A loose text match can land on unrelated page content (e.g. footer
      // copyright text); silently promoting that would corrupt the model.
      const idx = el.strategies.findIndex(
        s => s.type === result.strategyUsed!.type &&
             s.value === result.strategyUsed!.value
      )
      const current   = el.strategies[0]
      const isDowngrade = result.strategyUsed.type === 'text' &&
        (current.type === 'data-test' || current.type === 'id')

      if (idx > 0 && !isDowngrade) {
        const [promoted] = el.strategies.splice(idx, 1)
        el.strategies.unshift(promoted)
        console.log(
          `[Verify] Healed ${result.elementId} — ` +
          `promoted ${result.strategyUsed.type} strategy to primary`
        )
        changed = true
      } else if (isDowngrade) {
        console.log(
          `[Verify] Healed ${result.elementId} via text but kept ` +
          `${current.type} as primary (low-confidence heal)`
        )
      }
    }

    if (changed) {
      const { modelVersion: previousModelVersion, ...app } = model.app
      const candidate: AppModelCandidate = {
        ...model,
        generatedAt: new Date().toISOString(),
        generatedBy: 'engine',
        app,
        diff: {
          previousModelVersion,
          diffGeneratedAt: new Date().toISOString(),
          pagesAdded: [],
          pagesRemoved: [],
          pagesModified: null,
          elementsAdded: null,
          elementsRemoved: null,
          strategiesInvalidated: null,
          flowsAdded: null,
          flowsRemoved: null,
        },
      }
      const commit = requireProjectedCommit(await this.appModels.commitAndProject(
        candidate,
        operationId,
        snapshot => this.workspace.saveModelProjection(model.app.name, snapshot),
      ))
      console.log(
        `[Verify] Healed App Model ${commit.outcome} in SQLite as row ` +
        `${commit.committed.rowId} v${commit.committed.snapshot.app.modelVersion}; ` +
        `compatibility JSON projected from the re-read committed snapshot.`,
      )
    }
  }

  // ── Report building ──────────────────────────────────────────────────────────

  private buildReport(
    model:             AppModel,
    elementResults:    ElementResult[],
    flowResults:       FlowResult[],
    setupFailures:     SetupFailure[],
    startedAt:         string,
    endpointsSkipped:  number,
    noCriticalPages:   string[],
  ): VerificationReport {
    // Element/flow ratios are computed purely from elementResults/flowResults —
    // pages whose prerequisites failed never get an ElementResult (their
    // critical-element loop is skipped entirely, see `run()`), so a setup
    // failure can never masquerade as a passed or failed selector check here.
    const elementsPassed = elementResults.filter(
      r => r.status === 'passed' || r.status === 'healed'
    ).length
    const elementsTotal  = elementResults.length
    // Block B — distinct diagnosis surfaced at the summary level (not just in the
    // per-result detail): elements FORGE could not look at. Counted in the total,
    // never in passed.
    const elementsCouldNotVerify = elementResults.filter(r => r.status === 'could-not-verify').length
    const flowsPassed    = flowResults.filter(r => r.status === 'passed').length
    const flowsTotal     = flowResults.length
    // LIE-2 symmetry (mirrors elementsCouldNotVerify): flows that executed NO
    // assertion. Counted in flowsTotal, never in flowsPassed OR failedFlows.
    const flowsCouldNotVerify = flowResults.filter(r => r.status === 'could-not-verify').length

    // TD-033/TD-047 design decision (Option D — contract redefinition, not a
    // navigation/check-criteria fix): this 0.6/0.4 blend mixes two genuinely
    // different verification mechanisms — elementScore is DOM-presence-only
    // (or HTTP-status-only for API apps; see ElementResult.verificationTier),
    // flowScore includes real click/fill/visibility interaction (see
    // FlowResult.verificationTier). The resulting confidenceScore/
    // confidenceLevel tells you how well the model matches what's actually on
    // the page — it is NOT a predictor of whether a real user session would
    // see/use these elements successfully, and must not be treated as one by
    // future features (Dashboard, confidence-based gating, etc.). That
    // behavioral question is the generated-spec CI run's job. See "Design
    // decisions captured" in TECH_DEBT.md.
    // ADR-015 component-aware score. Applicability is DERIVED from the model's
    // appType — never declared, never hardcoded per-app. Elements are always
    // applicable (every app verifies elements/endpoints). Flows are NOT applicable
    // to API apps: flow verification is structurally skipped for them (run()'s
    // FLOWS section, `flows.filter(() => !isApi)`), so flowsTotal is always 0 —
    // excluding them lets an API app still reach HIGH on elements alone.
    const isApi = model.app.appType === 'rest-api' || model.app.appType === 'graphql-api'
    const components: ScoreComponent[] = [
      { applicable: true,   total: elementsTotal, passed: elementsPassed, weight: 0.6 },
      { applicable: !isApi, total: flowsTotal,    passed: flowsPassed,    weight: 0.4 },
    ]
    // 0.6/0.4 are WEIGHTS ONLY — never no-evidence defaults (that conflation WAS
    // the bug). An applicable component with zero evidence earns 0 while keeping
    // its weight in the denominator; the score drops honestly. null → INSUFFICIENT.
    const confidenceScore = computeConfidence(components)

    let confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'insufficient-evidence'
    if (confidenceScore === null) {
      confidenceLevel = 'insufficient-evidence'
    } else {
      confidenceLevel =
        confidenceScore >= 0.85 ? 'HIGH' :
        confidenceScore >= 0.65 ? 'MEDIUM' : 'LOW'
      // A clean ratio on the pages that DID run elements must not read as HIGH if
      // other pages' state could never be verified at all (TD-013).
      if (setupFailures.length > 0 && confidenceLevel === 'HIGH') {
        confidenceLevel = 'MEDIUM'
      }
    }

    // ADR-015 — "Model is ready" is now EARNED, never a bare HIGH. Nova's gate,
    // ALL of: verification completed (this report exists) + every APPLICABLE
    // component was measured + no insufficient-evidence + ZERO could-not-verify +
    // no critical failures. Otherwise FORGE states exactly WHY it cannot say it —
    // never a bare number.
    const anyApplicableUnmeasured = components.some(c => c.applicable && c.total === 0)
    // Element AND flow readiness, mirrored (see assessReadiness). A could-not-verify
    // on EITHER axis is excluded from the failed count, labeled distinctly, and
    // blocks 'ready'. Score math above is untouched — this is gate/message only.
    const { modelReady, notReady } = assessReadiness({
      confidenceScore,
      anyApplicableUnmeasured,
      elementsTotal, elementsPassed, elementsCouldNotVerify,
      flowsTotal,    flowsPassed,    flowsCouldNotVerify,
      setupFailures,
    })

    // Visible gaps (Path B/D rulings) — surfaced whether or not the model is ready:
    const gaps: string[] = []
    if (noCriticalPages.length > 0) gaps.push(`${noCriticalPages.length} page(s) had 0 critical elements (${noCriticalPages.join(', ')}) — likely under-classified`)
    if (endpointsSkipped > 0)       gaps.push(`${endpointsSkipped} endpoint(s) skipped (mutations not verified for safety — coverage gap, see TD-UI-034)`)

    const recommendation =
      (modelReady
        ? 'Model is ready. Run: npm run onboard:generate'
        : `Model is NOT ready — ${notReady.join('; ')}. Review before generating.`)
      + (gaps.length > 0 ? ` [Gaps: ${gaps.join('; ')}]` : '')

    return {
      appName:         model.app.name,
      modelVersion:    model.app.modelVersion,
      runId:           this.runId,
      startedAt,
      completedAt:     new Date().toISOString(),
      elementResults,
      flowResults,
      setupFailures,
      elementsPassed,
      elementsTotal,
      elementsCouldNotVerify,
      flowsPassed,
      flowsTotal,
      pagesWithNoCriticalElements: noCriticalPages,
      endpointsSkipped,
      confidenceScore,
      confidenceLevel,
      recommendation,
    }
  }

  private async saveReport(report: VerificationReport): Promise<void> {
    const reportPath = path.join(
      REPO_ROOT, 'reports', 'verify', `${report.appName}-verify-report.json`,   // TD-109: was cwd-relative
    )
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

    try {
      await runMigrations()
      const runRepo = new RunRepository()
      await runRepo.insert({
        run_id:           report.runId,
        app_name:         report.appName,
        branch:           process.env.GITHUB_REF_NAME || 'local',
        commit_sha:       process.env.GITHUB_SHA      || 'local',
        environment:      (process.env.CI ? 'ci' : 'local') as any,
        base_url:         process.env.BASE_URL        || '',
        triggered_by:     'manual' as any,
        reporter_version: '5.4',
        // ADR-015 / Block D (Nova): "Verification is not a test execution. Never
        // write 'passed'." A verification produces a confidence VERDICT, not a
        // pass/fail test outcome — the real verdict lives in metadata
        // (confidenceLevel/confidenceScore). As a test-outcome, a verification is
        // always 'inconclusive'; this stops the phantom green (a zero-evidence
        // verification previously wrote 'passed' into the shared runs table).
        // NOTE: verification rows still pollute pass-rate aggregates (total_tests/
        // passed) that don't filter metadata.type='verification' — the proper fix
        // is separate VerificationRun records (TD-UI-037), too large for this TD.
        status:           'inconclusive',
        total_tests:      report.elementsTotal + report.flowsTotal,
        passed:           report.elementsPassed + report.flowsPassed,
        failed:           (report.elementsTotal - report.elementsPassed) +
                          (report.flowsTotal - report.flowsPassed),
        skipped:          0,
        duration_ms:      new Date(report.completedAt).getTime() -
                          new Date(report.startedAt).getTime(),
        started_at:       report.startedAt,
        completed_at:     report.completedAt,
        metadata:         JSON.stringify({
          type:             'verification',
          confidenceScore:  report.confidenceScore,
          confidenceLevel:  report.confidenceLevel,
          setupFailures:    report.setupFailures.length,
        }),
      })
    } catch (e) {
      console.warn('[Verify] DB write failed (non-fatal):', e)
    }
  }

  // ── Console output ───────────────────────────────────────────────────────────

  private printHeader(model: AppModel): void {
    console.log(
      `\nVerification Report — ${model.app.name} v${model.app.modelVersion}`
    )
    console.log('─'.repeat(52))
  }

  private printElementResult(result: ElementResult): void {
    const icon     = result.status === 'failed' ? '✗' :
                     result.status === 'healed' ? '⚡' : '✓'
    const strategy = result.strategyUsed
      ? `${result.strategyUsed.type}:${result.strategyUsed.value}`.slice(0, 35)
      : 'no strategy worked'
    const timing   = `(${result.durationMs}ms)`
    const line     = `  ${icon} ${result.name.padEnd(22)} ${strategy.padEnd(36)} ${timing}`
    console.log(line)

    if (result.status === 'failed') {
      if (result.nearestMatch) {
        console.log(`    → Nearest match: ${result.nearestMatch}`)
      }
      if (result.screenshotPath) {
        console.log(`    → Screenshot: ${result.screenshotPath}`)
      }
      console.log(
        `    Remedy: re-crawl or update the App Model through its SQLite-backed service`
      )
    }
    if (result.status === 'healed') {
      console.log(
        `    ⚡ Healed via ${result.strategyUsed?.type} — model updated`
      )
    }
  }

  private printFlowResult(result: FlowResult): void {
    const icon   = result.status === 'passed' ? '✓' :
                   result.status === 'could-not-verify' ? '?' : '✗'
    const steps  = `${result.stepsPassed}/${result.stepsTotal} steps`
    const timing = `(${result.durationMs}ms)`
    console.log(
      `  ${icon} ${result.displayName.padEnd(32)} ${steps.padEnd(12)} ${timing}`
    )

    if (result.status === 'failed') {
      console.log(`    → Failed at step ${result.failedAtStep}: ${result.error}`)
      if (result.screenshotPath) {
        console.log(`    → Screenshot: ${result.screenshotPath}`)
      }
    } else if (result.status === 'could-not-verify') {
      console.log(`    → Could not verify at step ${result.unverifiedAtStep}: ${result.error}`)
    }
  }

  private printSummary(report: VerificationReport): void {
    const line = '─'.repeat(52)
    console.log(`\n${line}`)
    console.log(`Elements: ${report.elementsPassed}/${report.elementsTotal} passed`)
    if (report.elementsCouldNotVerify > 0) {
      console.log(`          ${report.elementsCouldNotVerify} could-not-verify (FORGE could not look — page load / auth wall / timeout)`)
    }
    console.log(`Flows:    ${report.flowsPassed}/${report.flowsTotal} passed`)
    if (report.pagesWithNoCriticalElements.length > 0) {
      console.log(`Gaps:     ${report.pagesWithNoCriticalElements.length} page(s) with 0 critical elements — ${report.pagesWithNoCriticalElements.join(', ')} (likely under-classified)`)
    }
    if (report.endpointsSkipped > 0) {
      console.log(`Gaps:     ${report.endpointsSkipped} endpoint(s) skipped (mutations not verified for safety — coverage gap)`)
    }
    if (report.setupFailures.length > 0) {
      console.log(`Setup:    ${report.setupFailures.length} page(s) had failed prerequisites (elements skipped)`)
      for (const f of report.setupFailures) {
        console.log(`  ✗ ${f.pageId} — step ${f.stepIndex} (${f.action}): ${f.error}`)
      }
    }
    console.log(
      `Model confidence: ${report.confidenceLevel} ` +
      `(${report.confidenceScore === null ? 'insufficient evidence' : report.confidenceScore.toFixed(2)})`
    )
    console.log(`\n${report.recommendation}`)
    console.log(`${line}\n`)
  }
}
