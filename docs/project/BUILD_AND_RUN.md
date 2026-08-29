# BUILD_AND_RUN.md

---

Document Authority:
B — Operational

Owner:
Engineering Operations

Source of Truth:
Actual CLI behavior, `package.json` scripts, server configuration, and executable
validation behavior

Refresh Trigger:
Prerequisites, package scripts, CLI commands, launch paths, ports, server
boundaries, validation commands, or troubleshooting behavior change

Last Verified:
2026-08-29

---

> Instructions for setting up, building, running, and debugging FORGE locally.
> This is the primary operational guide, but executable behavior remains the
> source of truth. Verify commands against `package.json`, the current CLI, and
> current CI evidence before reporting a result.

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 24.x | Required — do not use earlier versions |
| npm | 10.x+ | Bundled with Node 24 |
| Git | Any recent | |
| Anthropic API key | — | Required for all AI pipeline steps |
| Windows (primary) | — | `forgeUI.bat` and PowerShell scripts are Windows-specific |

---

## 2. First-Time Setup

```bash
# 1. Clone the repository
git clone https://github.com/rkasthuri/forge-framework.git
cd forge-framework

# 2. Install engine dependencies
npm install

# 3. Install Playwright browsers (Chromium required for CI; WebKit local-only)
npx playwright install chromium

# 4. Copy and configure environment variables
cp .env.example .env
# Edit .env — add required values (see Section 3)

# 5. Run database migrations
npm run db:migrate

# 6. Verify setup
npm run check           # TypeScript — must pass
npm run test:unit       # Unit tests — confirm the current count from real output
cd forge-ui && npm run check
```

The stabilization milestone passed 684/684 unit tests. Treat that as a dated
reference, not a permanent expected count: run the current suite and use its
actual output plus commit-matched CI evidence.

### Windows launcher fallback

If the machine's global PowerShell `npm` or `npx` shim is broken, do not treat
that environment failure as a FORGE Product failure. For the canonical local UI,
use the repository-owned launcher from the repository root:

```powershell
.\forgeUI.bat
```

After dependencies are installed, individual project tools can also be invoked
through their repository-local Windows launchers, for example
`.\node_modules\.bin\tsc.cmd`, `.\node_modules\.bin\tsx.cmd`, and
`.\node_modules\.bin\playwright.cmd`. On Windows, `npm.cmd` / `npx.cmd` may be
used when only the PowerShell `.ps1` shim is broken. These are setup workarounds;
they do not change package files or validation semantics.

---

## 3. Environment Variables

All credentials and API keys are set in `.env` at the repo root.
Never commit `.env`. Never hardcode values in source files.

**Required:**

| Variable | Description | Format |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key | `sk-ant-...` |

**App credentials (per role, per app):**

| Variable | App | Role | Format |
|---|---|---|---|
| `SAUCEDEMO_STANDARD_USER_CREDENTIALS` | SauceDemo | Standard user | `username:password` |
| `SAUCEDEMO_LOCKED_USER_CREDENTIALS` | SauceDemo | Locked user | `username:password` |
| `ORANGEHRM_ADMIN_CREDENTIALS` | OrangeHRM | Admin | `username:password` |

> For new apps, the credential env key name is defined in
> `src/apps/<platform>/<type>/<appname>/onboarding.<appname>.config.ts`
> under each role's `credentialsEnvKey` field.

**Optional:**

| Variable | Default | Description |
|---|---|---|
| `APP_NAME` | `saucedemo` | Target app — alternative to `--app=` flag |
| `BASE_URL` | From config | Override base URL without editing config |
| `TRIGGERED_BY` | `manual` | `ci` / `manual` / `platform` / `agent` |
| `ENVIRONMENT` | `local` | `local` / `ci` / `staging` / `production` |

---

## 4. Running Tests

### Type Check First (Always)

```bash
npm run check           # Must pass before any test run
```

### Test Execution Modes

```bash
npm run test            # Smoke — fast critical-path check
npm run test:all        # Stable suite — excludes @slow / @flaky
npm run test:full       # Everything including slow tests
npm run test:unit       # Automated unit discovery
npm run test:rehearsal:td184b3
                         # Explicit operator-only recovery rehearsal
npm run test:flaky      # @slow and @flaky tagged tests in isolation
```

