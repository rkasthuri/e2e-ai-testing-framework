# TD-UI-063C Application Workspace: Application Model

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`forge-ui/src/components/application-workspace/ApplicationModel.tsx` and its contract tests

Refresh Trigger:
Application Model state, subject provenance, currency, or limitation presentation changes

Last Verified:
2026-07-30

---

## Purpose and boundary

TD-UI-063C adds the Application Model tab at `/application/model`. It presents
what FORGE currently understands about observed application structure while
clearly distinguishing that model from the application itself.

The UI does not create or regenerate models, infer currency, merge observation
contexts, calculate completeness, or interpret evidence. Those meanings arrive
through a typed read-model adapter.

## Presentation contract

The tab presents model state, revision and timestamps, source observations,
currency evidence, modeled subjects, direct-vs-derived basis, unobserved scope,
limitations, unknowns, blockers, impact, prevented stronger states, and safe
recommendations. No subjects means no structure claim; item counts are never a
completeness or health metric.

Unavailable, stale, blocked, incomplete, integrity-limited, conflicting, and
unknown states remain visible. A missing safe recommendation is stated
explicitly.

## Boundary extension

`applicationModelTypes.ts` is a structural UI-side extension of the existing
read-model boundary. It adds only presentation inputs not available in the
current model: model identity/state, subjects, provenance links, limitations,
and recommendations. No persistence, migration, API, crawl, engine, or model
generation behavior changes are part of TD-UI-063C.
