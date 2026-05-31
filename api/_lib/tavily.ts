import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tavily web-search integration.
 *
 * Tavily (https://tavily.com) is a search API built for LLMs: one call returns
 * ranked web results (+ an optional synthesised answer) with source URLs. We use
 * it to give live web grounding to the providers that have NONE of their own —
 * DeepSeek, OpenRouter and NVIDIA. (Gemini keeps its native Google-Search
 * grounding and does not use Tavily.)
 *
 * Credentials are admin-managed and server-only (never sent to the browser),
 * stored in the same sentinel-row pattern used by AI / Cotality settings, with a
 * TAVILY_API_KEY env-var fallback. Every search is best-effort: any failure
 * degrades silently to ungrounded (training-data-only) research.
 */

export const TAVILY_SETTINGS_SENTINEL = '__tavily_settings__';

export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

export type TavilySearchDepth = 'basic' | 'advanced';

export interface StoredTavilySettings {
  apiKey: string;
  enabled: boolean;
  /** Number of results to fetch + inject (1–10). */
  maxResults: number;
  /** 'basic' (faster, 1 credit) or 'advanced' (deeper, 2 credits). */
  searchDepth: TavilySearchDepth;
}

export const TAVILY_DEFAULT_SETTINGS: StoredTavilySettings = {
  apiKey: '',
  enabled: true,
  maxResults: 5,
  searchDepth: 'basic',
};

/* ── Persistence (sentinel row in `projects.admin` JSONB) ──────────────────── */

export async function loadTavilySettings(supabase: SupabaseClient): Promise<StoredTavilySettings | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('admin')
    .eq('name', TAVILY_SETTINGS_SENTINEL)
    .maybeSingle();
  if (error || !data) return null;

  const adminCol = (data as { admin: Record<string, unknown> }).admin ?? {};
  const t = (adminCol as { tavilySettings?: Partial<StoredTavilySettings> }).tavilySettings;
  if (!t) return null;

  const max = typeof t.maxResults === 'number' ? Math.min(10, Math.max(1, Math.round(t.maxResults))) : TAVILY_DEFAULT_SETTINGS.maxResults;
  return {
    apiKey: typeof t.apiKey === 'string' ? t.apiKey : '',
    enabled: t.enabled !== false,
    maxResults: max,
    searchDepth: t.searchDepth === 'advanced' ? 'advanced' : 'basic',
  };
}

export async function saveTavilySettings(supabase: SupabaseClient, settings: StoredTavilySettings): Promise<void> {
  const adminPayload = { tavilySettings: settings };
  const { data: existing } = await supabase
    .from('projects')
    .select('id')
    .eq('name', TAVILY_SETTINGS_SENTINEL)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('projects')
      .update({ admin: adminPayload, updated_at: new Date().toISOString() })
      .eq('name', TAVILY_SETTINGS_SENTINEL);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('projects')
      .insert({
        name: TAVILY_SETTINGS_SENTINEL,
        description: 'Tavily web-search settings (admin-managed). Do not edit directly.',
        admin: adminPayload,
        inputs: {},
      });
    if (error) throw new Error(error.message);
  }
}

export async function deleteTavilySettings(supabase: SupabaseClient): Promise<void> {
  await supabase.from('projects').delete().eq('name', TAVILY_SETTINGS_SENTINEL);
}

/**
 * Resolve active Tavily settings with precedence:
 *   1. Stored settings (admin UI), if enabled and an API key is present.
 *   2. Env var: TAVILY_API_KEY (+ optional TAVILY_MAX_RESULTS / TAVILY_SEARCH_DEPTH).
 * Returns null when no key is available anywhere.
 */
