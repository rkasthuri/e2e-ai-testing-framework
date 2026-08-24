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

import * as fs from 'fs'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { FORM_LOGIN_SELECTORS } from '../onboarding/AuthManager'
import { SUPPORTED_AUTH_MECHANISMS } from './DefinitionCompatibilityEvaluator'
import type { CanonicalExecutablePlan } from './ExecutablePlanContract'
import type { AuthenticationCredentialReference } from '../test-design/TestDefinitionContract'
import { validateCanonicalExecutablePlan } from './ExecutablePlanContract'
import type { ExecutionCancellationToken } from './ExecutionCancellationToken'
import {
  type CredentialExecutionScope,
  type CredentialMaterial,
} from '../security/CredentialExecutionScope'

export interface PlaywrightRunnerReadiness {
  available: boolean
  safeCode: 'ready' | 'runner_unavailable'
  safeMessage: string
}

/** Module + installed-browser evidence only; it does not launch a browser. */
export function readPlaywrightRunnerReadiness(): PlaywrightRunnerReadiness {
  try {
    const executable = chromium.executablePath()
    return executable && fs.existsSync(executable)
      ? { available: true, safeCode: 'ready', safeMessage: 'The governed Playwright adapter and Chromium executable are available.' }
      : { available: false, safeCode: 'runner_unavailable', safeMessage: 'The governed Playwright adapter is present but its Chromium executable is unavailable.' }
  } catch {
    return { available: false, safeCode: 'runner_unavailable', safeMessage: 'The governed Playwright adapter could not establish runner availability.' }
  }
}

export interface PlaywrightExecutionRuntime {
  baseUrl: string
  loginUrl?: string
  navigationTimeoutMs?: number
  /** Runtime-only binding. It is excluded from Definition and plan semantic identity. */
  credentialReference?: AuthenticationCredentialReference
}

export type PlaywrightPlanExecutionResult =
  | { status: 'completed'; reasonCode: 'completed'; finalUrl: string }
  | { status: 'authentication_failed'; reasonCode: 'credential_missing' | 'authentication_failed' }
  | { status: 'navigation_failed'; reasonCode: 'navigation_failed' }
  | { status: 'action_failed'; reasonCode: 'action_failed' }
  | { status: 'oracle_failed'; reasonCode: 'oracle_failed'; finalUrl: string }
  | { status: 'unsupported_plan'; reasonCode: 'unsupported_action' | 'unsupported_oracle' | 'unsupported_auth_mechanism' | 'invalid_plan' }
  | { status: 'executor_failure'; reasonCode: 'executor_failure' }
  | { status: 'cancelled'; reasonCode: 'cancellation_requested' }

interface ExecutionSession {
  authenticateFormLogin(loginUrl: string, credentials: CredentialMaterial, timeoutMs: number): Promise<boolean>
  navigate(url: string, timeoutMs: number): Promise<void>
  clickDataTest?(value: string, timeoutMs: number): Promise<void>
  currentUrl(): string
  close(): Promise<void>
}

export type ExecutionSessionFactory = () => Promise<ExecutionSession>

class PlaywrightExecutionSession implements ExecutionSession {
  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  static async create(): Promise<PlaywrightExecutionSession> {
    const browser = await chromium.launch({ headless: true })
    try {
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        return new PlaywrightExecutionSession(browser, context, page)
      } catch (error) {
        await context.close().catch(() => undefined)
        throw error
      }
    } catch (error) {
      await browser.close().catch(() => undefined)
      throw error
    }
  }

  async authenticateFormLogin(loginUrl: string, credentials: CredentialMaterial, timeoutMs: number): Promise<boolean> {
    await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    const username = this.page.locator(FORM_LOGIN_SELECTORS.username).first()
    const password = this.page.locator(FORM_LOGIN_SELECTORS.password).first()
    const submit = this.page.locator(FORM_LOGIN_SELECTORS.submit).first()
    await username.waitFor({ state: 'visible', timeout: timeoutMs })
    await password.waitFor({ state: 'visible', timeout: timeoutMs })
    await submit.waitFor({ state: 'visible', timeout: timeoutMs })
    await username.fill(credentials.username)
    await password.fill(credentials.password)
    const before = this.page.url()
    await submit.click()
    try {
      await this.page.waitForURL(url => url.href !== before, { timeout: timeoutMs })
    } catch {
      // URL movement is checked below; a retained login URL is an auth failure.
    }
    await this.page.waitForLoadState('domcontentloaded')
    return this.page.url() !== before
  }

  async navigate(url: string, timeoutMs: number): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  }

  async clickDataTest(value: string, timeoutMs: number): Promise<void> {
    const target = this.page.locator(`[data-test="${value}"]`)
    await target.waitFor({ state: 'visible', timeout: timeoutMs })
    await target.click({ timeout: timeoutMs })
  }

  currentUrl(): string { return this.page.url() }

  async close(): Promise<void> {
    await this.page.close().catch(() => undefined)
    await this.context.close().catch(() => undefined)
    await this.browser.close().catch(() => undefined)
  }
}

function urlMatchesRoute(actual: string, expected: string): boolean {
  try {
    const actualUrl = new URL(actual)
    const expectedUrl = new URL(expected)
    return actualUrl.origin === expectedUrl.origin && actualUrl.pathname === expectedUrl.pathname
  } catch {
    return false
  }
}

