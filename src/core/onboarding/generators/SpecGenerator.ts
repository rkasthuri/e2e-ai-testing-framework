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

import * as path from 'path'
import * as fs   from 'fs'
import {
  AppModel, FlowDefinition, FlowStep, PageDefinition,
  EndpointDefinition, ElementDefinition
} from '../types'
import {
  lines, indent, generatedHeader,
  toClassName, writeFile, BASE_PAGE_PROPERTIES, roleAuthFailedAtCrawl,
  escapeRoleAccessibleName,
} from './EmitHelper'
import {
  priorBroken, determineStepCapability, determineClickCapability, determineElementForm,
} from './assertionHelpers'
import { FORGE_COULD_NOT_VERIFY } from '../../healing/couldNotVerify'

let globalTestCounter = 0

function nextTestId(): string {
  globalTestCounter++
  return `TC-GEN-${String(globalTestCounter).padStart(3, '0')}`
}

/** TD-140 — one classified line of a generated test body. The generator TRACKS the
 *  executable/omission classification STRUCTURALLY as it builds each step (never by
 *  parsing rendered source — Nova R1: line-counting drifts on formatting/helpers/braces).
 *  `executable` XOR `omissionReason`: a step either emits ≥1 real statement (possibly with
 *  explanatory annotation comments) or it was omitted; an explanatory comment on a real
 *  assertion is NOT an omission. */
type EmittedStep = { lines: string[]; executable: boolean; omissionReason: string | null }

/** TD-140 — per generated test tally, read by GeneratorRunner into the GenerationManifest.
 *  `kind` lets the manifest count flow-step omissions ONCE (from the full-flow test, which
 *  replays every step) instead of per critical-elements prefix-replay. */
export type GeneratedTestTally = {
  testId: string
  flowId: string
  kind: 'full-flow' | 'critical' | 'smoke'
  executableCount: number
  omissionCount: number
  omissionReasons: string[]
}

/** Compact, deterministic summary of omitted-step reasons for a refusal message. */
function summarizeOmissions(reasons: string[]): string {
  if (reasons.length === 0) return 'no steps were requested'
  const counts = new Map<string, number>()
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1)
  return [...counts.entries()].map(([r, n]) => (n > 1 ? `${r} ×${n}` : r)).join(', ')
}

export class SpecGenerator {

  constructor(private model: AppModel) {}

  // TD-140: refusal evidence accumulated during a generate() call; read by GeneratorRunner
  // into the GenerationManifest so FORGE honestly refusing N tests is visible, not silent.
  private tally: GeneratedTestTally[] = []
  getTestTally(): GeneratedTestTally[] { return this.tally }

  generate(outputDir: string): void {
    const appType = this.model.app.appType
    if (appType === 'rest-api' || appType === 'graphql-api') {
      this.generateApiSpec(outputDir)
      return
    }
    // ── UI branch ─ existing per-flow spec generation ──────────────────────
    globalTestCounter = 0
    this.tally = []
    const flows = this.model.flows || []
    // TD-064 FC-004b: skip flows whose role's auth FAILED at crawl — emit NO spec for them
    // (their fixture is also omitted; emitting would leave a dangling fixture reference).
    // Excluded from currentFileNames too, so any stale spec for the omitted flow is pruned below.
    const emittedFlows = flows.filter(flow => {
      const roleDef = this.model.roles?.find(r => r.id === flow.roleId)
      if (roleDef && roleAuthFailedAtCrawl(roleDef)) {
        console.log(`[SpecGenerator] FORGE[omissionReason=role-authentication-failed]: flow '${flow.id}' omitted — role '${flow.roleId}' authentication failed at crawl.`)
        return false
      }
      return true
    })
    const currentFileNames = new Set(emittedFlows.map(flow => `${flow.id}.generated.spec.ts`))
    for (const flow of emittedFlows) {
      const content  = this.generateSpec(flow)
      const fileName = `${flow.id}.generated.spec.ts`
      const filePath = path.join(outputDir, 'specs', fileName)
      writeFile(filePath, content)
    }
    this.pruneOrphanedSpecs(outputDir, currentFileNames)
    console.log(`[SpecGenerator] Generated ${emittedFlows.length} spec files`)
  }

