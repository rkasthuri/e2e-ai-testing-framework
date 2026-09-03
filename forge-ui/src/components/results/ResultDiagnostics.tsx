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

import { AlertTriangle, FileQuestion, ShieldAlert } from 'lucide-react'
import React, { useId } from 'react'
import type {
  CanonicalDiagnosticOutcome,
  CanonicalResultDiagnostic,
} from '../../api/resultsContract'
import {
  DIAGNOSTIC_FAILURE_LABELS,
  DIAGNOSTIC_REFUSAL_LABELS,
} from '../shared/diagnosticPresentation'

type DiagnosticUnavailableReason = Extract<CanonicalResultDiagnostic, { state: 'unavailable' }>['reason']
type IntegrityFinding = Extract<CanonicalDiagnosticOutcome, { kind: 'refusal'; refusalCode: 'integrity_invalid' }>['integrityFindings'][number]

const INTEGRITY_FINDING_LABELS: Record<IntegrityFinding, string> = {
  diagnostic_evidence_contradiction: 'Diagnostic evidence contradiction',
  diagnostic_authority_binding_invalid: 'Diagnostic authority binding invalid',
  diagnostic_historical_authority_substitution: 'Historical authority substitution detected',
}

const INTEGRITY_FINDING_ORDER: readonly IntegrityFinding[] = [
  'diagnostic_evidence_contradiction',
  'diagnostic_authority_binding_invalid',
  'diagnostic_historical_authority_substitution',
]

const INTEGRITY_FINDING_RANK = Object.fromEntries(
  INTEGRITY_FINDING_ORDER.map((finding, index) => [finding, index]),
) as Record<IntegrityFinding, number>

const UNAVAILABLE_PRESENTATION: Record<DiagnosticUnavailableReason, { label: string; explanation: (hasResult: boolean) => string }> = {
  not_found: {
    label: 'Diagnostic evidence not found',
    explanation: hasResult => hasResult
      ? 'No item-specific diagnostic evidence was found for this Result.'
      : 'No item-specific diagnostic evidence was found for this manifest item.',
  },
  unreadable: {
    label: 'Diagnostic evidence unreadable',
    explanation: () => 'The item-specific diagnostic evidence could not be read safely. Interpretation is unavailable.',
  },
  unsupported_classifier_version: {
    label: 'Classifier version not supported',
    explanation: () => 'This item uses a diagnostic classifier version that this Results view cannot present.',
  },
}

function DiagnosticIdentity({ diagnostic }: { diagnostic: CanonicalResultDiagnostic }) {
  return <dl className="mt-3 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
    <div className="min-w-0"><dt className="text-muted">Project</dt><dd className="break-all font-mono text-secondary">{diagnostic.identity.projectId}</dd></div>
    <div className="min-w-0"><dt className="text-muted">Execution</dt><dd className="break-all font-mono text-secondary">{diagnostic.identity.executionId}</dd></div>
    <div className="min-w-0"><dt className="text-muted">Run</dt><dd className="break-all font-mono text-secondary">{diagnostic.identity.runId}</dd></div>
    <div><dt className="text-muted">Manifest item</dt><dd className="font-mono text-secondary">{diagnostic.identity.itemOrdinal}</dd></div>
    <div className="min-w-0"><dt className="text-muted">Evidence schema</dt><dd className="break-all font-mono text-secondary">{diagnostic.identity.evidenceSchemaVersion}</dd></div>
    {diagnostic.state === 'available' && <div className="min-w-0"><dt className="text-muted">Classifier</dt><dd className="break-all font-mono text-secondary">{diagnostic.classifierVersion}</dd></div>}
  </dl>
}

function DiagnosticProvenance({ diagnostic }: { diagnostic: CanonicalResultDiagnostic }) {
  return <details className="mt-3 min-w-0">
    <summary className="cursor-pointer rounded-sm text-xs font-medium text-brand outline-none focus-visible:ring-2 focus-visible:ring-brand">
      Diagnostic provenance
    </summary>
    <DiagnosticIdentity diagnostic={diagnostic} />
  </details>
}

