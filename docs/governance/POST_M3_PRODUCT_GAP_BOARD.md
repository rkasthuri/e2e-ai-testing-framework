# Post-M3 Product Gap Board

---

Document Authority:
A — Authoritative

Owner:
Product Owner

Source of Truth:
Post-M3 deep-audit evidence, certified M1-M3 Product behavior, current code and
tests, and approved roadmap decisions

Refresh Trigger:
A gap changes priority, ownership, milestone, dependency, or evidence-backed
status; or a milestone opens or closes

Last Verified:
2026-08-29

---

This is the planning baseline after M3. It does not replace root
[`TECH_DEBT.md`](../../TECH_DEBT.md) as the technical-debt ledger, and it does
not prove a capability shipped. Executable evidence and milestone certification
remain required for implementation claims.

## Priority and effort conventions

- **P0:** Product truth discrepancy to close before M4 implementation.
- **P1:** next-milestone Product integration or intelligence dependency.
- **P2:** valuable parallel capability or bounded maintainability work.
- **P3:** deferred platform or future-product work.
- **Effort:** XS (up to 2 days), S (3-5 days), M (1-2 weeks), L (3-5 weeks),
  XL (more than 5 weeks), assuming one focused implementation stream.

## Prioritized board

| Gap ID | Priority | Audit severity | Track | Capability / area | Problem statement | Evidence / source | User / Product impact | Dependency | Recommended action | Milestone ownership | Effort | Status | Blocks next milestone? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUDIT-001 | P0 | HIGH | Product | Product positioning | Product copy described an autonomous v1 platform beyond the certified local M1-M3 scope. | Deep audit; `forge-ui/src/components/layout/AppShell.tsx`; public README | Users can mistake a bounded local Product for autonomous or enterprise-ready capability. | Certified M1-M3 scope | Use local, evidence-first positioning and separate shipped Product from research direction. | Truth Alignment | XS / 1 day | Closed | no |
| AUDIT-002 | P0 | HIGH | Product | Primary navigation | Insights, Settings, and Truth Board appeared beside working areas although their routes were placeholders or disconnected. | Deep audit; `forge-ui/src/components/layout/Header.tsx` and routed pages | Navigation promises capability that the Product cannot deliver. | None | Hide placeholders from primary navigation; keep direct routes explicitly labelled Preview / Coming Soon. | Truth Alignment | XS / 1 day | Closed | no |
| AUDIT-003 | P1 | HIGH | Intelligence | Failure triage, healing, Insights | Triage, healing, trends, and related utilities are legacy, evaluation-only, or disconnected from canonical Results. | Deep audit; canonical Results projection; legacy `src/core/triage`, `src/core/healing`, and pipeline utilities | Results do not yet explain or aggregate why failures occurred. | AUDIT-011; immutable Result evidence | Deliver evidence-gated classification and explanation through Result detail and Insights; exclude healing. | M4 | XL / 6-8 weeks | Open | yes |
| AUDIT-004 | P3 | BLOCKER | Platform | External beta security | Local auth/tenant contexts do not establish real authentication, authorization, tenant isolation, or cloud secret boundaries. | Deep audit; accepted local Product constraints | External users or shared deployments would have unsafe authority boundaries. | Separate security and deployment architecture | Design auth, RBAC, tenant isolation, secrets, upgrade, and operational support before external beta. | Deferred | XL / 8+ weeks | Deferred | no |
| AUDIT-005 | P2 | HIGH | Crawl | Crawl completeness | General application completeness and “any application” breadth are unproven; frontier measurement and app-specific assumptions remain. | Deep audit; crawl scorecard and current limitations | Users may receive incomplete application coverage without a defensible completeness claim. | Canonical Observation/App Model authority | Define completeness measures, remove app-specific assumptions, and certify additional structurally distinct targets. | Parallel | L / 3-5 weeks | Open | no |
| AUDIT-006 | P0 | MEDIUM | Platform | Legacy API surface | Top-level `/api/v1/tests`, `/runs`, `/results`, `/insights`, `/settings`, and run stream are mounted 501 stubs beside project-scoped canonical routes. | Deep audit; `forge-ui/server/index.ts`; `forge-ui/server/routes/` stubs | Integrators can mistake dead endpoints for supported API contracts. | Consumer inventory before removal | Mark as legacy compatibility stubs now; keep mounted until a separate consumer audit proves removal non-breaking. | Truth Alignment | XS / 1 day | Closed | no |
| AUDIT-007 | P0 | MEDIUM | Product | M3 Add to Suite | Promotion opened the Suite area without carrying the promoted Definition selection. | Deep audit; M3 success UI and Saved Suites workspace | Users had to rediscover context immediately after successful promotion. | Existing canonical candidate read | Carry the explicit Definition ID in navigation state and preselect only its matching canonical candidate; retain explicit Suite Save. | Truth Alignment | XS / 1-2 days | Closed | no |
| AUDIT-008 | P3 | MEDIUM | Platform | Settings / environment profiles | Product Settings, environment profiles, runner configuration, and supported configuration UX are incomplete. | Deep audit; Settings placeholder; local credential workflow | Operators need repository/environment knowledge and cannot manage reusable profiles in Product UI. | M4 needs assessment; security model for shared use | Implement only the minimum profile/configuration slice required by a certified Product workflow; defer broader settings. | Deferred | L / 3-5 weeks | Deferred | no |
| AUDIT-009 | P2 | MEDIUM | Governance | Architecture pressure | Large files and repeated contract evolution increase convergence and contract-drift risk. | Deep audit; M1-M3 implementation history; code-size findings | Changes become slower to review and integration defects surface late. | Frozen authority contracts; convergence spike | Decompose bounded owners only when touched, starting with high-change integration seams; do not redesign the canonical spine. | Parallel | M / 1-2 weeks per slice | Open | no |
| AUDIT-010 | P0 | HIGH | Governance | Current-state documentation | State, milestone, roadmap, codebase map, limitations, and debt summaries predated M1-M3 closure; migration ceiling stopped at 030. | Deep audit; named current-state documents; migrations 031-033 | Contributors plan from stale capability and authority claims. | M1-M3 closure evidence | Refresh current-state documents, separate active from closed history, and set the Product migration ceiling to 033. | Truth Alignment | S / 3-5 days | Closed | no |
| AUDIT-011 | P1 | HIGH | Intelligence | Results diagnostics and provenance | Immutable Results are trustworthy but do not yet project actionable diagnostic evidence and canonical classification/explanation. | Deep audit; Results list/detail projection | Users can see what failed but cannot reliably understand why or aggregate patterns. | Immutable Result/evidence aggregation; classification contract/eval | Add a diagnostic evidence projection, evidence-gated classification/refusal, explanation, Result detail, and aggregation. | M4 | L / 4-6 weeks | Open | yes |
| AUDIT-012 | P2 | MEDIUM | Tooling | Setup and validation noise | Global npm/npx shims can be broken and test output is noisy; repository-local launchers work. | Deep audit environment evidence; current build/run guide | Setup failures can be misclassified as Product failures and slow validation. | Existing repository dependencies | Document repository-local launcher workaround; later reduce test noise and add a setup diagnostic without package drift in this phase. | Parallel | S / 3-5 days | In Progress | no |

