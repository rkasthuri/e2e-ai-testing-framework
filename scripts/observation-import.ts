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

import * as path from 'path'
import { closeDb } from '../src/core/storage/db'
import { openProjectDatabase } from '../src/core/storage/DatabaseFactory'
import { ObservationImportService } from '../src/core/observation/ObservationImportService'
import { WorkspaceManager } from '../src/core/workspace/WorkspaceManager'

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null
}

async function main(): Promise<void> {
  const projectId = argument('--project')
  const workspaceInput = argument('--workspace')
  const importRequested = process.argv.includes('--import')
  if (!projectId || !workspaceInput || (importRequested && process.argv.includes('--dry-run'))) {
    throw new Error('Usage: tsx scripts/observation-import.ts --project <id> --workspace <path> [--dry-run|--import]')
  }
  const workspace = new WorkspaceManager(path.resolve(workspaceInput))
  await openProjectDatabase(workspace)
  try {
    const service = new ObservationImportService(projectId, workspace.root)
    const report = importRequested ? await service.import() : await service.dryRun()
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } finally {
    await closeDb()
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
