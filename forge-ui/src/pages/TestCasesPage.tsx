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

import React, { Fragment, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ChevronRight, FileCheck2, Loader2 } from 'lucide-react'
import { ApiError } from '../api/client'
import type { EvidenceBackedTestDefinition, EvidenceBackedTestSet } from '../api/types'
import { ProjectSelector } from '../components/shared/ProjectSelector'
import { useEvidenceBackedTests, useGenerateEvidenceBackedTests } from '../hooks/useApi'

function Time({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{new Date(value).toLocaleString()} <span className="text-xs text-muted">(ISO: {value})</span></time>
}

function List({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <ul className="list-disc space-y-1 pl-5">{items.map(item => <li key={item}>{item}</li>)}</ul> : <p>{empty}</p>
}

function DefinitionDetail({ definition, project }: { definition: EvidenceBackedTestDefinition; project: string }) {
  const id = `test-detail-${definition.id}`
  return <section id={id} aria-labelledby={`${id}-heading`} className="space-y-4 rounded-lg border border-border bg-elevated p-4 text-sm">
    <div><h2 id={`${id}-heading`} className="text-base font-semibold text-primary">{definition.title}</h2><p className="mt-1 text-secondary">{definition.intent}</p></div>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-xs uppercase text-muted">Validation</dt><dd className="text-primary">Valid definition</dd></div>
      <div><dt className="text-xs uppercase text-muted">Runner compatibility</dt><dd className="text-flaky">Blocked</dd></div>
      <div><dt className="text-xs uppercase text-muted">Method</dt><dd className="text-primary">Deterministic</dd></div>
      <div><dt className="text-xs uppercase text-muted">Coverage</dt><dd className="text-primary">Unknown</dd></div>
    </dl>
    <details><summary className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Preconditions, step, and oracle</summary><div className="mt-2 space-y-2 text-secondary"><List items={definition.preconditions} empty="No preconditions were established." />{definition.steps.map(step => <p key={step.evidenceId}><strong>Bounded step:</strong> Observe <code>{step.subjectId}</code> at <code>{step.routePath}</code>.</p>)}<p><strong>Oracle:</strong> {definition.oracle.explanation}</p><p>{definition.runnerCompatibility.explanation}</p></div></details>
    <details><summary className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Provenance</summary><div className="mt-2 flex flex-wrap gap-3 text-brand"><Link to={`/application/observations?project=${encodeURIComponent(project)}&observation=${encodeURIComponent(definition.provenance.sourceObservationId)}`}>Observation {definition.provenance.sourceObservationId}</Link><Link to={`/application/model?project=${encodeURIComponent(project)}&model=${definition.provenance.modelRowId}`}>Model {definition.provenance.modelVersion} (row {definition.provenance.modelRowId})</Link>{definition.provenance.supportingEvidenceIds.map(evidence => <Link key={evidence} to={`/application/evidence?project=${encodeURIComponent(project)}&evidence=${encodeURIComponent(evidence)}`}>Evidence {evidence}</Link>)}</div></details>
    <details><summary className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Limitations and unknowns</summary><div className="mt-2 grid gap-3 text-secondary md:grid-cols-3"><div><h3 className="font-medium text-primary">Confidence limitations</h3><List items={definition.confidenceLimitations} empty="None recorded." /></div><div><h3 className="font-medium text-primary">Material unknowns</h3><List items={definition.materialUnknowns} empty="None recorded." /></div><div><h3 className="font-medium text-primary">Unobserved scope</h3><List items={definition.unobservedScope} empty="None recorded." /></div></div><p className="mt-3 text-secondary"><strong>Why this is not stronger:</strong> {definition.preventedStrongerDefinition}</p></details>
  </section>
}

function DefinitionControl({ definition, expanded, onToggle }: { definition: EvidenceBackedTestDefinition; expanded: boolean; onToggle: () => void }) {
  return <button type="button" aria-expanded={expanded} aria-controls={`test-detail-${definition.id}`} aria-current={expanded ? 'true' : undefined} onClick={event => { event.stopPropagation(); onToggle() }} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expanded ? 'Selected — collapse' : `View observation-backed test ${definition.id}`}</button>
}

function useDesktopInventory(): boolean {
  const [desktop, setDesktop] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1280px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return desktop
}

export function EvidenceBackedTestInventory({ testSet, project, selected, onToggle }: { testSet?: EvidenceBackedTestSet | null; project: string; selected: string | null; onToggle: (id: string) => void }) {
  const desktop = useDesktopInventory()
  if (!testSet || !Array.isArray(testSet.definitions)) return <section role="status" className="rounded-lg border border-flaky/40 bg-elevated p-4 text-sm text-secondary"><h3 className="font-semibold text-primary">Test definitions unavailable</h3><p className="mt-1">The selected revision response was incomplete; no definitions were fabricated.</p></section>
  if (desktop) return <div className="overflow-hidden rounded-lg border border-border"><table className="w-full border-collapse text-left text-sm"><thead className="bg-elevated text-xs uppercase text-muted"><tr><th className="p-3">Test</th><th className="p-3">Category</th><th className="p-3">Subject</th><th className="p-3">Validation</th><th className="p-3">Runner</th><th className="p-3">Evidence</th><th className="p-3">Selection</th></tr></thead><tbody>{testSet.definitions.map(definition => {
      const expanded = selected === definition.id
      return <Fragment key={definition.id}><tr aria-selected={expanded} onClick={() => onToggle(definition.id)} className={`cursor-pointer border-t border-border ${expanded ? 'outline outline-2 outline-brand' : 'hover:bg-hover'}`}><td className="p-3 font-medium text-primary">{definition.title}</td><td className="p-3 text-secondary">Navigation</td><td className="p-3 font-mono text-secondary">{definition.canonicalSubjects[0]}</td><td className="p-3 text-pass">Valid</td><td className="p-3 text-flaky">Blocked</td><td className="p-3 text-secondary">{definition.provenance.supportingEvidenceIds.length}</td><td className="p-3"><DefinitionControl definition={definition} expanded={expanded} onToggle={() => onToggle(definition.id)} /></td></tr>{expanded && <tr><td colSpan={7} className="border-t border-border p-3"><DefinitionDetail definition={definition} project={project} /></td></tr>}</Fragment>
    })}</tbody></table></div>
  return <div className="space-y-3">{testSet.definitions.map(definition => { const expanded = selected === definition.id; return <div key={definition.id} className={`rounded-lg border border-border bg-surface ${expanded ? 'outline outline-2 outline-brand' : ''}`}><div role="group" aria-label={`Test ${definition.title}`} onClick={() => onToggle(definition.id)} className="cursor-pointer space-y-2 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-primary">{definition.title}</p><p className="font-mono text-xs text-muted">{definition.canonicalSubjects[0]}</p></div><span className="text-xs text-flaky">Runner blocked</span></div><DefinitionControl definition={definition} expanded={expanded} onToggle={() => onToggle(definition.id)} /></div>{expanded && <div className="border-t border-border p-3"><DefinitionDetail definition={definition} project={project} /></div>}</div> })}</div>
}

export function TestCasesPage() {
  const [params, setParams] = useSearchParams()
  const project = params.get('project')
  const cursor = params.get('cursor')
  const selectedFromUrl = params.get('test')
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([])
  const query = useEvidenceBackedTests(project, cursor, selectedFromUrl)
  const generate = useGenerateEvidenceBackedTests()
  const [announcement, setAnnouncement] = useState('')
  const currentRecord = query.data?.current ?? { testSet: null as never, temporalIntegrity: 'verified' as const, temporalCode: null, startedAt: '', completedAt: null, temporalExplanation: '' }
  const currentCandidate = currentRecord.testSet
  const current = currentCandidate && Array.isArray(currentCandidate.definitions) ? currentCandidate : null
  const malformedCurrent = !!currentCandidate && !Array.isArray(currentCandidate.definitions)
  const selected = selectedFromUrl && current?.definitions.some(item => item.id === selectedFromUrl) ? selectedFromUrl : null

  useEffect(() => {
    if (selectedFromUrl && query.data && !query.data.requestedDefinition && !current?.definitions.some(item => item.id === selectedFromUrl)) {
      const next = new URLSearchParams(params); next.delete('test'); setParams(next, { replace: true }); setAnnouncement('The requested test is not available for this project; the selection was cleared.')
    }
  }, [selectedFromUrl, query.data, current, params, setParams])

  function toggle(id: string) { const next = new URLSearchParams(params); if (selected === id) { next.delete('test'); setAnnouncement('Test detail collapsed.') } else { next.set('test', id); setAnnouncement(`Selected test ${id}.`) } setParams(next) }
  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div><h1 className="text-2xl font-semibold text-primary">Evidence-backed tests</h1><p className="mt-1 max-w-3xl text-sm text-secondary">Review what current evidence can justify, what each definition would establish, and why execution remains a separate decision.</p></div>
    <p aria-live="polite" className="sr-only">{announcement}</p>
    {!project ? <section className="rounded-lg border border-border bg-surface"><ProjectSelector title="Evidence-backed tests" subtitle="Select a project to read its authoritative test-set history." basePath="/tests" /></section>
      : query.isLoading ? <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 className="animate-spin" size={18} /> Loading test definitions…</div>
      : query.isError ? <section role="alert" className="rounded-lg border border-fail/40 bg-surface p-6"><h2 className="font-semibold text-primary">Tests unavailable</h2><p className="mt-2 text-sm text-secondary">{query.error instanceof ApiError && query.error.status === 404 ? 'The selected project was not found.' : query.error instanceof ApiError && query.error.status === 422 ? 'Persisted test-design authorities could not be validated safely.' : 'The FORGE backend or test-definition authority is unavailable.'}</p></section>
      : query.data && <>
        <section className="rounded-lg border border-border bg-surface p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold text-primary">Test-design readiness: {query.data.designReadiness.state.replaceAll('_', ' ')}</h2><p className="mt-1 text-sm text-secondary">{query.data.designReadiness.explanation}</p><p className="mt-2 text-xs text-muted">Freshness: Not evaluated · Coverage: Unknown · Execution: Not performed</p></div>{query.data.canGenerate && <button type="button" disabled={generate.isPending} onClick={() => generate.mutate(project)} className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">{generate.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileCheck2 size={16} />} Generate evidence-backed tests</button>}</div>{generate.isError && <p role="alert" className="mt-3 text-sm text-fail">Generation did not complete. No retry was started automatically.</p>}</section>
        <aside className="flex gap-3 rounded-lg border border-flaky/40 bg-elevated p-4 text-sm text-secondary"><AlertTriangle className="shrink-0 text-flaky" size={18} /><p>Generation designs immutable definitions. It does not execute tests, report pass/fail results, establish coverage, or prove application completeness.</p></aside>
        {malformedCurrent ? <section role="alert" className="rounded-lg border border-fail/40 bg-surface p-6"><h2 className="font-semibold text-primary">Malformed test-set response</h2><p className="mt-2 text-sm text-secondary">The persisted revision response could not be validated safely; no definitions were fabricated.</p></section> : !current ? <section className="rounded-lg border border-border bg-surface p-6"><h2 className="font-semibold text-primary">No canonical test set</h2><p className="mt-2 text-sm text-secondary">No evidence-backed definition revision has been persisted for this project.</p></section> : <>
          <section className="space-y-3"><div><h2 className="text-lg font-semibold text-primary">Current revision {current.revision}</h2><p className="text-sm text-secondary">{current.definitions.length} bounded definition{current.definitions.length === 1 ? '' : 's'} · generation outcome: {current.outcome.replaceAll('_', ' ')} · current revision · generated <Time value={current.generatedAt} /></p><dl className="mt-3 grid gap-3 rounded border border-border bg-elevated p-3 text-sm sm:grid-cols-2"><div><dt className="text-xs uppercase text-muted">Temporal integrity</dt><dd className={currentRecord.temporalIntegrity === 'failed' ? 'text-fail' : 'text-pass'}>{currentRecord.temporalIntegrity === 'failed' ? 'Failed' : 'Verified'}</dd></div><div><dt className="text-xs uppercase text-muted">Safe code</dt><dd className="font-mono text-primary">{currentRecord.temporalCode ?? 'None'}</dd></div><div><dt className="text-xs uppercase text-muted">Started</dt><dd className="text-secondary"><Time value={currentRecord.startedAt} /></dd></div><div><dt className="text-xs uppercase text-muted">Completed</dt><dd className="text-secondary">{currentRecord.completedAt ? <Time value={currentRecord.completedAt} /> : 'Not recorded'}</dd></div></dl><p className="text-sm text-secondary">{currentRecord.temporalExplanation}</p></div><EvidenceBackedTestInventory testSet={current} project={project} selected={selected} onToggle={toggle} /></section>
          <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-primary">Immutable revision history</h2><p className="text-sm text-secondary">Total revisions: {query.data.total}. Historical revisions are not presented as current truth.</p></div><div className="flex gap-2"><button type="button" disabled={previousCursors.length === 0} onClick={() => { const stack = [...previousCursors]; const prior = stack.pop() ?? null; setPreviousCursors(stack); const next = new URLSearchParams(params); prior ? next.set('cursor', prior) : next.delete('cursor'); next.delete('test'); setParams(next) }} className="rounded border border-border px-3 py-1.5 text-sm text-primary focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40">Previous</button><button type="button" disabled={!query.data.nextCursor} onClick={() => { setPreviousCursors(items => [...items, cursor]); const next = new URLSearchParams(params); next.set('cursor', query.data.nextCursor!); next.delete('test'); setParams(next) }} className="rounded border border-border px-3 py-1.5 text-sm text-primary focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40">Next</button></div></div><div className="overflow-hidden rounded-lg border border-border"><table className="w-full text-left text-sm"><thead className="bg-elevated text-xs uppercase text-muted"><tr><th className="p-3">Revision</th><th className="p-3">Created</th><th className="p-3">Outcome</th><th className="hidden p-3 sm:table-cell">Observation</th><th className="p-3">Definitions</th></tr></thead><tbody>{query.data.history.map(item => <tr key={item.rowId} className="border-t border-border"><td className="p-3 font-medium text-primary">{item.revision}{item.revision === current.revision ? ' · Current' : ' · Historical'}</td><td className="p-3 text-secondary"><Time value={item.generatedAt} /></td><td className="p-3 text-secondary">{item.outcome.replaceAll('_', ' ')}</td><td className="hidden p-3 font-mono text-xs text-secondary sm:table-cell">{item.sourceObservationId}</td><td className="p-3 text-secondary">{item.definitionCount}</td></tr>)}</tbody></table></div></section>
          <section aria-label="Revision temporal integrity" className="space-y-2 text-sm">{query.data.history.map(item => <p key={`temporal-${item.rowId}`}><strong>Revision {item.revision} temporal integrity:</strong> {item.temporalIntegrity === 'failed' ? <>Failed ({item.temporalCode}). {item.temporalExplanation}</> : 'Verified. The persisted generation lifecycle timestamps are ordered.'} <span className="ml-2">Started: <Time value={item.startedAt} /></span> <span className="ml-2">Completed: {item.completedAt ? <Time value={item.completedAt} /> : 'Not recorded'}</span></p>)}</section>
          </>}
      </>}
  </div>
}
