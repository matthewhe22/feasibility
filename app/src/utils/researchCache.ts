/**
 * Durable, per-user cache for live AI-research responses, backed by
 * localStorage.
 *
 * Why: the "Research benchmarks" buttons call Google Gemini's free tier, whose
 * search-grounding quota rate-limits (429) on light use. The cheapest possible
 * Gemini query is the one we never send — so an identical request (same asset
 * profile) reuses the last answer instead of re-asking the model.
 *
 * This is the durable layer that survives page reloads and serverless cold
 * starts; it complements the server-side in-memory cache (api/_lib/researchCache.ts).
 */

const PREFIX = 'feaso:research:';

/** Default TTL — benchmarks are stable day-to-day. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface Stored<T> {
  value: T;
  expiresAt: number;
}

/** Build a stable key from a request body (object-key order independent). */
export function researchKey(body: Record<string, unknown>): string {
  return PREFIX + stableStringify(body);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Read a cached value, or null on miss/expiry/unavailable storage. */
export function getCachedResearch<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

/** Store a value with a TTL. Silently no-ops if storage is full/unavailable. */
export function setCachedResearch<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
  } catch {
    // Quota exceeded or storage disabled — best-effort, drop oldest research
    // entries and retry once so the cache self-trims instead of failing.
    try {
      pruneOldest();
      localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
    } catch {
      /* give up — caching is an optimisation, never a hard requirement */
    }
  }
}

/** Drop roughly half of the stored research entries (oldest expiry first). */
function pruneOldest(): void {
  const entries: Array<{ key: string; expiresAt: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try {
      const p = JSON.parse(localStorage.getItem(k) || '') as Stored<unknown>;
      entries.push({ key: k, expiresAt: p?.expiresAt ?? 0 });
    } catch {
      entries.push({ key: k, expiresAt: 0 });
    }
  }
  entries.sort((a, b) => a.expiresAt - b.expiresAt);
  const half = Math.ceil(entries.length / 2);
  for (let i = 0; i < half; i++) {
    const entry = entries[i];
    if (entry) localStorage.removeItem(entry.key);
  }
}
