import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const component = read('forge-ui/src/components/application-workspace/ApplicationEvidence.tsx')
const types = read('forge-ui/src/components/application-workspace/evidenceTypes.ts')
const workspace = read('forge-ui/src/components/application-workspace/ApplicationWorkspace.tsx')
const app = read('forge-ui/src/App.tsx')

test('empty evidence ledger is explicit and does not imply sufficiency or completeness', () => {
  assert.match(component, /No evidence is available/)
  assert.match(component, /Evidence existence is not evidence sufficiency/)
  assert.match(component, /No current understanding or completeness claim is inferred/)
})

test('current verified evidence shows identity, source, subject, observation, timestamps, and integrity', () => {
  assert.match(component, /Evidence ledger/)
  assert.match(component, /Subject/)
  assert.match(component, /Source \/ run/)
  assert.match(component, /Captured \/ observed/)
  assert.match(component, /Verified/)
  assert.match(types, /observationSummary: string/)
})

test('historical and stale evidence remain visible with simple filtering', () => {
  assert.match(types, /stale.*expired.*unavailable.*superseded/s)
  assert.match(component, /Historical \/ limited/)
  assert.match(component, /freshness !== 'current'/)
  assert.match(component, /Freshness:/)
})

test('integrity-failed evidence explains why it cannot support a current claim', () => {
  assert.match(types, /integrity: EvidenceIntegrityState/)
  assert.match(component, /Integrity failed|Failed/)
  assert.match(component, /integrityExplanation/)
  assert.match(types, /cannot-support-current/)
})

test('missing provenance remains visible instead of being invented', () => {
  assert.match(types, /sourceReference: string \| null/)
  assert.match(component, /Source \/ run provenance is missing/)
  assert.match(component, /observationContextLabel/)
})

test('conflicts preserve sources and observation contexts without silent resolution', () => {
  assert.match(component, /Unresolved conflicts/)
  assert.match(component, /unresolvedExplanation/)
  assert.match(component, /Contexts:/)
  assert.match(component, /incompatible contexts is not merged/i)
  assert.match(types, /observationContextIds: string\[\]/)
})

test('blocked access evidence and impact references remain visible', () => {
  assert.match(component, /accessLimitation/)
  assert.match(component, /Used by/)
  assert.match(component, /Truth Cards:/)
  assert.match(component, /Claims \/ recommendations:/)
})

test('credential material is omitted from the presentation boundary', () => {
  assert.match(types, /credentialMaterialOmitted: boolean/)
  assert.match(component, /Credential material omitted from presentation/)
  assert.doesNotMatch(types, /password|secret|token|cookie/i)
})

test('evidence support is qualitative and can be historical-only or unknown', () => {
  assert.match(types, /supports-current.*historical-only.*cannot-support-current.*unknown/s)
  assert.match(component, /Support/)
  assert.doesNotMatch(component, /healthScore|health score|numeric KPI/i)
})

test('Evidence is enabled at the established workspace route', () => {
  assert.match(workspace, /slug: 'evidence', label: 'Evidence', available: true/)
  assert.match(app, /path="\/application\/evidence"/)
  assert.doesNotMatch(app, /api\/.*evidence/i)
})
