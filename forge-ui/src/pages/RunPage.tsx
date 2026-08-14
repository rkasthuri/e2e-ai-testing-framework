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

import { AlertTriangle, Loader2, ShieldQuestion } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import type { CanonicalV2TestDefinitionPresentation, ExecutionPreflightState } from '../api/types'
import { ProjectSelector } from '../components/shared/ProjectSelector'
import { useEvidenceBackedTests, useExecutionPreflight } from '../hooks/useApi'

const STATE_LABEL: Record<ExecutionPreflightState, string> = {
  empty_selection: 'Empty selection',
  invalid_request: 'Invalid request',
  stale_definition: 'Stale definition',
  incompatible_definition: 'Intrinsically incompatible',
  legacy_provenance_unsupported: 'Legacy provenance unsupported',
  support_seal_mismatch: 'Support seal mismatch',
  route_unknown: 'Route unknown',
  route_conflicted: 'Route conflicted',
  authentication_unknown: 'Authentication expectation unknown',
  authentication_conflicted: 'Authentication expectation conflicted',
  credentials_unavailable: 'Credentials unavailable',
  runner_unavailable: 'Runner unavailable',
  conflicting_evidence: 'Conflicting evidence',
  preflight_source_invalid: 'Preflight source invalid',
  execution_already_active: 'Execution already active',
  execution_persistence_unavailable: 'Execution persistence unavailable',
  ready: 'Eligible',
}

function BoundedState({ title, explanation, alert = false }: { title: string; explanation: string; alert?: boolean }) {
  return <section className="rounded-lg border border-border bg-surface p-8 text-center" role={alert ? 'alert' : 'status'}><h2 className="text-lg font-semibold text-primary">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">{explanation}</p></section>
}

function DefinitionRow({ definition, eligible }: { definition: CanonicalV2TestDefinitionPresentation; eligible: boolean }) {
  const compatibility = definition.intrinsicCompatibility.state === 'compatible' ? 'Compatible' : definition.intrinsicCompatibility.state === 'blocked' ? 'Blocked' : 'Not evaluated'
  return <article className="rounded-lg border border-border bg-surface p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-brand">Canonical v2 Definition</p><h3 className="mt-1 font-semibold text-primary">{definition.title}</h3><p className="font-mono text-xs text-muted">{definition.definitionId}</p></div><span className={`rounded-full border border-border px-3 py-1 text-sm font-semibold ${eligible ? 'text-pass' : 'text-flaky'}`}>{eligible ? 'Execution eligible' : 'Execution blocked'}</span></div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-xs uppercase text-muted">Intrinsic compatibility</dt><dd className="text-secondary">{compatibility}</dd></div>
      <div><dt className="text-xs uppercase text-muted">Route evidence</dt><dd className="text-secondary">{definition.routeEvidence.state === 'available' ? <code>{definition.routeEvidence.normalizedPath}</code> : definition.routeEvidence.state}</dd></div>
      <div><dt className="text-xs uppercase text-muted">Authentication expectation</dt><dd className="text-secondary">{definition.authenticationExpectation.state.replaceAll('_', ' ')}{definition.authenticationExpectation.mechanism ? ` — ${definition.authenticationExpectation.mechanism}` : ''}</dd></div>
      <div><dt className="text-xs uppercase text-muted">Support seal</dt><dd className="break-all font-mono text-xs text-secondary">{definition.provenance.supportSealHash}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-muted">Compatibility is immutable Definition truth. Eligibility is a live preflight result. Credential availability and authentication execution outcome are not Definition fields.</p>
  </article>
}

