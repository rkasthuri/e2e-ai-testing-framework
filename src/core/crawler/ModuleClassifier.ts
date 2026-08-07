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
 * TD-108 — ModuleClassifier: assigns pages to logical modules (Login, Cart, …).
 *
 * Nova-approved hybrid: rule-based first (URL-segment evidence — cheap,
 * deterministic, evidence-grounded), AI fills the residue (classifyWithAi —
 * NOT called during crawl yet, TD-112).
 *
 * PURE: no I/O, no Playwright, no AI client — classifyWithAi takes the AI call
 * as an injected function. Honesty floor: a page the rules can't place returns
 * confidence/method 'unknown' — never a guess dressed up as a fact.
 */
import { ModuleAssignment, ModuleConfidence, PageDefinition } from '../onboarding/types'

/**
 * Rule table — precedence order (first matching rule wins). A rule matches when any keyword
 * equals a URL-derived word (see wordsOf).
 *
 * ADR-020 (TD-158): the per-rule confidence LITERAL was removed. A constant `high`/`medium`
 * attached to a rule is confidence assigned by implementation — the exact defect. Confidence
 * is now DERIVED in classify() from observable lexical evidence: how many keyword tokens the
 * winning rule matched (quantity) and how many DIFFERENT rules the URL matched (ambiguity).
 */
const RULES: Array<{ name: string; keywords: string[] }> = [
  { name: 'Login',     keywords: ['login', 'signin', 'auth'] },
  { name: 'Cart',      keywords: ['cart', 'basket'] },
  { name: 'Checkout',  keywords: ['checkout'] },
  { name: 'Products',  keywords: ['product', 'item', 'catalog'] },
  { name: 'Account',   keywords: ['account', 'profile', 'user'] },
  { name: 'Admin',     keywords: ['admin'] },
  { name: 'Dashboard', keywords: ['dashboard'] },
  { name: 'Reports',   keywords: ['report'] },
  { name: 'Home',      keywords: ['home'] },
]

/** The honest no-match result: FORGE doesn't know, and says so. */
const UNKNOWN: Omit<ModuleAssignment, 'evidenceIds'> = {
  name: '', confidence: 'unknown', method: 'unknown',
}

/**
 * Decompose a urlPattern into lowercase words the rules can match.
 * Verified against the real app models' shapes:
 *   '/cart.html'                        → ['cart']            (extension stripped)
 *   '/checkout-step-one.html'           → ['checkout','step','one']
 *   '/web/index.php/admin/viewAdminModule' → [...,'admin','view','admin','module']
 * Splits on '/', '-', '_' and camelCase boundaries; strips query/hash + one
 * trailing file extension per segment.
 */
