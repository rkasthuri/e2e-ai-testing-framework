/**
 * Synthetic structural analogue of the nine-page authenticated recovery crawl.
 * It intentionally contains no captured page content, credential material, or
 * live target values. Tests add runtime-only values to copies of this fixture.
 */
import type {
  AppModelCandidate,
  ElementDefinition,
  PageDefinition,
} from '../../src/core/onboarding/types'

function repeatedElement(pageId: string, index: number): ElementDefinition {
  return {
    id: `${pageId}:item${index}`,
    name: `item${index}`,
    kind: 'button',
    label: `Synthetic item ${index}`,
    critical: true,
    aiNamed: false,
    strategies: [{ type: 'data-test', value: `item-${index}`, confidence: 1 }],
    tier3Assertions: [],
    cardinality: { kind: 'repeated', index },
    observedState: 'visible',
    href: null,
  }
}

function page(id: string, index: number): PageDefinition {
  return {
    id,
    displayName: `Synthetic page ${index + 1}`,
    urlPattern: `/synthetic/${id}`,
    urlPatternType: 'exact',
    fingerprint: `synthetic-fingerprint-${index + 1}`,
    fingerprintBasis: 'url-only',
    appType: 'web-ui',
    accessibleByRoles: ['authenticated-user'],
    isAuthPage: false,
    elements: [
      repeatedElement(id, 0),
      repeatedElement(id, 1),
    ],
    module: {
      name: index === 0 ? 'Inventory' : 'Synthetic detail',
      confidence: 'medium',
      method: 'rule',
      evidenceIds: [id],
    },
  }
}

export function representativeNinePageCandidate(
  appName = 'rd2-disposable-nine-page',
): AppModelCandidate {
  const pageIds = [
    'inventory',
    'detail-1',
    'detail-2',
    'detail-3',
    'detail-4',
    'detail-5',
    'cart',
    'checkout',
    'confirmation',
  ]
  const pages = pageIds.map(page)
  return {
    schemaVersion: '2.0',
    generatedAt: '2026-08-05T16:00:00.000Z',
    generatedBy: 'engine',
    classificationRunId: 'rd2-disposable-run',
    app: {
      name: appName,
      displayName: 'RD2 disposable nine-page fixture',
      baseUrl: `https://${appName}.example.invalid`,
      appType: 'web-ui',
      spaConfig: null,
      evidenceState: 'crawled',
      crawlMetadata: {
        crawlConfigHash: 'rd2-disposable-config-hash',
        crawledAt: '2026-08-05T16:00:00.000Z',
        crawledBy: 'engine',
        crawlDurationMs: 9,
        pagesBudget: 50,
        pagesDiscovered: 9,
        pagesSkipped: null,
        aiBudgetStatus: 'within-budget',
        crawlDiagnostics: null,
      },
    },
    roles: [{
      id: 'authenticated-user',
      displayName: 'Authenticated user',
      authFlow: 'form-login',
      credentialsEnvKey: 'RD2_FIXTURE_CREDENTIAL_REFERENCE',
      storageStatePath: null,
      reachablePageIds: pageIds,
      restrictedPageIds: [],
      authOutcome: 'succeeded',
      observedPostAuthUrl: `https://${appName}.example.invalid/synthetic/inventory`,
    }],
    pages,
    flows: [{
      id: 'synthetic-purchase-flow',
      displayName: 'Synthetic observed flow',
      confidence: 'observed',
      source: 'inferred',
      roleId: 'authenticated-user',
      steps: pageIds.slice(0, 3).map((pageId, index) => ({
        stepIndex: index,
        pageId,
        action: index === 0 ? 'start' : 'navigate',
        elementId: index === 0 ? null : `${pageIds[index - 1]}:item0`,
        targetPageId: index + 1 < 3 ? pageIds[index + 1] : null,
        value: null,
        grounding: 'observed',
      })),
      linkedApiEndpointIds: [],
    }],
    endpoints: null,
    api: null,
    diff: null,
  }
}
