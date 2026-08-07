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

// Presentation aliases only. Repository, validation, hashing, and persistence
// types never cross into the UI bundle.
export type {
  EvidenceLedgerResponse as ApplicationEvidenceReadModel,
  EvidenceLedgerItem as EvidenceLedgerRecord,
  EvidenceLedgerSourceClass,
  EvidenceLedgerSupport,
  EvidenceLedgerIntegrity,
} from '../../api/types'