  // Removes previously-generated spec files whose flow ID no longer exists
  // in the current model (e.g. a renamed flow, or a re-timestamped inferred
  // flow) -- without this, every regeneration accumulates orphans that keep
  // executing against stale fixtures/selectors indefinitely.
  private pruneOrphanedSpecs(outputDir: string, currentFileNames: Set<string>): void {
    const specsDir = path.join(outputDir, 'specs')
    if (!fs.existsSync(specsDir)) return
    const existing = fs.readdirSync(specsDir).filter(f => f.endsWith('.generated.spec.ts'))
    for (const fileName of existing) {
      if (!currentFileNames.has(fileName)) {
        fs.unlinkSync(path.join(specsDir, fileName))
        console.log(`[SpecGenerator] Removed orphaned spec (no matching flow in current model): ${fileName}`)
      }
    }
  }

  private generateApiSpec(outputDir: string): void {
    const endpoints = this.model.endpoints || []
    const flows     = this.model.flows     || []
    const appName   = this.model.app.name
    const baseUrl   = this.model.app.baseUrl
    const ver       = this.model.app.modelVersion
    const hash      = this.model.app.crawlMetadata?.crawlConfigHash ?? ''

    const className = toClassName(appName).replace(/Page$/, 'ApiClient')

    const blocks: string[] = []

    for (const flow of flows) {
      if (flow.displayName === 'Authentication') {
        blocks.push(this.genAuthDescribe(endpoints, className, baseUrl))
      } else if (flow.displayName.endsWith('CRUD')) {
        const resource = flow.displayName.replace(' CRUD', '').toLowerCase()
        blocks.push(this.genCrudDescribe(endpoints, className, baseUrl, resource))
      } else if (flow.displayName === 'Health Check') {
        blocks.push(this.genHealthDescribe(endpoints, className, baseUrl))
      }
    }

    const content = lines(
      `// @generated from SQLite App Model v${ver} ${hash}`,
      `// DO NOT EDIT — regenerate with: npm run onboard:generate`,
      ``,
      `import { test, expect } from '@playwright/test'`,
      `import { ${className} } from './ApiClient'`,
      `import { newBooking, adminCredentials } from './fixtures.generated'`,
      ``,
      blocks.join('\n\n'),
      ``,
    )

    const filePath = path.join(outputDir, 'api.generated.spec.ts')
    writeFile(filePath, content)
    console.log(`[SpecGenerator] Generated api.generated.spec.ts`)
  }

  private genAuthDescribe(
    endpoints: EndpointDefinition[],
    className: string,
    baseUrl:   string
  ): string {
    return lines(
      `test.describe('Authentication', () => {`,
      `  test('should create auth token with valid credentials', async ({ request }) => {`,
      `    const client = new ${className}('${baseUrl}', request)`,
      `    const token  = await client.createToken(adminCredentials)`,
      `    expect(token).toBeTruthy()`,
      `    expect(typeof token).toBe('string')`,
      `  })`,
      `})`,
    )
  }