function ErrorState({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : null
  if (apiError?.code === 'NOT_FOUND') return <BoundedState alert title="Application not found" explanation="The selected project does not exist. Select an onboarded application." />
  if (apiError?.status === 400) return <BoundedState alert title="Invalid preflight request" explanation="The execution preflight request could not be validated safely." />
  if (apiError?.code === 'BACKEND_UNAVAILABLE' || apiError?.code === 'PREFLIGHT_UNAVAILABLE' || apiError?.status === 0) return <BoundedState alert title="FORGE backend unavailable" explanation="Start the local FORGE control plane, then refresh this page." />
  return <BoundedState alert title="Execution preflight unavailable" explanation="Authoritative preflight inputs could not be loaded safely." />
}

export function RunPage() {
  const [params] = useSearchParams()
  const project = params.get('project')
  const inventory = useEvidenceBackedTests(project, null, null)
  const current = inventory.data?.current?.testSet ?? null
  const canonical = current?.schemaVersion === 2 ? current : null
  const currentDefinitionIds = canonical?.definitions.map(definition => definition.definitionId) ?? []
  const preflight = useExecutionPreflight(project, currentDefinitionIds, canonical?.revision ?? null, currentDefinitionIds.length > 0)

  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div><h1 className="text-2xl font-semibold text-primary">Run</h1><p className="mt-1 max-w-3xl text-sm text-secondary">Canonical v2 execution eligibility, kept separate from immutable Definition compatibility and from eventual execution results.</p></div>
    {!project && <section className="rounded-lg border border-border bg-surface"><ProjectSelector title="Run" subtitle="Select a project to evaluate its current canonical v2 Test Set." basePath="/run" /></section>}
    {project && inventory.isLoading && <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 className="animate-spin" size={18} /> Loading canonical Test Definitions…</div>}
    {project && inventory.isError && <ErrorState error={inventory.error} />}
    {project && inventory.isSuccess && !current && <BoundedState title="No current Test Set revision" explanation="No Test Definition revision has been persisted for this project." />}
    {project && current?.schemaVersion === 1 && <section className="rounded-lg border border-flaky/50 bg-surface p-6"><h2 className="font-semibold text-flaky">LEGACY PROVENANCE — execution unsupported</h2><p className="mt-2 text-sm text-secondary">The current revision is historical v1 compatibility evidence. It remains readable on Test Cases but is not presented as sealed authority and cannot enter new Product execution.</p><Link className="mt-3 inline-block text-brand underline-offset-2 hover:underline" to={`/tests?project=${encodeURIComponent(project)}`}>Open legacy Test Case quarantine</Link></section>}
    {project && canonical && currentDefinitionIds.length === 0 && <BoundedState title="No canonical definitions" explanation="The current v2 revision contains no definitions eligible for preflight." />}
    {project && canonical && currentDefinitionIds.length > 0 && preflight.isLoading && <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 className="animate-spin" size={18} /> Revalidating live execution eligibility…</div>}
    {project && canonical && preflight.isError && <ErrorState error={preflight.error} />}
    {project && canonical && preflight.data && <>
      <aside className="flex gap-3 rounded-lg border border-flaky/40 bg-elevated p-4 text-sm text-secondary"><AlertTriangle className="shrink-0 text-flaky" size={18} /><p><strong className="text-primary">No execution occurred.</strong> Preflight re-read the immutable v2 Definition authority and live runtime prerequisites; it created no Execution, Run, or Result.</p></aside>
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.18em] text-brand">Live execution eligibility</p><h2 className="mt-1 text-xl font-semibold text-primary">{preflight.data.aggregate.state === 'ready' ? 'Eligible' : 'Blocked'}</h2><p className="mt-1 text-sm text-secondary">{preflight.data.aggregate.explanation}</p></div><span className={`rounded-full border border-border px-3 py-1 text-sm font-semibold ${preflight.data.aggregate.state === 'ready' ? 'text-pass' : 'text-flaky'}`}>{STATE_LABEL[preflight.data.aggregate.state]}</span></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Intrinsic generation authority</dt><dd className="mt-1 text-secondary">{preflight.data.boundaries.generationAuthority.replaceAll('_', ' ')}</dd></div><div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Runner availability</dt><dd className="mt-1 text-secondary">{preflight.data.liveEligibility.runner}</dd></div><div className="rounded border border-border bg-elevated p-3"><dt className="text-muted">Credential availability</dt><dd className="mt-1 text-secondary">{preflight.data.liveEligibility.credentials.replaceAll('_', ' ')}</dd></div></dl>
      </section>
      <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="authority-snapshot"><div className="flex items-center gap-2"><ShieldQuestion size={18} className="text-brand" /><h2 id="authority-snapshot" className="text-lg font-semibold text-primary">Sealed authority snapshot</h2></div><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">Test Set</dt><dd className="font-mono text-secondary">{canonical.testSetId} · revision {canonical.revision}</dd></div><div><dt className="text-muted">Support seal</dt><dd className="break-all font-mono text-xs text-secondary">{canonical.provenance.supportSealHash}</dd></div><div><dt className="text-muted">Model</dt><dd className="text-secondary">{canonical.provenance.modelVersion} (row {canonical.provenance.modelRowId})</dd></div><div><dt className="text-muted">Canonical support</dt><dd className="text-secondary">{canonical.provenance.supportingObservationCount} Observations · {canonical.provenance.supportingGapCount} Gaps · {canonical.provenance.subjectSupportCount} subject-support entries</dd></div></dl></section>
      <section aria-labelledby="preflight-definitions"><h2 id="preflight-definitions" className="mb-3 text-xl font-semibold text-primary">Canonical v2 definitions ({canonical.definitions.length})</h2><div className="grid gap-4">{canonical.definitions.map(definition => <DefinitionRow key={definition.definitionId} definition={definition} eligible={preflight.data.definitions.some(item => item.definitionId === definition.definitionId && item.state === 'eligible')} />)}</div></section>
    </>}
  </div>
}
