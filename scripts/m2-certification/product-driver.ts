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

import {
  cloneValue,
  type CandidateDefinition,
  type CanonicalTestSetFixture,
  type ExecutionObservation,
  type M2CertificationDriver,
  type MutationResult,
  type ResultsObservation,
  type SavedSuite,
  type StartResult,
  type SuiteIntegrityFault,
  type SuitePreflight,
  type SuiteReadResult,
  type SuiteSelection,
} from './driver'

const SHA256 = /^[a-f0-9]{64}$/

/**
 * Product-owned observation port. Implementations drive real Core services,
 * persistence, execution, and Results reads. The certification adapter neither
 * mints nor recomputes Product hashes and never renumbers Product members.
 */
export interface ProductM2ObservationPort {
  persistCanonicalTestSet(testSet: CanonicalTestSetFixture): Promise<void>
  injectSuiteIntegrityFault(projectId: string, suiteId: string, suiteRevision: number, fault: SuiteIntegrityFault): Promise<void>
  listCandidates(projectId: string): Promise<CandidateDefinition[]>
  listSuites(projectId: string): Promise<SavedSuite[]>
  createSuite(request: unknown): Promise<MutationResult>
  readSuite(projectId: string, suiteId: string, suiteRevision: number): Promise<SuiteReadResult>
  reviseSuite(request: unknown): Promise<MutationResult>
  preflightSuite(projectId: string, selection: SuiteSelection): Promise<SuitePreflight>
  startSuiteExecution(projectId: string, request: unknown): Promise<StartResult>
  readExecution(projectId: string, executionId: string): Promise<ExecutionObservation | null>
  readResults(projectId: string, executionId: string): Promise<ResultsObservation | null>
}

function observeSuite(value: SavedSuite): SavedSuite {
  if (!SHA256.test(value.contentHash)
    || value.members.some((member, index) => member.ordinal !== index + 1)) {
    throw new Error('Observed Product Suite authority is malformed.')
  }
  return cloneValue(value)
}

function observeMutation(value: MutationResult): MutationResult {
  return value.kind === 'accepted'
    ? { kind: 'accepted', suite: observeSuite(value.suite), replayed: value.replayed }
    : cloneValue(value)
}

/** Certification-owned adapter over observed Product boundaries. */
export class ProductM2CertificationDriver implements M2CertificationDriver {
  public readonly name = 'm2-product-observation-driver'
  public readonly authorityClass = 'product' as const

  constructor(private readonly product: ProductM2ObservationPort) {}

  persistCanonicalTestSet(value: CanonicalTestSetFixture): Promise<void> {
    return this.product.persistCanonicalTestSet(cloneValue(value))
  }

  injectSuiteIntegrityFault(projectId: string, suiteId: string, suiteRevision: number, fault: SuiteIntegrityFault): Promise<void> {
    return this.product.injectSuiteIntegrityFault(projectId, suiteId, suiteRevision, fault)
  }

  async listCandidates(projectId: string): Promise<CandidateDefinition[]> {
    return cloneValue(await this.product.listCandidates(projectId))
  }

  async listSuites(projectId: string): Promise<SavedSuite[]> {
    return (await this.product.listSuites(projectId)).map(observeSuite)
  }

  async createSuite(request: unknown): Promise<MutationResult> {
    return observeMutation(await this.product.createSuite(cloneValue(request)))
  }

  async readSuite(projectId: string, suiteId: string, suiteRevision: number): Promise<SuiteReadResult> {
    const value = await this.product.readSuite(projectId, suiteId, suiteRevision)
    return value.kind === 'available' ? { kind: 'available', suite: observeSuite(value.suite) } : cloneValue(value)
  }

  async reviseSuite(request: unknown): Promise<MutationResult> {
    return observeMutation(await this.product.reviseSuite(cloneValue(request)))
  }

  async preflightSuite(projectId: string, selection: SuiteSelection): Promise<SuitePreflight> {
    return cloneValue(await this.product.preflightSuite(projectId, cloneValue(selection)))
  }

  async startSuiteExecution(projectId: string, request: unknown): Promise<StartResult> {
    return cloneValue(await this.product.startSuiteExecution(projectId, cloneValue(request)))
  }

  async readExecution(projectId: string, executionId: string): Promise<ExecutionObservation | null> {
    return cloneValue(await this.product.readExecution(projectId, executionId))
  }

  async readResults(projectId: string, executionId: string): Promise<ResultsObservation | null> {
    return cloneValue(await this.product.readResults(projectId, executionId))
  }
}
