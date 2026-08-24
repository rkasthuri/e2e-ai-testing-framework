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
import { TestInventoryPayloadError } from '../api/testInventoryContract'
import type { TestDefinitionPresentation, TestSetPresentation } from '../api/types'
import { ProjectSelector } from '../components/shared/ProjectSelector'
import { M1TestDesignWorkspace } from '../components/tests/M1TestDesignWorkspace'
import { useEvidenceBackedTests, useGenerateEvidenceBackedTests } from '../hooks/useApi'

function Time({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{new Date(value).toLocaleString()} <span className="text-xs text-muted">(ISO: {value})</span></time>
}

function List({ items, empty }: { items: readonly string[]; empty: string }) {
  return items.length ? <ul className="list-disc space-y-1 pl-5">{items.map(item => <li key={item}>{item}</li>)}</ul> : <p>{empty}</p>
}

function compatibilityLabel(definition: TestDefinitionPresentation): { text: string; className: string } {
  if (definition.intrinsicCompatibility.state === 'compatible') return { text: 'Intrinsically compatible', className: 'text-pass' }
  if (definition.intrinsicCompatibility.state === 'blocked') return { text: 'Intrinsically blocked', className: 'text-flaky' }
  return { text: 'Compatibility not evaluated', className: 'text-unknown' }
}

function DefinitionDetail({ definition, project }: { definition: TestDefinitionPresentation; project: string }) {
  const id = `test-detail-${definition.definitionId}`
  const compatibility = compatibilityLabel(definition)
  return <section id={id} aria-labelledby={`${id}-heading`} className="space-y-4 rounded-lg border border-border bg-elevated p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id={`${id}-heading`} className="text-base font-semibold text-primary">{definition.title}</h2><p className="mt-1 text-secondary">{definition.intent}</p></div>
      <span className={`rounded-full border border-border px-3 py-1 text-xs font-semibold ${definition.schemaVersion === 1 ? 'text-flaky' : 'text-brand'}`}>{definition.schemaVersion === 3 ? 'CANONICAL V3 OBSERVED FLOW' : definition.schemaVersion === 2 ? 'SEALED CANONICAL SUPPORT' : 'LEGACY PROVENANCE'}</span>
    </div>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-xs uppercase text-muted">Schema</dt><dd className="text-primary">Version {definition.schemaVersion}</dd></div>
      <div><dt className="text-xs uppercase text-muted">Intrinsic compatibility</dt><dd className={compatibility.className}>{compatibility.text}</dd></div>
      <div><dt className="text-xs uppercase text-muted">Execution eligibility</dt><dd className="text-secondary">{definition.schemaVersion === 3 ? 'Requires canonical v3 preflight' : definition.schemaVersion === 2 ? 'Requires live preflight' : 'Unsupported for new Product execution'}</dd></div>
      <div><dt className="text-xs uppercase text-muted">Method</dt><dd className="text-primary">{definition.generationMethod.replaceAll('_', ' ')}</dd></div>
    </dl>

    {definition.schemaVersion === 3 ? <>
      <section className="grid gap-3 md:grid-cols-2" aria-label="Canonical v3 observed flow">
        <div className="rounded border border-border p-3"><h3 className="font-medium text-primary">App area</h3><p className="mt-1 text-lg font-semibold text-brand">{definition.appArea}</p><p className="mt-1 text-xs text-muted">Persisted App Model PageDefinition.module authority.</p></div>
        <div className="rounded border border-border p-3"><h3 className="font-medium text-primary">Expected outcome</h3><p className="mt-1 text-secondary">{definition.oracle.explanation}</p><p className="mt-1 text-xs text-muted">subject_observable · {definition.oracle.subjectId}</p></div>
      </section>
      <section aria-labelledby={`${id}-v3-actions`}><h3 id={`${id}-v3-actions`} className="font-medium text-primary">Ordered actions</h3><ol className="mt-2 space-y-2">{definition.actions.map(action => <li key={action.stepId} className="flex gap-3 rounded border border-border p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{action.ordinal + 1}</span><div><p className="text-primary">{action.kind === 'navigate_to_observed_route' ? `Navigate to ${action.normalizedPath}` : `Click the observed ${action.dataTestValue} element`}</p><p className="mt-1 text-xs text-muted">{action.kind}</p></div></li>)}</ol></section>
      <section className="space-y-2" aria-label="Canonical v3 provenance"><h3 className="font-medium text-primary">Generated from discovered evidence</h3><dl className="grid gap-2 text-secondary sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs uppercase text-muted">Observations</dt><dd>{definition.provenance.supportingObservationCount}</dd></div><div><dt className="text-xs uppercase text-muted">Gaps</dt><dd>{definition.provenance.supportingGapCount}</dd></div><div><dt className="text-xs uppercase text-muted">Subject support</dt><dd>{definition.provenance.subjectSupportCount}</dd></div><div><dt className="text-xs uppercase text-muted">Source</dt><dd>{definition.normalizedIntent.source}</dd></div></dl><Link className="text-brand underline-offset-2 hover:underline" to={`/application/model?project=${encodeURIComponent(project)}&model=${definition.provenance.modelRowId}`}>Model {definition.provenance.modelVersion} (row {definition.provenance.modelRowId})</Link></section>
      <details><summary className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Grounding and excluded flow context</summary><div className="mt-2 space-y-3 text-secondary"><p>{definition.routeEvidence.routes.length} governed subject routes · {definition.routeEvidence.supportingObservationCount} supporting observations.</p><ul className="list-disc space-y-1 pl-5">{definition.routeEvidence.routes.map(route => <li key={route.subjectId}><code>{route.normalizedPath}</code> · {route.supportingObservationIds.length} observations</li>)}</ul><p>Selected flow step indexes: {definition.normalizedIntent.selectedFlowStepIndexes.join(', ') || 'None'}.</p><p>Excluded flow step indexes: {definition.normalizedIntent.excludedFlowStepIndexes.join(', ') || 'None'}.</p><List items={definition.normalizedIntent.limitations} empty="No normalized-intent limitation recorded." /></div></details>
    </> : definition.schemaVersion === 2 ? <>
      <section className="space-y-2" aria-label="Sealed canonical provenance">
        <h3 className="font-medium text-primary">Sealed canonical support</h3>
        <dl className="grid gap-2 text-secondary sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs uppercase text-muted">Support seal</dt><dd className="break-all font-mono text-xs">{definition.provenance.supportSealHash}</dd></div>
          <div><dt className="text-xs uppercase text-muted">Observations</dt><dd>{definition.provenance.supportingObservationCount}</dd></div>
          <div><dt className="text-xs uppercase text-muted">Gaps</dt><dd>{definition.provenance.supportingGapCount}</dd></div>
          <div><dt className="text-xs uppercase text-muted">Subject support</dt><dd>{definition.provenance.subjectSupportCount}</dd></div>
        </dl>
        <Link className="text-brand underline-offset-2 hover:underline" to={`/application/model?project=${encodeURIComponent(project)}&model=${definition.provenance.modelRowId}`}>Model {definition.provenance.modelVersion} (row {definition.provenance.modelRowId})</Link>
      </section>
      <details><summary className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Canonical support drill-down</summary><div className="mt-2 space-y-3 text-secondary"><div><h4 className="font-medium text-primary">Observation IDs</h4>{definition.provenance.supportingObservationIds.length ? <div className="mt-1 flex flex-wrap gap-2">{definition.provenance.supportingObservationIds.map(observationId => <Link key={observationId} className="font-mono text-xs text-brand underline-offset-2 hover:underline" to={`/application/observations?project=${encodeURIComponent(project)}&observation=${encodeURIComponent(observationId)}`}>{observationId}</Link>)}</div> : <p>No supporting Observation ID was persisted for this subject.</p>}</div><div><h4 className="font-medium text-primary">Gap IDs</h4><List items={definition.provenance.supportingGapIds} empty="No supporting Gap ID was persisted for this subject." /></div></div></details>
      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-border p-3"><h3 className="font-medium text-primary">Governed route evidence</h3>{definition.routeEvidence.state === 'available' ? <><p className="mt-1 text-secondary">Normalized path: <code>{definition.routeEvidence.normalizedPath}</code></p><p className="mt-1 text-xs text-muted">Policy {definition.routeEvidence.normalizationPolicy.id} v{definition.routeEvidence.normalizationPolicy.version} · {definition.routeEvidence.supportingObservationCount} supporting Observation{definition.routeEvidence.supportingObservationCount === 1 ? '' : 's'}</p></> : <p className="mt-1 text-secondary">Route {definition.routeEvidence.state}. No route was invented.</p>}</div>
        <div className="rounded border border-border p-3"><h3 className="font-medium text-primary">Authentication expectation</h3><p className="mt-1 text-secondary">{definition.authenticationExpectation.state.replaceAll('_', ' ')}{definition.authenticationExpectation.mechanism ? ` — ${definition.authenticationExpectation.mechanism}` : ''}</p><p className="mt-1 text-xs text-muted">Definition truth only. Credential availability and authentication execution results are separate runtime facts.</p></div>
      </section>
      <details><summary className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Action and oracle</summary><div className="mt-2 space-y-2 text-secondary">{definition.action ? <p><strong>Action:</strong> navigate to <code>{definition.action.normalizedPath}</code> for <code>{definition.action.subjectId}</code>.</p> : <p>No executable action was admitted.</p>}{definition.oracle ? <p><strong>Oracle:</strong> {definition.oracle.explanation}</p> : <p>No executable oracle was admitted.</p>}<p>{definition.intrinsicCompatibility.explanation}</p></div></details>
    </> : <section className="rounded border border-flaky/50 p-3" aria-label="Legacy provenance quarantine">
      <h3 className="font-medium text-flaky">LEGACY PROVENANCE</h3>
      <p className="mt-1 text-secondary">This historical v1 definition remains readable but is not sealed canonical authority and is unsupported for new Product execution.</p>
      <div className="mt-2 flex flex-wrap gap-3"><Link className="text-brand underline-offset-2 hover:underline" to={`/application/observations?project=${encodeURIComponent(project)}&observation=${encodeURIComponent(definition.provenance.sourceObservationId)}`}>Legacy source Observation {definition.provenance.sourceObservationId}</Link><Link className="text-brand underline-offset-2 hover:underline" to={`/application/model?project=${encodeURIComponent(project)}&model=${definition.provenance.modelRowId}`}>Historical model {definition.provenance.modelVersion} (row {definition.provenance.modelRowId})</Link></div>
      <p className="mt-2 text-xs text-muted">Route and authentication values are withheld from canonical presentation because v1 did not carry the governed v2 authorities.</p>
    </section>}

    <details><summary className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Limitations and unknowns</summary><div className="mt-2 grid gap-3 text-secondary md:grid-cols-3"><div><h3 className="font-medium text-primary">Confidence limitations</h3><List items={definition.confidenceLimitations} empty="None recorded." /></div><div><h3 className="font-medium text-primary">Material unknowns</h3><List items={definition.materialUnknowns} empty="None recorded." /></div><div><h3 className="font-medium text-primary">Unobserved scope</h3><List items={definition.unobservedScope} empty="None recorded." /></div></div><p className="mt-3 text-secondary"><strong>Why this is not stronger:</strong> {definition.preventedStrongerDefinition}</p></details>
  </section>
}

function DefinitionControl({ definition, expanded, onToggle }: { definition: TestDefinitionPresentation; expanded: boolean; onToggle: () => void }) {
  return <button type="button" aria-expanded={expanded} aria-controls={`test-detail-${definition.definitionId}`} aria-current={expanded ? 'true' : undefined} onClick={event => { event.stopPropagation(); onToggle() }} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expanded ? 'Selected — collapse' : `View Test Case ${definition.definitionId}`}</button>
}

function useDesktopInventory(): boolean {
  const [desktop, setDesktop] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1280px)').matches)
  useEffect(() => { const media = window.matchMedia('(min-width: 1280px)'); const update = () => setDesktop(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  return desktop
}

export function EvidenceBackedTestInventory({ testSet, project, selected, onToggle }: { testSet?: TestSetPresentation | null; project: string; selected: string | null; onToggle: (id: string) => void }) {
  const desktop = useDesktopInventory()
  if (!testSet || !Array.isArray(testSet.definitions)) return <section role="status" className="rounded-lg border border-flaky/40 bg-elevated p-4 text-sm text-secondary"><h3 className="font-semibold text-primary">Test definitions unavailable</h3><p className="mt-1">The selected revision response was incomplete; no definitions were fabricated.</p></section>
  const rows = testSet.definitions.map(definition => ({ definition, expanded: selected === definition.definitionId, compatibility: compatibilityLabel(definition) }))
  if (desktop) return <div className="overflow-hidden rounded-lg border border-border"><table className="w-full border-collapse text-left text-sm"><thead className="bg-elevated text-xs uppercase text-muted"><tr><th className="p-3">Test</th><th className="p-3">Authority</th><th className="p-3">Subject</th><th className="p-3">Intrinsic compatibility</th><th className="p-3">Support</th><th className="p-3">Selection</th></tr></thead><tbody>{rows.map(({ definition, expanded, compatibility }) => <Fragment key={definition.definitionId}><tr aria-selected={expanded} onClick={() => onToggle(definition.definitionId)} className={`cursor-pointer border-t border-border ${expanded ? 'outline outline-2 outline-brand' : 'hover:bg-hover'}`}><td className="p-3 font-medium text-primary">{definition.title}</td><td className={definition.schemaVersion === 1 ? 'p-3 text-flaky' : 'p-3 text-brand'}>{definition.schemaVersion === 3 ? 'Canonical v3' : definition.schemaVersion === 2 ? 'Sealed canonical v2' : 'Legacy v1'}</td><td className="p-3 font-mono text-secondary">{definition.subjects[0]}</td><td className={`p-3 ${compatibility.className}`}>{compatibility.text}</td><td className="p-3 text-secondary">{definition.schemaVersion === 1 ? `${definition.provenance.supportingEvidenceCount} legacy` : `${definition.provenance.supportingObservationCount} obs / ${definition.provenance.supportingGapCount} gaps`}</td><td className="p-3"><DefinitionControl definition={definition} expanded={expanded} onToggle={() => onToggle(definition.definitionId)} /></td></tr>{expanded && <tr><td colSpan={6} className="border-t border-border p-3"><DefinitionDetail definition={definition} project={project} /></td></tr>}</Fragment>)}</tbody></table></div>
  return <div className="space-y-3">{rows.map(({ definition, expanded, compatibility }) => <div key={definition.definitionId} className={`rounded-lg border border-border bg-surface ${expanded ? 'outline outline-2 outline-brand' : ''}`}><div role="group" aria-label={`Test ${definition.title}`} onClick={() => onToggle(definition.definitionId)} className="cursor-pointer space-y-2 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-primary">{definition.title}</p><p className="font-mono text-xs text-muted">{definition.subjects[0]}</p><p className={definition.schemaVersion === 1 ? 'text-xs text-flaky' : 'text-xs text-brand'}>{definition.schemaVersion === 3 ? 'Canonical v3 observed flow' : definition.schemaVersion === 2 ? 'Sealed canonical v2 support' : 'Legacy provenance'}</p></div><span className={`text-xs ${compatibility.className}`}>{compatibility.text}</span></div><DefinitionControl definition={definition} expanded={expanded} onToggle={() => onToggle(definition.definitionId)} /></div>{expanded && <div className="border-t border-border p-3"><DefinitionDetail definition={definition} project={project} /></div>}</div>)}</div>
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
  const currentRecord = query.data?.current ?? null
  const current = currentRecord?.testSet ?? null
  const selected = selectedFromUrl && current?.definitions.some(item => item.definitionId === selectedFromUrl) ? selectedFromUrl : null

  useEffect(() => {
    if (selectedFromUrl && query.data && !query.data.requestedDefinition && !current?.definitions.some(item => item.definitionId === selectedFromUrl)) {
      const next = new URLSearchParams(params); next.delete('test'); setParams(next, { replace: true }); setAnnouncement('The requested Test Case is not available for this project; the selection was cleared.')
    }
  }, [selectedFromUrl, query.data, current, params, setParams])

  function toggle(id: string) { const next = new URLSearchParams(params); if (selected === id) { next.delete('test'); setAnnouncement('Test detail collapsed.') } else { next.set('test', id); setAnnouncement(`Selected Test Case ${id}.`) } setParams(next) }
  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div><h1 className="text-2xl font-semibold text-primary">Tests</h1><p className="mt-1 max-w-3xl text-sm text-secondary">Generate and review one grounded v3 test from discovered evidence, or inspect existing immutable Test Definition history.</p></div>
    <p aria-live="polite" className="sr-only">{announcement}</p>
    {project && <M1TestDesignWorkspace key={project} projectId={project} />}
    {!project ? <section className="rounded-lg border border-border bg-surface"><ProjectSelector title="Canonical Test Cases" subtitle="Select a project to read its authoritative Test Set history." basePath="/tests" /></section>
      : query.isLoading ? <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 className="animate-spin" size={18} /> Loading Test Cases…</div>
      : query.isError ? <section role="alert" className="rounded-lg border border-fail/40 bg-surface p-6"><h2 className="font-semibold text-primary">Test Cases unavailable</h2><p className="mt-2 text-sm text-secondary">{query.error instanceof TestInventoryPayloadError ? 'The canonical inventory response was malformed. FORGE refused to display or run it.' : query.error instanceof ApiError && query.error.status === 404 ? 'The selected project was not found.' : query.error instanceof ApiError && query.error.status === 422 ? 'Persisted Test Definition authority could not be validated safely.' : 'The FORGE backend or Test Definition authority is unavailable.'}</p></section>
      : query.data && <>
        <div className="border-t border-border pt-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Existing canonical inventory</p><h2 className="mt-1 text-xl font-semibold text-primary">Test Definition history</h2><p className="mt-1 text-sm text-secondary">Observed-flow v3 and navigation-only v2 remain distinct executable authorities. Historical v1 remains readable but quarantined.</p></div>
        <section className="rounded-lg border border-border bg-surface p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold text-primary">Test-design readiness: {query.data.designReadiness.state.replaceAll('_', ' ')}</h2><p className="mt-1 text-sm text-secondary">{query.data.designReadiness.explanation}</p><p className="mt-2 text-xs text-muted">Freshness: Not evaluated · Coverage: Unknown · Execution eligibility: Requires live preflight</p></div>{query.data.canGenerate && <button type="button" disabled={generate.isPending} onClick={() => generate.mutate(project)} className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">{generate.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileCheck2 size={16} />} Generate canonical v2 Test Cases</button>}</div>{generate.isError && <p role="alert" className="mt-3 text-sm text-fail">Generation did not complete. No retry was started automatically.</p>}</section>
        <aside className="flex gap-3 rounded-lg border border-flaky/40 bg-elevated p-4 text-sm text-secondary"><AlertTriangle className="shrink-0 text-flaky" size={18} /><p>Intrinsic compatibility belongs to the immutable definition. Live execution eligibility—including runner and credential availability—is evaluated separately on Run.</p></aside>
        {!current || !currentRecord ? <section className="rounded-lg border border-border bg-surface p-6"><h2 className="font-semibold text-primary">No Test Set revision</h2><p className="mt-2 text-sm text-secondary">No Test Definition revision has been persisted for this project.</p></section> : <>
          <section className="space-y-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-primary">Current revision {current.revision}</h2><span className={`rounded-full border border-border px-2 py-0.5 text-xs ${current.schemaVersion === 1 ? 'text-flaky' : 'text-brand'}`}>{current.schemaVersion === 3 ? 'CANONICAL V3 OBSERVED FLOW' : current.schemaVersion === 2 ? 'SEALED CANONICAL V2 SUPPORT' : 'LEGACY PROVENANCE'}</span></div><p className="text-sm text-secondary">{current.definitions.length} definition{current.definitions.length === 1 ? '' : 's'} · generation outcome: {current.outcome.replaceAll('_', ' ')} · generated <Time value={current.generatedAt} /></p>{current.schemaVersion !== 1 ? <dl className="mt-3 grid gap-3 rounded border border-border bg-elevated p-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs uppercase text-muted">Support seal</dt><dd className="break-all font-mono text-xs text-primary">{current.provenance.supportSealHash}</dd></div><div><dt className="text-xs uppercase text-muted">Observations</dt><dd>{current.provenance.supportingObservationCount}</dd></div><div><dt className="text-xs uppercase text-muted">Gaps</dt><dd>{current.provenance.supportingGapCount}</dd></div><div><dt className="text-xs uppercase text-muted">Subject support</dt><dd>{current.provenance.subjectSupportCount}</dd></div></dl> : <p className="mt-3 rounded border border-flaky/50 p-3 text-sm text-secondary">Historical v1 authority is quarantined. Its singular source is not presented as sealed canonical support and cannot be executed through the Product default.</p>}<p className="mt-2 text-sm text-secondary">Temporal integrity: <span className={currentRecord.temporalIntegrity === 'failed' ? 'text-fail' : 'text-pass'}>{currentRecord.temporalIntegrity}</span>. {currentRecord.temporalExplanation}</p></div><EvidenceBackedTestInventory testSet={current} project={project} selected={selected} onToggle={toggle} /></section>
          <section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-primary">Immutable revision history</h2><p className="text-sm text-secondary">Total revisions: {query.data.total}. v1, v2, and v3 authority classes are never coerced or merged.</p></div><div className="flex gap-2"><button type="button" disabled={previousCursors.length === 0} onClick={() => { const stack = [...previousCursors]; const prior = stack.pop() ?? null; setPreviousCursors(stack); const next = new URLSearchParams(params); prior ? next.set('cursor', prior) : next.delete('cursor'); next.delete('test'); setParams(next) }} className="rounded border border-border px-3 py-1.5 text-sm text-primary disabled:opacity-40">Previous</button><button type="button" disabled={!query.data.nextCursor} onClick={() => { setPreviousCursors(items => [...items, cursor]); const next = new URLSearchParams(params); next.set('cursor', query.data.nextCursor!); next.delete('test'); setParams(next) }} className="rounded border border-border px-3 py-1.5 text-sm text-primary disabled:opacity-40">Next</button></div></div><div className="overflow-hidden rounded-lg border border-border"><table className="w-full text-left text-sm"><thead className="bg-elevated text-xs uppercase text-muted"><tr><th className="p-3">Revision</th><th className="p-3">Created</th><th className="p-3">Outcome</th><th className="p-3">Authority</th><th className="p-3">Definitions</th></tr></thead><tbody>{query.data.history.map(item => <tr key={item.rowId} className="border-t border-border"><td className="p-3 font-medium text-primary">{item.revision}{item.revision === current.revision ? ' · Current' : ' · Historical'}</td><td className="p-3 text-secondary"><Time value={item.generatedAt} /></td><td className="p-3 text-secondary">{item.outcome.replaceAll('_', ' ')}</td><td className={item.schemaVersion === 1 ? 'p-3 text-flaky' : 'p-3 text-brand'}>{item.schemaVersion !== 1 ? <><span>Canonical v{item.schemaVersion} sealed support</span><span className="block break-all font-mono text-xs text-muted">{item.provenance.supportSealHash}</span></> : <><span>LEGACY PROVENANCE</span><span className="block font-mono text-xs text-muted">Source retained in legacy detail</span></>}</td><td className="p-3 text-secondary">{item.definitionCount}</td></tr>)}</tbody></table></div></section>
        </>}
      </>}
  </div>
}
