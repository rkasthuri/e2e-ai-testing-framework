/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and
 * Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or
 * modification of this software is strictly
 * prohibited.
 */

import express from 'express'
import cors, { type CorsOptions } from 'cors'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { Request, Response, NextFunction } from 'express'
import { authMiddleware } from './context/AuthContext'
import { tenantMiddleware } from './context/TenantContext'
import { migrateFixtures } from './scripts/migrateFixtures'

import validateRouter from './routes/validate'
import projectsRouter from './routes/projects'
import crawlRouter from './routes/crawl'
import testsRouter from './routes/tests'
import runsRouter from './routes/runs'
import resultsRouter from './routes/results'
import insightsRouter from './routes/insights'
import settingsRouter from './routes/settings'
import streamRouter from './routes/stream'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Local-owner mode is safe only while the control plane is loopback-bound. */
export const LOCAL_ONLY_HOST = '127.0.0.1'

/** Browser origins accepted by the local control plane, including IPv6 loopback. */
export function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true

  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '[::1]'
      || parsed.hostname === '::1'
  } catch {
    return false
  }
}

/** Reject cross-origin browser requests before they can reach privileged routes. */
export function localOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin')
  if (isAllowedLocalOrigin(origin)) {
    next()
    return
  }

  res.status(403).json({
    error: 'FORGE UI accepts browser requests only from a local loopback origin.',
    code: 'LOCAL_ORIGIN_REQUIRED',
    timestamp: new Date().toISOString(),
  })
}

export const localCorsOptions: CorsOptions = {
  origin(origin, callback) {
    callback(null, isAllowedLocalOrigin(origin))
  },
}

/** Next port to try — ruling C: skip 3001 (reserved for platform-server). */
export function nextPort(port: number): number {
  return port === 3000 ? 3002 : port + 1
}

export async function startServer(port = 3000): Promise<number> {
  // TD-UI-013: ensure fixture apps have real workspaces so they appear active
  // in the project switcher. Idempotent — safe on the port-retry recursion.
  await migrateFixtures()

  const app = express()

  app.use(localOriginGuard)
  app.use(cors(localCorsOptions))
  app.use(express.json())
  app.use(authMiddleware)
  app.use(tenantMiddleware)

  // Versioned API. streamRouter shares the /runs mount (SSE at /:runId/stream);
  // it is registered after runsRouter, which only defines specific paths (not a
  // catch-all), so the SSE route is reachable.
  app.use('/api/v1/validate', validateRouter)   // ruling F: before other routes
  app.use('/api/v1/projects', projectsRouter)
  app.use('/api/v1/crawl', crawlRouter)
  app.use('/api/v1/tests', testsRouter)
  app.use('/api/v1/runs', runsRouter)
  app.use('/api/v1/runs', streamRouter)
  app.use('/api/v1/results', resultsRouter)
  app.use('/api/v1/insights', insightsRouter)
  app.use('/api/v1/settings', settingsRouter)

  // Serve FORGE brand assets from the repo root (TD-097: runtime path from
  // this file's location, not hardcoded). forge-ui/server → repo root is ../../.
  const repoRoot = path.resolve(__dirname, '../..')
  app.get('/forge-logo.png', (_req, res) => {
    res.sendFile(path.join(repoRoot, 'Forge-Tool.png'))
  })

  // Serve the built React app in production (Vite dev server handles dev).
  const distPath = path.resolve(__dirname, '../dist')
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })

  return new Promise<number>((resolve, reject) => {
    const server = app.listen(port, LOCAL_ONLY_HOST, () => {
      console.log(`[FORGE UI] Server bound to http://${LOCAL_ONLY_HOST}:${port}`)
      resolve(port)   // actual bound port (may differ from requested after auto-detect)
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && port < 3010) {
        const np = nextPort(port)
        console.log(`[FORGE UI] Port ${port} in use, trying ${np}...`)
        startServer(np).then(resolve).catch(reject)
      } else {
        reject(err)
      }
    })

    // Graceful shutdown (TD-131 pattern).
    process.once('SIGINT', () => {
      console.log('\n[FORGE UI] Shutting down...')
      server.close(() => process.exit(0))
    })
    process.once('SIGTERM', () => {
      server.close(() => process.exit(0))
    })
  })
}
