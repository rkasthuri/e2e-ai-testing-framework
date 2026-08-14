# Product and Legacy Database Authority

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
ADR-002, ADR-022, ADR-023, `src/core/storage/DatabaseAuthority.ts`, and the
database entry points that select an authority

Refresh Trigger:
Database modes, resolution, migration ceilings, legacy import policy, or
Product workspace scoping changes

Last Verified:
2026-08-11

---

Database location is not database authority. A caller establishes an explicit
authority before persistence; the selected mode determines location policy,
migration policy, legacy-import eligibility, Product eligibility, and whether
`DB_URL` may participate.

## Governed modes

| Mode | Location source | SQLite ceiling | Migration 004 import | Product schema authority | `DB_URL` |
|---|---|---|---|---|---|
| `PRODUCT_WORKSPACE` | Exact selected workspace `<root>/.forge/forge.db` | `025_historical_observation_import` | Forbidden; migration name is recorded with a governed no-op body | Yes | Ignored |
| `LEGACY_RUNTIME` | Repository-root `.forge/forge.db`, explicit `DB_PATH`, explicit reporter path, or governed legacy PostgreSQL URL | `025_historical_observation_import`; PostgreSQL remains capped at `020_execution_lifecycle` | Allowed only from the import root captured when authority is established | No, even where compatible tables exist | Allowed |
| `DISPOSABLE_CERTIFICATION` | Required explicit SQLite path | `025_historical_observation_import` | Forbidden; migration name is recorded with a governed no-op body | Eligible only so Product repositories can be certified hermetically | Ignored |

Migration ceilings are explicit constants. Adding a migration does not silently
expand any authority; the ceiling must move as part of an approved change.

## Entry-point classification

| Caller | Authority |
|---|---|
| `forge-ui` through `ExecutionContext` | `PRODUCT_WORKSPACE` resolved by selected `appName` |
| `CrawlRunner` through `DatabaseFactory` | `PRODUCT_WORKSPACE` supplied by its `Workspace` |
| current-workspace CLI generation and Product model migration | `PRODUCT_WORKSPACE` supplied by `Workspace` |
| fixture CLI crawl, verify, generate, and refresh | `LEGACY_RUNTIME` |
| `ForgeStreamingReporter`, `results-store`, purge, and migration CLI | `LEGACY_RUNTIME` |
| focused tests and disposable certification factories | `DISPOSABLE_CERTIFICATION` |
| unscoped compatibility calls to `getDb()` or `runMigrations()` | fail-contained as `LEGACY_RUNTIME`; never Product |

## Migration context and Migration 004

`src/core/storage/migrate.ts` supplies every migration with operation-scoped
authority provenance. Dialect-sensitive migrations read that context instead
of `DB_URL`. The context is asynchronous-operation scoped and does not mutate
process environment state.

The historical source of Migration 004 remains unchanged. Product and
disposable providers do not load its cwd-bound module and execute a no-op under
the same ordered migration name. Legacy SQLite loads it only while the current
directory still equals the captured legacy import root; a changed root is an
explicit refusal before the database is opened or migrated.

## Runtime provenance and process containment

An active handle exposes its authority mode, dialect, SQLite path, workspace
root where applicable, migration ceiling, legacy-import policy, Product
eligibility, and `DB_URL` policy. These are runtime control facts and are not
persisted because no durable forensic consumer currently requires a new table.

One process may select only one authority at a time. Re-selecting the identical
authority is idempotent; selecting a different mode, workspace, path, URL, or
legacy import root fails until `closeDb()` clears the handle and provenance.
The UI serial queue remains the current operation-scoped containment. Full
multi-process connection management is a later platform concern.

## Existing history

This model prevents new implicit contamination. It does not delete, reclassify,
or rewrite rows already present in a workspace. Existing history must be
audited read-only and remediated only through a separately approved,
provenance-preserving operation.
