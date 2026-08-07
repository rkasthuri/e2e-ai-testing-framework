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

import { ChevronDown, ChevronRight, CircleHelp, FileSearch } from 'lucide-react'
import React, { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ApplicationEvidenceReadModel, EvidenceLedgerRecord } from './evidenceTypes'

const sourceLabel = { onboarding: 'Onboarding', crawl_observation: 'Crawl observation' } as const
const supportLabel = { current: 'Current support', historical: 'Historical support' } as const
const integrityLabel = { verified: 'Verified', failed: 'Failed', not_evaluated: 'Not evaluated' } as const
const outcomeLabel = { completed: 'Completed', partially_completed: 'Partially completed', blocked: 'Blocked', failed: 'Failed', unknown: 'Unknown' } as const

function ExactTime({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{new Date(value).toLocaleString()}</time>
}

function EvidenceDetails({ evidence, id }: { evidence: EvidenceLedgerRecord; id: string }) {
  return <section id={id} role="region" aria-labelledby={`${id}-heading`} className="space-y-3 rounded-lg border border-border bg-elevated p-4">
    <div><p className="text-xs uppercase tracking-[0.16em] text-muted">Selected evidence</p><h3 id={`${id}-heading`} className="mt-1 break-all text-lg font-semibold text-primary">Evidence {evidence.id}</h3><p className="mt-1 text-sm text-secondary">{evidence.summary}</p></div>
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-muted">Canonical subject</dt><dd className="mt-1 font-mono text-secondary">{evidence.canonicalSubjectId}</dd></div>
      <div><dt className="text-muted">Route path</dt><dd className="mt-1 font-mono text-secondary">{evidence.routePath ?? 'Not applicable'}</dd></div>
      <div><dt className="text-muted">Captured</dt><dd className="mt-1 text-secondary"><ExactTime value={evidence.capturedAt} /></dd></div>
      <div><dt className="text-muted">Identity</dt><dd className="mt-1 text-secondary">{evidence.identityOrigin === 'persisted' ? 'Persisted identity' : 'Deterministic projection identity'}</dd></div>
      <div><dt className="text-muted">Support</dt><dd className="mt-1 text-secondary">{supportLabel[evidence.support]}</dd></div>
      <div><dt className="text-muted">Integrity</dt><dd className="mt-1 text-secondary">{integrityLabel[evidence.integrity]}</dd></div>
      <div><dt className="text-muted">Freshness</dt><dd className="mt-1 text-secondary">Not evaluated</dd></div>
      <div><dt className="text-muted">Access / conflict</dt><dd className="mt-1 text-secondary">Available / Not evaluated</dd></div>
    </dl>
    <details className="rounded border border-border bg-surface p-3"><summary className="cursor-pointer text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Provenance</summary><p className="mt-3 text-sm text-secondary">{evidence.provenanceSummary}</p></details>
    <details className="rounded border border-border bg-surface p-3"><summary className="cursor-pointer text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Observation and subject</summary><div className="mt-3 text-sm text-secondary">{evidence.sourceObservation ? <><p>Outcome: {outcomeLabel[evidence.sourceObservation.outcome]}. Position: {evidence.sourceObservation.position}.</p><Link className="mt-2 inline-block break-all font-mono text-brand underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={evidence.sourceObservation.href}>Observation {evidence.sourceObservation.id}</Link></> : <p>No source observation identity applies to this onboarding evidence.</p>}</div></details>
    <details className="rounded border border-border bg-surface p-3"><summary className="cursor-pointer text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Usage and model linkage</summary>{evidence.sourceModels.length ? <ul className="mt-3 space-y-2 text-sm text-secondary">{evidence.sourceModels.map(model => <li key={model.rowId}><Link className="text-brand underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={model.href}>Model {model.version}, row {model.rowId}</Link> — {model.lifecycle}</li>)}</ul> : <p className="mt-3 text-sm text-muted">No exact model reference is established.</p>}<p className="mt-3 text-xs text-muted">Certified view usage: {evidence.usageReferences.length ? evidence.usageReferences.map(item => item.replaceAll('_', ' ')).join(', ') : 'none established'}.</p></details>
    <details className="rounded border border-border bg-surface p-3"><summary className="cursor-pointer text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Integrity and freshness</summary><p className="mt-3 text-sm text-secondary">Integrity: {integrityLabel[evidence.integrity]}. Freshness: Not evaluated. Evidence availability and usage do not establish recency or completeness.</p></details>
    <details className="rounded border border-border bg-surface p-3"><summary className="cursor-pointer text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Conflicts</summary><p className="mt-3 text-sm text-secondary">Conflict: Not evaluated. No agreement is inferred from evidence quantity or current usage.</p></details>
    <details className="rounded border border-border bg-surface p-3"><summary className="cursor-pointer text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Limitations and unknowns</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><ul className="space-y-1 text-sm text-secondary">{evidence.limitations.map(item => <li key={item}>• {item}</li>)}</ul><ul className="space-y-1 text-sm text-secondary">{evidence.unknowns.map(item => <li key={item}>• {item}</li>)}</ul></div></details>
  </section>
}

