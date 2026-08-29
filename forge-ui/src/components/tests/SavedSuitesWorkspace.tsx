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

import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Pencil, Play, Plus, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import type {
  CanonicalSuiteCandidateSet,
  CanonicalSuiteRevision,
  SuiteChangeRequest,
  SuiteDefinitionAuthority,
} from '../../api/suiteContract'
import { validateSuiteDraft } from '../../api/suiteContract'
import { suiteTransport } from '../../api/suiteAdapter'

export type SavedSuitesState =
  | { kind: 'transport_unavailable' }
  | { kind: 'ready'; heads: readonly CanonicalSuiteRevision[]; candidates: CanonicalSuiteCandidateSet }

export type SuiteRunEligibility =
  | { kind: 'unverified' }
  | { kind: 'eligible'; source: 'authoritative_preflight'; suiteId: string; suiteRevision: number; suiteContentHash: string; name: string; purpose: 'sanity' }

export interface SavedSuitesWorkspaceProps {
  projectId: string
  state: SavedSuitesState
  initialDefinitionId?: string | null
  readRevision?: (suiteId: string, revision: number) => Promise<CanonicalSuiteRevision>
  refreshCurrentHead?: (suiteId: string) => Promise<CanonicalSuiteRevision>
  save?: (request: SuiteChangeRequest) => Promise<CanonicalSuiteRevision>
  preflight?: (suiteId:string,suiteRevision:number)=>Promise<SuiteRunEligibility>
  runEligibility?: SuiteRunEligibility
}

