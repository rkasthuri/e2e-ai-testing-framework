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

import { getDb } from '../db'
import { AppModel as StoredAppModel, NewAppModel } from '../types'
import type { AppModel as AppModelSnapshot } from '../../onboarding/types'
import { validateAppModelObject } from '../../onboarding/ModelValidator'

export class AppModelPersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AppModelPersistenceError'
  }
}

export class InvalidAppModelStateError extends AppModelPersistenceError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAppModelStateError'
  }
}

function rowFromSnapshot(model: AppModelSnapshot): NewAppModel {
  const validation = validateAppModelObject(model)
  if (!validation.valid) {
    throw new AppModelPersistenceError(
      `[AppModelRepository.upsert] App Model '${model?.app?.name ?? 'unknown'}' failed schema validation: ${validation.errors.join('; ')}`,
    )
  }

  const isApiModel = model.app.appType === 'rest-api'
    || model.app.appType === 'graphql-api'
    || (model.endpoints?.length ?? 0) > 0

  return {
    app_name:          model.app.name,
    version:           model.app.modelVersion,
    base_url:          model.app.baseUrl,
    app_type:          model.app.appType,
    intake_mode:       isApiModel ? 'spec-driven' : 'crawl',
    crawl_config_hash: model.app.crawlMetadata?.crawlConfigHash ?? '',
    page_count:        isApiModel ? (model.endpoints?.length ?? 0) : (model.pages?.length ?? 0),
    flow_count:        model.flows?.length ?? 0,
    role_count:        model.roles.length,
    model_json:        JSON.stringify(model),
    crawled_at:        model.app.crawlMetadata?.crawledAt ?? null,
    crawled_by:        model.app.crawlMetadata?.crawledBy ?? null,
    status:            'active',
    evidence_state:    model.app.evidenceState,
  }
}

export class AppModelRepository {

  async upsert(snapshot: AppModelSnapshot): Promise<StoredAppModel> {
    const row = rowFromSnapshot(snapshot)
    const db = getDb()
    try {
      return await db.transaction().execute(async trx => {
        await trx.updateTable('app_models')
          .set({ status: 'superseded' })
          .where('app_name', '=', row.app_name)
          .where('status', '=', 'active')
          .execute()

        return trx.insertInto('app_models')
          .values(row)
          .returningAll()
          .executeTakeFirstOrThrow()
      })
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.upsert] Failed to replace active App Model '${row.app_name}' version '${row.version}'.`,
        { cause },
      )
    }
  }

  async findActive(appName: string): Promise<StoredAppModel | null> {
    const db = getDb()
    let rows: StoredAppModel[]
    try {
      rows = await db.selectFrom('app_models')
        .selectAll()
        .where('app_name', '=', appName)
        .where('status', '=', 'active')
        .orderBy('id', 'desc')
        .limit(2)
        .execute()
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.findActive] Failed to read active App Model '${appName}'.`,
        { cause },
      )
    }
    if (rows.length > 1) {
      throw new InvalidAppModelStateError(
        `[AppModelRepository.findActive] Invalid database state for '${appName}': multiple active rows (${rows.map(row => row.id).join(', ')}).`,
      )
    }
    return rows[0] ?? null
  }

  async findHistory(appName: string): Promise<StoredAppModel[]> {
    const db = getDb()
    return db.selectFrom('app_models')
      .selectAll()
      .where('app_name', '=', appName)
      .orderBy('crawled_at', 'desc')
      .orderBy('id', 'desc')
      .execute()
  }

  async markStale(appName: string): Promise<void> {
    const db = getDb()
    await db.updateTable('app_models')
      .set({ status: 'stale' })
      .where('app_name', '=', appName)
      .where('status', '=', 'active')
      .execute()
  }

  async findAll(): Promise<StoredAppModel[]> {
    const db = getDb()
    return db.selectFrom('app_models')
      .selectAll()
      .where('status', '=', 'active')
      .orderBy('crawled_at', 'desc')
      .orderBy('id', 'desc')
      .execute()
  }

  async getModelJson(appName: string): Promise<Record<string, unknown> | null> {
    const row = await this.findActive(appName)
    if (!row) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(row.model_json)
    } catch (cause) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.getModelJson] App Model '${appName}' row ${row.id} version '${row.version}' contains malformed model_json.`,
        { cause },
      )
    }

    const validation = validateAppModelObject(parsed)
    if (!validation.valid) {
      throw new AppModelPersistenceError(
        `[AppModelRepository.getModelJson] App Model '${appName}' row ${row.id} version '${row.version}' contains schema-invalid model_json: ${validation.errors.join('; ')}`,
      )
    }
    return parsed as Record<string, unknown>
  }
}
