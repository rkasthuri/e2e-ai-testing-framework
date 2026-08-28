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

import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  buildManualPromotionRequest,
  manualSourceToDraft,
  manualDraftSnapshot,
  validateManualDraft,
  type M3ManualDraft,
  type M3ManualTestAdapter,
  type M3PromotionErrorCode,
  type ManualAnalysisResultV1,
  type ManualAutomationProposalV1,
  type ManualAutomationRefusalV1,
  type ManualGroundingBasisV1,
  type ManualPromotionResultV1,
  type ManualResultsProvenanceV1,
  type ManualSourceGroundingV1,
} from '../../api/m3ManualTestContract'
import { ApiError } from '../../api/client'
import { M3ManualAnalyzeInputError, M3ManualPromotionError, m3ManualTestAdapter } from '../../api/m3ManualTestAdapter'
import { useM3AnalyzeManualTest, useM3PromoteManualTest } from '../../hooks/useM3ManualTest'
import { M1RunHandoffSession } from '../../utils/M1RunHandoffSession'

const initialDraft = (): M3ManualDraft => ({ title: '', objective: '', steps: [''], expectedOutcome: '' })

function PreservedSource({ draft, heading = 'Preserved manual source' }: { draft: M3ManualDraft; heading?: string }) {
  return <section className="rounded-lg border border-border bg-surface p-4" aria-label={heading}>
    <h3 className="font-semibold text-primary">{heading}</h3>
    <dl className="mt-3 space-y-3 text-sm">
      <div><dt className="text-xs uppercase text-muted">Title</dt><dd className="whitespace-pre-wrap text-primary">{draft.title}</dd></div>
      {draft.objective && <div><dt className="text-xs uppercase text-muted">Objective</dt><dd className="whitespace-pre-wrap text-secondary">{draft.objective}</dd></div>}
      <div><dt className="text-xs uppercase text-muted">Ordered steps</dt><dd><ol className="mt-1 list-decimal space-y-1 pl-5 text-secondary">{draft.steps.map((step, index) => <li key={index} className="whitespace-pre-wrap">{step}</li>)}</ol></dd></div>
      <div><dt className="text-xs uppercase text-muted">Expected outcome</dt><dd className="whitespace-pre-wrap text-secondary">{draft.expectedOutcome}</dd></div>
    </dl>
  </section>
}

function sourceFragment(grounding: ManualSourceGroundingV1, draft: M3ManualDraft): string {
  return grounding.sourceRef.kind === 'step'
    ? draft.steps[grounding.sourceRef.ordinal - 1] ?? `Missing source step ${grounding.sourceRef.ordinal}`
    : draft.expectedOutcome
}

function bindingLabel(grounding: ManualSourceGroundingV1): string {
  if (!grounding.canonicalBinding) return 'No executable canonical binding'
  return grounding.canonicalBinding.kind === 'action'
    ? `Canonical Step ${grounding.canonicalBinding.ordinal + 1}`
    : 'Final oracle'
}

function basisLabel(basis: ManualGroundingBasisV1): string {
  if (basis.kind === 'governed_route') return 'Navigation grounding — governed route; not an App Model flow step.'
  if (basis.kind === 'observed_flow_step') return `Observed App Model flow step ${basis.flowStepIndex + 1}.`
  return 'Governed App Model subject evidence.'
}

