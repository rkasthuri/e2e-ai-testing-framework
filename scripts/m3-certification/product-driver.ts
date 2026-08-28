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

import { ManualPromotionCertificationFault } from '../../src/core/storage/certification/ManualTestCertificationPersistenceAdapter'
import {
  CONTROLLED_PROMOTION_FAULT_CODE,
  cloneValue,
  type AnalyzeRequest,
  type AnalyzeResult,
  type CertificationPersistenceInventory,
  type CertificationSaveFailureObservation,
  type DefinitionAuthority,
  type DefinitionObservation,
  type DefinitionPresentation,
  type M2Candidate,
  type M3CertificationDriver,
  type ManualPromotionResultV1,
  type ResultsObservation,
  type SaveResult,
} from './driver'

export type ProductControllerSaveObservation =
  | { kind: 'completed'; result: SaveResult }
  | {
      kind: 'controller_failure'
      publicStatus: number
      publicCode: string | null
      observedCause: unknown | null
    }

export interface ProductM3ObservationPort {
  configureCertificationScenario(scenario: string | null): Promise<void>
  snapshot(projectId: string): Promise<CertificationPersistenceInventory>
  armPromotionFaultOnce(): Promise<void>
  disarmPromotionFault(): Promise<void>
  analyzeManualTest(request: AnalyzeRequest): Promise<AnalyzeResult>
  readManualSource(projectId: string, sourceId: string): Promise<import('./driver').ManualTestSourceV1 | null>
  saveReviewedProposal(request: unknown): Promise<ProductControllerSaveObservation>
  readDefinition(projectId: string, definitionId: string): Promise<DefinitionObservation | null>
  readManualPromotion(projectId: string, definitionAuthority: DefinitionAuthority): Promise<ManualPromotionResultV1 | null>
  readDefinitionPresentation(projectId: string, definitionId: string): Promise<DefinitionPresentation | null>
  addDefinitionToSuite(projectId: string, definitionAuthority: DefinitionAuthority): Promise<M2Candidate | null>
  startExecution(projectId: string, definitionAuthority: DefinitionAuthority): Promise<{ kind: 'accepted'; executionId: string } | { kind: 'refused' }>
  readResults(projectId: string, executionId: string): Promise<ResultsObservation | null>
}

class ObservedProductControllerSaveFailure extends Error {
  constructor(readonly observation: Extract<ProductControllerSaveObservation, { kind: 'controller_failure' }>) {
    super(`Product controller Save failed with HTTP ${observation.publicStatus}.`)
    this.name = 'ObservedProductControllerSaveFailure'
  }
}

/** Certification-owned adapter over actual Product controller and persistence observations. */
export class ProductM3CertificationDriver implements M3CertificationDriver {
  readonly name = 'm3-product-observation-driver'
  readonly authorityClass = 'product' as const

  constructor(private readonly product: ProductM3ObservationPort) {}

  configureCertificationScenario(scenario: string | null): Promise<void> {
    return this.product.configureCertificationScenario(scenario)
  }

  async snapshot(projectId: string): Promise<CertificationPersistenceInventory> {
    return cloneValue(await this.product.snapshot(projectId))
  }

  armPromotionFaultOnce(): Promise<void> {
    return this.product.armPromotionFaultOnce()
  }

  disarmPromotionFault(): Promise<void> {
    return this.product.disarmPromotionFault()
  }

  async classifySaveFailure(error: unknown): Promise<CertificationSaveFailureObservation> {
    if (error instanceof ObservedProductControllerSaveFailure) {
      const { publicStatus, publicCode, observedCause } = error.observation
      if (publicStatus === 500
        && publicCode === 'INTERNAL_ERROR'
        && observedCause instanceof ManualPromotionCertificationFault) {
        return { kind: 'internal', code: CONTROLLED_PROMOTION_FAULT_CODE }
      }
      if (publicStatus === 409 || publicStatus === 422) {
        return { kind: 'save_failure', status: publicStatus, ...(publicCode ? { code: publicCode } : {}) }
      }
      if (publicStatus >= 400 && publicStatus < 500) {
        return { kind: 'transport', status: publicStatus, ...(publicCode ? { code: publicCode } : {}) }
      }
      return {
        kind: 'unexpected',
        status: publicStatus,
        ...(publicCode ? { code: publicCode } : {}),
        ...(observedCause instanceof Error
          ? { name: observedCause.name, message: observedCause.message }
          : {}),
      }
    }
    if (error instanceof Error) return { kind: 'unexpected', name: error.name, message: error.message }
    return { kind: 'unexpected', message: String(error) }
  }

  async analyzeManualTest(request: AnalyzeRequest): Promise<AnalyzeResult> {
    return cloneValue(await this.product.analyzeManualTest(cloneValue(request)))
  }

  async readManualSource(projectId: string, sourceId: string): Promise<import('./driver').ManualTestSourceV1 | null> {
    return cloneValue(await this.product.readManualSource(projectId, sourceId))
  }

  async saveReviewedProposal(request: unknown): Promise<SaveResult> {
    const observed = await this.product.saveReviewedProposal(cloneValue(request))
    if (observed.kind === 'controller_failure') throw new ObservedProductControllerSaveFailure(observed)
    return cloneValue(observed.result)
  }

  async readDefinition(projectId: string, definitionId: string): Promise<DefinitionObservation | null> {
    return cloneValue(await this.product.readDefinition(projectId, definitionId))
  }

  async readManualPromotion(projectId: string, authority: DefinitionAuthority): Promise<ManualPromotionResultV1 | null> {
    return cloneValue(await this.product.readManualPromotion(projectId, cloneValue(authority)))
  }

  async readDefinitionPresentation(projectId: string, definitionId: string): Promise<DefinitionPresentation | null> {
    return cloneValue(await this.product.readDefinitionPresentation(projectId, definitionId))
  }

  async addDefinitionToSuite(projectId: string, authority: DefinitionAuthority): Promise<M2Candidate | null> {
    return cloneValue(await this.product.addDefinitionToSuite(projectId, cloneValue(authority)))
  }

  async startExecution(projectId: string, authority: DefinitionAuthority): Promise<{ kind: 'accepted'; executionId: string } | { kind: 'refused' }> {
    return cloneValue(await this.product.startExecution(projectId, cloneValue(authority)))
  }

  async readResults(projectId: string, executionId: string): Promise<ResultsObservation | null> {
    return cloneValue(await this.product.readResults(projectId, executionId))
  }
}
