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
 * TD-UI-069A-C — pure, deterministic evidence-backed execution preflight.
 *
 * Preflight answers one bounded question: given the current, authoritative
 * evidence-backed test-set revision, can FORGE safely begin controlled
 * execution of the selected definitions right now? It never executes a test,
 * never mints an execution identity, acquires an execution lock, or persists
 * anything — it re-verifies facts that already exist elsewhere
 * (TestDefinitionContract's runnerCompatibility, the
 * design_evidence_backed_tests readiness decision, and non-secret
 * credential-reference availability) and never promotes or re-derives them.
 */

export type ExecutionPreflightState =
  | 'malformed_request'
  | 'integrity_failure'
  | 'conflicting_provenance'
  | 'stale_or_unknown_inputs'
  | 'incompatible_definition'
  | 'runner_unavailable'
  | 'credentials_unavailable'
  | 'unsupported'
  | 'blocked'
  | 'ready'

export const EXECUTION_PREFLIGHT_STATES: readonly ExecutionPreflightState[] = [
  'malformed_request', 'integrity_failure', 'conflicting_provenance', 'stale_or_unknown_inputs',
  'incompatible_definition', 'runner_unavailable', 'credentials_unavailable', 'unsupported',
  'blocked', 'ready',
] as const

// Worst-first precedence, used both to select one definition's state and to
// fold per-definition states into the aggregate (ADR-018 weakest-truth).
const SEVERITY = EXECUTION_PREFLIGHT_STATES
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/

/**
 * TD-UI-069C-C-R: `runnerCompatibility` here is the LIVE verdict from
 * DefinitionCompatibilityEvaluator (via ExecutionContext), never the
 * definition's own possibly-stale stored field — the controller re-evaluates
 * it before this input is built.
 */
export interface PreflightDefinitionInput {
  id: string
  title: string
  provenance: { sourceObservationId: string; modelRowId: number; modelVersion: string; supportingEvidenceIds: string[] }
  runnerCompatibility: { state: 'compatible'; explanation: string } | { state: 'blocked'; reason?: string; explanation: string }
  steps: Array<{ kind: string }>
  oracle: { kind: string }
}

export interface ExecutionPreflightInput {
  project: { id: string; name: string }
  requested: { definitionIds: string[]; revision: number | null }
  currentRevision: {
    revision: number
    testSetId: string
    contentHash: string
    definitions: PreflightDefinitionInput[]
  } | null
  designReadiness: {
    state: 'supported' | 'supported_with_constraints' | 'blocked' | 'unknown'
    explanation: string
    blockers: string[]
    unknowns: string[]
  }
  runnerAdapter: { id: string; version: string; available: boolean; explanation: string }
  credentials: {
    expectation: string
    availability: 'available' | 'missing' | 'not_required' | 'unknown'
  }
}

export interface DefinitionPreflightResult {
  definitionId: string
  title: string
  state: ExecutionPreflightState
  explanation: string
  blockers: string[]
  materialUnknowns: string[]
  provenance: PreflightDefinitionInput['provenance'] | null
}

export type ExecutionPreflightPresentation =
  | { kind: 'ok'; value: ReturnType<typeof buildReadModel> }
  | { kind: 'malformed' }

const LIMITATIONS = [
  'Preflight is a read-only re-verification. It does not execute a test, mint an execution identity, acquire an execution lock, or persist anything.',
  'A valid, current-support test definition is not itself an executable, passing, or comprehensive test.',
  'Runner availability does not establish that a definition is compatible, and definition compatibility does not establish runner availability.',
  'Credential availability does not establish that authentication will succeed.',
]

function worse(a: ExecutionPreflightState, b: ExecutionPreflightState): ExecutionPreflightState {
  return SEVERITY.indexOf(a) <= SEVERITY.indexOf(b) ? a : b
}

function projectHref(projectId: string, path: string): string {
  return `${path}?${new URLSearchParams({ project: projectId }).toString()}`
}