export function wordsOf(urlPattern: string): string[] {
  const pathOnly = urlPattern.split(/[?#]/)[0]
  return pathOnly
    .split('/')
    .filter(s => s.length > 0)
    .map(s => s.replace(/\.[A-Za-z0-9]+$/, ''))              // 'cart.html' → 'cart'
    .flatMap(s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // camelCase → spaced
      .split(/[-_\s]+/))
    .map(w => w.toLowerCase())
    .filter(w => w.length > 0)
}

/** Light plural fold so 'products'/'items'/'reports' hit their keyword. */
function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word
}

export class ModuleClassifier {
  /**
   * Rule-based pass. Deterministic; the urlPattern IS the evidence, so every
   * assignment carries evidenceIds:[page.id] pointing at the page it came from.
   * Root path ('/', no segments) → Home (medium), per the rule table.
   */
  classify(page: PageDefinition): ModuleAssignment {
    const words = wordsOf(page.urlPattern)

    if (words.length === 0) {
      // ADR-020 §2: root path carries NO module keyword — 'Home' is a convention-based
      // default, not lexical evidence — so it grades at the floor with default-fallback.
      return {
        name: 'Home', confidence: 'low', method: 'rule', evidenceIds: [page.id],
        source: 'default-fallback',
        reason: "root path — no module keyword in the URL; 'Home' is a convention-based default, not a keyword match",
      }
    }

    const wordSet = new Set(words.map(singular))
    // ADR-020: derive from OBSERVABLE lexical evidence only. `matched` records every rule the
    // URL hits and how many of that rule's keyword tokens it hit — the two quantities FORGE
    // actually measures. (Keyword SEMANTIC strength — that 'login' is more diagnostic than
    // 'home' — is NOT measured, so it is never graded on; see the reason strings.)
    const matched = RULES
      .map(rule => ({ rule, hits: rule.keywords.filter(k => wordSet.has(k)).length }))
      .filter(m => m.hits > 0)

    if (matched.length === 0) {
      // No rule fired: unknown, no evidence claimed (evidenceIds empty). No source/reason —
      // there is nothing an unknown assignment can point to.
      return { ...UNKNOWN, evidenceIds: [] }
    }

    const winner = matched[0]   // precedence = rule-table order (unchanged)

    if (matched.length > 1) {
      // Competing classifications: the URL matches several modules. Precedence picked the
      // winner, but that is ORDER, not evidence of dominance → floor confidence (ambiguous).
      const competitors = matched.map(m => m.rule.name).join(', ')
      return {
        name: winner.rule.name, confidence: 'low', method: 'rule', evidenceIds: [page.id],
        source: 'evidence-matched',
        reason: `ambiguous — the URL words match ${matched.length} modules (${competitors}); '${winner.rule.name}' won on precedence order, not on evidence of dominance`,
      }
    }

    // Exactly one module matched → unambiguous. Grade by keyword-hit QUANTITY: two or more
    // corroborating tokens → 'high'; a single token → 'medium' (no corroboration, and keyword
    // strength is not measured).
    const confidence: ModuleConfidence = winner.hits >= 2 ? 'high' : 'medium'
    return {
      name: winner.rule.name, confidence, method: 'rule', evidenceIds: [page.id],
      source: 'evidence-matched',
      reason: winner.hits >= 2
        ? `${winner.hits} corroborating '${winner.rule.name}' keyword tokens matched in the URL, with no competing module`
        : `a single unambiguous '${winner.rule.name}' keyword token matched, with no competing module (keyword semantic strength is not measured, so a single token caps at medium)`,
    }
  }

  /**
   * AI residue pass for pages the rules couldn't place. TD-112: implemented but
   * NOT called during crawl yet (background classification deferred so AI calls
   * never block the crawl).
   *
   * The AI call is INJECTED — this class owns prompt + parsing only. The prompt
   * explicitly permits "unknown" (honesty floor); an unparseable or invalid
   * response degrades to unknown EXPLICITLY (warned, never silent).
   */
  async classifyWithAi(
    page: PageDefinition,
    claudeApiCall: (prompt: string) => Promise<string>,
  ): Promise<ModuleAssignment> {
    const prompt =
`You are classifying a web-app page into a logical module for test organization.

Page:
  id:          ${page.id}
  displayName: ${page.displayName}
  urlPattern:  ${page.urlPattern}
  isAuthPage:  ${page.isAuthPage}

Reply with ONLY a JSON object: {"module": "<PascalCase module name>", "confidence": "high" | "medium" | "low" | "unknown"}
If you cannot tell what module this page belongs to, reply {"module": "", "confidence": "unknown"} — do NOT guess.`

    const raw = await claudeApiCall(prompt)
    try {
      const cleaned = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim()
      const parsed = JSON.parse(cleaned) as { module?: unknown; confidence?: unknown }
      const validConfidence = ['high', 'medium', 'low', 'unknown'] as const
      const confidence = validConfidence.find(c => c === parsed.confidence)
      if (typeof parsed.module !== 'string' || !confidence) {
        throw new Error(`invalid shape: ${cleaned.slice(0, 120)}`)
      }
      if (confidence === 'unknown' || parsed.module === '') {
        // The AI said "I don't know" — that is a valid, honest answer.
        return { ...UNKNOWN, evidenceIds: [] }
      }
      return { name: parsed.module, confidence, method: 'ai', evidenceIds: [page.id] }
    } catch (e: any) {
      // Explicit degradation (Rule 5): a bad AI response is logged and becomes
      // an unknown assignment — never a crash, never a silent guess.
      console.warn(`[ModuleClassifier] Unusable AI response for '${page.id}' (${e.message}) — assignment stays unknown`)
      return { ...UNKNOWN, evidenceIds: [] }
    }
  }
}
