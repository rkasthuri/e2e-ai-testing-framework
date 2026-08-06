/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function localBoundary(value: string, through: boolean): Date | null {
  const match = CALENDAR_DATE.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(through ? 23 : 0, through ? 59 : 0, through ? 59 : 0, through ? 999 : 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

export interface MaterializedObservationDateFilter {
  startedFrom: string
  startedThrough: string
  startedFromIso: string | null
  startedThroughIso: string | null
  active: boolean
  timezone: string
}

export type ObservationDateFilterResult =
  | { ok: true; filter: MaterializedObservationDateFilter }
  | { ok: false; message: string }

export function materializeObservationDateFilter(
  startedFrom: string,
  startedThrough: string,
): ObservationDateFilterResult {
  const fromDate = startedFrom ? localBoundary(startedFrom, false) : null
  const throughDate = startedThrough ? localBoundary(startedThrough, true) : null
  if (startedFrom && !fromDate) {
    return { ok: false, message: 'Started from must be a valid calendar date.' }
  }
  if (startedThrough && !throughDate) {
    return { ok: false, message: 'Started through must be a valid calendar date.' }
  }
  if (fromDate && throughDate && fromDate > throughDate) {
    return { ok: false, message: 'Started from must not be later than Started through.' }
  }
  return {
    ok: true,
    filter: {
      startedFrom,
      startedThrough,
      startedFromIso: fromDate?.toISOString() ?? null,
      startedThroughIso: throughDate?.toISOString() ?? null,
      active: !!startedFrom || !!startedThrough,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time',
    },
  }
}
