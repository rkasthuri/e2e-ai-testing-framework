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

import { AlertCircle, ArrowRight, CircleHelp, FileSearch, LockKeyhole, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ApplicationOverviewReadModel, OverviewEvidence } from './types'

const freshnessLabel: Record<OverviewEvidence['freshness'], string> = {
  current: 'Current', stale: 'Stale', expired: 'Expired', unknown: 'Not evaluated',
}

function readableTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function EvidenceRow({ evidence }: { evidence: OverviewEvidence }) {
  const stateClass = evidence.state === 'current' ? 'text-pass' : evidence.state === 'stale' || evidence.state === 'integrity-failed' ? 'text-flaky' : 'text-unknown'
  return (
    <li className="border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2"><FileSearch size={15} className="mt-0.5 text-muted" /><div><p className="font-mono text-xs text-primary">{evidence.id}</p><p className="mt-1 text-sm text-secondary">{evidence.summary}</p></div></div>
        <span className={`rounded-full border border-border px-2 py-1 text-xs ${stateClass}`}>Freshness: {freshnessLabel[evidence.freshness]}</span>
      </div>
      <p className="mt-2 pl-6 text-xs text-muted">Provenance: {evidence.provenance}</p>
      {evidence.capturedAt && <p className="mt-1 pl-6 text-xs text-muted">Captured: <time dateTime={evidence.capturedAt} title={evidence.capturedAt}>{readableTimestamp(evidence.capturedAt)}</time></p>}
      <p className="mt-1 pl-6 text-xs text-secondary">Confidence: {evidence.confidence}. Reason: {evidence.confidenceReason}</p>
      {evidence.detail && <p className="mt-1 pl-6 text-xs text-secondary">{evidence.detail}</p>}
    </li>
  )
}

