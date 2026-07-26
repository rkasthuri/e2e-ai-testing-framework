# REPOSITORY_STRUCTURE.md
<!-- version: 1.0 | status: ACTIVE | owner: Raj Kasthuri (AnvilQ Technologies LLC) -->
<!-- Last updated: 2026-07-21 — sourced from CC directory tree verification -->

> Directory-by-directory explanation of the FORGE repository layout.
> Verified against the live repo 2026-07-21.
> If a directory is not listed here, verify with CC before assuming it does
> not exist.

---

## Top-Level Layout

```
forge-framework/
├── src/                    ← Engine (headless core — never imports from forge-ui/)
├── forge-ui/               ← Platform UI (React + Express — canonical UI surface)
├── scripts/                ← Unit test suite (~60 verify-*.test.ts files)
├── evals/                  ← AI evaluation harnesses
├── docs/                   ← Architecture docs, ADRs, documentation
├── models/                 ← Generated app models (per app)
├── fixtures/               ← Ground-truth datasets for evals
├── reports/                ← Run reports (generated, not committed)
├── logs/                   ← Run logs (generated, not committed)
├── forge-framework.db      ← SQLite database (runtime-resolved path)
├── package.json            ← Root package — engine scripts
├── tsconfig.json           ← Root TypeScript config
├── playwright.config.ts    ← Playwright configuration
└── .github/
    └── workflows/
        └── e2e-pipeline.yml ← CI/CD pipeline (3 jobs)
```

> Note: `src/platform/` is **deprecated**. It is present on disk but receives
> no new investment. All UI work goes into `forge-ui/`.

---

## src/ — The Engine

The headless core of FORGE. No dependency on `forge-ui/`.
Can be run as a CLI tool independently of any UI.

```
src/
├── core/
│   ├── agent/              ← Agentic crawl components
│   │   ├── AgentPlanner    ← Goal decomposition into executable steps
│   │   ├── WebUIEnvironment ← Browser execution surface for agent
│   │   ├── ApiEnvironment  ← API execution surface for agent
│   │   └── AgentMemoryRepository ← Cross-session goal memory persistence
│   │
│   ├── ai/                 ← Claude API client and budget tracking
│   │   └── AiBudgetTracker ← Live budget tracking via getter
│   │
│   ├── crawler/            ← Crawl strategies and coordination
│   │   ├── BFSStrategy     ← Breadth-first for multi-page apps
│   │   ├── SPAStrategy     ← JavaScript navigation detection
│   │   ├── HybridStrategy  ← Combined BFS + SPA
│   │   ├── StrategyDetector ← Auto-selects strategy from live page
│   │   ├── AuthManager     ← Per-role auth before crawl
│   │   └── ApiSpecCrawler  ← REST API + GraphQL endpoint discovery
│   │
│   ├── healing/            ← Self-healing components
│   │   ├── SmartLocator    ← Multi-strategy element re-identification
│   │   ├── HealStore       ← Healing event persistence
│   │   ├── VisionHealer    ← Visual-similarity healing supplement
│   │   └── AdaptiveFixes   ← Applies approved fixes to test files
│   │
│   ├── onboarding/         ← App onboarding pipeline
│   │   ├── cli.ts          ← CLI entry point (crawl / verify / generate / refresh)
│   │   ├── Crawler.ts      ← Orchestrates crawl strategies
│   │   ├── ElementClassifier ← AI element naming (batched ≤20 per call)
│   │   ├── FlowDetector    ← User journey identification
│   │   ├── ModelValidator  ← Validates model before persistence
│   │   ├── VerificationRunner ← Verifies selectors against live app
│   │   ├── SelfCorrectionEngine ← Fallback selector strategies
│   │   └── generators/     ← PomGenerator, SpecGenerator, FixtureGenerator
│   │
│   ├── pipeline/           ← AI pipeline stage scripts
│   │   ├── ai-triage.ts    ← Failure classification (5 categories)
│   │   ├── adaptive-fixes.ts ← Healing application
│   │   ├── impact-analysis.ts ← Change impact on tests
│   │   ├── nl-test-generator.ts ← Test generation
│   │   ├── trend-analysis.ts ← Pass/fail trends
│   │   ├── release-notes.ts ← Human-readable run notes
│   │   ├── results-store.ts ← Run result persistence
│   │   ├── flaky-predictor.ts ← Flakiness risk scoring
│   │   ├── coverage-gap.ts ← Coverage gap identification
│   │   ├── gap-to-test.ts  ← Gap-filling test generation
│   │   ├── knowledge-query.ts ← Knowledge base queries
│   │   └── notifier.ts     ← Slack / email notifications
│   │
│   ├── storage/            ← Database layer
│   │   ├── migrate.ts      ← Schema migration runner
│   │   ├── migrations/     ← ~15 sequential migration files
│   │   └── repositories/   ← ~16 typed Kysely repositories
│   │
│   ├── triage/             ← Triage taxonomy and classification
│   ├── workspace/          ← Workspace management utilities
│   ├── ground-truth/       ← Ground-truth data management
│   ├── identity/           ← Login-surface observer (retired: identity divergence)
│   ├── evidence/           ← Evidence tier scoring and grounding
│   │
│   └── config/
│       └── appConfig.ts    ← App config resolver (reads onboarding.<name>.config.ts)
│
├── apps/                   ← Per-app configs and generated test suites
│   └── desktop/
│       ├── ui/
│       │   ├── saucedemo/  ← SauceDemo onboarding config + generated specs
│       │   ├── orangehrm/  ← OrangeHRM onboarding config + generated specs
│       │   └── ultimateqa/ ← UltimateQA onboarding config + generated specs
│       └── api/
│           └── restful-booker/ ← Restful Booker onboarding config + API specs
│
├── platform/               ← ⚠️ DEPRECATED — do not add to this directory
│                             All UI work goes into forge-ui/
│
└── run.ts                  ← Full pipeline entry point
```

