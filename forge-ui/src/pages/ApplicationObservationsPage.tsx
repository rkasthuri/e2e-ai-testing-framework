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

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { ApplicationObservations } from '../components/application-workspace/ApplicationObservations'
import { ApplicationWorkspace } from '../components/application-workspace/ApplicationWorkspace'
import { ObservationHistoryFilterToolbar } from '../components/application-workspace/ObservationHistoryFilterToolbar'
import { buildApplicationObservationsReadModel } from '../components/application-workspace/applicationObservationsAdapter'
import { isObservationId, resolveObservationSelection } from '../components/application-workspace/applicationObservationSelection'
import { materializeObservationDateFilter } from '../components/application-workspace/observationHistoryDateFilter'
import { useObservationHistory } from '../hooks/useApi'
import { useCurrentProject } from '../hooks/useCurrentProject'

function ErrorState({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : null
  const content = apiError?.code === 'NOT_FOUND'
    ? {
        title: 'Application not found',
        message: 'The selected project does not exist. Select an onboarded application.',
      }
    : apiError?.code === 'OBSERVATION_HISTORY_INVALID'
      ? {
          title: 'Observation history could not be validated',
          message: 'Persisted history is malformed or has conflicting identity, ownership, or timestamp evidence. Nothing from that history is presented.',
        }
      : apiError?.code === 'BACKEND_UNAVAILABLE' || apiError?.status === 0
        ? {
            title: 'FORGE backend unavailable',
            message: 'Start the local FORGE control plane, then refresh this page.',
          }
        : {
            title: 'Observation history unavailable',
            message: apiError?.message ?? 'The persisted observation history could not be loaded safely.',
          }
  return <section className="rounded-lg border border-fail/40 bg-surface p-8 text-center" role="alert"><h2 className="text-lg font-semibold text-primary">{content.title}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">{content.message}</p></section>
}

export function ApplicationObservationsPage() {
  const selectedProject = useCurrentProject()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlStartedFrom = searchParams.get('startedFrom') ?? ''
  const urlStartedThrough = searchParams.get('startedThrough') ?? ''
  const cursor = searchParams.get('cursor')
  const requestedObservationId = searchParams.get('observation')
  const [draftStartedFrom, setDraftStartedFrom] = useState(urlStartedFrom)
  const [draftStartedThrough, setDraftStartedThrough] = useState(urlStartedThrough)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)
  const [collapsedPageKey, setCollapsedPageKey] = useState<string | null>(null)
  const materialized = useMemo(
    () => materializeObservationDateFilter(urlStartedFrom, urlStartedThrough),
    [urlStartedFrom, urlStartedThrough],
  )
  const cursorValid = cursor === null || /^[A-Za-z0-9_-]{1,1024}$/.test(cursor)
  const queryEnabled = materialized.ok && cursorValid
  const historyQuery = useObservationHistory(selectedProject, {
    cursor: cursorValid ? cursor : null,
    startedFrom: materialized.ok ? materialized.filter.startedFromIso : null,
    startedThrough: materialized.ok ? materialized.filter.startedThroughIso : null,
    observationId: requestedObservationId && isObservationId(requestedObservationId)
      ? requestedObservationId
      : null,
  }, queryEnabled)
  const readModel = useMemo(
    () => historyQuery.data ? buildApplicationObservationsReadModel(historyQuery.data) : null,
    [historyQuery.data],
  )
  const defaultId = readModel?.observations[0]?.id ?? null
  const requestedStatus = readModel?.requestedObservation?.observationId === requestedObservationId
    ? readModel.requestedObservation.status
    : null
  const selection = resolveObservationSelection(
    requestedObservationId,
    readModel?.observations.map(observation => observation.id) ?? [],
    defaultId,
    requestedStatus,
  )
  const pageKey = `${selectedProject ?? ''}|${urlStartedFrom}|${urlStartedThrough}|${cursor ?? ''}`
  const selectedId = requestedObservationId === null && collapsedPageKey === pageKey
    ? null
    : selection.selectedId

  useEffect(() => {
    setDraftStartedFrom(urlStartedFrom)
    setDraftStartedThrough(urlStartedThrough)
    setDraftError(null)
  }, [urlStartedFrom, urlStartedThrough])

  const selectObservation = (observationId: string) => {
    const next = new URLSearchParams(searchParams)
    setSelectionNotice(null)
    if (selectedId === observationId) {
      next.delete('observation')
      setCollapsedPageKey(pageKey)
    } else {
      next.set('observation', observationId)
      setCollapsedPageKey(null)
    }
    setSearchParams(next)
  }

  const applyFilters = () => {
    const result = materializeObservationDateFilter(draftStartedFrom, draftStartedThrough)
    if (!result.ok) {
      setDraftError(result.message)
      return
    }
    const next = new URLSearchParams(searchParams)
    if (draftStartedFrom) next.set('startedFrom', draftStartedFrom)
    else next.delete('startedFrom')
    if (draftStartedThrough) next.set('startedThrough', draftStartedThrough)
    else next.delete('startedThrough')
    next.delete('cursor')
    next.delete('observation')
    setCollapsedPageKey(null)
    setDraftError(null)
    setSelectionNotice(selectedId ? 'The prior observation selection was cleared because the Started date filter changed.' : null)
    setSearchParams(next)
  }

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('startedFrom')
    next.delete('startedThrough')
    next.delete('cursor')
    next.delete('observation')
    setDraftStartedFrom('')
    setDraftStartedThrough('')
    setDraftError(null)
    setSelectionNotice(null)
    setCollapsedPageKey(null)
    setSearchParams(next)
  }

  const changePage = (nextCursor: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (nextCursor) next.set('cursor', nextCursor)
    else next.delete('cursor')
    next.delete('observation')
    setSelectionNotice(null)
    setCollapsedPageKey(null)
    setSearchParams(next)
  }

  const timezone = materialized.ok
    ? materialized.filter.timezone
    : Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'
  const urlValidationError = !materialized.ok
    ? materialized.message
    : !cursorValid
      ? 'The observation page cursor is invalid. Clear the filters or return to the first page.'
      : null
  const filterDescription = materialized.ok
    ? `${materialized.filter.startedFrom || 'the beginning'} through ${materialized.filter.startedThrough || 'the latest persisted date'} (${materialized.filter.timezone})`
    : 'Invalid date filter'

  return <ApplicationWorkspace>
    {!selectedProject && <section className="rounded-lg border border-border bg-surface p-8 text-center"><h2 className="text-lg font-semibold text-primary">No application selected</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">Select a project to load its immutable observation history.</p></section>}
    {selectedProject && <ObservationHistoryFilterToolbar startedFrom={draftStartedFrom} startedThrough={draftStartedThrough} timezone={timezone} error={draftError} onStartedFromChange={setDraftStartedFrom} onStartedThroughChange={setDraftStartedThrough} onApply={applyFilters} onClear={clearFilters} />}
    {selectedProject && urlValidationError && <section className="rounded border border-fail/40 bg-surface p-4 text-sm text-fail" role="alert">{urlValidationError}<button type="button" onClick={clearFilters} className="ml-3 rounded border border-border px-3 py-1 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Clear filters</button></section>}
    {selectedProject && queryEnabled && historyQuery.isPending && <section className="rounded-lg border border-border bg-surface p-8 text-center" role="status">Loading persisted observation history…</section>}
    {selectedProject && historyQuery.isError && <ErrorState error={historyQuery.error} />}
    {readModel && <>
      {selectionNotice && <div className="rounded border border-unknown/40 bg-surface p-3 text-sm text-secondary" role="status">{selectionNotice}</div>}
      {selection.explanation && <div className="rounded border border-unknown/40 bg-surface p-3 text-sm text-secondary" role="status">{selection.explanation}</div>}
      <ApplicationObservations
        readModel={readModel}
        selectedId={selectedId}
        onSelect={selectObservation}
        filterActive={materialized.ok && materialized.filter.active}
        filterDescription={filterDescription}
        onClearFilters={clearFilters}
        onPrevious={() => changePage(readModel.page.previousCursor)}
        onNext={() => changePage(readModel.page.nextCursor)}
        isPageLoading={historyQuery.isFetching}
      />
    </>}
  </ApplicationWorkspace>
}
