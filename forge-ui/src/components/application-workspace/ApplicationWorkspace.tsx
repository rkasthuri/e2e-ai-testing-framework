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

import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useCurrentProject } from '../../hooks/useCurrentProject'
import { buildProjectRoute } from '../../utils/buildProjectRoute'

const WORKSPACE_TABS = [
  { slug: 'overview', label: 'Overview', available: true },
  { slug: 'observations', label: 'Observations', available: true },
  { slug: 'model', label: 'Application Model', available: true },
  { slug: 'evidence', label: 'Evidence', available: true },
] as const

export function ApplicationWorkspace({ children }: { children?: React.ReactNode }) {
  const project = useCurrentProject()
  const location = useLocation()
  return (
    <div className="mx-auto max-w-7xl space-y-5" data-testid="application-workspace">
      <header className="border-b border-border pb-4"><p className="text-xs uppercase tracking-[0.2em] text-brand">Application workspace</p><div className="mt-1 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold text-primary">{project ?? 'No application selected'}</h1><p className="mt-1 text-sm text-secondary">One application understanding, assembled from evidence across FORGE capabilities.</p></div><span className="text-xs text-muted">{project ? 'Selected application' : 'Select an application to begin'}</span></div></header>
      <nav aria-label="Application workspace tabs" className="flex flex-wrap gap-1">
        {WORKSPACE_TABS.map(tab => {
          const to = buildProjectRoute(`/application/${tab.slug}`, project)
          return tab.available ? <NavLink key={tab.slug} to={to} className={({ isActive }) => `rounded px-3 py-2 text-sm ${isActive || location.pathname.endsWith(`/${tab.slug}`) ? 'bg-selected text-primary' : 'text-secondary hover:bg-hover hover:text-primary'}`}>{tab.label}</NavLink> : <span key={tab.slug} className="cursor-not-allowed rounded px-3 py-2 text-sm text-muted" title="Not yet observed">{tab.label} <span className="text-[10px]">(planned)</span></span>
        })}
      </nav>
      {children ?? <Outlet />}
    </div>
  )
}
