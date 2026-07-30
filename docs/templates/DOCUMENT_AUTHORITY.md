# Document Authority Metadata Template

Use this block near the top of a FORGE document. Replace every bracketed value.
Do not label a document authoritative merely because it is important.

```markdown
---

Document Authority:
[A — Authoritative | B — Operational | C — Status/Snapshot | D — Historical | E — Reference]

Owner:
[Accountable role]

Source of Truth:
[Code, test, workflow, configuration, ADR, ledger, or other authority]

Refresh Trigger:
[Event that requires this document to be reviewed]

Last Verified:
[YYYY-MM-DD or "Not yet verified"]

---
```

## Usage Rules

- **Authoritative** documents define durable rules, decisions, ownership, or
  product direction. Their implementation claims still require executable
  evidence.
- **Operational** documents must be checked whenever their commands, scripts,
  configuration, launch paths, validation behavior, or troubleshooting paths
  change.
- **Status/Snapshot** documents must state their verification date and must not
  be treated as current without rechecking live evidence.
- **Historical** documents preserve their original context and must clearly say
  that they are not current guidance.
- **Reference** documents map or define terms. They should link to authorities
  instead of duplicating rules or volatile state.

If sources disagree, record the conflict. Current executable evidence governs
implemented behavior; the applicable ADR or governance authority governs intent
and constraints.