export async function resolveTavilySettings(
  supabase: SupabaseClient | null,
): Promise<(StoredTavilySettings & { source: 'stored' | 'env' }) | null> {
  if (supabase) {
    const stored = await loadTavilySettings(supabase);
    if (stored && stored.apiKey && stored.enabled) return { ...stored, source: 'stored' };
  }
  const envKey = process.env.TAVILY_API_KEY?.trim();
  if (envKey) {
    const envMax = parseInt(process.env.TAVILY_MAX_RESULTS?.trim() ?? '', 10);
    return {
      apiKey: envKey,
      enabled: true,
      maxResults: Number.isFinite(envMax) ? Math.min(10, Math.max(1, envMax)) : TAVILY_DEFAULT_SETTINGS.maxResults,
      searchDepth: process.env.TAVILY_SEARCH_DEPTH?.trim() === 'advanced' ? 'advanced' : 'basic',
      source: 'env',
    };
  }
  return null;
}

/* ── Search ────────────────────────────────────────────────────────────────── */

export class TavilyError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TavilyError';
    this.status = status;
  }
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export interface TavilySearchResponse {
  answer?: string;
  results: TavilyResult[];
}

/** Raw Tavily search call. Throws TavilyError on failure (used by the admin
 *  "Test" action so credential/quota problems surface). */
export async function tavilySearch(
  s: Pick<StoredTavilySettings, 'apiKey' | 'maxResults' | 'searchDepth'>,
  query: string,
): Promise<TavilySearchResponse> {
  let resp: Response;
  try {
    resp = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({
        query,
        search_depth: s.searchDepth,
        max_results: s.maxResults,
        include_answer: true,
      }),
    });
  } catch (e) {
    throw new TavilyError(`Could not reach Tavily: ${e instanceof Error ? e.message : 'network error'}`);
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    if (resp.status === 401) throw new TavilyError('Tavily API key is invalid. Update it in Admin → Tavily Search.', 401);
    if (resp.status === 429) throw new TavilyError('Tavily rate limit / monthly quota reached.', 429);
    throw new TavilyError(`Tavily request failed (HTTP ${resp.status}): ${txt.slice(0, 200)}`, resp.status);
  }
  const json = (await resp.json().catch(() => ({}))) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const results: TavilyResult[] = Array.isArray(json.results)
    ? json.results
        .filter(r => r && typeof r.url === 'string')
        .map(r => ({ title: r.title || r.url || '', url: r.url as string, content: r.content || '' }))
    : [];
  return { answer: typeof json.answer === 'string' ? json.answer : undefined, results };
}

export interface TavilyContext {
  /** Prompt-ready grounding block built from the search results. */
  promptBlock: string;
  /** Sources for the citation list. */
  sources: Array<{ title: string; url: string; snippet?: string }>;
  resultCount: number;
}

/**
 * Best-effort grounding context for prompt injection. Returns null (never
 * throws) when not configured or on any failure — the caller falls back to
 * ungrounded research.
 */
export async function fetchTavilyContext(
  s: StoredTavilySettings,
  query: string,
): Promise<TavilyContext | null> {
  if (!s.apiKey || !query.trim()) return null;
  let r: TavilySearchResponse;
  try {
    r = await tavilySearch(s, query);
  } catch {
    return null; // search problems must not break AI research
  }
  if (r.results.length === 0 && !r.answer) return null;

  const lines: string[] = [];
  if (r.answer) lines.push(`Search answer: ${r.answer}`, '');
  r.results.forEach((res, i) => {
    lines.push(`[${i + 1}] ${res.title}\n${res.url}\n${res.content.slice(0, 600)}`);
  });
  return {
    promptBlock: lines.join('\n'),
    sources: r.results.map(res => ({ title: res.title, url: res.url, snippet: res.content.slice(0, 160) })),
    resultCount: r.results.length,
  };
}

/** Mask a key like "tvly-abcd...wxyz" → "tvly-***wxyz". */
export function maskTavilyKey(key: string): string {
  if (key.length <= 9) return '***';
  return `${key.slice(0, 5)}***${key.slice(-4)}`;
}