export class PlaywrightPlanExecutor {
  constructor(
    private readonly credentials: CredentialExecutionScope,
    private readonly createSession: ExecutionSessionFactory = () => PlaywrightExecutionSession.create(),
  ) {}

  async execute(
    plan: CanonicalExecutablePlan,
    runtime: PlaywrightExecutionRuntime,
    cancellation?: ExecutionCancellationToken,
  ): Promise<PlaywrightPlanExecutionResult> {
    const input = plan as any
    if (!Array.isArray(input?.steps) || ![1, 2].includes(input.steps.length)
      || input.steps[0]?.kind !== 'navigate_to_observed_route'
      || input.steps.length === 2 && input.steps[1]?.kind !== 'click_observed_data_test') {
      return { status: 'unsupported_plan', reasonCode: 'unsupported_action' }
    }
    if (input?.oracle?.kind !== 'subject_observable') {
      return { status: 'unsupported_plan', reasonCode: 'unsupported_oracle' }
    }
    const authenticationRequired = input.schemaVersion === 2
      ? input.authenticationExpectation?.state === 'required'
      : input.authenticationRequired
    const authenticationMechanism = input.schemaVersion === 2
      ? input.authenticationExpectation?.mechanism
      : input.authenticationSetup?.mechanism
    if (authenticationRequired && !SUPPORTED_AUTH_MECHANISMS.has(authenticationMechanism)) {
      return { status: 'unsupported_plan', reasonCode: 'unsupported_auth_mechanism' }
    }
    try {
      validateCanonicalExecutablePlan(plan)
    } catch {
      return { status: 'unsupported_plan', reasonCode: 'invalid_plan' }
    }

    if (cancellation?.isCancellationRequested()) {
      return { status: 'cancelled', reasonCode: 'cancellation_requested' }
    }

    let session: ExecutionSession | null = null
    try {
      const timeoutMs = runtime.navigationTimeoutMs ?? 30_000
      if (authenticationRequired) {
        const credentialReference = plan.schemaVersion === 2
          ? runtime.credentialReference
          : plan.authenticationSetup!.credentialReference
        if (!credentialReference) return { status: 'authentication_failed', reasonCode: 'credential_missing' }
        const scoped = await this.credentials.run(
          credentialReference,
          async material => {
            session = await this.createSession()
            if (cancellation?.isCancellationRequested()) {
              return { status: 'cancelled', reasonCode: 'cancellation_requested' } as PlaywrightPlanExecutionResult
            }
            try {
              const authenticated = await session.authenticateFormLogin(
                runtime.loginUrl ?? runtime.baseUrl,
                material,
                timeoutMs,
              )
              return authenticated
                ? null
                : { status: 'authentication_failed', reasonCode: 'authentication_failed' } as PlaywrightPlanExecutionResult
            } catch {
              return { status: 'authentication_failed', reasonCode: 'authentication_failed' } as PlaywrightPlanExecutionResult
            }
          },
        )
        if (scoped.kind === 'unavailable') {
          return { status: 'authentication_failed', reasonCode: 'credential_missing' }
        }
        if (scoped.value) return scoped.value
        if (cancellation?.isCancellationRequested()) {
          return { status: 'cancelled', reasonCode: 'cancellation_requested' }
        }
      } else {
        session = await this.createSession()
        if (cancellation?.isCancellationRequested()) {
          return { status: 'cancelled', reasonCode: 'cancellation_requested' }
        }
      }

      const activeSession = session
      if (!activeSession) return { status: 'executor_failure', reasonCode: 'executor_failure' }
      const navigation = plan.steps[0]
      if (navigation.kind !== 'navigate_to_observed_route') {
        return { status: 'unsupported_plan', reasonCode: 'invalid_plan' }
      }
      const targetUrl = new URL(navigation.routePath, runtime.baseUrl).href
      if (cancellation?.isCancellationRequested()) {
        return { status: 'cancelled', reasonCode: 'cancellation_requested' }
      }
      try {
        await activeSession.navigate(targetUrl, timeoutMs)
      } catch {
        return { status: 'navigation_failed', reasonCode: 'navigation_failed' }
      }
      if (cancellation?.isCancellationRequested()) {
        return { status: 'cancelled', reasonCode: 'cancellation_requested' }
      }
      if (plan.steps.length === 2) {
        if (cancellation?.isCancellationRequested()) {
          return { status: 'cancelled', reasonCode: 'cancellation_requested' }
        }
        const click = plan.steps[1]
        if (click.kind !== 'click_observed_data_test' || !activeSession.clickDataTest) {
          return { status: 'executor_failure', reasonCode: 'executor_failure' }
        }
        try {
          await activeSession.clickDataTest(click.dataTestValue, timeoutMs)
        } catch {
          return { status: 'action_failed', reasonCode: 'action_failed' }
        }
      }
      if (cancellation?.isCancellationRequested()) {
        return { status: 'cancelled', reasonCode: 'cancellation_requested' }
      }
      const finalUrl = activeSession.currentUrl()
      const expectedRoute = plan.oracle.routePath ?? navigation.routePath
      const expectedUrl = new URL(expectedRoute, runtime.baseUrl).href
      if (!urlMatchesRoute(finalUrl, expectedUrl)) {
        return { status: 'oracle_failed', reasonCode: 'oracle_failed', finalUrl }
      }
      return { status: 'completed', reasonCode: 'completed', finalUrl }
    } catch {
      return { status: 'executor_failure', reasonCode: 'executor_failure' }
    } finally {
      await session?.close().catch(() => undefined)
    }
  }
}
