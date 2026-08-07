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

import { Crawler } from '../src/core/onboarding/Crawler'
import { PageDiscovery } from '../src/core/onboarding/types'

// TD-027 (BFS half) direct repro: constructs a small, realistic BFS crawl
// shape where visit-order and real outboundUrls disagree, then replays it
// through the real (private) buildRoleStateEdges() method to confirm the
// fix changes actual edge output, not just confirms an already-correct case.
//
// Shape: A (home) links to B (products) and C (about); B links to D (cart);
// C is a dead end. A real BFS queue visits in order A, B, C, D (A's two
// children get queued before B's child D is discovered) -- so visit-order
// pairing would wire B->C (siblings, B never links to C) and C->D (C has no
// outbound links at all; D is only reachable from B) -- both fabricated.

function page(id: string, outboundUrls: string[]): PageDiscovery {
  return {
    pageId: id, urlPattern: `/${id}`, elements: [],
    outboundUrls, domHash: '', isAuthPage: false,
  }
}

const A = 'https://example.com'
const B = 'https://example.com/products'
const C = 'https://example.com/about'
const D = 'https://example.com/cart'

const pages: PageDiscovery[] = [
  page('home',     [B, C]),
  page('products', [D]),
  page('about',    []),
  page('cart',     []),
]
const visited = new Set<string>([A, B, C, D])

const crawler = new (Crawler as any)({ app: { name: 't', baseUrl: A, appType: 'web-ui' }, roles: [] })

const oldStyleEdges = (crawler as any).buildRoleStateEdges(pages, visited, 'spa', 'guestPage')
const newBfsEdges    = (crawler as any).buildRoleStateEdges(pages, visited, 'bfs', 'guestPage')

const fmt = (edges: any[]) => edges.map(e => `${e.fromUrl.replace(A, '')||'/'} -> ${e.toUrl.replace(A, '')||'/'}`)

console.log('visit order: home, products, about, cart')
console.log('real links:  home->products, home->about, products->cart\n')

console.log('OLD construction (unchanged path, crawlMode=spa/hybrid) — visit-order pairs:')
fmt(oldStyleEdges).forEach(e => console.log(`  ${e}`))

console.log('\nNEW construction (crawlMode=bfs) — outboundUrls-based:')
fmt(newBfsEdges).forEach(e => console.log(`  ${e}`))

const expectedNew = new Set(['/ -> /products', '/ -> /about', '/products -> /cart'])
const actualNew   = new Set(fmt(newBfsEdges))
const fabricated  = fmt(oldStyleEdges).filter(e => !expectedNew.has(e))

console.log('\nFabricated edges old-style construction would have produced (sibling/dead-end artifacts):')
fabricated.forEach(e => console.log(`  ${e} -- WRONG, not a real link`))

const matches = actualNew.size === expectedNew.size && [...expectedNew].every(e => actualNew.has(e))
console.log(matches && fabricated.length > 0
  ? '\nPASS — new construction matches real links exactly; old construction would have fabricated edges the new one correctly omits'
  : '\nFAIL')