export function ApplicationOverview({ readModel }: { readModel: ApplicationOverviewReadModel }) {
  const projectStatus = readModel.sections.find(section => section.key === 'project-status')
  const truthConfidence = readModel.sections.find(section => section.key === 'truth-confidence')
  const materialUnknowns = truthConfidence?.unknowns.filter(item => item.severity !== 'informational') ?? []
  const safeRecommendations = readModel.recommendations.filter(item => item.safe)

  return (
    <div className="space-y-6" data-testid="application-overview">
      <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="application-identity">
        <p className="text-xs uppercase tracking-[0.18em] text-brand">Application</p>
        <h2 id="application-identity" className="mt-1 text-2xl font-semibold text-primary">{readModel.project.displayName}</h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs uppercase tracking-wide text-muted">Project identity</dt><dd className="mt-1 font-mono text-secondary">{readModel.project.projectId}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-muted">Application URL</dt><dd className="mt-1 break-words text-secondary">{readModel.applicationUrl}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-muted">Kind</dt><dd className="mt-1 text-secondary">{readModel.project.applicationKind}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-muted">Observation boundary</dt><dd className="mt-1 break-words text-secondary">{readModel.observationContext.boundary}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-muted">Observation context</dt><dd className="mt-1 text-secondary">{readModel.observationContext.label}{readModel.observationContext.id ? ` (${readModel.observationContext.id})` : ''}</dd></div>
          <div><dt className="text-xs uppercase tracking-wide text-muted">As of</dt><dd className="mt-1 text-secondary"><time dateTime={readModel.asOf} title={readModel.asOf}>{readableTimestamp(readModel.asOf)}</time></dd></div>
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="project-status">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Project Status</p>
          <h2 id="project-status" className="mt-1 text-xl font-semibold text-primary">{readModel.project.lifecycleState}</h2>
          <p className="mt-3 text-sm text-secondary">{projectStatus?.why ?? 'Project status explanation is not available.'}</p>
          {projectStatus?.preventedHigherState && <p className="mt-4 border-l-2 border-unknown pl-3 text-xs text-unknown">Prevents next state: {projectStatus.preventedHigherState}</p>}
          <p className="mt-4 text-sm text-secondary">Impact: {projectStatus?.impact ?? 'Impact is unknown.'}</p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="truth-confidence">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Truth Confidence</p>
          <h2 id="truth-confidence" className="mt-1 text-xl font-semibold text-primary">{truthConfidence?.confidence ?? readModel.truthConfidence.level}</h2>
          <p className="mt-3 text-sm text-secondary">{truthConfidence?.why ?? readModel.truthConfidence.why}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">{readModel.confidenceDimensions.map(dimension => <div key={dimension.key} className="rounded border border-border bg-elevated p-2"><dt className="text-muted">{dimension.label}</dt><dd className="mt-1 text-secondary">{dimension.state}</dd><dd className="mt-1 text-[11px] leading-4 text-muted">{dimension.explanation}</dd></div>)}</dl>
          {materialUnknowns.length > 0 && <div className="mt-4 rounded border border-unknown/40 bg-elevated p-3"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-unknown"><CircleHelp size={14} /> Material unknowns</p><ul className="mt-2 space-y-1 text-xs text-secondary">{materialUnknowns.map(item => <li key={item.id}>{item.subject}: {item.reason}</li>)}</ul></div>}
        </section>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="current-understanding">
        <p className="text-xs uppercase tracking-[0.16em] text-muted">Current understanding</p>
        <h2 id="current-understanding" className="mt-1 text-xl font-semibold text-primary">What FORGE has observed</h2>
        <p className="mt-3 text-sm text-secondary">{readModel.currentUnderstanding.latestObservationSummary}</p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded border border-border bg-elevated p-4"><p className="text-xs uppercase tracking-wide text-muted">Application Model</p><p className="mt-1 text-sm text-primary">{readModel.currentUnderstanding.applicationModel.state} · {readModel.currentUnderstanding.applicationModel.currency}</p><p className="mt-2 text-xs text-secondary">{readModel.currentUnderstanding.applicationModel.summary}</p></div>
          <div className="rounded border border-border bg-elevated p-4"><p className="text-xs uppercase tracking-wide text-muted">Limitations</p>{readModel.currentUnderstanding.limitations.length === 0 ? <p className="mt-2 text-sm text-muted">No additional limitations supplied.</p> : <ul className="mt-2 space-y-1 text-xs text-secondary">{readModel.currentUnderstanding.limitations.map(item => <li key={item}>· {item}</li>)}</ul>}</div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="next-action">
        <p className="text-xs uppercase tracking-[0.16em] text-muted">Recommended next action</p>
        <h2 id="next-action" className="mt-1 text-xl font-semibold text-primary">Evidence-backed next steps</h2>
        {safeRecommendations.length === 0
          ? <p className="mt-3 flex items-center gap-2 text-sm text-secondary"><AlertCircle size={16} className="text-unknown" /> No safe recommendation is available from the current evidence.</p>
          : <ul className="mt-3 space-y-3">
              {safeRecommendations.map(item => <li key={item.id}>
                {item.destination?.kind === 'internal-route'
                  ? <Link
                      to={item.destination.href}
                      aria-label={`${item.action} for ${readModel.project.displayName}`}
                      className="flex gap-3 rounded border border-border bg-elevated p-3 transition-colors hover:border-brand hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      <ArrowRight size={16} className="mt-0.5 shrink-0 text-brand" />
                      <span className="text-sm text-secondary"><strong className="text-primary">{item.action}</strong><span className="mt-1 block text-xs text-muted">Because: {item.because}</span></span>
                    </Link>
                  : <div className="flex gap-3 rounded border border-border bg-elevated p-3">
                      <AlertCircle size={16} className="mt-0.5 shrink-0 text-unknown" />
                      <span className="text-sm text-secondary"><strong className="text-primary">{item.action}</strong><span className="ml-2 rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">Informational</span><span className="mt-1 block text-xs text-muted">Because: {item.because} No supported action destination is available.</span></span>
                    </div>}
              </li>)}
            </ul>}
      </section>

      <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="evidence-visibility">
        <div className="flex items-center gap-2"><LockKeyhole size={16} className="text-brand" /><div><p className="text-xs uppercase tracking-[0.16em] text-muted">Evidence visibility</p><h2 id="evidence-visibility" className="mt-1 text-xl font-semibold text-primary">What supports this view</h2></div></div>
        {readModel.evidence.length === 0 ? <p className="mt-4 text-sm text-secondary">No evidence is available. Current claims remain unknown.</p> : <ul className="mt-3"><>{readModel.evidence.map(item => <EvidenceRow key={item.id} evidence={item} />)}</></ul>}
      </section>

      {projectStatus?.blockers.length ? <div className="flex gap-2 rounded border border-fail/40 bg-elevated p-4 text-sm text-secondary"><ShieldAlert size={17} className="mt-0.5 shrink-0 text-fail" /><span><strong className="text-primary">Access or project blockers remain visible.</strong> {projectStatus.blockers.map(item => item.reason).join(' ')}</span></div> : null}
    </div>
  )
}
