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

export type AppTypeName =
  | 'mpa' | 'spa' | 'api'
  | 'web-ui'
  | 'rest-api' | 'graphql-api'
  | 'mobile-android' | 'mobile-ios'
  | 'iot' | 'cloud' | 'data'

export interface ApiParameter {
  name:     string
  in:       'path' | 'query' | 'header' | 'body'
  required: boolean
}

export interface EndpointDefinition {
  method:       'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path:         string
  summary:      string
  auth:         boolean
  parameters?:  ApiParameter[]
  requestBody?: { schema: Record<string, any> } | null
  responses?:   Record<string, any>
}

export interface OnboardingConfig {
  app: {
    name:    string
    baseUrl: string
    appType: AppTypeName
  }
  /** Top-level discriminator — drives ApiSpecCrawler vs UI BFS vs stub */
  appType?:       'web-ui' | 'rest-api' | 'graphql-api' |
                  'mobile-android' | 'mobile-ios' | 'iot' | 'cloud' | 'data'
  apiEndpoints?:  EndpointDefinition[]
  apiSpecFile?:   string
  apiSpecUrl?:    string
  roles:          RoleConfig[]
  flows?:         FlowHint[]
  /** App-specific setup steps a page needs before its elements can be verified — see TD-013 */
  pagePrerequisites?: PagePrerequisiteHint[]
  budgets?: {
    maxPages: number
    maxDepth: number
    aiCalls:  number
  }
  /** TD-120 — Evidence Analysis tuning (see AppConfig.analysis). Optional and
   *  additive: fixture .ts configs don't set it; defaults apply downstream. */
  analysis?: {
    minSample?: number
  }
  denyList?: string[]
  crawlMode?: 'auto' | 'bfs' | 'spa' | 'hybrid'
  /** TD-UI-031 Block 4: set by ConfigAdapter when the app requires auth but no
   *  credentials were supplied (authFlow !== 'none' && roles === []). Threads the
   *  already-computed-then-discarded "will run UNAUTHENTICATED" fact to Crawler so
   *  an empty crawl can emit an honest `auth-required` diagnostic + remedy. */
  unmetAuth?: { authType: string }
}

export interface RoleConfig {
  id:                 string
  displayName:        string
  authFlow:           'form-login' | 'oauth' | 'api-key' | 'none'
  credentialsEnvKey?: string
  loginUrl?:          string
  selectors?: {
    username?: string
    password?: string
    submit?:   string
  }
  successUrl?:        string
}

export interface FlowHint {
  id:          string
  hint:        string
  startPageId: string
  roleId:      string
}

export interface PagePrerequisiteStepHint {
  action:     string
  pageId?:    string
  elementId?: string
  value?:     string
}

export interface PagePrerequisiteHint {
  /** Must match a PageDefinition.id */
  pageId:  string
  /** Omit to apply regardless of which role's verification context runs the page */
  roleId?: string
  steps:   PagePrerequisiteStepHint[]
}

export interface StateGraph {
  nodes: Map<string, PageNode>
  edges: StateEdge[]
}

export interface PageNode {
  urlPattern:  string
  visitCount:  number
  roleIds:     string[]
  domHash:     string
}

export interface StateEdge {
  fromUrl:  string
  toUrl:    string
  /** TD-UI-041: the clicked/joined element id, or null when no anchor could be
   *  joined to the edge — NEVER the magic string 'navigation'. Nullable so the
   *  "element unknown" state is representable at the type (ADR-017 archetype 1). */
  trigger:  string | null
  roleId:   string
}

export interface AiBudgetTracker {
  remaining:   number
  consume:     (n: number) => boolean
  isExhausted: () => boolean
  // Set once at crawl() start in Crawler and threaded to every aiCall site
  // (ElementClassifier, FlowDetector) for per-run cost attribution / correct
  // app labelling — FIX TD-run_id + TD-028.
  runId?:      string
  appName?:    string
}

export interface RawElement {
  tag:          string
  type:         string | null
  dataTest:     string | null
  id:           string | null
  ariaLabel:    string | null
  labelText:    string | null
  placeholder:  string | null
  textContent:  string | null
  role:         string | null
  name:         string | null
  href:         string | null
  index:        number
  /** 0-based position among structurally-identical siblings of this element's nearest repeated ancestor (card/row/list-item), or null if no such ancestor was found */
  containerIndex: number | null
  /** First short text node found inside that same container instance — used to disambiguate repeated elements with a meaningful suffix instead of a bare index */
  containerHint:  string | null
  /** This element's own `alt` attribute, if any — TD-032 Path 3, accessible-name signal for determineCritical() */
  alt:            string | null
  /** Whether this element has a `<form>` ancestor — TD-032 Path 3, structural-proximity signal for determineCritical() */
  inForm:         boolean
  /** Observed visibility at crawl time (TD-064 FC-003): 'visible' if laid out / offsetParent present, else 'attached' (present in the DOM but not visible — e.g. inside a closed menu) */
  observedState:  'visible' | 'attached'
}

