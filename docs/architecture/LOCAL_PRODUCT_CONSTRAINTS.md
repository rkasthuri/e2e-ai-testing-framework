# FORGE Local Product Constraints

---

Document Authority:
A - Authoritative

Owner:
Architecture Authority

Source of Truth:
ADR-002, ADR-012 through ADR-014, ADR-022 through ADR-025, current runtime
composition, and certified tests

Refresh Trigger:
Deployment topology, persistence authority, process ownership, cancellation,
tenanting, or worker architecture changes

Last Verified:
2026-08-14

---

## Scope ruling

The current FORGE Product is a **single-host local Product**.

The following are **ACCEPTED LOCAL PRODUCT CONSTRAINTS** and are
**NOT CLOUD-SAFE**:

| Constraint | Current local behavior | Why it is not cloud-safe |
|---|---|---|
| Single host | Product services, UI server, runner, and workspaces share one host boundary | Host failure and remote-worker identity are not governed |
| SQLite workspace authority | Each selected Product workspace owns its SQLite database | Shared network filesystems, replicas, failover, and distributed transactions are unsupported |
| Process-local producer ownership | Observation and job ownership rely on explicit local process policy/leases | A different host cannot establish liveness or lost ownership from current evidence |
| Local cancellation signalling | Cancellation coordinates through local persisted lifecycle plus process-local execution control | Cross-worker signal delivery and acknowledgement do not exist |
| Process-global control plane | Registries and service composition live in one server process | Horizontal replicas would have divergent in-memory state |
| Local credential provider | Credential material is resolved for one operation in the local process | Remote secret distribution, tenant isolation, rotation, and worker attestation are undesigned |

These constraints are not defects for the current local Product. They become
blocking architecture conditions before any cloud, multi-process,
multi-tenant, distributed-runner, or horizontally scaled deployment.

## Explicit non-claims

FORGE does not currently claim:

- distributed locks or leases;
- remote worker identity or attestation;
- tenant-scoped authorization;
- PostgreSQL Product parity;
- queue durability or exactly-once delivery;
- distributed cancellation;
- multi-host recovery; or
- cloud secret-management integration.

## Future gate

Do not extend local locks, SQLite rows, or process registries piecemeal into a
cloud design. A separately approved architecture TD and independent review must
define tenant authority, worker identity, durable command/event delivery,
persistence topology, secret distribution, and recovery semantics first.
