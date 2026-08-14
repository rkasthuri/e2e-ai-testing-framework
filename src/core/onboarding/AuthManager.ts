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

import { Browser, BrowserContext } from '@playwright/test'
import {
  OnboardingConfig,
  RoleConfig,
  type AuthenticationStage,
  type AuthenticationStageDiagnostic,
} from './types'
import type { CredentialMaterial } from '../security/CredentialExecutionScope'

export interface AuthResult {
  context:       BrowserContext
  startUrl:      string
  authenticated: boolean
  authenticationStages: AuthenticationStageDiagnostic[]
}

/** Shared bounded form-login selector vocabulary. Runtime consumers may reuse
 * these selectors, but must not infer additional controls or mechanisms. */
export const FORM_LOGIN_SELECTORS = Object.freeze({
  username: 'input[name="username"], input[type=text], input[placeholder*=user i], input[id*=user]',
  password: 'input[name="password"], input[type=password], input[placeholder*=pass i]',
  submit: 'button[type=submit], input[type=submit], button:has-text("Login"), button:has-text("Sign in")',
})

const AUTHENTICATION_STAGES: AuthenticationStage[] = [
  'credential-reference-resolution',
  'login-surface-detection',
  'username-control-discovery',
  'password-control-discovery',
  'value-entry-completion',
  'submit-control-discovery',
  'submission-attempt',
  'navigation-or-page-state-change',
  'post-submit-login-surface-evaluation',
]

type CredentialResolution =
  | { kind: 'resolved'; username: string; password: string }
  | { kind: 'unavailable'; safeErrorType: string }

function initialAuthenticationStages(): AuthenticationStageDiagnostic[] {
  return AUTHENTICATION_STAGES.map(stage => ({
    stage,
    outcome: 'not_evaluated',
    selectorStrategyCategory: 'not_applicable',
  }))
}

export function safeAuthenticationErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'UnknownError'
}

export function classifyAuthenticationLocation(
  before: string,
  after: string,
): NonNullable<AuthenticationStageDiagnostic['urlClassification']> {
  try {
    const beforeUrl = new URL(before)
    const afterUrl = new URL(after)
    return {
      origin: beforeUrl.origin === afterUrl.origin ? 'same-origin' : 'different-origin',
      path: beforeUrl.pathname === afterUrl.pathname ? 'same-path' : 'different-path',
    }
  } catch {
    return { origin: 'indeterminate', path: 'indeterminate' }
  }
}

export function summarizeAuthenticationStages(stages: AuthenticationStageDiagnostic[]): string {
  const postSubmit = stages.find(stage => stage.stage === 'post-submit-login-surface-evaluation')
  if (postSubmit?.outcome === 'failed' && postSubmit.loginSurfaceRetained === true) {
    return 'Credential resolution, form-control discovery, value entry, and submission completed; post-submit evaluation found the login surface retained. Credential acceptance remains externally indeterminate.'
  }
  const failed = stages.find(stage => stage.outcome === 'failed')
  if (failed) {
    return `Authentication stopped at stage '${failed.stage}' with safe error type '${failed.safeErrorType ?? 'UnclassifiedError'}'.`
  }
  return 'Authentication did not produce conclusive acceptance evidence. Review the recorded stages before another observation.'
}

export class AuthManager {
  private readonly credentialMaterial: CredentialMaterial | undefined

  constructor(
    private config: OnboardingConfig,
    opts: { credentialMaterial?: CredentialMaterial } = {},
  ) {
    this.credentialMaterial = opts.credentialMaterial
  }