The TD-184B recovery rehearsal is intentionally outside normal
`scripts/*.test.ts` unit discovery. Run it only through its explicit command; it
uses disposable storage and does not authorize mutation of live App Model data.

### Validation Baseline

Use the repository validation orchestrator when you need a bounded,
evidence-bearing assessment:

```bash
npm run validate:baseline -- --profile offline --db .forge/forge.db
```

The repository currently carries registered App Model baseline debt. For the
canonical comparison that distinguishes accepted debt from a new regression,
run:

```bash
npm run validate:baseline -- --profile offline --db .forge/forge.db --baseline docs/configuration/baselines/offline-app-model-debt-v1.json
```

The offline profile runs root/eval TypeScript checks, the complete automated unit
suite, the forge-ui TypeScript check, and read-only SQLite integrity checks.
Additional profiles and evidence semantics are documented in
[`FORGE_VALIDATION_BASELINE.md`](FORGE_VALIDATION_BASELINE.md).

Do not infer success from a historical count or a command merely completing.
Confirm the current command output, aggregate decision, repository commit, and
applicable CI evidence.

### Area-Specific (SauceDemo)

```bash
npm run test:login      # Login flow
npm run test:inventory  # Product listing
npm run test:cart       # Cart operations
npm run test:checkout   # Checkout flow
npm run test:e2e        # Full user journey
npm run test:edge       # Edge cases
npm run test:smoke      # Login + e2e (fastest coverage)
```

### API Tests (Restful Booker)

```bash
npm run test:api        # Full API suite
npm run test:api:verbose # With headed mode for debugging
npm run test:api:report  # Run + open HTML report
```

### View Reports

```bash
npm run test:report     # Open last Playwright HTML report
```

---

## 5. Onboarding a New Application

### Step 1 — Create the config file

```
src/apps/desktop/ui/<appname>/onboarding.<appname>.config.ts
```

Minimum config:

```typescript
export default {
  app: {
    name: '<appname>',
    displayName: '<Display Name>',
    baseUrl: 'https://example.com',
    appType: 'web-ui',   // platform discriminator; rendering/routing are observed separately
  },
  roles: [
    {
      id: 'admin',
      displayName: 'Admin',
      authFlow: 'form-login',
      credentialsEnvKey: 'MYAPP_ADMIN_CREDENTIALS',
    }
  ],
  budgets: {
    maxPages: 30,
    maxDepth: 4,
    aiCalls: 50,
  }
}
```

Add credentials to `.env`:
```bash
MYAPP_ADMIN_CREDENTIALS=admin@example.com:password123
```

### Step 2 — Run the pipeline

```bash
npm run onboard -- --app=<appname>         # Crawl
npm run onboard:verify -- --app=<appname>  # Verify
npm run onboard:generate -- --app=<appname> # Generate tests
```

### Step 3 — After app changes

```bash
npm run onboard:refresh -- --app=<appname>  # Re-crawl and refresh model
npm run impact                               # Identify affected tests
npm run fixes                                # Apply healing fixes
```

---

## 6. Running the AI Pipeline

These commands process the results of the last test run.
Always run in this order after a test suite execution:

```bash
npm run triage          # Classify failures (5 categories)
npm run store           # Persist results to SQLite
npm run fixes           # Apply adaptive fixes
npm run trends          # Analyse pass/fail trends
```

### Dry runs (preview without writing)

```bash
npm run fixes:dry       # Preview fixes — no files written
npm run impact:dry      # Preview impact — no changes applied
npm run generate:preview # Preview generated tests — no files written
npm run gaps:preview    # Preview gap-filling tests — no files written
```

---

## 7. Platform UI (forge-ui)

### Canonical launch path

```bash
forge ui                # Start the canonical forge-ui platform
forge ui --port=3002    # Request a specific port
```

For Vite development, run the control plane and Vite dev server separately:

```bash
cd forge-ui
npm run server           # Express control plane on 127.0.0.1:3000
npm run dev              # Vite UI, normally on http://localhost:5173
```