export function M3ProposalReview({ proposal, source }: { proposal: ManualAutomationProposalV1; source: M3ManualDraft }) {
  return <section className="space-y-4" aria-labelledby="m3-proposal-heading">
    <div><h3 id="m3-proposal-heading" className="text-lg font-semibold text-primary">Review source against proposal</h3><p className="mt-1 text-sm text-secondary">The proposal is read-only. Human labels are one-based; canonical wire action ordinals remain 0 and 1.</p></div>
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="grid min-w-[760px] grid-cols-4 bg-elevated text-xs font-semibold uppercase text-muted"><div className="p-3">Manual source fragment</div><div className="p-3">Interpretation</div><div className="p-3">Canonical binding</div><div className="p-3">Evidence basis</div></div>
      {proposal.sourceGrounding.map((grounding, index) => <div key={index} className="grid min-w-[760px] grid-cols-4 border-t border-border text-sm">
        <div className="whitespace-pre-wrap p-3 text-primary">{sourceFragment(grounding, source)}</div>
        <div className="p-3 text-secondary">{grounding.status === 'grounded' ? 'Grounded without rewriting the source.' : grounding.status.replaceAll('_', ' ')}</div>
        <div className="p-3 text-secondary">{bindingLabel(grounding)}</div>
        <div className="p-3 text-secondary">{basisLabel(grounding.basis)}<span className="mt-1 block text-xs text-muted">{grounding.basis.evidenceIds.length} evidence ID{grounding.basis.evidenceIds.length === 1 ? '' : 's'}</span></div>
      </div>)}
    </div>
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div className="rounded border border-border p-3"><dt className="text-xs uppercase text-muted">App area</dt><dd className="mt-1 text-primary">{proposal.appArea.id}</dd><dd className="text-xs text-muted">{proposal.appArea.method} · {proposal.appArea.confidence}</dd></div>
      <div className="rounded border border-border p-3"><dt className="text-xs uppercase text-muted">Source grounding</dt><dd className="mt-1 text-primary">{proposal.sourceGrounding.length} preserved fragments</dd></div>
      <div className="rounded border border-border p-3"><dt className="text-xs uppercase text-muted">Auth expectation</dt><dd className="mt-1 text-primary">{proposal.authenticationExpectation.state.replaceAll('_', ' ')}{proposal.authenticationExpectation.mechanism ? ` — ${proposal.authenticationExpectation.mechanism}` : ''}</dd></div>
    </dl>
    <section aria-labelledby="m3-canonical-actions"><h4 id="m3-canonical-actions" className="font-semibold text-primary">Canonical actions for review</h4><ol className="mt-2 space-y-2">{proposal.canonicalActions.map(action => <li key={action.stepId} className="rounded border border-border p-3 text-sm"><span className="font-semibold text-brand">Step {action.ordinal + 1}</span><span className="ml-2 text-primary">{action.kind === 'navigate_to_observed_route' ? `Navigate to ${action.routePath}` : `Click observed control ${action.dataTestValue}`}</span></li>)}</ol></section>
    <section className="rounded border border-border p-3 text-sm"><h4 className="font-semibold text-primary">Final oracle</h4><p className="mt-1 text-secondary">{proposal.oracle.explanation}</p><p className="mt-1 text-xs text-muted">{proposal.oracle.kind} · {proposal.oracle.subjectId}</p></section>
    <section className="rounded border border-border p-3 text-sm"><h4 className="font-semibold text-primary">Limitations</h4>{proposal.limitations.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-secondary">{proposal.limitations.map(item => <li key={item}>{item}</li>)}</ul> : <p className="mt-1 text-secondary">No proposal limitation was returned.</p>}</section>
    <details className="rounded border border-border p-3 text-sm"><summary className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Technical IDs and hashes</summary><dl className="mt-2 grid gap-2 break-all font-mono text-xs text-secondary sm:grid-cols-2"><div><dt>Source ID</dt><dd>{proposal.sourceAuthority.sourceId}</dd></div><div><dt>Source hash</dt><dd>{proposal.sourceAuthority.sourceContentHash}</dd></div><div><dt>Proposal ID</dt><dd>{proposal.proposalId}</dd></div><div><dt>Proposal hash</dt><dd>{proposal.proposalContentHash}</dd></div><div><dt>Intent ID</dt><dd>{proposal.normalizedIntent.intentId}</dd></div><div><dt>Intent hash</dt><dd>{proposal.normalizedIntentContentHash}</dd></div></dl></details>
  </section>
}

const refusalLabels: Record<ManualAutomationRefusalV1['code'], string> = {
  insufficient_evidence: 'Insufficient evidence',
  ambiguous_evidence: 'Ambiguous evidence',
  unsupported_semantics: 'Unsupported semantics',
  app_area_unknown: 'Application area unknown',
}

const refusalRemedies: Record<ManualAutomationRefusalV1['code'], string> = {
  insufficient_evidence: 'Collect canonical evidence for the affected source fragment, then Analyze again.',
  ambiguous_evidence: 'Collect evidence that identifies one unique observed control, then Analyze again.',
  unsupported_semantics: 'Use the supported observed navigation-and-click scope, while keeping the original source unchanged.',
  app_area_unknown: 'Persist an unambiguous App Model application-area classification, then Analyze again.',
}

export function m3PromotionErrorMessage(code: M3PromotionErrorCode): string {
  return {
    SOURCE_PROPOSAL_MISMATCH: 'The reviewed proposal does not belong to this source. Nothing was saved.',
    MANUAL_PROMOTION_IDENTITY_CONFLICT: 'Promotion authority conflicts with an existing identity. Nothing was saved.',
    STALE_REVIEWED_PROPOSAL: 'The reviewed proposal is stale. Analyze again and review the newly returned proposal; FORGE did not auto-accept it.',
    MANUAL_PROPOSAL_NOT_EXECUTABLE: 'The reviewed proposal is not executable and cannot be promoted.',
  }[code]
}

export function m3AnalyzeErrorMessage(error: unknown): string {
  if (error instanceof M3ManualAnalyzeInputError) return 'Manual source invalid. This is an input error, not a semantic automation refusal. Review the draft and Analyze again.'
  if (error instanceof ApiError && error.status === 404) return 'The selected project was not found. The draft remains client-only.'
  if (error instanceof ApiError && error.status >= 500) return 'Manual Analyze failed internally. No semantic refusal or source authority was assumed.'
  return 'Manual Analyze transport failed. The draft remains client-only; no semantic refusal or source authority was assumed.'
}

export function m3SaveTransportErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return 'The selected project was not found. Nothing was saved.'
  if (error instanceof ApiError && error.status >= 500) return 'Manual promotion failed internally. Nothing was saved and local review authority was not changed.'
  return 'Manual promotion transport failed. Nothing was saved and local review authority was not changed.'
}

