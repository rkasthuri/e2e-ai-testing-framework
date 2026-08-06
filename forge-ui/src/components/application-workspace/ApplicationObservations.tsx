/**
 * FORGE â€” Autonomous Quality Engineering
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

import React from 'react'
import {
  AlertCircle,
  ArrowRight,
  CircleHelp,
  Clock3,
  FileSearch,
  History,
  KeyRound,
  ShieldAlert,
} from 'lucide-react'
import type {
  ApplicationObservationsReadModel,
  ObservationRecordReadModel,
} from './observationsTypes'

const stateLabel: Record<ObservationRecordReadModel['terminalState'], string> = {
  completed: 'Completed',
  partially_completed: 'Partially completed',
  blocked: 'Blocked',
  failed: 'Failed',
  unknown: 'Unknown',
  interrupted: 'Interrupted',
}

function stateColor(observation: ObservationRecordReadModel): string {
  if (observation.terminalState === 'completed') return 'text-pass'
  if (observation.terminalState === 'partially_completed') return 'text-flaky'
  if (observation.terminalState === 'failed' || observation.terminalState === 'blocked') return 'text-fail'
  return 'text-unknown'
}

function TerminalState({ observation }: { observation: ObservationRecordReadModel }) {
  return <span className={`rounded-full border border-border px-2 py-1 text-xs ${stateColor(observation)}`}>{stateLabel[observation.terminalState]}</span>
}

function SemanticTime({ value, absent, compact = false }: { value: string | null; absent: string; compact?: boolean }) {
  if (!value) return <span>{absent}</span>
  const human = new Intl.DateTimeFormat(undefined, compact
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  return <time dateTime={value} title={value}>{human}</time>
}

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="rounded border border-border bg-elevated">
      <summary className="cursor-pointer rounded px-3 py-2 text-sm font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
        {label}
      </summary>
      <div className="border-t border-border px-3 py-3">{children}</div>
    </details>
  )
}

function AuthenticationStages({ observation }: { observation: ObservationRecordReadModel }) {
  const attempts = observation.authentication.attempts
  return (
    <div>
      <p className="text-xs font-medium text-primary">Authentication stage diagnostics ({attempts.reduce((count, attempt) => count + attempt.stages.length, 0)})</p>
      {attempts.length === 0
        ? <p className="text-xs text-muted">No authentication-stage diagnostics were safely available.</p>
        : <div className="space-y-4">{attempts.map(attempt => (
          <section key={attempt.roleId} aria-label={`Authentication ${attempt.roleId}`}>
            <p className="font-mono text-xs text-primary">{attempt.roleId}</p>
            <p className="mt-1 text-xs text-secondary">Attempt outcome: {attempt.outcome}</p>
            <ol className="mt-2 space-y-2">{attempt.stages.map(stage => (
              <li key={stage.stage} className="rounded border border-border p-2 text-xs text-secondary">
                <p><span className="font-medium text-primary">{stage.stage}</span> â€” {stage.outcome}</p>
                <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                  <div><dt className="inline text-muted">Selector strategy: </dt><dd className="inline">{stage.selectorStrategyCategory}</dd></div>
                  {stage.matchCount !== undefined && <div><dt className="inline text-muted">Match count: </dt><dd className="inline">{stage.matchCount}</dd></div>}
                  {stage.controlVisible !== undefined && <div><dt className="inline text-muted">Control visible: </dt><dd className="inline">{String(stage.controlVisible)}</dd></div>}
                  {(stage.usernameEntryCompleted !== undefined || stage.passwordEntryCompleted !== undefined) && <div><dt className="inline text-muted">Value entry completed: </dt><dd className="inline">username {String(stage.usernameEntryCompleted ?? false)}, password {String(stage.passwordEntryCompleted ?? false)}</dd></div>}
                  {stage.submissionAttempted !== undefined && <div><dt className="inline text-muted">Submission attempted: </dt><dd className="inline">{String(stage.submissionAttempted)}</dd></div>}
                  {stage.loginSurfaceRetained !== undefined && <div><dt className="inline text-muted">Login surface retained: </dt><dd className="inline">{String(stage.loginSurfaceRetained)}</dd></div>}
                  {stage.urlClassification && <div><dt className="inline text-muted">Navigation classification: </dt><dd className="inline">{stage.urlClassification.origin}, {stage.urlClassification.path}</dd></div>}
                  {stage.safeErrorType && <div><dt className="inline text-muted">Safe error category: </dt><dd className="inline">{stage.safeErrorType}</dd></div>}
                </dl>
              </li>
            ))}</ol>
          </section>
        ))}</div>}
    </div>
  )
}

function AuthenticationSummary({ observation }: { observation: ObservationRecordReadModel }) {
  return <span><span className="block">{observation.authentication.outcome ?? 'Not persisted'}</span><span className="block text-xs text-muted">Credentials: {observation.authentication.credentialAvailability}</span></span>
}

function ObservationTable({
  observations,
  selectedId,
  onSelect,
}: {
  observations: ObservationRecordReadModel[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return <>
    <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        <thead className="bg-elevated text-xs uppercase tracking-wide text-muted"><tr>
          <th scope="col" className="px-3 py-3">Position</th>
          <th scope="col" className="px-3 py-3">Context</th>
          <th scope="col" className="px-3 py-3">Started</th>
          <th scope="col" className="px-3 py-3">Completed</th>
          <th scope="col" className="px-3 py-3">Source</th>
          <th scope="col" className="px-3 py-3">Status</th>
          <th scope="col" className="px-3 py-3">Authentication</th>
          <th scope="col" className="px-3 py-3 text-right">Subjects</th>
          <th scope="col" className="px-3 py-3 text-right">Evidence</th>
        </tr></thead>
        <tbody>{observations.map(observation => {
          const selected = observation.id === selectedId
          return <tr
            key={observation.id}
            aria-selected={selected}
            data-selected={selected ? 'true' : 'false'}
            onClick={() => onSelect(observation.id)}
            className={`cursor-pointer border-t border-border align-top hover:bg-hover ${selected ? 'bg-selected outline outline-2 outline-inset outline-brand' : ''}`}
          >
            <td className="px-3 py-3"><span className="block font-medium text-primary">{observation.position === 'latest' ? 'Latest' : 'Historical'}</span>{selected && <span className="mt-1 block text-xs font-semibold text-brand">Selected</span>}<button type="button" aria-label={`View observation ${observation.id}`} onClick={event => { event.stopPropagation(); onSelect(observation.id) }} className="mt-2 rounded text-xs text-brand underline outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface">View</button></td>
            <td className="px-3 py-3"><span className="block text-primary">{observation.contextLabel}</span><span className="block max-w-48 truncate font-mono text-xs text-muted" title={observation.id}>{observation.id}</span></td>
            <td className="whitespace-nowrap px-3 py-3 text-secondary"><SemanticTime value={observation.startedAt} absent="Not captured" compact /></td>
            <td className="whitespace-nowrap px-3 py-3 text-secondary"><SemanticTime value={observation.completedAt} absent="No terminal timestamp" compact /></td>
            <td className="px-3 py-3 text-secondary">{observation.source}</td>
            <td className="px-3 py-3"><TerminalState observation={observation} /></td>
            <td className="px-3 py-3 text-secondary"><AuthenticationSummary observation={observation} /></td>
            <td className="px-3 py-3 text-right tabular-nums text-secondary">{observation.observedSubjects.length}</td>
            <td className="px-3 py-3 text-right tabular-nums text-secondary">{observation.evidence.length}</td>
          </tr>
        })}</tbody>
      </table>
    </div>

    <div className="space-y-3 md:hidden" aria-label="Observation summaries">{observations.map(observation => {
      const selected = observation.id === selectedId
      return <button
        key={observation.id}
        type="button"
        aria-label={`View observation ${observation.id}`}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(observation.id)}
        className={`w-full rounded-lg border bg-surface p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand ${selected ? 'border-brand outline outline-1 outline-brand' : 'border-border'}`}
      >
        <div className="flex items-start justify-between gap-3"><span><span className="block text-xs uppercase tracking-wide text-muted">{observation.position === 'latest' ? 'Latest' : 'Historical'}{selected ? ' Â· Selected' : ''}</span><span className="mt-1 block break-all font-mono text-xs text-primary">{observation.id}</span></span><TerminalState observation={observation} /></div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-secondary">
          <div><dt className="text-muted">Context</dt><dd>{observation.contextLabel}</dd></div>
          <div><dt className="text-muted">Source</dt><dd>{observation.source}</dd></div>
          <div><dt className="text-muted">Started</dt><dd><SemanticTime value={observation.startedAt} absent="Not captured" compact /></dd></div>
          <div><dt className="text-muted">Completed</dt><dd><SemanticTime value={observation.completedAt} absent="No terminal timestamp" compact /></dd></div>
          <div><dt className="text-muted">Authentication</dt><dd>{observation.authentication.outcome ?? 'Not persisted'}; credentials {observation.authentication.credentialAvailability}</dd></div>
          <div><dt className="text-muted">Subjects / evidence</dt><dd>{observation.observedSubjects.length} / {observation.evidence.length}</dd></div>
        </dl>
      </button>
    })}</div>
  </>
}

function MobileLabel({ children }: { children: React.ReactNode }) {
  return <span className="mr-2 font-medium text-muted md:hidden">{children}:</span>
}

function inlineDetailId(observationId: string): string {
  return `observation-detail-${observationId}`
}

function InlineObservationTable({
  observations,
  selectedId,
  onSelect,
}: {
  observations: ObservationRecordReadModel[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return <div className="overflow-x-auto md:rounded-lg md:border md:border-border md:bg-surface">
    <table className="block w-full border-separate border-spacing-y-3 text-left text-sm md:table md:min-w-[1080px] md:border-collapse md:border-spacing-0">
      <thead className="hidden bg-elevated text-xs uppercase tracking-wide text-muted md:table-header-group"><tr>
        <th scope="col" className="px-3 py-3">Position</th>
        <th scope="col" className="px-3 py-3">Context</th>
        <th scope="col" className="px-3 py-3">Started</th>
        <th scope="col" className="px-3 py-3">Completed</th>
        <th scope="col" className="px-3 py-3">Source</th>
        <th scope="col" className="px-3 py-3">Status</th>
        <th scope="col" className="px-3 py-3">Authentication</th>
        <th scope="col" className="px-3 py-3 text-right">Subjects</th>
        <th scope="col" className="px-3 py-3 text-right">Evidence</th>
      </tr></thead>
      <tbody className="block md:table-row-group">{observations.map(observation => {
        const selected = observation.id === selectedId
        return <React.Fragment key={observation.id}><tr
          aria-selected={selected}
          data-selected={selected ? 'true' : 'false'}
          onClick={() => onSelect(observation.id)}
          className={`mb-3 block cursor-pointer rounded-lg border border-border bg-surface align-top hover:bg-hover md:mb-0 md:table-row md:rounded-none md:border-0 md:border-t ${selected ? 'outline outline-2 outline-offset-2 outline-brand md:bg-selected md:outline-offset-0 md:outline-inset' : ''}`}
        >
          <td className="block px-3 pt-3 md:table-cell md:py-3"><MobileLabel>Position</MobileLabel><span className="font-medium text-primary md:block">{observation.position === 'latest' ? 'Latest' : 'Historical'}</span>{selected && <span className="ml-2 text-xs font-semibold text-brand md:ml-0 md:mt-1 md:block">Selected</span>}<button type="button" aria-label={`View observation ${observation.id}`} aria-expanded={selected} aria-controls={inlineDetailId(observation.id)} onClick={event => { event.stopPropagation(); onSelect(observation.id) }} className="ml-2 rounded text-xs text-brand underline outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface md:ml-0 md:mt-2">{selected ? 'Hide' : 'View'}</button></td>
          <td className="block px-3 py-1 md:table-cell md:py-3"><MobileLabel>Context</MobileLabel><span className="text-primary md:block">{observation.contextLabel}</span><span className="ml-2 max-w-48 truncate font-mono text-xs text-muted md:ml-0 md:block" title={observation.id}>{observation.id}</span></td>
          <td className="block whitespace-nowrap px-3 py-1 text-secondary md:table-cell md:py-3"><MobileLabel>Started</MobileLabel><SemanticTime value={observation.startedAt} absent="Not captured" compact /></td>
          <td className="block whitespace-nowrap px-3 py-1 text-secondary md:table-cell md:py-3"><MobileLabel>Completed</MobileLabel><SemanticTime value={observation.completedAt} absent="No terminal timestamp" compact /></td>
          <td className="block px-3 py-1 text-secondary md:table-cell md:py-3"><MobileLabel>Source</MobileLabel>{observation.source}</td>
          <td className="block px-3 py-1 md:table-cell md:py-3"><MobileLabel>Status</MobileLabel><TerminalState observation={observation} /></td>
          <td className="block px-3 py-1 text-secondary md:table-cell md:py-3"><MobileLabel>Authentication</MobileLabel><AuthenticationSummary observation={observation} /></td>
          <td className="block px-3 py-1 tabular-nums text-secondary md:table-cell md:py-3 md:text-right"><MobileLabel>Subjects</MobileLabel>{observation.observedSubjects.length}</td>
          <td className="block px-3 pb-3 pt-1 tabular-nums text-secondary md:table-cell md:py-3 md:text-right"><MobileLabel>Evidence</MobileLabel>{observation.evidence.length}</td>
        </tr>{selected && <tr className="block md:table-row" data-testid="selected-observation-detail-row"><td colSpan={9} className="block pb-3 md:table-cell md:border-t md:border-border md:p-4"><InlineObservationDetails observation={observation} /></td></tr>}</React.Fragment>
      })}</tbody>
    </table>
  </div>
}

function CategorizedList({ items }: { items: ObservationRecordReadModel['limitations'] }) {
  return <ul className="mt-2 space-y-1 text-xs text-secondary">{items.map((item, index) => <li key={`${item.category}-${index}`}><span className="font-medium text-primary">{item.category}</span>: {item.explanation}{item.count > 1 ? ` (${item.count})` : ''}</li>)}</ul>
}

function SelectedObservationDetails({
  observation,
  headingRef,
}: {
  observation: ObservationRecordReadModel
  headingRef: React.RefObject<HTMLHeadingElement>
}) {
  return (
    <article className="rounded-lg border border-border bg-surface p-5" data-testid="selected-observation-detail" aria-labelledby="selected-observation-heading">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-brand">Selected observation detail</p><h2 ref={headingRef} tabIndex={-1} id="selected-observation-heading" className="mt-1 break-all font-mono text-lg font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Observation {observation.id}</h2><p className="mt-1 text-xs text-muted">Position: {observation.position === 'latest' ? 'Latest' : 'Historical'}</p></div><TerminalState observation={observation} /></div>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs uppercase tracking-wide text-muted">Context</dt><dd className="mt-1 text-secondary">{observation.contextLabel} ({observation.contextId})</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Started</dt><dd className="mt-1 text-secondary"><SemanticTime value={observation.startedAt} absent="Not captured" /></dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Completed</dt><dd className="mt-1 text-secondary"><SemanticTime value={observation.completedAt} absent="No terminal timestamp" /></dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Source / strategy</dt><dd className="mt-1 text-secondary">{observation.source} / {observation.strategy}</dd></div>
      </dl>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2"><div><p className="text-xs uppercase tracking-wide text-muted">Terminal outcome explanation</p><p className="mt-1 text-sm text-secondary">{observation.why}</p></div><div><p className="text-xs uppercase tracking-wide text-muted">Freshness</p><p className="mt-1 text-sm text-unknown">Not evaluated</p><p className="mt-1 text-xs text-muted">{observation.freshness.reason}</p></div></div>

      <section className="mt-4 rounded border border-border bg-elevated p-3" aria-label="Authentication outcome"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><KeyRound size={14} /> Authentication</p><dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted">Expectation</dt><dd className="text-secondary">{observation.authentication.expectation}</dd></div><div><dt className="text-xs text-muted">Credential availability</dt><dd className="text-secondary">{observation.authentication.credentialAvailability}</dd></div><div><dt className="text-xs text-muted">Authentication outcome</dt><dd className="text-secondary">{observation.authentication.outcome ?? 'Not persisted'}</dd></div></dl>{observation.authentication.explanation && <p className="mt-2 text-xs text-secondary">{observation.authentication.explanation}</p>}</section>

      <div className="mt-4 grid grid-cols-1 gap-3">
        <AuthenticationStages observation={observation} />
        <Disclosure label={`Observed subjects (${observation.observedSubjects.length})`}>{observation.observedSubjects.length === 0 ? <p className="text-xs text-muted">No observed subjects were safely available.</p> : <ul className="space-y-2">{observation.observedSubjects.map(subject => <li key={subject.id} className="text-sm text-secondary"><span className="font-mono text-xs text-primary">{subject.id}</span><span className="ml-2 text-xs text-muted">{subject.kind}</span><p className="mt-1 break-all">{subject.routePath ?? 'Route path not safely available'}</p><p className="mt-1 font-mono text-xs text-muted">Evidence: {subject.evidenceId}</p></li>)}</ul>}</Disclosure>
        <Disclosure label={`Evidence records (${observation.evidence.length})`}>{observation.evidence.length === 0 ? <p className="text-xs text-muted">No evidence records were safely available.</p> : <ul className="space-y-3">{observation.evidence.map(evidence => <li key={evidence.id} className="rounded border border-border p-3 text-sm text-secondary"><div className="flex flex-wrap justify-between gap-2"><span className="font-mono text-xs text-primary">{evidence.id}</span><span className="text-xs text-muted">Integrity: {evidence.integrity}</span></div><p className="mt-2">{evidence.summary}</p><p className="mt-1 text-xs text-muted">Subject: {evidence.subjectPath ?? 'Route path not safely available'}</p><p className="mt-1 text-xs text-muted">Captured <SemanticTime value={evidence.capturedAt} absent="Not captured" /> Â· {evidence.provenance.kind}: {evidence.provenance.reference}</p></li>)}</ul>}</Disclosure>
      </div>

      {observation.limitations.length > 0 && <section className="mt-4 rounded border border-flaky/40 bg-elevated p-3"><p className="text-xs font-semibold uppercase tracking-wide text-flaky">Unobserved scope and limitations</p><CategorizedList items={observation.limitations} /></section>}
      {(observation.blockers.length > 0 || observation.unknowns.length > 0) && <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">{observation.blockers.length > 0 && <section className="rounded border border-fail/40 bg-elevated p-3"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fail"><ShieldAlert size={14} /> Blockers</p><CategorizedList items={observation.blockers} /></section>}{observation.unknowns.length > 0 && <section className="rounded border border-unknown/40 bg-elevated p-3"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-unknown"><CircleHelp size={14} /> Unknowns</p><CategorizedList items={observation.unknowns} /></section>}</div>}

      {(observation.modelRecovery || observation.modelRecoveryFailure) && <div className="mt-4"><Disclosure label="Guarded recovery provenance">{observation.modelRecovery && <dl className="grid grid-cols-1 gap-2 text-xs text-secondary sm:grid-cols-2"><div><dt className="text-muted">Legacy source</dt><dd>row {observation.modelRecovery.sourceRowId}, version {observation.modelRecovery.sourceVersion}</dd></div><div><dt className="text-muted">Replacement</dt><dd>row {observation.modelRecovery.replacementRowId}, version {observation.modelRecovery.replacementVersion}</dd></div><div><dt className="text-muted">Source fingerprint</dt><dd className="break-all font-mono">{observation.modelRecovery.sourceFingerprint}</dd></div><div><dt className="text-muted">Detected</dt><dd><SemanticTime value={observation.modelRecovery.detectedAt} absent="Not captured" /></dd></div></dl>}{observation.modelRecoveryFailure && <dl className="grid grid-cols-1 gap-2 text-xs text-secondary sm:grid-cols-2"><div><dt className="text-muted">Preserved source</dt><dd>row {observation.modelRecoveryFailure.sourceRowId}, version {observation.modelRecoveryFailure.sourceVersion}</dd></div><div><dt className="text-muted">Safe processing stage</dt><dd>{observation.modelRecoveryFailure.safeStage ?? 'unknown'}</dd></div><div><dt className="text-muted">Detected</dt><dd><SemanticTime value={observation.modelRecoveryFailure.detectedAt} absent="Not captured" /></dd></div><div><dt className="text-muted">Phase outcomes</dt><dd>{Object.entries(observation.modelRecoveryFailure.phases).map(([phase, outcome]) => `${phase}: ${outcome}`).join(' Â· ')}</dd></div></dl>}</Disclosure></div>}

      {observation.safeRecommendation ? <div className="mt-4 flex gap-2 border-t border-border pt-3 text-sm text-secondary"><ArrowRight size={16} className="mt-0.5 shrink-0 text-brand" /><span><strong className="text-primary">Recommended: {observation.safeRecommendation.action}</strong><span className="mt-1 block text-xs text-muted">Because: {observation.safeRecommendation.because}</span>{observation.safeRecommendation.destination && <a className="mt-2 inline-block rounded text-xs text-brand underline outline-none focus-visible:ring-2 focus-visible:ring-brand" href={observation.safeRecommendation.destination.href}>Open Crawl</a>}</span></div> : <p className="mt-4 flex gap-2 border-t border-border pt-3 text-xs text-muted"><AlertCircle size={14} className="mt-0.5 shrink-0 text-unknown" />No safe recommendation is available for this observation.</p>}
    </article>
  )
}

function InlineObservationDetails({ observation }: { observation: ObservationRecordReadModel }) {
  const id = inlineDetailId(observation.id)
  return <article id={id} role="region" className="rounded-lg border border-border bg-elevated p-4" data-testid="selected-observation-detail" aria-labelledby={`${id}-heading`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-brand">Selected observation detail</p><h2 id={`${id}-heading`} className="mt-1 break-all font-mono text-lg font-semibold text-primary">Observation {observation.id}</h2><p className="mt-1 text-xs text-muted">Position: {observation.position === 'latest' ? 'Latest' : 'Historical'}</p></div><TerminalState observation={observation} /></div>
    <section className="mt-4" aria-labelledby={`${id}-summary`}><h3 id={`${id}-summary`} className="text-xs font-semibold uppercase tracking-wide text-muted">Summary</h3><dl className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs uppercase tracking-wide text-muted">Context</dt><dd className="mt-1 text-secondary">{observation.contextLabel} ({observation.contextId})</dd></div><div><dt className="text-xs uppercase tracking-wide text-muted">Started</dt><dd className="mt-1 text-secondary"><SemanticTime value={observation.startedAt} absent="Not captured" /></dd></div><div><dt className="text-xs uppercase tracking-wide text-muted">Completed</dt><dd className="mt-1 text-secondary"><SemanticTime value={observation.completedAt} absent="No terminal timestamp" /></dd></div><div><dt className="text-xs uppercase tracking-wide text-muted">Source / strategy</dt><dd className="mt-1 text-secondary">{observation.source} / {observation.strategy}</dd></div></dl><div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2"><div><p className="text-xs uppercase tracking-wide text-muted">Terminal outcome explanation</p><p className="mt-1 text-sm text-secondary">{observation.why}</p></div><div><p className="text-xs uppercase tracking-wide text-muted">Freshness</p><p className="mt-1 text-sm text-unknown">Not evaluated</p><p className="mt-1 text-xs text-muted">{observation.freshness.reason}</p></div></div></section>
    <div className="mt-4 grid grid-cols-1 gap-3">
      <Disclosure label="Authentication"><div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><KeyRound size={14} /> Authentication outcome</div><dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted">Expectation</dt><dd className="text-secondary">{observation.authentication.expectation}</dd></div><div><dt className="text-xs text-muted">Credential availability</dt><dd className="text-secondary">{observation.authentication.credentialAvailability}</dd></div><div><dt className="text-xs text-muted">Authentication outcome</dt><dd className="text-secondary">{observation.authentication.outcome ?? 'Not persisted'}</dd></div></dl>{observation.authentication.explanation && <p className="mt-2 text-xs text-secondary">{observation.authentication.explanation}</p>}<div className="mt-3"><AuthenticationStages observation={observation} /></div></Disclosure>
      <Disclosure label={`Observed subjects (${observation.observedSubjects.length})`}>{observation.observedSubjects.length === 0 ? <p className="text-xs text-muted">No observed subjects were safely available.</p> : <ul className="space-y-2">{observation.observedSubjects.map(subject => <li key={subject.id} className="text-sm text-secondary"><span className="font-mono text-xs text-primary">{subject.id}</span><span className="ml-2 text-xs text-muted">{subject.kind}</span><p className="mt-1 break-all">{subject.routePath ?? 'Route path not safely available'}</p><p className="mt-1 font-mono text-xs text-muted">Evidence: {subject.evidenceId}</p></li>)}</ul>}</Disclosure>
      <Disclosure label={`Evidence records (${observation.evidence.length})`}>{observation.evidence.length === 0 ? <p className="text-xs text-muted">No evidence records were safely available.</p> : <ul className="space-y-3">{observation.evidence.map(evidence => <li key={evidence.id} className="rounded border border-border p-3 text-sm text-secondary"><div className="flex flex-wrap justify-between gap-2"><span className="font-mono text-xs text-primary">{evidence.id}</span><span className="text-xs text-muted">Integrity: {evidence.integrity}</span></div><p className="mt-2">{evidence.summary}</p><p className="mt-1 text-xs text-muted">Subject: {evidence.subjectPath ?? 'Route path not safely available'}</p><p className="mt-1 text-xs text-muted">Captured <SemanticTime value={evidence.capturedAt} absent="Not captured" /> · {evidence.provenance.kind}: {evidence.provenance.reference}</p></li>)}</ul>}</Disclosure>
      <Disclosure label="Limitations and unknowns">{observation.limitations.length === 0 && observation.blockers.length === 0 && observation.unknowns.length === 0 ? <p className="text-xs text-muted">No categorized limitations, blockers, or unknowns were safely available.</p> : <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{observation.limitations.length > 0 && <section><p className="text-xs font-semibold uppercase tracking-wide text-flaky">Unobserved scope and limitations</p><CategorizedList items={observation.limitations} /></section>}{observation.blockers.length > 0 && <section><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fail"><ShieldAlert size={14} /> Blockers</p><CategorizedList items={observation.blockers} /></section>}{observation.unknowns.length > 0 && <section><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-unknown"><CircleHelp size={14} /> Unknowns</p><CategorizedList items={observation.unknowns} /></section>}</div>}</Disclosure>
      {(observation.modelRecovery || observation.modelRecoveryFailure) && <Disclosure label="Recovery provenance">{observation.modelRecovery && <dl className="grid grid-cols-1 gap-2 text-xs text-secondary sm:grid-cols-2"><div><dt className="text-muted">Legacy source</dt><dd>row {observation.modelRecovery.sourceRowId}, version {observation.modelRecovery.sourceVersion}</dd></div><div><dt className="text-muted">Replacement</dt><dd>row {observation.modelRecovery.replacementRowId}, version {observation.modelRecovery.replacementVersion}</dd></div><div><dt className="text-muted">Source fingerprint</dt><dd className="break-all font-mono">{observation.modelRecovery.sourceFingerprint}</dd></div><div><dt className="text-muted">Detected</dt><dd><SemanticTime value={observation.modelRecovery.detectedAt} absent="Not captured" /></dd></div></dl>}{observation.modelRecoveryFailure && <dl className="grid grid-cols-1 gap-2 text-xs text-secondary sm:grid-cols-2"><div><dt className="text-muted">Preserved source</dt><dd>row {observation.modelRecoveryFailure.sourceRowId}, version {observation.modelRecoveryFailure.sourceVersion}</dd></div><div><dt className="text-muted">Safe processing stage</dt><dd>{observation.modelRecoveryFailure.safeStage ?? 'unknown'}</dd></div><div><dt className="text-muted">Detected</dt><dd><SemanticTime value={observation.modelRecoveryFailure.detectedAt} absent="Not captured" /></dd></div><div><dt className="text-muted">Phase outcomes</dt><dd>{Object.entries(observation.modelRecoveryFailure.phases).map(([phase, outcome]) => `${phase}: ${outcome}`).join(' · ')}</dd></div></dl>}</Disclosure>}
    </div>
    {observation.safeRecommendation ? <div className="mt-4 flex gap-2 border-t border-border pt-3 text-sm text-secondary"><ArrowRight size={16} className="mt-0.5 shrink-0 text-brand" /><span><strong className="text-primary">Recommended: {observation.safeRecommendation.action}</strong><span className="mt-1 block text-xs text-muted">Because: {observation.safeRecommendation.because}</span></span></div> : <p className="mt-4 flex gap-2 border-t border-border pt-3 text-xs text-muted"><AlertCircle size={14} className="mt-0.5 shrink-0 text-unknown" />No safe recommendation is available for this observation.</p>}
  </article>
}

export function ApplicationObservations({
  readModel,
  selectedId,
  onSelect,
  filterActive,
  filterDescription,
  onClearFilters,
  onPrevious,
  onNext,
  isPageLoading = false,
}: {
  readModel: ApplicationObservationsReadModel
  selectedId: string | null
  onSelect: (id: string) => void
  filterActive: boolean
  filterDescription: string
  onClearFilters: () => void
  onPrevious: () => void
  onNext: () => void
  isPageLoading?: boolean
}) {
  const selected = readModel.observations.find(observation => observation.id === selectedId)
    ?? null
  const { filteredTotal, projectTotal, previousCursor, nextCursor, hasPrevious } = readModel.page
  const countSummary = filterActive
    ? filteredTotal === 0
      ? `0 runs match the selected dates — ${projectTotal} total runs`
      : `Showing ${readModel.observations.length} of ${filteredTotal} filtered runs — ${projectTotal} total runs`
    : `Total runs: ${projectTotal}`

  return (
    <div className="space-y-6" data-testid="application-observations">
      <header><p className="text-xs uppercase tracking-[0.18em] text-brand">Observations</p><h1 className="mt-1 text-2xl font-semibold text-primary">Persisted observation history</h1><p className="mt-1 text-sm text-secondary">Immutable observation records for {readModel.project.displayName}. Latest describes ordering only; terminal status is shown independently.</p></header>
      <section className="rounded border border-border bg-surface p-3" aria-label="Observation result summary"><p className="text-sm font-semibold text-primary">{countSummary}</p><p className="mt-1 text-xs text-muted">{filterActive ? `Active Started date filter: ${filterDescription}` : 'Active Started date filter: All dates'}</p></section>
      {readModel.observations.length === 0 && !filterActive
        ? <section className="rounded-lg border border-border bg-surface p-8 text-center"><Clock3 size={22} className="mx-auto text-unknown" /><h2 className="mt-3 text-lg font-semibold text-primary">No observation history</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">No immutable observation records are available for this application, so no application conclusion is presented here.</p></section>
        : readModel.observations.length === 0
          ? <section className="rounded-lg border border-border bg-surface p-8 text-center"><Clock3 size={22} className="mx-auto text-unknown" /><h2 className="mt-3 text-lg font-semibold text-primary">No matching observations</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">No persisted observations started within the selected dates. This does not mean the project has no observation history.</p><button type="button" onClick={onClearFilters} className="mt-4 rounded border border-border px-4 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Clear filters</button></section>
        : <>
          <section aria-labelledby="observation-history"><div className="mb-3 flex items-center gap-2"><History size={16} className="text-brand" /><h2 id="observation-history" className="text-sm font-semibold uppercase tracking-[0.16em] text-secondary">Observation history</h2></div><InlineObservationTable observations={readModel.observations} selectedId={selected?.id ?? null} onSelect={onSelect} /></section>
        </>}
      <p className="sr-only" aria-live="polite">{selected ? `Observation ${selected.id} details expanded.` : 'Observation details collapsed.'}</p>
      {(hasPrevious || nextCursor) && <nav className="flex items-center justify-between gap-3" aria-label="Observation history pages"><button type="button" onClick={onPrevious} disabled={!hasPrevious || isPageLoading} className="rounded border border-border bg-surface px-4 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">Previous</button><p className="text-center text-xs text-muted">One bounded page is shown at a time.</p><button type="button" onClick={onNext} disabled={!nextCursor || isPageLoading} className="rounded border border-border bg-surface px-4 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">Next</button></nav>}
      <p className="flex items-center gap-2 text-xs text-muted"><FileSearch size={13} />{nextCursor ? 'More matching observations are available.' : 'All matching observations on this result set are loaded.'}</p>
    </div>
  )
}
