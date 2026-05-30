import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  toGeminiApiModel,
  toDeepSeekApiModel,
  toOpenRouterApiModel,
  type AIProvider,
} from './aiSettings';

/**
 * Shared AI-research client. Performs a single grounded JSON-returning request
 * against the active provider (Gemini with Google Search grounding, or DeepSeek
 * JSON mode) and returns the parsed object plus any grounding citations.
 *
 * Unlike api/benchmarks/research.ts (which writes directly to the HTTP response
 * with bespoke error copy), this helper RETURNS structured data / throws, so it
 * can back multiple research endpoints. Throwing AIResearchError carries an HTTP
 * status the caller can forward.
 */

export interface AIResearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface AIResearchResult {
  json: Record<string, unknown>;
  groundingSources: AIResearchSource[];
  groundingUsed: boolean;
  provider: AIProvider;
  model: string;
}

export class AIResearchError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'AIResearchError';
    this.status = status;
  }
}

export interface RunAIResearchInput {
  provider: AIProvider;
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  /** Gemini only: use Google Search grounding (default true). Set false to skip
   *  the scarce free-tier grounding quota and run plain (no live web search). */
  useGrounding?: boolean;
}

export async function runAIResearch(input: RunAIResearchInput): Promise<AIResearchResult> {
  if (input.provider === 'deepseek') return runDeepSeek(input);
  if (input.provider === 'openrouter') return runOpenRouter(input);
  return runGemini(input);
}

/* ── Gemini (with Google Search grounding + quota fallback) ─────────────────── */

async function runGemini({ apiKey, model, systemPrompt, userPrompt, useGrounding = true }: RunAIResearchInput): Promise<AIResearchResult> {
  const client = new GoogleGenerativeAI(apiKey);
  const apiModelName = toGeminiApiModel(model);
  const isGen2 = apiModelName.startsWith('gemini-2');
  const groundingTool = isGen2 ? { googleSearch: {} } : { googleSearchRetrieval: {} };

  const call = async (grounding: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = { model: apiModelName, systemInstruction: systemPrompt };
    if (grounding) config.tools = [groundingTool];
    return client.getGenerativeModel(config).generateContent(userPrompt);
  };

  // When grounding is disabled by the admin, skip it entirely — this avoids the
  // scarce free-tier Google-Search grounding quota that 429s even on light use.
  let groundingUsed = useGrounding;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: any;
  try {
    if (!useGrounding) {
      response = await call(false);
    } else try {
      response = await call(true);
    } catch (err) {
      const m = err instanceof Error ? err.message : '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (err as any)?.code || (err as any)?.status || '';
      const quotaOrPerm =
        m.includes('RESOURCE_EXHAUSTED') || /\bquota\b/i.test(m) || /\b429\b/.test(m) || c === 429 ||
        m.includes('PERMISSION_DENIED') || /\b403\b/.test(m) || c === 403;
      if (!quotaOrPerm) throw err;
      groundingUsed = false;
      response = await call(false);
    }
  } catch (err) {
    throw mapGeminiError(err, apiModelName);
  }

  const text = response.response.text();
  const json = parseJsonResponse(text);
  if (!json) throw new AIResearchError('AI response did not contain valid JSON.', 502);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = (response.response as any)?.candidates ?? [];
  const grounding = candidates[0]?.groundingMetadata;
  const groundingSources: AIResearchSource[] = [];
  if (grounding?.groundingChunks) {
    for (const ch of grounding.groundingChunks) {
      const w = ch?.web;
      if (w?.uri) groundingSources.push({ title: w.title || w.uri, url: w.uri });
    }
  }

  return { json, groundingSources, groundingUsed, provider: 'gemini', model };
}

function mapGeminiError(err: unknown, apiModelName: string): AIResearchError {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const code = (err as any)?.code || (err as any)?.status || '';
  if (msg.includes('API key') || msg.includes('UNAUTHENTICATED') || /\b401\b/.test(msg)) {
    return new AIResearchError('Google Gemini API key is invalid. Update it in Admin → AI Settings.', 500);
  }
  if (msg.includes('NOT_FOUND') || /\b404\b/.test(msg) || code === 404) {
    return new AIResearchError(`Gemini model "${apiModelName}" not found. Pick another model in Admin → AI Settings.`, 502);
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || /\bquota\b/i.test(msg) || /\b429\b/.test(msg) || code === 429) {
    return new AIResearchError('Google Gemini quota / rate limit reached. Wait a minute, switch model, or enable billing.', 429);
  }
  return new AIResearchError(`AI research failed: ${msg}`, 500);
}

/* ── DeepSeek (JSON mode, no built-in web search) ──────────────────────────── */