function validateInput(input: ExecutionPreflightInput): boolean {
  if (!SAFE_ID.test(input.project.id) || typeof input.project.name !== 'string' || input.project.name.length < 1) return false
  // TD-UI-069A-C-R: an explicitly empty selection is invalid input — it is
  // rejected here (and, for real requests, earlier still by the controller
  // before any authority read) rather than evaluated as a vacuous "all
  // selected definitions are ready."
  if (!Array.isArray(input.requested.definitionIds) || input.requested.definitionIds.length === 0 || input.requested.definitionIds.length > 50) return false
  if (input.requested.definitionIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id))) return false
  if (input.requested.revision !== null && (!Number.isSafeInteger(input.requested.revision) || input.requested.revision < 1)) return false
  if (!['supported', 'supported_with_constraints', 'blocked', 'unknown'].includes(input.designReadiness.state)) return false
  if (!['available', 'missing', 'not_required', 'unknown'].includes(input.credentials.availability)) return false
  if (typeof input.runnerAdapter.id !== 'string' || typeof input.runnerAdapter.available !== 'boolean') return false
  if (input.currentRevision) {
    const revision = input.currentRevision
    if (!Number.isSafeInteger(revision.revision) || revision.revision < 1) return false
    if (!SAFE_ID.test(revision.testSetId) || typeof revision.contentHash !== 'string') return false
    if (revision.definitions.length > 50) return false
    if (new Set(revision.definitions.map(d => d.id)).size !== revision.definitions.length) return false
    for (const def of revision.definitions) {
      if (!SAFE_ID.test(def.id) || !['compatible', 'blocked'].includes(def.runnerCompatibility.state)) return false
    }
  }
  return true
}

function definitionState(
  definition: PreflightDefinitionInput,
  runnerAdapter: ExecutionPreflightInput['runnerAdapter'],
  credentials: ExecutionPreflightInput['credentials'],
): DefinitionPreflightResult {
  let state: ExecutionPreflightState
  const blockers: string[] = []

  // TD-UI-069C-C-R: definition.runnerCompatibility is now the LIVE verdict
  // from the single shared DefinitionCompatibilityEvaluator (via the
  // controller), which already establishes step/oracle-kind support as part
  // of intrinsic compatibility. A separate local support check here would be
  // a second, redundant compatibility evaluator — removed. `unsupported`
  // remains in the state vocabulary for a genuine future runner-adapter
  // capability gap (an adapter that supports less than what the shared
  // evaluator considers intrinsically compatible), not currently reachable
  // with a single adapter whose capability set already matches the
  // evaluator's.
  if (definition.runnerCompatibility.state === 'blocked') {
    state = 'incompatible_definition'
    blockers.push(definition.runnerCompatibility.explanation)
  } else if (!runnerAdapter.available) {
    state = 'runner_unavailable'
    blockers.push(runnerAdapter.explanation)
  } else if (credentials.availability === 'missing') {
    state = 'credentials_unavailable'
    blockers.push('Authentication is expected for this project and its credential reference does not currently resolve.')
  } else {
    state = 'ready'
  }

  const explanation = state === 'incompatible_definition'
    ? definition.runnerCompatibility.explanation
    : state === 'runner_unavailable'
      ? runnerAdapter.explanation
      : state === 'credentials_unavailable'
        ? 'Authentication is expected and the credential reference is not currently resolvable.'
        : 'The definition, runner adapter, and credential-reference availability were all established as compatible. Execution has not been implemented.'

  return {
    definitionId: definition.id,
    title: definition.title,
    state,
    explanation,
    blockers,
    materialUnknowns: [],
    provenance: definition.provenance,
  }
}

function finalize(
  input: ExecutionPreflightInput,
  state: ExecutionPreflightState,
  explanation: string,
  blockers: string[],
  materialUnknowns: string[],
  preventedStrongerState: string,
  safeRecommendation: { label: string; explanation: string; href: string } | null,
  definitions: DefinitionPreflightResult[],
) {
  const current = input.currentRevision
  return {
    project: input.project,
    testSetRevision: current
      ? {
          revision: current.revision,
          testSetId: current.testSetId,
          contentHash: current.contentHash,
          isCurrent: input.requested.revision === null || input.requested.revision === current.revision,
        }
      : null,
    runnerAdapter: input.runnerAdapter,
    credentials: { ...input.credentials, note: 'Credential availability does not establish that authentication will succeed.' },
    definitions,
    aggregate: {
      state, explanation, blockers, materialUnknowns,
      limitations: LIMITATIONS,
      preventedStrongerState,
      safeRecommendation,
    },
    requested: input.requested,
    executionOccurred: false as const,
    provenance: {
      sources: ['test_definition_authority', 'application_readiness_projection'] as const,
      explanation: 'Preflight re-reads existing authorities on demand and persists nothing.',
    },
    limitations: LIMITATIONS,
  }
}

