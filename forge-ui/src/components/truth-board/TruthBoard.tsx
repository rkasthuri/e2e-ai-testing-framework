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

import { AlertTriangle, ArrowRight, CircleHelp, FileSearch, ShieldAlert } from 'lucide-react'
import { mapTruthBoardToCards, type TruthCardModel } from './presentation'
import type { TruthBoardReadModel } from './types'

const stateLabel: Record<TruthCardModel['state'], string> = {
  unknown: 'Unknown', low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence',
}

function EvidenceList({ ids }: { ids: string[] }) {
  return ids.length === 0 ? (
    <span className="text-muted">No evidence references</span>
  ) : (
    <ul className="flex flex-wrap gap-1" aria-label="Evidence references">
      {ids.map(id => <li key={id} className="rounded border border-border bg-elevated px-2 py-0.5 font-mono text-[11px] text-secondary">{id}</li>)}
    </ul>
  )
}

function TruthCard({ card, prominent = false }: { card: TruthCardModel; prominent?: boolean }) {
  return (
    <article className={`rounded-lg border border-border bg-surface p-5 ${prominent ? 'min-h-[220px]' : ''}`} data-truth-card={card.key}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted">{card.title}</p>
          <h3 className="mt-1 text-lg font-semibold text-primary">{stateLabel[card.state]}</h3>
        </div>
        <span className={`rounded-full border px-2 py-1 text-xs ${card.state === 'unknown' ? 'border-unknown text-unknown' : card.state === 'high' ? 'border-pass text-pass' : 'border-flaky text-flaky'}`}>
          {card.state}
        </span>
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div><dt className="text-xs uppercase tracking-wide text-muted">Observation</dt><dd className="mt-1 text-secondary">{card.observation}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Why this state</dt><dd className="mt-1 text-secondary">{card.why}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted">Impact</dt><dd className="mt-1 text-secondary">{card.impact}</dd></div>
      </dl>

      {card.preventedHigherState && <p className="mt-4 border-l-2 border-unknown pl-3 text-xs text-unknown">{card.preventedHigherState}</p>}

      {card.blockers.length > 0 && (
        <div className="mt-4 rounded border border-fail/40 bg-elevated p-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fail"><ShieldAlert size={14} /> Blockers</p>
          <ul className="mt-2 space-y-2 text-xs text-secondary">{card.blockers.map(item => <li key={item.id}><strong className="text-primary">{item.subject}:</strong> {item.reason}</li>)}</ul>
        </div>
      )}

      {card.unknowns.length > 0 && (
        <div className="mt-4 rounded border border-unknown/40 bg-elevated p-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-unknown"><CircleHelp size={14} /> Unknowns</p>
          <ul className="mt-2 space-y-2 text-xs text-secondary">{card.unknowns.map(item => <li key={item.id}><strong className="text-primary">{item.subject}:</strong> {item.reason}</li>)}</ul>
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3 text-xs">
        <p className="mb-1 flex items-center gap-2 uppercase tracking-wide text-muted"><FileSearch size={13} /> Evidence</p>
        <EvidenceList ids={card.evidenceIds} />
      </div>

      {card.recommendation && <div className="mt-4 flex gap-2 border-t border-border pt-3 text-sm text-secondary"><ArrowRight size={16} className="mt-0.5 shrink-0 text-brand" /><span><strong className="text-primary">Next:</strong> {card.recommendation.action}<span className="mt-1 block text-xs text-muted">{card.recommendation.reason}</span></span></div>}
    </article>
  )
}

export function TruthBoard({ readModel }: { readModel: TruthBoardReadModel }) {
  const cards = mapTruthBoardToCards(readModel)
  const projectStatus = cards.find(card => card.key === 'project-status')
  const truthConfidence = cards.find(card => card.key === 'truth-confidence')
  const detailCards = cards.filter(card => card.key !== 'project-status' && card.key !== 'truth-confidence')

  return (
    <div className="mx-auto max-w-7xl space-y-6" data-testid="truth-board">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs uppercase tracking-[0.2em] text-brand">Truth Board</p><h1 className="mt-1 text-2xl font-semibold text-primary">{readModel.project.displayName}</h1><p className="mt-1 text-sm text-secondary">Decision context as of {readModel.asOf}</p></div>
        <p className="text-xs text-muted">Observation boundary: {readModel.project.observationBoundary}</p>
      </header>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {projectStatus && <TruthCard card={projectStatus} prominent />}
        {truthConfidence && <TruthCard card={truthConfidence} prominent />}
      </div>
      <section aria-labelledby="truth-board-details">
        <div className="mb-3 flex items-center gap-2"><AlertTriangle size={16} className="text-brand" /><h2 id="truth-board-details" className="text-sm font-semibold uppercase tracking-[0.16em] text-secondary">Decision cards</h2></div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">{detailCards.map(card => <TruthCard key={card.key} card={card} />)}</div>
      </section>
    </div>
  )
}