`Closed` above means the truth-alignment working tree contains the scoped
correction. It is not a release claim until required review, commit, and
commit-matched validation complete.

## Milestone recommendation

### M4 — Evidence-Gated Failure Intelligence

**Objective:**

```text
Immutable Result
-> diagnostic evidence projection
-> evidence-gated classification
-> explanation
-> Result detail
-> Insights aggregation
```

M4 owns AUDIT-003 and the relevant portion of AUDIT-011. It depends on the
existing immutable Result, persisted-evidence aggregation, project scoping,
failure vocabulary, refusal semantics, and an evaluation harness that proves
both honest refusal and classification correctness.

M4 explicitly excludes automatic healing, selector mutation, automatic repair
promotion, scheduling, cloud execution, and multi-tenancy. A classification
must not mutate the Result or manufacture missing evidence.

### M5 — Human-Reviewed Healing / Stability Proposals

After M4 establishes canonical diagnostic evidence and classification, M5 may
propose bounded stability or healing actions for human review. M5 must not turn
legacy healing behavior into canonical authority by reuse alone; proposal,
review, promotion, provenance, and rollback semantics require their own design
and certification.

## Post-M3 engineering process reset

1. **Shared physical contract first.** Core, UI, and certification consume one
   real contract artifact rather than parallel examples.
2. **Convergence spike before parallel implementation.** Prove Core, Product UI,
   transport, persistence, and certification can meet before splitting work.
3. **Three review levels.** Authority-critical changes receive full hostile and
   independent review; Product integration receives focused contract and
   integration review; Product polish uses normal implementation, tests, and
   diff review.
4. **Fixtures define semantics.** Product fixtures specify behavior, ordering,
   refusal, and grounding; the real Product owns opaque IDs, hashes, revisions,
   and derived authority.
5. **Real Product driver early.** Introduce the actual Product path near the
   start of a milestone, not only during final certification.
6. **Stop when frozen invariants are proven.** Do not extend certification into
   speculative micro-hardening that does not protect an approved invariant.

## Active versus closed planning view

- **Closed in Truth Alignment:** AUDIT-001, AUDIT-002, AUDIT-006,
  AUDIT-007, AUDIT-010.
- **M4 blockers/dependencies:** AUDIT-003 and AUDIT-011.
- **Parallel:** AUDIT-005, AUDIT-009, AUDIT-012.
- **Deferred platform:** AUDIT-004 and AUDIT-008.

Historical M1-M3 closure remains in
[`PRODUCT_TD_LEDGER.md`](PRODUCT_TD_LEDGER.md). This board carries forward open
planning only; it does not reopen certified authority contracts.
