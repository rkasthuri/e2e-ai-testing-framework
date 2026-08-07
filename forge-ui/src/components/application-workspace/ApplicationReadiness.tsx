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

import { CircleAlert, FileCheck2, ShieldQuestion } from 'lucide-react'
import React from 'react'
import { Link } from 'react-router-dom'
import type {
  ApplicationReadinessDecision,
  ApplicationReadinessResponse,
  ApplicationReadinessState,
} from '../../api/types'

const STATE_LABEL: Record<ApplicationReadinessState, string> = {
  supported: 'Supported',
  supported_with_constraints: 'Supported with constraints',
  blocked: 'Blocked',
  unknown: 'Unknown',
}

function ExactTime({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{new Date(value).toLocaleString()}</time>
}

function TextList({ values, empty }: { values: string[]; empty: string }) {
  return values.length
    ? <ul className="mt-2 space-y-1 text-sm text-secondary">{values.map(value => <li key={value}>• {value}</li>)}</ul>
    : <p className="mt-2 text-sm text-muted">{empty}</p>
}

function disclosureKeyDown(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== ' ') return
  event.preventDefault()
  const details = event.currentTarget.parentElement as HTMLDetailsElement | null
  if (details) details.open = !details.open
}

function DecisionCard({ decision }: { decision: ApplicationReadinessDecision }) {
  const detailId = `readiness-${decision.id}`
  return <article aria-labelledby={`${detailId}-heading`} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-xs uppercase tracking-[0.16em] text-muted">Decision readiness</p><h3 id={`${detailId}-heading`} className="mt-1 text-lg font-semibold text-primary">{decision.label}</h3></div>
      <span className="rounded-full border border-border bg-elevated px-3 py-1 text-sm font-semibold text-primary" role="status">{STATE_LABEL[decision.state]}</span>
    </div>
    <p className="mt-3 text-sm leading-6 text-secondary">{decision.explanation}</p>
    <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
      <div className="rounded border border-border bg-elevated p-3"><dt className="font-medium text-primary">What prevented a stronger state</dt><dd className="mt-1 text-secondary">{decision.preventedStrongerState}</dd></div>
      <div className="rounded border border-border bg-elevated p-3"><dt className="font-medium text-primary">Safe next action</dt><dd className="mt-1 text-secondary">{decision.safeNextAction ? <><Link className="text-brand underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={decision.safeNextAction.href}>{decision.safeNextAction.label}</Link><span className="mt-1 block text-xs text-muted">{decision.safeNextAction.explanation}</span></> : 'No action is supportable from the available evidence.'}</dd></div>
    </dl>
    <div className="mt-4 grid gap-2 lg:grid-cols-2">
      <details className="rounded border border-border bg-elevated p-3"><summary onKeyDown={disclosureKeyDown} className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Supporting evidence ({decision.supportingEvidence.length})</summary>{decision.supportingEvidence.length ? <ul className="mt-3 space-y-2 text-sm">{decision.supportingEvidence.map(reference => <li key={`${reference.kind}-${reference.id}`}><Link className="break-all text-brand underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={reference.href}>{reference.label}</Link><span className="ml-2 text-xs text-muted">Integrity: {reference.integrity.replaceAll('_', ' ')} · Freshness: not evaluated</span></li>)}</ul> : <p className="mt-2 text-sm text-muted">No exact supporting evidence reference is established.</p>}</details>
      <details className="rounded border border-border bg-elevated p-3"><summary onKeyDown={disclosureKeyDown} className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Blockers ({decision.blockers.length})</summary><TextList values={decision.blockers} empty="No established blocker is present in this bounded decision projection." /></details>
      <details className="rounded border border-border bg-elevated p-3"><summary onKeyDown={disclosureKeyDown} className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Material unknowns ({decision.unknowns.length})</summary><TextList values={decision.unknowns} empty="No additional material unknown is recorded for this decision." /></details>
      <details className="rounded border border-border bg-elevated p-3"><summary onKeyDown={disclosureKeyDown} className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Limitations ({decision.limitations.length})</summary><TextList values={decision.limitations} empty="No additional limitation is recorded for this decision." /></details>
    </div>
  </article>
}

export function ApplicationReadiness({ readModel }: { readModel: ApplicationReadinessResponse }) {
  const snapshot = readModel.authoritySnapshot
  return <div className="space-y-6" data-testid="application-readiness">
    <header><p className="text-xs uppercase tracking-[0.18em] text-brand">Readiness</p><h2 className="mt-1 text-2xl font-semibold text-primary">Evidence-backed next decisions</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-secondary">Readiness is evaluated independently for each decision. It does not summarize the application as a single graded condition or infer broad application coverage from the existence or quantity of records.</p>{readModel.asOf && <p className="mt-2 text-xs text-muted">Projection as of <ExactTime value={readModel.asOf} /></p>}</header>

    <section aria-labelledby="readiness-authorities" className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2"><FileCheck2 size={18} className="text-brand" /><h2 id="readiness-authorities" className="text-lg font-semibold text-primary">Authority snapshot</h2></div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Latest observation</dt><dd className="mt-1 text-secondary">{snapshot.latestObservation ? <><Link className="break-all text-brand hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={snapshot.latestObservation.href}>{snapshot.latestObservation.id}</Link><span className="mt-1 block">Outcome: {snapshot.latestObservation.outcome.replaceAll('_', ' ')} · {snapshot.latestObservation.subjectIds.length} subjects · {snapshot.latestObservation.evidenceCount} evidence records</span><span className="mt-1 block">Authentication: {snapshot.latestObservation.authenticationOutcome?.replaceAll('_', ' ') ?? 'not available'} · Credential availability: {snapshot.latestObservation.credentialAvailability.replaceAll('_', ' ')}</span></> : 'Not available'}</dd></div>
        <div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Active model</dt><dd className="mt-1 text-secondary">{snapshot.activeModel ? <><Link className="text-brand hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={snapshot.activeModel.href}>Version {snapshot.activeModel.version}, row {snapshot.activeModel.rowId}</Link><span className="mt-1 block">Validation: {snapshot.activeModel.validation} · Integrity: {snapshot.activeModel.integrity.replaceAll('_', ' ')} · Projection: {snapshot.activeModel.projection.replaceAll('_', ' ')}</span><span className="mt-1 block">{snapshot.activeModel.subjectIds.length} bounded subjects</span></> : 'Not available'}</dd></div>
        <div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Evidence inventory</dt><dd className="mt-1 text-secondary"><Link className="text-brand hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={snapshot.evidence.href}>{snapshot.evidence.total} ledger records</Link><span className="mt-1 block">{snapshot.evidence.currentSupport} current support · {snapshot.evidence.historicalSupport} historical support</span></dd></div>
        <div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Assessment boundaries</dt><dd className="mt-1 text-secondary">Freshness: Not evaluated<br />Coverage: Unknown<br />Unobserved scope: Unknown<br />Evidence conflict: {snapshot.boundaries.conflict === 'conflicting' ? 'Conflicting' : 'Not evaluated'}<br />AI enrichment: {snapshot.boundaries.aiEnrichment === 'limited' ? 'Limited' : 'Not evaluated'}</dd></div>
      </dl>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-2"><p className="rounded border border-border p-3 text-secondary"><strong className="text-primary">Project Status remains separate.</strong> {snapshot.projectStatus.explanation} <Link className="text-brand hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={snapshot.projectStatus.href}>Open Overview</Link></p><p className="rounded border border-border p-3 text-secondary"><strong className="text-primary">Truth Confidence remains separate.</strong> {snapshot.truthConfidence.explanation} <Link className="text-brand hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" to={snapshot.truthConfidence.href}>Open Overview</Link></p></div>
    </section>

    <section aria-labelledby="readiness-decisions"><div className="mb-3 flex items-center gap-2"><ShieldQuestion size={18} className="text-brand" /><h2 id="readiness-decisions" className="text-xl font-semibold text-primary">Decision assessments</h2></div><div className="grid gap-4">{readModel.decisions.map(decision => <DecisionCard key={decision.id} decision={decision} />)}</div></section>

    <aside className="rounded-lg border border-unknown/40 bg-surface p-4" aria-label="Readiness limitations"><div className="flex items-center gap-2"><CircleAlert size={18} className="text-unknown" /><h2 className="font-semibold text-primary">Projection limitations</h2></div><TextList values={readModel.limitations} empty="No projection limitation was supplied." /><p className="mt-3 text-xs text-muted">{readModel.provenance.explanation}</p></aside>
  </div>
}
