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
 * TD-148 — login-surface OBSERVATION on crawl auth-failure. OBSERVATION-ONLY.
 *
 * FAILURE-TRIGGERED ONLY (shouldObserveLoginSurface gates it): this fires only when a
 * crawl already failed on auth, so it only ever observes a PRE-AUTH login surface — the
 * door, not the room (Nova). The retired identity-divergence comparison (TD-UI-027) drew
 * conclusions about the APPLICATION behind that door — a domain a pre-auth observation
 * cannot reach. A proposed pre-auth fence would have rendered every signal permanently
 * inconclusive, which proved the comparison never belonged in this execution context.
 * The capability was not evidence-supported and has been RETIRED, not gated.
 *
 * So this surface DRAWS NO CONCLUSION. It records what the login surface showed and
 * asserts nothing beyond it. Each observation carries THREE parts (the honesty
 * requirement — a bare observation carries selection + connotation defects):
 *   (a) the value, factually;
 *   (b) the mechanism — how it was obtained, incl. its blind spot;
 *   (c) the observation boundary — what the observation cannot determine, naming the competing causes.
 * Scope is MECHANISM ("what this probe observed"), never RELEVANCE ("what is relevant").
 * Diagnostic context only; FORGE does not infer from it why authentication failed.
 */

import { chromium, Page } from '@playwright/test'
import { detectAuthType, detectRenderingModel } from './Bootstrap'
import { OnboardingConfig, CrawlDiagnostic, LoginSurfaceSignal, LoginSurfaceObservationReport } from './types'

// ── Observation-boundary texts (part c) — value-first: what each observation
//    describes, then the competing causes it cannot distinguish among, so the
//    observation cannot be read as a cause (TD-149/150/151). Named observationBoundary
//    (Nova, TD-UI-064): the scope OUTSIDE the observation, not an apology for it. ──
const PASSWORD_FIELD_BOUNDARY =
  'This observation describes the rendered login surface at count time. It cannot determine whether authentication ' +
  'uses SSO or a redirect-based login (which presents no password field), whether authentication was required at all, ' +
  'whether the page load failed or completed only partially, whether a WAF, bot-wall, or interstitial was served, ' +
  'whether a session was already active, or whether a JavaScript-rendered login form had not yet appeared at count time.'
const APP_SHAPE_BOUNDARY =
  'This observation describes the shape of the login surface, not the application behind it. The same classification ' +
  'arises from a genuine application type, a static login shell in front of an SPA, an SPA that had not finished ' +
  'hydrating at observation time, or a maintenance or interstitial page classified on its own merits.'
const LANDING_URL_BOUNDARY =
  'This observation describes the URL the navigation landed on after any redirects. A different origin is consistent ' +
  'with the application having moved, an SSO or authentication redirect, a reverse proxy, a maintenance redirect, or ' +
  'geo or tenant routing; a matching origin does not establish that the configured application is what responded.'

const OBSERVATION_NOTE =
  'FORGE records exactly what was observed during the failed authentication. These observations provide context for ' +
  'investigation. They are not used to infer why authentication failed or whether the application changed.'

/** FAILURE-TRIGGERED gate (unchanged from the retired probe): observe ONLY when a crawl
 *  already failed on auth — a role's auth was tried and rejected, or auth was required and
 *  no credentials existed. A successful crawl never observes. Non-web app types never
 *  observe (this is a web-page observation). */
export function shouldObserveLoginSurface(
  roleAuthOutcomes: Record<string, 'succeeded' | 'failed' | 'unknown'>,
  config: OnboardingConfig,
): boolean {
  const appType = config.appType ?? config.app.appType
  const nonWeb = ['rest-api', 'graphql-api', 'mobile-android', 'mobile-ios', 'iot', 'cloud', 'data']
  if (nonWeb.includes(appType)) return false
  if (Object.values(roleAuthOutcomes).includes('failed')) return true
  return config.roles.length === 0 && !!config.unmetAuth
}

/** Compose the observation diagnostic (a crawlDiagnostics entry). No comparison, no
 *  configured value, no verdict, NO remedy — the detail records the three-part observations
 *  plus the diagnostic-context note. */
export function buildLoginSurfaceDiagnostic(observations: LoginSurfaceSignal[], target: string): CrawlDiagnostic {
  const lines = observations.map(o =>
    `${o.signal} = ${o.observation} [obtained via: ${o.mechanism}] [observation boundary: ${o.observationBoundary}]`)
  const report: LoginSurfaceObservationReport = { check: 'login-surface-observation', observations, note: OBSERVATION_NOTE }
  return {
    scope:  'role',
    target,
    reason: 'login-surface-observation',
    detail: `Login-surface observations at crawl auth failure (observation-only; no conclusion drawn): ${lines.join(' | ')} — ${OBSERVATION_NOTE}`,
    loginSurfaceObservation: report,
    // no remedy: nothing is prescribed (TD-148 — this is an observation, not a gap).
  }
}