Alternatively, `forge ui` starts the production-serving control plane directly.
Starting only Vite leaves `/api` without a backend and the UI reports
`Backend unavailable`; it must not silently fall back to the empty state.

Or on Windows:
```
forgeUI.bat             # Double-click — portable Windows launcher
```

The deprecated `src/platform` server is retired. Its former `npm run platform`,
`npm run platform:dev`, and `npm run platform:stop` entry points fail closed;
direct execution of `src/platform/platform-server.ts` also fails before binding
a port. Use `forge ui` instead.

### Local-only security boundary

FORGE UI is a local development surface, not a remotely hosted service.

- The forge-ui server explicitly binds to a loopback interface.
- Browser requests are accepted only from expected local loopback origins.
- Unsafe external browser origins are rejected intentionally.
- Remote access and remote binding are unsupported. They require a separately
  designed and reviewed security model; do not bypass the boundary or suggest
  exposure workarounds.

Use the local URL reported by `forge ui`. A log message that says “localhost” is
not the security control—the enforced bind host and origin checks are.

### forge-ui local type check

```bash
cd forge-ui && npm run check    # Run before any forge-ui commit
```

> ⚠️ forge-ui tsc is NOT in CI (TD-UI-052). You must run it locally
> before committing any forge-ui changes. Aiden verifies this in diff review.

### forge-ui production build

```bash
cd forge-ui && npm run build    # Must exit 0 before push
```

---

## 8. Database

```bash
npm run db:status       # Row counts for all tables — quick health check
npm run db:migrate      # Run pending schema migrations
npm run db:migrate:down # Roll back last migration
npm run db:studio       # Instructions for opening DB in TablePlus / DB Browser
npm run db:purge        # ⚠️ DESTRUCTIVE — clears all run data, irreversible
```

---

## 9. Coverage and Gap Analysis

```bash
npm run coverage:gaps   # List all coverage gaps
npm run gaps:p0-only    # Generate tests for P0 (critical) gaps
npm run gaps:all        # Generate tests for all gaps
```

---

## 10. Visual and Performance Testing

```bash
# Visual regression (SauceDemo only)
npm run visual:baseline        # Capture baseline screenshots
npm run visual:compare         # Compare against baseline

# Cross-browser visual
npm run visual:cross-browser        # Compare across browsers
npm run visual:cross-browser:capture # Capture cross-browser baseline

# Performance
npm run perf:baseline          # Record performance baseline
npm run perf:compare           # Compare against baseline
```

---

## 11. Debugging

### Triage with full AI reasoning

```bash
npm run triage:verbose  # Full reasoning output + confidence scores
```

### Flaky test analysis

```bash
npm run predict:flaky           # All tests scored for flakiness risk
npm run predict:flaky:summary   # High-risk tests only
npm run predict:flaky:strict    # Tests above 60% threshold
```

### Query the knowledge base

```bash
npm run query           # Interactive knowledge base query
npm run query:rebuild   # Rebuild knowledge index from scratch
npm run query:ui        # Start web UI for knowledge queries
```

---

## 12. Common Problems

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm run check` fails on fresh clone | Dependencies not installed | `npm install` |
| Playwright tests fail immediately | Browser not installed | `npx playwright install chromium` |
| `ANTHROPIC_API_KEY` error | .env not configured | Copy `.env.example` to `.env`, add key |
| Auth fails for a role | Credentials not in .env | Add `<APP>_<ROLE>_CREDENTIALS=user:pass` |
| DB migration errors | Migrations out of sync | `npm run db:migrate` |
| `forge ui` cannot bind the requested port | Port in use | Choose another with `forge ui --port=<port>` |
| Type check fails in forge-ui | forge-ui types broken | `cd forge-ui && npm run check` |
| `lockedUser` auth fails on SauceDemo | Demo site account state | Check live SauceDemo — may be genuinely locked (TD-015) |

---

*FORGE™ — AI-Augmented Quality Engineering Platform*
*AnvilQ Technologies LLC — Copyright © 2026 Raj Kasthuri*