function buildReadModel(input: ExecutionPreflightInput) {
  const requestedIds = input.requested.definitionIds
  const current = input.currentRevision

  if (!current) {
    return finalize(input, 'stale_or_unknown_inputs',
      'No evidence-backed test-set revision has been persisted for this project.',
      [], ['A current test-set revision is required before execution preflight can be evaluated.'],
      'A generated, current test-set revision with at least one definition is required.',
      { label: 'Open Tests', explanation: 'Review or generate evidence-backed test definitions.', href: projectHref(input.project.id, '/tests') },
      [])
  }

  if (input.requested.revision !== null && input.requested.revision !== current.revision) {
    return finalize(input, 'stale_or_unknown_inputs',
      `The requested revision ${input.requested.revision} is not the current revision (${current.revision}). Only the current test-set revision may be considered for execution.`,
      [], ['Historical revisions remain visible but are not executable.'],
      'A request against the current revision is required.',
      { label: 'Reload current revision', explanation: 'Refresh to evaluate the current revision.', href: projectHref(input.project.id, '/run') },
      [])
  }

  const known = new Map(current.definitions.map(d => [d.id, d]))
  const unknownIds = requestedIds.filter(id => !known.has(id))
  if (unknownIds.length > 0) {
    return finalize(input, 'stale_or_unknown_inputs',
      'One or more requested definitions are not part of the current test-set revision.',
      [], [`Unresolved definition identities: ${unknownIds.join(', ')}`],
      'Every requested definition must belong to the current revision.',
      { label: 'Review current definitions', explanation: 'Reload the current revision and reselect.', href: projectHref(input.project.id, '/tests') },
      [])
  }

  if (input.designReadiness.state === 'blocked') {
    return finalize(input, 'conflicting_provenance',
      'The current model or current-support evidence has an established validation, integrity, or conflict state that prevents execution.',
      input.designReadiness.blockers, input.designReadiness.unknowns,
      'Model and current-support evidence integrity and agreement must be established.',
      { label: 'Review readiness', explanation: 'Inspect the design-evidence-backed-tests decision.', href: projectHref(input.project.id, '/application/readiness') },
      [])
  }
  if (input.designReadiness.state === 'unknown') {
    return finalize(input, 'stale_or_unknown_inputs',
      'The current model or current-support evidence linkage cannot be safely re-verified.',
      [], input.designReadiness.unknowns,
      'Exact, inspected current-support evidence and model linkage are required.',
      { label: 'Review readiness', explanation: 'Inspect the design-evidence-backed-tests decision.', href: projectHref(input.project.id, '/application/readiness') },
      [])
  }

  const definitions = requestedIds.map(id => definitionState(known.get(id)!, input.runnerAdapter, input.credentials))
  const aggregateState = definitions.reduce<ExecutionPreflightState>((worstSoFar, d) => worse(worstSoFar, d.state), 'ready')
  const blockers = [...new Set(definitions.flatMap(d => d.blockers))]
  const unknowns = [...new Set(definitions.flatMap(d => d.materialUnknowns))]

  return finalize(input, aggregateState,
    aggregateState === 'ready'
      ? 'Every selected definition, the runner adapter, and credential-reference availability were established as compatible.'
      : 'At least one selected definition is not currently executable.',
    blockers, unknowns,
    aggregateState === 'ready'
      ? 'None — every selected definition is currently executable.'
      : 'Every selected definition must independently reach a ready state.',
    aggregateState === 'ready' ? null : { label: 'Review Tests', explanation: 'The Tests workflow owns definition compatibility and generation.', href: projectHref(input.project.id, '/tests') },
    definitions)
}

/**
 * The presenter is the sole decision-policy owner for execution preflight.
 * Inputs are already presentation-safe but are revalidated so an authority
 * mismatch cannot turn into a plausible readiness claim.
 */
export function presentExecutionPreflight(input: ExecutionPreflightInput): ExecutionPreflightPresentation {
  if (!validateInput(input)) return { kind: 'malformed' }
  return { kind: 'ok', value: buildReadModel(input) }
}
