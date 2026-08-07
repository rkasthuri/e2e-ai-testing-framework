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
 * TestCasesPage (TD-UI-003 Block 5b) — the Test Cases tab shell + file tree.
 *
 * Four states: no project selected, no manifest (empty), generating (live log),
 * generated (file tree + placeholder viewer). Monaco viewer, Generation Summary,
 * and the AI-Intent note land in later blocks — the viewer pane is a placeholder.
 *
 * Honesty discipline (Nova/Finn): flow confidence maps observed→High, partial→
 * Medium, unknown→UNKNOWN (never "Low" — we do not know). POMs show their module
 * confidence as-is (which DOES have a real 'low'). Files with no matching flow/
 * page carry NO badge — we never default to High. Zero/empty cases are shown
 * plainly, never hidden or faked.
 */
import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import {
  Loader2, Play, FileCode2, LayoutTemplate, FlaskConical, Plug, Search, X,
  Copy, Download, ChevronRight, ChevronDown, XCircle,
} from 'lucide-react'
import { useTestManifest, useGenerateTests, useCrawlStatus, useTestFile } from '../hooks/useApi'
import { useQueryClient } from '@tanstack/react-query'
import { ProjectSelector } from '../components/shared/ProjectSelector'
import { MissionTimeline } from '../components/shared/MissionTimeline'
import type { ManifestFile, ManifestFlow, ManifestPage, GenerationManifest } from '../api/types'
import {
  fileConfidence, isReviewItem, splitPath, flowForFile, composeIntentNote, formatDuration,
} from './testCaseHelpers'

function FileTypeIcon({ type }: { type: ManifestFile['type'] }) {
  const size = 14
  if (type === 'spec') return <FileCode2 size={size} className="text-brand" />
  if (type === 'pom') return <LayoutTemplate size={size} className="text-secondary" />
  if (type === 'fixture') return <FlaskConical size={size} className="text-secondary" />
  return <Plug size={size} className="text-secondary" />   // api-client / api-spec
}

/** Trigger a client-side download of the content (no server round-trip). */
function downloadFile(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * CodeViewerPane — read-only Monaco view of one generated file. Fetches by the
 * OPAQUE manifest ID (never a path). Header (name + confidence + copy/download),
 * an evidence-only "Why was this generated?" note for partial/unknown flows, the
 * editor, and a read-only footer. Keyed by file.id in the parent so state resets.
 */
function CodeViewerPane({ appName, file, flows, pages }: {
  appName: string
  file: ManifestFile
  flows: ManifestFlow[]
  pages: ManifestPage[]
}) {
  const { data, isLoading, isError } = useTestFile(appName, file.id)
  const [intentOpen, setIntentOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const name = splitPath(file.relativePath).name
  const conf = fileConfidence(file, flows, pages)
  const flow = flowForFile(file, flows)
  const showIntent = !!flow && (flow.confidence === 'partial' || flow.confidence === 'unknown')

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        <Loader2 size={16} className="mr-2 animate-spin" /> Loading {name}…
      </div>
    )
  }
  // 404 / rejected → clear "not available" state. Never fall back to anything.
  if (isError || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <XCircle size={24} className="text-fail" />
        <p className="mt-2 text-sm text-primary">File not available</p>
        <p className="mt-1 text-xs text-muted">{name} could not be loaded.</p>
      </div>
    )
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(data!.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable — no-op */ }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-primary" title={file.relativePath}>{name}</p>
          {conf && <p className={`text-xs ${conf.cls}`}>● Confidence: {conf.label}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={copy} className="flex items-center gap-1 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-secondary hover:bg-hover">
            <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={() => downloadFile(name, data.content)} className="flex items-center gap-1 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-secondary hover:bg-hover">
            <Download size={12} /> Download
          </button>
        </div>
      </div>

      {/* AI Intent note — evidence only, partial/unknown flows, default collapsed */}
      {showIntent && flow && (
        <div className="border-b border-border bg-elevated px-4 py-2">
          <button onClick={() => setIntentOpen(o => !o)} className="flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary">
            {intentOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Why was this generated?
          </button>
          {intentOpen && (
            <p className="mt-2 text-xs leading-5 text-secondary">{composeIntentNote(flow)}</p>
          )}
        </div>
      )}

      {/* Monaco — READ-ONLY viewer (no minimap, no suggestions, not an IDE) */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language="typescript"
          theme="vs-dark"
          value={data.content}
          loading={
            <div className="flex h-full items-center justify-center text-sm text-muted">
              <Loader2 size={16} className="mr-2 animate-spin" /> Loading editor…
            </div>
          }
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            wordBasedSuggestions: 'off',
            parameterHints: { enabled: false },
            hover: { enabled: false },
            contextmenu: false,
            lineNumbers: 'on',
            wordWrap: 'off',
            scrollBeyondLastLine: false,
            fontSize: 12,
            renderLineHighlight: 'none',
          }}
        />
      </div>

      {/* Read-only footer */}
      <div className="border-t border-border px-4 py-2 text-[11px] text-muted">
        Generated by FORGE · read-only · edit in your IDE
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated px-4 py-3">
      <p className="text-2xl font-semibold text-primary">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  )
}

