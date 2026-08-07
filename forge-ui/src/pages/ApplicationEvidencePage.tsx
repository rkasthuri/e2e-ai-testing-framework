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

import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import type { EvidenceLedgerIntegrity, EvidenceLedgerSourceClass, EvidenceLedgerSupport } from '../api/types'
import { ApplicationEvidence } from '../components/application-workspace/ApplicationEvidence'
import { ApplicationWorkspace } from '../components/application-workspace/ApplicationWorkspace'
import { evidenceCalendarBoundary, isValidEvidenceCalendarDate } from '../components/application-workspace/evidenceLedgerDateFilter'
import { useEvidenceLedger } from '../hooks/useApi'
import { useCurrentProject } from '../hooks/useCurrentProject'

const SOURCE_VALUES = ['', 'onboarding', 'crawl_observation'] as const
const SUPPORT_VALUES = ['', 'current', 'historical'] as const
const INTEGRITY_VALUES = ['', 'verified', 'failed', 'not_evaluated'] as const
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const SAFE_OBSERVATION = /^[A-Za-z0-9-]{1,128}$/

function ErrorState({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : null
  const content = apiError?.code === 'NOT_FOUND'
    ? ['Application not found', 'The selected project does not exist. Select an onboarded application.']
    : apiError?.code === 'EVIDENCE_OWNERSHIP_CONFLICT'
      ? ['Evidence ownership conflict', 'Persisted evidence contains a project ownership conflict. No ledger is presented.']
      : apiError?.code?.startsWith('EVIDENCE_') && apiError.status === 422
        ? ['Evidence could not be validated', 'Malformed, duplicate, missing, or conflicting persisted evidence failed closed.']
        : apiError?.code === 'BACKEND_UNAVAILABLE' || apiError?.status === 0
          ? ['FORGE backend unavailable', 'Start the local FORGE control plane, then refresh this page.']
          : ['Evidence ledger unavailable', 'Authoritative evidence could not be loaded safely.']
  return <section className="rounded-lg border border-fail/40 bg-surface p-8 text-center" role="alert"><h1 className="text-lg font-semibold text-primary">{content[0]}</h1><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">{content[1]}</p></section>
}

export function ApplicationEvidencePage() {
  const project = useCurrentProject()
  const [searchParams, setSearchParams] = useSearchParams()
  const cursor = searchParams.get('cursor')
  const evidenceParam = searchParams.get('evidence')
  const sourceParam = searchParams.get('sourceClass') ?? ''
  const supportParam = searchParams.get('support') ?? ''
  const integrityParam = searchParams.get('integrity') ?? ''
  const observationParam = searchParams.get('observation') ?? ''
  const fromParam = searchParams.get('capturedFrom') ?? ''
  const throughParam = searchParams.get('capturedThrough') ?? ''
  const cursorValid = cursor === null || /^[A-Za-z0-9_-]{1,2048}$/.test(cursor)
  const evidenceValid = evidenceParam === null || SAFE_ID.test(evidenceParam)
  const sourceValid = SOURCE_VALUES.includes(sourceParam as typeof SOURCE_VALUES[number])
  const supportValid = SUPPORT_VALUES.includes(supportParam as typeof SUPPORT_VALUES[number])
  const integrityValid = INTEGRITY_VALUES.includes(integrityParam as typeof INTEGRITY_VALUES[number])
  const observationValid = observationParam === '' || SAFE_OBSERVATION.test(observationParam)
  const fromValid = fromParam === '' || isValidEvidenceCalendarDate(fromParam)
  const throughValid = throughParam === '' || isValidEvidenceCalendarDate(throughParam)
  const rangeValid = !fromParam || !throughParam || fromParam <= throughParam
  const urlValid = cursorValid && evidenceValid && sourceValid && supportValid && integrityValid
    && observationValid && fromValid && throughValid && rangeValid
  const [collapsedPageKey, setCollapsedPageKey] = useState<string | null>(null)
  const [filterError, setFilterError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ source: sourceParam, support: supportParam, integrity: integrityParam, observation: observationParam, from: fromParam, through: throughParam })

  useEffect(() => {
    setDraft({ source: sourceParam, support: supportParam, integrity: integrityParam, observation: observationParam, from: fromParam, through: throughParam })
    setFilterError(null)
  }, [sourceParam, supportParam, integrityParam, observationParam, fromParam, throughParam])

  const query = useEvidenceLedger(project, {
    cursor: cursorValid ? cursor : null,
    evidenceId: evidenceValid ? evidenceParam : null,
    sourceClass: sourceValid && sourceParam ? sourceParam as EvidenceLedgerSourceClass : null,
    support: supportValid && supportParam ? supportParam as EvidenceLedgerSupport : null,
    integrity: integrityValid && integrityParam ? integrityParam as EvidenceLedgerIntegrity : null,
    observationId: observationValid && observationParam ? observationParam : null,
    capturedFrom: fromValid && fromParam ? evidenceCalendarBoundary(fromParam, false) : null,
    capturedThrough: throughValid && throughParam ? evidenceCalendarBoundary(throughParam, true) : null,
  }, urlValid)
  const pageKey = `${project ?? ''}|${cursor ?? ''}|${sourceParam}|${supportParam}|${integrityParam}|${observationParam}|${fromParam}|${throughParam}`
  const onPageIds = query.data?.evidence.map(item => item.id) ?? []
  const requestedStatus = query.data?.requestedEvidence?.evidenceId === evidenceParam
    ? query.data.requestedEvidence.status
    : null
  const selectedEvidenceId = evidenceParam === null && collapsedPageKey === pageKey
    ? null
    : evidenceParam !== null && onPageIds.includes(evidenceParam)
      ? evidenceParam
      : onPageIds[0] ?? null
  const selectionExplanation = evidenceParam !== null && !evidenceValid
    ? 'The requested evidence identity is malformed. The newest matching evidence on this page is selected instead.'
    : requestedStatus === 'outside_page'
      ? 'The requested project-owned evidence is outside this bounded page. Use Previous or Next without loading the complete history.'
      : requestedStatus === 'outside_filter'
        ? 'The requested project-owned evidence does not match the active filters. It is not selected invisibly.'
        : requestedStatus === 'not_found'
          ? 'The requested evidence identity does not belong to this project. The newest matching evidence is selected instead.'
          : null

  const selectEvidence = (evidenceId: string) => {
    const next = new URLSearchParams(searchParams)
    if (selectedEvidenceId === evidenceId) {
      next.delete('evidence')
      setCollapsedPageKey(pageKey)
    } else {
      next.set('evidence', evidenceId)
      setCollapsedPageKey(null)
    }
    setSearchParams(next)
  }
  const changePage = (nextCursor: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (nextCursor) next.set('cursor', nextCursor)
    else next.delete('cursor')
    next.delete('evidence')
    setCollapsedPageKey(null)
    setSearchParams(next)
  }
  const applyFilters = (event: FormEvent) => {
    event.preventDefault()
    if ((draft.from && !isValidEvidenceCalendarDate(draft.from)) || (draft.through && !isValidEvidenceCalendarDate(draft.through))) {
      setFilterError('Enter valid calendar dates before applying filters.')
      return
    }
    if (draft.from && draft.through && draft.from > draft.through) {
      setFilterError('Captured From must not be later than Captured Through.')
      return
    }
    if (draft.observation && !SAFE_OBSERVATION.test(draft.observation)) {
      setFilterError('Enter a valid canonical observation identity or leave the field blank.')
      return
    }
    const next = new URLSearchParams(searchParams)
    const values = { sourceClass: draft.source, support: draft.support, integrity: draft.integrity, observation: draft.observation, capturedFrom: draft.from, capturedThrough: draft.through }
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    next.delete('cursor')
    next.delete('evidence')
    setCollapsedPageKey(null)
    setFilterError(null)
    setSearchParams(next)
  }
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams)
    ;['sourceClass', 'support', 'integrity', 'observation', 'capturedFrom', 'capturedThrough', 'cursor', 'evidence'].forEach(key => next.delete(key))
    setCollapsedPageKey(null)
    setFilterError(null)
    setSearchParams(next)
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'
  const filterToolbar = <form onSubmit={applyFilters} className="rounded-lg border border-border bg-surface p-4" aria-label="Evidence filters">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><label className="text-xs text-secondary">Source class<select value={draft.source} onChange={event => setDraft(current => ({ ...current, source: event.target.value }))} className="mt-1 w-full rounded border border-border bg-elevated px-2 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand"><option value="">All sources</option><option value="onboarding">Onboarding</option><option value="crawl_observation">Crawl observation</option></select></label><label className="text-xs text-secondary">Support<select value={draft.support} onChange={event => setDraft(current => ({ ...current, support: event.target.value }))} className="mt-1 w-full rounded border border-border bg-elevated px-2 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand"><option value="">All support positions</option><option value="current">Current support</option><option value="historical">Historical support</option></select></label><label className="text-xs text-secondary">Integrity<select value={draft.integrity} onChange={event => setDraft(current => ({ ...current, integrity: event.target.value }))} className="mt-1 w-full rounded border border-border bg-elevated px-2 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand"><option value="">All integrity states</option><option value="verified">Verified</option><option value="failed">Failed</option><option value="not_evaluated">Not evaluated</option></select></label><label className="text-xs text-secondary">Captured From<input type="date" value={draft.from} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} className="mt-1 w-full rounded border border-border bg-elevated px-2 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label><label className="text-xs text-secondary">Captured Through<input type="date" value={draft.through} onChange={event => setDraft(current => ({ ...current, through: event.target.value }))} className="mt-1 w-full rounded border border-border bg-elevated px-2 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label></div>
    <label className="mt-3 block max-w-xl text-xs text-secondary">Source observation<input value={draft.observation} onChange={event => setDraft(current => ({ ...current, observation: event.target.value.trim() }))} placeholder="Canonical observation identity" className="mt-1 w-full rounded border border-border bg-elevated px-2 py-2 font-mono text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
    <div className="mt-3 flex flex-wrap items-center gap-2"><button type="submit" className="rounded bg-brand px-3 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">Apply</button><button type="button" onClick={clearFilters} className="rounded border border-border px-3 py-2 text-sm text-primary outline-none hover:bg-elevated focus-visible:ring-2 focus-visible:ring-brand">Clear</button><span className="text-xs text-muted">Calendar boundaries use {timezone}; From is inclusive and Through includes the selected local date.</span></div>
    {filterError && <p className="mt-3 text-sm text-fail" role="alert">{filterError}</p>}
    <p className="mt-3 text-xs text-muted">Active filters: {sourceParam || supportParam || integrityParam || observationParam || fromParam || throughParam ? [sourceParam, supportParam, integrityParam, observationParam && `observation ${observationParam}`, fromParam && `from ${fromParam}`, throughParam && `through ${throughParam}`].filter(Boolean).join(' · ') : 'All evidence'}</p>
  </form>

  return <ApplicationWorkspace>
    {!project && <section className="rounded-lg border border-border bg-surface p-8 text-center"><h1 className="text-lg font-semibold text-primary">No application selected</h1><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">Select a project to load its authoritative evidence ledger.</p></section>}
    {project && !urlValid && <section className="rounded border border-unknown/40 bg-surface p-4 text-sm text-secondary" role="alert"><h1 className="text-lg font-semibold text-primary">Invalid evidence-ledger URL state</h1><p className="mt-2">A cursor, identity, filter, or date range is malformed. Return to the unfiltered first page.</p><button type="button" onClick={clearFilters} className="mt-3 rounded border border-border px-3 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Return to all evidence</button></section>}
    {project && urlValid && query.isPending && <section className="rounded-lg border border-border bg-surface p-8 text-center" role="status"><h1 className="text-lg font-semibold text-primary">Evidence</h1><p className="mt-2 text-sm text-secondary">Loading the authoritative evidence projection…</p></section>}
    {project && query.isError && <ErrorState error={query.error} />}
    {query.data && <>{selectionExplanation && <div className="rounded border border-unknown/40 bg-surface p-3 text-sm text-secondary" role="status">{selectionExplanation}</div>}<ApplicationEvidence readModel={query.data} selectedEvidenceId={selectedEvidenceId} onSelect={selectEvidence} onPrevious={() => changePage(query.data!.page.previousCursor)} onNext={() => changePage(query.data!.page.nextCursor)} filterToolbar={filterToolbar} isPageLoading={query.isFetching} /></>}
  </ApplicationWorkspace>
}
