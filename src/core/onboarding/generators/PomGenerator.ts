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

import * as path from 'path'
import {
  AppModel, PageDefinition, ElementDefinition, EndpointDefinition
} from '../types'
import {
  lines, indent, generatedHeader,
  toClassName, strategyToSelector, writeFile,
  BASE_PAGE_PROPERTIES,
} from './EmitHelper'

export class PomGenerator {

  constructor(private model: AppModel) {}

  generate(outputDir: string): void {
    const appType = this.model.app.appType
    if (appType === 'rest-api' || appType === 'graphql-api') {
      this.generateApiClient(outputDir)
      return
    }
    // ── UI branch — existing POM generation ─────────────────────────────────
    const pages = this.model.pages || []
    for (const page of pages) {
      const content  = this.generatePage(page)
      const fileName = `${toClassName(page.id)}.generated.ts`
      const filePath = path.join(outputDir, 'pages', fileName)
      writeFile(filePath, content)
    }
    console.log(`[PomGenerator] Generated ${pages.length} page objects`)
  }

  private generateApiClient(outputDir: string): void {
    const endpoints = this.model.endpoints || []
    const appName   = this.model.app.name
    const baseUrl   = this.model.app.baseUrl
    const className = toClassName(appName).replace(/Page$/, 'ApiClient')
    const hash      = this.model.app.crawlMetadata?.crawlConfigHash ?? ''
    const ver       = this.model.app.modelVersion

    const ifaces:  string[] = []
    const methods: string[] = []
    const seen     = new Set<string>()

    for (const ep of endpoints) {
      const methodName = this.summaryToMethodName(ep.summary)
      if (seen.has(methodName)) continue
      seen.add(methodName)

      const pathParams = (ep.path.match(/\{([^}]+)\}/g) || []).map((p: string) => p.slice(1, -1))
      const hasBody    = ['POST', 'PUT', 'PATCH'].includes(ep.method)
      const reqIface   = hasBody ? `${ep.summary}Request`  : null
      const resIface   = ep.summary === 'CreateToken'      ? 'CreateTokenResponse'  :
                         ep.summary === 'CreateBooking'    ? 'CreateBookingResponse' : null

      if (reqIface && !ifaces.some(i => i.includes(`interface ${reqIface}`))) {
        ifaces.push(this.buildRequestInterface(ep, reqIface))
      }
      if (resIface && !ifaces.some(i => i.includes(`interface ${resIface}`))) {
        ifaces.push(this.buildResponseInterface(ep, resIface))
      }
      methods.push(this.buildMethod(ep, methodName, pathParams, reqIface, resIface))
    }

    const content = [
      `// @generated from SQLite App Model v${ver} ${hash}`,
      `// DO NOT EDIT — regenerate with: npm run onboard:generate`,
      ``,
      `import { APIRequestContext } from '@playwright/test'`,
      ``,
      ifaces.join('\n\n'),
      ``,
      `export class ${className} {`,
      ``,
      `  private token: string = ''`,
      ``,
      `  constructor(`,
      `    private baseUrl: string,`,
      `    private request: APIRequestContext`,
      `  ) {}`,
      ``,
      methods.map(m => m.split('\n').map(l => `  ${l}`).join('\n')).join('\n\n'),
      `}`,
      ``,
    ].join('\n')