  private genCrudDescribe(
    endpoints: EndpointDefinition[],
    className: string,
    baseUrl:   string,
    resource:  string
  ): string {
    const capitalized = resource.charAt(0).toUpperCase() + resource.slice(1)
    return lines(
      `test.describe('${capitalized} CRUD', () => {`,
      `  test.describe.configure({ mode: 'serial' })`,
      ``,
      `  let token:     string`,
      `  let bookingId: number`,
      ``,
      `  test.beforeAll(async ({ request }) => {`,
      `    const client = new ${className}('${baseUrl}', request)`,
      `    token = await client.createToken(adminCredentials)`,
      `  })`,
      ``,
      `  test('should get all ${resource} ids', async ({ request }) => {`,
      `    const client = new ${className}('${baseUrl}', request)`,
      `    const ids = await client.get${capitalized}Ids()`,
      `    expect(Array.isArray(ids)).toBe(true)`,
      `  })`,
      ``,
      `  test('should create a ${resource}', async ({ request }) => {`,
      `    const client = new ${className}('${baseUrl}', request)`,
      `    const res = await client.create${capitalized}(newBooking)`,
      `    expect(res).toHaveProperty('${resource}id')`,
      `    bookingId = res.${resource}id`,
      `  })`,
      ``,
      `  test('should get ${resource} by id', async ({ request }) => {`,
      `    const client = new ${className}('${baseUrl}', request)`,
      `    const res = await client.get${capitalized}(String(bookingId))`,
      `    expect(res.firstname).toBe(newBooking.firstname)`,
      `  })`,
      ``,
      `  test('should update a ${resource}', async ({ request }) => {`,
      `    const client = new ${className}('${baseUrl}', request)`,
      `    client['token'] = token`,
      `    const updated = { ...newBooking, firstname: 'UpdatedName' }`,
      `    const res = await client.update${capitalized}(String(bookingId), updated)`,
      `    expect(res.firstname).toBe('UpdatedName')`,
      `  })`,
      ``,
      `  test('should partial update a ${resource}', async ({ request }) => {`,
      `    const client = new ${className}('${baseUrl}', request)`,
      `    client['token'] = token`,
      `    const res = await client.partialUpdate${capitalized}(String(bookingId), { firstname: 'Updated' })`,
      `    expect(res.firstname).toBe('Updated')`,
      `  })`,
      ``,
      `  test('should delete a ${resource}', async ({ request }) => {`,
      `    const client = new ${className}('${baseUrl}', request)`,
      `    client['token'] = token`,
      `    await client.delete${capitalized}(String(bookingId))`,
      `  })`,
      ``,
      `  test('should return 404 for deleted ${resource}', async ({ request }) => {`,
      `    const res = await request.get(\`${baseUrl}/${resource}/\${bookingId}\`)`,
      `    expect(res.status()).toBe(404)`,
      `  })`,
      `})`,
    )
  }

  private genHealthDescribe(
    endpoints: EndpointDefinition[],
    className: string,
    baseUrl:   string
  ): string {
    return lines(
      `test.describe('Health Check', () => {`,
      `  test('should return healthy status', async ({ request }) => {`,
      `    const res = await request.get(\`${baseUrl}/ping\`)`,
      `    expect(res.status()).toBe(201)`,
      `  })`,
      `})`,
    )
  }

  private generateSpec(flow: FlowDefinition): string {
    const hash    = this.model.app.crawlMetadata?.crawlConfigHash ?? ''
    const imports = this.buildImports(flow)
    const body    = this.generateFlowTests(flow)

    return lines(
      generatedHeader(this.model.app.modelVersion, hash),
      imports,
      ``,
      `test.describe('${flow.id}', () => {`,
      ``,
      indent(1, body),
      ``,
      `})`,
      ``
    )
  }

  private buildImports(flow: FlowDefinition): string {
    const pageIds = [...new Set(
      (flow.steps || []).map(s => s.pageId)
    )]
    const pageImports = pageIds.map(id => {
      const cls = toClassName(id)
      return `import { ${cls} } from '../pages/${cls}.generated'`
    }).join('\n')

    return lines(
      `import { test, expect } from '../fixtures.generated'`,
      pageImports,
    )
  }

