import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Firecrawl web-search integration.
 *
 * Firecrawl (https://firecrawl.dev) is a search + scrape API for LLMs: one call
 * returns ranked web results and, optionally, the scraped page content as
 * markdown. Like Tavily it gives live web grounding to the providers that have
 * none of their own (DeepSeek, OpenRouter, NVIDIA); unlike Tavily it can return
 * full page text, which is materially better for benchmark research where the
 * numbers live in the body of a report rather than in a search snippet.
 *
 * Firecrawl is the DEFAULT primary search tool; Tavily is the fallback. The
 * order is configurable in Admin → AI Settings (webSearchPrimary), and the
 * selection logic lives in ./webSearch.ts.
 *
 * Credentials are admin-managed and server-only (never sent to the browser),
 * stored in the same sentinel-row pattern used by AI / Cotality / Tavily
 * settings, with a FIRECRAWL_API_KEY env-var fallback. Every search is
 * best-effort: any failure degrades to the fallback provider, then to
 * ungrounded research.
 */

export const FIRECRAWL_SETTINGS_SENTINEL = '__firecrawl_settings__';

export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev';
export const FIRECRAWL_DEFAULT_SEARCH_PATH = '/v2/search';

/** The sibling API version, tried once if the configured path 404s. */
const SEARCH_PATH_ALTERNATES: Record<string, string> = {
  '/v2/search': '/v1/search',
  '/v1/search': '/v2/search',
};

export interface StoredFirecrawlSettings {
  apiKey: string;
  enabled: boolean;
  /** Number of results to fetch + inject (1–10). Each result costs credits. */
  maxResults: number;
  /** API origin — override to point at a self-hosted Firecrawl instance. */
  apiBaseUrl: string;
  /** Search path. Firecrawl versions its API; both v1 and v2 are handled. */
  searchPath: string;
  /**
   * When true, ask Firecrawl to scrape each result and return markdown, giving
   * the model full page text instead of a search snippet. Much better grounding,
   * but costs more credits per search — off by default.
   */
  scrapeContent: boolean;
}

export const FIRECRAWL_DEFAULT_SETTINGS: StoredFirecrawlSettings = {
  apiKey: '',
  enabled: true,
  maxResults: 5,
  apiBaseUrl: FIRECRAWL_DEFAULT_BASE_URL,
  searchPath: FIRECRAWL_DEFAULT_SEARCH_PATH,
  scrapeContent: false,
};

/** Trim a trailing slash so base + path never doubles up. */
function normaliseBaseUrl(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
  return s || FIRECRAWL_DEFAULT_BASE_URL;
}

/** Ensure the path has exactly one leading slash. */
function normalisePath(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return FIRECRAWL_DEFAULT_SEARCH_PATH;
  return s.startsWith('/') ? s : `/${s}`;
}

function clampResults(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(10, Math.max(1, Math.round(raw)));
}

/* ── Persistence (sentinel row in `projects.admin` JSONB) ──────────────────── */

export async function loadFirecrawlSettings(supabase: SupabaseClient): Promise<StoredFirecrawlSettings | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('admin')
    .eq('name', FIRECRAWL_SETTINGS_SENTINEL)
    .maybeSingle();
  if (error || !data) return null;

  const adminCol = (data as { admin: Record<string, unknown> }).admin ?? {};
  const f = (adminCol as { firecrawlSettings?: Partial<StoredFirecrawlSettings> }).firecrawlSettings;
  if (!f) return null;

  return {
    apiKey: typeof f.apiKey === 'string' ? f.apiKey : '',
    enabled: f.enabled !== false,
    maxResults: clampResults(f.maxResults, FIRECRAWL_DEFAULT_SETTINGS.maxResults),
    apiBaseUrl: normaliseBaseUrl(f.apiBaseUrl),
    searchPath: normalisePath(f.searchPath),
    scrapeContent: f.scrapeContent === true,
  };
}

export async function saveFirecrawlSettings(supabase: SupabaseClient, settings: StoredFirecrawlSettings): Promise<void> {
  const adminPayload = { firecrawlSettings: settings };
  const { data: existing, error: lookupError } = await supabase
    .from('projects')
    .select('id')
    .eq('name', FIRECRAWL_SETTINGS_SENTINEL)
    .maybeSingle();

  // A failed lookup is not "no row yet" — see saveAISettings for the same guard.
  if (lookupError) throw new Error(`Could not read the Firecrawl settings row: ${lookupError.message}`);

  if (existing) {
    const { error } = await supabase
      .from('projects')
      .update({ admin: adminPayload, updated_at: new Date().toISOString() })
      .eq('name', FIRECRAWL_SETTINGS_SENTINEL);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('projects')
      .insert({
        name: FIRECRAWL_SETTINGS_SENTINEL,
        description: 'Firecrawl web-search settings (admin-managed). Do not edit directly.',
        admin: adminPayload,
        inputs: {},
      });
    if (error) throw new Error(error.message);
  }
}

