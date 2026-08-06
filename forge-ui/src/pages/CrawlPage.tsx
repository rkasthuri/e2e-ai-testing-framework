import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, FileSearch, Loader2, Play, ShieldAlert, XCircle } from 'lucide-react'
import { useCurrentProject } from '../hooks/useCurrentProject'
import {
  useCrawl,
  useCrawlProjectContext,
  useCrawlStatus,
  useLatestObservation,
} from '../hooks/useApi'
import { apiClient } from '../api/client'
import type { ObservationRecord } from '../api/types'
import { ProjectSelector } from '../components/shared/ProjectSelector'
import { MissionTimeline } from '../components/shared/MissionTimeline'
import { CrawlDiagnostics } from '../components/shared/CrawlDiagnostics'

const terminalStateLabel: Record<ObservationRecord['terminalState'], string> = {
  completed: 'Completed',
  partially_completed: 'Partially completed',
  blocked: 'Blocked',
  failed: 'Failed',
  unknown: 'Unknown',
}

const credentialLabel = {
  available: 'Credentials available',
  missing: 'Credentials missing',
  not_required: 'Credentials not required',
  unknown: 'Credential availability unknown',
} as const

const authenticationLabel: Record<ObservationRecord['authentication']['outcome'], string> = {
  succeeded: 'Authentication succeeded',
  failed: 'Authentication failed',
  not_evaluated: 'Authentication not evaluated',
  not_required: 'Authentication not required',
}

function Timestamp({ value }: { value: string | null }) {
  if (!value) return <>Not recorded</>
  const date = new Date(value)
  const label = Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  return <time dateTime={value} title={value}>{label}</time>
}

