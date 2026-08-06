# TD-UI-063A FORGE Application Workspace: Overview

---

Document Authority:
A — Authoritative

Owner:
Architecture Authority

Source of Truth:
`forge-ui/src/components/application-workspace/` and its contract tests

Refresh Trigger:
Application workspace tabs, Overview fields, or read-model adapter boundary changes

Last Verified:
2026-07-30

---

## Purpose

TD-UI-063A establishes the Application workspace shell and its first tab,
Application Overview. The application is the primary product object; crawl,
model, execution, and other capabilities contribute evidence to that shared
understanding rather than becoming disconnected product silos.

## Overview contract

The Overview presents application identity, observation context, Project Status,
Truth Confidence, current understanding, recommendations, and evidence
visibility. It keeps current, stale, blocked, missing, and integrity-failed
evidence visible and explains why each displayed state exists.

The UI uses a typed structural extension of the TD-UI-062C model for fields not
yet carried by that model: observation context, application-model summary,
evidence summaries, and safe recommendations. The extension is an adapter
boundary, not a second domain policy.

## Incremental workspace boundary

`/application/overview` is the first stable workspace route. Observations,
Application Model, and Evidence are visible as clearly marked planned tabs only;
they are not implemented in this task. No API, persistence, migration, crawl,
engine, or execution behavior changes are part of TD-UI-063A.

No numeric application health score or completeness KPI is introduced. When no
safe recommendation exists, the Overview says so explicitly.
