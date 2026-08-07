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
import * as os from 'os'
import * as path from 'path'
import { credentialStore, CredentialStore } from '../context/credentials/CredentialStore'

/**
 * TD-UI-013 / ADR-013 — migrate fixture apps (SauceDemo, OrangeHRM, Restful
 * Booker) into real UI workspaces at ~/.forge-projects/<appName>/ so they are
 * discovered by GET /api/v1/projects (no longer greyed in the switcher).
 *
 * Writes config.json (authType only — NEVER a credentials slot; ADR-013), the
 * bootstrap manifest, project.json, and — for auth apps — the credential-
 * reference SIDECAR (env-var pointer names). The engine credential slot is
 * established later by an authenticated bootstrap (onboard Path A / the
 * authenticate endpoint), never hand-written here.
 *
 * Idempotent — safe on every server start (incl. the EADDRINUSE port-retry).
 * TD-097: all paths runtime-derived via os.homedir() + path.join — no hardcodes.
 */
interface Fixture {
  appName: string
  url: string
  appType: string
  crawlStrategy: string
  authType: string
}

const FIXTURES: Fixture[] = [
  {
    appName: 'saucedemo',
    url: 'https://www.saucedemo.com',
    appType: 'spa',
    crawlStrategy: 'auto',
    authType: 'form-login',
  },
  {
    appName: 'orangehrm',
    url: 'https://opensource-demo.orangehrmlive.com',
    appType: 'spa',
    crawlStrategy: 'auto',
    authType: 'form-login',
  },
  {
    appName: 'restful-booker',
    url: 'https://restful-booker.herokuapp.com',
    appType: 'api',
    crawlStrategy: 'auto',
    authType: 'none',
  },
]

/** The b18aadd forge-ui-written slot envKey for an app (`<APP>_CREDENTIALS`). */
export function b18addSlotEnvKey(appName: string): string {
  return `${appName.toUpperCase().replace(/-/g, '_')}_CREDENTIALS`
}

/**
 * TD-UI-019 — true ONLY for a b18aadd artifact slot (`<APP>_CREDENTIALS`). A
 * role-derived engine-established slot (`USER_CREDENTIALS`, from an authenticated
 * bootstrap) never matches, so it SURVIVES migrateFixtures on every reboot.
 * Edge: a fixture named literally 'user' would collide (`USER_CREDENTIALS`) —
 * none of the three fixtures is, and the strip runs only over FIXTURES.
 */
export function isB18addArtifactSlot(
  appName: string,
  config: { credentials?: { envKey?: string } },
): boolean {
  return config.credentials?.envKey === b18addSlotEnvKey(appName)
}

export async function migrateFixtures(): Promise<void> {
  for (const fixture of FIXTURES) {
    const workspacePath = path.join(os.homedir(), '.forge-projects', fixture.appName)
    const forgeDir = path.join(workspacePath, '.forge')
    const configPath = path.join(forgeDir, 'config.json')
    const manifestPath = path.join(forgeDir, 'bootstrap-manifest.json')
    const now = new Date().toISOString()

    // ADR-013 — record the credential REFERENCE (env-var pointer names) in the
    // sidecar for auth apps. forge-ui NEVER writes the engine credential slot
    // (config.credentials.envKey); that is established by an authenticated
    // bootstrap (onboard Path A / the authenticate endpoint).
    if (fixture.authType !== 'none') {
      credentialStore.write(fixture.appName, CredentialStore.defaultReference(fixture.appName))
    }

    // Fix #17 — detection confidences from the confirmed CLI crawl. 'medium'
    // (real CLI evidence, but not live UI-detected); appName is 'high' (derived
    // deterministically from the URL). Read back by GET /projects/:appName so the
    // fields render with real confidence instead of purple 'unknown'.
    const manifest = {
      schemaVersion: 1,
      appName: fixture.appName,
      url: fixture.url,
      detection: {
        appType:       { value: fixture.appType,       confidence: 'medium', source: 'cli-migration' },
        authType:      { value: fixture.authType,      confidence: 'medium', source: 'cli-migration' },
        crawlStrategy: { value: fixture.crawlStrategy, confidence: 'medium', source: 'cli-migration' },
        appName:       { value: fixture.appName,       confidence: 'high',   source: 'url-derivation' },
      },
      migratedFromCli: true,
      migratedAt: now,
    }

    // Already migrated (config.json exists) — but backfill the manifest if it
    // predates Fix #17, so existing workspaces stop showing 'unknown'.
    if (fs.existsSync(configPath)) {
      // TD-UI-019 — strip ONLY a b18aadd forge-ui-written slot (`<APP>_CREDENTIALS`),
      // NOT a role-derived engine-established slot (`USER_CREDENTIALS`), which must
      // survive every reboot. The two are distinguishable by envKey shape.
      const existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (isB18addArtifactSlot(fixture.appName, existingConfig)) {
        delete existingConfig.credentials
        fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2))
        console.log(`[migrate] ${fixture.appName} — removed b18aadd credential slot (TD-UI-019)`)
      }
      if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
        console.log(`[migrate] ${fixture.appName} — backfilled bootstrap-manifest.json (Fix #17)`)
      } else {
        console.log(`[migrate] ${fixture.appName} already migrated — skipping`)
      }
      continue
    }

    // Create workspace structure.
    fs.mkdirSync(forgeDir, { recursive: true })
    fs.mkdirSync(path.join(workspacePath, 'tests', 'generated'), { recursive: true })
    fs.mkdirSync(path.join(workspacePath, 'tests', 'manual'), { recursive: true })
    fs.mkdirSync(path.join(workspacePath, 'reports'), { recursive: true })

    // Write AppConfig JSON.
    const config = {
      schemaVersion: 1,
      appName: fixture.appName,
      url: fixture.url,
      appType: fixture.appType,
      crawlStrategy: fixture.crawlStrategy,
      authType: fixture.authType,
      // NO credentials block (ADR-013) — the engine slot is established by an
      // authenticated bootstrap, never hand-written by forge-ui.
      budgets: {
        maxDepth: 5,
        maxPages: 50,
        aiCalls: 150,
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

    // Write project.json manifest.
    const projectManifest = {
      projectVersion: 1,
      frameworkVersion: '1.0.0',
      appName: fixture.appName,
      url: fixture.url,
      createdAt: now,
      lastOpenedAt: now,
      databaseVersion: 12,
    }
    fs.writeFileSync(
      path.join(forgeDir, 'project.json'),
      JSON.stringify(projectManifest, null, 2),
    )

    // Write bootstrap-manifest.json (Fix #17 — detection confidences).
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    console.log(`[migrate] ✅ ${fixture.appName} migrated to ${workspacePath}`)
  }
}
