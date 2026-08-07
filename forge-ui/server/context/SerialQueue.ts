/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or modification
 * of this software is strictly prohibited.
 */

/**
 * SerialQueue — a minimal async mutex (ADR-014). run() chains each task onto the
 * previous one so tasks execute strictly sequentially, never overlapping, even
 * when submitted concurrently. A task's rejection is isolated (swallowed on the
 * internal chain) so it never blocks later tasks; the caller still receives the
 * original resolution/rejection.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
