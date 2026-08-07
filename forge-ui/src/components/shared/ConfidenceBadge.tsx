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
 * ConfidenceBadge — a DetectedField's confidence, humanized (Nova Q5).
 * Verified/Likely/Uncertain/Unknown labels + semantic signal colors + a
 * group-hover tooltip explaining what each level means. Purple (unknown) =
 * insufficient evidence. CONFIDENCE_CONFIG is exported for unit testing.
 */
export const CONFIDENCE_CONFIG: Record<
  string,
  { label: string; technical: string; colorClass: string; tooltip: string }
> = {
  high: {
    label: 'Verified', technical: 'high', colorClass: 'text-pass',
    tooltip: 'Detected with high confidence. No action needed.',
  },
  medium: {
    label: 'Likely', technical: 'medium', colorClass: 'text-flaky',
    tooltip: 'Detected with moderate confidence. FORGE will verify during crawling. You can override in Settings.',
  },
  low: {
    label: 'Uncertain', technical: 'low', colorClass: 'text-fail',
    tooltip: 'Weak signal. Review manually before crawling.',
  },
  unknown: {
    label: 'Unknown', technical: 'unknown', colorClass: 'text-unknown',
    tooltip: 'Not enough evidence. Re-crawl to build history.',
  },
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cfg = CONFIDENCE_CONFIG[confidence] ?? CONFIDENCE_CONFIG.unknown
  return (
    <div className="group relative inline-flex items-center">
      <span className={`flex items-center gap-1 text-sm ${cfg.colorClass}`}>
        ● {cfg.label}
        <span className="ml-1 text-xs text-muted">({cfg.technical})</span>
      </span>
      <div
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 hidden w-52 rounded border border-border bg-elevated p-2 text-xs text-secondary shadow-lg group-hover:block"
      >
        {cfg.tooltip}
      </div>
    </div>
  )
}
