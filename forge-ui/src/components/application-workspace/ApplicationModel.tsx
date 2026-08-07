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

import { ChevronDown, ChevronRight, CircleHelp, Database, FileSearch, ShieldAlert } from 'lucide-react'
import React from 'react'
import { Link } from 'react-router-dom'
import type { ApplicationModelReadModel, ApplicationModelVersion } from './applicationModelTypes'

const lifecycleLabel = { active: 'Active', superseded: 'Superseded', unknown: 'Unknown' } as const
const validationLabel = { valid: 'Valid', invalid: 'Invalid', malformed: 'Malformed' } as const
const integrityLabel = { verified: 'Verified', failed: 'Failed', not_evaluated: 'Not evaluated' } as const
const projectionLabel = {
  current: 'Current', unavailable: 'Unavailable', invalid: 'Invalid', mismatched: 'Mismatched',
  not_evaluated: 'Not evaluated', not_applicable: 'Not applicable',
} as const
const outcomeLabel = {
  completed: 'Completed', partially_completed: 'Partially completed', blocked: 'Blocked',
  failed: 'Failed', unknown: 'Unknown',
} as const
const evidenceLabel = {
  crawled: 'Observed evidence recorded',
  'crawled-empty': 'Observation recorded no model subjects',
  'unsupported-platform': 'Platform observation unsupported',
  unknown: 'Evidence state unknown',
} as const

function ExactTime({ value }: { value: string | null }) {
  if (!value) return <>Not available</>
  return <time dateTime={value} title={value}>{new Date(value).toLocaleString()}</time>
}

function SourceObservation({ model }: { model: ApplicationModelVersion }) {
  const source = model.sourceObservation
  if (!source) return <span>Not recorded</span>
  return source.available && source.href
    ? <Link className="font-mono text-brand underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={source.href}>{source.id}</Link>
    : <span className="font-mono">{source.id} (unavailable)</span>
}

function ModelDetails({ model, id }: { model: ApplicationModelVersion; id: string }) {
  return <section id={id} role="region" aria-labelledby={`${id}-heading`} className="space-y-4 rounded-lg border border-border bg-elevated p-4">
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-muted">Selected model version</p>
      <h3 id={`${id}-heading`} className="mt-1 text-lg font-semibold text-primary">Version {model.version}, database row {model.rowId}</h3>
      <p className="mt-1 text-sm text-secondary">{lifecycleLabel[model.lifecycle]}. {evidenceLabel[model.evidenceState]}.</p>
    </div>
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-muted">Model created</dt><dd className="mt-1 text-secondary"><ExactTime value={model.createdAt} /></dd></div>
      <div><dt className="text-muted">Source observation time</dt><dd className="mt-1 text-secondary"><ExactTime value={model.sourceObservation?.completedAt ?? model.sourceCrawlAt} /></dd></div>
      <div><dt className="text-muted">Validation</dt><dd className="mt-1 text-secondary">{validationLabel[model.validation]}</dd></div>
      <div><dt className="text-muted">Integrity</dt><dd className="mt-1 text-secondary">{integrityLabel[model.integrity]}</dd></div>
      <div><dt className="text-muted">Projection</dt><dd className="mt-1 text-secondary">{projectionLabel[model.projection]}</dd></div>
      <div><dt className="text-muted">Freshness</dt><dd className="mt-1 text-secondary">Not evaluated</dd></div>
      <div><dt className="text-muted">Coverage</dt><dd className="mt-1 text-secondary">Unknown</dd></div>
      <div><dt className="text-muted">Source outcome</dt><dd className="mt-1 text-secondary">{model.sourceObservation?.outcome ? outcomeLabel[model.sourceObservation.outcome] : 'Unknown'}</dd></div>
    </dl>
    <details className="rounded border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Observed subjects and interpretation</summary>
      {model.subjects.length === 0
        ? <p className="mt-3 text-sm text-muted">No safely validated model subjects are available for this version.</p>
        : <ul className="mt-3 grid gap-3 md:grid-cols-2">{model.subjects.map(subject => <li key={`${subject.kind}:${subject.id}`} className="rounded border border-border bg-elevated p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-primary">{subject.id}</span><span className="text-xs text-muted">{subject.basis === 'direct_observation' ? 'Direct observation' : 'Observation link unknown'}</span></div>
            <p className="mt-1 text-secondary">{subject.routePath ?? 'Route path not safely available'}</p>
            {subject.derivedClassification && <p className="mt-2 text-xs text-muted">Derived interpretation: {subject.derivedClassification.label} ({subject.derivedClassification.confidence}, {subject.derivedClassification.method})</p>}
            {subject.evidenceId && <p className="mt-1 text-xs text-muted">Evidence: <span className="font-mono">{subject.evidenceId}</span></p>}
          </li>)}</ul>}
    </details>
    <details className="rounded border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Provenance and recovery</summary>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Source observation</dt><dd className="mt-1 break-all text-secondary"><SourceObservation model={model} /></dd></div>
        <div><dt className="text-muted">Persisted fingerprint</dt><dd className="mt-1 break-all font-mono text-xs text-secondary">{model.modelFingerprint}</dd></div>
      </dl>
      {model.recovery
        ? <p className="mt-3 text-sm text-secondary">Guarded recovery preserved source row {model.recovery.sourceRowId}{model.recovery.sourceVersion ? `, version ${model.recovery.sourceVersion}` : ''}. Source fingerprint: {model.recovery.sourceFingerprintMatches ? 'verified' : 'not verified'}.</p>
        : <p className="mt-3 text-sm text-muted">No guarded recovery provenance is recorded for this version.</p>}
    </details>
    <details className="rounded border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Limitations, unknowns, and blockers</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Limitations</p><ul className="mt-2 space-y-1 text-sm text-secondary">{model.limitations.map(item => <li key={item}>• {item}</li>)}</ul></div>
        <div><p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-unknown"><CircleHelp size={13} /> Unknowns</p>{model.unknowns.length ? <ul className="mt-2 space-y-1 text-sm text-secondary">{model.unknowns.map(item => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-sm text-muted">None recorded.</p>}</div>
        <div><p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-fail"><ShieldAlert size={13} /> Blockers</p>{model.blockers.length ? <ul className="mt-2 space-y-1 text-sm text-secondary">{model.blockers.map(item => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-sm text-muted">None recorded.</p>}</div>
      </div>
    </details>
    {model.recommendation && <p className="rounded border border-border bg-surface p-3 text-sm text-secondary"><strong className="text-primary">Recommendation:</strong> <Link className="text-brand underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={model.recommendation.href}>{model.recommendation.action}</Link>. {model.recommendation.because}</p>}
  </section>
}

