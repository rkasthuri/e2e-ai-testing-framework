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

export function isValidEvidenceCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
}

/** Local calendar semantics are materialized once before the API request. */
export function evidenceCalendarBoundary(value: string, through: boolean): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(
    year,
    month - 1,
    day,
    through ? 23 : 0,
    through ? 59 : 0,
    through ? 59 : 0,
    through ? 999 : 0,
  ).toISOString()
}
