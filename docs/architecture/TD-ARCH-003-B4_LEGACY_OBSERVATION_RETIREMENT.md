# TD-ARCH-003-B4 Legacy Observation Retirement

## Current authority inventory

- Active canonical producer: `ObservationService`, invoked for crawl by
  `CrawlObservationProducer` and `CrawlRunner`.
- Active canonical consumers: crawl history/latest, project detail, App Model
  history, Application Evidence Inventory, readiness, test design, execution,
  results context, and their UI/API projections.
- Compatibility readers: `ObservationStore`,
  `LegacyObservationCompatibilityProjection`, `ObservationHistoryPresenter`,
  `EvidenceLedgerController`, `EvidenceLedgerPresenter`, and
  `BootstrapEvidenceReader`.
- Historical importer: `ObservationImportService`; it has no runtime authority.

No active Product component writes legacy Observation files, mints an
Observation identity outside `ObservationService`, or interprets `operation_id`
as Observation provenance or support.

## Retirement stages

### Stage 1 â€” compatibility only (B4)

Keep the compatibility readers listed above. They are read only and reachable
only through explicitly labelled compatibility endpoints. Keep historical files
unchanged. Remove or quarantine any newly discovered active dependency.

### Stage 2 â€” no compatibility consumers (B5 candidate)

Inventory endpoint access and Product support requirements. Remove external
consumers of the explicit compatibility endpoints, preserve required historical
access through `ObservationImportService` reports and the canonical read
projection, and certify that no supported workflow needs file-era DTOs.

### Stage 3 â€” deletion (separately approved TD)

After retention and legal requirements are approved, delete the compatibility
reader, presenter, controller, bootstrap reader, their DTOs, and the explicit
compatibility routes. Historical data deletion or archival must be separately
authorized; B4 does not delete or rewrite it.

## Dead-path disposition

- KEEP FOR LEGACY: `forge-ui/server/registry/ObservationStore.ts`,
  `LegacyObservationCompatibilityProjection.ts`,
  `ObservationHistoryPresenter.ts`, `EvidenceLedgerPresenter.ts`,
  `BootstrapEvidenceReader.ts`, and
  `forge-ui/server/context/EvidenceLedgerController.ts`.
- REMOVE AFTER B5: compatibility-only HTTP routes and the compatibility files
  above, once supported consumers and retention obligations are zero.
- REMOVE NOW: no whole file. B4 removes only the unused writer surface and
  silent Product fallbacks; legacy deletion is explicitly out of scope.