async function runDeepSeek({ apiKey, model, systemPrompt, userPrompt }: RunAIResearchInput): Promise<AIResearchResult> {
  const apiModelName = toDeepSeekApiModel(model);
  let r: Response;
  try {
    r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: apiModelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        stream: false,
      }),
    });
  } catch (e) {
    throw new AIResearchError(`DeepSeek request failed: ${e instanceof Error ? e.message : 'network error'}`, 502);
  }

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (r.status === 401) throw new AIResearchError('DeepSeek API key is invalid. Update it in Admin → AI Settings.', 500);
    if (r.status === 402) throw new AIResearchError('DeepSeek API: insufficient balance.', 402);
    if (r.status === 429) throw new AIResearchError('DeepSeek API rate limit reached. Wait a minute and retry.', 429);
    throw new AIResearchError(`DeepSeek API error ${r.status}: ${t.slice(0, 200)}`, 502);
  }

  const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const json = parseJsonResponse(data.choices?.[0]?.message?.content ?? '');
  if (!json) throw new AIResearchError('DeepSeek response did not contain valid JSON.', 502);
  return { json, groundingSources: [], groundingUsed: false, provider: 'deepseek', model };
}

/* ── OpenRouter (OpenAI-compatible; most free models have no web search) ────── */

async function runOpenRouter({ apiKey, model, systemPrompt, userPrompt }: RunAIResearchInput): Promise<AIResearchResult> {
  const apiModelName = toOpenRouterApiModel(model);
  let r: Response;
  try {
    r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // Optional attribution headers used by OpenRouter for app ranking.
        'HTTP-Referer': 'https://feasibility.app',
        'X-Title': 'Feasibility Model',
      },
      body: JSON.stringify({
        model: apiModelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        // Many (not all) models honour JSON mode; parseJsonResponse covers the rest.
        response_format: { type: 'json_object' },
        temperature: 0.2,
        stream: false,
      }),
    });
  } catch (e) {
    throw new AIResearchError(`OpenRouter request failed: ${e instanceof Error ? e.message : 'network error'}`, 502);
  }

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (r.status === 401) throw new AIResearchError('OpenRouter API key is invalid. Update it in Admin → AI Settings.', 500);
    if (r.status === 402) throw new AIResearchError('OpenRouter: insufficient credits for this model. Pick a free model or top up.', 402);
    if (r.status === 429) throw new AIResearchError('OpenRouter rate limit reached. Wait a minute, or pick a different free model.', 429);
    if (r.status === 404) throw new AIResearchError(`OpenRouter model "${apiModelName}" not found. Refresh the free-model list in Admin → AI Settings.`, 502);
    throw new AIResearchError(`OpenRouter API error ${r.status}: ${t.slice(0, 200)}`, 502);
  }

  const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const json = parseJsonResponse(data.choices?.[0]?.message?.content ?? '');
  if (!json) throw new AIResearchError('OpenRouter response did not contain valid JSON. Some free models ignore JSON mode — try another.', 502);
  return { json, groundingSources: [], groundingUsed: false, provider: 'openrouter', model };
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

/**
 * Lightweight credential check — a minimal call per provider that verifies the
 * key + model respond, without requiring JSON output or web grounding. Throws
 * AIResearchError on failure; resolves on success. Used by the per-provider
 * "Test" button so each key can be verified independently of the active one.
 */
export async function pingAIProvider(input: { provider: AIProvider; model: string; apiKey: string }): Promise<void> {
  const { provider, model, apiKey } = input;

  if (provider === 'gemini') {
    const apiModelName = toGeminiApiModel(model);
    try {
      const client = new GoogleGenerativeAI(apiKey);
      const r = await client.getGenerativeModel({ model: apiModelName }).generateContent('Reply with the single word: OK');
      if (!r.response.text()) throw new AIResearchError('Empty response from Gemini.', 502);
    } catch (err) {
      if (err instanceof AIResearchError) throw err;
      throw mapGeminiError(err, apiModelName);
    }
    return;
  }

  // OpenAI-compatible providers (DeepSeek / OpenRouter).
  const url = provider === 'deepseek'
    ? 'https://api.deepseek.com/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions';
  const apiModelName = provider === 'deepseek' ? toDeepSeekApiModel(model) : toOpenRouterApiModel(model);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://feasibility.app'; headers['X-Title'] = 'Feasibility Model'; }

  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: apiModelName, messages: [{ role: 'user', content: 'Reply with the single word: OK' }], max_tokens: 5, stream: false }),
    });
  } catch (e) {
    throw new AIResearchError(`${provider} request failed: ${e instanceof Error ? e.message : 'network error'}`, 502);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (r.status === 401) throw new AIResearchError(`${provider} API key is invalid.`, 401);
    if (r.status === 402) throw new AIResearchError(`${provider}: insufficient balance/credits.`, 402);
    if (r.status === 429) throw new AIResearchError(`${provider} rate limit reached. Wait and retry.`, 429);
    if (r.status === 404) throw new AIResearchError(`${provider} model "${apiModelName}" not found.`, 404);
    throw new AIResearchError(`${provider} API error ${r.status}: ${t.slice(0, 200)}`, 502);
  }
}

export function parseJsonResponse(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { /* ignore */ }
    }
    return null;
  }
}

/** Merge grounding citations ahead of any model-declared sources, de-duped by URL. */
export function mergeSources(
  grounding: AIResearchSource[],
  declared: AIResearchSource[] | undefined,
): AIResearchSource[] {
  const seen = new Set(grounding.map(s => s.url));
  const extra = (declared ?? []).filter(s => s?.url && !seen.has(s.url));
  return [...grounding, ...extra];
}