    writeFile(path.join(outputDir, 'ApiClient.ts'), content)
    console.log(`[PomGenerator] Generated ApiClient.ts with ${methods.length} methods`)
  }

  private summaryToMethodName(summary: string): string {
    return summary.charAt(0).toLowerCase() + summary.slice(1)
  }

  private buildRequestInterface(ep: EndpointDefinition, name: string): string {
    let fields: string
    if (ep.requestBody?.schema?.properties) {
      fields = Object.entries(ep.requestBody.schema.properties)
        .map(([k, v]: [string, any]) => `  ${k}: ${(v as any).type || 'any'}`)
        .join('\n')
    } else if (ep.summary === 'CreateToken' || ep.summary === 'CreateTokenRequest') {
      fields = '  username: string\n  password: string'
    } else if (ep.summary === 'CreateBooking' || ep.summary === 'UpdateBooking') {
      fields = [
        '  firstname:       string',
        '  lastname:        string',
        '  totalprice:      number',
        '  depositpaid:     boolean',
        '  bookingdates:    { checkin: string; checkout: string }',
        '  additionalneeds: string',
      ].join('\n')
    } else if (ep.summary === 'PartialUpdateBooking') {
      fields = '  firstname?: string\n  lastname?: string\n  totalprice?: number'
    } else {
      fields = ''
    }
    return `export interface ${name} {\n${fields}\n}`
  }

  private buildResponseInterface(ep: EndpointDefinition, name: string): string {
    let fields: string
    if (name === 'CreateTokenResponse') {
      fields = '  token: string'
    } else if (name === 'CreateBookingResponse') {
      fields = '  bookingid: number\n  booking:   CreateBookingRequest'
    } else {
      fields = ''
    }
    return `export interface ${name} {\n${fields}\n}`
  }

  private buildMethod(
    ep:         EndpointDefinition,
    methodName: string,
    pathParams: string[],
    reqIface:   string | null,
    resIface:   string | null,
  ): string {
    const authHeader  = ep.auth ? `Cookie: \`token=\${this.token}\`` : null
    const urlExpr     = pathParams.length > 0
      ? `\`\${this.baseUrl}${ep.path.replace(/\{([^}]+)\}/g, (_: string, p: string) => `\${${p}}`)}\``
      : `\`\${this.baseUrl}${ep.path}\``

    const paramList = [
      ...pathParams.map((p: string) => `${p}: string`),
      reqIface ? `body: ${reqIface}` : null,
    ].filter(Boolean).join(', ')

    // A request/response body is only absent for DELETE; every other method
    // returns res.json() (see body emission below), so the return type must
    // reflect that — falling back to Promise<void> here previously caused
    // updateBooking/partialUpdateBooking to silently drop their response.
    // createToken must be checked before resIface: its body unwraps and
    // returns data.token (a string), not the raw CreateTokenResponse object
    // that resIface points to — resIface is still used to generate the
    // CreateTokenResponse interface itself, just not as this method's return type.
    const returnType = methodName === 'createToken' ? `Promise<string>` :
                       resIface                      ? `Promise<${resIface}>` :
                       ep.method === 'DELETE'        ? `Promise<void>` :
                       reqIface                       ? `Promise<${reqIface}>` :
                       `Promise<any>`

    const bodyLines: string[] = []

    if (ep.method === 'DELETE') {
      bodyLines.push(`await this.request.delete(${urlExpr}, {`)
      if (authHeader) bodyLines.push(`  headers: { ${authHeader} },`)
      bodyLines.push(`})`)
    } else if (ep.method === 'GET') {
      bodyLines.push(`const res = await this.request.get(${urlExpr})`)
      bodyLines.push(`return res.json()`)
    } else {
      bodyLines.push(`const res = await this.request.${ep.method.toLowerCase()}(${urlExpr}, {`)
      if (authHeader) bodyLines.push(`  headers: { ${authHeader} },`)
      if (reqIface)   bodyLines.push(`  data: body,`)
      bodyLines.push(`})`)
      if (methodName === 'createToken') {
        bodyLines.push(`const data = await res.json()`)
        bodyLines.push(`this.token = data.token`)
        bodyLines.push(`return data.token`)
      } else {
        bodyLines.push(`return res.json()`)
      }
    }

    const body = bodyLines.map(l => `  ${l}`).join('\n')
    return `async ${methodName}(${paramList}): ${returnType} {\n${body}\n}`
  }

  private generatePage(page: PageDefinition): string {
    const className   = toClassName(page.id)
    // Filter out elements that would shadow BasePage's own concrete properties
    const critical    = page.elements.filter(e => e.critical    && !BASE_PAGE_PROPERTIES.has(e.name))
    const nonCritical = page.elements.filter(e => !e.critical   && !BASE_PAGE_PROPERTIES.has(e.name))
    const hash        = this.model.app.crawlMetadata?.crawlConfigHash ?? ''

    this.assertUniqueNames(page, [...critical, ...nonCritical])

    const criticalProps    = critical.map(e => this.generateSmartProp(e)).join('\n\n')
    const nonCriticalProps = nonCritical.map(e => this.generatePlainProp(e)).join('\n\n')
    const actions          = this.generateActions(page, critical)

    const depth = '../../'
    const imports = lines(
      `import { Page, Locator } from '@playwright/test'`,
      `import { BasePage } from '${depth}pages/BasePage'`,
    )

    const criticalSection = critical.length > 0
      ? lines(
          `  // ── Critical elements — SmartLocator wired ` + `─`.repeat(40),
          indent(1, criticalProps),
        )
      : ''

    const nonCriticalSection = nonCritical.length > 0
      ? lines(
          ``,
          `  // ── Non-critical elements — plain locators ` + `─`.repeat(40),
          indent(1, nonCriticalProps),
        )
      : ''

    const actionSection = actions
      ? lines(``, `  // ── Actions ` + `─`.repeat(60), indent(1, actions))
      : ''

    // Escape urlPattern for use in isLoaded — avoid false positives for '/'
    const urlCheck = page.urlPattern && page.urlPattern !== '/'
      ? `this.page.url().includes(${JSON.stringify(page.urlPattern)})`
      : `this.page.url().length > 0`

    return lines(
      generatedHeader(this.model.app.modelVersion, hash),
      imports,
      ``,
      `export class ${className} extends BasePage {`,
      ``,
      `  constructor(page: Page) {`,
      `    super(page)`,
      `  }`,
      ``,
      `  // ── Abstract contract ` + `─`.repeat(52),
      `  readonly pageUrl = ${JSON.stringify(page.urlPattern)}`,
      `  async isLoaded(): Promise<boolean> { return ${urlCheck} }`,
      ``,
      `  // ── Navigation ` + `─`.repeat(60),
      `  async navigateTo(): Promise<void> {`,
      `    await this.page.goto(${JSON.stringify(page.urlPattern)})`,
      `  }`,
      ``,
      criticalSection,
      nonCriticalSection,
      actionSection,
      `}`,
      ``
    )
  }

  /**
   * Guards against emitting duplicate TypeScript property declarations —
   * see TD-018. The classifier guarantees unique names per page, so this
   * should never fire; if it does, fail generation loudly rather than
   * writing invalid TypeScript silently (standing rule: no silent failures).
   */
  private assertUniqueNames(page: PageDefinition, elements: ElementDefinition[]): void {
    const seen  = new Set<string>()
    const dupes = new Set<string>()
    for (const el of elements) {
      if (seen.has(el.name)) dupes.add(el.name)
      seen.add(el.name)
    }
    if (dupes.size > 0) {
      throw new Error(
        `[PomGenerator] Refusing to generate "${page.id}" — duplicate element name(s) ` +
        `[${[...dupes].join(', ')}] would produce invalid TypeScript. ` +
        `This indicates ElementClassifier.deduplicateNames() failed to guarantee uniqueness (see TD-018).`
      )
    }
  }

  private generateSmartProp(el: ElementDefinition): string {
    const strategies = el.strategies.map(s => {
      // Role strategies carry a bare ARIA role token + a separate
      // accessibleName field — SmartLocator.buildLocator() branches on
      // `name === 'role'` and calls getByRole(selector, { name: accessibleName })
      // directly, so `selector` must stay the bare token here, not a
      // collapsed selector string (see TD-029).
      if (s.type === 'role') {
        const accessibleNamePart = s.accessibleName
          ? `, accessibleName: ${JSON.stringify(s.accessibleName)}`
          : ''
        return `    { name: 'role', selector: ${JSON.stringify(s.value)}${accessibleNamePart} },`
      }
      const sel = strategyToSelector(s.type, s.value)
      return `    { name: '${s.type}', selector: ${JSON.stringify(sel)} },`
    }).join('\n')

    return lines(
      `readonly ${el.name} = this.smart({`,
      `  key: '${el.id}',`,
      `  description: ${JSON.stringify(el.label)},`,
      `  strategies: [`,
      strategies,
      `  ],`,
      `})`,
    )
  }

  private generatePlainProp(el: ElementDefinition): string {
    const best = el.strategies[0]
    const selector = best
      ? strategyToSelector(best.type, best.value, best.accessibleName)
      : `[data-test="${el.name}"]`
    return `readonly ${el.name}: Locator = this.page.locator(${JSON.stringify(selector)})`
  }

  private generateActions(
    page: PageDefinition,
    critical: ElementDefinition[]
  ): string {
    const actions: string[] = []

    const inputs  = critical.filter(e => e.kind === 'input')
    const buttons = critical.filter(e => e.kind === 'button')

    if (inputs.length > 0 && buttons.length > 0) {
      const params = inputs.map(e => `${e.name}: string`).join(', ')
      // TD-065: thread AssertionContext into resolve() so click/fill heals get
      // real correctness verification (fill records unverified — no trial-run, no
      // side effect; click dry-run-verifies via trial:true).
      const fills  = inputs.map(e =>
        `await (await this.${e.name}.resolve({ assertionType: 'fill', expectedValue: ${e.name} })).fill(${e.name})`
      ).join('\n')
      const click  = `await (await this.${buttons[0].name}.resolve({ assertionType: 'click' })).click()`
      const fnName = page.isAuthPage ? 'login' : 'submit'

      actions.push(lines(
        `async ${fnName}(${params}): Promise<void> {`,
        indent(1, fills),
        indent(1, click),
        `}`,
      ))
    }

    return actions.join('\n\n')
  }
}
