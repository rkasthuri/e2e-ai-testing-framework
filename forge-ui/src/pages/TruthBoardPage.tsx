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

import { useCurrentProject } from '../hooks/useCurrentProject'

/**
 * The presentation component is ready for the TD-UI-062C adapter. This page
 * intentionally does not synthesize a read model from legacy API fields.
 */
export function TruthBoardPage() {
  const project = useCurrentProject()
  return (
    <div className="mx-auto max-w-4xl py-12 text-center">
      <h1 className="text-2xl font-semibold text-primary">Truth Board</h1>
      <p className="mx-auto mt-3 max-w-xl text-sm text-secondary">
        {project ? 'The Truth Board presentation is ready for its read-model adapter.' : 'Select a project to view its evidence-grounded Truth Board.'}
      </p>
    </div>
  )
}
