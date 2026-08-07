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
 * StatusDot — the semantic status indicator used everywhere (test lists, run
 * progress, insights heatmap). Colors are the signal tokens; purple = unknown
 * (insufficient evidence). Never used decoratively.
 */
export type Status = 'pass' | 'fail' | 'flaky' | 'skip' | 'run' | 'unknown'

const COLOR: Record<Status, string> = {
  pass:    'bg-pass',
  fail:    'bg-fail',
  flaky:   'bg-flaky',
  skip:    'bg-skip',
  run:     'bg-running',
  unknown: 'bg-unknown',
}

const LABEL: Record<Status, string> = {
  pass: 'Passed', fail: 'Failed', flaky: 'Flaky',
  skip: 'Skipped', run: 'Running', unknown: 'Insufficient evidence',
}

export function StatusDot({ status, size = 8 }: { status: Status; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full ${COLOR[status]}`}
      style={{ width: size, height: size }}
      title={LABEL[status]}
      aria-label={LABEL[status]}
    />
  )
}
