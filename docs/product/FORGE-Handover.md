# FORGE — Historical Project Handover

---

Document Authority:
C — Status/Snapshot

Owner:
Documentation Owner

Source of Truth:
The dated baseline named below; current repository code, tests, CI evidence,
and [TECH_DEBT.md](../../TECH_DEBT.md) outrank this document

Refresh Trigger:
This document is retained as historical orientation only; create a new approved
snapshot when a future handover is required

Last Verified:
2026-07-30

---

> This is a historical orientation document, not an operational guide and not a
> source of current project truth. Start with [START_HERE.md](../START_HERE.md),
> [AGENTS.md](../../AGENTS.md), and
> [BUILD_AND_RUN.md](../project/BUILD_AND_RUN.md) for current navigation,
> implementation rules, and commands.

**Prepared:** 2026-07-20

**Historical baseline:** `b421a2d`

**Repository:** `github.com/rkasthuri/forge-framework`

**Owner / Architect:** Raj Kasthuri, AnvilQ Technologies LLC

## What This Snapshot Recorded

FORGE was an AI-augmented, app-agnostic quality engineering platform built
around an evidence-first thesis: confidence in test-suite health must be earned,
traceable, and allowed to remain unknown when evidence is insufficient.

The historical pipeline was described as onboarding, crawling, modeling,
verification, generation, execution, healing, triage, and reporting. The durable
architectural rationale belongs in the ADRs; this snapshot does not restate it.

## Historical Decision Themes

The baseline emphasized these decisions:

- provenance must follow evidence;
- composed truth cannot exceed its weakest constituent;
- detectors must stay within the vocabulary their observations support;
- confidence must be derived rather than assigned as a literal; and
- unsupported capabilities should be narrowed or retired rather than hidden
  behind a permissive gate.

Read the applicable ADRs for the authoritative rationale. In particular, see
ADR-015, ADR-017, ADR-018, ADR-019, ADR-020, and the later ADRs in
[`docs/ADR/`](../ADR/).

## Historical State — Do Not Reuse as Current Status

The original completion map, defect priorities, test counts, tab status, and
agent roles described the repository at `b421a2d`. They are preserved here to
explain the decisions made at that point, not to assert current health.

Since that baseline, the repository has completed a stabilization milestone:

- CI current-run evidence enforcement;
- TD-184A durable recovery provenance;
- TD-184B guarded invalid-active recovery and disposable rehearsal;
- legacy platform-server retirement containment; and
- local-only server binding and browser-origin enforcement.

The current canonical UI is `forge ui` / `forgeUI.bat` → `forge-ui`. The old
monolithic `src/platform/platform-server.ts` is retired: its former launch
commands and direct execution fail closed. This handover must not be used to
launch or revive it.

## How to Use This Document

Use this snapshot to understand why the project values evidence, provenance,
explicit uncertainty, and capability retirement. Do not use it to determine:

- current commands or launch paths;
- current test counts or CI status;
- current TD closure or priority;
- current UI completion; or
- current repository, branch, or storage state.

Verify those from the live repository and the current sources routed by
[START_HERE.md](../START_HERE.md).
