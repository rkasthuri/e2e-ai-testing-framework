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

import type { Config } from 'tailwindcss'

// TD-UI foundation: theme maps to the CSS variables in src/index.css so
// dark/light switches by toggling the `.light` class — no Tailwind rebuild.
// Signal colors are semantic (pass/fail/flaky/skip/running/unknown); brand is
// Forge Orange. Purple `unknown` = insufficient evidence.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas:   'var(--bg-canvas)',
        surface:  'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        hover:    'var(--bg-hover)',
        selected: 'var(--bg-selected)',
        border:   'var(--bg-border)',
        primary:   'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted:     'var(--text-muted)',
        inverse:   'var(--text-inverse)',
        pass:    'var(--signal-pass)',
        fail:    'var(--signal-fail)',
        flaky:   'var(--signal-flaky)',
        skip:    'var(--signal-skip)',
        running: 'var(--signal-run)',
        unknown: 'var(--signal-unknown)',
        brand: 'var(--brand-primary)',
        amber: 'var(--brand-secondary)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
