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
 * Ground-truth fixtures — the answer key that makes FORGE's detection CORRECTNESS
 * auditable (last night's deep audit found no expected-value fixture existed anywhere).
 * A human verifies a reference app; this module holds the schema + the PURE evaluation
 * logic (fixture validation, staleness, assertion matching). The live runner
 * (scripts/ground-truth-check.ts) drives static-only detection and calls these.
 *
 * DESIGN LAWS baked in:
 *  - Every assertion carries a `basis` — WHY the value is known. An answer key without
 *    stated reasoning is itself an unverified assertion (ADR-015). validateFixture ENFORCES it.
 *  - Assert VALUES and SIGNAL COUNTS only — NEVER a derived grade (confidence/source/reason).
 *    A grade has no ground truth; asserting it would invent one.
 *  - Four outcomes, kept DISTINCT (the harness must not be under-determined about its own
 *    failures — ADR-019 axis 2 applied to the tool): PASS · UNREACHABLE · STALE · MISMATCH.
 */

/** Assertion TYPES (accepted design). Signals first, values second, grades never. */
export type AssertionType =
  | 'equals'      // exact match — stable categorical fact (renderingModel, authType)
  | 'notEquals'   // known-wrong guard — turns a known defect into a standing regression guard
  | 'oneOf'       // set membership — where several values are legitimately acceptable
  | 'atLeast'     // lower bound — counts that legitimately vary ('at least 100 links')
  | 'atMost'      // upper bound
  | 'present'     // a count > 0 / a non-null value (e.g. password field present)
  | 'absent'      // a count === 0 / a null value

export interface Assertion {
  /** dotted path into the normalized observation (see buildObservation): e.g. 'renderingModel',
   *  'authType', 'signals.rawDomAnchorCount', 'signals.passwordFieldCount'. */
  field:  string
  assert: AssertionType
  value?:  string | number | boolean   // equals / notEquals / atLeast / atMost
  values?: Array<string | number | boolean>  // oneOf
  /** REQUIRED — why this value is known (ADR-015). validateFixture rejects a blank basis. */
  basis:  string
}

export interface GroundTruthFixture {
  schemaVersion:  number
  app:            string
  url:            string
  verifiedBy:     string | null   // null in an UNFILLED template
  verifiedOn:     string | null   // ISO date; null in an UNFILLED template
  staleAfterDays: number
  expected:       Assertion[]
  notCovered?:    string[]        // what this fixture explicitly does NOT check (grades, etc.)
  notes?:         string
}

export type FixtureOutcome = 'PASS' | 'MISMATCH' | 'STALE' | 'UNREACHABLE' | 'INVALID'

export interface AssertionResult {
  assertion: Assertion
  pass:      boolean
  observed:  unknown
  detail:    string
}

export interface FixtureResult {
  app:      string
  outcome:  FixtureOutcome
  detail:   string
  results:  AssertionResult[]   // per-assertion (empty for STALE/UNREACHABLE/INVALID)
}

const REQUIRED_KEYS = ['schemaVersion', 'app', 'url', 'verifiedBy', 'verifiedOn', 'staleAfterDays', 'expected'] as const

/**
 * Structural + honesty validation. Returns [] when the fixture is complete and every
 * assertion carries a non-blank basis; otherwise the reasons it is INVALID/UNFILLED.
 */
export function validateFixture(fx: any): string[] {
  const errs: string[] = []
  if (!fx || typeof fx !== 'object') return ['fixture is not an object']
  for (const k of REQUIRED_KEYS) {
    if (fx[k] === undefined) errs.push(`missing required field '${k}'`)
  }
  if (fx.verifiedBy == null) errs.push("UNFILLED: 'verifiedBy' is null — a human must own the answer key")
  if (fx.verifiedOn == null) errs.push("UNFILLED: 'verifiedOn' is null — no verification date")
  if (!Array.isArray(fx.expected)) {
    errs.push("'expected' must be an array")
  } else if (fx.expected.length === 0) {
    errs.push('UNFILLED: no assertions — expected[] is empty')
  } else {
    fx.expected.forEach((a: any, i: number) => {
      if (!a || typeof a !== 'object') { errs.push(`expected[${i}] is not an object`); return }
      if (!a.field) errs.push(`expected[${i}] missing 'field'`)
      if (!a.assert) errs.push(`expected[${i}] missing 'assert'`)
      if (typeof a.basis !== 'string' || a.basis.trim() === '') {
        errs.push(`expected[${i}] (${a.field ?? '?'}) missing required 'basis' — an answer key without stated reasoning is an unverified assertion (ADR-015)`)
      }
      const needsValue = ['equals', 'notEquals', 'atLeast', 'atMost'].includes(a.assert)
      if (needsValue && a.value === undefined) errs.push(`expected[${i}] (${a.assert}) missing 'value'`)
      if (a.assert === 'oneOf' && (!Array.isArray(a.values) || a.values.length === 0)) errs.push(`expected[${i}] (oneOf) missing non-empty 'values'`)
    })
  }
  return errs
}

/** STALE = verified past its horizon (or an unparseable date — treat as needing re-verification). */
export function isStale(fx: GroundTruthFixture, nowMs: number): boolean {
  if (!fx.verifiedOn) return true
  const verified = Date.parse(fx.verifiedOn)
  if (Number.isNaN(verified)) return true
  return nowMs - verified > fx.staleAfterDays * 86_400_000
}

/** Walk a dotted path; undefined when any segment is missing. */
export function resolvePath(obj: any, path: string): unknown {
  return path.split('.').reduce<any>((o, seg) => (o == null ? undefined : o[seg]), obj)
}

/** PURE per-assertion match. present/absent read a count as >0 / ===0 (or non-null / null). */
export function evaluateAssertion(a: Assertion, observed: unknown): AssertionResult {
  const r = (pass: boolean, detail: string): AssertionResult => ({ assertion: a, pass, observed, detail })
  const num = typeof observed === 'number' ? observed : null

  switch (a.assert) {
    case 'equals':
      return r(observed === a.value, `expected === ${JSON.stringify(a.value)}, observed ${JSON.stringify(observed)}`)
    case 'notEquals':
      return r(observed !== a.value, `expected !== ${JSON.stringify(a.value)}, observed ${JSON.stringify(observed)}`)
    case 'oneOf':
      return r((a.values ?? []).includes(observed as any), `expected one of ${JSON.stringify(a.values)}, observed ${JSON.stringify(observed)}`)
    case 'atLeast':
      return num === null ? r(false, `atLeast needs a number; observed ${JSON.stringify(observed)} (unmeasured?)`)
                          : r(num >= Number(a.value), `expected >= ${a.value}, observed ${num}`)
    case 'atMost':
      return num === null ? r(false, `atMost needs a number; observed ${JSON.stringify(observed)} (unmeasured?)`)
                          : r(num <= Number(a.value), `expected <= ${a.value}, observed ${num}`)
    case 'present':
      return r(num !== null ? num > 0 : (observed !== null && observed !== undefined), `expected present, observed ${JSON.stringify(observed)}`)
    case 'absent':
      return r(num !== null ? num === 0 : (observed === null || observed === undefined), `expected absent, observed ${JSON.stringify(observed)}`)
    default:
      return r(false, `unknown assertion type '${(a as any).assert}'`)
  }
}

/**
 * Normalize a Bootstrap detection into the flat shape fixtures assert against:
 *   renderingModel/authType/crawlStrategy/appName/baseUrl/loginUrl = the VALUES;
 *   signals.* = the union of every field's structured signals (Ruling 1).
 * (appType is absent by ruling 2026-07-21 — the platform is a structural fact, never observed.)
 * Grades (confidence/source/reason) are deliberately NOT surfaced — they are never assertable.
 */
export function buildObservation(detection: any): Record<string, unknown> {
  const val = (f: any) => f?.value
  return {
    // appType is NOT here (ruling 2026-07-21): a STRUCTURAL FACT WAS NEVER AN OBSERVATION —
    // it leaves the answer-key because it never belonged, not because a detector stopped emitting
    // it. renderingModel replaces it: it IS an observation (measured, graded, blind spot declared).
    renderingModel: val(detection.renderingModel),
    authType:      val(detection.authType),
    crawlStrategy: val(detection.crawlStrategy),
    appName:       val(detection.appName),
    baseUrl:       val(detection.baseUrl),
    loginUrl:      val(detection.loginUrl),
    signals: {
      ...(detection.renderingModel?.signals ?? {}),
      ...(detection.authType?.signals ?? {}),
      ...(detection.crawlStrategy?.signals ?? {}),
    },
  }
}

/**
 * Grade one fixture against an observation. `observation` is null when detection could not
 * run (site unreachable). The four outcomes are kept DISTINCT — never collapsed into "FAIL".
 */
export function gradeFixture(
  fx: GroundTruthFixture,
  observation: Record<string, unknown> | null,
  nowMs: number,
): FixtureResult {
  const invalid = validateFixture(fx)
  if (invalid.length) return { app: fx?.app ?? '(unknown)', outcome: 'INVALID', detail: invalid.join('; '), results: [] }
  if (isStale(fx, nowMs)) return { app: fx.app, outcome: 'STALE', detail: `verifiedOn ${fx.verifiedOn} is past the ${fx.staleAfterDays}-day horizon — re-verify before trusting`, results: [] }
  if (observation === null) return { app: fx.app, outcome: 'UNREACHABLE', detail: 'detection could not observe the site (navigation/network failure)', results: [] }

  const results = fx.expected.map(a => evaluateAssertion(a, resolvePath(observation, a.field)))
  const failed = results.filter(r => !r.pass)
  return failed.length
    ? { app: fx.app, outcome: 'MISMATCH', detail: `${failed.length}/${results.length} assertion(s) disagree with the fixture`, results }
    : { app: fx.app, outcome: 'PASS', detail: `${results.length}/${results.length} assertion(s) agree`, results }
}
