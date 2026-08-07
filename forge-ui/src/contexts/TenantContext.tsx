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

import { createContext, useContext, type ReactNode } from 'react'

/**
 * TenantContext — Phase 1: always single tenant. Phase 2: real tenant isolation.
 * Nova-approved cloud-readiness stub.
 */
export interface Tenant {
  id: string
  name: string
}

export const LOCAL_TENANT: Tenant = {
  id: 'local',
  name: 'Local',
}

export const TenantContext = createContext<Tenant>(LOCAL_TENANT)
export const useTenant = () => useContext(TenantContext)

export function TenantProvider({ children }: { children: ReactNode }) {
  return <TenantContext.Provider value={LOCAL_TENANT}>{children}</TenantContext.Provider>
}
