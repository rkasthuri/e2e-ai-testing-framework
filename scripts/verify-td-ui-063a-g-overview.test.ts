import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const adapter = read('forge-ui/src/components/application-workspace/applicationOverviewAdapter.ts')
const page = read('forge-ui/src/pages/ApplicationWorkspacePage.tsx')
const hook = read('forge-ui/src/hooks/useApi.ts')
const route = read('forge-ui/server/routes/projects.ts')
const view = read('forge-ui/src/components/application-workspace/ApplicationOverview.tsx')

test('Overview consumes the selected project read endpoint and typed adapter', () => {
  assert.match(hook, /GET \/api\/v1\/projects\/:appName/)
  assert.match(hook, /apiClient\.get<\{ project: Project; detection: Detection; latestObservation: ObservationRecord \| null \}>/)
  assert.match(page, /useCurrentProject\(\)/)
  assert.match(page, /useProject\(selectedProject\)/)
  assert.match(page, /buildApplicationOverviewReadModel\(projectQuery\.data\.project, projectQuery\.data\.detection, projectQuery\.data\.latestObservation\)/)
  assert.match(route, /router\.get\('\/:appName'/)
})

test('Adapter preserves onboarding-only evidence without fabricating observation claims', () => {
  assert.match(adapter, /Onboarding detection/)
  assert.match(adapter, /Onboarded — awaiting observation/)
  assert.match(adapter, /application behavior, structure, and coverage remain unobserved/)
  assert.match(adapter, /freshness: 'unknown'/)
  assert.match(adapter, /confidence = hasDetectionEvidence \? 'low'/)
  assert.match(adapter, /state: hasObservationEvidence \? 'Observation-backed model available' : hasObservationRecord \? 'Observation produced no model evidence' : 'Not yet observed'/)
  assert.match(adapter, /application model claim is derived from onboarding data/)
})

test('Overview exposes identity, URL, confidence limits, unknowns, and safe next step', () => {
  assert.match(view, /Project identity/)
  assert.match(view, /Application URL/)
  assert.match(view, /Truth Confidence/)
  assert.match(view, /Material unknowns/)
  assert.match(view, /Recommended next action/)
  assert.match(page, /Application data unavailable/)
})

test('Missing project and backend errors remain explicit', () => {
  assert.match(page, /No application selected/)
  assert.match(page, /projectQuery\.isError/)
  assert.match(page, /role="alert"/)
  assert.match(route, /Project not found/)
})

test('Actionable recommendations preserve and safely encode selected-project context', () => {
  assert.match(adapter, /href: `\/crawl\?project=\$\{encodeURIComponent\(project\.appName\)\}`/)
  assert.doesNotMatch(adapter, /project=saucedemo/)
  assert.equal(`/crawl?project=${encodeURIComponent('project name/a')}`, '/crawl?project=project%20name%2Fa')
  assert.match(view, /import \{ Link \} from 'react-router-dom'/)
  assert.match(view, /to=\{item\.destination\.href\}/)
})

test('router links support pointer and keyboard activation with visible interaction states', () => {
  assert.match(view, /<Link/)
  assert.match(view, /aria-label=/)
  assert.match(view, /hover:border-brand/)
  assert.match(view, /focus-visible:ring-2/)
})

test('recommendations without supported destinations are explicitly informational', () => {
  assert.match(view, /item\.destination\?\.kind === 'internal-route'/)
  assert.match(view, />Informational</)
  assert.match(view, /No supported action destination is available/)
})
