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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { m1TestIntentAdapter } from '../api/m1TestIntentAdapter'
import { decodeCanonicalDefinitionSaveResultV3, type M1TestIntentAdapter, type SupportedNormalizedTestIntentV1 } from '../api/m1TestIntentContract'

export function useM1DiscoveredAppAreas(projectId: string | null, adapter: M1TestIntentAdapter = m1TestIntentAdapter) {
  return useQuery({
    queryKey: ['m1-discovered-app-areas', adapter.mode, projectId],
    queryFn: () => adapter.listDiscoveredAreas(projectId!),
    enabled: !!projectId,
    retry: false,
  })
}

export function useM1GenerateIntent(adapter: M1TestIntentAdapter = m1TestIntentAdapter) {
  return useMutation({ mutationFn: ({ projectId, appArea }: { projectId: string; appArea: string }) => adapter.generate(projectId, appArea) })
}

export function useM1SaveIntent(adapter: M1TestIntentAdapter = m1TestIntentAdapter) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, intent }: { projectId: string; intent: SupportedNormalizedTestIntentV1 }) => decodeCanonicalDefinitionSaveResultV3(await adapter.save(projectId, intent)),
    onSuccess: (_result, { projectId }) => queryClient.invalidateQueries({ queryKey: ['evidence-backed-tests', projectId] }),
  })
}
