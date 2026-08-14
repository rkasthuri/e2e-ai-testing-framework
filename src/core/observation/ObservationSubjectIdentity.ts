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

import * as crypto from 'crypto'
import type { EndpointDefinition } from '../onboarding/types'

export function canonicalEndpointSubjectId(endpoint: Pick<EndpointDefinition, 'method' | 'path'>): string {
  const identity = `${endpoint.method.toUpperCase()}\u0000${endpoint.path}`
  return `endpoint-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}
