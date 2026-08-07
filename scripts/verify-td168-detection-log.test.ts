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
 * TD-168 — the detection log line must be reconstructable from the line alone (Raj's rule):
 * value + confidence + source + raw signals + reason (which carries the method). Pure-format
 * proof of `formatDetectionLogLine` (no browser, no I/O).
 * Run: npx tsx --test scripts/verify-td168-detection-log.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDetectionLogLine, DetectedField } from '../src/core/onboarding/Bootstrap'

test('L1 a line carries value + confidence + source + signals + reason (method inside reason)', () => {
  const authType: DetectedField<string> = {
    value: 'form-login', confidence: 'medium', source: 'evidence-matched',
    reason: '1 password field(s) observed via password-field count under the SPA settling policy. Single pre-auth sample: capped at medium (ADR-020 §4).',
    signals: { passwordFieldCount: 1 },
  }
  const line = formatDetectionLogLine('authType', authType)
  assert.match(line, /^\[bootstrap\] authType=form-login /)      // subsystem prefix + value
  assert.match(line, /confidence=medium/)
  assert.match(line, /source=evidence-matched/)
  assert.match(line, /signals=\{"passwordFieldCount":1\}/)       // raw structured signals
  assert.match(line, /password-field count under the SPA settling policy/)  // the METHOD, via reason
})

test('L2 signals are ALWAYS printed (={}) when absent, so a two-run log diff aligns', () => {
  const appName: DetectedField<string> = {
    value: 'saucedemo', confidence: 'high', source: 'user-supplied', reason: 'derived from the URL host',
    // no signals
  }
  const line = formatDetectionLogLine('appName', appName)
  assert.match(line, /signals=\{\}/, 'a signal-less field must print signals={}, never omit the key')
})

test('L3 single line — no embedded newline can break a reader/diff', () => {
  const d: DetectedField<string> = {
    value: 'unknown', confidence: 'unknown', source: 'default-fallback',
    reason: 'no framework marker observed; multi\nline reason', signals: { frameworkMountPointCount: 0 },
  }
  const line = formatDetectionLogLine('renderingModel', d)
  assert.equal(line.split('\n').length, 1, 'JSON-stringified reason must escape newlines to keep one line')
})
