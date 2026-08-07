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
  AppModel, RoleDefinition, PageDefinition,
  ElementDefinition, EndpointDefinition, OnboardingConfig
} from '../types'
import {
  lines, indent, generatedHeader,
  toClassName, strategyToSelector, writeFile, roleAuthFailedAtCrawl
} from './EmitHelper'

export class FixtureGenerator {

  constructor(private model: AppModel, private config?: OnboardingConfig) {}

  generate(outputDir: string): void {
    const appType = this.model.app.appType
    if (appType === 'rest-api' || appType === 'graphql-api') {
      this.generateApiFixtures(outputDir)
      return
    }
    // ── UI branch — existing role-based fixture generation ───────────────────
    const content  = this.generateFixtures()
    const filePath = path.join(outputDir, 'fixtures.generated.ts')
    writeFile(filePath, content)
    // TD-064 FC-004b: report the EMITTED (post-omission) fixture count, not model.roles.length.
    const omittedCount = this.model.roles.filter(r => roleAuthFailedAtCrawl(r)).length
    const emittedCount = this.model.roles.length - omittedCount
    console.log(
      `[FixtureGenerator] Generated fixtures for ${emittedCount} roles` +
      (omittedCount ? ` (${omittedCount} omitted: auth failed at crawl)` : '')
    )
  }

  private generateApiFixtures(outputDir: string): void {
    const endpoints = this.model.endpoints || []
    const ver       = this.model.app.modelVersion
    const hash      = this.model.app.crawlMetadata?.crawlConfigHash ?? ''
    const lines_buf: string[] = []

    lines_buf.push(
      `// @generated from SQLite App Model v${ver} ${hash}`,
      `// DO NOT EDIT — regenerate with: npm run onboard:generate`,
      ``,
      `import * as dotenv from 'dotenv'`,
      `dotenv.config()`,
      ``,
    )

    // Determine which interfaces to import from ApiClient
    const importedTypes: string[] = []
    const needsNewBooking = endpoints.some(
      e => e.summary === 'CreateBooking' && !e.auth && ['POST', 'PUT', 'PATCH'].includes(e.method)
    )
    const needsToken = endpoints.some(e => e.summary === 'CreateToken' && !e.auth)

    if (needsNewBooking) importedTypes.push('CreateBookingRequest')
    if (needsToken)      importedTypes.push('CreateTokenRequest')

    if (importedTypes.length > 0) {
      lines_buf.push(`import type { ${importedTypes.join(', ')} } from './ApiClient'`, ``)
    }

    // Generate fixture for CreateBooking
    if (needsNewBooking) {
      lines_buf.push(
        `export const newBooking: CreateBookingRequest = {`,
        `  firstname:       'John',`,
        `  lastname:        'Doe',`,
        `  totalprice:      100,`,
        `  depositpaid:     true,`,
        `  bookingdates:    { checkin: '2026-01-01', checkout: '2026-01-10' },`,
        `  additionalneeds: 'None',`,
        `}`,
        ``,
      )
    }

    // Generate fixture for CreateToken
    if (needsToken) {
      lines_buf.push(
        `export const adminCredentials: CreateTokenRequest = {`,
        `  username: process.env.BOOKER_CREDENTIALS?.split(':')[0] ?? '',`,
        `  password: process.env.BOOKER_CREDENTIALS?.split(':')[1] ?? '',`,
        `}`,
        ``,
      )
    }

    const content  = lines_buf.join('\n')
    const filePath = path.join(outputDir, 'fixtures.generated.ts')
    writeFile(filePath, content)
    console.log(`[FixtureGenerator] Generated API fixtures at ${filePath}`)
  }

  private generateFixtures(): string {
    const appName   = this.model.app.name
    const typeName  = toClassName(appName).replace('Page', '') + 'Fixtures'
    const roles     = this.model.roles
    const pages     = this.model.pages || []
    const loginPage = pages.find(p => p.isAuthPage)
    const hash      = this.model.app.crawlMetadata?.crawlConfigHash ?? ''

    // TD-064 FC-004b: omit roles whose auth FAILED at crawl (no authenticated behavior
    // observed). Both the fixture BODY and the fixture TYPE field are built from `emitted`,
    // so they are suppressed together — no dangling "unknown fixture" reference remains.
    const emitted = roles.filter(r => !roleAuthFailedAtCrawl(r))
    const omitted = roles.filter(r =>  roleAuthFailedAtCrawl(r))
    for (const r of omitted) {
      console.log(`[FixtureGenerator] FORGE[omissionReason=role-authentication-failed]: ${r.id} omitted — authentication failed at crawl.`)
    }
    const omissionNotes = omitted.map(r =>
      `// FORGE[omissionReason=role-authentication-failed]: ${r.id} omitted —\n` +
      `// authentication failed at crawl; no authenticated behavior observed.`
    ).join('\n')

    const typeFields = emitted.map(r => `  ${r.id}: Page`).join('\n')

    const fixtures = emitted.map(r =>
      this.generateRoleFixture(r, loginPage)
    ).join('\n\n')

    return lines(
      generatedHeader(this.model.app.modelVersion, hash),
      `import { test as base, Page } from '@playwright/test'`,
      `import * as dotenv from 'dotenv'`,
      `dotenv.config()`,
      ``,
      ...(omissionNotes ? [omissionNotes, ``] : []),
      `function resolveCredentials(envKey: string): { username: string; password: string } {`,
      `  const raw = process.env[envKey]`,
      `  if (!raw) throw new Error(\`Missing env var: \${envKey}\`)`,
      `  const [username, password] = raw.split(':')`,
      `  if (!username || !password) {`,
      `    throw new Error(\`Invalid format for \${envKey} — expected username:password\`)`,
      `  }`,
      `  return { username, password }`,
      `}`,
      ``,
      `type ${typeName} = {`,
      typeFields,
      `}`,
      ``,
      `export const test = base.extend<${typeName}>({`,
      ``,
      indent(1, fixtures),
      `})`,
      ``,
      `export { forgeExpect as expect } from '../../../../../core/healing/forgeExpect'`,
      ``
    )
  }

