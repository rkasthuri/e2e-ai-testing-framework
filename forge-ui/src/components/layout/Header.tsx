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

import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Check, ChevronDown, Menu, Moon, Plus, Sun, X } from 'lucide-react'
import { useProjects } from '../../hooks/useApi'
import { useCurrentProject } from '../../hooks/useCurrentProject'
import { buildProjectRoute } from '../../utils/buildProjectRoute'
import type { Project } from '../../api/types'

// `scoped` tabs carry the selected project through the `?project=` param so the
// selection survives tab switches (TD-UI-022 follow-up). Onboard is unscoped —
// it's where a project is established, so it stays param-less.
const TABS = [
  { to: '/onboard', label: 'Onboard', scoped: false },
  { to: '/crawl', label: 'Crawl', scoped: true },
  { to: '/tests', label: 'Tests', scoped: true },
  { to: '/run', label: 'Run', scoped: true },
  { to: '/results', label: 'Results', scoped: true },
  { to: '/application/overview', label: 'Application', scoped: true },
]

/** Header: logo · tab nav · project switcher · theme toggle. Height 48px. */
export function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data } = useProjects()   // reactive — invalidated after onboarding
  const projects = data?.projects ?? []
  const currentProject = useCurrentProject()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [light, setLight] = useState(false)
  const navigationButtonRef = useRef<HTMLButtonElement>(null)
  const projectButtonRef = useRef<HTMLButtonElement>(null)

  // Both compact disclosures close on Escape and return focus to the control
  // that opened them. Native buttons retain Enter/Space activation.
  useEffect(() => {
    if (!navigationOpen && !switcherOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (switcherOpen) {
        setSwitcherOpen(false)
        projectButtonRef.current?.focus()
      } else {
        setNavigationOpen(false)
        navigationButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [navigationOpen, switcherOpen])

  useEffect(() => {
    setNavigationOpen(false)
    setSwitcherOpen(false)
  }, [location.pathname, location.search])

  // Switching projects PRESERVES the current tab and re-scopes it to the new
  // project (you switch apps on Crawl → you land on Crawl for the new app), rather
  // than dumping the user on Onboard. Scoped-ness is read from the TABS config
  // (the `scoped` flag), never a hardcoded route list. On an UNSCOPED route (e.g.
  // Onboard) the existing /onboard?project= behaviour is kept — Onboard is where a
  // project's detection is shown.
  function selectProject(p: Project) {
    setSwitcherOpen(false)
    setNavigationOpen(false)
    const currentTab = TABS.find(t => t.to === location.pathname)
    navigate(
      currentTab?.scoped
        ? buildProjectRoute(location.pathname, p.appName)
        : `/onboard?project=${p.appName}`,
    )
  }

  function toggleTheme() {
    const next = !light
    setLight(next)
    document.documentElement.classList.toggle('light', next)
  }

  return (
    <header className="relative z-40 w-full min-w-0 max-w-full border-b border-border bg-surface">
      <div className="flex h-12 w-full min-w-0 items-center gap-2 px-3 sm:gap-4 sm:px-4">
        {/* Logo */}
        <div className="flex shrink-0 items-center gap-1 font-semibold" style={{ color: 'var(--brand-primary)' }}>
          <span aria-hidden="true">🔨</span><span>FORGE™</span>
        </div>

        {/* Full navigation is retained where its measured width fits. */}
        <nav aria-label="Primary navigation" className="hidden min-w-0 flex-1 items-center gap-1 xl:flex">
          {TABS.map(t => (
            <NavLink
              key={t.to}
              to={t.scoped ? buildProjectRoute(t.to, currentProject) : t.to}
              className={({ isActive }) =>
                `border-b-2 px-3 py-3 text-sm outline-none transition-colors focus-visible:rounded focus-visible:ring-2 focus-visible:ring-brand ${
                  isActive
                    ? 'border-brand text-primary'
                    : 'border-transparent text-secondary hover:text-primary'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex min-w-0 shrink items-center gap-2">
          {/* Project selection remains available at every breakpoint. */}
          <div className="relative min-w-0">
            <button
              ref={projectButtonRef}
              type="button"
              aria-expanded={switcherOpen}
              aria-controls="header-project-options"
              aria-haspopup="true"
              aria-label={`Select project. Current project: ${currentProject ?? 'none'}`}
              onClick={() => { setSwitcherOpen(open => !open); setNavigationOpen(false) }}
              className="flex max-w-[8.5rem] items-center gap-1 rounded-md border border-border bg-elevated px-2 py-1.5 text-sm text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand sm:max-w-[12rem] sm:gap-2 sm:px-3"
            >
              <span className="truncate">{currentProject ?? 'No project'}</span>
              <ChevronDown size={14} className="shrink-0" />
            </button>
            {switcherOpen && (
              <div id="header-project-options" aria-label="Project options" className="absolute right-0 z-50 mt-1 w-[min(14rem,calc(100vw-1.5rem))] rounded-md border border-border bg-elevated py-1 shadow-lg">
                {projects.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted">No projects yet</div>
                )}
                {projects.map(p => (
                  <button
                    key={p.appName}
                    type="button"
                    disabled={!p.workspacePath}
                    onClick={() => (p.workspacePath ? selectProject(p) : null)}
                    className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                      p.workspacePath
                        ? 'cursor-pointer text-primary hover:bg-hover'
                        : 'cursor-not-allowed text-muted opacity-40'
                    } ${p.appName === currentProject ? 'bg-hover' : ''}`}
                  >
                    <span className="truncate">
                      {p.appName}
                      {!p.workspacePath && (
                        <span className="ml-2 text-xs text-muted">(not yet crawled)</span>
                      )}
                    </span>
                    {p.appName === currentProject && <Check size={14} className="shrink-0 text-brand" />}
                  </button>
                ))}
                <NavLink
                  to="/onboard"
                  onClick={() => setSwitcherOpen(false)}
                  className="flex items-center gap-2 border-t border-border px-3 py-2 text-sm text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Plus size={14} /> Add new project
                </NavLink>
              </div>
            )}
          </div>

          <button type="button" onClick={toggleTheme} aria-label="Toggle theme" className="shrink-0 rounded p-1.5 text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-brand" title="Toggle theme">
            {light ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button
            ref={navigationButtonRef}
            type="button"
            aria-label={navigationOpen ? 'Close primary navigation' : 'Open primary navigation'}
            aria-expanded={navigationOpen}
            aria-controls="compact-primary-navigation"
            onClick={() => { setNavigationOpen(open => !open); setSwitcherOpen(false) }}
            className="shrink-0 rounded border border-border p-1.5 text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand xl:hidden"
          >
            {navigationOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {navigationOpen && (
        <nav id="compact-primary-navigation" aria-label="Compact primary navigation" className="grid w-full grid-cols-2 gap-1 border-t border-border p-3 sm:grid-cols-3 xl:hidden">
          {TABS.map(t => (
            <NavLink
              key={t.to}
              to={t.scoped ? buildProjectRoute(t.to, currentProject) : t.to}
              onClick={() => setNavigationOpen(false)}
              className={({ isActive }) => `rounded px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand ${isActive ? 'bg-hover font-medium text-primary' : 'text-secondary hover:bg-hover hover:text-primary'}`}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}
