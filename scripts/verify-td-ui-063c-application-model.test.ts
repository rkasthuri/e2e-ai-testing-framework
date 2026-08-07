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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const root = path.resolve(__dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const component = read('forge-ui/src/components/application-workspace/ApplicationModel.tsx')
const types = read('forge-ui/src/components/application-workspace/applicationModelTypes.ts')
const page = read('forge-ui/src/pages/ApplicationModelPage.tsx')
const workspace = read('forge-ui/src/components/application-workspace/ApplicationWorkspace.tsx')
const app = read('forge-ui/src/App.tsx')

test('no Application Model available is explicit and makes no structure claim', () => {
  assert.match(component, /No persisted model version is available/)
  assert.match(component, /No application structure is inferred/)
  assert.match(page, /No application selected/)
})

test('current model exposes authoritative identity, lifecycle, timestamps, validation, integrity, and projection', () => {
  for (const label of ['Current active model', 'Created', 'Source observation', 'Validation / integrity', 'Projection']) {
    assert.equal(component.includes(label), true)
  }
  assert.match(types, /ApplicationModelHistoryResponse/)
})

test('freshness, coverage, current position, and latest observation remain independent', () => {
  assert.match(component, /Freshness/)
  assert.match(component, /Not evaluated/)
  assert.match(component, /Coverage/)
  assert.match(component, /Unknown/)
  assert.match(component, /Latest observation/)
  assert.match(component, /Active position does not establish freshness, coverage, or completeness/)
})

test('model subjects distinguish direct observations from derived interpretations', () => {
  assert.match(component, /Direct observation/)
  assert.match(component, /Derived interpretation:/)
  assert.match(component, /Observation link unknown/)
  assert.match(component, /Evidence:/)
})

test('history is bounded, newest-first, selectable, collapsible, and paginated', () => {
  assert.match(component, /Authoritative history/)
  assert.match(component, /Model versions/)
  assert.match(component, /aria-expanded=\{expanded\}/)
  assert.match(component, /aria-controls=\{controls\}/)
  assert.match(component, /aria-selected=\{expanded\}/)
  assert.match(component, /Previous/)
  assert.match(component, /Next/)
  assert.match(page, /searchParams\.get\('cursor'\)/)
  assert.match(page, /searchParams\.get\('model'\)/)
})

test('authoritative totals and single active count are presented without normalization', () => {
  assert.match(component, /Total model versions:/)
  assert.match(component, /Currently active:/)
  assert.match(page, /Multiple active models detected/)
  assert.match(page, /Active model missing/)
})

test('responsive history preserves one semantic table and visible focus', () => {
  assert.match(component, /<table/)
  assert.match(component, /md:table/)
  assert.match(component, /md:hidden/)
  assert.match(component, /focus-visible:ring-2/)
  assert.match(component, /aria-live="polite"/)
})

test('Application Model is enabled at the established workspace route with no mutation controls', () => {
  assert.match(workspace, /slug: 'model', label: 'Application Model', available: true/)
  assert.match(app, /path="\/application\/model"/)
  assert.doesNotMatch(component, />\s*(Edit|Delete|Activate|Supersede|Recover|Rebuild|Retry|Crawl|Force re-crawl)\s*</i)
  assert.doesNotMatch(component, /healthScore|coverage percentage|readiness score/i)
})
