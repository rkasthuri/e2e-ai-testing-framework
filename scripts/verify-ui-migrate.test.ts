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

/**
 * TD-UI-019 — migrateFixtures slot-strip gate. The strip removes ONLY a b18aadd
 * forge-ui-written slot (`<APP>_CREDENTIALS`); a role-derived engine-established
 * slot (`USER_CREDENTIALS`) must SURVIVE every reboot. isB18addArtifactSlot() is
 * the exact predicate migrateFixtures applies, so testing it proves the
 * survive/remove/no-op behavior without touching the real ~/.forge-projects.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isB18addArtifactSlot, b18addSlotEnvKey } from '../forge-ui/server/scripts/migrateFixtures'

test('M0 b18addSlotEnvKey derives <APP>_CREDENTIALS (hyphens → _)', () => {
  assert.equal(b18addSlotEnvKey('saucedemo'), 'SAUCEDEMO_CREDENTIALS')
  assert.equal(b18addSlotEnvKey('restful-booker'), 'RESTFUL_BOOKER_CREDENTIALS')
})

test('M1 engine slot USER_CREDENTIALS SURVIVES a migrateFixtures run (not stripped)', () => {
  // isB18addArtifactSlot === false ⇒ migrateFixtures leaves the slot intact.
  assert.equal(isB18addArtifactSlot('saucedemo', { credentials: { envKey: 'USER_CREDENTIALS' } }), false)
})

test('M2 b18aadd artifact SAUCEDEMO_CREDENTIALS is REMOVED (matches the signature)', () => {
  // isB18addArtifactSlot === true ⇒ migrateFixtures strips it.
  assert.equal(isB18addArtifactSlot('saucedemo', { credentials: { envKey: 'SAUCEDEMO_CREDENTIALS' } }), true)
})

test('M3 no credentials block → no-op (false, no crash)', () => {
  assert.equal(isB18addArtifactSlot('saucedemo', {}), false)
  assert.equal(isB18addArtifactSlot('saucedemo', { credentials: {} }), false)
})
