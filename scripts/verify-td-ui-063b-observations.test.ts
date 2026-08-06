import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const component = read('forge-ui/src/components/application-workspace/ApplicationObservations.tsx')
const types = read('forge-ui/src/components/application-workspace/observationsTypes.ts')
const workspace = read('forge-ui/src/components/application-workspace/ApplicationWorkspace.tsx')
const app = read('forge-ui/src/App.tsx')

test('no observations yet is explicit and does not imply healthy completeness', () => {
  assert.match(component, /No observations yet/)
  assert.match(component, /coverage, and completeness remain unknown/)
})

test('current successful observation shows identity, context, timestamps, scope, and evidence', () => {
  assert.match(component, /Current observation/)
  assert.match(component, /Started/)
  assert.match(component, /Completed/)
  assert.match(component, /Context/)
  assert.match(component, /Observed scope/)
  assert.match(component, /Evidence/)
  assert.match(types, /startedAt: string \| null/)
})

test('multiple observations distinguish current from historical observations', () => {
  assert.match(component, /Historical observation/)
  assert.match(component, /observation\.isCurrent/)
  assert.match(component, /Observation history/)
  assert.match(component, /history\.map/)
})

test('blocked authentication/access observations keep blockers and unobserved scope visible', () => {
  assert.match(types, /blocked/)
  assert.match(component, /Blockers/)
  assert.match(component, /Unobserved scope/)
  assert.match(component, /prevents a stronger state/i)
})

test('stale, failed, incomplete, conflicting, and integrity-failed evidence states remain visible', () => {
  assert.match(types, /stale.*failed.*blocked.*incomplete/s)
  assert.match(types, /evidenceStates: OverviewEvidenceState\[\]/)
  assert.match(component, /States:/)
  assert.match(component, /Limitations/)
})

test('unknowns and explainability remain visible without domain reconstruction', () => {
  assert.match(component, /Unknowns/)
  assert.match(component, /Why this state/)
  assert.match(component, /Prevents a stronger state/)
  assert.doesNotMatch(component, /healthScore|health score|numeric KPI/i)
})

test('no safe recommendation is explicit', () => {
  assert.match(component, /No safe recommendation is available for this observation/)
  assert.match(types, /safeRecommendation: .*null/s)
})

test('Observations is enabled in the existing workspace and has a stable route', () => {
  assert.match(workspace, /slug: 'observations', label: 'Observations', available: true/)
  assert.match(app, /path="\/application\/observations"/)
  assert.doesNotMatch(app, /api\/.*observ/i)
})
