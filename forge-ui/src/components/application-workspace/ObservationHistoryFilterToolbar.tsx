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

export function ObservationHistoryFilterToolbar({
  startedFrom,
  startedThrough,
  timezone,
  error,
  onStartedFromChange,
  onStartedThroughChange,
  onApply,
  onClear,
}: {
  startedFrom: string
  startedThrough: string
  timezone: string
  error: string | null
  onStartedFromChange: (value: string) => void
  onStartedThroughChange: (value: string) => void
  onApply: () => void
  onClear: () => void
}) {
  return <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="observation-date-filter-heading">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1"><h2 id="observation-date-filter-heading" className="text-sm font-semibold text-primary">Filter by persisted start date</h2><p id="observation-filter-timezone" className="mt-1 text-xs text-muted">Calendar boundaries use {timezone}. From is inclusive; Through includes the entire selected date.</p></div>
      <label className="flex min-w-44 flex-col gap-1 text-xs font-medium text-secondary">Started from<input type="date" value={startedFrom} aria-describedby="observation-filter-timezone" onChange={event => onStartedFromChange(event.target.value)} className="rounded border border-border bg-elevated px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
      <label className="flex min-w-44 flex-col gap-1 text-xs font-medium text-secondary">Started through<input type="date" value={startedThrough} aria-describedby="observation-filter-timezone" onChange={event => onStartedThroughChange(event.target.value)} className="rounded border border-border bg-elevated px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
      <div className="flex gap-2"><button type="button" onClick={onApply} className="rounded bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface">Apply</button><button type="button" onClick={onClear} className="rounded border border-border px-4 py-2 text-sm text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand">Clear</button></div>
    </div>
    {error && <p className="mt-3 text-sm text-fail" role="alert">{error}</p>}
  </section>
}
