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

import { AlertTriangle, CheckCircle2, FileSearch, Loader2, Play, Save, ShieldAlert, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { m1TestIntentAdapter } from '../../api/m1TestIntentAdapter'
import {
  isNormalizedTestIntentV1,
  isRefusedNormalizedTestIntentV1,
  isSupportedNormalizedTestIntentV1,
  type CanonicalDefinitionSaveResultV3,
  type DiscoveredAppArea,
  type M1RefusalCode,
  type M1TestIntentAdapter,
  type RefusedNormalizedTestIntentV1,
  type SupportedNormalizedTestIntentV1,
} from '../../api/m1TestIntentContract'
import { useM1DiscoveredAppAreas, useM1GenerateIntent, useM1SaveIntent } from '../../hooks/useM1TestIntent'
import { M1DraftSession, type M1DraftLoadResult } from '../../utils/M1DraftSession'
import { M1RunHandoffSession } from '../../utils/M1RunHandoffSession'

const REFUSAL_PRESENTATION: Record<M1RefusalCode, { title: string; label: string }> = {
  insufficient_evidence: { title: 'Not enough evidence to generate this test', label: 'Insufficient evidence' },
  ambiguous_evidence: { title: 'Observed evidence is ambiguous', label: 'Ambiguous evidence' },
  unsupported_semantics: { title: 'Observed workflow is outside M1 support', label: 'Unsupported semantics' },
  app_area_unknown: { title: 'Application area is unknown', label: 'App area unknown' },
}

const REFUSAL_REMEDY: Record<M1RefusalCode, string> = {
  insufficient_evidence: 'Observe the complete supported path and its final subject, then regenerate.',
  ambiguous_evidence: 'Collect a fresh observation that resolves the conflicting evidence.',
  unsupported_semantics: 'Choose a directly observed navigate-and-click segment within the frozen M1 scope.',
  app_area_unknown: 'Persist a canonical PageDefinition.module value in the App Model before generating.',
}

function confidenceLabel(value: DiscoveredAppArea['confidence']): string {
  return value === 'unknown' ? 'Confidence unknown' : `${value[0].toUpperCase()}${value.slice(1)} confidence`
}

export function M1RefusalState({ refusal }: { refusal: RefusedNormalizedTestIntentV1 }) {
  const presentation = REFUSAL_PRESENTATION[refusal.disposition.code]
  return <section role="alert" aria-labelledby="m1-refusal-heading" className="rounded-lg border border-flaky/50 bg-surface p-5">
    <div className="flex gap-3"><ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0 text-flaky" size={20} /><div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-flaky">Generation refused · {presentation.label}</p>
      <h3 id="m1-refusal-heading" className="mt-1 text-lg font-semibold text-primary">{presentation.title}</h3>
      <p className="mt-2 text-sm text-secondary">{refusal.disposition.safeMessage}</p>
      <p className="mt-3 text-sm text-secondary"><strong className="text-primary">What would help:</strong> {REFUSAL_REMEDY[refusal.disposition.code]}</p>
      {refusal.evidenceAssessment.limitations.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">{refusal.evidenceAssessment.limitations.map(item => <li key={item}>{item}</li>)}</ul>}
      <p className="mt-3 text-xs text-muted">No review draft or canonical Test Definition was created. Save and Run remain unavailable.</p>
    </div></div>
  </section>
}

function AreaCard({ area, selected, onSelect, onRefusal }: { area: DiscoveredAppArea; selected: boolean; onSelect: () => void; onRefusal: () => void }) {
  const available = area.availability === 'available' && area.appArea !== null
  return <div className={`block rounded-lg border p-4 ${available ? selected ? 'border-brand bg-selected ring-1 ring-brand' : 'border-border bg-surface hover:bg-hover' : 'border-flaky/40 bg-elevated'}`}>
    <label className="flex items-start gap-3">
      <input type="radio" name="m1-app-area" checked={selected} disabled={!available} onChange={onSelect} className="mt-1 h-4 w-4 accent-brand" aria-label={available ? `Select ${area.appArea}` : 'Application area unavailable'} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold text-primary">{area.appArea ?? 'App area unavailable'}</h3><span className="text-xs text-muted">{confidenceLabel(area.confidence)}</span></div>
        <p className="mt-1 break-all font-mono text-xs text-secondary">{area.observedRoute ?? 'Observed route unavailable'}</p>
        <p className="mt-2 text-sm text-secondary">{area.evidenceSummary}</p>
        {!available && <p className="mt-2 text-xs font-medium text-flaky">app_area_unknown · Generation is unavailable because no persisted PageDefinition.module exists.</p>}
      </div>
    </label>
    {!available && area.refusal && <button type="button" onClick={onRefusal} className="mt-3 rounded border border-border px-3 py-1.5 text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Why generation was refused</button>}
  </div>
}

export function M1IntentReview({ intent }: { intent: SupportedNormalizedTestIntentV1 }) {
  return <section aria-labelledby="m1-review-heading" className="space-y-5 rounded-lg border border-brand/50 bg-surface p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Review-ready · Ephemeral intent</p><h3 id="m1-review-heading" className="mt-1 text-xl font-semibold text-primary">{intent.title}</h3><p className="mt-2 text-sm text-secondary">{intent.objective}</p></div><span className="rounded-full border border-brand/50 px-3 py-1 text-xs font-semibold text-brand">App area: {intent.appArea.id}</span></div>

    <aside className="flex gap-3 rounded border border-border bg-elevated p-3 text-sm text-secondary"><AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-flaky" size={17} /><p>This review draft is session-scoped and non-authoritative. Generation has not created or changed a canonical Test Definition.</p></aside>

    <section aria-labelledby="m1-preconditions"><h4 id="m1-preconditions" className="font-semibold text-primary">Preconditions</h4>{intent.preconditions.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-secondary">{intent.preconditions.map(item => <li key={`${item.roleId}-${item.mechanism}`}>Authentication is established for role {item.roleId} using {item.mechanism}.</li>)}</ul> : <p className="mt-2 text-sm text-muted">No authenticated-role precondition is required.</p>}</section>
    <section aria-labelledby="m1-steps"><h4 id="m1-steps" className="font-semibold text-primary">Ordered steps</h4><ol className="mt-3 space-y-3">{intent.steps.map(step => <li key={step.stepId} className="flex gap-3 rounded border border-border bg-elevated p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">{step.ordinal + 1}</span><div><p className="font-medium text-primary">{step.kind === 'navigate_to_observed_route' ? `Navigate to ${step.routePath}` : `Click the observed ${step.dataTestValue} element`}</p><p className="mt-1 text-xs text-muted">{step.kind === 'navigate_to_observed_route' ? `Observed subject: ${step.subjectId}` : `Observed data-test target: ${step.dataTestValue}`}</p></div></li>)}</ol></section>
    <section aria-labelledby="m1-outcome"><h4 id="m1-outcome" className="font-semibold text-primary">Expected outcome</h4><div className="mt-2 rounded border border-pass/30 bg-elevated p-3"><p className="text-sm text-secondary">Observed {intent.expectedOutcomes[0].routePath} subject becomes observable</p><p className="mt-1 text-xs text-muted">Final oracle: subject_observable · {intent.expectedOutcomes[0].subjectId}</p></div></section>

    <section aria-labelledby="m1-grounding" className="rounded border border-border bg-elevated p-4"><div className="flex items-center gap-2"><FileSearch aria-hidden="true" size={17} className="text-brand" /><h4 id="m1-grounding" className="font-semibold text-primary">Grounding and provenance</h4></div><p className="mt-2 text-sm font-medium text-primary">Generated from discovered evidence</p><dl className="mt-3 grid gap-3 text-sm md:grid-cols-2"><div><dt className="text-xs uppercase text-muted">Source flow</dt><dd className="mt-1 text-secondary">Observed flow · {intent.evidenceAssessment.sourceFlowConfidence} confidence</dd></div><div><dt className="text-xs uppercase text-muted">Evidence sufficiency</dt><dd className="mt-1 text-pass">Sufficient · selected step grounded as observed</dd></div><div><dt className="text-xs uppercase text-muted">Supported subjects</dt><dd className="mt-1 text-secondary">{intent.grounding.subjectSupport.length} subjects with sealed observation/gap support</dd></div><div><dt className="text-xs uppercase text-muted">Excluded flow context</dt><dd className="mt-1 text-secondary">{intent.grounding.excludedFlowStepIndexes.length ? `Flow step indexes ${intent.grounding.excludedFlowStepIndexes.join(', ')}` : 'No flow steps excluded'}</dd></div></dl><ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">{intent.evidenceAssessment.limitations.map(item => <li key={item}>{item}</li>)}</ul></section>

    <details className="rounded border border-border p-3"><summary className="cursor-pointer text-xs font-medium text-brand outline-none focus-visible:ring-2 focus-visible:ring-brand">Technical draft identity</summary><p className="mt-2 break-all font-mono text-xs text-muted">{intent.intentId}</p></details>
  </section>
}

function loadInitialDraft(projectId: string): M1DraftLoadResult {
  return M1DraftSession.load(projectId)
}

export function M1TestDesignWorkspace({ projectId, adapter = m1TestIntentAdapter }: { projectId: string; adapter?: M1TestIntentAdapter }) {
  const areas = useM1DiscoveredAppAreas(projectId, adapter)
  const generate = useM1GenerateIntent(adapter)
  const save = useM1SaveIntent(adapter)
  const [selectedArea, setSelectedArea] = useState<string | null>(null)
  const [draftState] = useState(() => loadInitialDraft(projectId))
  const [draft, setDraft] = useState<SupportedNormalizedTestIntentV1 | null>(() => draftState.state === 'available' ? draftState.intent : null)
  const [refusal, setRefusal] = useState<RefusedNormalizedTestIntentV1 | null>(null)
  const [validationError, setValidationError] = useState<string | null>(() => draftState.state === 'invalid' ? 'The saved session review draft was malformed and has been refused.' : null)
  const [draftStorageWarning, setDraftStorageWarning] = useState(draftState.state === 'storage_unavailable')
  const [saved, setSaved] = useState<CanonicalDefinitionSaveResultV3 | null>(null)
  const [handoffStored, setHandoffStored] = useState(true)

  function selectArea(appArea: string) {
    setSelectedArea(appArea); setDraft(null); setRefusal(null); setValidationError(null); setSaved(null)
    M1DraftSession.clear(projectId)
  }

  function generateIntent() {
    if (!selectedArea) return
    setRefusal(null); setValidationError(null); setSaved(null)
    generate.mutate({ projectId, appArea: selectedArea }, { onSuccess: result => {
      if (!isNormalizedTestIntentV1(result) || result.projectId !== projectId) {
        setDraft(null); setValidationError('FORGE refused a malformed or mismatched generated intent. No review or canonical state was created.'); return
      }
      if (isRefusedNormalizedTestIntentV1(result)) { setDraft(null); setRefusal(result); M1DraftSession.clear(projectId); return }
      if (result.appArea.id !== selectedArea) { setDraft(null); setValidationError('FORGE refused a generated intent whose canonical app area did not match the selection.'); return }
      setDraft(result)
      setDraftStorageWarning(!M1DraftSession.save(result))
    }, onError: () => setValidationError('Generation failed before a review-ready intent was established. No canonical state was created.') })
  }

  function saveIntent() {
    if (!draft || !isSupportedNormalizedTestIntentV1(draft)) { setValidationError('The review draft is invalid and cannot be saved.'); return }
    save.mutate({ projectId, intent: draft }, { onSuccess: result => {
      const stored = M1RunHandoffSession.save({ projectId, testSetId: result.testSetId, definitionId: result.definitionId, revision: result.revision, createdAt: new Date().toISOString() })
      setHandoffStored(stored); setSaved(result)
    } })
  }

  return <section aria-labelledby="m1-test-design-heading" className="space-y-5 rounded-xl border border-brand/30 bg-elevated/40 p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">M1 discovered test design</p><h2 id="m1-test-design-heading" className="mt-1 text-xl font-semibold text-primary">Generate a grounded v3 test</h2><p className="mt-1 max-w-3xl text-sm text-secondary">Choose a persisted application area, review the evidence-backed intent, then explicitly promote it.</p></div>{adapter.mode === 'mock' && <span className="rounded-full border border-flaky/50 px-3 py-1 text-xs font-semibold text-flaky">UI integration mock</span>}</header>
    {adapter.mode === 'mock' && <p role="status" className="rounded border border-flaky/40 bg-surface p-3 text-xs text-secondary"><strong className="text-primary">Mock boundary:</strong> generation and promotion responses are simulated for UI integration. No backend Product state is changed.</p>}

    {areas.isPending && <div role="status" className="flex items-center gap-2 text-sm text-secondary"><Loader2 aria-hidden="true" className="animate-spin" size={17} /> Loading discovered application areas…</div>}
    {areas.isError && <div role="alert" className="rounded border border-fail/40 bg-surface p-4"><h3 className="font-semibold text-primary">Discovered evidence unavailable</h3><p className="mt-1 text-sm text-secondary">FORGE could not read persisted application areas. Generation remains unavailable.</p></div>}
    {areas.data?.length === 0 && <div role="status" className="rounded border border-border bg-surface p-6 text-center"><h3 className="font-semibold text-primary">No discovered application areas</h3><p className="mt-2 text-sm text-secondary">Crawl and persist application evidence before generating a discovered test.</p></div>}
    {!!areas.data?.length && <fieldset><legend className="text-sm font-semibold text-primary">Discovered application areas</legend><p className="mt-1 text-xs text-muted">Area labels come only from persisted App Model PageDefinition.module values.</p><div className="mt-3 grid gap-3 md:grid-cols-2">{areas.data.map((area, index) => <AreaCard key={`${area.appArea ?? 'unknown'}-${index}`} area={area} selected={area.appArea !== null && selectedArea === area.appArea} onSelect={() => area.appArea && selectArea(area.appArea)} onRefusal={() => { if (area.refusal) { setDraft(null); setSelectedArea(null); setValidationError(null); setSaved(null); setRefusal(area.refusal) } }} />)}</div></fieldset>}

    {selectedArea && !draft && !refusal && <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={generate.isPending} onClick={generateIntent} className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">{generate.isPending ? <Loader2 aria-hidden="true" className="animate-spin" size={16} /> : <Sparkles aria-hidden="true" size={16} />}{generate.isPending ? 'Generating review intent…' : `Generate test for ${selectedArea}`}</button><p className="text-xs text-muted">Generation creates only an ephemeral review intent.</p></div>}

    {refusal && <M1RefusalState refusal={refusal} />}
    {validationError && <div role="alert" className="rounded border border-fail/50 bg-surface p-4"><h3 className="font-semibold text-primary">Intent validation failed</h3><p className="mt-1 text-sm text-secondary">{validationError}</p><p className="mt-2 text-xs text-muted">Save and Run are unavailable.</p></div>}
    {draft && <><M1IntentReview intent={draft} />{draftStorageWarning && <p role="status" className="rounded border border-flaky/40 bg-surface p-3 text-xs text-secondary">Session storage is unavailable. You may continue this review, but refreshing will lose the non-authoritative draft.</p>}{!saved && <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={save.isPending} onClick={saveIntent} className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50">{save.isPending ? <Loader2 aria-hidden="true" className="animate-spin" size={16} /> : <Save aria-hidden="true" size={16} />}{save.isPending ? 'Revalidating and saving…' : 'Accept and save canonical v3 test'}</button><p className="text-xs text-muted">The exact reviewed intent is sent for current-evidence revalidation.</p></div>}</>}
    {save.isError && <div role="alert" className="rounded border border-fail/50 bg-surface p-4"><h3 className="font-semibold text-primary">Save failed</h3><p className="mt-1 text-sm text-secondary">{save.error instanceof Error ? save.error.message : 'Canonical promotion failed. No Definition was created.'}</p><p className="mt-2 text-xs text-muted">The non-authoritative review draft is retained so you can retry safely.</p></div>}
    {saved && <section role="status" aria-labelledby="m1-save-success" className="rounded-lg border border-pass/40 bg-surface p-5"><div className="flex gap-3"><CheckCircle2 aria-hidden="true" className="mt-0.5 shrink-0 text-pass" size={20} /><div><h3 id="m1-save-success" className="font-semibold text-primary">{adapter.mode === 'mock' ? 'Save contract accepted in UI mock' : 'Canonical v3 test saved'}</h3><p className="mt-1 text-sm text-secondary">Canonical v3 promotion result · Test Set {saved.testSetId} · revision {saved.revision}. Generation alone did not create this state.</p>{adapter.mode === 'mock' && <p className="mt-2 text-xs text-flaky">This is a simulated adapter response, not canonical backend persistence.</p>}{handoffStored ? <Link className="mt-4 inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand" to={`/run?project=${encodeURIComponent(projectId)}&definition=${encodeURIComponent(saved.definitionId)}&revision=${saved.revision}`}><Play aria-hidden="true" size={16} /> Continue to Run</Link> : <p role="alert" className="mt-3 text-sm text-flaky">Run handoff could not be retained. Reopen the saved canonical definition from Tests after backend integration.</p>}</div></div></section>}
  </section>
}
