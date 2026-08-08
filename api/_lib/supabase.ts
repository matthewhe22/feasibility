import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Unwrap an error's `cause` chain into a readable one-liner.
 *
 * undici rejects with a bare `TypeError: fetch failed` and hides the real
 * reason (ENOTFOUND / ECONNREFUSED / ETIMEDOUT / UND_ERR_*) in `cause`.
 * postgrest-js then flattens whatever it caught to `error.message`, so without
 * this the only thing that ever reaches the logs is "TypeError: fetch failed" —
 * which says a request failed but never says why.
 */
export function describeCause(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 5; depth++) {
    const o = cur as { message?: unknown; code?: unknown; cause?: unknown };
    const code = typeof o.code === 'string' ? o.code : '';
    const msg = typeof o.message === 'string' ? o.message : '';
    const piece = [code, msg].filter(Boolean).join(' ');
    if (piece && !parts.includes(piece)) parts.push(piece);
    cur = o.cause;
  }
  return parts.join(' ← ') || String(e);
}

/** Host of a fetch input, for error messages (never includes credentials). */
function hostOf(input: unknown): string {
  try {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : (input as Request)?.url ?? '';
    return url ? new URL(url).host : 'supabase';
  } catch {
    return 'supabase';
  }
}

/**
 * fetch wrapper that replaces undici's opaque "fetch failed" with the actual
 * transport cause and the host it could not reach. Network failures surface as
 * a real diagnosis ("getaddrinfo ENOTFOUND xyz.supabase.co") instead of being
 * laundered into an unhelpful generic message.
 */
const diagnosticFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input as RequestInfo, init as RequestInit);
  } catch (e) {
    throw new Error(`cannot reach ${hostOf(input)}: ${describeCause(e)}`, { cause: e });
  }
};

/**
 * Returns a Supabase client authenticated with the service role key.
 * This client bypasses Row Level Security and is safe ONLY for server-side use.
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
export function getAdminSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase admin credentials not configured. ' +
      'Set VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in environment variables.'
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: diagnosticFetch },
  });
  return _client;
}

export function isSupabaseConfigured(): boolean {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && key);
}
