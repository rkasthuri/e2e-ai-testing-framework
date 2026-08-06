import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const adapter = read('forge-ui/src/components/application-workspace/applicationOverviewAdapter.ts')
const view = read('forge-ui/src/components/application-workspace/ApplicationOverview.tsx')
const shell = read('forge-ui/src/components/application-workspace/ApplicationWorkspace.tsx')
const route = read('forge-ui/server/routes/projects.ts')
const apiTypes = read('forge-ui/src/api/types.ts')

test('persisted identity is high within its boundary and explicitly does not imply understanding', () => {
  assert.match(adapter, /key: 'identity'[\s\S]*state: hasDetectionEvidence \? 'high' : 'unknown'/)
  assert.match(adapter, /Project identity, URL, application kind, and observation boundary come from persisted onboarding data/)
  assert.match(adapter, /This does not establish application behavior or structure/)
  assert.doesNotMatch(view, /identity.*Low/i)
})

test('freshness remains unevaluated without an approved policy', () => {
  assert.match(adapter, /freshness: 'unknown'/)
  assert.doesNotMatch(adapter, /freshness: 'current'/)
  assert.match(adapter, /no approved freshness policy is available/)
  assert.match(view, /unknown: 'Not evaluated'/)
  assert.match(view, /Freshness: \{freshnessLabel\[evidence\.freshness\]\}/)
})

test('API and adapter preserve capture metadata and specific provenance sources', () => {
  assert.match(apiTypes, /capturedAt\?:\s+string/)
  assert.match(apiTypes, /runId\?:\s+string/)
  assert.match(route, /capturedAt:\s+bootstrapManifest\?\.timestamp/)
  assert.match(route, /runId:\s+bootstrapManifest\?\.runId/)
  for (const source of ['password-field-count', 'StrategyDetector', 'user-supplied']) {
    assert.match(adapter, new RegExp(source))
  }
})

test('qualitative evidence confidence always has a reason and weak auth evidence is downgraded', () => {
  assert.match(adapter, /field\.source === 'password-field-count' && field\.confidence === 'high'\) return 'low'/)
  assert.match(adapter, /confidenceReason: explanation/)
  assert.match(view, /Confidence: \{evidence\.confidence\}\. Reason: \{evidence\.confidenceReason\}/)
  assert.match(adapter, /does not verify authentication behavior/)
})

test('the Overview route renders exactly one page-level heading', () => {
  const h1Count = (shell.match(/<h1\b/g) ?? []).length + (view.match(/<h1\b/g) ?? []).length
  assert.equal(h1Count, 1)
  assert.match(view, /<h2 id="application-identity"/)
  assert.match(view, /aria-labelledby="application-identity"/)
})

test('timestamps are readable while preserving the exact ISO value', () => {
  assert.match(view, /Intl\.DateTimeFormat/)
  assert.match(view, /dateTime=\{evidence\.capturedAt\}/)
  assert.match(view, /title=\{evidence\.capturedAt\}/)
  assert.match(view, /dateTime=\{readModel\.asOf\}/)
  assert.match(adapter, /asOf: latestObservation\?\.completedAt \|\| detection\.capturedAt/)
})

test('recommendation navigation and fail-closed unknown states remain intact', () => {
  assert.match(adapter, /\/crawl\?project=\$\{encodeURIComponent\(project\.appName\)\}/)
  assert.match(adapter, /Application behavior has not been observed/)
  assert.match(adapter, /No completed observation establishes coverage/)
  assert.match(adapter, /missing-onboarding-evidence/)
  assert.doesNotMatch(view, /workspacePath|password|credential/i)
})
