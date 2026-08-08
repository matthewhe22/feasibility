import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveFirecrawlSettings, fetchFirecrawlContext } from './firecrawl';
import { resolveTavilySettings, fetchTavilyContext } from './tavily';

/**
 * Web-search grounding orchestrator.
 *
 * Gemini is the only AI provider with native live web search. For every other
 * provider (DeepSeek, OpenRouter, NVIDIA) the research endpoints inject search
 * results into the prompt. Two search tools can supply those results:
 *
 *   - Firecrawl — search + optional full-page scrape (default primary)
 *   - Tavily    — LLM-oriented search with a synthesised answer
 *
 * Which one leads is configurable in Admin → AI Settings (webSearchPrimary);
 * the other acts as a fallback when the primary is unconfigured, errors, or
 * returns nothing (webSearchFallback, default on).
 *
 * The split between `resolveWebSearchConfig` and `runWebSearch` is deliberate
 * and load-bearing: config resolution is cheap (database reads) and runs BEFORE
 * the response-cache check so the cache key can record which tools were in
 * play, while the actual search — which spends credits — runs only on a cache
 * miss. Collapsing the two would make every cached request pay for a search.
 */

export type WebSearchProvider = 'firecrawl' | 'tavily';

export const WEB_SEARCH_PROVIDERS: WebSearchProvider[] = ['firecrawl', 'tavily'];

export const DEFAULT_WEB_SEARCH_PRIMARY: WebSearchProvider = 'firecrawl';

export function isWebSearchProvider(v: unknown): v is WebSearchProvider {
  return v === 'firecrawl' || v === 'tavily';
}

type ResolvedFirecrawl = Awaited<ReturnType<typeof resolveFirecrawlSettings>>;
type ResolvedTavily = Awaited<ReturnType<typeof resolveTavilySettings>>;

export interface WebSearchConfig {
  primary: WebSearchProvider;
  fallback: boolean;
  firecrawl: ResolvedFirecrawl;
  tavily: ResolvedTavily;
}

export interface WebSearchContext {
  /** Prompt-ready grounding block. */
  promptBlock: string;
  sources: Array<{ title: string; url: string; snippet?: string }>;
  resultCount: number;
  /** Which tool actually produced these results. */
  provider: WebSearchProvider;
  /** Set when the primary yielded nothing and the fallback answered instead. */
  fellBackFrom?: WebSearchProvider;
}

/**
 * Resolve which search tools are available, cheaply. Safe to call before the
 * response-cache check — it performs no search and spends no credits.
 */
export async function resolveWebSearchConfig(
  supabase: SupabaseClient | null,
  primary: WebSearchProvider,
  fallback: boolean,
): Promise<WebSearchConfig> {
  const [firecrawl, tavily] = await Promise.all([
    resolveFirecrawlSettings(supabase).catch(() => null),
    resolveTavilySettings(supabase).catch(() => null),
  ]);
  return { primary, fallback, firecrawl, tavily };
}

/** True when at least one search tool could run. */
export function hasWebSearch(cfg: WebSearchConfig): boolean {
  return Boolean(cfg.firecrawl || cfg.tavily);
}

/**
 * Stable tag describing the grounding configuration, for the response-cache
 * key. Two requests that would be grounded differently must not share a cache
 * entry, so the tag records the attempt ORDER, not just which keys exist.
 */
export function webSearchCacheTag(cfg: WebSearchConfig): string {
  const order = attemptOrder(cfg);
  return order.length ? order.join('>') : 'none';
}

/** The providers to try, in order: primary first, then the other if enabled. */
function attemptOrder(cfg: WebSearchConfig): WebSearchProvider[] {
  const available = (p: WebSearchProvider) => (p === 'firecrawl' ? Boolean(cfg.firecrawl) : Boolean(cfg.tavily));
  const secondary: WebSearchProvider = cfg.primary === 'firecrawl' ? 'tavily' : 'firecrawl';
  const order: WebSearchProvider[] = [];
  if (available(cfg.primary)) order.push(cfg.primary);
  if (cfg.fallback && available(secondary)) order.push(secondary);
  return order;
}

/**
 * Run the web search, trying the configured primary first. Best-effort: returns
 * null rather than throwing, so research always proceeds — ungrounded if every
 * tool fails.
 *
 * At most one search per tool per call. The per-tool query caches in
 * firecrawl.ts / tavily.ts further dedupe identical queries across requests.
 */
export async function runWebSearch(cfg: WebSearchConfig, query: string): Promise<WebSearchContext | null> {
  if (!query.trim()) return null;

  const order = attemptOrder(cfg);
  for (let i = 0; i < order.length; i++) {
    const provider = order[i];
    try {
      const ctx = provider === 'firecrawl'
        ? cfg.firecrawl && await fetchFirecrawlContext(cfg.firecrawl, query)
        : cfg.tavily && await fetchTavilyContext(cfg.tavily, query);

      if (ctx && ctx.resultCount > 0) {
        return {
          promptBlock: ctx.promptBlock,
          sources: ctx.sources,
          resultCount: ctx.resultCount,
          provider,
          ...(i > 0 ? { fellBackFrom: order[0] } : {}),
        };
      }
    } catch {
      /* try the next tool */
    }
  }
  return null;
}

/** Human-readable tool name for prompt text and UI badges. */
export function webSearchProviderLabel(p: WebSearchProvider): string {
  return p === 'firecrawl' ? 'Firecrawl' : 'Tavily';
}

/**
 * The prompt block appended to the user prompt when grounding succeeded.
 * Instructs the model to treat the live results as the primary current-data
 * source and to cite the URLs.
 */
export function buildWebSearchPromptBlock(ctx: WebSearchContext): string {
  const tool = webSearchProviderLabel(ctx.provider);
  return (
    `=== LIVE WEB SEARCH RESULTS (${tool}) — use as the primary current-data source; cite the URLs ===\n` +
    `${ctx.promptBlock}\n` +
    `=== END WEB SEARCH RESULTS ===\n` +
    `Base your figures on these live results where relevant and cite the URLs above in the sources list.`
  );
}

/** The `webSearch` field returned to the client (and its legacy `tavily` twin). */
export interface WebSearchNote {
  used: boolean;
  provider?: WebSearchProvider;
  results?: number;
  fellBackFrom?: WebSearchProvider;
}

export function webSearchNote(ctx: WebSearchContext | null): WebSearchNote {
  if (!ctx) return { used: false };
  return {
    used: true,
    provider: ctx.provider,
    results: ctx.resultCount,
    ...(ctx.fellBackFrom ? { fellBackFrom: ctx.fellBackFrom } : {}),
  };
}
