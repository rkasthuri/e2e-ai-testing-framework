# FORGE Architecture Review Trend: v1.0 to v2.0

Governed by [ADR-026](../../ADR/ADR-026-independent-architecture-review-governance.md).
This comparison was formed from the accepted v1/v2 conclusions after the v2
finding set was frozen. Both source artifacts carry explicit reconstruction
notices because the original chat bodies were not repository artifacts.

## Comparability

**Current review:** [v2.0](FORGE_ARCHITECTURE_REVIEW_v2.0.md)

**Prior review:** [v1.0](FORGE_ARCHITECTURE_REVIEW_v1.0.md)

**Scope comparison:** comparable whole local Product architecture

**Metric change:** ADR-026's 12-category scorecard was reconstructed for both
artifacts; only the accepted overall scores are original fixed values

**Non-comparable area:** category-level deltas are directional reconstruction,
not original-review measurements

## Score trend

| Category | v1 reconstructed | v2 reconstructed | Delta | Evidence-backed explanation |
|---|---:|---:|---:|---|
| Ownership clarity | 4.0 | 8.5 | +4.5 | Core services and repositories now own canonical Product truth |
| Domain coherence | 5.0 | 8.0 | +3.0 | Observation, support, Definition, Execution, Run, and Result identities are separate |
| Layering | 5.0 | 8.0 | +3.0 | Controllers transport and UI renders typed projections |
| Persistence integrity | 4.0 | 8.5 | +4.5 | M020-M027, immutable support, manifests, artifacts, and Results |
| Failure honesty | 7.0 | 8.5 | +1.5 | Absence, gaps, refusals, and weakest-truth aggregation are fail-closed |
| Recovery design | 4.0 | 8.0 | +4.0 | Recovery is evidence-based and persistence-derived within one host |
| Security boundary | 5.0 | 8.5 | +3.5 | Operation-scoped credentials and governed text/artifact admission |
| Test/certification architecture | 7.0 | 8.5 | +1.5 | Adversarial, migration, persistence, real-proof, and process gates |
| Scalability | 4.0 | 4.3 | +0.3 | Local constraints are explicit but still not cloud-safe |
| Maintainability | 6.0 | 6.5 | +0.5 | Canonical ownership improved; compatibility surface remains large |
| Extensibility | 7.0 | 6.0 | -1.0 | Earlier optimism was corrected: cloud/plugin seams are not yet governed |
| Technical-debt health | 8.0 | 5.5 | -2.5 | Hardening exposed malformed models and configuration debt that needed registration |
| **Overall** | **5.5** | **7.4** | **+1.9** | Accepted review scores; material improvement with bounded remaining risks |

## Resolved RED findings

| v1 RED finding | v2 disposition | Current evidence |
|---|---|---|
| No single Observation authority | Resolved for adopted Product crawl vertical | ADR-027; `ObservationService`; `ObservationRepository`; read projection tests |
| Fragmented Execution/Run/Result authority | Resolved for Product execution | ADR-023 through ADR-025; persisted aggregator and lifecycle tests |
| Incomplete credential/artifact boundary | Resolved for adopted Product paths | ADR-013 implementation note; TD-SEC-001 and Observation redaction tests |
| Non-atomic workspace/migration authority | Resolved | ADR-002/022; `DatabaseAuthority`; `MigrationContext`; migration tests |
| UI/controller truth reconstruction | Resolved for adopted Product vertical | Core projections and transport-only controllers under ADR-027/028 |

## Remaining RED findings from v2

| v2 RED finding | Post-review disposition |
|---|---|
| Certified architecture existed only in an unreconstructable dirty tree | Resolved by TD-CONFIG-001 C1-C3 linear reconstruction |
| Immutable review artifacts, ADR health, and accepted baseline registration were absent | Addressed by TD-CONFIG-002; this file is part of the certification candidate |

No additional RED finding is asserted resolved until the TD-CONFIG-002 commit
and its documentation certification exist.

## New findings

- The Architecture Hardening Program's large shared files made fine-grained
  historical reconstruction untruthful; a coarse canonical checkpoint was
  required.
- Five frozen files required explicit EOF-hygiene reauthorization rather than
  a weakened whitespace gate.
- The existing baseline mechanism could classify accepted debt, but no governed
  repository-local comparison input had been registered.

## Unchanged findings

- FORGE remains a local, single-host Product using workspace SQLite.
- Process-local ownership, cancellation, and control-plane registries are not
  cloud-safe.
- Historical compatibility remains intentionally retained and must not become
  fallback canonical authority.
- AI, healing, and legacy reporting require separate future authority review.

## Forecast accuracy

- **Accurate:** one authority per truth and transport-only UI materially reduced
  integrated ambiguity.
- **Inaccurate/over-optimistic:** v1 extensibility confidence did not account for
  the absence of governed tenant/distributed-worker boundaries.
- **Materialized early:** repository configuration entanglement blocked truthful
  fine-grained commits before it blocked Product behavior.
- **Contained accepted debt:** malformed App Model rows remain unchanged and are
  now fingerprint-registered.

## Verdict trend

**v1 verdict:** CONDITIONAL GO

**v2 verdict:** CONDITIONAL GO

The unchanged verdict does not mean unchanged architecture. The score rose by
1.9 because canonical ownership, persistence, recovery, security, and
certification materially improved. The condition changed from Product-authority
repair to configuration/governance closure. The hardening program worked for
the adopted local Product vertical; it did not create cloud readiness.