export interface Strategy {
  type:       'data-test' | 'id' | 'role' | 'text' | 'css' | 'api-path'
  value:      string
  confidence: number
  /** For type 'role' only — the accessible name to match alongside the bare ARIA role token in `value`. See TD-029. */
  accessibleName?: string
}

export type ElementKind =
  | 'input' | 'button' | 'link' | 'select'
  | 'checkbox' | 'radio' | 'textarea' | 'other'
  | 'path-param' | 'query-param' | 'request-field' | 'response-field'

export interface ElementDefinition {
  id:               string
  name:             string
  kind:             ElementKind
  label:            string
  critical:         boolean
  aiNamed:          boolean
  strategies:       Strategy[]
  tier3Assertions:  any[]
  /** Multiplicity evidence (TD-064 FC-001): whether this element is a single instance
   *  or one of a repeated set (e.g. inventory items). Drives robust multiplicity
   *  assertions in the generator instead of strict-mode-violating toBeVisible(). */
  cardinality?: {
    kind:   'single' | 'repeated'
    index?: number   // only when repeated (RawElement.containerIndex)
    hint?:  string   // only when repeated (RawElement.containerHint)
  }
  /** Observed visibility at crawl time (TD-064 FC-003): drives the generator's state
   *  ladder — 'attached' elements are asserted toBeAttached, not toBeVisible. */
  observedState?: 'visible' | 'attached'
  /** Original name before deduplicateNames() renamed it to resolve a same-page collision — see TD-018 */
  disambiguatedFrom?: string
  /** This element's resolved (absolute) href, if it's a link — TD-032 Step 2, the cross-page shared-element dedup key's identity signal */
  href?:            string | null
  /** Set on every occurrence after the first when the same link (by label+kind+href) recurs across pages — TD-032 Step 2. Value is the canonical occurrence's full id ({pageId}:{name}). The element stays listed on its own page; this only signals it's already verified elsewhere, never removed. */
  sharedElementOf?: string
}

/**
 * ModuleAssignment — classification of a page into a logical module.
 * Nova-approved (TD-108): this is a CLASSIFICATION, not a detection —
 * deliberately NOT DetectedField<string>. The richer shape supports future
 * manual corrections (method: 'manual') and hierarchical modules.
 *
 * Honesty floor: an assignment FORGE isn't sure about says so —
 * confidence/method 'unknown' is a first-class, expected value, never an error.
 */
export type ModuleConfidence = 'high' | 'medium' | 'low' | 'unknown'

export interface ModuleAssignment {
  name: string;
  confidence: ModuleConfidence;
  method: 'rule' | 'ai' | 'manual' | 'unknown';
  evidenceIds: string[];
  // ADR-020 §6: provenance for a DERIVED confidence — 'evidence-matched' (keywords hit) or
  // 'default-fallback' (no lexical evidence). Present on rule assignments; absent on 'unknown'.
  source?: string;
  reason?: string;
}

export interface PageDefinition {
  id:                string
  displayName:       string
  urlPattern:        string
  urlPatternType:    'exact' | 'prefix' | 'regex'
  fingerprint:       string
  fingerprintBasis:  'url-only' | 'url+dom-hash'
  appType:           AppTypeName
  accessibleByRoles: string[]
  isAuthPage:        boolean
  elements:          ElementDefinition[]
  /** Steps that must run before this page's elements can be verified — see TD-013 */
  prerequisites?:    PagePrerequisite[]
  /** Logical module this page belongs to (TD-108) — absent until classified */
  module?:           ModuleAssignment
}

export interface PagePrerequisite {
  /** Omit to apply regardless of which role authenticated for this page */
  roleId?: string
  steps:   FlowStep[]
}

export interface FlowStep {
  stepIndex:    number
  pageId:       string
  action:       string
  elementId:    string | null
  targetPageId: string | null
  value:        string | null
  /** TD-064 FC-002: whether this step's navigation was observed during crawl
   *  (a real edge) or inferred (no real edge found). Drives the generator's
   *  navigation grounding — specific-URL assertion only for observed steps. */
  grounding?:   'observed' | 'inferred'
}

