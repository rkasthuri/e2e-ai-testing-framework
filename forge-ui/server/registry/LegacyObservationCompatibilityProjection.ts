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

import { observationStore, type ObservationStore } from './ObservationStore'
import { projectObservationHistoryItem } from './ObservationHistoryPresenter'

/** Read-only, clearly labelled adapter for pre-canonical Observation files. */
export class LegacyObservationCompatibilityProjection {
  constructor(private readonly store: Pick<ObservationStore, 'latest' | 'history'> = observationStore) {}

  readLatest(projectId: string) {
    const item = this.store.latest(projectId)
    return item ? { ...item, authority: 'legacy_compatibility' as const } : null
  }

  readHistory(projectId: string, projectName: string, query: any) {
    const history = this.store.history(projectId, query)
    if (history.kind !== 'ok') return history
    return {
      kind: 'ok' as const,
      value: {
        authority: 'legacy_compatibility' as const,
        project: { id: projectId, name: projectName },
        observations: history.observations.map(projectObservationHistoryItem),
        page: {
          limit: query.limit,
          nextCursor: history.nextCursor,
          previousCursor: history.previousCursor,
          hasPrevious: history.hasPrevious,
          filteredTotal: history.filteredTotal,
          projectTotal: history.projectTotal,
        },
        filter: { startedFrom: query.startedFrom, startedThrough: query.startedThrough },
        requestedObservation: history.requestedObservation,
      },
    }
  }
}

export const legacyObservationCompatibilityProjection = new LegacyObservationCompatibilityProjection()