/**
 * GenerationSummary — metric cards + evidence line + metadata. EVERY number comes
 * STRAIGHT from the manifest; nothing is computed, inferred, scored, or graded
 * (TD-066: coarse tiers, never a confidence percentage). Zeros render as zeros —
 * an API app's "0 specs · 0 flows" is correct and must not be hidden or softened.
 */
function GenerationSummary({ manifest, onReviewClick }: {
  manifest: GenerationManifest
  onReviewClick: () => void
}) {
  const reviewCount = manifest.partialFlows + manifest.unknownFlows
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Pages discovered" value={manifest.pages.length} />
        <MetricCard label="Flows detected"   value={manifest.flows.length} />
        <MetricCard label="Specs generated"  value={manifest.specCount} />
        <MetricCard label="Page objects"     value={manifest.pomCount} />
        <MetricCard label="Generation time"  value={formatDuration(manifest.durationMs)} />
      </div>

      {/* Evidence line — the honesty thesis made visible. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-pass">● {manifest.observedFlows} observed</span>
        {reviewCount > 0 && (
          <button onClick={onReviewClick} className="text-flaky hover:underline" title="Filter the tree to review items">
            ● {reviewCount} require review
          </button>
        )}
      </div>

      {/* Metadata — secondary. classificationRunId is the CLASSIFICATION run, NOT
          the crawl run (the crawl run id is not persisted to the model — TD-UI-003).
          Absent → render nothing; never relabel it "crawl run". */}
      <div className="mt-3 border-t border-border pt-2 text-xs text-muted">
        Generated {new Date(manifest.generatedAt).toLocaleString()}
        {manifest.classificationRunId && (
          <> · Classification run: <span className="font-mono">{manifest.classificationRunId}</span></>
        )}
      </div>
    </div>
  )
}

