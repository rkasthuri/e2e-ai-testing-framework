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

import { Router } from 'express'
import https from 'https'
import http from 'http'
import { ok, fail } from '../http'

const router = Router()

/**
 * Reachability pre-check: HEAD first (cheap), fall back to GET if the server
 * rejects HEAD. Reachable = a response with status < 500 within 5s. Any
 * error/timeout → not reachable (never throws).
 */
export function checkReachability(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v) } }
    const timer = setTimeout(() => done(false), 5000)

    const tryRequest = (method: 'HEAD' | 'GET') => {
      const mod = url.startsWith('https') ? https : http
      const req = mod.request(url, { method }, (res) => {
        clearTimeout(timer)
        res.resume()   // drain
        done((res.statusCode ?? 0) < 500)
      })
      req.on('error', () => {
        if (method === 'HEAD') tryRequest('GET')
        else { clearTimeout(timer); done(false) }
      })
      req.end()
    }
    tryRequest('HEAD')
  })
}

router.get('/', async (req, res) => {
  const url = req.query.url as string
  if (!url) return res.status(400).json(fail('URL required', 'MISSING_URL'))
  try { new URL(url) } catch {
    return res.json(ok({ reachable: false, message: 'Please enter a valid URL' }))
  }
  const reachable = await checkReachability(url)
  res.json(ok({
    reachable,
    message: reachable
      ? 'URL is reachable'
      : 'Cannot reach this URL — check the address and try again',
  }))
})

export default router
