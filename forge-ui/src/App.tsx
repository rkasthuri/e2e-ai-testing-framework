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

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './api/queryClient'
import { AuthProvider } from './contexts/AuthContext'
import { TenantProvider } from './contexts/TenantContext'
import { AppShell } from './components/layout/AppShell'
import { OnboardPage } from './pages/OnboardPage'
import { CrawlPage } from './pages/CrawlPage'
import { TestCasesPage } from './pages/TestCasesPage'
import { RunPage } from './pages/RunPage'
import { ResultsPage } from './pages/ResultsPage'
import { InsightsPage } from './pages/InsightsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TruthBoardPage } from './pages/TruthBoardPage'
import { ApplicationWorkspacePage } from './pages/ApplicationWorkspacePage'
import { ApplicationObservationsPage } from './pages/ApplicationObservationsPage'
import { ApplicationModelPage } from './pages/ApplicationModelPage'
import { ApplicationEvidencePage } from './pages/ApplicationEvidencePage'
import { ApplicationReadinessPage } from './pages/ApplicationReadinessPage'

// Dark mode is the default (index.html sets class="dark"); never overridden.
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TenantProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/onboard" replace />} />
              <Route path="/onboard" element={<OnboardPage />} />
              <Route path="/crawl" element={<CrawlPage />} />
              <Route path="/tests" element={<TestCasesPage />} />
              <Route path="/run" element={<RunPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/truth-board" element={<TruthBoardPage />} />
              <Route path="/application" element={<ApplicationWorkspacePage />} />
              <Route path="/application/:tab" element={<ApplicationWorkspacePage />} />
              <Route path="/application/observations" element={<ApplicationObservationsPage />} />
              <Route path="/application/model" element={<ApplicationModelPage />} />
              <Route path="/application/evidence" element={<ApplicationEvidencePage />} />
              <Route path="/application/readiness" element={<ApplicationReadinessPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TenantProvider>
    </AuthProvider>
    </QueryClientProvider>
  )
}
