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

import type { AppModelCandidate } from '../onboarding/types'
import type {
  InvalidActiveRecoveryCrawlOptions,
  InvalidActiveRecoveryRequest,
} from './AppModelRecoveryContract'
import {
  AppModelCommitProjectionResult,
  AppModelProjector,
  AppModelService,
} from './AppModelService'
export {
  InvalidAppModelCandidateError as InvalidActiveRecoveryCandidateError,
} from './repositories/AppModelRepository'

export type InvalidActiveRecoveryCrawler = (
  options: InvalidActiveRecoveryCrawlOptions,
) => Promise<AppModelCandidate>

/**
 * Operator-only orchestration for replacing one explicitly acknowledged,
 * schema-invalid active row. It never reads model_json and has no general
 * repair surface: inspection and commit both bind the same row fingerprint.
 */
export class AppModelRecoveryOrchestrator {
  constructor(private readonly appModels = new AppModelService()) {}

  async recover(
    request: InvalidActiveRecoveryRequest,
    crawlFresh: InvalidActiveRecoveryCrawler,
    project: AppModelProjector,
  ): Promise<AppModelCommitProjectionResult> {
    // A completed operation is resolved before inspection or another crawl.
    // Repository provenance checks prevent an unrelated operation from replaying.
    const replay = await this.appModels.replayCommittedRecoveryOperation(
      request,
      project,
    )
    if (replay) return replay

    await this.appModels.inspectInvalidActiveForRecovery(request)

    // The callback shape makes the absence of prior state explicit and testable.
    // Invalid stored JSON is never loaded or passed into the crawler.
    const candidate = await crawlFresh({ previousModel: null })
    // Canonical materialization, validation, hashing, and persistence are one
    // repository-owned boundary. The orchestrator must not validate a different
    // representation first.
    return this.appModels.commitRecoveryAndProject(candidate, request, project)
  }
}