function UnavailableDiagnostic({ diagnostic, hasResult }: { diagnostic: Extract<CanonicalResultDiagnostic, { state: 'unavailable' }>; hasResult: boolean }) {
  const headingId = useId()
  const presentation = UNAVAILABLE_PRESENTATION[diagnostic.reason]
  return <section aria-labelledby={headingId} className="min-w-0 rounded-md border border-border bg-surface p-3">
    <div className="flex min-w-0 items-start gap-3">
      <FileQuestion aria-hidden="true" className="mt-0.5 shrink-0 text-muted" size={18} />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">Diagnostic detail unavailable<span className="sr-only"> for this {hasResult ? 'Result' : 'manifest item'}</span></p>
        <h5 id={headingId} className="mt-1 break-words font-semibold text-primary">{presentation.label}</h5>
        <p className="mt-1 break-words text-sm text-secondary [overflow-wrap:anywhere]">{presentation.explanation(hasResult)}</p>
        <DiagnosticProvenance diagnostic={diagnostic} />
      </div>
    </div>
  </section>
}

function AvailableDiagnostic({ diagnostic, hasResult }: { diagnostic: Extract<CanonicalResultDiagnostic, { state: 'available' }>; hasResult: boolean }) {
  const headingId = useId()
  const outcome = diagnostic.outcome
  const classified = outcome.kind === 'classified_failure'
  const integrityInvalid = outcome.kind === 'refusal' && outcome.refusalCode === 'integrity_invalid'
  const label = outcome.kind === 'classified_failure'
    ? DIAGNOSTIC_FAILURE_LABELS[outcome.failureMode]
    : DIAGNOSTIC_REFUSAL_LABELS[outcome.refusalCode]
  const integrityFindings = integrityInvalid
    ? [...outcome.integrityFindings].sort((left, right) => INTEGRITY_FINDING_RANK[left] - INTEGRITY_FINDING_RANK[right])
    : []

  return <section aria-labelledby={headingId} className={`min-w-0 rounded-md border bg-surface p-3 ${integrityInvalid ? 'border-fail/50' : classified ? 'border-fail/30' : 'border-unknown/40'}`}>
    <div className="flex min-w-0 items-start gap-3">
      {integrityInvalid
        ? <ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0 text-fail" size={18} />
        : <AlertTriangle aria-hidden="true" className={`mt-0.5 shrink-0 ${classified ? 'text-fail' : 'text-unknown'}`} size={18} />}
      <div className="min-w-0">
        <p className={`text-xs font-medium uppercase tracking-[0.12em] ${classified ? 'text-fail' : integrityInvalid ? 'text-fail' : 'text-unknown'}`}>
          {classified ? 'Classified failure' : 'Classification withheld'}
        </p>
        <h5 id={headingId} className="mt-1 break-words font-semibold text-primary">{label}</h5>
        <p className="mt-1 break-words text-sm text-secondary [overflow-wrap:anywhere]">{diagnostic.displayString}</p>
        {outcome.kind === 'refusal' && outcome.refusalCode === 'insufficient_evidence' && <p className="mt-2 text-xs text-muted">FORGE cannot classify this {hasResult ? 'Result' : 'manifest item'} from the current authoritative evidence.</p>}
        {outcome.kind === 'refusal' && outcome.refusalCode === 'integrity_invalid' && <>
          <p className="mt-2 text-xs text-muted">Interpretation is withheld because diagnostic evidence or authority integrity is invalid.</p>
          <div className="mt-3">
            <h6 className="text-xs font-medium text-primary">Integrity findings</h6>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-secondary">
              {integrityFindings.map(finding => <li key={finding}>{INTEGRITY_FINDING_LABELS[finding]}</li>)}
            </ul>
          </div>
        </>}
        <DiagnosticProvenance diagnostic={diagnostic} />
      </div>
    </div>
  </section>
}

export function ResultDiagnostics({ diagnostic, hasResult }: { diagnostic?: CanonicalResultDiagnostic; hasResult: boolean }) {
  if (!diagnostic) return <p role="status" aria-live="polite" className="text-xs text-muted">No diagnostic detail is attached to this {hasResult ? 'Result' : 'manifest item'}. No classification or refusal is implied.</p>
  return diagnostic.state === 'available'
    ? <AvailableDiagnostic diagnostic={diagnostic} hasResult={hasResult} />
    : <UnavailableDiagnostic diagnostic={diagnostic} hasResult={hasResult} />
}
