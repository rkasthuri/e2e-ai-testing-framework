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

export function lines(...args: string[]): string {
  return args.join('\n')
}

export function indent(n: number, code: string): string {
  const pad = '  '.repeat(n)
  return code.split('\n').map(l => l.length > 0 ? pad + l : l).join('\n')
}

export function generatedHeader(modelVersion: string, hash: string): string {
  return lines(
    `// @generated from SQLite App Model v${modelVersion} ${hash}`,
    `// DO NOT EDIT — regenerate with: npm run onboard:generate`,
    ``
  )
}

export function toClassName(id: string): string {
  return id
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') + 'Page'
}

export function toCamelCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (c: string) => c.toLowerCase())
    .trim()
}

export function toDisplayName(id: string): string {
  return id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function writeFile(filePath: string, content: string): void {
  const fs   = require('fs')
  const path = require('path')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`[Generator] Written: ${filePath}`)
}

// Converts a model Strategy into the selector string SmartLocator/Playwright expects.
// `accessibleName` is only meaningful for type 'role' — see TD-029.
export function strategyToSelector(type: string, value: string, accessibleName?: string): string {
  switch (type) {
    case 'data-test': return `[data-test="${value}"]`
    case 'id':        return `#${value}`
    case 'text':      return `text=${value}`
    case 'css':       return value
    case 'role': {
      if (/[[\]'"]/.test(value)) {
        throw new Error(
          `[EmitHelper] Role strategy value "${value}" is compound (contains '[', ']', or a quote) — expected a ` +
          `bare ARIA role token with accessibleName as a separate field (see TD-029). This indicates ` +
          `ElementClassifier.buildRoleSelector() regressed to the pre-fix compound-string format, or this model ` +
          `predates TD-029 — re-run the crawl step to refresh it.`
        )
      }
      // Playwright's `role=` selector-engine string — the string-selector
      // equivalent of getByRole(value, { name: accessibleName }).
      return accessibleName
        ? `role=${value}[name="${escapeRoleAccessibleName(accessibleName)}"]`
        : `role=${value}`
    }
    default:          return value
  }
}

// Exported as the single canonical copy (2026-07-18 code-dust sweep) — was
// triplicated verbatim in SpecGenerator + VerificationRunner.
export function escapeRoleAccessibleName(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Properties and methods already declared (concrete) in BasePage.
 * Generated pages must not re-declare these — TypeScript will reject
 * a SmartLocator override of a Locator-typed BasePage property, or a
 * property with the same name as a BasePage method.
 *
 * This list is a hand-maintained mirror of every app's pages/BasePage.ts
 * (shared across apps, since PomGenerator has no per-app introspection of
 * BasePage at generation time) — it must be updated whenever any app's
 * BasePage gains a new public method or property, the same way the
 * original list went stale and let 'openMenu'/'closeMenu' collide.
 */
export const BASE_PAGE_PROPERTIES = new Set([
  // Locator properties (saucedemo's BasePage)
  'menuButton', 'menuCloseButton', 'allItemsLink', 'aboutLink',
  'logoutLink', 'resetAppStateLink', 'cartLink', 'cartBadge', 'pageTitle',
  // Fields common to every BasePage
  'page', 'pageUrl', 'isLoaded',
  // Methods (saucedemo's BasePage; 'goto' and 'takeScreenshot' also cover orangehrm's BasePage)
  'goto', 'waitForPageLoad', 'openMenu', 'closeMenu', 'logout',
  'goToAllItems', 'resetAppState', 'goToCart', 'getCartBadgeCount',
  'isCartBadgeVisible', 'getPageTitle', 'takeScreenshot', 'scrollToElement',
])

// TD-064 FC-004b: a role whose authentication was OBSERVED to fail at crawl.
// Gates on the real observed field ONLY — never derived from reachablePageIds
// (that proxy was rejected). Undefined authOutcome (e.g. a pre-authOutcome model)
// is treated as NOT failed, so back-compat models never silently drop roles.
export function roleAuthFailedAtCrawl(role: { authOutcome?: 'succeeded' | 'failed' | 'unknown' }): boolean {
  return role.authOutcome === 'failed'
}