export async function deleteFirecrawlSettings(supabase: SupabaseClient): Promise<void> {
  await supabase.from('projects').delete().eq('name', FIRECRAWL_SETTINGS_SENTINEL);
}

/**
 * Resolve active Firecrawl settings with precedence:
 *   1. Stored settings (admin UI), if enabled and an API key is present.
 *   2. Env vars: FIRECRAWL_API_KEY (+ optional FIRECRAWL_MAX_RESULTS /
 *      FIRECRAWL_API_BASE_URL / FIRECRAWL_SEARCH_PATH / FIRECRAWL_SCRAPE_CONTENT).
 * Returns null when no key is available anywhere.
 */
export async function resolveFirecrawlSettings(
  supabase: SupabaseClient | null,
): Promise<(StoredFirecrawlSettings & { source: 'stored' | 'env' }) | null> {
  if (supabase) {
    const stored = await loadFirecrawlSettings(supabase);
    if (stored && stored.apiKey && stored.enabled) return { ...stored, source: 'stored' };
  }
  const envKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (envKey) {
    const envMax = parseInt(process.env.FIRECRAWL_MAX_RESULTS?.trim() ?? '', 10);
    return {
      apiKey: envKey,
      enabled: true,
      maxResults: clampResults(envMax, FIRECRAWL_DEFAULT_SETTINGS.maxResults),
      apiBaseUrl: normaliseBaseUrl(process.env.FIRECRAWL_API_BASE_URL),
      searchPath: normalisePath(process.env.FIRECRAWL_SEARCH_PATH),
      scrapeContent: process.env.FIRECRAWL_SCRAPE_CONTENT?.trim() === 'true',
      source: 'env',
    };
  }
  return null;
}

/* ── Search ────────────────────────────────────────────────────────────────── */

export class FirecrawlError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FirecrawlError';
    this.status = status;
  }
}

export interface FirecrawlResult {
  title: string;
  url: string;
  content: string;
}

export interface FirecrawlSearchResponse {
  results: FirecrawlResult[];
  /** The path that actually answered — reported by the admin Test action so the
   *  operator can pin the working API version. */
  pathUsed: string;
}

interface RawResult {
  url?: unknown;
  title?: unknown;
  description?: unknown;
  markdown?: unknown;
  content?: unknown;
  snippet?: unknown;
}

/**
 * Pull the result array out of a Firecrawl response.
 *
 * The shape differs by API version: v1 returns `data` as a flat array, while v2
 * returns `data` as an object keyed by result category (`web`, `news`, …). Both
 * are accepted, so switching versions doesn't need a code change.
 */
function extractResults(json: unknown): RawResult[] {
  const root = json as { data?: unknown; results?: unknown } | null;
  if (!root || typeof root !== 'object') return [];

  const candidates: unknown[] = [root.data, root.results];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as RawResult[];
    if (c && typeof c === 'object') {
      // v2: { web: [...], news: [...], images: [...] } — web first, then any
      // other array-valued category, so news-only responses still ground.
      const obj = c as Record<string, unknown>;
      const ordered = ['web', 'news', ...Object.keys(obj).filter(k => k !== 'web' && k !== 'news')];
      const merged: RawResult[] = [];
      for (const k of ordered) if (Array.isArray(obj[k])) merged.push(...(obj[k] as RawResult[]));
      if (merged.length) return merged;
    }
  }
  return [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Raw Firecrawl search call. Throws FirecrawlError on failure (used by the
 *  admin "Test" action so credential/quota problems surface). */
export async function firecrawlSearch(
  s: Pick<StoredFirecrawlSettings, 'apiKey' | 'maxResults' | 'apiBaseUrl' | 'searchPath' | 'scrapeContent'>,
  query: string,
): Promise<FirecrawlSearchResponse> {
  const basePath = normalisePath(s.searchPath);
  const attempts = [basePath];
  const alt = SEARCH_PATH_ALTERNATES[basePath];
  if (alt) attempts.push(alt);

  let lastError: FirecrawlError | null = null;

  for (const path of attempts) {
    const url = `${normaliseBaseUrl(s.apiBaseUrl)}${path}`;
    const body: Record<string, unknown> = { query, limit: s.maxResults };
    if (s.scrapeContent) body.scrapeOptions = { formats: ['markdown'] };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new FirecrawlError(`Could not reach Firecrawl: ${e instanceof Error ? e.message : 'network error'}`);
    }

    if (resp.ok) {
      const json = await resp.json().catch(() => ({}));
      const results = extractResults(json)
        .filter(r => r && typeof r.url === 'string' && r.url)
        .map(r => ({
          title: str(r.title) || str(r.url),
          url: str(r.url),
          // Prefer scraped markdown, fall back to the search snippet.
          content: str(r.markdown) || str(r.content) || str(r.description) || str(r.snippet),
        }));
      return { results, pathUsed: path };
    }

    const txt = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403) {
      throw new FirecrawlError('Firecrawl API key is invalid or lacks access. Update it in Admin → Firecrawl Search.', resp.status);
    }
    if (resp.status === 402) {
      throw new FirecrawlError('Firecrawl credit balance exhausted — top up or lower the result count.', 402);
    }
    if (resp.status === 429) {
      throw new FirecrawlError('Firecrawl rate limit / quota reached.', 429);
    }
    lastError = new FirecrawlError(`Firecrawl request failed (HTTP ${resp.status}) at ${path}: ${txt.slice(0, 200)}`, resp.status);
    // Only a 404 justifies trying the sibling API version; anything else is a
    // real error that the other path would report identically.
    if (resp.status !== 404) throw lastError;
  }

  throw lastError ?? new FirecrawlError('Firecrawl request failed.');
}

