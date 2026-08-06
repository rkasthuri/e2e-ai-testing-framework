/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import type {
  ApplicationModelHistoryItem,
  ApplicationModelHistoryResponse,
} from '../../api/types'

/** The live tab consumes the server's bounded, presentation-safe read model. */
export type ApplicationModelReadModel = ApplicationModelHistoryResponse
export type ApplicationModelSubject = ApplicationModelHistoryItem['subjects'][number]
export type ApplicationModelVersion = ApplicationModelHistoryItem
