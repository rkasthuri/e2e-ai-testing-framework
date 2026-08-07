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
 * experiments/td-063-taxonomy/taxonomy-prompt.ts
 *
 * ISOLATED TD-063 experiment — NOT production. Does NOT import or modify
 * src/pipeline/ai-triage.ts or any production triage logic. It reuses
 * src/core/ai/AiClient.aiCall ONLY as the transport (it imports without
 * import-time side effects, and carries the TD-061 native-fetch fix + retry).
 * Calling aiCall records an `ai_usage` telemetry row per call — append-only,
 * no schema/code change — which is acceptable for an eval.
 *
 * Exports classifyFailure(testId, errorMessage) implementing a 5-category
 * taxonomy where `app-bug` requires POSITIVE evidence; a code invariant
 * downgrades evidence-free `app-bug` verdicts to `insufficient-evidence`.
 */
import { aiCall } from '../../src/core/ai/AiClient';

export type TaxonomyCategory =
  | 'app-bug'
  | 'test-defect'
  | 'infra-defect'
  | 'flaky'
  | 'insufficient-evidence';

export const CATEGORIES: TaxonomyCategory[] = [
  'app-bug', 'test-defect', 'infra-defect', 'flaky', 'insufficient-evidence',
];

export interface ClassifyResult {
  category:   TaxonomyCategory;
  confidence: 'high' | 'medium' | 'low';
  evidence:   string;
  reasoning:  string;
  overridden: boolean;   // true if the code invariant forced insufficient-evidence
  raw?:       string;    // raw model text, kept on parse failure for debugging
}

const SYSTEM = [
  'You are a precise CI test-failure triage classifier for an E2E testing platform.',
  'Classify a single failed test into EXACTLY ONE of these five categories:',
  '',
  '- app-bug              : a real defect in the application under test.',
  '- test-defect          : the test/spec itself is wrong (bad selector, wrong assertion, faulty logic).',
  '- infra-defect         : pipeline/environment/page-load failure — not the app, not the test.',
  '- flaky                : intermittent; would likely pass on retry.',
  '- insufficient-evidence: cannot determine from the available evidence.',
  '',
  'CRITICAL RULES:',
  '- Classify app-bug ONLY with POSITIVE evidence of an application defect:',
  '  an HTTP 5xx, an application error banner/UI, OR a business assertion failing',
  '  while infrastructure and selectors are verified healthy.',
  '- If app-bug cannot be positively evidenced, do NOT guess app-bug — use insufficient-evidence.',
  '- A selector that did not match, a timeout waiting for an element/locator, or an',
  '  assertion written in the test is evidence of test-defect or infra-defect, NOT app-bug.',
  '- "evidence" must quote/point to the specific signal you used; do not write generic filler.',
  '',
  'Return STRICT JSON ONLY — no prose, no markdown, no code fences — exactly:',
  '{"category":"app-bug|test-defect|infra-defect|flaky|insufficient-evidence",' +
    '"confidence":"high|medium|low",' +
    '"evidence":"<specific signal that supports this>",' +
    '"reasoning":"<1-2 sentences>"}',
].join('\n');

function buildUserPrompt(testId: string, errorMessage: string): string {
  return [
    `Test ID: ${testId}`,
    '',
    'Failure error message:',
    '"""',
    (errorMessage || '(no error message captured)').slice(0, 4000),
    '"""',
    '',
    'Classify this failure. Return strict JSON only.',
  ].join('\n');
}

// Strip optional code fences and extract the first JSON object.
function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

// Evidence is "weak" (insufficient to justify the high-stakes app-bug label) when it is
// empty/missing, too short to be specific, or a generic non-specific phrase. Conservative
// by design: the AI supplies judgment; this code enforces the evidence requirement.
function isWeakEvidence(evidence: unknown): boolean {
  if (typeof evidence !== 'string') return true;
  const e = evidence.trim().toLowerCase();
  if (e.length < 12) return true;
  const generic = new Set([
    'test failed', 'failure', 'error', 'error occurred', 'an error occurred',
    'the test failed', 'assertion failed', 'unknown', 'n/a', 'none', 'see error',
    'no evidence', 'unclear',
  ]);
  return generic.has(e);
}

export async function classifyFailure(testId: string, errorMessage: string): Promise<ClassifyResult> {
  const resp = await aiCall({
    operation: 'triage',
    appName:   'td-063-eval',
    system:    SYSTEM,
    messages:  [{ role: 'user', content: buildUserPrompt(testId, errorMessage) }],
    maxTokens: 600,
  });

  const parsed = extractJson(resp.content);
  if (!parsed) {
    return {
      category: 'insufficient-evidence', confidence: 'low',
      evidence: '', reasoning: 'Model returned unparseable output.',
      overridden: false, raw: resp.content.slice(0, 300),
    };
  }

  let category = String(parsed.category ?? '').trim() as TaxonomyCategory;
  if (!CATEGORIES.includes(category)) {
    console.warn(`[taxonomy] invalid category ${JSON.stringify(parsed.category)} for "${testId}" -> insufficient-evidence`);
    category = 'insufficient-evidence';
  }
  const confidence = (['high', 'medium', 'low'].includes(parsed.confidence as string)
    ? parsed.confidence : 'low') as ClassifyResult['confidence'];
  const evidence  = typeof parsed.evidence  === 'string' ? parsed.evidence  : '';
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

  // CODE INVARIANT: app-bug requires positive, specific evidence. AI judges; code enforces.
  let overridden = false;
  if (category === 'app-bug' && isWeakEvidence(evidence)) {
    console.warn(`[invariant] OVERRIDE app-bug -> insufficient-evidence for "${testId}" (weak/empty evidence: ${JSON.stringify(evidence)})`);
    category = 'insufficient-evidence';
    overridden = true;
  }

  return { category, confidence, evidence, reasoning, overridden };
}