  async authenticate(role: RoleConfig, browser: Browser): Promise<AuthResult> {
    const context = await browser.newContext()
    const authenticationStages = initialAuthenticationStages()
    const updateStage = (
      stage: AuthenticationStage,
      update: Omit<AuthenticationStageDiagnostic, 'stage'>,
    ): void => {
      const index = authenticationStages.findIndex(item => item.stage === stage)
      authenticationStages[index] = { stage, ...update }
    }
    const markAll = (outcome: 'not_required' | 'not_evaluated'): void => {
      for (const stage of AUTHENTICATION_STAGES) {
        updateStage(stage, { outcome, selectorStrategyCategory: 'not_applicable' })
      }
    }

    // No auth needed
    if (role.authFlow === 'none') {
      markAll('not_required')
      return { context, startUrl: this.config.app.baseUrl, authenticated: true, authenticationStages }
    }

    // Unsupported auth flows
    if (role.authFlow === 'oauth' || role.authFlow === 'api-key') {
      console.warn(
        `[AuthManager] Auth flow "${role.authFlow}" not supported — skipping auth for ${role.id}`
      )
      markAll('not_evaluated')
      return { context, startUrl: this.config.app.baseUrl, authenticated: false, authenticationStages }
    }

    // form-login
    const credentials = this.resolveCredentials(role)
    if (credentials.kind === 'unavailable') {
      updateStage('credential-reference-resolution', {
        outcome: 'failed',
        selectorStrategyCategory: 'not_applicable',
        safeErrorType: credentials.safeErrorType,
      })
      console.warn(`[AuthManager] No credentials found for role ${role.id} — skipping auth`)
      return { context, startUrl: this.config.app.baseUrl, authenticated: false, authenticationStages }
    }
    updateStage('credential-reference-resolution', {
      outcome: 'succeeded',
      selectorStrategyCategory: 'not_applicable',
    })

    const configRole  = (this.config.roles ?? []).find((r: any) => r.id === role.id)
    const loginUrl    = (configRole as any)?.loginUrl    ?? this.config.app.baseUrl
    const successUrl  = (configRole as any)?.successUrl  ?? null
    const roleSelectors = (configRole as any)?.selectors ?? {}

    const userSelectorConfigured = typeof roleSelectors.username === 'string'
    const passwordSelectorConfigured = typeof roleSelectors.password === 'string'
    const submitSelectorConfigured = typeof roleSelectors.submit === 'string'
    const userSel   = roleSelectors.username ?? FORM_LOGIN_SELECTORS.username
    const passSel   = roleSelectors.password ?? FORM_LOGIN_SELECTORS.password
    const submitSel = roleSelectors.submit ?? FORM_LOGIN_SELECTORS.submit

    const page = await context.newPage()
    let currentStage: AuthenticationStage = 'login-surface-detection'
    try {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1500)

      const usernameLocator = page.locator(userSel)
      const passwordLocator = page.locator(passSel)
      const usernameCount = await usernameLocator.count()
      const passwordCount = await passwordLocator.count()
      updateStage('login-surface-detection', {
        outcome: usernameCount > 0 && passwordCount > 0 ? 'succeeded' : 'indeterminate',
        selectorStrategyCategory: 'not_applicable',
        matchCount: usernameCount + passwordCount,
      })

      currentStage = 'username-control-discovery'
      const usernameEl = usernameLocator.first()
      await usernameEl.waitFor({ state: 'visible', timeout: 15000 })
      updateStage('username-control-discovery', {
        outcome: 'succeeded',
        selectorStrategyCategory: userSelectorConfigured ? 'configured' : 'semantic-fallback',
        matchCount: usernameCount,
        controlVisible: true,
      })
      await usernameEl.fill(credentials.username)
      updateStage('value-entry-completion', {
        outcome: 'indeterminate',
        selectorStrategyCategory: 'not_applicable',
        usernameEntryCompleted: true,
        passwordEntryCompleted: false,
      })

      currentStage = 'password-control-discovery'
      const passwordEl = passwordLocator.first()
      await passwordEl.waitFor({ state: 'visible', timeout: 10000 })
      updateStage('password-control-discovery', {
        outcome: 'succeeded',
        selectorStrategyCategory: passwordSelectorConfigured ? 'configured' : 'semantic-fallback',
        matchCount: passwordCount,
        controlVisible: true,
      })
      await passwordEl.fill(credentials.password)
      updateStage('value-entry-completion', {
        outcome: 'succeeded',
        selectorStrategyCategory: 'not_applicable',
        usernameEntryCompleted: true,
        passwordEntryCompleted: true,
      })

      currentStage = 'submit-control-discovery'
      const submitLocator = page.locator(submitSel)
      const submitCount = await submitLocator.count()
      const submitEl = submitLocator.first()
      await submitEl.waitFor({ state: 'visible', timeout: 10000 })
      updateStage('submit-control-discovery', {
        outcome: 'succeeded',
        selectorStrategyCategory: submitSelectorConfigured ? 'configured' : 'semantic-fallback',
        matchCount: submitCount,
        controlVisible: true,
      })

      const urlBefore = page.url()
      currentStage = 'submission-attempt'
      await submitEl.click()
      updateStage('submission-attempt', {
        outcome: 'succeeded',
        selectorStrategyCategory: submitSelectorConfigured ? 'configured' : 'semantic-fallback',
        submissionAttempted: true,
      })

      currentStage = 'navigation-or-page-state-change'
      let navigationErrorType: string | null = null
      try {
        if (successUrl) {
          await page.waitForURL(
            (u) => u.href.includes(successUrl),
            { timeout: 15000 }
          )
        } else {
          await page.waitForURL(
            (u) => u.href !== urlBefore,
            { timeout: 15000 }
          )
        }
      } catch (error) {
        navigationErrorType = safeAuthenticationErrorType(error)
        // Timeout — check if we moved at all
      }

      // Allow page to fully settle
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)

