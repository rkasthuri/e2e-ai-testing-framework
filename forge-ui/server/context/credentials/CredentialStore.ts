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
import type { CredentialReference } from './CredentialTypes'

/**
 * CredentialStore — reads/writes the forge-ui credential-reference SIDECAR at
 * ~/.forge-projects/<app>/.forge/credentials.json (ADR-013). This file holds
 * ONLY env-var-name pointers, never secrets, and the engine never reads or writes
 * it — so the engine's config.json rewrite on bootstrap (CrawlRunner:296) can
 * never strip these fields (Phase 0 finding). TD-097: paths runtime-derived via
 * os.homedir() + path.join.
 */
interface CredentialSidecar {
  schemaVersion: 1
  usernameEnv: string
  passwordEnv: string
}

export class CredentialStore {
  /** baseDir defaults to the OS home; injectable for tests/isolation (TD-097). */
  constructor(private readonly baseDir: string = os.homedir()) {}

  private sidecarPath(appName: string): string {
    return path.join(this.baseDir, '.forge-projects', appName, '.forge', 'credentials.json')
  }

  /** The recorded reference for an app, or null if none / malformed. */
  read(appName: string): CredentialReference | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.sidecarPath(appName), 'utf-8')) as CredentialSidecar
      if (raw?.schemaVersion !== 1 || !raw.usernameEnv || !raw.passwordEnv) return null
      return { usernameEnv: raw.usernameEnv, passwordEnv: raw.passwordEnv }
    } catch {
      return null   // missing file / bad JSON → treated as "no reference recorded"
    }
  }

  /** Write the reference sidecar (creates .forge/ if missing). Never stores secrets. */
  write(appName: string, ref: CredentialReference): void {
    const file = this.sidecarPath(appName)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const sidecar: CredentialSidecar = {
      schemaVersion: 1,
      usernameEnv: ref.usernameEnv,
      passwordEnv: ref.passwordEnv,
    }
    fs.writeFileSync(file, JSON.stringify(sidecar, null, 2))
  }

  /** Default-derived reference names: <APP>_USERNAME / <APP>_PASSWORD (override deferred). */
  static defaultReference(appName: string): CredentialReference {
    const prefix = appName.toUpperCase().replace(/-/g, '_')
    return { usernameEnv: `${prefix}_USERNAME`, passwordEnv: `${prefix}_PASSWORD` }
  }
}

export const credentialStore = new CredentialStore()
