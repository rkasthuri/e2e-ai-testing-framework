# FORGE Accepted Offline Baseline Debt

---

Document Authority:
B - Operational

Owner:
Release Configuration Manager

Source of Truth:
Accepted baseline registration and the current read-only validation report

Refresh Trigger:
An accepted fingerprint changes, a debt row is repaired/retired, or baseline
comparison semantics change

Last Verified:
2026-08-14 at `5432840808d99b34e8a18a01f089054c16ffaec0`

---

TD-CONFIG-002 registers two pre-existing App Model findings as accepted
configuration debt. Acceptance permits comparison; it does not repair, bless,
or silently upgrade the malformed rows.

| Gate | Accepted fingerprint | Observed population | Classification |
|---|---|---|---|
| `storage.active-model-json` | `3c75df891801910b9d335109b05b37db867489b3aefe5ffc015fe352c4cfc3ef` | 1 invalid active row of 2 checked | BASELINE_DEBT |
| `storage.all-model-json` | `10a95e848d17bc97956635ec0ce38b957dbcf3c6b14ff30052cfc579e600cdd1` | 12 invalid rows of 19 checked | BASELINE_DEBT |

The machine-readable comparison input is
[`baselines/offline-app-model-debt-v1.json`](baselines/offline-app-model-debt-v1.json).
Run:

```text
npm run validate:baseline -- --profile offline --baseline docs/configuration/baselines/offline-app-model-debt-v1.json
```

An exact matching failure is classified `BASELINE_DEBT`. A changed fingerprint,
a new failing gate, or a different malformed-row population is
`NEW_REGRESSION`. The overall validation status remains `FAIL` while required
gates fail; baseline classification does not convert debt into a pass.

Do not regenerate this file from a dirty live database. Changing either
fingerprint requires an explicit configuration-debt review with read-only
database hash proof.