export function M3RefusalReview({ refusal, source }: { refusal: ManualAutomationRefusalV1; source: M3ManualDraft }) {
  const affected = refusal.sourceGrounding.filter(item => item.status !== 'grounded')
  return <section className="space-y-4" aria-labelledby="m3-refusal-heading">
    <div role="alert" className="rounded-lg border border-flaky/50 bg-elevated p-4"><h3 id="m3-refusal-heading" className="font-semibold text-flaky">Automation refused — {refusalLabels[refusal.code]}</h3><p className="mt-1 text-sm text-secondary">{refusal.safeMessage}</p><p className="mt-2 text-sm font-medium text-primary">No Save. No Run. No partial-automation claim.</p></div>
    <PreservedSource draft={source} />
    <section className="rounded-lg border border-border p-4"><h4 className="font-semibold text-primary">Exact affected source fragment</h4>{affected.length ? <ul className="mt-2 space-y-2">{affected.map((item, index) => <li key={index} className="rounded border border-border p-3 text-sm"><p className="whitespace-pre-wrap text-primary">{sourceFragment(item, source)}</p><p className="mt-1 text-xs text-muted">{item.status.replaceAll('_', ' ')}</p></li>)}</ul> : <p className="mt-2 text-sm text-secondary">Application-area classification for “{source.title}”. The individual source fragments remain informationally grounded but cannot establish an application area.</p>}</section>
    <section className="rounded-lg border border-border p-4"><h4 className="font-semibold text-primary">Remedy</h4><p className="mt-1 text-sm text-secondary">{refusalRemedies[refusal.code]}</p></section>
    <details className="rounded border border-border p-3 text-sm"><summary className="cursor-pointer font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Partial grounding — informational evidence only</summary><ul className="mt-2 space-y-2 text-secondary">{refusal.sourceGrounding.map((item, index) => <li key={index}>{sourceFragment(item, source)} — {item.status.replaceAll('_', ' ')}; {basisLabel(item.basis)}</li>)}</ul><p className="mt-2 font-medium text-primary">This evidence is not partial automation.</p></details>
  </section>
}

