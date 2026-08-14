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

import { AsyncLocalStorage } from 'async_hooks'
import type { ActiveDatabaseProvenance, DatabaseDialect } from './DatabaseAuthority'

const migrationContext = new AsyncLocalStorage<ActiveDatabaseProvenance>()

/**
 * Scope migration decisions to the authority that opened the database handle.
 * AsyncLocalStorage prevents concurrent asynchronous operations from observing
 * another migration's authority without mutating process.env.
 */
export function runWithMigrationContext<T>(
  provenance: ActiveDatabaseProvenance,
  operation: () => Promise<T>,
): Promise<T> {
  return migrationContext.run(provenance, operation)
}

/** Hidden ambient dialect detection is forbidden; an uncoordinated migration fails closed. */
export function currentMigrationDialect(): DatabaseDialect {
  const provenance = migrationContext.getStore()
  if (!provenance) {
    throw new Error('Migration authority context is required before dialect-specific migration behavior may run.')
  }
  return provenance.dialect
}
