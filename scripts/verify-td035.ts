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

import { ElementClassifier } from '../src/core/onboarding/ElementClassifier'
import { ElementDefinition } from '../src/core/onboarding/types'

// TD-035 direct repro: reconstructs the exact pre-enforceWholePageUniqueness()
// state that produced the live OrangeHRM viewCandidates collision in the
// 2026-06-21 validation run (see logs/validation-run-2026-06-21/generated-diffs/
// app-models.diff), and replays it through the real (private) method to
// confirm the fix. Three elements feed in, matching the traced mechanism:
//
//  - E1: tier-2 output from group "candidateRowActionButton1" (row 0) —
//    already disambiguatedFrom "candidateRowActionButton1", name
//    "candidateRowActionButton11" (confirmed live: disambiguatedFrom field
//    in the diff).
//  - E2: a second, independent element that also carries name
//    "candidateRowActionButton11" with no disambiguatedFrom yet (the
//    cross-group collision enforceWholePageUniqueness() exists to catch).
//  - E3: disambiguateCoincidental() pos1 output, name
//    "candidateRowActionButton11_2", disambiguatedFrom
//    "candidateRowActionButton11" — produced during deduplicateNames(),
//    BEFORE enforceWholePageUniqueness() ever runs (confirmed live: this
//    exact disambiguatedFrom value appears twice in the diff, once for each
//    half of the colliding pair).

function makeElement(id: string, name: string, disambiguatedFrom?: string): ElementDefinition {
  return {
    id, name, kind: 'button', label: 'unnamed', critical: false, aiNamed: true,
    strategies: [], tier3Assertions: [],
    ...(disambiguatedFrom ? { disambiguatedFrom } : {}),
  } as ElementDefinition
}

const pageId = 'web-index-php-recruitment-viewCandidates'
const elements: ElementDefinition[] = [
  makeElement(`${pageId}:candidateRowActionButton11`, 'candidateRowActionButton11', 'candidateRowActionButton1'),
  makeElement(`${pageId}:candidateRowActionButton11-other`, 'candidateRowActionButton11'),
  makeElement(`${pageId}:candidateRowActionButton11_2`, 'candidateRowActionButton11_2', 'candidateRowActionButton11'),
]

console.log('BEFORE enforceWholePageUniqueness():')
elements.forEach(e => console.log(`  ${e.id} -> name="${e.name}" disambiguatedFrom="${e.disambiguatedFrom ?? ''}"`))

const classifier = new (ElementClassifier as any)(null, pageId, null)
;(classifier as any).enforceWholePageUniqueness(elements)

console.log('\nAFTER enforceWholePageUniqueness():')
elements.forEach(e => console.log(`  ${e.id} -> name="${e.name}" disambiguatedFrom="${e.disambiguatedFrom ?? ''}"`))

const names = elements.map(e => e.name)
const dupes = names.filter((n, i) => names.indexOf(n) !== i)
console.log(dupes.length === 0
  ? '\nPASS — zero duplicate names (pre-fix, E2 would have collided with E3 at "candidateRowActionButton11_2")'
  : `\nFAIL — duplicates: ${dupes.join(', ')}`)