export interface FirecrawlContext {
  /** Prompt-ready grounding block built from the search results. */
  promptBlock: string;
  /** Sources for the citation list. */
  sources: Array<{ title: string; url: string; snippet?: string }>;
  resultCount: number;
}

/* ── Query-level result cache (protects the credit balance) ────────────────────
 * Mirrors the Tavily cache: identical queries within the TTL reuse one search,
 * so near-duplicate requests don't each spend credits. Per-instance and
 * ephemeral on serverless. TTL via FIRECRAWL_CACHE_TTL_MS (default 1h;
 * 0 disables). */
interface CtxEntry { value: FirecrawlContext | null; expiresAt: number; }
const _ctxCache = new Map<string, CtxEntry>();
const CTX_MAX_ENTRIES = 200;

function ctxTtlMs(): number {
  const raw = process.env.FIRECRAWL_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 60 * 60 * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 60 * 60 * 1000;
}

/** How much of each result's text to inject. Scraped markdown is far longer
 *  than a snippet, so it gets a bigger budget — but still bounded so a handful
 *  of pages can't crowd out the rest of the prompt. */
function contentBudget(scrapeContent: boolean): number {
  return scrapeContent ? 2000 : 600;
}

/**
 * Best-effort grounding context for prompt injection. Returns null (never
 * throws) when not configured or on any failure — the caller falls back to the
 * secondary search provider, then to ungrounded research. Identical queries
 * within the TTL reuse one search.
 */
export async function fetchFirecrawlContext(
  s: StoredFirecrawlSettings,
  query: string,
): Promise<FirecrawlContext | null> {
  if (!s.apiKey || !query.trim()) return null;

  const ttl = ctxTtlMs();
  const cacheKey = `${query.trim().toLowerCase()}|${s.maxResults}|${s.scrapeContent}|${s.apiBaseUrl}${s.searchPath}`;
  if (ttl > 0) {
    const hit = _ctxCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    if (hit) _ctxCache.delete(cacheKey);
  }

  let r: FirecrawlSearchResponse;
  try {
    r = await firecrawlSearch(s, query);
  } catch {
    return null; // search problems must not break AI research
  }

  let value: FirecrawlContext | null = null;
  if (r.results.length > 0) {
    const budget = contentBudget(s.scrapeContent);
    value = {
      promptBlock: r.results
        .map((res, i) => `[${i + 1}] ${res.title}\n${res.url}\n${res.content.slice(0, budget)}`)
        .join('\n\n'),
      sources: r.results.map(res => ({ title: res.title, url: res.url, snippet: res.content.slice(0, 160) })),
      resultCount: r.results.length,
    };
  }

  if (ttl > 0) {
    while (_ctxCache.size >= CTX_MAX_ENTRIES) {
      const oldest = _ctxCache.keys().next().value;
      if (oldest === undefined) break;
      _ctxCache.delete(oldest);
    }
    _ctxCache.set(cacheKey, { value, expiresAt: Date.now() + ttl });
  }
  return value;
}

/** Mask a key like "fc-abcd...wxyz" → "fc-***wxyz". */
export function maskFirecrawlKey(key: string): string {
  if (key.length <= 9) return '***';
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}
