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
 * ADR-013 Credential Resolution Policy — the reference/material seam.
 *
 * A CredentialReference names WHERE the secret lives (env var names) and is the
 * only credential shape ever persisted (in the forge-ui sidecar
 * ~/.forge-projects/<app>/.forge/credentials.json). CredentialMaterial holds the
 * actual values and is created only in-memory by the resolver / ExecutionContext,
 * never written to disk. The engine (src/) sees neither type — ExecutionContext
 * translates material down to the engine's existing credential input.
 */

/** WHERE the secret lives — env var names, never the secret itself. */
export interface CredentialReference {
  usernameEnv: string   // e.g. 'SAUCEDEMO_USERNAME'
  passwordEnv: string   // e.g. 'SAUCEDEMO_PASSWORD'
}

/** The materialized secret — in-memory only; only the resolver/ExecutionContext holds it. */
export interface CredentialMaterial {
  username: string
  password: string
}

/**
 * Base for all pre-flight credential refusals. Thrown BEFORE the engine runs;
 * JobRunner catches this base and surfaces `.message` to the Mission Timeline +
 * job status (never a silent throw). Each subclass' message is operator-facing.
 */
export abstract class CredentialErrorBase extends Error {}

/**
 * Auth-required app with NO resolvable credentials — the env pointer pair is
 * unset. Fix: set the env vars.
 */
export class CredentialError extends CredentialErrorBase {
  constructor(
    readonly appName: string,
    readonly authType: string,
    readonly reference: CredentialReference,
  ) {
    super(
      `Crawl refused — ${appName} requires authentication (authType: ${authType}) ` +
      `but no credentials were found. Set ${reference.usernameEnv} and ` +
      `${reference.passwordEnv} in the environment before starting FORGE UI, then retry.`,
    )
    this.name = 'CredentialError'
  }
}

/**
 * Credentials ARE resolved, but the engine config has no auth slot
 * (config.credentials.envKey) to inject them under, on a non-force re-crawl.
 * Distinct from CredentialError: the fix is a Force re-crawl (which bootstraps
 * and establishes the slot), NOT setting env vars. We refuse explicitly rather
 * than silently auto-forcing a re-detect or running unauthenticated.
 */
export class CredentialSlotError extends CredentialErrorBase {
  constructor(
    readonly appName: string,
    readonly authType: string,
  ) {
    // NB: the ⛔ marker is added by JobRunner's Timeline append — kept out of the
    // message here to avoid doubling (consistent with CredentialError).
    super(
      `Authenticated bootstrap required — ${appName} has credentials but hasn't ` +
      `completed authenticated onboarding. Run Authenticated Bootstrap to initialize it.`,
    )
    this.name = 'CredentialSlotError'
  }
}