export function TestCasesPage() {
  const [searchParams] = useSearchParams()
  const appName = searchParams.get('project')
  const qc = useQueryClient()

  const manifestQuery = useTestManifest(appName)
  const manifest = manifestQuery.data?.manifest ?? null

  const generate = useGenerateTests()
  const [jobId, setJobId] = useState<string | null>(null)
  const { data: status } = useCrawlStatus(jobId)   // generate jobs use the same JobRunner

  // Local UI state
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [reviewOnly, setReviewOnly] = useState(false)

  // On generation completion, refetch the manifest and leave the generating state.
  useEffect(() => {
    if (jobId && status?.complete && status.status === 'completed') {
      qc.invalidateQueries({ queryKey: ['test-manifest', appName] })
      setJobId(null)
    }
  }, [jobId, status?.complete, status?.status, appName, qc])

  const generating = jobId != null || generate.isPending
  const failed = status?.status === 'failed'

  function startGenerate() {
    if (!appName) return
    setJobId(null)
    generate.mutate(appName, { onSuccess: d => setJobId(d.jobId) })
  }

  // Filtered file list (search + review-only), grouped by directory.
  const groups = useMemo(() => {
    if (!manifest) return [] as Array<{ dir: string; files: ManifestFile[] }>
    const q = query.trim().toLowerCase()
    const filtered = manifest.files.filter(f => {
      if (reviewOnly && !isReviewItem(f, manifest.flows)) return false
      if (q && !splitPath(f.relativePath).name.toLowerCase().includes(q)) return false
      return true
    })
    const byDir = new Map<string, ManifestFile[]>()
    for (const f of filtered) {
      const { dir } = splitPath(f.relativePath)
      if (!byDir.has(dir)) byDir.set(dir, [])
      byDir.get(dir)!.push(f)
    }
    // Root first, then alphabetical.
    return [...byDir.entries()]
      .sort(([a], [b]) => (a === '(root)' ? -1 : b === '(root)' ? 1 : a.localeCompare(b)))
      .map(([dir, files]) => ({ dir, files }))
  }, [manifest, query, reviewOnly])

  // ── State 1: no project selected ──────────────────────────────────────────────
  if (!appName) {
    return (
      <ProjectSelector
        title="Test Cases"
        subtitle="Select a project to view or generate its tests."
        basePath="/tests"
      />
    )
  }

  // ── State 3: generating (job in flight) ───────────────────────────────────────
  if (generating) {
    return (
      <div className="h-full p-6">
        <div className="mx-auto max-w-3xl rounded-lg border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold text-primary">Generating tests — {appName}</h2>
          <div className="mt-2 flex items-center gap-2 text-sm">
            {failed ? (
              <span className="text-fail">Generation failed: {status?.error ?? 'unknown error'}</span>
            ) : (
              <><Loader2 size={14} className="animate-spin text-brand" />
                <span className="text-secondary">Generating…</span></>
            )}
          </div>
          <div className="mt-4">
            <MissionTimeline
              lines={status?.lines ?? []}
              running={!failed}
              placeholder="Starting…"
            />
          </div>
          {failed && (
            <button
              onClick={() => setJobId(null)}
              className="mt-4 rounded-md border border-border bg-elevated px-4 py-2 text-sm text-primary hover:bg-hover"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── State 2: no manifest (404 → empty) or still loading ───────────────────────
  if (manifestQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        <Loader2 size={16} className="mr-2 animate-spin" /> Loading tests…
      </div>
    )
  }
  if (manifestQuery.isError || !manifest) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h2 className="text-lg font-semibold text-primary">No tests yet — {appName}</h2>
        <p className="mt-2 text-sm text-muted">
          FORGE hasn’t generated tests for this project yet. Generation reads the crawled
          model; if the app hasn’t been crawled, generation will tell you to crawl first.
        </p>
        <button
          onClick={startGenerate}
          className="mx-auto mt-4 flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white"
          style={{ background: 'var(--brand-primary)' }}
        >
          <Play size={16} /> Generate tests
        </button>
      </div>
    )
  }

  // ── State 4: generated (manifest present) — file tree + placeholder viewer ────
  const reviewCount = manifest.partialFlows + manifest.unknownFlows   // from the manifest, not a magic number
  const selectedFile = selectedFileId ? manifest.files.find(f => f.id === selectedFileId) ?? null : null

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-hidden">
        {/* Header + actions */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-primary">Test Cases — {appName}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={startGenerate}
              className="flex items-center gap-2 rounded-md border border-border bg-elevated px-3 py-1.5 text-sm text-primary hover:bg-hover"
            >
              <Play size={14} /> Regenerate
            </button>
            <Link
              to={`/run?project=${appName}`}
              className="flex items-center gap-2 rounded-md border border-border bg-elevated px-3 py-1.5 text-sm text-primary hover:bg-hover"
            >
              Proceed to Run →
            </Link>
          </div>
        </div>

        {/* Generation Summary — all values from the manifest */}
        <GenerationSummary manifest={manifest} onReviewClick={() => setReviewOnly(true)} />

        {/* Generation warnings banner — only when there are review items */}
        {reviewCount > 0 && (
          <div className="rounded-md border border-flaky bg-elevated px-4 py-2 text-sm text-flaky">
            ⚠️ {reviewCount} flows require manual review
          </div>
        )}

        {/* Tree + viewer */}
        <div className="flex flex-1 overflow-hidden rounded-lg border border-border bg-surface">
          {/* LEFT — file tree (~220px) */}
          <div className="flex w-[220px] flex-col border-r border-border">
            {/* Search + review filter */}
            <div className="space-y-2 border-b border-border p-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-elevated px-2 py-1">
                <Search size={13} className="text-muted" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Filter files…"
                  className="w-full bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
                />
                {query && (
                  <button onClick={() => setQuery('')} aria-label="Clear filter" className="text-muted hover:text-primary">
                    <X size={13} />
                  </button>
                )}
              </div>
              <button
                onClick={() => setReviewOnly(v => !v)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs ${
                  reviewOnly
                    ? 'border border-flaky bg-elevated text-flaky'
                    : 'border border-border text-secondary hover:bg-hover'
                }`}
              >
                <span>Show review items only ({reviewCount})</span>
                {reviewOnly && <X size={12} aria-label="Clear review filter" />}
              </button>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto p-2">
              {manifest.files.length === 0 ? (
                <p className="p-2 text-xs text-muted">This manifest has no files.</p>
              ) : groups.length === 0 ? (
                <p className="p-2 text-xs text-muted">No files match the current filter.</p>
              ) : (
                groups.map(group => (
                  <div key={group.dir} className="mb-2">
                    <p className="px-1 py-1 font-mono text-[11px] uppercase tracking-wide text-muted">{group.dir}</p>
                    {group.files.map(file => {
                      const { name } = splitPath(file.relativePath)
                      const conf = fileConfidence(file, manifest.flows, manifest.pages)
                      const active = file.id === selectedFileId
                      return (
                        <button
                          key={file.id}
                          onClick={() => setSelectedFileId(file.id)}
                          title={file.relativePath}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                            active ? 'bg-hover text-primary' : 'text-secondary hover:bg-hover'
                          }`}
                        >
                          <FileTypeIcon type={file.type} />
                          <span className="flex-1 truncate font-mono">{name}</span>
                          {conf && <span className={`shrink-0 ${conf.cls}`}>● {conf.label}</span>}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer counts — from the manifest */}
            <div className="border-t border-border px-3 py-2 text-[11px] text-muted">
              {manifest.filesWritten} files · {manifest.specCount} specs · {manifest.pomCount} POMs · {manifest.fixtureCount} fixtures
            </div>
          </div>

          {/* RIGHT — read-only Monaco code viewer */}
          {selectedFile ? (
            <CodeViewerPane
              key={selectedFile.id}
              appName={appName}
              file={selectedFile}
              flows={manifest.flows}
              pages={manifest.pages}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <p className="text-sm text-muted">Select a file to view it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