export function M3ManualResultsProvenance({ provenance }: { provenance: ManualResultsProvenanceV1 }) {
  return <section aria-label="Immutable promoted manual provenance" className="rounded border border-border p-3 text-sm"><h3 className="font-semibold text-primary">Origin: promoted manual source</h3><dl className="mt-2 grid gap-2 break-all text-secondary sm:grid-cols-2"><div><dt className="text-xs uppercase text-muted">Source ID / hash</dt><dd>{provenance.sourceAuthority.sourceId} / {provenance.sourceAuthority.sourceContentHash}</dd></div><div><dt className="text-xs uppercase text-muted">Proposal ID / hash</dt><dd>{provenance.proposalAuthority.proposalId} / {provenance.proposalAuthority.proposalContentHash}</dd></div><div><dt className="text-xs uppercase text-muted">Definition authority</dt><dd>{provenance.definitionAuthority.definitionId} · schema {provenance.definitionAuthority.definitionSchemaVersion}</dd></div></dl></section>
}

function PromotionSuccess({ result, projectId, handoffStored }: { result: ManualPromotionResultV1; projectId: string; handoffStored: boolean }) {
  const authority = result.definitionAuthority
  return <section className="space-y-4 rounded-lg border border-pass/50 bg-surface p-4" aria-labelledby="m3-promoted-heading"><div><h3 id="m3-promoted-heading" className="font-semibold text-pass">Manual source promoted</h3><p className="mt-1 text-sm text-secondary">The backend confirmed canonical v3 Definition authority.</p></div><dl className="grid gap-3 break-all text-sm sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-xs uppercase text-muted">Source authority</dt><dd>{result.sourceAuthority.sourceId}</dd><dd className="font-mono text-xs">{result.sourceAuthority.sourceContentHash}</dd></div><div><dt className="text-xs uppercase text-muted">Proposal authority</dt><dd>{result.proposalAuthority.proposalId}</dd><dd className="font-mono text-xs">{result.proposalAuthority.proposalContentHash}</dd></div><div><dt className="text-xs uppercase text-muted">Definition</dt><dd>{authority.definitionId}</dd><dd>schema {authority.definitionSchemaVersion}</dd></div><div><dt className="text-xs uppercase text-muted">Test Set ID</dt><dd>{authority.testSetId}</dd></div><div><dt className="text-xs uppercase text-muted">Revision / hash</dt><dd>{authority.testSetRevision}</dd><dd className="font-mono text-xs">{authority.testSetContentHash}</dd></div></dl><div className="flex flex-wrap gap-2"><Link className="rounded border border-border px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" to={`/tests?project=${encodeURIComponent(projectId)}&test=${encodeURIComponent(authority.definitionId)}`}>View Test Definition</Link>{handoffStored ? <Link className="rounded bg-brand px-3 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand" to={`/run?project=${encodeURIComponent(projectId)}&definition=${encodeURIComponent(authority.definitionId)}&revision=${authority.testSetRevision}`}>Run</Link> : <p role="alert" className="text-sm text-flaky">Run handoff could not be retained. Reopen the canonical Definition from Tests.</p>}<a className="rounded border border-border px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" href="#saved-suites-workspace">Add to Suite</a></div><p className="text-xs text-muted">Run uses the normal canonical v3 preflight/Start route. Add to Suite opens the separate explicit M2 workflow; promotion did not mutate any Suite.</p></section>
}

