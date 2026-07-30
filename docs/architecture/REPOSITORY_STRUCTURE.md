# REPOSITORY_STRUCTURE.md

---

Document Authority:
E — Reference

Owner:
Engineering Documentation Owner

Source of Truth:
Current tracked repository tree and the ownership map in
[CODEBASE_MAP.md](CODEBASE_MAP.md)

Refresh Trigger:
Top-level directories, durable entry points, or ownership boundaries change

Last Verified:
2026-07-30

---

This document is a navigation map, not a second implementation description.
Use [CODEBASE_MAP.md](CODEBASE_MAP.md) for module responsibilities and
[DOCUMENTATION_INDEX.md](../DOCUMENTATION_INDEX.md) for documentation authority.

## Top-Level Layout

```text
forge-framework/
├── src/                    engine and storage services
├── src/apps/               application-specific onboarding and generated tests
├── forge-ui/               canonical local React + Express UI
├── scripts/                unit proofs, validation, and rehearsals
├── evals/                  AI evaluation harnesses and datasets
├── models/                 generated App Model JSON artifacts
├── fixtures/               ground-truth and test fixtures
├── docs/                   governance, architecture, operations, status, history
├── .github/workflows/      CI workflow definitions
├── reports/                generated run reports (working artifacts)
├── logs/                   generated logs (working artifacts)
└── notes/review-scratch/   ignored audit and review captures
```

## Navigation by Task

| Need | Start here | Verify against |
|---|---|---|
| Agent instructions | `AGENTS.md` | Governance documents it routes to |
| Human/AI documentation routing | `docs/START_HERE.md` | `docs/DOCUMENTATION_INDEX.md` |
| Architecture decision | `docs/ADR/` | Code, tests, and migrations |
| Engine module ownership | `docs/architecture/CODEBASE_MAP.md` | Current imports and source tree |
| Local setup and launch | `docs/project/BUILD_AND_RUN.md` | `package.json`, CLI, server code |
| CI behavior | `docs/project/CI_PIPELINE.md` | `.github/workflows/e2e-pipeline.yml` |
| Validation contract | `docs/project/FORGE_VALIDATION_BASELINE.md` | Validation scripts and reports |
| Current project state | `docs/project/PROJECT_STATE.md` | Git, CI, and root `TECH_DEBT.md` |

## Important Boundaries

- `forge-ui/` is the canonical UI. The retired monolithic
  `src/platform/platform-server.ts` is historical and fails closed.
- `src/core/storage/` owns SQLite schema, migrations, repositories, App Model
  persistence, and guarded recovery writes.
- Migration 018 adds paired nullable recovery provenance fields.
- `scripts/*.test.ts` is normal unit discovery. The TD-184B SauceDemo rehearsal
  is explicit and disposable: `npm run test:rehearsal:td184b3`.
- CI workflow files define current-run identity and evidence enforcement.
- `models/`, `reports/`, and `logs/` contain generated or runtime artifacts; do
  not treat them as architecture authority.

## Consolidation Note

`CODEBASE_MAP.md` owns module and dependency responsibility. This document owns
directory navigation and durable entry points. Avoid adding implementation
tables, test counts, migration counts, or TD status here; link to the owner
instead. Future documentation work may consolidate these maps further, but this
document remains a navigation surface for now.
