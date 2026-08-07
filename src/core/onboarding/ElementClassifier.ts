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

import { Page } from '@playwright/test'
import * as crypto from 'crypto'
import {
  RawElement, Strategy, ElementKind,
  ElementDefinition, AiBudgetTracker, EndpointDefinition
} from './types'
import { aiCall } from '../ai/AiClient'
import { getAppName } from '../config/appConfig'

export class ElementClassifier {

  constructor(
    private page:   Page,
    private pageId: string,
    private budget: AiBudgetTracker
  ) {}

  async classifyPage(
    appType?:   string,
    endpoints?: EndpointDefinition[]
  ): Promise<ElementDefinition[]> {
    // ── API branch — classify endpoints instead of DOM ─────────────────────
    if (appType === 'rest-api' || appType === 'graphql-api') {
      return ElementClassifier.classifyEndpoints(endpoints || [])
    }
    // ── UI branch — existing DOM element classification ─────────────────────
    const raw      = await this.harvestElements()
    const elements = raw.map(el => this.classifyElement(el))
    const unnamed  = elements.filter(e => !e.name || e.name.startsWith('unnamed-'))

    if (unnamed.length > 0 && !this.budget.isExhausted()) {
      const namedMap = await this.nameWithAi(unnamed, raw)
      for (const el of elements) {
        if (namedMap.has(el.id)) {
          el.name    = namedMap.get(el.id)!
          el.aiNamed = true
        }
      }
    }

    this.deduplicateNames(elements, raw)
    this.enforceWholePageUniqueness(elements)

    return elements.sort((a, b) =>
      (b.critical ? 1 : 0) - (a.critical ? 1 : 0)
    )
  }

