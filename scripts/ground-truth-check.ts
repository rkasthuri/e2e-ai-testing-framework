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
 * Ground-truth harness (live runner). Drives STATIC-ONLY detection (no agent phase —
 * deterministic, Ruling 3) against each fixtured reference app and grades it, keeping the
 * four outcomes DISTINCT: PASS · UNREACHABLE · STALE · MISMATCH (+ INVALID for an unfilled
 * fixture). REPORT-ONLY — always exits 0 so it never reds a build on external-site drift;
 * a MISMATCH is surfaced loudly in the summary. Run locally: `npm run ground-truth`.
 *
 * Hits LIVE external sites — NOT part of the offline `npm run test:unit` gate.
 */

import * as fs from 'fs'
import * as path from 'path'
import { Bootstrap } from '../src/core/onboarding/Bootstrap'
import {
  GroundTruthFixture, FixtureResult, gradeFixture, buildObservation, validateFixture, isStale,
} from '../src/core/ground-truth/GroundTruth'

const FIXTURE_DIR = path.resolve(process.cwd(), 'fixtures', 'ground-truth')

/** Static-only detection → the normalized observation, or null when the site is unreachable. */
async function observe(url: string): Promise<Record<string, unknown> | null> {
  try {
    const detection = await new Bootstrap().detect({ url, credentials: [], staticOnly: true })
    return buildObservation(detection)
  } catch (e: any) {
    console.warn(`  detection could not observe ${url}: ${e?.message ?? e}`)
    return null
  }
}

async function main() {
  if (!fs.existsSync(FIXTURE_DIR)) {
    console.log(`[ground-truth] no fixtures directory at ${FIXTURE_DIR} — nothing to check.`)
    process.exit(0)
  }
  const files = fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json'))
  const now = Date.now()
  const results: FixtureResult[] = []

  console.log(`[ground-truth] ${files.length} fixture(s) in ${FIXTURE_DIR}\n`)
  for (const file of files) {
    let fx: GroundTruthFixture
    try { fx = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf-8')) }
    catch (e: any) { results.push({ app: file, outcome: 'INVALID', detail: `unparseable JSON: ${e?.message}`, results: [] }); continue }

    // Cheap pre-checks first — never hit the network for an unfilled/stale fixture.
    if (validateFixture(fx).length || isStale(fx, now)) {
      results.push(gradeFixture(fx, null, now))   // grades to INVALID or STALE without observing
      continue
    }
    // Valid + fresh → observe live, then grade.
    const observation = await observe(fx.url)
    results.push(gradeFixture(fx, observation, now))
  }

  // ── Report (each outcome distinct; MISMATCH prints the disagreeing assertions) ──
  for (const r of results) {
    console.log(`${r.outcome.padEnd(11)} ${r.app} — ${r.detail}`)
    if (r.outcome === 'MISMATCH') {
      for (const a of r.results.filter(x => !x.pass)) {
        console.log(`    ✗ ${a.assertion.field} [${a.assertion.assert}] — ${a.detail}`)
        console.log(`      basis: ${a.assertion.basis}`)
      }
    }
  }

  const count = (o: string) => results.filter(r => r.outcome === o).length
  console.log(
    `\n[ground-truth] PASS ${count('PASS')} · MISMATCH ${count('MISMATCH')} · ` +
    `STALE ${count('STALE')} · UNREACHABLE ${count('UNREACHABLE')} · INVALID ${count('INVALID')}`,
  )
  console.log('[ground-truth] report-only — a MISMATCH on a FRESH, REACHABLE fixture is a detection defect; ' +
    'STALE/UNREACHABLE are not defects. Verifies detection VALUES + SIGNALS for fixtured apps only — never grades, never un-fixtured apps.')
  process.exit(0)   // report-only: never red the build
}

main().catch(e => { console.error('[ground-truth] harness error:', e); process.exit(0) })