---

## forge-ui/ — The Platform UI

The canonical UI surface. React + TypeScript + Tailwind v3 + shadcn/ui + Express.
Communicates with the engine exclusively through `ExecutionContext` and the REST API.

```
forge-ui/
├── src/                    ← React application
│   ├── components/         ← Shared UI components
│   ├── pages/              ← Tab page components
│   │   ├── OnboardPage.tsx ← ✅ GREEN — 9 UX fixes, live log panel
│   │   ├── CrawlPage.tsx   ← ✅ GREEN — full crawl session management
│   │   ├── TestsPage.tsx   ← 🔄 In progress (TD-UI-003)
│   │   ├── ResultsPage.tsx ← 🔵 Stub
│   │   ├── InsightsPage.tsx ← 🔵 Stub ("Coming soon" — TD-UI-062)
│   │   └── SettingsPage.tsx ← 🔵 Stub
│   └── lib/                ← Utilities, ExecutionContext bridge, ProjectSession
│
├── server/                 ← Express REST API
│   ├── routes/             ← API routes (transport only — no business logic)
│   └── insights.ts         ← ⚠️ 501 stub (TD-UI-062)
│
├── package.json            ← forge-ui package (separate from root)
├── tsconfig.json           ← forge-ui TypeScript config
└── vite.config.ts          ← Vite build config
```

---

## scripts/ — Unit Test Suite

```
scripts/
├── verify-*.test.ts        ← ~60 unit test files (531 tests total)
│                             Tests for pipeline scripts, storage layer,
│                             utilities, and generator correctness
└── purge.ts                ← DB purge utility (destructive — use with caution)
```

---

## evals/ — AI Evaluation Harnesses

```
evals/
├── triage/                 ← Triage accuracy evaluation
│   └── *.eval.ts           ← Harness runner against ground-truth dataset
├── generation/             ← Generation correctness evaluation
│   └── *.eval.ts
├── healing/                ← Selector repair correctness evaluation
│   └── *.eval.ts
└── vision/                 ← Vision healer evaluation
    └── *.eval.ts
```

> Verify exact file names with CC. Structure above is from CC's directory summary.

---

## docs/ — Documentation

```
docs/
├── ADR/                    ← Architecture Decision Records
│   └── ADR-001 → ADR-020  ← 20 ADRs (001 through 020 confirmed)
├── TECH_DEBT.md            ← ⚠️ AUTHORITATIVE TD source (917 lines, 233 rows)
├── PRODUCT_VISION.md       ← ⚠️ Untracked — not in git (verify with Raj)
└── [this documentation]    ← All docs generated in this session
```

---

## models/ — Generated App Models

```
models/
├── saucedemo/              ← SauceDemo app model
│   └── app-model.json
├── orangehrm/              ← OrangeHRM app model
│   └── app-model.json
├── restful-booker/         ← Restful Booker app model
│   └── app-model.json
└── ultimateqa/             ← UltimateQA app model (4th target)
    └── app-model.json
```

---

## fixtures/ — Ground-Truth Datasets

```
fixtures/
└── ground-truth/           ← Labelled datasets for eval harnesses
```

---

## .github/ — CI/CD

```
.github/
└── workflows/
    └── e2e-pipeline.yml    ← CI pipeline (453 lines, 3 jobs)
```

> Note: the workflow file is `e2e-pipeline.yml` — not `ci.yml`.
> See CI_PIPELINE.md for full job breakdown.

---

## What Is Not Committed

| Path | Status | Notes |
|---|---|---|
| `reports/` | Not committed | Generated per run — 17+ dirs from 2026-07 |
| `logs/` | Not committed | Generated per run |
| `docs/PRODUCT_VISION.md` | Historical snapshot | Former root `CLAUDE.md` routing entry; the tracked live file is `docs/product/PRODUCT_VISION.md`, routed from root `AGENTS.md` |
| `notes/` | Untracked | |
| `forge-framework.db` | Not committed | Runtime-generated SQLite file |
| `forge-ui/dist/` | Not committed | Build output |
| `dist/` | Not committed | Build output |

---

*FORGE™ — AI-Augmented Quality Engineering Platform*
*AnvilQ Technologies LLC — Copyright © 2026 Raj Kasthuri*
