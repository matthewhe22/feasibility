import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import {
  loadTavilySettings,
  saveTavilySettings,
  deleteTavilySettings,
  tavilySearch,
  maskTavilyKey,
  TavilyError,
  TAVILY_DEFAULT_SETTINGS,
  type StoredTavilySettings,
  type TavilySearchDepth,
} from '../_lib/tavily';

/**
 * GET    /api/admin/tavily-settings → masked key + status (no secret)
 * POST   /api/admin/tavily-settings → body: partial settings; {test:true} runs a live search
 * DELETE /api/admin/tavily-settings → removes the stored key
 *
 * The API key is NEVER returned to the client — GET returns a hasKey flag and a
 * masked preview only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Supabase is not configured. Tavily settings cannot be persisted without VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The TAVILY_API_KEY env var (if set) will still be used by the research endpoints.',
    });
  }
  const supabase = getAdminSupabase();

  if (req.method === 'GET') {
    const stored = await loadTavilySettings(supabase);
    const envKey = process.env.TAVILY_API_KEY?.trim();
    const hasStored = Boolean(stored?.apiKey);
    const hasEnv = Boolean(envKey);
    const source: 'stored' | 'env' | 'none' = hasStored ? 'stored' : hasEnv ? 'env' : 'none';
    const activeKey = stored?.apiKey || envKey || '';

    return res.status(200).json({
      hasKey: source !== 'none',
      hasStoredKey: hasStored,
      hasEnvFallback: hasEnv,
      source,
      keyPreview: activeKey ? maskTavilyKey(activeKey) : '',
      enabled: stored?.enabled ?? true,
      maxResults: stored?.maxResults ?? TAVILY_DEFAULT_SETTINGS.maxResults,
      searchDepth: stored?.searchDepth ?? TAVILY_DEFAULT_SETTINGS.searchDepth,
    });
  }

  if (req.method === 'POST') {
    let body: Partial<StoredTavilySettings> & { test?: boolean };
    try {
      body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {};
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const existing = await loadTavilySettings(supabase);

    // Blank apiKey = keep current; an explicit value replaces it.
    const next: StoredTavilySettings = {
      apiKey: (body.apiKey && body.apiKey.trim()) ? body.apiKey.trim() : (existing?.apiKey ?? ''),
      enabled: body.enabled ?? existing?.enabled ?? true,
      maxResults: typeof body.maxResults === 'number'
        ? Math.min(10, Math.max(1, Math.round(body.maxResults)))
        : (existing?.maxResults ?? TAVILY_DEFAULT_SETTINGS.maxResults),
      searchDepth: ((body.searchDepth ?? existing?.searchDepth ?? 'basic') === 'advanced' ? 'advanced' : 'basic') as TavilySearchDepth,
    };

    if (body.apiKey !== undefined && body.apiKey.trim() && body.apiKey.trim().length < 20) {
      return res.status(400).json({ error: 'Tavily API key appears too short.' });
    }

    // Test-connection: run a live throwaway search to verify key + quota.
    if (body.test) {
      if (!next.apiKey) {
        return res.status(400).json({ error: 'An API key is required to test the connection.' });
      }
      try {
        const r = await tavilySearch(next, 'Australian residential property market 2025');
        return res.status(200).json({ ok: true, message: `Connection verified — Tavily returned ${r.results.length} results.` });
      } catch (e) {
        const status = e instanceof TavilyError && e.status ? e.status : 502;
        return res.status(status).json({ error: e instanceof Error ? e.message : 'Search test failed.' });
      }
    }

    await saveTavilySettings(supabase, next);
    return res.status(200).json({
      ok: true,
      hasKey: Boolean(next.apiKey),
      keyPreview: next.apiKey ? maskTavilyKey(next.apiKey) : '',
      enabled: next.enabled,
      maxResults: next.maxResults,
      searchDepth: next.searchDepth,
    });
  }

  if (req.method === 'DELETE') {
    await deleteTavilySettings(supabase);
    return res.status(200).json({ ok: true, message: 'Stored Tavily key removed.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
