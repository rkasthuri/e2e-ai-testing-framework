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

import { Outlet } from 'react-router-dom'
import { Header } from './Header'

/**
 * AppShell — fixed header (48px), main content fills the middle, status bar at
 * the bottom (FORGE version + DB status). Routed pages render in <Outlet/>.
 */
export function AppShell() {
  return (
    <div className="flex h-screen w-full min-w-0 max-w-full flex-col overflow-hidden bg-canvas text-primary">
      <Header />
      <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        <Outlet />
      </main>
      <footer className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 border-t border-border bg-surface px-4 py-1 text-[11px] text-muted sm:h-6 sm:flex-nowrap sm:py-0">
        <span>FORGE™ — Local evidence-first quality engineering</span>
        <span>DB: local</span>
      </footer>
    </div>
  )
}
