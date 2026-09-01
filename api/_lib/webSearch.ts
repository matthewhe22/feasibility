import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIProvider } from './aiSettings';
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

/**
 * True when the AI provider can search the web on its own. Gemini is the only
 * one (Google Search grounding); DeepSeek / OpenRouter / NVIDIA all depend on
 * Firecrawl or Tavily results being injected into the prompt.
 */
export function providerHasNativeSearch(provider: AIProvider): boolean {
  return provider === 'gemini';
}

/**
 * True when a request routed to `provider` should be grounded by Firecrawl /
 * Tavily.
 *
 * Two cases qualify:
 *   - the provider has no search of its own; or
 *   - it is Gemini but native Google-Search grounding is switched off, in which
 *     case injected results beat running blind (and cost none of the scarce
 *     free-tier grounding quota that makes Gemini 429 in the first place).
 */
export function needsWebSearchGrounding(provider: AIProvider, nativeGroundingEnabled: boolean): boolean {
  return !providerHasNativeSearch(provider) || !nativeGroundingEnabled;
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

/**
 * Run several queries against the configured tool(s) and merge the results into
 * one context — for requests where a single query can't cover the ground needed
 * (e.g. one generic query trying to surface price data for 8 different suburbs).
 * Queries run in parallel; results are deduped by URL. Still "at most one search
 * per tool per query", same credit accounting as `runWebSearch`, just repeated
 * per query.
 */
async function runWebSearchMulti(cfg: WebSearchConfig, queries: string[]): Promise<WebSearchContext | null> {
  const results = await Promise.all(queries.map(q => runWebSearch(cfg, q)));
  const nonNull = results.filter((r): r is WebSearchContext => r !== null);
  if (nonNull.length === 0) return null;

  const seen = new Set<string>();
  const sources: WebSearchContext['sources'] = [];
  const blocks: string[] = [];
  let resultCount = 0;
  let fellBackFrom: WebSearchProvider | undefined;
  for (const ctx of nonNull) {
    blocks.push(ctx.promptBlock);
    resultCount += ctx.resultCount;
    if (ctx.fellBackFrom) fellBackFrom = ctx.fellBackFrom;
    for (const s of ctx.sources) {
      if (!seen.has(s.url)) {
        seen.add(s.url);
        sources.push(s);
      }
    }
  }

  return {
    promptBlock: blocks.join('\n\n'),
    sources,
    resultCount,
    provider: nonNull[0].provider,
    ...(fellBackFrom ? { fellBackFrom } : {}),
  };
}

/**
 * A one-shot, lazily-executed web search.
 *
 * The research endpoints try providers in a failover chain, and only some links
 * in that chain need injected search results (see `needsWebSearchGrounding`).
 * Searching eagerly would spend credits on requests a natively-grounded Gemini
 * answers on its own; searching per attempt would spend them twice on failover.
 * The runner does neither: the search runs on the first `ensure()` that actually
 * needs it, and every later call reuses that one result.
 *
 * `query` may be an array — each entry runs as its own search (in parallel) and
 * the results are merged, for requests one query can't cover on its own.
 */
export interface WebSearchRunner {
  /** Run the search if it hasn't run yet; returns the (possibly null) context. */
  ensure(): Promise<WebSearchContext | null>;
  /** The result of the search if it has run, else null. Never triggers one. */
  readonly context: WebSearchContext | null;
  /** Whether a search was actually performed. */
  readonly ran: boolean;
}

export function createWebSearchRunner(cfg: WebSearchConfig | null, query: string | string[]): WebSearchRunner {
  let ran = false;
  let ctx: WebSearchContext | null = null;
  let inFlight: Promise<WebSearchContext | null> | null = null;

  return {
    async ensure() {
      if (ran) return ctx;
      if (!cfg) return null;
      if (!inFlight) {
        const run = Array.isArray(query) ? runWebSearchMulti(cfg, query) : runWebSearch(cfg, query);
        inFlight = run.then(r => {
          ran = true;
          ctx = r;
          return r;
        });
      }
      return inFlight;
    },
    get context() { return ctx; },
    get ran() { return ran; },
  };
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
