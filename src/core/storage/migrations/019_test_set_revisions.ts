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

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable('test_set_revisions')
    .addColumn('id', 'integer', column => column.primaryKey().autoIncrement())
    .addColumn('test_set_id', 'varchar(255)', column => column.notNull())
    .addColumn('revision', 'integer', column => column.notNull())
    .addColumn('project_id', 'varchar(255)', column => column.notNull())
    .addColumn('generation_id', 'varchar(255)', column => column.notNull().unique())
    .addColumn('source_observation_id', 'varchar(255)', column => column.notNull())
    .addColumn('model_row_id', 'integer', column => column.notNull())
    .addColumn('model_version', 'varchar(50)', column => column.notNull())
    .addColumn('generated_at', 'varchar(50)', column => column.notNull())
    .addColumn('outcome', 'varchar(50)', column => column.notNull())
    .addColumn('definition_count', 'integer', column => column.notNull())
    .addColumn('payload_json', 'text', column => column.notNull())
    .addColumn('content_hash', 'varchar(64)', column => column.notNull())
    .addUniqueConstraint('uq_test_set_project_revision', ['project_id', 'revision'])
    .execute()
  await db.schema.createIndex('idx_test_set_project_newest').on('test_set_revisions').columns(['project_id', 'revision']).execute()

  await db.schema.createTable('test_generation_events')
    .addColumn('id', 'integer', column => column.primaryKey().autoIncrement())
    .addColumn('generation_id', 'varchar(255)', column => column.notNull())
    .addColumn('project_id', 'varchar(255)', column => column.notNull())
    .addColumn('event_type', 'varchar(20)', column => column.notNull())
    .addColumn('outcome', 'varchar(50)')
    .addColumn('occurred_at', 'varchar(50)', column => column.notNull())
    .addColumn('process_instance_id', 'varchar(255)', column => column.notNull())
    .addColumn('test_set_row_id', 'integer')
    .addColumn('safe_code', 'varchar(100)')
    .addColumn('safe_message', 'text', column => column.notNull())
    .addUniqueConstraint('uq_test_generation_event', ['generation_id', 'event_type'])
    .execute()
  await db.schema.createIndex('idx_test_generation_project').on('test_generation_events').columns(['project_id', 'generation_id']).execute()

  await db.schema.createTable('test_generation_locks')
    .addColumn('project_id', 'varchar(255)', column => column.primaryKey())
    .addColumn('generation_id', 'varchar(255)', column => column.notNull().unique())
    .addColumn('process_instance_id', 'varchar(255)', column => column.notNull())
    .addColumn('acquired_at', 'varchar(50)', column => column.notNull())
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('test_generation_locks').execute()
  await db.schema.dropTable('test_generation_events').execute()
  await db.schema.dropTable('test_set_revisions').execute()
}
