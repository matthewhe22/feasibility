/**
 * Tiny in-memory TTL + LRU cache for AI research responses.
 *
 * Why: the live-research endpoints hit Google Gemini's free tier, whose
 * search-grounding quota rate-limits (429) even on light use. The single most
 * effective way to "minimise Gemini queries" is to NOT re-ask the model a
 * question we already answered. Benchmarks (construction $/m², GRV, fee %) are
 * stable hour-to-hour, so an identical request can safely serve a cached
 * result instead of burning quota.
 *
 * Scope/limits: this is a per-instance module-level cache. On Vercel each warm
 * lambda keeps its own copy, and cold starts begin empty — so it dedupes
 * bursts and rapid re-clicks that land on a warm instance, but is not a durable
 * shared cache. The client-side localStorage cache (app/src/utils/researchCache.ts)
 * provides the durable, per-user layer that survives reloads and cold starts.
 * The two are complementary.
 */

interface CacheEntry {
  value: Record<string, unknown>;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

/** Max distinct entries kept; oldest-inserted is evicted past this (LRU-ish). */
const MAX_ENTRIES = 200;

/** Default time-to-live. Override with RESEARCH_CACHE_TTL_MS (0 disables). */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function ttlMs(): number {
  const raw = process.env.RESEARCH_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS;
}

/**
 * Build a stable cache key from an arbitrary set of fields. Object keys are
 * sorted so {a,b} and {b,a} collapse to the same key. Pass everything that
 * changes the model's answer: the request body, provider, model, and whether
 * grounding / Cotality data was in play.
 */
export function researchCacheKey(parts: Record<string, unknown>): string {
  return stableStringify(parts);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Return a cached payload (cloned, with cache metadata) or null on miss/expiry. */
export function getCachedResearch(key: string): Record<string, unknown> | null {
  if (ttlMs() === 0) return null;
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  // Refresh recency for LRU eviction.
  store.delete(key);
  store.set(key, hit);
  return { ...hit.value, cached: true };
}

/** Store a successful research payload under the given key. */
export function setCachedResearch(key: string, value: Record<string, unknown>): void {
  const ttl = ttlMs();
  if (ttl === 0) return;
  // Evict oldest entries when over capacity.
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttl });
}
