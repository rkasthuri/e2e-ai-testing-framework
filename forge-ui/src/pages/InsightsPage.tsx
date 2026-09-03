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

import { AlertTriangle, Ban, Loader2 } from 'lucide-react'
import React from 'react'
import { ApiError } from '../api/client'
import { DiagnosticInsightsPayloadError } from '../api/insightsClient'
import {
  INSIGHTS_CLASSIFIER_VERSION,
  INSIGHTS_EVIDENCE_SCHEMA_VERSION,
  type DiagnosticInsightsReadModel,
  type InsightsFailureMode,
} from '../api/insightsContract'
import {
  DIAGNOSTIC_FAILURE_LABELS,
  DIAGNOSTIC_REFUSAL_LABELS,
} from '../components/shared/diagnosticPresentation'
import { ProjectSelector } from '../components/shared/ProjectSelector'
import { useDiagnosticInsights } from '../hooks/useApi'
import { useCurrentProject } from '../hooks/useCurrentProject'

function Metric({ label, value, accent = 'text-primary' }: { label: string; value: number; accent?: string }) {
  return <div className="min-w-0 rounded-lg border border-border bg-surface p-4"><dt className="break-words text-sm text-secondary">{label}</dt><dd className={`mt-2 text-3xl font-semibold tabular-nums ${accent}`}>{value}</dd></div>
}

function BoundedState({ title, explanation }: { title: string; explanation: string }) {
  return <section role="alert" aria-atomic="true" className="min-w-0 rounded-lg border border-fail/50 bg-surface p-6"><div className="flex min-w-0 items-start gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-fail" size={20} /><div className="min-w-0"><h2 className="break-words font-semibold text-primary">{title}</h2><p className="mt-1 break-words text-sm text-secondary [overflow-wrap:anywhere]">{explanation}</p></div></div></section>
}

export function InsightsVersionScope({ evidenceSchemaVersion, classifierVersion }: { evidenceSchemaVersion: string; classifierVersion: string }) {
  return <section aria-labelledby="version-scope-heading" className="min-w-0 rounded-lg border border-border bg-elevated p-4"><h2 id="version-scope-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Explicit version scope</h2><dl className="mt-2 grid min-w-0 gap-2 text-sm sm:grid-cols-2"><div className="min-w-0"><dt className="text-muted">Evidence schema</dt><dd className="break-all font-mono text-secondary">{evidenceSchemaVersion}</dd></div><div className="min-w-0"><dt className="text-muted">Classifier</dt><dd className="break-all font-mono text-secondary">{classifierVersion}</dd></div></dl></section>
}

export function InsightsError({ error }: { error: unknown }) {
  if (error instanceof DiagnosticInsightsPayloadError || error instanceof ApiError && error.code === 'DIAGNOSTIC_INSIGHTS_PAYLOAD_INVALID') return <BoundedState title="Diagnostic Insights response was invalid" explanation="FORGE refused the malformed response. No counts were displayed or inferred." />
  if (error instanceof ApiError && (error.code === 'INVALID_APP_NAME' || error.code === 'INVALID_DIAGNOSTIC_INSIGHTS_PROJECT')) return <BoundedState title="Invalid project identity" explanation="The requested project identity is not canonical. FORGE did not interpret it as an empty partition." />
  if (error instanceof ApiError && error.status === 404) return <BoundedState title="Project not found" explanation="The selected canonical Product project does not exist. This is not a zero-diagnostic partition." />
  if (error instanceof ApiError && error.code === 'UNSUPPORTED_DIAGNOSTIC_EVIDENCE_VERSION') return <BoundedState title="Evidence version not supported" explanation="The explicit diagnostic evidence version is unavailable. FORGE did not retry with another version." />
  if (error instanceof ApiError && error.code === 'UNSUPPORTED_DIAGNOSTIC_CLASSIFIER_VERSION') return <BoundedState title="Classifier version not supported" explanation="The explicit diagnostic classifier version is unavailable. FORGE did not retry with another version." />
  if (error instanceof ApiError && error.code === 'DIAGNOSTIC_INSIGHTS_PARTITION_UNREADABLE') return <BoundedState title="Diagnostic partition unavailable" explanation="The partition could not be read safely. Partial counts are withheld." />
  return <BoundedState title="Diagnostic Insights unavailable" explanation="The exact version partition could not be read safely. No legacy or current-head data was used as a fallback." />
}

