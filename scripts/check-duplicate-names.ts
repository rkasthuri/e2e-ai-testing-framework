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

import * as fs from 'fs'
import * as path from 'path'

// TD-035 verification: confirms zero duplicate element names/ids across every
// page of a given app's model, programmatically (not a spot-check). Run after
// (re)crawling with the enforceWholePageUniqueness() fix in place.
//
// Usage: npx tsx scripts/check-duplicate-names.ts <appName>

const appName = process.argv[2]
if (!appName) {
  console.error('Usage: npx tsx scripts/check-duplicate-names.ts <appName>')
  process.exit(1)
}

const modelPath = path.resolve(`models/${appName}/app-model.json`)
const model = JSON.parse(fs.readFileSync(modelPath, 'utf-8'))

let totalElements = 0
let totalDupeNames = 0
let totalDupeIds = 0

for (const page of model.pages ?? []) {
  const nameCounts = new Map<string, number>()
  const idCounts = new Map<string, number>()
  for (const el of page.elements ?? []) {
    totalElements++
    nameCounts.set(el.name, (nameCounts.get(el.name) ?? 0) + 1)
    idCounts.set(el.id, (idCounts.get(el.id) ?? 0) + 1)
  }
  const dupeNames = [...nameCounts.entries()].filter(([, c]) => c > 1)
  const dupeIds = [...idCounts.entries()].filter(([, c]) => c > 1)
  totalDupeNames += dupeNames.length
  totalDupeIds += dupeIds.length

  console.log(
    `${page.id} | ${page.elements?.length ?? 0} elements | ` +
    `dupe names: ${dupeNames.length} | dupe ids: ${dupeIds.length}` +
    (dupeNames.length > 0 ? ` | ${dupeNames.map(([n, c]) => `"${n}"x${c}`).join(', ')}` : '')
  )
}

console.log('\n' + '='.repeat(70))
console.log(
  `${appName}: ${model.pages?.length ?? 0} pages, ${totalElements} elements total | ` +
  `duplicate names: ${totalDupeNames} | duplicate ids: ${totalDupeIds}`
)
console.log(totalDupeNames === 0 && totalDupeIds === 0 ? 'PASS — zero duplicates' : 'FAIL — duplicates found')
