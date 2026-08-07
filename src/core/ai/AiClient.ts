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

import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../storage/db';
import { AiCallParams, AiResponse, AiProvider } from '../types';

export type { AiProvider };

// Stage → provider routing. Stages not listed here default to 'claude'.
const PROVIDER_BY_STAGE: Record<string, AiProvider> = {
  'release-notes': 'ollama',
};

// TD-074: local (Ollama) inference is CPU-bound and slow, so cap output tokens.
// min(caller, ceiling) — never inflates a smaller request; ceiling is
// OLLAMA_MAX_TOKENS (default 1024), env-overridable for one-off larger runs.
// Local-only; the Claude path keeps the caller's budget unchanged.
const LOCAL_DEFAULT_MAX = 1024;
function localMaxTokensFor(params: AiCallParams): number {
  const localCeiling = Number(process.env.OLLAMA_MAX_TOKENS) || LOCAL_DEFAULT_MAX;
  return Math.min(params.maxTokens ?? localCeiling, localCeiling);
}

// TD-076: cheap reachability ping for the local provider (2s budget). Used only
// for ollama-routed calls so claude calls pay zero overhead.
async function ollamaReachable(): Promise<boolean> {
  const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5':          { input: 0.003,   output: 0.015   },
  'claude-sonnet-4-20250514':   { input: 0.003,   output: 0.015   },
  'claude-opus-4-5':            { input: 0.015,   output: 0.075   },
  'claude-haiku-4-5-20251001':  { input: 0.00025, output: 0.00125 },
};

function estimateCost(model: string, input: number, output: number): number {
  const p = PRICING[model] ?? PRICING['claude-sonnet-4-5'];
  return (input / 1000) * p.input + (output / 1000) * p.output;
}

