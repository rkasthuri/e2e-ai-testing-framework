/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

/**
 * OperatorFacingError — base for ENGINE preconditions whose failure an operator
 * can act on (not an internal bug). These are thrown from inside the engine run,
 * where the ExecutionContext boundary stringifies thrown errors — so the typed
 * class does NOT survive to forge-ui. What survives is data on the instance:
 *
 *   - `code`: a stable, machine-readable discriminator (e.g. 'MODEL_NOT_FOUND').
 *   - `operatorFacing`: a brand so a consumer that CANNOT import this class (the
 *     forge-ui side of the boundary) can recognize the family structurally,
 *     without colliding with Node's own coded errors (ENOENT, etc.).
 *
 * forge-ui reads `code` duck-typed (never importing this module) and surfaces
 * `.message` to the Mission Timeline. The message is operator-facing — no
 * internal tags, no stack noise. THIS FILE MUST NEVER REFERENCE forge-ui.
 *
 * This is the rail every future engine precondition rides: add a subclass with a
 * new `code` and an operator-facing message; the forge-ui surfacing is generic.
 */
export abstract class OperatorFacingError extends Error {
  /** Brand for structural recognition across the ExecutionContext boundary. */
  readonly operatorFacing = true as const
  /** Stable, machine-readable discriminator — survives serialization. */
  abstract readonly code: string
}

/**
 * A generation precondition: the app has no crawled model in its workspace yet.
 * The operator fix is to run a crawl first. Thrown by GeneratorRunner when
 * AppModelService finds no active SQLite snapshot.
 */
export class ModelNotFoundError extends OperatorFacingError {
  readonly code = 'MODEL_NOT_FOUND'
  constructor(appName: string) {
    super(`No crawled model for '${appName}'. Run a crawl before generating tests.`)
    this.name = 'ModelNotFoundError'
  }
}

/** Structural (duck-typed) view of a model's provenance — enough to phrase the
 *  error honestly without importing the onboarding types. */
export interface EmptyModelContext {
  evidenceState?: string
  diagnostics?: Array<{ reason?: string; detail?: string; remedy?: { action?: string } }> | null
}

/**
 * A generation/verification precondition: a model FILE exists but has 0 pages,
 * 0 flows, and 0 endpoints — nothing to generate or verify FROM. Distinct from
 * ModelNotFoundError (no model file at all).
 *
 * TD-UI-031 Block 4: the message is DERIVED from the model's own evidenceState +
 * crawlDiagnostics, never asserted. The pre-Block-4 text ("onboarded but never
 * crawled") was FALSE — that state has no producer; every persisted model is a
 * crawl product. When FORGE knows WHY the crawl was empty (a diagnostic), the
 * error says so and carries the remedy; when it does not, it says that plainly.
 */
export class EmptyModelError extends OperatorFacingError {
  readonly code = 'MODEL_EMPTY'
  constructor(appName: string, ctx?: EmptyModelContext) {
    super(EmptyModelError.message(appName, ctx))
    this.name = 'EmptyModelError'
  }

  private static message(appName: string, ctx?: EmptyModelContext): string {
    if (ctx?.evidenceState === 'unsupported-platform') {
      return `FORGE cannot crawl '${appName}' — its platform is not yet supported, so no model content exists to generate or verify from.`
    }
    const base = `The crawl of '${appName}' ran but discovered no pages, flows, or endpoints — there is nothing to generate or verify from.`
    const diag = ctx?.diagnostics?.[0]
    if (diag?.detail) {
      const remedy = diag.remedy?.action ? ` Remedy: ${diag.remedy.action}` : ''
      return `${base} ${diag.detail}${remedy}`
    }
    return `${base} FORGE could not determine why the crawl came back empty.`
  }
}