  private resolveValueExpr(value: string, fieldHint?: 'username' | 'password'): string {
    const exact = value.match(/^\{\{(\w+)\}\}$/)
    if (exact) {
      const key = exact[1]
      if (key.endsWith('_USERNAME')) {
        const credKey = key.replace(/_USERNAME$/, '_CREDENTIALS')
        return `(process.env.${credKey}?.split(':')[0] ?? '')`
      }
      if (key.endsWith('_PASSWORD')) {
        const credKey = key.replace(/_PASSWORD$/, '_CREDENTIALS')
        return `(process.env.${credKey}?.split(':')[1] ?? '')`
      }
      if (key.endsWith('_CREDENTIALS') && fieldHint) {
        const idx = fieldHint === 'password' ? 1 : 0
        return `(process.env.${key}?.split(':')[${idx}] ?? '')`
      }
      return `(process.env.${key} ?? '')`
    }
    if (/\{\{\w+\}\}/.test(value)) {
      const interpolated = value.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
        return '${' + this.resolveValueExpr(`{{${key}}}`, fieldHint) + '}'
      })
      return '`' + interpolated + '`'
    }
    return JSON.stringify(value)
  }

  private fieldHintFor(el: ElementDefinition | undefined): 'username' | 'password' | undefined {
    if (!el) return undefined
    const name = el.name.toLowerCase()
    if (name.includes('password') || name.includes('pass')) return 'password'
    if (name.includes('username') || name.includes('user')) return 'username'
    return undefined
  }

  private bestSelector(el: ElementDefinition): string {
    const strategy = el.strategies && el.strategies[0]
    if (!strategy) return `[data-test="${el.name}"]`
    switch (strategy.type) {
      case 'data-test': return `[data-test="${strategy.value}"]`
      case 'id':         return `#${strategy.value}`
      case 'role': {
        this.assertValidRoleStrategy(strategy.value)
        // Playwright's `role=` selector-engine string — the string-selector
        // equivalent of getByRole(value, { name: accessibleName }). Callers
        // that need a Locator (emitStep/critical-element loop, below) bypass
        // this and call locatorExprFor() instead, which emits a literal
        // getByRole(...) call; this stays as a correct fallback for any
        // caller that genuinely needs a bare selector string.
        return strategy.accessibleName
          ? `role=${strategy.value}[name="${escapeRoleAccessibleName(strategy.accessibleName)}"]`
          : `role=${strategy.value}`
      }
      case 'text':       return `text=${strategy.value}`
      case 'css':        return strategy.value
      default:           return strategy.value
    }
  }

  // See TD-029 — fails loudly if a role strategy's value still carries the
  // pre-fix compound format instead of a bare ARIA role token with
  // accessibleName as its own field.
  private assertValidRoleStrategy(value: string): void {
    if (/[[\]'"]/.test(value)) {
      throw new Error(
        `[SpecGenerator] Role strategy value "${value}" is compound (contains '[', ']', or a quote) — expected a ` +
        `bare ARIA role token with accessibleName as a separate field (see TD-029). This indicates ` +
        `ElementClassifier.buildRoleSelector() regressed to the pre-fix compound-string format, or this model ` +
        `predates TD-029 — re-run the crawl step to refresh it.`
      )
    }
  }


  // Builds the full Playwright locator expression for a step/critical-element
  // target — a literal `${roleFixture}.getByRole(...)` call for a role-type
  // primary strategy (consistent with what SmartLocator does at runtime),
  // `${roleFixture}.locator(...)` otherwise. No consumer downstream of this
  // parses/guesses a string's internal format — see TD-029.
  private locatorExprFor(
    roleFixture: string,
    el:          ElementDefinition | undefined,
    fallbackId?: string | null
  ): string {
    const strategy = el?.strategies?.[0]
    if (strategy?.type === 'role') {
      this.assertValidRoleStrategy(strategy.value)
      const roleArg = JSON.stringify(strategy.value)
      return strategy.accessibleName
        ? `${roleFixture}.getByRole(${roleArg}, { name: ${JSON.stringify(strategy.accessibleName)} })`
        : `${roleFixture}.getByRole(${roleArg})`
    }
    const selector = el ? this.bestSelector(el) : (fallbackId?.split(':')[1] ?? fallbackId ?? '')
    return `${roleFixture}.locator(${JSON.stringify(selector)})`
  }

  private resolveElement(step: FlowStep): ElementDefinition | undefined {
    if (!step.elementId) return undefined
    const page = this.model.pages?.find(p => p.id === step.pageId)
    return page?.elements.find(
      e => e.id === step.elementId || `${step.pageId}:${e.name}` === step.elementId
    )
  }

  // TD-140: returns the step's rendered lines PLUS its structural classification
  // (executable statement vs omitted step). Rendered `.lines` are byte-identical to the
  // prior string returns — only the classification metadata is new.
  private emitStep(step: FlowStep, role: string, allSteps: FlowStep[] = []): EmittedStep {
    const el = this.resolveElement(step)
    const exec = (line: string): EmittedStep => ({ lines: [line], executable: true, omissionReason: null })

    switch (step.action) {
      case 'navigate':
        return exec(`await ${role}.goto('${step.value || '/'}')`)

      case 'fill':
        return exec(`await ${this.locatorExprFor(role, el, step.elementId)}.fill(${this.resolveValueExpr(step.value || '', this.fieldHintFor(el))})`)

      case 'click': {
        const clickCap = determineClickCapability(step, allSteps)
        if (clickCap === 'omit-prerequisite') {
          // 003: interaction observed at crawl, but the prerequisite chain to reach it is unverified.
          return { lines: [
            '// FORGE[omissionReason=prerequisite-unverified]: interaction observed',
            '// during crawl but prerequisite chain could not be verified;',
            '// reachability requires TD-013 capability. Click omitted.',
          ], executable: false, omissionReason: 'prerequisite-unverified' }
        }
        if (clickCap === 'omit-ungrounded') {
          // 002: interaction never grounded (inferred builder path, TD-081).
          return { lines: [
            '// FORGE[omissionReason=interaction-never-observed]: interaction not',
            '// observed during crawl (inferred builder path, TD-081). Click omitted.',
          ], executable: false, omissionReason: 'interaction-never-observed' }
        }
        return exec(`await ${this.locatorExprFor(role, el, step.elementId)}.click()`)
      }

      case 'select':
        return exec(`await ${this.locatorExprFor(role, el, step.elementId)}.selectOption(${this.resolveValueExpr(step.value || '')})`)

      case 'assert-navigation': {
        // TD-064 FC-002: assert a specific URL only for OBSERVED navigations.
        const thisInferred = step.grounding === 'inferred'
        // TD-082: use the shared priorBroken derivation (renamed local to avoid
        // shadowing the import). Precedence is unchanged — thisInferred first.
        const isChainBroken = priorBroken(step, allSteps)

        if (!thisInferred) {
          const targetPage = step.targetPageId
            ? this.model.pages?.find(p => p.id === step.targetPageId)
            : null
          const pattern = targetPage?.urlPattern || step.value || '/'
          const escaped = pattern.replace(/\//g, '\\/').replace(/\./g, '\\.')
          return exec(`await expect(${role}).toHaveURL(/${escaped}/)`)
        }
        if (isChainBroken) {
          // navigation + prerequisite reachability both unverified → omit the assertion
          return { lines: ['// FORGE: navigation and prerequisite reachability unverified; URL assertion omitted.'],
            executable: false, omissionReason: 'navigation-prerequisite-unverified' }
        }
        // navigation unobserved but prerequisites intact → downgrade to non-error landing
        // (this is an EXECUTABLE assertion with an explanatory comment, NOT an omission).
        return { lines: [
          '// FORGE: navigation not observed during crawl (no real edge); asserting non-error landing, not a specific URL.',
          `await expect(${role}).not.toHaveURL(/404|error/i)`,
        ], executable: true, omissionReason: null }
      }

      case 'assert-element-visible': {
        const locExpr    = this.locatorExprFor(role, el, step.elementId)
        const hidden     = el?.observedState === 'attached'
        // TD-082: no batch step-capability here — pass 'full' so useAttached = hidden only.
        const { useAttached, useFirst } = determineElementForm(el ?? {}, 'full')
        const presence   = useFirst ? `${locExpr}.first()` : locExpr
        // TD-064 FC-001 (multiplicity) + FC-003 (state ladder): repeated → presence via
        // .first() plus not.toHaveCount(0); hidden-at-crawl → assert attached, not visible.
        const out: string[] = []
        if (hidden) out.push('// FORGE: element observed hidden during crawl; visibility unprovable — asserting attached, not visible.')
        out.push(`await expect(${presence}).${useAttached ? 'toBeAttached' : 'toBeVisible'}()`)
        if (useFirst) out.push(`await expect(${locExpr}).not.toHaveCount(0)`)
        return { lines: out, executable: true, omissionReason: null }
      }

      default:
        return { lines: [], executable: false, omissionReason: null }
    }
  }

  // TD-140: emit a test from its classified steps. When ZERO executable statements remain
  // (every requested step was honestly omitted per FC-004a/TD-081), FORGE does NOT emit a
  // vacuous green — it emits an explicit evidence-based refusal: `test.skip` (not a bare
  // pass, not a forced failure) carrying a forge:could-not-verify annotation so the RUN
  // aggregate degrades honestly (ADR-018 §3 — the reporter/ingestion re-grade the annotated
  // skip to could-not-verify → run 'unknown'). A test with ≥1 executable statement is a real
  // test, however many omissions it also carries, and is emitted unchanged (byte-identical).
  private renderTest(
    testId: string, flowId: string, kind: GeneratedTestTally['kind'],
    role: string, title: string, steps: EmittedStep[],
  ): string {
    const executableCount = steps.filter(s => s.executable).length
    const omissionReasons = steps.filter(s => s.omissionReason).map(s => s.omissionReason!)
    this.tally.push({ testId, flowId, kind, executableCount, omissionCount: omissionReasons.length, omissionReasons })

    if (executableCount === 0) {
      const summary = summarizeOmissions(omissionReasons)
      console.log(`[SpecGenerator] FORGE-refusal (TD-140): ${testId} '${title}' emitted as skip — zero executable statements (${summary}).`)
      // No role fixture: a test that asserts nothing needs no authenticated session, and
      // dropping it keeps the skip robust (a failing auth fixture cannot turn the refusal
      // into an error). The annotation survives on the skipped result (verified, PW 1.58).
      return lines(
        `test('${testId} ${title}', async () => {`,
        `  test.info().annotations.push({ type: '${FORGE_COULD_NOT_VERIFY}', description: 'vacuous-refusal: ${summary}' })`,
        `  test.skip(true, 'FORGE did not execute this test because every requested step lacked sufficient grounded evidence. Omitted: ${summary}.')`,
        `})`,
      )
    }

    return lines(
      `test('${testId} ${title}', async ({ ${role} }) => {`,
      indent(1, steps.flatMap(s => s.lines).join('\n')),
      `})`,
    )
  }

  private generateFlowTests(flow: FlowDefinition): string {
    const role    = flow.roleId
    const roleDef = this.model.roles?.find(r => r.id === role)
    const steps   = flow.steps || []

    if (steps.length === 0) {
      const id = nextTestId()
      // A smoke test carries one real assertion (non-error landing) — never vacuous.
      this.tally.push({ testId: id, flowId: flow.id, kind: 'smoke', executableCount: 1, omissionCount: 0, omissionReasons: [] })
      return lines(
        `test('${id} ${flow.displayName} smoke test', async ({ ${role} }) => {`,
        `  await expect(${role}).not.toHaveURL(/error|404/)`,
        `})`,
      )
    }

    const tests: string[] = []

    const mainId    = nextTestId()
    const mainSteps = steps.map(s => this.emitStep(s, role, steps))
    tests.push(this.renderTest(mainId, flow.id, 'full-flow', role, `${flow.displayName} full flow`, mainSteps))

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (step.action !== 'assert-navigation' || !step.targetPageId) continue

      const targetPage = this.model.pages?.find(p => p.id === step.targetPageId)
      if (!targetPage) continue

      // TD-034 — a flow's own step list (state-graph walk) can include the
      // pre-auth entry page, which the role's fixture has already passed
      // through before the test body runs. reachablePageIds is populated
      // from the role's own crawl session (Crawler.ts), so it already
      // reflects which pages that role's session actually lands on.
      if (roleDef && !roleDef.reachablePageIds.includes(targetPage.id)) continue

      const criticalEls = targetPage.elements
        .filter(e => e.critical && !BASE_PAGE_PROPERTIES.has(e.name))
      if (criticalEls.length === 0) continue

      const replaySteps = steps.slice(0, i + 1)
      const prereqSteps = replaySteps.map(s => this.emitStep(s, role, steps))

      // TD-064 FC-004a: per-batch capability gate — computed once from the nav step this
      // batch depends on (step = steps[i]). Orthogonal to the per-element FC-001/FC-003
      // branching below; caps assertion strength to the confidence of arrival at the page.
      const capability = determineStepCapability(step, steps)

      // TD-049 — was a flat .slice(0, 3): with TD-032's broader critical-flag
      // rules, a single page can have dozens of critical elements, and a
      // bare truncation silently dropped ~90% of them app-wide (confirmed
      // live on both reference apps) with no signal that anything was
      // dropped. Batching into fixed-size groups, each its own test case,
      // gives every critical element real coverage instead of an arbitrary
      // ordering-dependent subset, while keeping any one test's blast radius
      // bounded — one bad element fails its own batch, not the whole page's
      // worth of checks.
      const BATCH_SIZE = 10
      const batches: ElementDefinition[][] = []
      for (let b = 0; b < criticalEls.length; b += BATCH_SIZE) {
        batches.push(criticalEls.slice(b, b + BATCH_SIZE))
      }

      batches.forEach((batch, batchIndex) => {
        const elementSteps: EmittedStep[] = []
        if (capability === 'omit') {
          // FC-004a: a prior step is inferred, so arrival at this page is NOT proven.
          // Element presence is unprovable — omit the element assertions rather than
          // overclaim (toBeAttached would be an equal overclaim). prereqSteps still
          // exercise the flow up to the unverified boundary.
          elementSteps.push({ lines: ['// FORGE: navigation/reachability unverified — element assertions omitted (FC-004a).'],
            executable: false, omissionReason: 'reachability-unverified' })
        } else {
          const downgraded = capability === 'downgraded'
          for (const critEl of batch) {
            const locExpr    = this.locatorExprFor(role, critEl)
            const hidden     = critEl.observedState === 'attached'
            // TD-082: FC-001 multiplicity + FC-003 hidden + FC-004a step-downgrade merge.
            const { useAttached, useFirst } = determineElementForm(critEl, capability)
            const presence   = useFirst ? `${locExpr}.first()` : locExpr
            // TD-064 FC-001 (multiplicity) + FC-003 (state ladder): repeated → presence via
            // .first() plus not.toHaveCount(0); hidden-at-crawl → assert attached, not visible.
            // FC-004a 'downgraded' (single inferred hop) also forces attached over visible;
            // if FC-003 already made it attached, the downgrade is a no-op on the form — emit
            // one annotation only (FC-003's), never a duplicate.
            const elLines: string[] = []
            if (hidden) elLines.push('// FORGE: element observed hidden during crawl; visibility unprovable — asserting attached, not visible.')
            else if (downgraded) elLines.push('// FORGE: arrival at this page inferred (single uncertain hop) — asserting attached, not visible (FC-004a).')
            elLines.push(`await expect(${presence}).${useAttached ? 'toBeAttached' : 'toBeVisible'}()`)
            if (useFirst) elLines.push(`await expect(${locExpr}).not.toHaveCount(0)`)
            // A critical-element assertion is executable (the explanatory comment above is
            // an annotation on it, not an omission).
            elementSteps.push({ lines: elLines, executable: true, omissionReason: null })
          }
        }
        const batchSuffix = batches.length > 1 ? ` (batch ${batchIndex + 1} of ${batches.length})` : ''
        const critId = nextTestId()
        tests.push(this.renderTest(
          critId, flow.id, 'critical', role,
          `critical elements visible on ${targetPage.id}${batchSuffix}`,
          [...prereqSteps, ...elementSteps],
        ))
      })
    }

    return tests.join('\n\n')
  }
}
