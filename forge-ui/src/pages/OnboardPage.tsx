/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Search, CheckCircle2, ArrowRight } from 'lucide-react'
import { useOnboard, useValidateUrl, useProject } from '../hooks/useApi'
import { apiClient, ApiError } from '../api/client'
import { deriveAppName } from '../lib/deriveAppName'
import { ConfidenceBadge } from '../components/shared/ConfidenceBadge'
import type { DetectionField, Detection } from '../api/types'

type OnboardPhase =
  | 'idle' | 'checking-url' | 'detection-succeeded' | 'invalid-url'
  | 'target-unreachable' | 'authentication-failed' | 'backend-unavailable'
  | 'backend-error' | 'dry-run-preview' | 'project-saved'

function phaseForError(error: unknown, stage: 'validate' | 'onboard'): OnboardPhase {
  if (error instanceof ApiError && error.code === 'BACKEND_UNAVAILABLE') return 'backend-unavailable'
  const message = error instanceof Error ? error.message : String(error)
  if (/credential|authentication|authType|login/i.test(message)) return 'authentication-failed'
  if (stage === 'validate' && /reach|unreachable|cannot connect/i.test(message)) return 'target-unreachable'
  if (error instanceof ApiError && error.status === 400 && /url|invalid/i.test(message)) return 'invalid-url'
  return 'backend-error'
}

const phaseLabel: Record<OnboardPhase, string> = {
  idle: 'Ready', 'checking-url': 'Checking URL', 'detection-succeeded': 'Detection succeeded',
  'invalid-url': 'Invalid URL', 'target-unreachable': 'Target unreachable',
  'authentication-failed': 'Authentication failed', 'backend-unavailable': 'Backend unavailable',
  'backend-error': 'Backend error', 'dry-run-preview': 'Dry-run preview', 'project-saved': 'Project saved',
}

// PLATFORM row — appType is a structural fact, not a graded observation (ruling 2026-07-21),
// so it renders as a plain value with NO confidence chip, source, or reason.
function PlatformRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-2">
      <div className="flex items-center justify-between">
        <span className="text-secondary">{label}</span>
        <span className="font-mono text-primary">{value || '—'}</span>
      </div>
    </div>
  )
}

function DetectionRow({ label, field }: { label: string; field: DetectionField }) {
  return (
    <div className="border-b border-border py-2">
      <div className="flex items-center justify-between">
        <span className="text-secondary">{label}</span>
        <span className="flex items-center gap-3">
          <span className="font-mono text-primary">{field.value || '—'}</span>
          {field.source && <span className="text-xs text-muted">{field.source}</span>}
          <ConfidenceBadge confidence={field.confidence} />
        </span>
      </div>
      {/* ADR-020 §6: the reason travels WITH the grade — full text, never truncated,
          tooltipped, or collapsed. A grade shown without its reason is a bare assertion. */}
      {field.reason && <p className="mt-1 text-xs leading-5 text-muted">{field.reason}</p>}
    </div>
  )
}

