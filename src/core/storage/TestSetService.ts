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

import * as crypto from 'crypto'
import { runMigrations } from './migrate'
import { assertProductDatabaseAuthority } from './db'
import { TestDefinitionContractError, type TestDesignAuthorityInput } from '../test-design/TestDefinitionContract'
import { DuplicateTestGenerationError, TestSetRepository } from './repositories/TestSetRepository'

const PROCESS_INSTANCE_ID = crypto.randomUUID()

export class TestSetService {
  constructor(private readonly repository = new TestSetRepository(), private readonly now = () => new Date().toISOString()) {}

  readInventory(projectId: string, options: { limit?: number; cursor?: string | null; definitionId?: string | null } = {}) {
    return this.repository.readInventory(projectId, options)
  }

  readGenerationStatus(projectId: string, generationId: string) {
    return this.repository.readGenerationStatus(projectId, generationId, PROCESS_INSTANCE_ID)
  }

  async generate(input: TestDesignAuthorityInput, generationId = crypto.randomUUID()) {
    assertProductDatabaseAuthority()
    await runMigrations()
    // The service owns the durable lifecycle clock. Using a controller-prepared
    // timestamp here could make completion precede the started event while a
    // migration or lock acquisition runs between those boundaries.
    const startedAt = this.now()
    const timedInput = { ...input, generatedAt: startedAt }
    await this.repository.beginGeneration(input.projectId, generationId, PROCESS_INSTANCE_ID, startedAt)
    try {
      return await this.repository.commitGeneration(timedInput, generationId, PROCESS_INSTANCE_ID)
    } catch (cause) {
      const code = cause instanceof TestDefinitionContractError ? cause.code
        : cause instanceof DuplicateTestGenerationError ? 'DUPLICATE_GENERATION'
          : 'PERSISTENCE_FAILED'
      const message = cause instanceof TestDefinitionContractError
        ? cause.message
        : 'Evidence-backed test generation failed before a revision was committed.'
      await this.repository.failGeneration(input.projectId, generationId, PROCESS_INSTANCE_ID, this.now(), code, message)
      throw cause
    }
  }
}

export const testSetService = new TestSetService()
