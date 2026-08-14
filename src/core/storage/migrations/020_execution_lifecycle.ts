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

import { Kysely } from 'kysely'

/**
 * TD-UI-069B-B — durable Product UI execution coordination only.
 * Test outcomes remain owned by runs/test_results; these tables retain the
 * acceptance/terminal truth and the one-active-execution-per-project lock.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable('execution_events')
    .addColumn('id', 'integer', column => column.primaryKey().autoIncrement())
    .addColumn('execution_id', 'varchar(255)', column => column.notNull())
    .addColumn('project_id', 'varchar(255)', column => column.notNull())
    .addColumn('event_type', 'varchar(20)', column => column.notNull())
    .addColumn('outcome', 'varchar(50)')
    .addColumn('occurred_at', 'varchar(50)', column => column.notNull())
    .addColumn('process_instance_id', 'varchar(255)', column => column.notNull())
    .addColumn('safe_code', 'varchar(100)')
    .addColumn('safe_message', 'text', column => column.notNull())
    .addColumn('execution_plan_hash', 'varchar(64)', column => column.notNull())
    .addUniqueConstraint('uq_execution_event', ['execution_id', 'event_type'])
    .execute()
  await db.schema.createIndex('idx_execution_project_identity')
    .on('execution_events')
    .columns(['project_id', 'execution_id'])
    .execute()

  await db.schema.createTable('execution_locks')
    .addColumn('project_id', 'varchar(255)', column => column.notNull().primaryKey())
    .addColumn('execution_id', 'varchar(255)', column => column.notNull().unique())
    .addColumn('process_instance_id', 'varchar(255)', column => column.notNull())
    .addColumn('acquired_at', 'varchar(50)', column => column.notNull())
    .addColumn('last_heartbeat_at', 'varchar(50)', column => column.notNull())
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('execution_locks').execute()
  await db.schema.dropTable('execution_events').execute()
}
