# FORGE Architecture Review Scorecard Register

This register makes the accepted whole-system scores discoverable under
[ADR-026](../../ADR/ADR-026-independent-architecture-review-governance.md).
Detailed rationale lives in the immutable review artifacts.

| Category | [v1.0](FORGE_ARCHITECTURE_REVIEW_v1.0.md) | [v2.0](FORGE_ARCHITECTURE_REVIEW_v2.0.md) | Direction |
|---|---:|---:|---|
| Ownership clarity | 4.0 reconstructed | 8.5 reconstructed | Improved |
| Domain coherence | 5.0 reconstructed | 8.0 reconstructed | Improved |
| Layering | 5.0 reconstructed | 8.0 reconstructed | Improved |
| Persistence integrity | 4.0 reconstructed | 8.5 reconstructed | Improved |
| Failure honesty | 7.0 reconstructed | 8.5 reconstructed | Improved |
| Recovery design | 4.0 reconstructed | 8.0 reconstructed | Improved |
| Security boundary | 5.0 reconstructed | 8.5 reconstructed | Improved |
| Test/certification architecture | 7.0 reconstructed | 8.5 reconstructed | Improved |
| Scalability | 4.0 reconstructed | 4.3 reconstructed | Essentially unchanged |
| Maintainability | 6.0 reconstructed | 6.5 reconstructed | Improved slightly |
| Extensibility | 7.0 reconstructed | 6.0 reconstructed | Recalibrated downward |
| Technical-debt health | 8.0 reconstructed | 5.5 reconstructed | More debt made explicit |
| **Accepted overall** | **5.5** | **7.4** | **+1.9** |

Only the overall scores are recovered accepted review values. Category values
were reconstructed during TD-CONFIG-002 to express the recorded rationale and
must not be cited as verbatim v1/v2 measurements.

## Score challenge

- Strongest evidence the v2 score could be too high: cloud, multi-process, and
  tenant isolation are not designed, and legacy surface area remains large.
- Strongest evidence it could be too low: the complete adopted Product chain is
  guarded by immutable persistence, adversarial tests, and real proofs.
- Greatest uncertainty: extensibility beyond the local Product boundary.
- Critical issue not neutralized by the mean: local architecture is not
  cloud-safe.
