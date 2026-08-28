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

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { m3ManualTestAdapter } from '../api/m3ManualTestAdapter'
import {
  M3ManualContractError,
  decodeManualPromotionResultV1,
  type M3ManualAnalysisReceipt,
  type M3ManualDraft,
  type M3ManualTestAdapter,
  type ManualPromotionRequestV1,
} from '../api/m3ManualTestContract'

function sameAuthority(
  left: { sourceId: string; sourceContentHash: string },
  right: { sourceId: string; sourceContentHash: string },
): boolean {
  return left.sourceId === right.sourceId && left.sourceContentHash === right.sourceContentHash
}

export function verifyM3AnalysisReceipt(projectId: string, receipt: M3ManualAnalysisReceipt): M3ManualAnalysisReceipt {
  const outcome = receipt.analysis.outcome.kind === 'proposal'
    ? receipt.analysis.outcome.proposal
    : receipt.analysis.outcome.refusal
  const admittedAuthority = { sourceId: receipt.source.sourceId, sourceContentHash: receipt.source.contentHash }
  if (receipt.source.projectId !== projectId || outcome.projectId !== projectId
    || !sameAuthority(admittedAuthority, outcome.sourceAuthority)
    || outcome.sourceGrounding.length !== receipt.source.steps.length + 1) {
    throw new M3ManualContractError('Analyze returned authority for a different project or source.')
  }
  return receipt
}

export function useM3AnalyzeManualTest(adapter: M3ManualTestAdapter = m3ManualTestAdapter) {
  return useMutation({
    mutationFn: async ({ projectId, draft }: { projectId: string; draft: M3ManualDraft }) =>
      verifyM3AnalysisReceipt(projectId, await adapter.analyze(projectId, draft)),
  })
}

export function useM3PromoteManualTest(adapter: M3ManualTestAdapter = m3ManualTestAdapter) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, request }: { projectId: string; request: ManualPromotionRequestV1 }) => {
      const result = decodeManualPromotionResultV1(await adapter.promote(projectId, request))
      if (!sameAuthority(result.sourceAuthority, request.sourceAuthority)
        || result.proposalAuthority.proposalId !== request.reviewedProposalAuthority.proposalId
        || result.proposalAuthority.proposalContentHash !== request.reviewedProposalAuthority.proposalContentHash) {
        throw new M3ManualContractError('Promotion returned authority that does not match the reviewed source and proposal.')
      }
      return result
    },
    onSuccess: (_result, { projectId }) => queryClient.invalidateQueries({ queryKey: ['evidence-backed-tests', projectId] }),
  })
}
