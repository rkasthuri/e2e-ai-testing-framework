/**
 * FORGE — Autonomous Quality Engineering
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

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { ApplicationModel } from '../components/application-workspace/ApplicationModel'
import { ApplicationWorkspace } from '../components/application-workspace/ApplicationWorkspace'
import { useApplicationModelHistory } from '../hooks/useApi'
import { useCurrentProject } from '../hooks/useCurrentProject'

function ModelErrorState({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : null
  const content = apiError?.code === 'NOT_FOUND'
    ? ['Application not found', 'The selected project does not exist. Select an onboarded application.']
    : apiError?.code === 'APP_MODEL_MULTIPLE_ACTIVE'
      ? ['Multiple active models detected', 'Authoritative history has more than one active model. No version is presented as current.']
      : apiError?.code === 'APP_MODEL_ACTIVE_MISSING'
        ? ['Active model missing', 'Model history exists without an active version. Historical versions are not presented as current truth.']
        : apiError?.code === 'APP_MODEL_HISTORY_INVALID'
          ? ['Model history could not be validated', 'Persisted model metadata is malformed. No history is presented.']
          : apiError?.code === 'BACKEND_UNAVAILABLE' || apiError?.status === 0
            ? ['FORGE backend unavailable', 'Start the local FORGE control plane, then refresh this page.']
            : ['Application Model unavailable', 'Authoritative model data could not be loaded safely.']
  return <section className="rounded-lg border border-fail/40 bg-surface p-8 text-center" role="alert"><h1 className="text-lg font-semibold text-primary">{content[0]}</h1><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">{content[1]}</p></section>
}

export function ApplicationModelPage() {
  const project = useCurrentProject()
  const [searchParams, setSearchParams] = useSearchParams()
  const cursor = searchParams.get('cursor')
  const modelParam = searchParams.get('model')
  const cursorValid = cursor === null || /^[A-Za-z0-9_-]{1,1024}$/.test(cursor)
  const modelValid = modelParam === null || /^[1-9]\d{0,14}$/.test(modelParam)
  const requestedRowId = modelValid && modelParam !== null ? Number(modelParam) : null
  const [collapsedPageKey, setCollapsedPageKey] = useState<string | null>(null)
  const query = useApplicationModelHistory(project, {
    cursor: cursorValid ? cursor : null,
    modelRowId: requestedRowId,
  }, cursorValid && modelValid)
  const pageKey = `${project ?? ''}|${cursor ?? ''}`
  const onPageIds = query.data?.models.map(model => model.rowId) ?? []
  const defaultRowId = query.data?.currentModel && onPageIds.includes(query.data.currentModel.rowId)
    ? query.data.currentModel.rowId
    : onPageIds[0] ?? null
  const requestedStatus = query.data?.requestedModel?.rowId === requestedRowId
    ? query.data.requestedModel.status
    : null
  const selectedRowId = modelParam === null && collapsedPageKey === pageKey
    ? null
    : requestedRowId !== null && onPageIds.includes(requestedRowId)
      ? requestedRowId
      : defaultRowId
  const selectionExplanation = modelParam !== null && !modelValid
    ? 'The requested model identity is malformed. The newest model on this page is selected instead.'
    : requestedRowId !== null && requestedStatus === 'outside_page'
      ? 'The requested project-owned model is outside this bounded page. Use Previous or Next to navigate without loading the full history.'
      : requestedRowId !== null && requestedStatus === 'not_found'
        ? 'The requested model does not belong to this project. The newest model on this page is selected instead.'
        : null

  const selectModel = (rowId: number) => {
    const next = new URLSearchParams(searchParams)
    if (selectedRowId === rowId) {
      next.delete('model')
      setCollapsedPageKey(pageKey)
    } else {
      next.set('model', String(rowId))
      setCollapsedPageKey(null)
    }
    setSearchParams(next)
  }
  const changePage = (nextCursor: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (nextCursor) next.set('cursor', nextCursor)
    else next.delete('cursor')
    next.delete('model')
    setCollapsedPageKey(null)
    setSearchParams(next)
  }

  return <ApplicationWorkspace>
    {!project && <section className="rounded-lg border border-border bg-surface p-8 text-center"><h1 className="text-lg font-semibold text-primary">No application selected</h1><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">Select a project to load its authoritative Application Model.</p></section>}
    {project && (!cursorValid || !modelValid) && <section className="rounded border border-unknown/40 bg-surface p-4 text-sm text-secondary" role="alert"><h1 className="text-lg font-semibold text-primary">Invalid model-history URL state</h1><p className="mt-2">Return to the first page to continue.</p><button type="button" onClick={() => { const next = new URLSearchParams(searchParams); next.delete('cursor'); next.delete('model'); setCollapsedPageKey(null); setSearchParams(next) }} className="mt-3 rounded border border-border px-3 py-1 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Return to first page</button></section>}
    {project && cursorValid && modelValid && query.isPending && <section className="rounded-lg border border-border bg-surface p-8 text-center" role="status"><h1 className="text-lg font-semibold text-primary">Application Model</h1><p className="mt-2 text-sm text-secondary">Loading authoritative model history…</p></section>}
    {project && query.isError && <ModelErrorState error={query.error} />}
    {query.data && <>{selectionExplanation && <div className="rounded border border-unknown/40 bg-surface p-3 text-sm text-secondary" role="status">{selectionExplanation}</div>}<ApplicationModel readModel={query.data} selectedRowId={selectedRowId} onSelect={selectModel} onPrevious={() => changePage(query.data!.page.previousCursor)} onNext={() => changePage(query.data!.page.nextCursor)} isPageLoading={query.isFetching} /></>}
  </ApplicationWorkspace>
}
