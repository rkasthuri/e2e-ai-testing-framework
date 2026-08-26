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

import React from 'react'
import type { CanonicalSuiteSelectionAuthority } from '../../api/suiteContract'

export function SuiteResultsProvenance({ authority }: { authority: CanonicalSuiteSelectionAuthority }) {
  return <section aria-labelledby="suite-results-provenance" className="rounded-lg border border-brand/40 bg-surface p-4">
    <p className="text-xs uppercase tracking-[0.16em] text-brand">Immutable accepted Suite provenance</p>
    <h3 id="suite-results-provenance" className="mt-1 text-lg font-semibold text-primary">{authority.name}</h3>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-xs text-muted">Purpose</dt><dd className="text-primary">Sanity</dd></div>
      <div><dt className="text-xs text-muted">Revision</dt><dd className="text-primary">{authority.suiteRevision}</dd></div>
      <div><dt className="text-xs text-muted">Suite ID</dt><dd className="break-all font-mono text-secondary">{authority.suiteId}</dd></div>
      <div><dt className="text-xs text-muted">Content hash</dt><dd className="break-all font-mono text-xs text-secondary">{authority.suiteContentHash}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-muted">This name and purpose came from the immutable Suite revision accepted by the Execution, never the current Suite head.</p>
  </section>
}
