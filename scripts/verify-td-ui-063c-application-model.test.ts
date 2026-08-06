import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const component = read('forge-ui/src/components/application-workspace/ApplicationModel.tsx')
const types = read('forge-ui/src/components/application-workspace/applicationModelTypes.ts')
const workspace = read('forge-ui/src/components/application-workspace/ApplicationWorkspace.tsx')
const app = read('forge-ui/src/App.tsx')

test('no Application Model available is explicit and makes no structure claim', () => {
  assert.match(component, /No Application Model is available/)
  assert.match(component, /No structure is inferred/)
  assert.match(component, /state === 'unavailable'/)
})

test('current model exposes state, revision, timestamps, and currency evidence', () => {
  assert.match(component, /Model state/)
  assert.match(component, /Revision \/ identity/)
  assert.match(component, /Generated/)
  assert.match(component, /Evaluated/)
  assert.match(component, /Currency evidence/)
  assert.match(types, /currencyEvidenceIds: string\[\]/)
})

test('stale or blocked model state and observation limitations remain visible', () => {
  assert.match(types, /stale.*unavailable.*blocked.*incomplete.*integrity-limited/s)
  assert.match(component, /Coverage limitations/)
  assert.match(component, /Unobserved scope/)
  assert.match(component, /Blockers/)
})

test('model subjects distinguish direct observations from derived interpretations', () => {
  assert.match(types, /ModelSubjectBasis = 'direct-observation' \| 'derived-interpretation'/)
  assert.match(component, /Direct observation/)
  assert.match(component, /Derived interpretation/)
  assert.match(component, /Interpretation:/)
  assert.match(component, /Source observation/)
})

test('conflicting and integrity-limited evidence remain in supplied provenance and limitations', () => {
  assert.match(types, /integrity-limited/)
  assert.match(component, /incompatible contexts are not silently merged/)
  assert.match(component, /modelLimitations/)
  assert.match(component, /Evidence:/)
})

test('no item count is used as an application completeness or health KPI', () => {
  assert.match(component, /No item count is used as a completeness claim/)
  assert.doesNotMatch(component, /healthScore|health score|numeric KPI/i)
})

test('no safe recommendation is explicit', () => {
  assert.match(component, /No safe recommendation is available for the current model evidence/)
  assert.match(types, /modelRecommendation: ApplicationModelRecommendation \| null/)
})

test('Application Model is enabled at the established workspace route', () => {
  assert.match(workspace, /slug: 'model', label: 'Application Model', available: true/)
  assert.match(app, /path="\/application\/model"/)
  assert.doesNotMatch(app, /api\/.*model/i)
})
