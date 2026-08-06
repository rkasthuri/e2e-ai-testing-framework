import { AlertCircle, ArrowRight, CircleHelp, Clock3, FileSearch, History, ShieldAlert } from 'lucide-react'
import type { ObservationRecord, ApplicationObservationsReadModel } from './observationsTypes'

const stateLabel: Record<ObservationRecord['state'], string> = {
  current: 'Current', stale: 'Stale', failed: 'Failed', blocked: 'Blocked', incomplete: 'Incomplete', unknown: 'Unknown',
}

function ObservationState({ observation }: { observation: ObservationRecord }) {
  const color = observation.state === 'current' ? 'text-pass' : observation.state === 'stale' || observation.state === 'incomplete' ? 'text-flaky' : 'text-unknown'
  return <span className={`rounded-full border border-border px-2 py-1 text-xs ${color}`}>{stateLabel[observation.state]}</span>
}

function ObservationDetails({ observation, current }: { observation: ObservationRecord; current: boolean }) {
  return (
    <article className={`rounded-lg border border-border bg-surface p-5 ${current ? 'ring-1 ring-brand/40' : ''}`} data-observation-id={observation.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs uppercase tracking-[0.16em] text-muted">{current ? 'Current observation' : 'Historical observation'}</p><h3 className="mt-1 text-lg font-semibold text-primary">{observation.id}</h3></div>
        <ObservationState observation={observation} />
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs uppercase tracking-wide text-muted">Context</dt><dd className="mt-1 text-secondary">{observation.contextLabel}{observation.contextId ? ` (${observation.contextId})` : ''}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Started</dt><dd className="mt-1 text-secondary">{observation.startedAt ?? 'Not captured'}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Completed</dt><dd className="mt-1 text-secondary">{observation.completedAt ?? 'Not completed'}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Source / run</dt><dd className="mt-1 text-secondary">{observation.source}</dd></div>
      </dl>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div><p className="text-xs uppercase tracking-wide text-muted">Why this state</p><p className="mt-1 text-sm text-secondary">{observation.why}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-muted">Observed subject</p><p className="mt-1 text-sm text-secondary">{observation.observedSubject}</p></div>
      </div>
      <div className="mt-4 rounded border border-border bg-elevated p-3"><p className="text-xs uppercase tracking-wide text-muted">Observed scope</p><p className="mt-1 text-sm text-secondary">{observation.observedScope}</p>{observation.unobservedScope.length > 0 && <><p className="mt-3 text-xs uppercase tracking-wide text-muted">Unobserved scope</p><ul className="mt-1 space-y-1 text-xs text-secondary">{observation.unobservedScope.map(item => <li key={item}>· {item}</li>)}</ul></>}</div>
      {observation.preventedStrongerState && <p className="mt-4 border-l-2 border-unknown pl-3 text-xs text-unknown">Prevents a stronger state: {observation.preventedStrongerState}</p>}
      {observation.limitations.length > 0 && <div className="mt-4 rounded border border-flaky/40 bg-elevated p-3"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-flaky"><AlertCircle size={14} /> Limitations</p><ul className="mt-2 space-y-1 text-xs text-secondary">{observation.limitations.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {(observation.blockers.length > 0 || observation.unknowns.length > 0) && <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">{observation.blockers.length > 0 && <div className="rounded border border-fail/40 bg-elevated p-3"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fail"><ShieldAlert size={14} /> Blockers</p><ul className="mt-2 space-y-1 text-xs text-secondary">{observation.blockers.map(item => <li key={item}>{item}</li>)}</ul></div>}{observation.unknowns.length > 0 && <div className="rounded border border-unknown/40 bg-elevated p-3"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-unknown"><CircleHelp size={14} /> Unknowns</p><ul className="mt-2 space-y-1 text-xs text-secondary">{observation.unknowns.map(item => <li key={item}>{item}</li>)}</ul></div>}</div>}
      <div className="mt-4 border-t border-border pt-3"><p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted"><FileSearch size={13} /> Evidence</p><p className="mt-1 text-sm text-secondary">{observation.evidenceSummary}</p><p className="mt-2 font-mono text-xs text-muted">{observation.evidenceIds.length > 0 ? observation.evidenceIds.join(', ') : 'No evidence references'}</p><p className="mt-1 text-xs text-muted">States: {observation.evidenceStates.length > 0 ? observation.evidenceStates.join(', ') : 'none supplied'}</p></div>
      {observation.safeRecommendation ? <div className="mt-4 flex gap-2 border-t border-border pt-3 text-sm text-secondary"><ArrowRight size={16} className="mt-0.5 shrink-0 text-brand" /><span><strong className="text-primary">Next: {observation.safeRecommendation.action}</strong><span className="mt-1 block text-xs text-muted">Because: {observation.safeRecommendation.because}</span></span></div> : <p className="mt-4 flex gap-2 border-t border-border pt-3 text-xs text-muted"><AlertCircle size={14} className="mt-0.5 shrink-0 text-unknown" />No safe recommendation is available for this observation.</p>}
    </article>
  )
}

export function ApplicationObservations({ readModel }: { readModel: ApplicationObservationsReadModel }) {
  const current = readModel.observations.find(observation => observation.isCurrent)
  const history = readModel.observations.filter(observation => !observation.isCurrent)
  return (
    <div className="space-y-6" data-testid="application-observations">
      <header><p className="text-xs uppercase tracking-[0.18em] text-brand">Observations</p><h1 className="mt-1 text-2xl font-semibold text-primary">What FORGE observed</h1><p className="mt-1 text-sm text-secondary">Transparent observation history for {readModel.project.displayName}. Unobserved scope is not treated as healthy.</p></header>
      {!current && readModel.observations.length === 0 && <section className="rounded-lg border border-border bg-surface p-8 text-center"><Clock3 size={22} className="mx-auto text-unknown" /><h2 className="mt-3 text-lg font-semibold text-primary">No observations yet</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">FORGE has no observation or run evidence for this application. Current state, coverage, and completeness remain unknown.</p></section>}
      {current && <section aria-labelledby="current-observation"><div className="mb-3 flex items-center gap-2"><Clock3 size={16} className="text-brand" /><h2 id="current-observation" className="text-sm font-semibold uppercase tracking-[0.16em] text-secondary">Current observation</h2></div><ObservationDetails observation={current} current /></section>}
      {history.length > 0 && <section aria-labelledby="observation-history"><div className="mb-3 flex items-center gap-2"><History size={16} className="text-brand" /><h2 id="observation-history" className="text-sm font-semibold uppercase tracking-[0.16em] text-secondary">Observation history</h2></div><div className="space-y-4">{history.map(observation => <ObservationDetails key={observation.id} observation={observation} current={false} />)}</div></section>}
      <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="observation-limitations"><p className="text-xs uppercase tracking-[0.16em] text-muted">Coverage and limitations</p><h2 id="observation-limitations" className="mt-1 text-xl font-semibold text-primary">What remains bounded</h2><p className="mt-3 text-sm text-secondary">{current ? 'The current observation declares its observed and unobserved scope above. Authentication, access, freshness, conflicts, and integrity limitations remain attached to the observation that produced them.' : 'No current observation exists, so no observed scope can be asserted.'}</p></section>
    </div>
  )
}
