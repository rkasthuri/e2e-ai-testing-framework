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
 * Client-side app-name derivation for the Onboard form auto-fill. Normalizes to
 * https:// first, then takes the registrable label (strips www. and the
 * opensource-demo. fixture prefix), lowercased, slug-safe (internal hyphens
 * preserved). Non-URL input falls back to slugifying the raw string.
 *   https://www.saucedemo.com                 → saucedemo
 *   https://opensource-demo.orangehrmlive.com → orangehrmlive
 *   not-a-url                                 → not-a-url
 */
export function deriveAppName(url: string): string {
  if (!url) return ''
  const normalized = url.match(/^https?:\/\//) ? url : `https://${url}`
  try {
    const hostname = new URL(normalized).hostname
    return hostname
      .replace(/^www\./, '')
      .replace(/^opensource-demo\./, '')
      .split('.')[0]
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
  } catch {
    // Slugify raw input — preserve internal hyphens (not-a-url → not-a-url).
    return url
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .split('.')[0] || ''
  }
}