export function InsightsSummary({ insights }: { insights: DiagnosticInsightsReadModel }) {
  if (insights.totalDiagnostics === 0) return <section role="status" aria-live="polite" aria-atomic="true" className="rounded-lg border border-border bg-surface p-8 text-center"><Ban aria-hidden="true" className="mx-auto text-muted" size={24} /><h2 className="mt-3 text-lg font-semibold text-primary">No diagnostics in this version partition</h2><p className="mx-auto mt-2 max-w-xl text-sm text-secondary">This valid project has zero canonical diagnostic records for the explicit versions shown above.</p></section>
  return <div className="min-w-0 space-y-6">
    <section aria-labelledby="summary-heading"><h2 id="summary-heading" className="text-lg font-semibold text-primary">Diagnostic summary</h2><dl className="mt-3 grid gap-3 sm:grid-cols-3"><Metric label="Total diagnostics" value={insights.totalDiagnostics} /><Metric label="Classified failures" value={insights.classifiedFailureCount} accent="text-fail" /><Metric label="Refusals" value={insights.refusalCount} accent="text-unknown" /></dl></section>
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <section aria-labelledby="failure-modes-heading" className="min-w-0 rounded-lg border border-border bg-surface p-5"><h2 id="failure-modes-heading" className="font-semibold text-primary">Classified failure modes</h2><p className="mt-1 text-sm text-secondary">Only evidence-gated classified failures appear here.</p><dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">{Object.entries(DIAGNOSTIC_FAILURE_LABELS).map(([mode, label]) => <div key={mode} className="flex min-w-0 items-center justify-between gap-3 rounded border border-border bg-elevated px-3 py-2"><dt className="min-w-0 break-words text-sm text-secondary">{label}</dt><dd className="shrink-0 font-semibold tabular-nums text-fail">{insights.countsByFailureMode[mode as InsightsFailureMode]}</dd></div>)}</dl></section>
      <section aria-labelledby="refusals-heading" className="min-w-0 rounded-lg border border-unknown/40 bg-surface p-5"><h2 id="refusals-heading" className="font-semibold text-primary">Classification refusals</h2><p className="mt-1 text-sm text-secondary">Refusals are not classified failures and are never added to failure-mode counts.</p><dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><Metric label={DIAGNOSTIC_REFUSAL_LABELS.insufficient_evidence} value={insights.insufficientEvidenceCount} accent="text-unknown" /><Metric label={DIAGNOSTIC_REFUSAL_LABELS.integrity_invalid} value={insights.integrityInvalidCount} accent="text-unknown" /></dl></section>
    </div>
  </div>
}

export function InsightsPage() {
  const project = useCurrentProject()
  const query = useDiagnosticInsights(project)
  return <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <header><p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Version-partitioned diagnostic evidence</p><h1 className="mt-1 text-2xl font-semibold text-primary">Insights</h1><p className="mt-1 max-w-3xl text-sm text-secondary">Project-wide canonical diagnostic counts, read from one explicit evidence and classifier version partition.</p></header>
    {!project && <section className="rounded-lg border border-border bg-surface"><ProjectSelector title="Insights" subtitle="Select a project to read its canonical diagnostic partition." basePath="/insights" /></section>}
    {project && <InsightsVersionScope evidenceSchemaVersion={INSIGHTS_EVIDENCE_SCHEMA_VERSION} classifierVersion={INSIGHTS_CLASSIFIER_VERSION} />}
    {project && (query.isLoading
      ? <div role="status" aria-live="polite" aria-atomic="true" aria-busy="true" className="flex items-center gap-2 text-secondary"><Loader2 aria-hidden="true" className="animate-spin" size={18} /> Loading exact diagnostic partition…</div>
      : query.isError
        ? <InsightsError error={query.error} />
        : query.data
          ? <InsightsSummary insights={query.data} />
          : null)}
  </div>
}