/**
 * TD-066 — evidence-tier for a flow's trustworthiness. This is a coarse,
 * honest bucket, NOT a probability: a decimal would imply a measurement we
 * do not have. Tiers are derived from evidence already on the flow:
 *   observed = steps > 0 AND every step is observed-grounded AND zero warnings
 *   partial  = steps > 0 with any inferred step OR >= 1 grounding warning
 *   unknown  = 0 steps OR fully ungrounded OR evidence absent
 *              (incl. API flows, which carry no verification signal at detect-time)
 * Distinct from `unknown` vs a hypothetical "low": unknown means no evidence
 * either way, not weak evidence. See TD-066 in TECH_DEBT.md.
 */
export type FlowConfidence = 'observed' | 'partial' | 'unknown'

export type FlowSource = 'inferred' | 'config-seeded' | 'agent-proposed'

export interface FlowDefinition {
  id:                   string
  displayName:          string
  confidence:           FlowConfidence
  source:               FlowSource
  roleId:               string
  steps:                FlowStep[]
  linkedApiEndpointIds: string[]
  /** TD-031 — set when one or more agent-proposed steps had no real crawled edge to ground against (compiled as assert-navigation fallback instead of a real click) */
  groundingWarnings?:   string[]
}

export interface RoleDefinition {
  id:                string
  displayName:       string
  authFlow:          string
  credentialsEnvKey: string | null
  storageStatePath:  string | null
  reachablePageIds:  string[]
  restrictedPageIds: string[]
  /** TD-064 FC-004b: observed auth outcome at crawl time, from AuthManager's
   *  `authenticated` flag + authFlow (guest/authFlow==='none' = 'succeeded', no auth
   *  needed). Optional for back-compat with pre-existing serialized models; new crawls
   *  always set it. NEVER derived from reachablePageIds. */
  authOutcome?:      'succeeded' | 'failed' | 'unknown'
  /** Set by Crawler when auth SUCCEEDS and the post-auth navigation is observed
   *  (AuthManager's real landing URL). Evidence-based — a direct observation,
   *  not a guess. Used by FixtureGenerator when no explicit successUrl is
   *  configured (standalone workspaces: AppConfig v1 cannot carry successUrl). */
  observedPostAuthUrl?: string
}

/** TD-UI-031 — evidenceState is authored AT THE PRODUCER (Crawler.buildModel /
 *  ApiSpecCrawler / buildStubModel), derived from observed content. Never
 *  defaulted. 'unsupported-platform' is the ONLY never-crawled state (buildStubModel);
 *  'onboarded' was dropped — it had no producer (ADR-015: no declared state
 *  without evidence). */
export type EvidenceState = 'crawled' | 'crawled-empty' | 'unsupported-platform'

/** TD-UI-040 — machine-readable failure classifier; the seam a remedy engine
 *  maps against. NEVER free text (free text cannot be mapped to a remedy);
 *  `detail` carries the human context. */
export type CrawlDiagnosticReason =
  | 'page-load-failed'
  | 'auth-required'      // never tried — no credentials were supplied (distinct from auth-failed)
  | 'auth-failed'        // tried and rejected
  | 'zero-clickables'
  | 'hydration-timeout' | 'navigation-error'
  | 'login-surface-observation' // TD-148 — observation-only record of the pre-auth login surface at auth failure

/**
 * TD-148 — one observation of the pre-auth login surface. OBSERVATION-ONLY: no
 * comparison, no configured value, no verdict. Three parts (the honesty requirement):
 * the value, how it was obtained (incl. its blind spot), and the observation boundary —
 * what the observation cannot determine (the competing causes). Scope is MECHANISM,
 * never RELEVANCE. (TD-UI-064: field renamed notImplied → observationBoundary.)
 */
export interface LoginSurfaceSignal {
  signal:      'password-field' | 'app-shape' | 'landing-url'
  observation: string   // (a) the value, factually — or 'not observed'
  mechanism:   string   // (b) how it was obtained, incl. its blind spot
  observationBoundary: string   // (c) what the observation cannot determine + the competing causes
}

/**
 * TD-148 — the machine-readable login-surface OBSERVATION carried on a crawlDiagnostics
 * entry. It records what the login surface showed at auth failure and asserts nothing
 * beyond it (the probe observes the door, not the room — Nova). No `checked`/`notChecked`
 * manifest: nothing is claimed, so nothing needs scoping.
 */
export interface LoginSurfaceObservationReport {
  check:        'login-surface-observation'
  observations: LoginSurfaceSignal[]
  note:         string   // "diagnostic context only; FORGE does not infer why auth failed"
}