function HistoryControl({ model, expanded, controls, onSelect }: { model: ApplicationModelVersion; expanded: boolean; controls: string; onSelect: () => void }) {
  return <button type="button" aria-expanded={expanded} aria-controls={controls} aria-current={expanded ? 'true' : undefined} aria-label={`View model ${model.rowId}`} onClick={event => { event.stopPropagation(); onSelect() }} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">
    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expanded ? 'Selected — collapse' : 'View'}
  </button>
}

export function ApplicationModel({ readModel, selectedRowId, onSelect, onPrevious, onNext, isPageLoading = false }: {
  readModel: ApplicationModelReadModel
  selectedRowId: number | null
  onSelect: (rowId: number) => void
  onPrevious: () => void
  onNext: () => void
  isPageLoading?: boolean
}) {
  const current = readModel.currentModel
  return <div className="space-y-6" data-testid="application-model">
    <header><p className="text-xs uppercase tracking-[0.18em] text-brand">Application Model</p><h1 className="mt-1 text-2xl font-semibold text-primary">Persisted application understanding</h1><p className="mt-1 text-sm text-secondary">A validated view of persisted model evidence—not proof that the application is completely modeled.</p></header>

    <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="current-model-heading">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-muted">Current active model</p><h2 id="current-model-heading" className="mt-1 text-xl font-semibold text-primary">{current ? `Version ${current.version}, row ${current.rowId}` : 'No active model'}</h2></div><Database size={20} className="text-brand" /></div>
      {current ? <><p className="mt-3 text-sm text-secondary">Project <span className="font-mono">{readModel.project.id}</span>. Active position does not establish freshness, coverage, or completeness.</p><dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted">Created</dt><dd className="mt-1 text-secondary"><ExactTime value={current.createdAt} /></dd></div><div><dt className="text-muted">Source observation</dt><dd className="mt-1 break-all text-secondary"><SourceObservation model={current} /></dd></div><div><dt className="text-muted">Validation / integrity</dt><dd className="mt-1 text-secondary">{validationLabel[current.validation]} / {integrityLabel[current.integrity]}</dd></div><div><dt className="text-muted">Projection</dt><dd className="mt-1 text-secondary">{projectionLabel[current.projection]}</dd></div><div><dt className="text-muted">Freshness</dt><dd className="mt-1 text-secondary">Not evaluated</dd></div><div><dt className="text-muted">Coverage</dt><dd className="mt-1 text-secondary">Unknown</dd></div><div><dt className="text-muted">Latest observation</dt><dd className="mt-1 break-all font-mono text-xs text-secondary">{readModel.latestObservationId ?? 'Not available'}</dd></div><div><dt className="text-muted">Observed subjects represented</dt><dd className="mt-1 text-secondary">{current.subjects.length}</dd></div></dl></> : <p className="mt-3 text-sm text-secondary">No persisted model version is available. No application structure is inferred.</p>}
    </section>

    <section aria-labelledby="model-history-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-muted">Authoritative history</p><h2 id="model-history-heading" className="mt-1 text-xl font-semibold text-primary">Model versions</h2></div><p className="text-sm text-secondary">Total model versions: <strong className="text-primary">{readModel.page.total}</strong> · Currently active: <strong className="text-primary">{readModel.page.activeCount}</strong></p></div>
      {readModel.models.length === 0 ? <div className="rounded-lg border border-border bg-surface p-8 text-center"><p className="text-sm text-secondary">No model history exists for this project.</p><p className="mt-1 text-xs text-muted">This does not describe application coverage.</p></div> : <>
        <div className="overflow-hidden rounded-lg border border-border">
          {/* One selected version contributes exactly one adjacent detail row; compact cards reuse the same DOM contract. */}
          <table className="block w-full border-collapse text-left text-sm md:table"><thead className="hidden bg-elevated text-xs uppercase tracking-wide text-muted md:table-header-group"><tr><th className="px-3 py-3">Version</th><th className="px-3 py-3">Created</th><th className="px-3 py-3">Lifecycle</th><th className="px-3 py-3">Validation</th><th className="px-3 py-3">Integrity</th><th className="px-3 py-3">Source observation</th><th className="px-3 py-3">Recovery</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="block space-y-2 p-2 md:table-row-group md:space-y-0 md:p-0">{readModel.models.flatMap(model => {
            const expanded = selectedRowId === model.rowId
            const detailId = `model-detail-${model.rowId}`
            const mobileLabel = (label: string) => <span className="mr-2 font-medium text-muted md:hidden">{label}:</span>
            return [<tr key={`row-${model.rowId}`} aria-selected={expanded} onClick={() => onSelect(model.rowId)} className={`block cursor-pointer rounded border border-border bg-surface py-2 hover:bg-elevated md:table-row md:rounded-none md:border-x-0 md:border-b-0 ${expanded ? 'font-medium ring-1 ring-inset ring-brand' : ''}`}><td className="block px-3 py-2 md:table-cell md:py-3"><div className="flex items-center justify-between gap-2 md:justify-start"><HistoryControl model={model} expanded={expanded} controls={detailId} onSelect={() => onSelect(model.rowId)} /><span><span className="text-muted md:hidden">Version </span>{model.version}</span></div></td><td className="block px-3 py-1 md:table-cell md:py-3">{mobileLabel('Created')}<ExactTime value={model.createdAt} /></td><td className="block px-3 py-1 md:table-cell md:py-3">{mobileLabel('Lifecycle')}{lifecycleLabel[model.lifecycle]}</td><td className="block px-3 py-1 md:table-cell md:py-3">{mobileLabel('Validation')}{validationLabel[model.validation]}</td><td className="block px-3 py-1 md:table-cell md:py-3">{mobileLabel('Integrity')}{integrityLabel[model.integrity]}</td><td className="block break-all px-3 py-1 font-mono text-xs md:table-cell md:max-w-[12rem] md:py-3">{mobileLabel('Source observation')}{model.sourceObservation?.id ?? 'Not recorded'}</td><td className="block px-3 py-1 md:table-cell md:py-3">{mobileLabel('Recovery')}{model.recovery ? 'Guarded recovery' : 'None recorded'}</td><td className="block px-3 py-1 md:table-cell md:py-3">{mobileLabel('Status')}{evidenceLabel[model.evidenceState]}</td></tr>, expanded && <tr key={`detail-${model.rowId}`} className="block border-border md:table-row md:border-t"><td colSpan={8} className="block bg-elevated/50 p-2 md:table-cell md:p-3"><ModelDetails model={model} id={detailId} /></td></tr>].filter(Boolean) as JSX.Element[]
          })}</tbody></table>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Showing {readModel.models.length} bounded model version{readModel.models.length === 1 ? '' : 's'} on this page.</p><div className="flex gap-2"><button type="button" onClick={onPrevious} disabled={!readModel.page.hasPrevious || isPageLoading} className="rounded border border-border px-3 py-2 text-sm text-primary outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">Previous</button><button type="button" onClick={onNext} disabled={!readModel.page.nextCursor || isPageLoading} className="rounded border border-border px-3 py-2 text-sm text-primary outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">Next</button></div></div>
      </>}
      <p className="sr-only" aria-live="polite">{selectedRowId ? `Model row ${selectedRowId} details selected.` : 'Model history details collapsed.'}</p>
    </section>
    <p className="flex gap-2 rounded border border-border bg-surface p-4 text-sm text-secondary"><FileSearch size={16} className="mt-0.5 shrink-0 text-brand" />Model validity, persistence, projection, evidence coverage, lifecycle position, and freshness are reported independently.</p>
  </div>
}