  private generateRoleFixture(
    role: RoleDefinition,
    loginPage: PageDefinition | undefined
  ): string {
    const isGuest  = role.authFlow === 'none'

    if (isGuest) {
      return lines(
        `${role.id}: async ({ page }, use) => {`,
        `  await page.goto(${JSON.stringify(this.model.app.baseUrl)})`,
        `  await use(page)`,
        `},`,
      )
    }

    const loginEl    = loginPage?.elements.find(
      e => e.kind === 'input' && e.name.toLowerCase().includes('username')
    )
    const passwordEl = loginPage?.elements.find(
      e => e.kind === 'input' && e.name.toLowerCase().includes('password')
    )
    const submitEl   = loginPage?.elements.find(e => e.kind === 'button')

    const configRole  = (this.config?.roles ?? []).find((r: any) => r.id === role.id)

    const userSel   = this.elementToSelector(loginEl,   'input[name="username"], input[placeholder*=user i], input[type=text]')
    const passSel   = this.elementToSelector(passwordEl, 'input[name="password"], input[placeholder*=pass i], input[type=password]')
    // TD-084: honor the config's submit selector when defined (AuthManager already does
    // for the crawl); else fall back to the model-derived selector. Fixes OrangeHRM, whose
    // first model button is classified "Cancel" and matches 0 live elements.
    const submitSel = (configRole as any)?.selectors?.submit
      ?? this.elementToSelector(submitEl, 'button[type=submit], input[type=submit], button:has-text("Login")')
    const loginUrl    = (configRole as any)?.loginUrl ?? this.model.app.baseUrl
    // successUrl resolution order (successUrl-collision fix):
    //   1. config successUrl — explicit, user-supplied; always wins (fixture flows)
    //   2. role.observedPostAuthUrl — the landing URL the crawl DIRECTLY OBSERVED
    //      after a successful login (standalone workspaces: AppConfig v1 cannot
    //      carry successUrl). Evidence, not a guess — the guard below forbids
    //      guessing, and an observation is not a guess.
    //   3. throw — no config value AND no observation: the honesty guard stays.
    const successUrl  = (configRole as any)?.successUrl ?? role.observedPostAuthUrl
    if (!successUrl) {
      throw new Error(
        `[FixtureGenerator] Role "${role.id}" in app "${this.model.app.name}" has no ` +
        `successUrl configured in onboarding.${this.model.app.name}.config.ts and no ` +
        `observedPostAuthUrl in the model (auth never succeeded during crawl). ` +
        `Refusing to guess a post-login URL pattern — every app's success route is ` +
        `different (this previously defaulted to '**/dashboard**', which is only ` +
        `correct for OrangeHRM-shaped apps). Add a successUrl for this role (or ` +
        `re-crawl with working credentials) and regenerate.`
      )
    }
    const waitPattern = `**${new URL(successUrl, this.model.app.baseUrl).pathname}**`

    return lines(
      `${role.id}: async ({ page }, use) => {`,
      `  const creds = resolveCredentials(${JSON.stringify(role.credentialsEnvKey || '')})`,
      `  await page.goto(${JSON.stringify(loginUrl)})`,
      `  await page.fill(${JSON.stringify(userSel)}, creds.username)`,
      `  await page.fill(${JSON.stringify(passSel)}, creds.password)`,
      `  await page.click(${JSON.stringify(submitSel)})`,
      `  await page.waitForURL('${waitPattern}', { timeout: 15000 })`,
      `  await page.waitForTimeout(1500)`,
      `  await use(page)`,
      `},`,
    )
  }

  private elementToSelector(
    el:       ElementDefinition | undefined,
    fallback: string
  ): string {
    if (!el) return fallback
    const best = el.strategies[0]
    if (!best) return fallback
    return strategyToSelector(best.type, best.value, best.accessibleName)
  }
}