function ObservationResult({ observation }: { observation: ObservationRecord }) {
  const positive = observation.terminalState === 'completed'
  const StateIcon = positive ? CheckCircle2 : observation.terminalState === 'failed' ? XCircle : ShieldAlert
  return (
    <section className="rounded-lg border border-border bg-surface p-6" aria-labelledby="observation-result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Observation result</p>
          <h2 id="observation-result" className="mt-1 text-xl font-semibold text-primary">{terminalStateLabel[observation.terminalState]}</h2>
        </div>
        <StateIcon size={22} className={positive ? 'text-pass' : observation.terminalState === 'failed' ? 'text-fail' : 'text-unknown'} />
      </div>
      <p className="mt-3 text-sm text-secondary">{observation.stateReason}</p>

      <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs uppercase tracking-wide text-muted">Run identity</dt><dd className="mt-1 break-all font-mono text-secondary">{observation.observationId}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Started</dt><dd className="mt-1 text-secondary"><Timestamp value={observation.startedAt} /></dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Completed</dt><dd className="mt-1 text-secondary"><Timestamp value={observation.completedAt} /></dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Source</dt><dd className="mt-1 text-secondary">{observation.sourceKind}</dd></div>
      </dl>

      <div className="mt-5 rounded border border-border bg-elevated p-4">
        <p className="text-xs uppercase tracking-wide text-muted">Authentication</p>
        <p className="mt-1 text-sm font-medium text-primary">{authenticationLabel[observation.authentication.outcome]}</p>
        <p className="mt-1 text-xs text-secondary">{observation.authentication.reason}</p>
        <p className="mt-2 text-xs text-muted">{credentialLabel[observation.authentication.credentialAvailability]}</p>
        {!!observation.authentication.attempts?.length && <details className="mt-3 text-xs text-secondary">
          <summary className="cursor-pointer font-medium text-primary">Authentication stage diagnostics</summary>
          <div className="mt-3 space-y-3">
            {observation.authentication.attempts.map(attempt => <div key={attempt.roleId} className="rounded border border-border p-3">
              <p className="font-medium text-primary">Role {attempt.roleId}: {attempt.outcome}</p>
              <ol className="mt-2 space-y-2">
                {attempt.stages.map(stage => <li key={stage.stage}>
                  <p><span className="font-medium text-primary">{stage.stage}</span>: {stage.outcome}</p>
                  <p className="text-muted">Selector strategy: {stage.selectorStrategyCategory}
                    {stage.matchCount !== undefined ? `; matches: ${stage.matchCount}` : ''}
                    {stage.safeErrorType ? `; safe error type: ${stage.safeErrorType}` : ''}
                  </p>
                  {stage.controlVisible !== undefined && <p className="text-muted">Control visible: {String(stage.controlVisible)}</p>}
                  {(stage.usernameEntryCompleted !== undefined || stage.passwordEntryCompleted !== undefined) && <p className="text-muted">Value entry completed: username {String(stage.usernameEntryCompleted ?? false)}; password {String(stage.passwordEntryCompleted ?? false)}</p>}
                  {stage.submissionAttempted !== undefined && <p className="text-muted">Submission attempted: {String(stage.submissionAttempted)}</p>}
                  {stage.urlClassification && <p className="text-muted">Location: {stage.urlClassification.origin}; {stage.urlClassification.path}</p>}
                  {stage.loginSurfaceRetained !== undefined && <p className="text-muted">Login surface retained: {String(stage.loginSurfaceRetained)}</p>}
                </li>)}
              </ol>
            </div>)}
          </div>
        </details>}
      </div>

      {observation.modelRecovery && <div className="mt-5 rounded border border-brand/40 bg-elevated p-4" aria-labelledby="model-recovery-result">
        <h3 id="model-recovery-result" className="text-sm font-semibold text-primary">Guarded Application Model recovery</h3>
        <p className="mt-1 text-xs text-secondary">The incompatible source model was preserved as historical evidence. A fresh candidate was validated and activated through a guarded transaction.</p>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="uppercase tracking-wide text-muted">Preserved source</dt><dd className="mt-1 text-secondary">Row {observation.modelRecovery.sourceRowId}, version {observation.modelRecovery.sourceVersion}</dd></div>
          <div><dt className="uppercase tracking-wide text-muted">Detected</dt><dd className="mt-1 text-secondary"><Timestamp value={observation.modelRecovery.detectedAt} /></dd></div>
          <div><dt className="uppercase tracking-wide text-muted">Decision</dt><dd className="mt-1 text-secondary">Force re-crawl with guarded recovery</dd></div>
          <div><dt className="uppercase tracking-wide text-muted">Validated replacement</dt><dd className="mt-1 text-secondary">Row {observation.modelRecovery.replacementRowId}, version {observation.modelRecovery.replacementVersion}</dd></div>
        </dl>
        <details className="mt-3 text-xs text-secondary"><summary className="cursor-pointer font-medium text-primary">Schema diagnostics</summary><ul className="mt-2 space-y-1">{observation.modelRecovery.validationErrors.map(item => <li key={item}>{item}</li>)}</ul><p className="mt-2 break-all text-muted">Source fingerprint: {observation.modelRecovery.sourceFingerprint}</p></details>
      </div>}

      {observation.modelRecoveryFailure && <div className="mt-5 rounded border border-fail/40 bg-elevated p-4" aria-labelledby="model-recovery-failure">
        <h3 id="model-recovery-failure" className="text-sm font-semibold text-primary">Guarded recovery terminal phases</h3>
        <p className="mt-1 text-xs text-secondary">The crawl and guarded model transition are reported separately. A failed persistence phase does not erase authentication or crawl execution that already occurred.</p>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="uppercase tracking-wide text-muted">Crawl execution</dt><dd className="mt-1 text-secondary">{observation.modelRecoveryFailure.phases.crawlExecution}</dd></div>
          <div><dt className="uppercase tracking-wide text-muted">Authentication</dt><dd className="mt-1 text-secondary">{observation.modelRecoveryFailure.phases.authentication}</dd></div>
          <div><dt className="uppercase tracking-wide text-muted">Model generation</dt><dd className="mt-1 text-secondary">{observation.modelRecoveryFailure.phases.modelGeneration}</dd></div>
          <div><dt className="uppercase tracking-wide text-muted">Guarded persistence</dt><dd className="mt-1 text-secondary">{observation.modelRecoveryFailure.phases.guardedPersistence}</dd></div>
        </dl>
        <details className="mt-3 text-xs text-secondary">
          <summary className="cursor-pointer font-medium text-primary">Redacted persistence diagnostic</summary>
            <p className="mt-2">Stage: {observation.modelRecoveryFailure.persistenceDiagnostic.stage}</p>
            <ul className="mt-2 space-y-1">{observation.modelRecoveryFailure.persistenceDiagnostic.causeChain.map((item, index) => <li key={`${index}-${item.name}-${item.code ?? 'none'}`}>{item.name}{item.code ? ` (${item.code})` : ''}: {item.summary}</li>)}</ul>
            {!!observation.modelRecoveryFailure.persistenceDiagnostic.structuralIssues?.length && <><p className="mt-3 font-medium text-primary">Non-canonical structures</p><ul className="mt-2 space-y-1">{observation.modelRecoveryFailure.persistenceDiagnostic.structuralIssues.map((item, index) => <li key={`${index}-${item.path}-${item.category}`}>{item.path}: {item.category} ({item.valueType})</li>)}</ul></>}
            <p className="mt-2 break-all text-muted">Preserved source fingerprint: {observation.modelRecoveryFailure.sourceFingerprint}</p>
        </details>
      </div>}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-primary">Observed subjects</h3>
          {observation.observedSubjects.length === 0
            ? <p className="mt-2 text-sm text-unknown">No observed subjects were persisted.</p>
            : <ul className="mt-2 space-y-2">{observation.observedSubjects.map(subject => <li key={subject.id} className="rounded border border-border bg-elevated p-3"><p className="font-mono text-xs text-primary">{subject.value}</p><p className="mt-1 text-xs text-muted">Evidence: {subject.evidenceId}</p></li>)}</ul>}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-primary">Unobserved scope and unknowns</h3>
          <ul className="mt-2 space-y-2 text-sm text-secondary">
            {observation.unobservedScope.map(item => <li key={item}>• {item}</li>)}
            {observation.unknowns.map(item => <li key={item.id}>• {item.subject}: {item.reason}</li>)}
          </ul>
        </div>
      </div>

      {(observation.blockers.length > 0 || observation.errors.length > 0) && <div className="mt-5 rounded border border-fail/40 bg-elevated p-4" role="alert">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldAlert size={16} className="text-fail" /> Errors and blockers</h3>
        <ul className="mt-2 space-y-1 text-xs text-secondary">
          {observation.blockers.map(item => <li key={item.id}>{item.subject}: {item.reason}</li>)}
          {observation.errors.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
        </ul>
      </div>}

      <div className="mt-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-primary"><FileSearch size={16} className="text-brand" /> Evidence produced</h3>
        {observation.evidence.length === 0
          ? <p className="mt-2 text-sm text-unknown">No evidence was produced; conclusions remain unknown.</p>
          : <ul className="mt-2 space-y-3">{observation.evidence.map(evidence => <li key={evidence.id} className="rounded border border-border bg-elevated p-3"><p className="font-mono text-xs text-primary">{evidence.id}</p><p className="mt-1 text-sm text-secondary">{evidence.summary}</p><p className="mt-2 text-xs text-muted">Captured <Timestamp value={evidence.capturedAt} /> · Provenance: {evidence.provenance.kind} / {evidence.provenance.reference} · Integrity: {evidence.integrity}</p></li>)}</ul>}
      </div>

      {observation.recommendation
        ? <div className="mt-5 flex gap-3 rounded border border-border bg-elevated p-4"><ArrowRight size={17} className="mt-0.5 shrink-0 text-brand" /><div><h3 className="text-sm font-semibold text-primary">{observation.recommendation.action}</h3><p className="mt-1 text-xs text-secondary">Because: {observation.recommendation.because}</p></div></div>
        : <p className="mt-5 text-sm text-muted">No safe next action is available from this result.</p>}
    </section>
  )
}

export function CrawlPage() {
  const appName = useCurrentProject()
  const contextQuery = useCrawlProjectContext(appName)
  const latestQuery = useLatestObservation(appName)
  const crawl = useCrawl()
  const [jobId, setJobId] = useState<string | null>(null)
  const [force, setForce] = useState(false)
  const [aiBudget, setAiBudget] = useState(150)
  const { data: status, error: statusError } = useCrawlStatus(jobId, appName)

  useEffect(() => {
    if (!appName) return
    let cancelled = false
    apiClient.get<{ jobId: string }>(`/api/v1/projects/${encodeURIComponent(appName)}/crawl/active`)
      .then(active => { if (!cancelled && active?.jobId) setJobId(active.jobId) })
      .catch(() => { /* No active observation is a normal refresh state. */ })
    return () => { cancelled = true }
  }, [appName])

  useEffect(() => {
    if (status?.complete) void latestQuery.refetch()
  }, [status?.complete])

  const active = crawl.isPending || status?.status === 'queued' || status?.status === 'starting' || status?.status === 'running'
  const displayedObservation = useMemo(
    () => active ? null : status?.observation ?? latestQuery.data?.observation ?? null,
    [active, status?.observation, latestQuery.data?.observation],
  )

  function startObservation() {
    if (!appName || !contextQuery.data || active) return
    crawl.reset()
    crawl.mutate({ appName, force, aiBudget }, {
      onSuccess: result => setJobId(result.observationId),
    })
  }

  if (!appName) {
    return <ProjectSelector title="Crawl" subtitle="Select a project to start an application observation." basePath="/crawl" />
  }

  if (contextQuery.isPending) {
    return <div className="p-8 text-sm text-secondary" role="status"><Loader2 size={16} className="mr-2 inline animate-spin" />Loading persisted project context…</div>
  }

  if (contextQuery.isError) {
    return <div className="m-6 rounded-lg border border-fail/40 bg-surface p-6" role="alert"><h1 className="text-xl font-semibold text-primary">Crawl unavailable</h1><p className="mt-2 text-sm text-fail">{contextQuery.error instanceof Error ? contextQuery.error.message : 'The selected project could not be loaded.'}</p><p className="mt-2 text-sm text-secondary">Confirm the backend is running and select an onboarded project.</p></div>
  }

  const context = contextQuery.data
  const requestError = crawl.error ?? statusError

  return (
    <main className="h-full p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-[0.18em] text-brand">Application observation</p>
          <h1 className="mt-1 text-2xl font-semibold text-primary">{context.projectName}</h1>
          <p className="mt-1 break-all text-sm text-secondary">{context.targetUrl}</p>
        </header>

        <section className="rounded-lg border border-border bg-surface p-6" aria-labelledby="pre-crawl-truth">
          <h2 id="pre-crawl-truth" className="text-lg font-semibold text-primary">Before this observation</h2>
          <dl className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs uppercase tracking-wide text-muted">Observation boundary</dt><dd className="mt-1 text-secondary">{context.observationBoundary}</dd></div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Authentication expectation</dt>
              <dd className="mt-1 text-secondary">{context.authenticationExpectation}</dd>
              <dd className="mt-1 text-xs text-muted">{credentialLabel[context.credentialAvailability]}</dd>
              <dd className="mt-1 text-xs text-muted">Reference: {context.credentialReferenceState}; resolver: backend environment</dd>
            </div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Crawl strategy</dt><dd className="mt-1 text-secondary">{context.crawlStrategy}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Declared scope</dt><dd className="mt-1 text-secondary">{context.declaredScope}</dd></div>
          </dl>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div><h3 className="text-sm font-semibold text-primary">What this run can establish</h3><ul className="mt-2 space-y-1 text-xs text-secondary">{context.canEstablish.map(item => <li key={item}>• {item}</li>)}</ul></div>
            <div><h3 className="text-sm font-semibold text-primary">What this run cannot establish</h3><ul className="mt-2 space-y-1 text-xs text-secondary">{context.cannotEstablish.map(item => <li key={item}>• {item}</li>)}</ul></div>
          </div>
          {context.blockers.length > 0 && <div className="mt-4 rounded border border-unknown/40 bg-elevated p-3"><p className="flex items-center gap-2 text-sm font-semibold text-primary"><AlertCircle size={15} className="text-unknown" /> Prerequisites or blockers</p><ul className="mt-2 space-y-1 text-xs text-secondary">{context.blockers.map(item => <li key={item}>{item}</li>)}</ul></div>}
          {context.credentialRestoration && <div className="mt-4 rounded border border-brand/40 bg-elevated p-3" role="status"><p className="text-sm font-semibold text-primary">Restore credential access</p><p className="mt-1 text-xs text-secondary">{context.credentialRestoration}</p></div>}
        </section>

        <section className="rounded-lg border border-border bg-surface p-6" aria-labelledby="start-observation">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 id="start-observation" className="text-lg font-semibold text-primary">Start observation</h2><p className="mt-1 text-sm text-secondary">A run is accepted as queued; success is shown only after terminal evidence is persisted.</p></div>
            <button
              type="button"
              onClick={startObservation}
              disabled={active}
              className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              {active ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {active ? 'Observation in progress' : 'Start Observation'}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-secondary"><input type="checkbox" checked={force} disabled={active} onChange={event => setForce(event.target.checked)} />Force re-crawl</label>
            <label className="flex items-center gap-2 text-sm text-secondary">AI budget<input type="number" min={0} value={aiBudget} disabled={active} onChange={event => setAiBudget(Number(event.target.value))} className="w-20 rounded border border-border bg-elevated px-2 py-1 text-primary" /></label>
          </div>
          {jobId && <p className="mt-4 text-xs text-muted">Run identity: <span className="font-mono text-secondary">{jobId}</span></p>}
          {status && <div className="mt-3 flex items-center gap-2 text-sm" role="status">{active && <Loader2 size={14} className="animate-spin text-brand" />}<span className="text-secondary">State: {status.status.replace('_', ' ')}</span>{status.status === 'running' && <span className="text-muted">· {status.pagesFound} observed so far</span>}</div>}
          {requestError && <div className="mt-4 rounded border border-fail/40 bg-elevated p-3 text-sm text-fail" role="alert">{requestError instanceof Error ? requestError.message : String(requestError)}</div>}
          <div className="mt-4"><MissionTimeline lines={status?.lines ?? []} running={active} placeholder={jobId ? 'Waiting for real progress signals…' : 'Start an observation to see engine progress.'} /></div>
        </section>

        {displayedObservation && <ObservationResult observation={displayedObservation} />}
        {status?.complete && <CrawlDiagnostics diagnostics={status.crawlDiagnostics ?? []} />}
      </div>
    </main>
  )
}