export interface CrawlDiagnostic {
  scope:  'start-page' | 'role' | 'page'
  target: string                                    // url or role id
  reason: CrawlDiagnosticReason
  detail: string
  /** ADR-016 remedy, stamped at observation. OPTIONAL (TD-148): a 'login-surface-observation'
   *  entry prescribes nothing — it is not a gap with a remedy, it is an observation. */
  remedy?: { tier: 1 | 2 | 3; action: string }
  /** TD-148 — present ONLY on reason 'login-surface-observation' entries. */
  loginSurfaceObservation?: LoginSurfaceObservationReport
}

/** TD-UI-031 (ADR-015 Corollary 1): crawl-execution provenance in a nullable
 *  container. null ONLY when evidenceState is 'unsupported-platform' (no crawl
 *  ran). Reaching for `.crawledAt` on a null container is a TYPE ERROR — the
 *  impossible "provenance without a crawl" state cannot be written or read. */
export interface CrawlMetadata {
  crawlConfigHash:  string        // moved from app (TD-UI-031 Q4)
  crawledAt:        string
  // Actor CLASS (not implementation): 'engine' = algorithmic crawl, 'agent' = LLM
  // agentic loop, 'human' = manual, 'import' = spec intake (reserved — ApiSpecCrawler
  // still emits 'agent' this milestone; reconciliation is TD-UI-054).
  crawledBy:        'engine' | 'agent' | 'human' | 'import'
  crawlDurationMs:  number
  pagesBudget:      number        // a fact about the RUN, not the app
  pagesDiscovered:  number
  // null = NOT MEASURED (frontier not yet instrumented — see TD-UI-054/A2).
  // 0 would mean "measured, none skipped" — a DIFFERENT claim we cannot make today.
  pagesSkipped:     number | null
  aiBudgetStatus:   'within-budget' | 'degraded'
  crawlDiagnostics: CrawlDiagnostic[] | null         // null = clean crawl, no diagnostics
}

export interface AppModel {
  schemaVersion: string
  generatedAt:   string
  generatedBy:   'engine' | 'agent' | 'human' | 'import'   // same actor-class vocabulary as CrawlMetadata.crawledBy (Crawl-LIEs)
  /** TD-112 (Nova Q3): lightweight classification provenance — ties this model
   *  snapshot to the crawl run that classified it (ModelEnrichmentPipeline sets
   *  it). Per-page provenance lives on ModuleAssignment.method. Optional for
   *  back-compat with pre-TD-112 serialized models. Distinct from crawl (ADR-015)
   *  — stays top-level, NOT inside crawlMetadata. */
  classificationRunId?: string
  app: {
    name:             string
    displayName:      string
    baseUrl:          string
    appType:          AppTypeName
    modelVersion:     string
    spaConfig:        null
    evidenceState:    EvidenceState
    crawlMetadata:    CrawlMetadata | null
  }
  roles:     RoleDefinition[]
  pages:     PageDefinition[] | null
  flows:     FlowDefinition[] | null
  endpoints: EndpointDefinition[] | null
  api:       null
  diff:      null | {
    previousModelVersion:   string
    diffGeneratedAt:        string
    pagesAdded:             string[]
    pagesRemoved:           string[]
    // string[] = DIFFED (may be empty = "diffed, none changed"). null = NOT DIFFED
    // — a DIFFERENT claim (ADR-015: an un-computed diff is not an empty diff).
    // pagesAdded/pagesRemoved above ARE computed, so they stay string[].
    pagesModified:          string[] | null
    elementsAdded:          string[] | null
    elementsRemoved:        string[] | null
    strategiesInvalidated:  string[] | null
    flowsAdded:             string[] | null
    flowsRemoved:           string[] | null
  }
}

/**
 * TD-181 — an App Model before SQLite assigns its durable identity.
 *
 * Runtime producers may describe application evidence and may compare it with
 * a previously committed snapshot, but they do not allocate modelVersion.
 * AppModelRepository.commitCandidate() adds that field inside the same SQLite
 * transaction that supersedes the prior active row and inserts the new one.
 */
export type AppModelCandidate =
  Omit<AppModel, 'app'> & {
    app: Omit<AppModel['app'], 'modelVersion'>
  }

export interface PageDiscovery {
  pageId:       string
  urlPattern:   string
  elements:     ElementDefinition[]
  outboundUrls: string[]
  domHash:      string
  isAuthPage:   boolean
}

export interface RoleCrawlResult {
  roleId:       string
  pages:        PageDiscovery[]
  stateEdges:   StateEdge[]
  pagesSkipped: number | null   // null = not measured (see CrawlMetadata.pagesSkipped)
}

export interface FlowCandidate {
  steps:      FlowStep[]
  confidence: FlowConfidence
  roleId:     string
}