function short(value: string): string { return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}` }

function SuiteRevisionView({ suite, onEdit, runEligibility }: { suite: CanonicalSuiteRevision; onEdit: () => void; runEligibility: SuiteRunEligibility }) {
  const authority = suite.members[0].definitionAuthority
  const canRun = runEligibility.kind === 'eligible'
    && runEligibility.suiteId === suite.suiteId
    && runEligibility.suiteRevision === suite.revision
    && runEligibility.suiteContentHash === suite.contentHash
    && runEligibility.name === suite.name
    && runEligibility.purpose === suite.purpose
  return <section aria-labelledby="saved-suite-revision" className="space-y-4 rounded-lg border border-brand/40 bg-surface p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.16em] text-brand">Immutable Suite revision</p><h3 id="saved-suite-revision" className="mt-1 text-xl font-semibold text-primary">{suite.name}</h3><p className="mt-1 text-sm text-secondary">Sanity · revision {suite.revision}</p></div><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onEdit} className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand"><Pencil size={15} /> Edit as new revision</button>{canRun ? <Link to={`/run?project=${encodeURIComponent(suite.projectId)}&suiteId=${encodeURIComponent(suite.suiteId)}&suiteRevision=${suite.revision}`} className="inline-flex items-center gap-2 rounded bg-brand px-3 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand"><Play size={15} /> Run</Link> : <div className="text-right"><button type="button" disabled aria-describedby="suite-run-unverified" className="inline-flex cursor-not-allowed items-center gap-2 rounded border border-border px-3 py-2 text-sm text-muted opacity-70"><Play size={15} /> Run unavailable</button><p id="suite-run-unverified" className="mt-1 max-w-xs text-xs text-muted">Execution eligibility requires authoritative backend verification for this exact Suite revision.</p></div>}</div></div>
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs uppercase text-muted">Suite ID</dt><dd className="break-all font-mono text-secondary">{suite.suiteId}</dd></div><div><dt className="text-xs uppercase text-muted">Content hash</dt><dd title={suite.contentHash} className="font-mono text-secondary">{short(suite.contentHash)}</dd></div><div><dt className="text-xs uppercase text-muted">Test Set</dt><dd className="font-mono text-secondary">{authority.testSetId}</dd></div><div><dt className="text-xs uppercase text-muted">Pinned authority</dt><dd className="text-secondary">v{authority.definitionSchemaVersion} · revision {authority.testSetRevision} · <span title={authority.testSetContentHash} className="font-mono">{short(authority.testSetContentHash)}</span></dd></div></dl>
    <ol className="space-y-2" aria-label="Ordered Suite members">{suite.members.map(member => <li key={member.definitionAuthority.definitionId} className="flex gap-3 rounded border border-border bg-elevated p-3 text-sm"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{member.ordinal}</span><div><p className="break-all font-mono text-primary">{member.definitionAuthority.definitionId}</p><p className="text-xs text-muted">Canonical v{member.definitionAuthority.definitionSchemaVersion}</p></div></li>)}</ol>
  </section>
}

export function SavedSuitesWorkspace({ projectId, state, initialDefinitionId, readRevision, refreshCurrentHead, save, preflight, runEligibility = { kind: 'unverified' } }: SavedSuitesWorkspaceProps) {
  const [draft, setDraft] = useState<{ suiteId?: string; expectedRevision?: number; name: string; members: SuiteDefinitionAuthority[] } | null>(null)
  const [opened, setOpened] = useState<CanonicalSuiteRevision | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [verifiedEligibility,setVerifiedEligibility]=useState<SuiteRunEligibility>(runEligibility)
  const candidateById = useMemo(() => state.kind === 'ready' ? new Map(state.candidates.definitions.map(item => [item.definitionAuthority.definitionId, item])) : new Map(), [state])

  if (state.kind === 'transport_unavailable') return <section aria-labelledby="saved-suites-heading" className="rounded-lg border border-flaky/40 bg-surface p-5"><div className="flex gap-3"><AlertTriangle className="shrink-0 text-flaky" size={20} /><div><h2 id="saved-suites-heading" className="text-lg font-semibold text-primary">Saved Suites</h2><p className="mt-1 text-sm text-secondary">Saved Suite authority is not available in this branch. No endpoint, membership, or current-head state was guessed.</p><p className="mt-2 text-xs text-muted">Dependency: frozen M2 Core Suite DTOs and transport routes.</p></div></div></section>

  function startCreate() {
    const initialCandidate = initialDefinitionId ? candidateById.get(initialDefinitionId) : undefined
    setOpened(null)
    setMessage(initialCandidate ? `Definition ${initialDefinitionId} was preselected from the explicit handoff. Review the ordered Suite draft before Save.` : null)
    setDraft({ name: 'Checkout Sanity', members: initialCandidate ? [initialCandidate.definitionAuthority] : [] })
  }
  function startEdit(suite: CanonicalSuiteRevision) { setMessage(null); setDraft({ suiteId: suite.suiteId, expectedRevision: suite.revision, name: suite.name, members: suite.members.map(member => member.definitionAuthority) }) }
  function toggle(authority: SuiteDefinitionAuthority) { setDraft(current => current ? { ...current, members: current.members.some(member => member.definitionId === authority.definitionId) ? current.members.filter(member => member.definitionId !== authority.definitionId) : [...current.members, authority] } : current) }
  function move(index: number, offset: number) { setDraft(current => { if (!current) return current; const next = index + offset; if (next < 0 || next >= current.members.length) return current; const members = [...current.members]; [members[index], members[next]] = [members[next], members[index]]; return { ...current, members } }) }
  async function verifyRun(suite:CanonicalSuiteRevision){setVerifiedEligibility({kind:'unverified'});if(!preflight)return;try{setVerifiedEligibility(await preflight(suite.suiteId,suite.revision))}catch{setMessage('The exact Suite revision was loaded, but authoritative execution preflight is unavailable. Run remains disabled.')}}
  async function open(suite: CanonicalSuiteRevision) { if (!readRevision) return; setPending(true); setMessage(null); try { const exact=await readRevision(suite.suiteId, suite.revision);setOpened(exact);setDraft(null);await verifyRun(exact) } catch { setMessage('The exact Suite revision could not be loaded. No current head was substituted.') } finally { setPending(false) } }
  async function reloadCurrent(suiteId: string) {
    if (!refreshCurrentHead) {
      setMessage('The current Suite head cannot be refreshed because authoritative backend transport is unavailable. This draft and the previously opened revision were preserved.')
      return
    }
    setPending(true); setMessage(null)
    try {
      const current = await refreshCurrentHead(suiteId)
      if (current.projectId !== projectId || current.suiteId !== suiteId) throw new Error('Current Suite head identity mismatch.')
      setOpened(current); setDraft(null); setMessage(`Loaded authoritative current Suite revision ${current.revision}. Review it before editing again.`);await verifyRun(current)
    } catch {
      setMessage('The current Suite head could not be refreshed. This draft and the previously opened revision were preserved; nothing was relabeled as current.')
    } finally { setPending(false) }
  }
  async function submit() {
    if (!draft || !save) return
    const error = validateSuiteDraft(draft.name, draft.members)
    if (error) { setMessage(error); return }
    const request: SuiteChangeRequest = draft.suiteId && draft.expectedRevision
      ? { kind: 'revise', suiteId: draft.suiteId, expectedRevision: draft.expectedRevision, changeIntentKey: crypto.randomUUID(), name: draft.name, purpose: 'sanity', members: draft.members }
      : { kind: 'create', changeIntentKey: crypto.randomUUID(), name: draft.name, purpose: 'sanity', members: draft.members }
    setPending(true); setMessage(null)
    try { const saved = await save(request); setOpened(saved); setDraft(null); setMessage(`Saved immutable Suite revision ${saved.revision}.`);await verifyRun(saved) }
    catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code: unknown }).code) : ''
      setMessage(code === 'stale_suite_revision' ? 'Suite changed since this draft was opened. Reload the current revision and review again; no automatic merge was performed.' : 'The Suite was not saved. Draft values remain non-canonical.')
    } finally { setPending(false) }
  }

  return <section aria-labelledby="saved-suites-heading" className="space-y-4 rounded-lg border border-border bg-surface p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="saved-suites-heading" className="text-lg font-semibold text-primary">Saved Suites</h2><p className="mt-1 text-sm text-secondary">Create and reopen immutable, ordered Sanity Suite revisions.</p></div><button type="button" onClick={startCreate} className="inline-flex items-center gap-2 rounded bg-brand px-3 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand"><Plus size={16} /> Create Suite</button></div>
    {message && <p role="status" aria-live="polite" className="rounded border border-flaky/40 bg-elevated p-3 text-sm text-secondary">{message}</p>}
    {pending && <p role="status" className="flex items-center gap-2 text-sm text-secondary"><Loader2 size={16} className="animate-spin" /> Waiting for canonical backend response…</p>}
    {!draft && !opened && <div className="grid gap-3 sm:grid-cols-2">{state.heads.map(suite => <button key={suite.suiteId} type="button" onClick={() => { void open(suite) }} className="rounded border border-border bg-elevated p-4 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand"><span className="font-semibold text-primary">{suite.name}</span><span className="mt-1 block text-sm text-secondary">Sanity · revision {suite.revision} · {suite.members.length} member{suite.members.length === 1 ? '' : 's'}</span><span className="mt-1 block font-mono text-xs text-muted">{short(suite.contentHash)}</span></button>)}</div>}
    {!draft && !opened && state.heads.length === 0 && <p className="text-sm text-secondary">No saved Suite revision exists for this project.</p>}
    {opened && !draft && <SuiteRevisionView suite={opened} onEdit={() => startEdit(opened)} runEligibility={verifiedEligibility} />}
    {draft && <form onSubmit={event => { event.preventDefault(); void submit() }} className="space-y-5 rounded border border-brand/40 bg-elevated p-4"><div><p className="text-xs uppercase tracking-[0.16em] text-brand">{draft.suiteId ? `New revision from ${draft.expectedRevision}` : 'New Suite draft'}</p><h3 className="mt-1 text-lg font-semibold text-primary">Checkout Sanity</h3><p className="text-xs text-muted">This draft is not canonical until Save succeeds.</p></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-secondary">Name<input autoFocus value={draft.name} onChange={event => setDraft(current => current ? { ...current, name: event.target.value } : current)} maxLength={120} className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand" /></label><div><span className="text-sm text-secondary">Purpose</span><p className="mt-1 rounded border border-border bg-surface px-3 py-2 text-primary">Sanity</p></div></div><div><h4 className="font-medium text-primary">Current eligible Definitions</h4><p className="text-xs text-muted">Test Set {state.candidates.testSetAuthority.testSetId} · revision {state.candidates.testSetAuthority.testSetRevision} · v{state.candidates.testSetAuthority.definitionSchemaVersion} · <span title={state.candidates.testSetAuthority.testSetContentHash} className="font-mono">{short(state.candidates.testSetAuthority.testSetContentHash)}</span></p><div className="mt-3 grid gap-2 sm:grid-cols-2">{state.candidates.definitions.map(candidate => <label key={candidate.definitionAuthority.definitionId} className="flex gap-3 rounded border border-border bg-surface p-3 text-sm"><input type="checkbox" checked={draft.members.some(member => member.definitionId === candidate.definitionAuthority.definitionId)} onChange={() => toggle(candidate.definitionAuthority)} className="mt-1 h-4 w-4 accent-brand" /><span><span className="block font-medium text-primary">{candidate.title}</span><span className="block font-mono text-xs text-muted">{candidate.definitionAuthority.definitionId} · v{candidate.definitionAuthority.definitionSchemaVersion}</span></span></label>)}</div></div><div><h4 className="font-medium text-primary">Ordered selection ({draft.members.length}/50)</h4><ol className="mt-2 space-y-2">{draft.members.map((member, index) => <li key={member.definitionId} className="flex items-center gap-3 rounded border border-border bg-surface p-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm text-primary">{candidateById.get(member.definitionId)?.title ?? member.definitionId}</span><button type="button" aria-label={`Move ${member.definitionId} up`} disabled={index === 0} onClick={() => move(index, -1)} className="rounded p-1 text-secondary focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30"><ArrowUp size={15} /></button><button type="button" aria-label={`Move ${member.definitionId} down`} disabled={index === draft.members.length - 1} onClick={() => move(index, 1)} className="rounded p-1 text-secondary focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30"><ArrowDown size={15} /></button></li>)}</ol></div><div className="flex flex-wrap gap-2"><button type="submit" disabled={pending || !save} className="rounded bg-brand px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">Save immutable revision</button><button type="button" onClick={() => setDraft(null)} className="rounded border border-border px-4 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand">Cancel</button>{draft.suiteId && <button type="button" disabled={pending} onClick={() => { void reloadCurrent(draft.suiteId!) }} className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"><RotateCcw size={15} /> Reload current revision</button>}</div></form>}
  </section>
}

export function SavedSuitesProductWorkspace({projectId,initialDefinitionId}:{projectId:string;initialDefinitionId?:string|null}){
  const [state,setState]=useState<SavedSuitesState|null>(null)
  const [error,setError]=useState(false)
  useEffect(()=>{let active=true;setState(null);setError(false);Promise.all([suiteTransport.listHeads(projectId),suiteTransport.readCandidates(projectId)])
    .then(([heads,candidates])=>{if(active)setState({kind:'ready',heads,candidates})}).catch(()=>{if(active)setError(true)});return()=>{active=false}},[projectId,initialDefinitionId])
  if(error)return <section role="alert" className="rounded-lg border border-fail/40 bg-surface p-5"><h2 className="text-lg font-semibold text-primary">Saved Suites unavailable</h2><p className="mt-1 text-sm text-secondary">Canonical Suite authority or current Definition candidates could not be read safely.</p></section>
  if(!state)return <div role="status" className="flex items-center gap-2 text-secondary"><Loader2 size={18} className="animate-spin" /> Loading Saved Suites…</div>
  return <SavedSuitesWorkspace projectId={projectId} state={state} initialDefinitionId={initialDefinitionId}
    readRevision={(suiteId,revision)=>suiteTransport.readRevision(projectId,suiteId,revision)}
    refreshCurrentHead={async suiteId=>{const current=await suiteTransport.refreshCurrentHead(projectId,suiteId);setState(value=>value?.kind==='ready'?{...value,heads:[...value.heads.filter(item=>item.suiteId!==suiteId),current]}:value);return current}}
    save={async request=>{const saved=await suiteTransport.save(projectId,request);setState(value=>value?.kind==='ready'?{...value,heads:[...value.heads.filter(item=>item.suiteId!==saved.suiteId),saved]}:value);return saved}}
    preflight={async(suiteId,suiteRevision)=>{const result=await suiteTransport.preflight(projectId,{suiteId,suiteRevision});const authority=result.selectionAuthority;return authority?{kind:'eligible',source:'authoritative_preflight',suiteId:authority.suiteId,suiteRevision:authority.suiteRevision,suiteContentHash:authority.suiteContentHash,name:authority.name,purpose:authority.purpose}:{kind:'unverified'}}}/>
}
