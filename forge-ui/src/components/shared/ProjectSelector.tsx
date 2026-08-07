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

/**
 * ProjectSelector — the "no project selected" picker shared by tabs that key off
 * `?project=`. Lists CONNECTED projects (real workspace, not fixture fallbacks)
 * and navigates to `${basePath}?project=<appName>`. Extracted from CrawlPage's
 * inline picker so the Crawl and Test Cases tabs share ONE implementation (no fork).
 */
import { useNavigate } from 'react-router-dom'
import { useProjects } from '../../hooks/useApi'

export function ProjectSelector({ title, subtitle, basePath }: {
  title: string
  subtitle: string
  basePath: string   // e.g. '/crawl' or '/tests'
}) {
  const navigate = useNavigate()
  const { data } = useProjects()
  const connected = (data?.projects ?? []).filter(p => p.workspacePath)

  return (
    <div className="mx-auto max-w-md p-6">
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      <div className="mt-4 space-y-1">
        {connected.length === 0 && (
          <p className="text-sm text-muted">No connected projects yet — onboard one first.</p>
        )}
        {connected.map(p => (
          <button
            key={p.appName}
            onClick={() => navigate(`${basePath}?project=${p.appName}`)}
            className="block w-full rounded-md border border-border bg-elevated px-3 py-2 text-left text-sm text-primary hover:bg-hover"
          >
            {p.appName}
          </button>
        ))}
      </div>
    </div>
  )
}