  private async harvestElements(): Promise<RawElement[]> {
    return this.page.evaluate(() => {
      const selector = [
        'input:not([type=hidden])',
        'button',
        'select',
        'textarea',
        'a[href]',
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="combobox"]',
        '[data-test]',
      ].join(',')

      // ── Generic repeated-container detection — no app-specific knowledge ──
      // Walk up from an element looking for the nearest ancestor that has 2+
      // siblings sharing its tag+class signature (a generic stand-in for
      // "card"/"row"/"list-item"). Used to disambiguate same-name elements
      // that come from repeated structural blocks (see TD-018).
      //
      // NOTE: these helpers are bound via array-destructuring, not plain
      // `const fn = ...`/`function fn() {}` — tsx's esbuild transform
      // hardcodes `keepNames: true`, which wraps any *named* function with a
      // `__name(...)` call. That helper lives at the top of the compiled
      // Node module, not in the string Playwright ships to the browser via
      // `page.evaluate()`'s `fn.toString()`, so a named function here throws
      // "ReferenceError: __name is not defined" client-side. Destructuring
      // assignment gets no inferred name in real JS, so esbuild has nothing
      // to wrap. Confirmed empirically — see session notes for TD-018.
      const [signature] = [(el: Element): string =>
        el.tagName + '.' + Array.from(el.classList).sort().join('.')]

      const [findRepeatedAncestor] = [(
        el: Element
      ): { container: Element; index: number } | null => {
        // Start at `el` itself, not `el.parentElement` — a harvested
        // element can itself be the repeated container (e.g. SauceDemo's
        // `.inventory_item` cards carry their own `data-test` attribute),
        // not just a descendant nested inside one.
        let node: Element | null = el
        while (node && node !== document.body) {
          const parent: Element | null = node.parentElement
          if (parent) {
            const sig = signature(node)
            const siblings = Array.from(parent.children).filter(
              c => signature(c) === sig
            )
            if (siblings.length >= 2) {
              return { container: node, index: siblings.indexOf(node) }
            }
          }
          node = parent
        }
        return null
      }]

      const hintCache = new Map<Element, string | null>()
      const [hintForContainer] = [(container: Element): string | null => {
        if (hintCache.has(container)) return hintCache.get(container)!
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
        let hint: string | null = null
        let node: Node | null
        while ((node = walker.nextNode())) {
          const text = node.textContent?.trim() || ''
          if (text.length > 1 && text.length < 40) { hint = text; break }
        }
        hintCache.set(container, hint)
        return hint
      }]

      const elements = Array.from(document.querySelectorAll(selector))
      return elements.slice(0, 100).map((el, index) => {
        const input    = el as HTMLInputElement
        const repeated = findRepeatedAncestor(el)
        // TD-064 FC-003: capture observed visibility at crawl. offsetParent is null for
        // display:none / not-in-layout elements; the rect check covers laid-out cases.
        // Inline const (no named fn) — respects the __name/evaluate constraint above.
        const rect      = el.getBoundingClientRect()
        const isVisible = input.offsetParent !== null || (rect.width > 0 && rect.height > 0)
        return {
          tag:         el.tagName.toLowerCase(),
          type:        input.type || null,
          dataTest:    el.getAttribute('data-test'),
          id:          el.id || null,
          ariaLabel:   el.getAttribute('aria-label'),
          labelText:   (() => {
            if (input.id) {
              const label = document.querySelector(`label[for="${input.id}"]`)
              return label?.textContent?.trim() || null
            }
            return null
          })(),
          placeholder: input.placeholder || null,
          textContent: el.textContent?.trim().slice(0, 50) || null,
          role:        el.getAttribute('role'),
          name:        (el as HTMLInputElement).name || null,
          href:        (el as HTMLAnchorElement).href || null,
          index,
          containerIndex: repeated ? repeated.index : null,
          containerHint:  repeated ? hintForContainer(repeated.container) : null,
          alt:         el.getAttribute('alt'),
          inForm:      el.closest('form') !== null,
          observedState: isVisible ? 'visible' : 'attached',
        }
      })
    })
  }

  /**
   * Guarantees every element on a page has a unique `name`/`id` — see TD-018.
   * Groups elements by their current name and, for any group of 2+, resolves
   * the collision via the most meaningful strategy available:
   *  - repeated structural elements (cards/rows/list-items, identified by
   *    containerIndex during harvest) get a descriptive containerHint suffix
   *    where that hint is itself unique within the group, falling back to a
   *    positional containerIndex suffix otherwise;
   *  - coincidental same-name collisions with no structural information at
   *    all keep the first element's name and number the rest.
   * A final residual-collision pass guarantees uniqueness even if both of the
   * above still leave a clash (e.g. two unrelated repeated series that happen
   * to share both a base name and a containerIndex).
   */
  private deduplicateNames(elements: ElementDefinition[], raw: RawElement[]): void {
    const groups = new Map<string, number[]>()
    elements.forEach((el, i) => {
      const indices = groups.get(el.name) ?? []
      indices.push(i)
      groups.set(el.name, indices)
    })

    for (const [baseName, indices] of groups) {
      if (indices.length < 2) continue

      const allStructural = indices.every(i => raw[i].containerIndex !== null)
      const finalNames = allStructural
        ? this.disambiguateStructural(baseName, indices, raw)
        : this.disambiguateCoincidental(baseName, indices)

      this.resolveResidualCollisions(baseName, finalNames, indices)
      this.applyRenames(baseName, indices, finalNames, elements)
    }
  }

  private disambiguateStructural(
    baseName: string,
    indices:  number[],
    raw:      RawElement[]
  ): Map<number, string> {
    // Tier 1 — a containerHint-based suffix, kept only where it's unique
    // within the group (two cards both hinting "Pending" must not collide).
    const candidates = new Map<number, string | null>()
    for (const i of indices) {
      const hint = raw[i].containerHint && this.toCamelCase(raw[i].containerHint!).slice(0, 30)
      candidates.set(i, hint ? `${baseName}${this.capitalize(hint)}` : null)
    }
    const candidateCounts = new Map<string, number>()
    for (const c of candidates.values()) {
      if (c) candidateCounts.set(c, (candidateCounts.get(c) ?? 0) + 1)
    }

    const finalNames = new Map<number, string>()
    for (const i of indices) {
      const candidate = candidates.get(i)
      if (candidate && candidateCounts.get(candidate) === 1) {
        finalNames.set(i, candidate)
      }
    }
    // Tier 2 — positional containerIndex suffix for anything tier 1 didn't resolve.
    for (const i of indices) {
      if (!finalNames.has(i)) {
        finalNames.set(i, `${baseName}${(raw[i].containerIndex as number) + 1}`)
      }
    }
    return finalNames
  }

  private disambiguateCoincidental(
    baseName: string,
    indices:  number[]
  ): Map<number, string> {
    const finalNames = new Map<number, string>()
    indices.forEach((i, pos) => {
      finalNames.set(i, pos === 0 ? baseName : `${baseName}_${pos + 1}`)
    })
    console.warn(`[ElementClassifier] Duplicate name "${baseName}" on "${this.pageId}" (${indices.length} elements) with no structural/container info to disambiguate meaningfully — falling back to numeric suffix. This may indicate two unrelated elements share a label, or that the structural detector failed to find a real repeated container; consider reviewing this page's DOM manually.`)
    return finalNames
  }

  // Tier 3 safety net — fires if tiers 1/2 (or the coincidental fallback)
  // still leave a clash, e.g. two distinct repeated series that happen to
  // share both a base name and a containerIndex.
  private resolveResidualCollisions(
    baseName:   string,
    finalNames: Map<number, string>,
    indices:    number[]
  ): void {
    const counts = new Map<string, number>()
    for (const i of indices) {
      const name = finalNames.get(i)!
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }

    const seen = new Map<string, number>()
    for (const i of indices) {
      const name = finalNames.get(i)!
      if ((counts.get(name) ?? 0) < 2) continue

      const occurrence = (seen.get(name) ?? 0) + 1
      seen.set(name, occurrence)
      if (occurrence > 1) {
        const suffixed = `${name}_${occurrence}`
        console.warn(`[ElementClassifier] Residual name collision on "${this.pageId}" after disambiguating "${baseName}" — "${name}" still duplicated; appending running-counter suffix -> "${suffixed}"`)
        finalNames.set(i, suffixed)
      }
    }
  }

  private applyRenames(
    baseName:   string,
    indices:    number[],
    finalNames: Map<number, string>,
    elements:   ElementDefinition[]
  ): void {
    const renamed: string[] = []
    for (const i of indices) {
      const newName = finalNames.get(i)!
      if (newName === elements[i].name) continue
      elements[i].disambiguatedFrom = elements[i].name
      elements[i].name = newName
      elements[i].id   = `${this.pageId}:${newName}`
      renamed.push(newName)
    }
    if (renamed.length > 0) {
      console.log(`[ElementClassifier] Disambiguated duplicate name "${baseName}" on "${this.pageId}" (${indices.length} elements) -> ${renamed.join(', ')}`)
    }
  }

  /**
   * Final whole-page safety net — see TD-025. `deduplicateNames()`'s tiers 1-3
   * only ever see elements grouped by their *pre-dedup* name, so a singleton
   * the AI named uniquely at naming time can still collide with a name a
   * different group's tier 2/3 computed independently (e.g. AI-named
   * "recruitmentActionButton12" vs. tier-2-computed
   * "recruitmentActionButton1" + "2"). This pass walks the complete final
   * name list for the page — every element, regardless of which tier (or no
   * tier) produced its name — and appends a running-counter suffix to any
   * name still colliding at that point, agnostic to why the collision
   * happened.
   */
  private enforceWholePageUniqueness(elements: ElementDefinition[]): void {
    const counts = new Map<string, number>()
    for (const el of elements) {
      counts.set(el.name, (counts.get(el.name) ?? 0) + 1)
    }
    const usedNames = new Set(elements.map(el => el.name))

    const seen = new Map<string, number>()
    for (const el of elements) {
      if ((counts.get(el.name) ?? 0) < 2) continue

      const occurrence = (seen.get(el.name) ?? 0) + 1
      seen.set(el.name, occurrence)
      if (occurrence > 1) {
        const original = el.name
        let n = occurrence
        let suffixed = `${original}_${n}`
        while (usedNames.has(suffixed)) {
          n++
          suffixed = `${original}_${n}`
        }
        console.warn(`[ElementClassifier] Whole-page residual name collision on "${this.pageId}" — "${original}" still duplicated after tier 1-3 disambiguation; appending running-counter suffix -> "${suffixed}"`)
        if (!el.disambiguatedFrom) el.disambiguatedFrom = original
        el.name = suffixed
        el.id   = `${this.pageId}:${suffixed}`
        usedNames.add(suffixed)
      }
    }
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  private classifyElement(raw: RawElement): ElementDefinition {
    const strategies = this.buildStrategyChain(raw)
    const kind       = this.determineKind(raw)
    const name       = this.determineName(raw) ||
                       `unnamed-${raw.tag}-${raw.index}`
    const critical   = this.determineCritical(raw)
    const label      = raw.ariaLabel || raw.labelText ||
                       raw.placeholder || raw.textContent || name

    return {
      id:              `${this.pageId}:${name}`,
      name,
      kind,
      label,
      critical,
      aiNamed:         false,
      strategies,
      tier3Assertions: [],
      // TD-064 FC-001 — multiplicity evidence: 'repeated' when the element came from a
      // repeated container (raw.containerIndex set during harvest), else 'single'.
      cardinality:     raw.containerIndex !== null
        ? {
            kind: 'repeated',
            index: raw.containerIndex,
            // Omit an unobserved optional value. Materializing `hint: undefined`
            // passes optional-property validation but is not canonical JSON.
            ...(raw.containerHint ? { hint: raw.containerHint } : {}),
          }
        : { kind: 'single' },
      // TD-064 FC-003 — observed visibility, resolved via determineObservedState so the
      // state ladder evolves in one place (the helper), not in the generator (per Nova).
      observedState:   this.determineObservedState(raw),
      // TD-032 Step 2 — carried forward only for the cross-page shared-element
      // dedup pass (Crawler.deduplicateSharedElements()); not used elsewhere.
      href:            raw.href || null,
    }
  }

  private buildStrategyChain(raw: RawElement): Strategy[] {
    const chain: Strategy[] = []

    if (raw.dataTest) {
      chain.push({ type: 'data-test', value: raw.dataTest, confidence: 1.0 })
    }
    if (raw.id) {
      chain.push({ type: 'id', value: raw.id, confidence: 0.95 })
    }
    const roleSelector = this.buildRoleSelector(raw)
    if (roleSelector) {
      chain.push({
        type:           'role',
        value:          roleSelector.role,
        // A bare semantic role is valid evidence. Omit the optional name when
        // none was observed instead of materializing undefined.
        ...(roleSelector.accessibleName
          ? { accessibleName: roleSelector.accessibleName }
          : {}),
        confidence:     0.85,
      })
    }
    if (raw.textContent && raw.textContent.length < 30) {
      chain.push({ type: 'text', value: raw.textContent, confidence: 0.75 })
    }
    const css = this.buildCssSelector(raw)
    if (css) {
      chain.push({ type: 'css', value: css, confidence: 0.6 })
    }

    return chain.length > 0
      ? chain
      : [{ type: 'css', value: `${raw.tag}:nth-child(${raw.index + 1})`, confidence: 0.3 }]
  }

  private buildRoleSelector(raw: RawElement): { role: string; accessibleName?: string } | null {
    const roleMap: Record<string, string> = {
      'input':    'textbox',
      'button':   'button',
      'a':        'link',
      'select':   'combobox',
      'textarea': 'textbox',
    }
    const role = raw.role || roleMap[raw.tag]
    if (!role) return null
    const accessibleName = raw.ariaLabel || raw.labelText ||
                           raw.placeholder || raw.textContent
    return accessibleName ? { role, accessibleName } : { role }
  }

  private buildCssSelector(raw: RawElement): string | null {
    if (raw.id)          return `#${raw.id}`
    if (raw.dataTest)    return `[data-test="${raw.dataTest}"]`
    if (raw.placeholder) return `${raw.tag}[placeholder='${raw.placeholder}']`
    if (raw.type)        return `${raw.tag}[type=${raw.type}]`
    return raw.tag || null
  }

  /**
   * TD-064 FC-003 — resolve the element's observed state. Thin passthrough today
   * (defaults to 'visible' when crawl evidence is absent, to stay backward-safe);
   * future ladder states (e.g. 'occluded', 'offscreen') evolve here, not in the generator.
   */
  private determineObservedState(raw: RawElement): 'visible' | 'attached' {
    return raw.observedState ?? 'visible'
  }

  private determineKind(raw: RawElement): ElementKind {
    if (raw.tag === 'a') return 'link'
    if (raw.tag === 'select' || raw.role === 'combobox') return 'select'
    if (raw.tag === 'textarea') return 'textarea'
    if (raw.type === 'checkbox' || raw.role === 'checkbox') return 'checkbox'
    if (raw.type === 'radio'    || raw.role === 'radio')    return 'radio'
    if (raw.tag === 'button' ||
        raw.type === 'submit' ||
        raw.type === 'button' ||
        raw.role === 'button') return 'button'
    if (raw.tag === 'input') return 'input'
    return 'other'
  }

  private determineName(raw: RawElement): string | null {
    const candidates = [
      raw.dataTest,
      raw.ariaLabel,
      raw.labelText,
      raw.placeholder,
      raw.id,
      raw.textContent,
    ].filter(Boolean) as string[]

    for (const candidate of candidates) {
      const name = this.toCamelCase(candidate)
      if (name && name.length > 1 && name.length < 50) return name
    }
    return null
  }

  // TD-032 Path 3, Step 1 — three additive heuristic rules (existing rules
  // above are untouched). Deliberately excludes: decorative icons/images
  // with no accessible name, generic div/span with no role and no
  // interactive handler, and CSS-class-name pattern matching (too
  // app-specific, too noisy). Measured against both reference apps before
  // committing — see TECH_DEBT.md TD-032.
  private static readonly INTERACTIVE_ROLES = [
    'link', 'button', 'checkbox', 'radio', 'combobox',
    'menuitem', 'tab', 'switch', 'option',
  ]

  private determineCritical(raw: RawElement): boolean {
    if (raw.dataTest) return true
    if (raw.type === 'submit') return true
    if (raw.type === 'password') return true
    if (raw.role === 'button' && raw.textContent) return true

    // Rule 1 — any form input regardless of type, not just submit/password.
    if (raw.tag === 'input' || raw.tag === 'select' || raw.tag === 'textarea') {
      return true
    }

    // Rule 2 — accessible name + interactive tag/role, not just role=button.
    const hasAccessibleName = !!(raw.ariaLabel || raw.alt || raw.textContent)
    const isInteractiveTag  = (raw.tag === 'a' && !!raw.href) || raw.tag === 'button'
    const isInteractiveRole = !!raw.role && ElementClassifier.INTERACTIVE_ROLES.includes(raw.role)
    if (hasAccessibleName && (isInteractiveTag || isInteractiveRole)) return true

    // Rule 3 — structural proximity: inside a <form>, even if it didn't
    // match rule 1/2 directly (e.g. a div[role=button] submit control).
    if (raw.inForm) return true

    return false
  }

  private toCamelCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/[-_\s]+(.)/g, (_, c: string) => c.toUpperCase())
      .replace(/^(.)/, (c: string) => c.toLowerCase())
      .trim()
  }

  private async nameWithAi(
  unnamed: ElementDefinition[],
  raw:     RawElement[]
): Promise<Map<string, string>> {
  const result    = new Map<string, string>()
  const BATCH_MAX = 20

  // Split into chunks of BATCH_MAX
  for (let i = 0; i < unnamed.length; i += BATCH_MAX) {
    const batch = unnamed.slice(i, i + BATCH_MAX)
    if (!this.budget.consume(1)) {
      console.warn(`[ElementClassifier] AI naming skipped on "${this.pageId}" — budget exhausted (${this.budget.remaining} remaining)`)
      break
    }
    console.log(`[ElementClassifier] AI naming ${batch.length} elements on "${this.pageId}" (budget remaining: ${this.budget.remaining})`)

    const context = batch.map((el, idx) => ({
      index: i + idx,
      id:    el.id,
      tag:   'unknown',
      label: el.label,
      kind:  el.kind,
    }))

    try {
      const response = await aiCall({
        operation: 'crawl-classify',
        appName:   this.budget.appName ?? getAppName(),  // FIX TD-028: prefer budget.appName (set from config) over getAppName()
        runId:     this.budget.runId,                     // FIX TD-run_id: thread crawl run ID for cost attribution
        messages:  [{
          role:    'user',
          content: `You are naming UI elements for a test automation framework.
Given these unnamed elements on page "${this.pageId}", suggest camelCase names.
Respond ONLY with a JSON array: [{"id": "...", "name": "camelCaseName"}, ...]

Elements:
${JSON.stringify(context, null, 2)}`,
        }],
        maxTokens: 1024,
      })

      const clean  = response.content.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean) as { id: string; name: string }[]
      for (const item of parsed) {
        if (item.id && item.name) result.set(item.id, item.name)
      }
    } catch (e) {
      console.warn(`[ElementClassifier] AI naming failed on batch ${Math.floor(i / BATCH_MAX) + 1} of "${this.pageId}" — using fallback names`)
    }
  }

  return result
}

  /**
   * Classify API endpoint parameters and body fields as ElementDefinition items.
   * Called when appType is 'rest-api' or 'graphql-api'.
   */
  static classifyEndpoints(endpoints: EndpointDefinition[]): ElementDefinition[] {
    const elements: ElementDefinition[] = []

    for (const ep of endpoints) {
      const epId = `${ep.method}:${ep.path}`

      // Path parameters — segments wrapped in {}
      const pathParams = (ep.path.match(/\{([^}]+)\}/g) || [])
        .map(p => p.slice(1, -1))
      for (const param of pathParams) {
        elements.push({
          id:              `${epId}:${param}`,
          name:            param,
          kind:            'path-param',
          label:           `Path param: ${param} (${ep.method} ${ep.path})`,
          critical:        true,
          aiNamed:         false,
          strategies:      [{ type: 'api-path', value: ep.path, confidence: 1.0 }],
          tier3Assertions: [],
        })
      }

      // Query parameters
      for (const param of (ep.parameters || []).filter(p => p.in === 'query')) {
        elements.push({
          id:              `${epId}:${param.name}`,
          name:            param.name,
          kind:            'query-param',
          label:           `Query param: ${param.name} (${ep.method} ${ep.path})`,
          critical:        param.required,
          aiNamed:         false,
          strategies:      [{ type: 'api-path', value: ep.path, confidence: 0.9 }],
          tier3Assertions: [],
        })
      }

      // Request body fields
      const reqProps = ep.requestBody?.schema?.properties || {}
      for (const [field] of Object.entries(reqProps)) {
        elements.push({
          id:              `${epId}:req:${field}`,
          name:            field,
          kind:            'request-field',
          label:           `Request field: ${field} (${ep.method} ${ep.path})`,
          critical:        true,
          aiNamed:         false,
          strategies:      [{ type: 'api-path', value: ep.path, confidence: 0.8 }],
          tier3Assertions: [],
        })
      }

      // Response fields from 200 or 201
      const respSchema =
        ep.responses?.['200']?.schema?.properties ||
        ep.responses?.['200']?.content?.['application/json']?.schema?.properties ||
        ep.responses?.['201']?.schema?.properties ||
        ep.responses?.['201']?.content?.['application/json']?.schema?.properties ||
        {}
      for (const [field] of Object.entries(respSchema)) {
        elements.push({
          id:              `${epId}:res:${field}`,
          name:            field,
          kind:            'response-field',
          label:           `Response field: ${field} (${ep.method} ${ep.path})`,
          critical:        false,
          aiNamed:         false,
          strategies:      [{ type: 'api-path', value: ep.path, confidence: 0.8 }],
          tier3Assertions: [],
        })
      }
    }

    return elements
  }

  static async computeDomHash(page: Page): Promise<string> {
    const structure = await page.evaluate(() => {
      const tags = Array.from(document.querySelectorAll('*'))
        .slice(0, 200)
        .map(el => el.tagName)
        .join(',')
      return tags
    })
    return 'sha256:' + crypto
      .createHash('sha256')
      .update(structure)
      .digest('hex')
      .slice(0, 16)
  }
}