      const urlAfter = page.url()
      const urlClassification = classifyAuthenticationLocation(urlBefore, urlAfter)
      const urlChanged = urlClassification.origin === 'different-origin'
        || urlClassification.path === 'different-path'
      updateStage('navigation-or-page-state-change', {
        outcome: urlChanged ? 'succeeded' : 'indeterminate',
        selectorStrategyCategory: 'not_applicable',
        urlClassification,
        ...(navigationErrorType ? { safeErrorType: navigationErrorType } : {}),
      })

      // Validate auth succeeded — URL must differ from login URL
      const stillOnLogin = urlAfter === urlBefore ||
        urlAfter.includes('login') && urlBefore.includes('login')
      currentStage = 'post-submit-login-surface-evaluation'
      const postSubmitPasswordCount = await page.locator(passSel).count()
      updateStage('post-submit-login-surface-evaluation', {
        outcome: stillOnLogin ? 'failed' : 'succeeded',
        selectorStrategyCategory: passwordSelectorConfigured ? 'configured' : 'semantic-fallback',
        matchCount: postSubmitPasswordCount,
        loginSurfaceRetained: stillOnLogin,
        urlClassification,
      })

      if (stillOnLogin) {
        console.warn(`[AuthManager] Authentication remained on the login surface for role ${role.id}; credential acceptance is indeterminate.`)
        await page.close()
        return { context, startUrl: this.config.app.baseUrl, authenticated: false, authenticationStages }
      }

      const startUrl = urlAfter  // Use actual post-auth URL as crawl start

      console.log(`[AuthManager] Authenticated as ${role.id}; post-submit location changed.`)

      await page.close()
      return { context, startUrl, authenticated: true, authenticationStages }
    } catch (error: unknown) {
      const existing = authenticationStages.find(stage => stage.stage === currentStage)!
      updateStage(currentStage, {
        ...existing,
        outcome: 'failed',
        safeErrorType: safeAuthenticationErrorType(error),
      })
      console.warn(`[AuthManager] Authentication stage failed for role ${role.id}: stage=${currentStage} errorType=${safeAuthenticationErrorType(error)}`)
      try { await page.close() } catch {}
      return { context, startUrl: this.config.app.baseUrl, authenticated: false, authenticationStages }
    }
  }

  private resolveCredentials(
    role: RoleConfig
  ): CredentialResolution {
    if (this.credentialMaterial) {
      return {
        kind: 'resolved',
        username: this.credentialMaterial.username,
        password: this.credentialMaterial.password,
      }
    }
    if (!role.credentialsEnvKey) return { kind: 'unavailable', safeErrorType: 'CredentialReferenceMissing' }
    const raw = process.env[role.credentialsEnvKey]
    if (!raw) return { kind: 'unavailable', safeErrorType: 'CredentialMaterialUnavailable' }
    const [username, password] = raw.split(':')
    if (!username || !password) return { kind: 'unavailable', safeErrorType: 'CredentialMaterialMalformed' }
    return { kind: 'resolved', username, password }
  }
}