// ── Retry config (TD-053) ──────────────────────────────────────────────────────
// The Anthropic SDK retries connection failures only up to the point it has a
// response's headers; a body-streaming drop ('Premature close' / FetchError) is
// thrown AFTER that envelope and is never retried by the SDK. This module wraps
// aiCall() in an app-level retry that covers exactly those transient drops.
const MAX_ATTEMPTS      = 3;        // initial + 2 retries
const CLIENT_TIMEOUT_MS = 90_000;   // 90s per attempt — set on the client, not per-call
const BACKOFF_BASE_MS   = 1000;
const JITTER_MAX_MS     = 500;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Retry only on transient connection / body-stream drops — never on a real
 * Anthropic APIError (4xx/5xx), which is a genuine error, not a dropped pipe.
 * `APIConnectionError` (incl. its timeout subclass) is the SDK's connection-layer
 * error; FetchError / 'Premature close' are the body-stream drops the SDK misses.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  const e = err as { name?: string; message?: string };
  if (e?.name === 'FetchError') return true;
  if (typeof e?.message === 'string' && /premature close/i.test(e.message)) return true;
  return false;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    // timeout per attempt set here (not per-call). maxRetries: 0 so this module's
    // app-level wrapper is the single retry authority and "3 attempts maximum"
    // holds exactly — the SDK's own default of 2 retries would otherwise compound.
    _client = new Anthropic({
      apiKey:     process.env.ANTHROPIC_API_KEY,
      // SDK 0.32.1 bundles node-fetch (HTTP/1.1), which deterministically throws
      // "Premature close" on the CI bare ubuntu-latest runner (Node 24 / Linux),
      // while curl HTTP/2 and Node native fetch both return 200 there. Route the
      // SDK through native fetch. See TD-061 (diag branch diag/premature-close).
      // Remove this override if/when the SDK is upgraded (TD-062).
      fetch:      globalThis.fetch,
      timeout:    CLIENT_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return _client;
}

interface UsageRow {
  runId?:       string;
  appName:      string;
  operation:    string;
  provider:     AiProvider;
  model:        string;
  inputTokens:  number;
  outputTokens: number;
  durationMs:   number;
  success:      boolean;
  retryAttempt: number;
}

async function recordUsage(r: UsageRow): Promise<void> {
  try {
    // Cost honesty (TD-066 / evidence-layer §2): local (Ollama) calls cost $0 —
    // never let them inherit the Claude PRICING table, which would fabricate a cost.
    // (ai_usage has no provider column today; `model` distinguishes local vs API.)
    const estimatedCostUsd = r.provider === 'ollama'
      ? 0
      : estimateCost(r.model, r.inputTokens, r.outputTokens);
    await getDb().insertInto('ai_usage').values({
      run_id:             r.runId ?? null,
      app_name:           r.appName,
      operation:          r.operation,
      model:              r.model,
      input_tokens:       r.inputTokens,
      output_tokens:      r.outputTokens,
      total_tokens:       r.inputTokens + r.outputTokens,
      estimated_cost_usd: estimatedCostUsd,
      duration_ms:        r.durationMs,
      triggered_by:       process.env.TRIGGERED_BY || 'manual',
      success:            r.success ? 1 : 0,
      recorded_at:        new Date().toISOString(),
      retry_attempt:      r.retryAttempt,
    }).execute();
  } catch (dbErr) {
    console.warn('[AiClient] Failed to record ai_usage:', dbErr);
  }
}

// Internal per-attempt result both provider paths return; the shared aiCall loop
// builds AiResponse + records usage from it.
interface ProviderResult {
  content:      string;
  inputTokens:  number;
  outputTokens: number;
  model:        string;
}

// ── Claude path — extracted verbatim from the previous aiCall body ──────────────
// getClient() + new Anthropic({...}) (TD-061 fetch/timeout/maxRetries) UNCHANGED.
async function callClaude(params: AiCallParams): Promise<ProviderResult> {
  const model = process.env.AI_MODEL || 'claude-sonnet-4-5';
  const response = await getClient().messages.create({
    model,
    max_tokens: params.maxTokens ?? 2000,
    system:     params.system,
    messages:   params.messages as Anthropic.MessageParam[],
  });
  const content = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
  return {
    content,
    inputTokens:  response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model,
  };
}

// ── Ollama path — OpenAI-compatible /v1/chat/completions ────────────────────────
async function callOllama(params: AiCallParams): Promise<ProviderResult> {
  for (const m of params.messages) {
    if (typeof m.content !== 'string') {
      throw new Error('Ollama path received non-text content (vision/multimodal is Claude-only)');
    }
  }

  const base  = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL   ?? 'mistral';
  const localMaxTokens = localMaxTokensFor(params);   // TD-074: local-capped budget
  // TD-074: CPU-bound local inference (~6.8 tok/s) needs more than the 120s default;
  // env-overridable, local-only (callClaude keeps its TD-061 client timeout).
  const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 300_000;  // 5 min default

  const res = await fetch(`${base}/v1/chat/completions`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        ...(params.system ? [{ role: 'system', content: params.system }] : []),
        ...params.messages,
      ],
      max_tokens: localMaxTokens,
      // no temperature — mirrors the Claude path
    }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Ollama HTTP ${res.status} ${res.statusText} ${body}`.trim().slice(0, 300)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const data = await res.json() as {
    choices?: { message?: { content?: string } }[];
    usage?:   { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content:      data.choices?.[0]?.message?.content ?? '',
    inputTokens:  data.usage?.prompt_tokens     ?? 0,   // if usage absent, 0 — do NOT estimate
    outputTokens: data.usage?.completion_tokens ?? 0,
    model,
  };
}

// Ollama retry predicate: transient transport only — network failure, timeout
// (AbortSignal), or HTTP 5xx. A 4xx is a real error and is NOT retried.
function isRetryableOllama(err: unknown): boolean {
  const e = err as { name?: string; status?: number };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return true;  // AbortSignal.timeout
  if (typeof e?.status === 'number') return e.status >= 500;
  if (e?.name === 'TypeError') return true;  // fetch network failure (e.g. ECONNREFUSED → 'fetch failed')
  return false;
}

export async function aiCall(params: AiCallParams): Promise<AiResponse> {
  const { operation, runId, appName } = params;

  // Resolve provider once: explicit override → stage routing → default 'claude'.
  let provider: AiProvider =
    params.provider ?? (params.stage ? PROVIDER_BY_STAGE[params.stage] : undefined) ?? 'claude';

  // TD-076: local routing must degrade gracefully when Ollama is unreachable.
  // Ping only for ollama-routed calls (zero overhead on claude). Interactive local
  // dev → honest hard stop; CI / non-interactive → fall back to Claude (logged).
  if (provider === 'ollama' && !(await ollamaReachable())) {
    const interactive = Boolean(process.stdin.isTTY) && !process.env.CI;
    if (interactive) {
      console.error('[ai] Local LLM (Ollama) is down. Start it and re-run.');
      throw new Error('Local LLM is down');
    }
    console.log(`[ai] provider=ollama unreachable → falling back to claude (stage=${params.stage ?? 'n/a'})`);
    provider = 'claude';
  }

  // Model the call will use (env-derived; deterministic) — for logging + failure rows.
  const callModel = provider === 'ollama'
    ? (process.env.OLLAMA_MODEL ?? 'mistral')
    : (process.env.AI_MODEL    ?? 'claude-sonnet-4-5');
  const logMaxTok = provider === 'ollama' ? localMaxTokensFor(params) : (params.maxTokens ?? 2000);
  console.log(`[ai] provider=${provider} model=${callModel} stage=${params.stage ?? 'n/a'} op=${operation} maxTok=${logMaxTok}`);

  let lastErr: unknown;
  // ONE shared 3-attempt retry loop (TD-053); the single attempt is dispatched by
  // provider, and per-attempt usage is recorded for both paths.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const start = Date.now();
    try {
      const r = provider === 'ollama' ? await callOllama(params) : await callClaude(params);
      const durationMs = Date.now() - start;

      await recordUsage({
        runId, appName, operation, provider, model: r.model,
        inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        durationMs, success: true, retryAttempt: attempt,
      });

      return { content: r.content, inputTokens: r.inputTokens, outputTokens: r.outputTokens, model: r.model, durationMs };

    } catch (err) {
      const durationMs = Date.now() - start;
      lastErr = err;
      await recordUsage({
        runId, appName, operation, provider, model: callModel,
        inputTokens: 0, outputTokens: 0,
        durationMs, success: false, retryAttempt: attempt,
      });

      const retryable     = provider === 'ollama' ? isRetryableOllama(err) : isRetryable(err);
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (!retryable || isLastAttempt) {
        throw err;
      }

      const backoff = BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * (JITTER_MAX_MS + 1));
      console.warn(`[AiClient] Retry attempt ${attempt + 1}/3 after ${err}`);
      await sleep(backoff);
    }
  }

  // Unreachable: the loop only exits via return (success) or throw (non-retryable
  // / final attempt). Present for type-safety / defensive clarity.
  throw lastErr;
}
