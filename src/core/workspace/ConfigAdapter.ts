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
 * TD-108 — ConfigAdapter: AppConfig (thin JSON, workspace layer) ↔
 * OnboardingConfig (rich TS, existing pipeline layer).
 *
 * Mirrors Bootstrap.buildAgentConfig()'s conversion logic (the pre-existing
 * reuse seam identified in the Step 0 audit) and extends it with validation:
 * AppConfig carries PLAIN STRINGS for appType/crawlStrategy/authType (it is
 * user-editable JSON), while OnboardingConfig has narrow unions — an invalid
 * value THROWS with a descriptive error, it is never silently coerced.
 *
 * ── LOSSY FIELDS (explicit — no silent data loss) ────────────────────────────
 * toOnboardingConfig() must invent safe defaults for everything OnboardingConfig
 * carries that AppConfig v1 does not:
 *   roles              → at most ONE role (from credentials.envKey); a role's
 *                        selectors / loginUrl / successUrl / displayName are
 *                        NOT representable in AppConfig v1
 *   flows              → [] (business-intent flow hints not representable)
 *   pagePrerequisites  → [] (TD-013 setup hints not representable)
 *   budgets.aiCalls    → carried from AppConfig.budgets.aiCalls; DEFAULT_AI_BUDGET when absent (TD-132)
 *   denyList           → omitted
 *   apiEndpoints / apiSpecFile / apiSpecUrl → omitted (API bootstrap is out of
 *                        AppConfig v1 scope; the .ts fixture path covers APIs)
 * fromOnboardingConfig() DROPS those same fields going the other way — plus all
 * roles beyond the first. Both directions are schema-v2 candidates.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { AppConfig } from './AppConfig'
import { OnboardingConfig, AppTypeName, RoleConfig } from '../onboarding/types'
import { DEFAULT_AI_BUDGET } from '../config/budgetDefaults'

const APP_TYPE_NAMES: readonly AppTypeName[] = [
  'mpa', 'spa', 'api', 'web-ui', 'rest-api', 'graphql-api',
  'mobile-android', 'mobile-ios', 'iot', 'cloud', 'data',
]
const CRAWL_MODES = ['auto', 'bfs', 'spa', 'hybrid'] as const
const AUTH_FLOWS  = ['form-login', 'oauth', 'api-key', 'none'] as const

type CrawlMode = (typeof CRAWL_MODES)[number]
type AuthFlow  = (typeof AUTH_FLOWS)[number]

function validated<T extends string>(value: string, allowed: readonly T[], field: string): T {
  const match = allowed.find(a => a === value)
  if (!match) {
    throw new Error(
      `[ConfigAdapter] Invalid ${field} '${value}' in .forge/config.json — ` +
      `expected one of: ${allowed.join(', ')}`,
    )
  }
  return match
}

/**
 * Inverse of Bootstrap's credentialsEnvKey(): 'STANDARD_USER_CREDENTIALS' →
 * 'standardUser'. Exact round-trip for camelCase role ids (the convention the
 * env-key derivation assumes).
 */
export function roleIdFromEnvKey(envKey: string): string {
  return envKey
    .replace(/_CREDENTIALS$/, '')
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** AppConfig (JSON) → the rich OnboardingConfig the existing pipeline consumes. */
export function toOnboardingConfig(appConfig: AppConfig): OnboardingConfig {
  const appType   = validated(appConfig.appType, APP_TYPE_NAMES, 'appType')
  const crawlMode = validated(appConfig.crawlStrategy, CRAWL_MODES, 'crawlStrategy')
  const authFlow  = validated(appConfig.authType, AUTH_FLOWS, 'authType')

  // At most ONE role — AppConfig v1's documented limitation (see header).
  const roles: RoleConfig[] = appConfig.credentials
    ? [{
        id:                roleIdFromEnvKey(appConfig.credentials.envKey),
        displayName:       roleIdFromEnvKey(appConfig.credentials.envKey),
        authFlow,
        credentialsEnvKey: appConfig.credentials.envKey,
      }]
    : []

  // Degraded mode, surfaced (Rule 5): auth is expected but no credentials are
  // configured — the crawl will run unauthenticated. TD-UI-031 Block 4: this fact
  // was previously logged and DISCARDED (TD-UI-041 instance iv). Thread it into
  // the config as `unmetAuth` so Crawler can emit an honest `auth-required`
  // diagnostic instead of a silent 0-page crawl.
  const unmetAuth = authFlow !== 'none' && roles.length === 0 ? { authType: authFlow } : undefined
  if (unmetAuth) {
    console.warn(
      `[ConfigAdapter] authType '${authFlow}' but no credentials in .forge/config.json — ` +
      `the crawl will run UNAUTHENTICATED`,
    )
  }

  return {
    app: {
      name:    appConfig.appName,
      baseUrl: appConfig.url,
      appType,
    },
    // Top-level appType discriminator deliberately omitted — the UI crawl path
    // is the default; API bootstrap is out of AppConfig v1 scope (see header).
    roles,
    flows:             [],   // LOSSY — not representable in AppConfig v1
    pagePrerequisites: [],   // LOSSY — not representable in AppConfig v1
    budgets: {
      maxPages: appConfig.budgets?.maxPages ?? 50,
      maxDepth: appConfig.budgets?.maxDepth ?? 5,
      aiCalls:  appConfig.budgets?.aiCalls ?? DEFAULT_AI_BUDGET,   // TD-132 — carried through (no longer lossy)
    },
    // TD-120: analysis tuning passes through verbatim when present (NOT lossy —
    // both sides carry the same optional shape); absent = downstream default 10.
    ...(appConfig.analysis ? { analysis: appConfig.analysis } : {}),
    crawlMode,
    ...(unmetAuth ? { unmetAuth } : {}),
  }
}

/** OnboardingConfig → thin AppConfig. Drops the rich fields — see header. */
export function fromOnboardingConfig(config: OnboardingConfig): AppConfig {
  const firstRole = config.roles[0]   // LOSSY — roles beyond the first are dropped
  return {
    schemaVersion: 1,
    appName:       config.app.name,
    url:           config.app.baseUrl,
    appType:       config.app.appType,
    crawlStrategy: config.crawlMode ?? 'auto',
    authType:      firstRole?.authFlow ?? 'none',
    ...(firstRole?.credentialsEnvKey ? { credentials: { envKey: firstRole.credentialsEnvKey } } : {}),
    ...(config.budgets
      ? { budgets: { maxDepth: config.budgets.maxDepth, maxPages: config.budgets.maxPages } }
      : {}),
    ...(config.analysis ? { analysis: config.analysis } : {}),   // TD-120 passthrough
  }
}
