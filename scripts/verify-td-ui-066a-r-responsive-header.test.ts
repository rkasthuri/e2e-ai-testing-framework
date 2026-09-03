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
const header = read('forge-ui/src/components/layout/Header.tsx')
const shell = read('forge-ui/src/components/layout/AppShell.tsx')
const evidence = read('forge-ui/src/components/application-workspace/ApplicationEvidence.tsx')

test('desktop navigation is retained while compact navigation owns widths below xl', () => {
  assert.match(header, /hidden min-w-0 flex-1 items-center gap-1 xl:flex/)
  assert.match(header, /xl:hidden/)
  assert.match(header, /compact-primary-navigation/)
  assert.doesNotMatch(header, /<nav className="flex flex-1 items-center gap-1">/)
})

test('compact navigation is an accessible disclosure with native Enter and Space behavior', () => {
  assert.match(header, /type="button"[\s\S]*aria-label=\{navigationOpen \? 'Close primary navigation' : 'Open primary navigation'\}/)
  assert.match(header, /aria-expanded=\{navigationOpen\}/)
  assert.match(header, /aria-controls="compact-primary-navigation"/)
  assert.match(header, /aria-label="Compact primary navigation"/)
  assert.match(header, /focus-visible:ring-2 focus-visible:ring-brand/)
})

test('Escape closes each disclosure and returns focus predictably', () => {
  assert.match(header, /event\.key !== 'Escape'/)
  assert.match(header, /projectButtonRef\.current\?\.focus\(\)/)
  assert.match(header, /navigationButtonRef\.current\?\.focus\(\)/)
  assert.match(header, /document\.addEventListener\('keydown', closeOnEscape\)/)
  assert.match(header, /document\.removeEventListener\('keydown', closeOnEscape\)/)
})

test('truthful primary destinations share one route authority and retain project scoping', () => {
  const primaryNavigation = header.match(/const TABS = \[([\s\S]*?)\n\]/)?.[1]
  assert.ok(primaryNavigation, 'Header must declare the shared TABS route authority')

  const expected = [
    { to: '/onboard', label: 'Onboard', scoped: false },
    { to: '/crawl', label: 'Crawl', scoped: true },
    { to: '/tests', label: 'Tests', scoped: true },
    { to: '/run', label: 'Run', scoped: true },
    { to: '/results', label: 'Results', scoped: true },
    { to: '/insights', label: 'Insights', scoped: true },
    { to: '/application/overview', label: 'Application', scoped: true },
  ]
  const actual = [...primaryNavigation.matchAll(
    /\{ to: '([^']+)', label: '([^']+)', scoped: (true|false) \}/g,
  )].map(([, to, label, scoped]) => ({ to, label, scoped: scoped === 'true' }))
  assert.deepEqual(actual, expected)

  for (const placeholder of [
    { to: '/truth-board', label: 'Truth Board' },
    { to: '/settings', label: 'Settings' },
  ]) {
    assert.doesNotMatch(primaryNavigation, new RegExp(`to: '${placeholder.to.replaceAll('/', '\\/')}'`))
    assert.doesNotMatch(primaryNavigation, new RegExp(`label: '${placeholder.label}'`))
  }

  assert.equal((header.match(/TABS\.map/g) ?? []).length, 2)
  assert.equal((header.match(/buildProjectRoute\(t\.to, currentProject\)/g) ?? []).length, 2)
})

test('selected project and theme remain keyboard-accessible in the bounded top row', () => {
  assert.match(header, /aria-label=\{`Select project\. Current project:/)
  assert.match(header, /max-w-\[8\.5rem\]/)
  assert.match(header, /<span className="truncate">\{currentProject/)
  assert.match(header, /aria-label="Toggle theme"/)
  assert.match(header, /w-\[min\(14rem,calc\(100vw-1\.5rem\)\)\]/)
})

test('application shell contains viewport overflow without hiding page content', () => {
  assert.match(shell, /w-full min-w-0 max-w-full[\s\S]*overflow-hidden/)
  assert.match(shell, /<main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">/)
  assert.match(shell, /flex-wrap[\s\S]*sm:flex-nowrap/)
})

test('Evidence stays compact at 390px and 768px, then becomes a desktop table at 1440px', () => {
  assert.match(evidence, /block w-full border-collapse[\s\S]*xl:table/)
  assert.match(evidence, /hidden[\s\S]*xl:table-header-group/)
  assert.match(evidence, /block space-y-2 p-2 xl:table-row-group/)
  assert.match(evidence, /xl:hidden/)
  assert.doesNotMatch(evidence, /md:table(?:-header-group|-row-group|-row|-cell)?/)
  assert.doesNotMatch(evidence, /md:hidden/)
})

test('Evidence one-inline-detail and accessibility semantics remain unchanged', () => {
  assert.match(evidence, /expanded && <tr/)
  assert.match(evidence, /colSpan=\{9\}/)
  assert.equal((evidence.match(/<EvidenceDetails evidence=\{evidence\}/g) ?? []).length, 1)
  assert.match(evidence, /aria-expanded=\{expanded\}/)
  assert.match(evidence, /aria-controls=\{controls\}/)
  assert.match(evidence, /aria-selected=\{expanded\}/)
  assert.match(evidence, /aria-live="polite"/)
})

test('responsive correction adds no mutation controls or Evidence authority changes', () => {
  assert.doesNotMatch(header, /fetch\(|apiClient|ObservationStore|AppModel|SQLite/)
  assert.doesNotMatch(header, />\s*(Crawl now|Retry|Force re-crawl|Delete|Repair)\s*</i)
  assert.doesNotMatch(shell, /fetch\(|apiClient|ObservationStore|AppModel|SQLite/)
})