export function M3ManualTestWorkspace({ projectId, adapter = m3ManualTestAdapter }: { projectId: string; adapter?: M3ManualTestAdapter }) {
  const [draft, setDraft] = useState<M3ManualDraft>(initialDraft)
  const [reviewSource, setReviewSource] = useState<M3ManualDraft | null>(null)
  const [reviewSnapshot, setReviewSnapshot] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<ManualAnalysisResultV1 | null>(null)
  const [promotion, setPromotion] = useState<ManualPromotionResultV1 | null>(null)
  const [saveRequiresReanalysis, setSaveRequiresReanalysis] = useState(false)
  const [handoffStored, setHandoffStored] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [promotionError, setPromotionError] = useState<string | null>(null)
  const [focusStep, setFocusStep] = useState<number | null>(null)
  const stepRefs = useRef<Array<HTMLTextAreaElement | null>>([])
  const analyze = useM3AnalyzeManualTest(adapter)
  const promote = useM3PromoteManualTest(adapter)
  const errors = validateManualDraft(draft)

  useEffect(() => { if (focusStep !== null) { stepRefs.current[focusStep]?.focus(); setFocusStep(null) } }, [focusStep, draft.steps.length])

  function updateDraft(next: M3ManualDraft): void {
    if (reviewSnapshot !== null && manualDraftSnapshot(next) !== reviewSnapshot) {
      setAnalysis(null); setReviewSource(null); setReviewSnapshot(null); setPromotion(null)
      setSaveRequiresReanalysis(false)
      setNotice('Source changed after Analyze. Re-Analyze and review again.')
    }
    setPromotionError(null)
    setDraft(next)
  }

  function analyzeDraft(): void {
    if (errors.length) return
    const submitted = { ...draft, steps: [...draft.steps] }
    setNotice(null); setPromotionError(null); setPromotion(null); setSaveRequiresReanalysis(false)
    setAnalysis(null); setReviewSource(null); setReviewSnapshot(null)
    analyze.mutate({ projectId, draft: submitted }, {
      onSuccess: receipt => {
        const admitted = manualSourceToDraft(receipt.source)
        setDraft(admitted)
        setReviewSource(admitted)
        setReviewSnapshot(manualDraftSnapshot(admitted))
        setAnalysis(receipt.analysis)
        setNotice('Analyze completed. The draft was reconciled to the backend-admitted immutable source; review that source and the returned interpretation.')
      },
    })
  }

  function acceptAndSave(): void {
    if (!analysis || analysis.outcome.kind !== 'proposal' || saveRequiresReanalysis || manualDraftSnapshot(draft) !== reviewSnapshot) return
    const request = buildManualPromotionRequest(analysis.outcome.proposal)
    setPromotionError(null)
    promote.mutate({ projectId, request }, {
      onSuccess: result => {
        const authority = result.definitionAuthority
        setHandoffStored(M1RunHandoffSession.save({ projectId, testSetId: authority.testSetId, definitionId: authority.definitionId, revision: authority.testSetRevision, createdAt: new Date().toISOString() }))
        setPromotion(current => current && JSON.stringify(current) === JSON.stringify(result) ? current : result)
      },
      onError: error => {
        if (error instanceof M3ManualPromotionError && error.code === 'STALE_REVIEWED_PROPOSAL') {
          setAnalysis(null); setReviewSource(null); setReviewSnapshot(null); setPromotion(null)
          setSaveRequiresReanalysis(false)
          setPromotionError(m3PromotionErrorMessage(error.code))
          return
        }
        if (error instanceof M3ManualPromotionError && error.code === 'MANUAL_PROPOSAL_NOT_EXECUTABLE') {
          setPromotion(null); setSaveRequiresReanalysis(true)
          setPromotionError(`${m3PromotionErrorMessage(error.code)} Review the preserved proposal, then Analyze again before another Save.`)
          return
        }
        const message = error instanceof M3ManualPromotionError
          ? m3PromotionErrorMessage(error.code)
          : m3SaveTransportErrorMessage(error)
        setPromotionError(message)
      },
    })
  }

  return <section className="space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-6" aria-labelledby="m3-manual-heading">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Manual Test</p><h2 id="m3-manual-heading" className="mt-1 text-xl font-semibold text-primary">Review and promote a manual source</h2><p className="mt-1 max-w-4xl text-sm text-secondary">Original text is preserved; FORGE does not rewrite unsupported source into automation. Before Analyze, this draft is client state only—not canonical or persisted.</p></div>
    {notice && <p role="status" className="rounded border border-border p-3 text-sm text-secondary">{notice}</p>}
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); analyzeDraft() }}>
      <label className="block text-sm font-medium text-primary">Title<input value={draft.title} onChange={event => updateDraft({ ...draft, title: event.target.value })} className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
      <label className="block text-sm font-medium text-primary">Objective <span className="font-normal text-muted">(optional)</span><textarea value={draft.objective} onChange={event => updateDraft({ ...draft, objective: event.target.value })} rows={2} className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
      <fieldset className="space-y-3"><legend className="text-sm font-medium text-primary">Ordered steps</legend>{draft.steps.map((step, index) => <div key={index} className="grid gap-2 rounded border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"><label className="text-sm font-medium text-primary">Step {index + 1}<textarea ref={node => { stepRefs.current[index] = node }} value={step} onChange={event => updateDraft({ ...draft, steps: draft.steps.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} rows={2} className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label><div className="flex items-end gap-1"><button type="button" aria-label={`Move Step ${index + 1} up`} disabled={index === 0} onClick={() => { const steps = [...draft.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; updateDraft({ ...draft, steps }); setFocusStep(index - 1) }} className="rounded border border-border p-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"><ArrowUp size={16} /></button><button type="button" aria-label={`Move Step ${index + 1} down`} disabled={index === draft.steps.length - 1} onClick={() => { const steps = [...draft.steps]; [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]]; updateDraft({ ...draft, steps }); setFocusStep(index + 1) }} className="rounded border border-border p-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"><ArrowDown size={16} /></button><button type="button" aria-label={`Remove Step ${index + 1}`} disabled={draft.steps.length === 1} onClick={() => { updateDraft({ ...draft, steps: draft.steps.filter((_, itemIndex) => itemIndex !== index) }); setFocusStep(Math.max(0, index - 1)) }} className="rounded border border-border p-2 text-fail outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"><Trash2 size={16} /></button></div></div>)}<button type="button" disabled={draft.steps.length >= 50} onClick={() => { updateDraft({ ...draft, steps: [...draft.steps, ''] }); setFocusStep(draft.steps.length) }} className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"><Plus size={16} /> Add step</button></fieldset>
      <label className="block text-sm font-medium text-primary">Expected outcome<textarea value={draft.expectedOutcome} onChange={event => updateDraft({ ...draft, expectedOutcome: event.target.value })} rows={3} className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label>
      {errors.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-muted" aria-label="Draft requirements">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
      <button type="submit" disabled={errors.length > 0 || analyze.isPending} className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40">{analyze.isPending && <Loader2 size={16} className="animate-spin" />} Analyze</button>
      {analyze.isError && <p role="alert" className="text-sm text-fail">{m3AnalyzeErrorMessage(analyze.error)}</p>}
    </form>
    {analysis && reviewSource && <div className="space-y-5 border-t border-border pt-5"><PreservedSource draft={reviewSource} heading="Backend-admitted source after Analyze" />{analysis.outcome.kind === 'proposal' ? <><M3ProposalReview proposal={analysis.outcome.proposal} source={reviewSource} />{!promotion && !saveRequiresReanalysis && <button type="button" disabled={promote.isPending || manualDraftSnapshot(draft) !== reviewSnapshot} onClick={acceptAndSave} className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40">{promote.isPending && <Loader2 size={16} className="animate-spin" />} Accept and Save</button>}</> : <M3RefusalReview refusal={analysis.outcome.refusal} source={reviewSource} />}</div>}
    {promotionError && <p role="alert" className="rounded border border-fail/40 p-3 text-sm text-fail">{promotionError}</p>}
    {promotion && <PromotionSuccess result={promotion} projectId={projectId} handoffStored={handoffStored} />}
    {!promotion && <p className="text-xs text-muted">Run is unavailable until promotion returns successful canonical Definition authority. Add to Suite is offered only afterward as a separate explicit workflow.</p>}
  </section>
}
