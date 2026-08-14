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
 * TD-UI-069C-C-R — the single, shared owner of definition-compatibility
 * truth. Before this module existed, three places independently decided
 * whether a definition was executable: TestDefinitionContract's generator
 * (which only ever stamped the literal 'blocked'), ExecutionProjectionService
 * (the real, evidence-based evaluator), and ExecutionPreflightPresenter
 * (which read the generator's stale stamped field as its own gate). This
 * module is deliberately standalone — it imports nothing from
 * test-design/ or elsewhere in execution/ — so both
 * `src/core/test-design/TestDefinitionContract.ts` (generation time) and
 * `src/core/execution/ExecutionProjectionService.ts` (live re-verification
 * time) can depend on it without creating a cycle.
 *
 * Scope is deliberately narrow: INTRINSIC compatibility only — what is
 * knowable from the definition's own steps/oracle/authentication-setup
 * shape, independent of whether the definition is still current or whether a
 * runner/credential is available right now. Currency (stale_definition,
 * conflicting_evidence against a live authority) is layered on top by
 * ExecutionProjectionService, which has access to that live authority; this
 * evaluator does not and must not — a definition cannot know, from itself
 * alone, whether it is still "the current revision."
 */

export type ProjectionFailureCode =
  | 'unsupported_action'
  | 'unresolved_selector'
  | 'missing_oracle'
  | 'missing_auth_setup'
  | 'authentication_unknown'
  | 'authentication_conflicted'
  | 'legacy_provenance_unsupported'
  | 'support_seal_mismatch'
  | 'route_unknown'
  | 'route_conflicted'
  | 'conflicting_evidence'
  | 'stale_definition'
  | 'projection_failure'

/** Runtime-checkable mirror of ProjectionFailureCode, for validators that
 *  cannot check a type at runtime. Single source alongside the type above. */
export const PROJECTION_FAILURE_CODES: readonly ProjectionFailureCode[] = [
  'unsupported_action', 'unresolved_selector', 'missing_oracle',
  'missing_auth_setup', 'authentication_unknown', 'authentication_conflicted',
  'legacy_provenance_unsupported', 'support_seal_mismatch', 'route_unknown', 'route_conflicted',
  'conflicting_evidence', 'stale_definition', 'projection_failure',
]

export type CompatibilityResult =
  | { state: 'compatible'; explanation: string }
  | { state: 'blocked'; reason: ProjectionFailureCode; explanation: string }

export interface CompatibilityIntrinsicInput {
  steps: Array<{ kind: string; subjectId: string }>
  oracle: { kind: string; subjectId: string }
  /** undefined = predates structured authentication-setup carrying (TD-UI-069C-C). */
  authenticationRequired: boolean | undefined
  authenticationSetup?: { mechanism: string } | undefined
  /** V2 semantic expectation. Credential availability is intentionally absent. */
  authenticationExpectation?: {
    state: 'required' | 'not_required' | 'unknown' | 'conflicted'
    mechanism: string | null
  }
}

export const SUPPORTED_STEP_KINDS = new Set(['navigate_to_observed_route'])
export const SUPPORTED_ORACLE_KINDS = new Set(['subject_observable'])
/**
 * The only authentication mechanism any part of FORGE actually implements
 * today (AuthManager's form-fill flow). Deliberately narrow: SSO/OIDC-style
 * mechanisms are not supported anywhere in the engine (TD-144), so a
 * definition naming one would still be genuinely inexecutable even with a
 * structurally complete setup.
 */
export const SUPPORTED_AUTH_MECHANISMS = new Set(['form-login'])

function blocked(reason: ProjectionFailureCode, explanation: string): CompatibilityResult {
  return { state: 'blocked', reason, explanation }
}

/**
 * Pure, deterministic, no I/O. Same input always yields the same verdict —
 * this is what both the generator (at stamp time) and
 * ExecutionProjectionService (at live re-verification time) call; neither
 * independently re-implements this logic.
 */
export function evaluateIntrinsicCompatibility(input: CompatibilityIntrinsicInput): CompatibilityResult {
  if (!Array.isArray(input.steps) || input.steps.length !== 1) {
    return blocked('unsupported_action', 'This definition does not have the exactly-one-step shape supported by the current executor mapping.')
  }
  const step = input.steps[0]
  if (!step || !SUPPORTED_STEP_KINDS.has(step.kind)) {
    return blocked('unsupported_action', `No executor mapping exists for step kind "${step?.kind ?? 'undefined'}".`)
  }

  if (!SUPPORTED_ORACLE_KINDS.has(input.oracle.kind) || input.oracle.subjectId !== step.subjectId) {
    return blocked('missing_oracle', `No executor mapping exists for oracle kind "${input.oracle.kind}", or the oracle does not resolve against this plan's step.`)
  }

  // Reserved for a future selector-dependent step/oracle kind (TD-UI-069C-A
  // §3). No such kind exists in SUPPORTED_STEP_KINDS/SUPPORTED_ORACLE_KINDS
  // today, so 'unresolved_selector' is currently unreachable — kept in the
  // vocabulary so the capability gap is mapped before it exists (ADR-016).

  if (input.authenticationExpectation) {
    if (input.authenticationExpectation.state === 'unknown') {
      return blocked('authentication_unknown', 'Authentication expectation is unknown; executability cannot be asserted.')
    }
    if (input.authenticationExpectation.state === 'conflicted') {
      return blocked('authentication_conflicted', 'Governed authentication expectation bases conflict; executability cannot be asserted.')
    }
    if (input.authenticationExpectation.state === 'required') {
      const mechanism = input.authenticationExpectation.mechanism
      if (!mechanism || !SUPPORTED_AUTH_MECHANISMS.has(mechanism)) {
        return blocked('missing_auth_setup', `The required authentication mechanism "${mechanism ?? 'unknown'}" is not currently supported for execution.`)
      }
    } else if (input.authenticationExpectation.mechanism !== null) {
      return blocked('missing_auth_setup', 'Authentication marked not required cannot name an authentication mechanism.')
    }
  } else if (input.authenticationRequired === undefined) {
    return blocked('missing_auth_setup', 'This definition predates structured authentication-setup carrying and cannot be evaluated as compatible.')
  } else if (input.authenticationRequired) {
    if (!input.authenticationSetup) {
      return blocked('missing_auth_setup', 'Authentication is required for this definition and no structured, evidence-backed setup was established at generation time.')
    }
    if (!SUPPORTED_AUTH_MECHANISMS.has(input.authenticationSetup.mechanism)) {
      return blocked('missing_auth_setup', `The authentication mechanism "${input.authenticationSetup.mechanism}" is not currently supported for execution.`)
    }
  }

  return { state: 'compatible', explanation: 'The definition\'s steps, oracle, and authentication setup are all supported.' }
}