export function OnboardPage() {
  const navigate = useNavigate()
  const onboard = useOnboard()
  const validateUrl = useValidateUrl()

  // Fix #14 — when a saved project is selected in the header, its name arrives
  // as ?project=<name>; load and show that project's stored detection instead.
  const [searchParams] = useSearchParams()
  const selectedProjectName = searchParams.get('project')
  const { data: projectData } = useProject(selectedProjectName)

  const [url, setUrl] = useState('')
  const [appName, setAppName] = useState('')
  const [appNameTouched, setAppNameTouched] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [dryRun, setDryRun] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<OnboardPhase>('idle')
  // TD-UI-011 — client-generated jobId (stable per mount) + polled log lines.
  const [jobId] = useState(() => `job-${Date.now()}`)
  const [logLines, setLogLines] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll the log panel to the newest line.
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [logLines])
  const [savedDetection, setSavedDetection] = useState<Detection | null>(null)

  // Fix #8 — keep the dry-run detection so "Save this project" can persist it
  // without re-running Bootstrap.
  useEffect(() => {
    if (onboard.data?.dryRun && onboard.data.detection) {
      setSavedDetection(onboard.data.detection)
    }
  }, [onboard.data])

  // Fix #18 — selecting a project in the header changes ?project=. A prior
  // onboard result (esp. a dry run) outranks projectData in the panel priority,
  // so reset the mutation + transient state to let the selected project show.
  useEffect(() => {
    if (selectedProjectName) {
      onboard.reset()
      setLogLines([])
      setSavedDetection(null)
      setError(null)
      setPhase('idle')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectName])

  function handleSaveProject() {
    const norm = url.match(/^https?:\/\//) ? url : `https://${url}`
    setError(null)
    setPhase('detection-succeeded')
    onboard.mutate({
      url: norm, appName,
      username: username || undefined, password: password || undefined,
      dryRun: false,
      jobId: `job-${Date.now()}`,
      detectionResult: savedDetection ?? undefined,
    }, {
      onSuccess: () => setPhase('project-saved'),
      onError: err => { setError(err instanceof Error ? err.message : String(err)); setPhase(phaseForError(err, 'onboard')) },
    })
  }

  useEffect(() => {
    if (!onboard.isPending) return
    const iv = setInterval(async () => {
      try {
        const d = await apiClient.get<{ lines: string[]; complete: boolean }>(
          `/api/v1/projects/${jobId}/logs`,
        )
        setLogLines(d.lines)
        if (d.complete) clearInterval(iv)
      } catch { /* ignore transient poll errors */ }
    }, 1000)
    return () => clearInterval(iv)
  }, [onboard.isPending, jobId])

  // FIX #2/#6 — URL change always re-derives appName (empty → reset).
  function handleUrlChange(value: string) {
    setUrl(value)
    setAppNameTouched(false)
    setAppName(value ? deriveAppName(value) : '')
  }

  // FIX #1 — auto-prefix https:// on blur; re-derive if appName untouched.
  function handleUrlBlur() {
    if (url && !url.match(/^https?:\/\//)) {
      const normalized = `https://${url}`
      setUrl(normalized)
      if (!appNameTouched) setAppName(deriveAppName(normalized))
    }
  }

  // Fix #9 — validate format + reachability before onboarding.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Fix #15/#16 — clear stale progress + save state before a new run.
    setLogLines([])
    setSavedDetection(null)
    setError(null)
    setPhase('checking-url')
    const norm = url.match(/^https?:\/\//) ? url : `https://${url}`
    try { new URL(norm) } catch {
      setError('Please enter a valid URL')
      setPhase('invalid-url')
      return
    }
    setIsValidating(true)
    setError(null)
    try {
      const r = await validateUrl.mutateAsync(norm)
      if (!r.reachable) { setError(r.message); setPhase('target-unreachable'); return }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase(phaseForError(err, 'validate'))
      return
    } finally { setIsValidating(false) }
    setPhase('detection-succeeded')
    onboard.mutate({ url: norm, appName, username: username || undefined, password: password || undefined, dryRun, jobId }, {
      onSuccess: result => setPhase(result.dryRun ? 'dry-run-preview' : 'project-saved'),
      onError: err => { setError(err instanceof Error ? err.message : String(err)); setPhase(phaseForError(err, 'onboard')) },
    })
  }

  const result = onboard.data
  // FIX #5 — enabled for any non-empty url + appName (not just a valid URL).
  const isDisabled = !url.trim() || !appName.trim() || onboard.isPending || isValidating
  const inputCls =
    'w-full rounded-md border border-border bg-elevated px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-brand focus:outline-none'

  return (
    <div className="h-full p-6">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-6 lg:grid-cols-2">

        {/* LEFT — Form card */}
        <div className="rounded-lg border border-border bg-surface p-6">
          <form onSubmit={handleSubmit}>
            <h2 className="text-lg font-semibold text-primary">Connect a New App</h2>
            <p className="mb-4 mt-1 text-sm text-muted">Detect its type, auth, and crawl strategy.</p>

            <label className="mb-1 block text-sm text-secondary">App URL *</label>
            <input className={inputCls} placeholder="https://..." value={url} onChange={e => handleUrlChange(e.target.value)} onBlur={handleUrlBlur} />

            <label className="mb-1 mt-4 block text-sm text-secondary">App Name *</label>
            <input
              className={inputCls}
              placeholder="my-app"
              value={appName}
              onChange={e => { setAppName(e.target.value); setAppNameTouched(true) }}
            />
            <p className="mt-1 text-xs text-muted">Auto-derived from the URL if left blank.</p>

            <div className="mt-4 rounded-md border border-border p-3">
              <div className="mb-2 text-sm text-secondary">Credentials (optional)</div>
              <input className={`${inputCls} mb-2`} placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
              <input className={inputCls} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
              Dry run (preview only — don&apos;t save the project)
            </label>

            <button
              type="submit"
              disabled={isDisabled}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--brand-primary)' }}
            >
              {onboard.isPending
                ? (<><Loader2 size={16} className="animate-spin" /> Detecting…</>)
                : (<><Search size={16} /> Detect &amp; Onboard</>)}
            </button>

            {isValidating && (
              <p className="mt-2 text-sm text-secondary">⏳ Checking URL…</p>
            )}
            <p className="mt-2 text-xs text-muted" data-testid="onboard-phase">State: {phaseLabel[phase]}</p>
            {onboard.isPending && (
              <p className="mt-3 text-xs text-muted">
                This runs a full bootstrap + crawl — it can take 1–3 minutes.
              </p>
            )}
            {(error || onboard.isError) && (
              <div className="mt-3 rounded border border-fail/40 bg-elevated p-3 text-sm text-fail" role="alert">
                <p className="font-semibold">{phaseLabel[phase]}</p>
                <p className="mt-1">{error ?? (onboard.error as Error).message}</p>
                {(phase === 'backend-unavailable' || phase === 'backend-error') && <p className="mt-2 text-xs text-secondary">Start the FORGE control plane with <code>forge ui</code>, then retry.</p>}
                {phase === 'authentication-failed' && <p className="mt-2 text-xs text-secondary">Verify the supplied credentials and that the target login flow is reachable.</p>}
              </div>
            )}
          </form>
        </div>

        {/* RIGHT — Results or watermark placeholder */}
        <div className="relative flex min-h-[400px] flex-col overflow-hidden rounded-lg border border-border bg-surface p-6">
          {/* Logo watermark — always present, sits behind the content */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <img src="/forge-logo.png" alt="" aria-hidden="true" className="h-64 w-64 object-contain opacity-10" />
          </div>

          <div className="relative z-10 flex-1">
            {onboard.isPending ? (
              /* Fix #15/#16 — a detection in progress ALWAYS wins: show the live
                 log over any prior results or selected-project view. */
              <div ref={logRef} className="mt-4 h-[300px] flex-shrink-0 overflow-y-auto rounded border border-border bg-canvas p-3 font-mono text-xs text-secondary">
                <p className="mb-2 font-sans text-xs font-medium not-italic text-brand">Live progress</p>
                {logLines.length === 0 ? (
                  <p className="animate-pulse text-muted">Starting…</p>
                ) : logLines.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all leading-5">{l}</div>
                ))}
                <span className="animate-pulse text-brand">▊</span>
              </div>
            ) : result ? (
              <>
                <h2 className="text-lg font-semibold text-primary">Detection Results</h2>
                <div className="mt-3">
                  <PlatformRow label="App Type"  value={result.detection.appType} />
                  {result.detection.renderingModel && <DetectionRow label="Rendering"  field={result.detection.renderingModel} />}
                  <DetectionRow label="Auth Type" field={result.detection.authType} />
                  <DetectionRow label="Strategy"  field={result.detection.crawlStrategy} />
                  <DetectionRow label="App Name"  field={result.detection.appName} />
                </div>

                {!result.dryRun ? (
                  <div className="mt-5">
                    <div className="flex items-center gap-2 text-sm text-pass">
                      <CheckCircle2 size={16} /> Project created — ready to crawl.
                    </div>
                    <button
                      onClick={() => navigate(`/crawl?project=${result.project.appName}`)}
                      className="mt-3 flex items-center gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-sm text-primary hover:bg-hover"
                    >
                      Go to Crawl tab <ArrowRight size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="mb-2 text-sm text-secondary">Dry run — nothing was saved.</p>
                    {savedDetection && (
                      <button
                        onClick={handleSaveProject}
                        className="rounded px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                        style={{ background: 'var(--brand-primary)' }}
                      >
                        💾 Save this project
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : projectData ? (
              /* Fix #14 — saved project selected from the header dropdown. */
              <div className="space-y-4">
                <h3 className="font-medium text-primary">{projectData.project.appName}</h3>
                <p className="text-sm text-secondary">Already connected.</p>
                <div>
                  <PlatformRow label="App Type"  value={projectData.detection.appType} />
                  {projectData.detection.renderingModel && <DetectionRow label="Rendering"  field={projectData.detection.renderingModel} />}
                  <DetectionRow label="Auth Type" field={projectData.detection.authType} />
                  <DetectionRow label="Strategy"  field={projectData.detection.crawlStrategy} />
                </div>
                <div className="border-t border-border pt-4">
                  <button
                    onClick={() => navigate(`/crawl?project=${projectData.project.appName}`)}
                    className="rounded bg-brand px-4 py-2 text-sm font-medium text-inverse"
                  >
                    Go to Crawl tab →
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted">
                <p>Detection results will appear here</p>
                <p className="text-xs opacity-60">Enter your app URL and click Detect &amp; Onboard</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