function ViewControl({ evidence, expanded, controls, onSelect }: { evidence: EvidenceLedgerRecord; expanded: boolean; controls: string; onSelect: () => void }) {
  return <button type="button" aria-expanded={expanded} aria-controls={controls} aria-current={expanded ? 'true' : undefined} aria-label={`View evidence ${evidence.id}`} onClick={event => { event.stopPropagation(); onSelect() }} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expanded ? 'Selected — collapse' : 'View'}</button>
}

export function ApplicationEvidence({ readModel, selectedEvidenceId, onSelect, onPrevious, onNext, filterToolbar, isPageLoading = false }: {
  readModel: ApplicationEvidenceReadModel
  selectedEvidenceId: string | null
  onSelect: (evidenceId: string) => void
  onPrevious: () => void
  onNext: () => void
  filterToolbar: ReactNode
  isPageLoading?: boolean
}) {
  return <div className="space-y-6" data-testid="application-evidence">
    <header><p className="text-xs uppercase tracking-[0.18em] text-brand">Evidence</p><h1 className="mt-1 text-2xl font-semibold text-primary">Unified evidence ledger</h1><p className="mt-1 text-sm text-secondary">A bounded inventory of persisted evidence for {readModel.project.name}. Evidence existence and quantity do not establish application completeness.</p></header>
    {filterToolbar}
    <section aria-labelledby="evidence-ledger-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div className="flex items-center gap-2"><FileSearch size={18} className="text-brand" /><div><p className="text-xs uppercase tracking-[0.16em] text-muted">Read-only projection</p><h2 id="evidence-ledger-heading" className="text-xl font-semibold text-primary">Evidence records</h2></div></div><div className="text-right text-sm text-secondary"><p>Total ledger evidence: <strong className="text-primary">{readModel.page.projectTotal}</strong> · Filtered evidence: <strong className="text-primary">{readModel.page.filteredTotal}</strong></p><p className="text-xs text-muted">Current support: {readModel.page.currentSupportTotal} · Historical support: {readModel.page.historicalSupportTotal}</p></div></div>
      {readModel.page.projectTotal === 0 ? <div className="rounded-lg border border-border bg-surface p-8 text-center"><CircleHelp size={22} className="mx-auto text-unknown" /><p className="mt-3 text-sm text-secondary">No evidence is persisted for this project.</p><p className="mt-1 text-xs text-muted">No application coverage or understanding is inferred.</p></div> : readModel.page.filteredTotal === 0 ? <div className="rounded-lg border border-border bg-surface p-8 text-center"><p className="text-sm text-secondary">No evidence matches the selected filters.</p><p className="mt-1 text-xs text-muted">The project still has {readModel.page.projectTotal} total evidence records.</p></div> : <>
        {/* The breakpoint changes presentation, not selection: flatMap keeps one adjacent detail row in either mode. */}
        <div className="overflow-hidden rounded-lg border border-border"><table className="block w-full border-collapse text-left text-sm xl:table"><thead className="hidden bg-elevated text-xs uppercase tracking-wide text-muted xl:table-header-group"><tr><th className="px-3 py-3">Evidence</th><th className="px-3 py-3">Captured</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Subject</th><th className="px-3 py-3">Observation</th><th className="px-3 py-3">Usage</th><th className="px-3 py-3">Integrity</th><th className="px-3 py-3">Freshness</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="block space-y-2 p-2 xl:table-row-group xl:space-y-0 xl:p-0">{readModel.evidence.flatMap(evidence => {
          const expanded = selectedEvidenceId === evidence.id
          const detailId = `evidence-detail-${evidence.id}`
          const mobile = (label: string) => <span className="mr-2 font-medium text-muted xl:hidden">{label}:</span>
          return [<tr key={`row-${evidence.id}`} aria-selected={expanded} onClick={() => onSelect(evidence.id)} className={`block cursor-pointer rounded border border-border bg-surface py-2 hover:bg-elevated xl:table-row xl:rounded-none xl:border-x-0 xl:border-b-0 ${expanded ? 'font-medium ring-1 ring-inset ring-brand' : ''}`}><td className="block px-3 py-2 xl:table-cell xl:py-3"><div className="flex items-center justify-between gap-2 xl:block"><ViewControl evidence={evidence} expanded={expanded} controls={detailId} onSelect={() => onSelect(evidence.id)} /><span className="break-all font-mono text-xs xl:mt-2 xl:block">{evidence.id}</span></div></td><td className="block px-3 py-1 xl:table-cell xl:py-3">{mobile('Captured')}<ExactTime value={evidence.capturedAt} /></td><td className="block px-3 py-1 xl:table-cell xl:py-3">{mobile('Source')}{sourceLabel[evidence.sourceClass]}</td><td className="block break-all px-3 py-1 font-mono text-xs xl:table-cell xl:py-3">{mobile('Subject')}{evidence.canonicalSubjectId}</td><td className="block break-all px-3 py-1 font-mono text-xs xl:table-cell xl:py-3">{mobile('Observation')}{evidence.sourceObservation?.id ?? 'Not applicable'}</td><td className="block px-3 py-1 xl:table-cell xl:py-3">{mobile('Usage')}{supportLabel[evidence.support]}</td><td className="block px-3 py-1 xl:table-cell xl:py-3">{mobile('Integrity')}{integrityLabel[evidence.integrity]}</td><td className="block px-3 py-1 xl:table-cell xl:py-3">{mobile('Freshness')}Not evaluated</td><td className="block px-3 py-1 xl:table-cell xl:py-3">{mobile('Status')}{evidence.status === 'available' ? 'Available' : 'Integrity failed'}</td></tr>, expanded && <tr key={`detail-${evidence.id}`} className="block border-border xl:table-row xl:border-t"><td colSpan={9} className="block bg-elevated/50 p-2 xl:table-cell xl:p-3"><EvidenceDetails evidence={evidence} id={detailId} /></td></tr>].filter(Boolean) as JSX.Element[]
        })}</tbody></table></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Showing {readModel.evidence.length} matching evidence record{readModel.evidence.length === 1 ? '' : 's'} on this bounded page.{readModel.page.nextCursor ? ' More matching evidence is available.' : ' All matching evidence on this result set is loaded.'}</p><div className="flex gap-2"><button type="button" onClick={onPrevious} disabled={!readModel.page.hasPrevious || isPageLoading} className="rounded border border-border px-3 py-2 text-sm text-primary outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">Previous</button><button type="button" onClick={onNext} disabled={!readModel.page.nextCursor || isPageLoading} className="rounded border border-border px-3 py-2 text-sm text-primary outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">Next</button></div></div>
      </>}
      <p className="sr-only" aria-live="polite">{selectedEvidenceId ? `Evidence ${selectedEvidenceId} details selected.` : 'Evidence details collapsed.'}</p>
    </section>
    <p className="rounded border border-border bg-surface p-4 text-sm text-secondary">Freshness: Not evaluated. Coverage: Unknown. Current support, lifecycle, integrity, accessibility, conflict, and source outcome are independent dimensions.</p>
  </div>
}
