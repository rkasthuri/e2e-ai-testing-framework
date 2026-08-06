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

test('no observation history is explicit and does not imply application truth', () => {
  assert.match(component, /No observation history/)
  assert.match(component, /no application conclusion is presented/i)
})

test('latest observation shows identity, context, semantic timestamps, scope, and evidence', () => {
  assert.match(component, /observation\.position === 'latest' \? 'Latest' : 'Historical'/)
  assert.match(component, /Started/)
  assert.match(component, /Completed/)
  assert.match(component, /Context/)
  assert.match(component, /Observed subjects/)
  assert.match(component, /Evidence records/)
  assert.match(component, /<time dateTime=\{value\} title=\{value\}>/)
  assert.match(types, /startedAt: string/)
})

test('multiple observations distinguish latest position from historical position', () => {
  assert.match(component, /observation\.position === 'latest' \? 'Latest' : 'Historical'/)
  assert.match(component, /observation\.position === 'latest'/)
  assert.match(component, /Latest describes ordering only/)
  assert.match(component, /observations\.map/)
})

test('blocked authentication/access observations keep blockers and unobserved scope visible', () => {
  assert.match(component, /blocked/)
  assert.match(component, /Blockers/)
  assert.match(component, /Unobserved scope/)
  assert.match(component, /Authentication outcome/)
})

test('terminal outcomes, unknown freshness, and evidence integrity remain independent', () => {
  assert.match(component, /completed.*partially_completed.*blocked.*failed.*unknown.*interrupted/s)
  assert.match(types, /state: 'not_evaluated'/)
  assert.match(types, /integrity: 'valid' \| 'failed' \| 'unknown'/)
  assert.match(component, /Freshness/)
  assert.match(component, /Not evaluated/)
  assert.match(component, /Integrity:/)
})

test('unknowns and explainability remain visible without domain reconstruction', () => {
  assert.match(component, /Unknowns/)
  assert.match(component, /Terminal outcome explanation/)
  assert.doesNotMatch(component, /healthScore|health score|numeric KPI/i)
})

test('no safe recommendation is explicit', () => {
  assert.match(component, /No safe recommendation is available for this observation/)
  assert.match(types, /safeRecommendation: .*null/s)
})

test('Observations is enabled in the existing workspace and has a stable route', () => {
  assert.match(workspace, /slug: 'observations', label: 'Observations', available: true/)
  assert.match(app, /path="\/application\/observations"/)
})
