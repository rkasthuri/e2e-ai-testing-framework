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

import { ApiError } from '../api/client'
import { ApplicationReadiness } from '../components/application-workspace/ApplicationReadiness'
import { ApplicationWorkspace } from '../components/application-workspace/ApplicationWorkspace'
import { useApplicationReadiness } from '../hooks/useApi'
import { useCurrentProject } from '../hooks/useCurrentProject'

function BoundedState({ title, explanation, alert = false }: { title: string; explanation: string; alert?: boolean }) {
  return <section className="rounded-lg border border-border bg-surface p-8 text-center" role={alert ? 'alert' : 'status'}><h2 className="text-lg font-semibold text-primary">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">{explanation}</p></section>
}

function ErrorState({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : null
  if (apiError?.code === 'NOT_FOUND') return <BoundedState alert title="Application not found" explanation="The selected project does not exist. Select an onboarded application." />
  if (apiError?.code === 'READINESS_AUTHORITY_CONFLICT') return <BoundedState alert title="Readiness authority conflict" explanation="Project ownership or authoritative active-state evidence conflicts. No readiness conclusion is presented." />
  if (apiError?.code === 'READINESS_SOURCE_INVALID') return <BoundedState alert title="Readiness data could not be validated" explanation="An authoritative observation, model, or evidence projection failed closed. No readiness conclusion is presented." />
  if (apiError?.code === 'BACKEND_UNAVAILABLE' || apiError?.code === 'READINESS_UNAVAILABLE' || apiError?.status === 0) return <BoundedState alert title="FORGE backend unavailable" explanation="Start the local FORGE control plane, then refresh this page." />
  return <BoundedState alert title="Readiness unavailable" explanation="Authoritative readiness inputs could not be loaded safely." />
}

export function ApplicationReadinessPage() {
  const project = useCurrentProject()
  const query = useApplicationReadiness(project)
  return <ApplicationWorkspace>
    {!project && <BoundedState title="No application selected" explanation="Select a project to evaluate decision-specific readiness from its existing evidence." />}
    {project && query.isPending && <BoundedState title="Readiness" explanation="Loading the bounded readiness projection…" />}
    {project && query.isError && <ErrorState error={query.error} />}
    {query.data && <ApplicationReadiness readModel={query.data} />}
  </ApplicationWorkspace>
}
