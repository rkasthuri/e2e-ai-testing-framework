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

const OBSERVATION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/

export interface ObservationSelectionResolution {
  selectedId: string | null
  explanation: string | null
}

export function isObservationId(value: string): boolean {
  return OBSERVATION_ID.test(value)
}

export function resolveObservationSelection(
  requestedId: string | null,
  loadedIds: string[],
  defaultId: string | null,
  requestedStatus: 'on_page' | 'outside_page' | 'outside_filter' | 'not_found' | null,
): ObservationSelectionResolution {
  if (requestedId === null) {
    return { selectedId: defaultId, explanation: null }
  }
  if (!OBSERVATION_ID.test(requestedId)) {
    return {
      selectedId: defaultId,
      explanation: defaultId
        ? 'The requested observation identifier was invalid. The newest observation on this page is selected instead.'
        : 'The requested observation identifier was invalid and no observation was expanded.',
    }
  }
  if (loadedIds.includes(requestedId)) {
    return { selectedId: requestedId, explanation: null }
  }
  if (requestedStatus === 'outside_filter') {
    return {
      selectedId: defaultId,
      explanation: defaultId
        ? 'The requested observation does not match the active Started date filter. The newest matching observation on this page is selected instead.'
        : 'The requested observation does not match the active Started date filter and was not expanded.',
    }
  }
  if (requestedStatus === 'outside_page') {
    return {
      selectedId: defaultId,
      explanation: 'The requested observation belongs to this project and filter but is outside the current bounded page. It was not loaded or expanded.',
    }
  }
  return {
    selectedId: defaultId,
    explanation: defaultId
      ? 'The requested observation was not available for the selected project. The newest observation on this page is selected instead.'
      : 'The requested observation was not available for the selected project and no observation was expanded.',
  }
}
