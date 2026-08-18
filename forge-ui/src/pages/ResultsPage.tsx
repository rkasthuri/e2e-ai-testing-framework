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

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  CanonicalResultsIntegrityError,
  CanonicalResultsPayloadError,
} from '../api/resultsClient'
import type {
  CanonicalExecutionResultItem,
  CanonicalExecutionResultsDetail,
  CanonicalExecutionResultsListItem,
  CanonicalResultOutcome,
  CanonicalResultsIntegrityWarning,
} from '../api/resultsContract'
import { ProjectSelector } from '../components/shared/ProjectSelector'
import {
  useCanonicalExecutionResultDetail,
  useCanonicalExecutionResults,
} from '../hooks/useApi'

const OUTCOME_PRESENTATION: Record<CanonicalResultOutcome, { label: string; className: string }> = {
  passed: { label: 'Passed', className: 'border-pass/40 text-pass' },
  failed: { label: 'Failed', className: 'border-fail/40 text-fail' },
  could_not_verify: { label: 'Could not verify', className: 'border-unknown/40 text-unknown' },
}

function readable(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())
}

function Time({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{new Date(value).toLocaleString()}</time>
}

function OutcomeBadge({ outcome, prefix }: { outcome: CanonicalResultOutcome; prefix?: string }) {
  const presentation = OUTCOME_PRESENTATION[outcome]
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${presentation.className}`}>
    {prefix ? `${prefix}: ` : ''}{presentation.label}
  </span>
}

function MissingBadge() {
  return <span className="inline-flex rounded-full border border-flaky/40 px-2.5 py-1 text-xs font-semibold text-flaky">Missing Result</span>
}

function IntegrityBadge({ state }: { state: CanonicalExecutionResultsListItem['integrityState'] }) {
  const className = state === 'valid' ? 'border-pass/40 text-pass' : state === 'warning' ? 'border-flaky/40 text-flaky' : 'border-fail/40 text-fail'
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>Integrity: {readable(state)}</span>
}

function BoundedState({ title, explanation, alert = false }: { title: string; explanation: string; alert?: boolean }) {
  return <section role={alert ? 'alert' : 'status'} className="rounded-lg border border-border bg-surface p-8 text-center">
    <h2 className="text-lg font-semibold text-primary">{title}</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm text-secondary">{explanation}</p>
  </section>
}

export function IntegrityRefusal({ warnings = [] }: { warnings?: readonly CanonicalResultsIntegrityWarning[] }) {
  return <section role="alert" className="rounded-lg border border-fail/50 bg-surface p-6">
    <div className="flex items-start gap-3">
      <ShieldAlert className="mt-0.5 shrink-0 text-fail" size={20} />
      <div>
        <h2 className="font-semibold text-primary">Results integrity could not be established</h2>
        <p className="mt-1 text-sm text-secondary">Results cannot be safely presented because canonical evidence integrity could not be established. FORGE will not substitute empty values or legacy evidence.</p>
        {warnings.length > 0 && <ul className="mt-3 space-y-2 text-sm text-secondary">
          {warnings.map((warning, index) => <li key={`${warning.code}-${index}`}><strong className="text-primary">{readable(warning.code)}:</strong> {warning.safeMessage}</li>)}
        </ul>}
      </div>
    </div>
  </section>
}

export function ResultsError({ error, subject }: { error: unknown; subject: 'history' | 'detail' }) {
  if (error instanceof CanonicalResultsIntegrityError) return <IntegrityRefusal warnings={error.integrityWarnings} />
  if (error instanceof CanonicalResultsPayloadError) return <BoundedState alert title="Canonical Results response was invalid" explanation="FORGE refused a malformed Results payload. No Result truth was inferred from it." />
  if (error instanceof ApiError && error.status === 404) return <BoundedState alert title={subject === 'detail' ? 'Execution not found' : 'Project not found'} explanation={subject === 'detail' ? 'The selected canonical Product execution does not exist for this project.' : 'The selected project does not exist.'} />
  if (error instanceof ApiError && (error.status === 0 || error.code === 'BACKEND_UNAVAILABLE')) return <BoundedState alert title="FORGE backend unavailable" explanation="Canonical Results could not be reached. No legacy source was used as a fallback." />
  return <BoundedState alert title={`Results ${subject} unavailable`} explanation="Canonical Results authority could not be read safely. Try again after the underlying API issue is resolved." />
}

function EvidenceCounts({ item }: { item: CanonicalExecutionResultsListItem }) {
  if (item.integrityState === 'invalid') return null
  const missing = item.expectedResultCount - item.observedResultCount
  return <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
    <div><span className="block text-xs text-muted">Passed</span><strong className="text-pass">{item.passedResultCount}</strong></div>
    <div><span className="block text-xs text-muted">Failed</span><strong className="text-fail">{item.failedResultCount}</strong></div>
    <div><span className="block text-xs text-muted">Could not verify</span><strong className="text-unknown">{item.couldNotVerifyResultCount}</strong></div>
    <div><span className="block text-xs text-muted">Missing</span><strong className="text-flaky">{missing}</strong></div>
  </div>
}

export function ExecutionHistory({
  executions,
  selectedExecutionId,
  onSelect,
}: {
  executions: readonly CanonicalExecutionResultsListItem[]
  selectedExecutionId: string | null
  onSelect: (executionId: string) => void
}) {
  if (executions.length === 0) return <BoundedState title="No Product executions yet" explanation="This project has no canonical Product execution history. Open Run to review current execution eligibility." />
  return <section aria-labelledby="execution-history-heading" className="space-y-3">
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-brand">Canonical Product history</p>
      <h2 id="execution-history-heading" className="mt-1 text-xl font-semibold text-primary">Executions</h2>
    </div>
    <div className="space-y-3">
      {executions.map(item => {
        const selected = item.executionId === selectedExecutionId
        const invalid = item.integrityState === 'invalid'
        return <article key={item.executionId} className={`rounded-lg border bg-surface ${selected ? 'border-brand ring-1 ring-brand' : invalid ? 'border-fail/50' : 'border-border'}`}>
          <button
            type="button"
            disabled={invalid}
            aria-current={selected ? 'true' : undefined}
            aria-label={invalid ? `Execution ${item.executionId}: Results integrity invalid` : `Inspect execution ${item.executionId}`}
            onClick={() => onSelect(item.executionId)}
            className="w-full rounded-lg p-4 text-left outline-none transition hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-muted">Execution ID</p>
                <p className="break-all font-mono text-sm text-primary">{item.executionId}</p>
                <p className="mt-1 text-xs text-secondary">Accepted <Time value={item.acceptedAt} /></p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-run">Lifecycle: {readable(item.lifecycle)}</span>
                {item.evidenceHeadlineOutcome && <OutcomeBadge outcome={item.evidenceHeadlineOutcome} prefix="Evidence" />}
                <IntegrityBadge state={item.integrityState} />
                {!invalid && <ChevronRight aria-hidden="true" size={18} className="text-muted" />}
              </div>
            </div>
            {invalid ? <p className="mt-4 text-sm text-fail">Normal Results are withheld because canonical integrity is invalid.</p> : <>
              <div className="mt-4 grid gap-4 md:grid-cols-[minmax(12rem,1fr)_2fr]">
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-muted">Lifecycle</dt><dd className="text-primary">{readable(item.lifecycle)}</dd></div>
                  <div><dt className="text-xs text-muted">Terminal outcome</dt><dd className="text-primary">{item.terminalOutcome ? OUTCOME_PRESENTATION[item.terminalOutcome].label : 'Not persisted'}</dd></div>
                  <div><dt className="text-xs text-muted">Evidence completeness</dt><dd className="text-primary">{item.observedResultCount} of {item.expectedResultCount} observed</dd></div>
                  <div><dt className="text-xs text-muted">Product Runs</dt><dd className="text-primary">{item.runCount}</dd></div>
                </dl>
                <EvidenceCounts item={item} />
              </div>
              {item.lifecycle === 'running' && item.observedResultCount < item.expectedResultCount && <p className="mt-3 text-xs text-secondary">Execution is still running; current evidence is incomplete.</p>}
            </>}
          </button>
        </article>
      })}
    </div>
  </section>
}

function ResultIcon({ item }: { item: CanonicalExecutionResultItem }) {
  if (item.evidence.kind === 'missing_result') return <CircleDashed aria-hidden="true" className="text-flaky" size={20} />
  if (item.evidence.outcome === 'passed') return <CheckCircle2 aria-hidden="true" className="text-pass" size={20} />
  if (item.evidence.outcome === 'failed') return <XCircle aria-hidden="true" className="text-fail" size={20} />
  return <AlertTriangle aria-hidden="true" className="text-unknown" size={20} />
}

function ResultItem({ item }: { item: CanonicalExecutionResultItem }) {
  if (item.evidence.kind === 'missing_result') return <article className="rounded-lg border border-border bg-elevated p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <ResultIcon item={item} />
        <div className="min-w-0"><p className="text-xs text-muted">Manifest item {item.manifestOrdinal}</p><h4 className="break-all font-mono text-sm font-semibold text-primary">Definition {item.definitionId}</h4></div>
      </div>
      <MissingBadge />
    </div>
    <p className="mt-3 text-sm text-secondary"><strong className="text-flaky">Expected Result missing.</strong> No persisted Result row exists for this manifest item.</p>
    <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-brand outline-none focus-visible:ring-2 focus-visible:ring-brand">Technical provenance</summary><dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-muted">Definition ID</dt><dd className="break-all font-mono text-secondary">{item.definitionId}</dd></div><div><dt className="text-muted">Executable plan hash</dt><dd className="break-all font-mono text-secondary">{item.executablePlanHash}</dd></div></dl></details>
  </article>
  const evidence = item.evidence
  return <article className="rounded-lg border border-border bg-elevated p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <ResultIcon item={item} />
        <div className="min-w-0">
          <p className="text-xs text-muted">Manifest item {item.manifestOrdinal}</p>
          <h4 className="break-all font-mono text-sm font-semibold text-primary">Definition {item.definitionId}</h4>
        </div>
      </div>
      <OutcomeBadge outcome={evidence.outcome} />
    </div>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-muted">Result ID</dt><dd className="break-all font-mono text-primary">{evidence.resultId}</dd></div>
      <div><dt className="text-xs text-muted">Reason</dt><dd className="text-primary">{readable(evidence.reasonCode)}</dd></div>
      <div><dt className="text-xs text-muted">Duration</dt><dd className="text-primary">{evidence.durationMs} ms</dd></div>
    </dl>
    <p className="mt-3 text-xs text-muted">Detailed diagnostic evidence was not persisted for this Result.</p>
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-brand outline-none focus-visible:ring-2 focus-visible:ring-brand">Technical provenance</summary>
      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="text-muted">Definition ID</dt><dd className="break-all font-mono text-secondary">{item.definitionId}</dd></div>
        <div><dt className="text-muted">Executable plan hash</dt><dd className="break-all font-mono text-secondary">{item.executablePlanHash}</dd></div>
        <div><dt className="text-muted">Result ID</dt><dd className="break-all font-mono text-secondary">{evidence.resultId}</dd></div>
      </dl>
    </details>
  </article>
}

function DefinitionProvenance({ detail }: { detail: CanonicalExecutionResultsDetail }) {
  const authority = detail.execution.definitionAuthority
  return <details className="rounded-lg border border-border bg-surface p-4">
    <summary className="cursor-pointer font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Execution authority and provenance</summary>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div><dt className="text-xs text-muted">Execution ID</dt><dd className="break-all font-mono text-secondary">{detail.execution.executionId}</dd></div>
      <div><dt className="text-xs text-muted">Run ID</dt><dd className="break-all font-mono text-secondary">{detail.run?.runId ?? 'No Product Run persisted'}</dd></div>
      <div><dt className="text-xs text-muted">Test Set</dt><dd className="break-all font-mono text-secondary">{authority.testSetId} · revision {authority.revision}</dd></div>
      <div><dt className="text-xs text-muted">App Model</dt><dd className="text-secondary">{authority.modelVersion} (row {authority.modelRowId})</dd></div>
      <div><dt className="text-xs text-muted">Support seal</dt><dd className="break-all font-mono text-xs text-secondary">{authority.supportSealHash ?? 'Not persisted'}</dd></div>
      <div><dt className="text-xs text-muted">Route evidence identity</dt><dd className="break-all font-mono text-xs text-secondary">{authority.routeEvidenceIdentityHash ?? 'Not persisted'}</dd></div>
      <div><dt className="text-xs text-muted">Authentication expectation identity</dt><dd className="break-all font-mono text-xs text-secondary">{authority.authenticationExpectationIdentityHash ?? 'Not persisted'}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-muted">Authentication expectation is provenance, not an authentication execution outcome.</p>
  </details>
}

export function ExecutionResultsDetail({ detail }: { detail: CanonicalExecutionResultsDetail }) {
  const observed = detail.items.filter(item => item.evidence.kind === 'observed_result').length
  return <section aria-labelledby="execution-detail-heading" className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs uppercase tracking-[0.16em] text-brand">Selected execution</p><h2 id="execution-detail-heading" className="mt-1 text-xl font-semibold text-primary">Execution Results</h2></div>
      <OutcomeBadge outcome={detail.evidenceHeadlineOutcome} prefix="Current evidence" />
    </div>

    {detail.integrityWarnings.length > 0 && <aside className="rounded-lg border border-flaky/40 bg-surface p-4" role="status">
      <div className="flex gap-3"><AlertTriangle className="shrink-0 text-flaky" size={18} /><div><h3 className="font-semibold text-primary">Integrity warnings</h3><ul className="mt-1 space-y-1 text-sm text-secondary">{detail.integrityWarnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.safeMessage}</li>)}</ul></div></div>
    </aside>}

    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="execution-truth-heading">
      <h3 id="execution-truth-heading" className="font-semibold text-primary">Execution truth</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-muted">Lifecycle</dt><dd className="font-medium text-run">{readable(detail.execution.lifecycle)}</dd></div>
        <div><dt className="text-xs text-muted">Current evidence headline</dt><dd className={OUTCOME_PRESENTATION[detail.evidenceHeadlineOutcome].className.split(' ').at(-1)}>{OUTCOME_PRESENTATION[detail.evidenceHeadlineOutcome].label}</dd></div>
        <div><dt className="text-xs text-muted">Persisted terminal outcome</dt><dd className="text-primary">{detail.execution.terminalOutcome ? OUTCOME_PRESENTATION[detail.execution.terminalOutcome].label : 'Not persisted'}</dd></div>
        <div><dt className="text-xs text-muted">Evidence completeness</dt><dd className="text-primary">{observed} of {detail.execution.expectedResultCount} observed</dd></div>
        <div><dt className="text-xs text-muted">Accepted</dt><dd className="text-secondary"><Time value={detail.execution.acceptedAt} /></dd></div>
        <div><dt className="text-xs text-muted">Terminal time</dt><dd className="text-secondary">{detail.execution.terminalAt ? <Time value={detail.execution.terminalAt} /> : 'Not persisted'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs text-muted">Authority reason</dt><dd className="text-secondary">{detail.execution.authorityReasonCode ? readable(detail.execution.authorityReasonCode) : 'No canonical reason persisted'}</dd></div>
      </dl>
      {!detail.execution.terminalOutcome && <p className="mt-3 text-xs text-secondary">The evidence headline describes current persisted evidence; it is not a terminal execution verdict.</p>}
    </section>

    {detail.run ? <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="run-truth-heading">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="run-truth-heading" className="font-semibold text-primary">Product Run</h3><p className="break-all font-mono text-xs text-muted">Run ID {detail.run.runId}</p></div>{detail.run.evidenceOutcome ? <OutcomeBadge outcome={detail.run.evidenceOutcome} prefix="Run evidence" /> : <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted">No Run evidence outcome persisted</span>}</div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-muted">Lifecycle</dt><dd className="text-run">{readable(detail.run.lifecycle)}</dd></div>
        <div><dt className="text-xs text-muted">Evidence reason</dt><dd className="text-secondary">{detail.run.evidenceReasonCode ? readable(detail.run.evidenceReasonCode) : 'No canonical reason persisted'}</dd></div>
        <div><dt className="text-xs text-muted">Started</dt><dd className="text-secondary"><Time value={detail.run.startedAt} /></dd></div>
        <div><dt className="text-xs text-muted">Terminal time</dt><dd className="text-secondary">{detail.run.terminalAt ? <Time value={detail.run.terminalAt} /> : 'Not persisted'}</dd></div>
      </dl>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded border border-border bg-elevated p-3 text-sm sm:grid-cols-4"><span><strong className="text-pass">{detail.run.evidenceCounts.passed}</strong> passed</span><span><strong className="text-fail">{detail.run.evidenceCounts.failed}</strong> failed</span><span><strong className="text-unknown">{detail.run.evidenceCounts.couldNotVerify}</strong> could not verify</span><span><strong className="text-flaky">{detail.run.evidenceCounts.missing}</strong> missing</span></div>
    </section> : <aside className="rounded-lg border border-border bg-surface p-4"><div className="flex gap-3"><Ban className="shrink-0 text-muted" size={18} /><div><h3 className="font-semibold text-primary">No Product Run persisted</h3><p className="mt-1 text-sm text-secondary">This execution has no Product Run. No Run identity or Result evidence was manufactured.</p></div></div></aside>}

    <section aria-labelledby="result-items-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h3 id="result-items-heading" className="text-lg font-semibold text-primary">Manifest Results</h3><p className="text-sm text-secondary">Canonical ordinal order · {observed} observed · {detail.items.length - observed} missing</p></div></div>
      <div className="grid gap-3">{detail.items.map(item => <ResultItem key={`${item.manifestOrdinal}-${item.definitionId}`} item={item} />)}</div>
    </section>
    <DefinitionProvenance detail={detail} />
  </section>
}

export function ResultsPage() {
  const [params, setParams] = useSearchParams()
  const project = params.get('project')
  const requestedExecution = params.get('execution')
  const history = useCanonicalExecutionResults(project)
  const executions = history.data?.executions ?? []
  const safelyProjectableExecutionCount = executions.filter(item => item.integrityState !== 'invalid').length
  const requestedItem = requestedExecution ? executions.find(item => item.executionId === requestedExecution) ?? null : null
  const selectedExecutionId = requestedItem?.integrityState !== 'invalid' && requestedItem
    ? requestedExecution
    : null
  const detail = useCanonicalExecutionResultDetail(project, selectedExecutionId)

  function selectExecution(executionId: string) {
    const next = new URLSearchParams(params)
    next.set('execution', executionId)
    setParams(next)
  }

  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div><p className="text-xs uppercase tracking-[0.18em] text-brand">Persisted canonical authority</p><h1 className="mt-1 text-2xl font-semibold text-primary">Results</h1><p className="mt-1 max-w-3xl text-sm text-secondary">Review what ran, what Result evidence FORGE persisted, what that evidence currently supports, and what remains explicitly missing.</p></div>
    {!project && <section className="rounded-lg border border-border bg-surface"><ProjectSelector title="Results" subtitle="Select a project to read its canonical Product execution history." basePath="/results" /></section>}
    {project && history.isLoading && <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 className="animate-spin" size={18} /> Loading canonical execution history…</div>}
    {project && history.isError && <ResultsError error={history.error} subject="history" />}
    {project && history.data && <div className="grid items-start gap-6 lg:grid-cols-[minmax(19rem,0.8fr)_minmax(0,1.4fr)]">
      <ExecutionHistory executions={executions} selectedExecutionId={selectedExecutionId} onSelect={selectExecution} />
      <div className="min-w-0">
        {requestedItem?.integrityState === 'invalid'
          ? <IntegrityRefusal />
          : requestedExecution && !selectedExecutionId
            ? <BoundedState alert title="Execution not found" explanation="The requested execution is not present in this project's canonical Product history." />
          : !selectedExecutionId
            ? safelyProjectableExecutionCount > 0
              ? <BoundedState title="Select an execution" explanation="Choose a canonical execution to inspect its Run, manifest Results, missing evidence, and provenance." />
              : executions.length > 0 && <IntegrityRefusal />
            : detail.isLoading
              ? <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 className="animate-spin" size={18} /> Loading execution Results…</div>
              : detail.isError
                ? <ResultsError error={detail.error} subject="detail" />
                : detail.data
                  ? <ExecutionResultsDetail detail={detail.data} />
                  : null}
      </div>
    </div>}
    <aside className="flex gap-3 rounded-lg border border-border bg-elevated p-4 text-xs text-secondary"><Clock3 className="shrink-0 text-brand" size={17} /><p>Evidence completeness is not a pass rate. Missing Results remain missing, and current evidence is kept separate from persisted terminal outcome.</p></aside>
  </div>
}