const passwordFieldValueText = (v: string | null): string =>
  v === null ? 'not observed' : (v === 'form-login' ? 'password field present' : '0 password fields')

/** Belt-and-suspenders: an all-'not observed' record when even the probe wrapper fails. */
export function buildAllNotObservedDiagnostic(config: OnboardingConfig, why: string): CrawlDiagnostic {
  const observations: LoginSurfaceSignal[] = [
    { signal: 'password-field', observation: 'not observed', mechanism: `not obtained: ${why}`, observationBoundary: PASSWORD_FIELD_BOUNDARY },
    { signal: 'app-shape',      observation: 'not observed', mechanism: `not obtained: ${why}`, observationBoundary: APP_SHAPE_BOUNDARY },
    { signal: 'landing-url',    observation: 'not observed', mechanism: `not obtained: ${why}`, observationBoundary: LANDING_URL_BOUNDARY },
  ]
  return buildLoginSurfaceDiagnostic(observations, config.app.name)
}

export type LoginSurfacePageSession = { page: Page; close: () => Promise<void> }
export type LoginSurfacePageFactory = () => Promise<LoginSurfacePageSession>

const defaultPageFactory: LoginSurfacePageFactory = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  return { page, close: () => browser.close() }
}

/**
 * I/O wrapper: run the shipped bootstrap observations (detectAuthType, detectAppType,
 * page.url()) against the live login surface and build the observation diagnostic. Never
 * throws on probe failure — an unobtained observation is recorded as 'not observed' with
 * the reason in its mechanism (never a bare absence).
 */
export async function observeLoginSurface(
  config: OnboardingConfig,
  pageFactory: LoginSurfacePageFactory = defaultPageFactory,
): Promise<CrawlDiagnostic> {
  let landingUrl: string | null = null
  let passwordField: string | null = null   // detectAuthType raw value ('form-login' | 'none')
  let appShape: string | null = null
  let navWhy = '', pwWhy = '', shapeWhy = ''

  let session: LoginSurfacePageSession | null = null
  try {
    session = await pageFactory()
  } catch (e: any) {
    navWhy = pwWhy = shapeWhy = `browser launch failed: ${e?.message ?? e}`
  }

  if (session) {
    try {
      try {
        await session.page.goto(config.app.baseUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
        landingUrl = session.page.url()
      } catch (e: any) {
        navWhy = pwWhy = shapeWhy = `navigation failed: ${e?.message ?? e}`
      }
      if (landingUrl !== null) {
        try { passwordField = (await detectAuthType(session.page)).value }
        catch (e: any) { pwWhy = `observation failed: ${e?.message ?? e}` }
        try { appShape = (await detectRenderingModel(session.page)).value }   // ADR-021: rendering, not navigation
        catch (e: any) { shapeWhy = `observation failed: ${e?.message ?? e}` }
      }
    } finally {
      await session.close().catch(() => {})
    }
  }

  const observations: LoginSurfaceSignal[] = [
    {
      signal:      'password-field',
      observation: passwordFieldValueText(passwordField),
      mechanism:   `password-field DOM count via an immediate query at domcontentloaded${pwWhy ? ` (not obtained: ${pwWhy})` : ''}` +
                   ` — a login form rendered after this point reads 0 here (the SPA blind spot).`,
      observationBoundary: PASSWORD_FIELD_BOUNDARY,
    },
    {
      signal:      'app-shape',
      observation: appShape ?? 'not observed',
      mechanism:   `SPA/non-SPA classification of the landing page via DOM/script signals at domcontentloaded${shapeWhy ? ` (not obtained: ${shapeWhy})` : ''}` +
                   ` — a page not finished hydrating may read as non-SPA here.`,
      observationBoundary: APP_SHAPE_BOUNDARY,
    },
    {
      signal:      'landing-url',
      observation: landingUrl ?? 'not observed',
      mechanism:   `page.url() after page.goto(configured base URL, waitUntil domcontentloaded)${navWhy ? ` (not obtained: ${navWhy})` : ''}` +
                   ` — reflects any redirect the navigation followed.`,
      observationBoundary: LANDING_URL_BOUNDARY,
    },
  ]
  return buildLoginSurfaceDiagnostic(observations, config.app.name)
}
