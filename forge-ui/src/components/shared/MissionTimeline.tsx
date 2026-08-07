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
 * MissionTimeline — the live LogBuffer stream (1s poll) shown during long jobs.
 * Owns its own auto-scroll to the newest line. Extracted from CrawlPage's inline
 * timeline so the Crawl and Test Cases tabs share ONE implementation (no fork).
 */
import { useRef, useEffect } from 'react'

export function MissionTimeline({ lines, running, placeholder }: {
  lines: string[]
  running: boolean
  placeholder: string   // shown when there are no lines yet
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight)
  }, [lines])

  return (
    <div ref={ref} className="h-[360px] overflow-y-auto rounded border border-border bg-canvas p-3 font-mono text-xs text-secondary">
      <p className="mb-2 font-sans text-xs font-medium text-brand">Mission Timeline</p>
      {lines.length === 0 ? (
        <p className="animate-pulse text-muted">{placeholder}</p>
      ) : lines.map((l, i) => (
        <div key={i} className="whitespace-pre-wrap break-all leading-5">{l}</div>
      ))}
      {running && <span className="animate-pulse text-brand">▊</span>}
    </div>
  )
}
