import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import {
  loadFirecrawlSettings,
  saveFirecrawlSettings,
  deleteFirecrawlSettings,
  firecrawlSearch,
  maskFirecrawlKey,
  FirecrawlError,
  FIRECRAWL_DEFAULT_SETTINGS,
  type StoredFirecrawlSettings,
} from '../_lib/firecrawl';

/**
 * GET    /api/admin/firecrawl-settings → masked key + status (no secret)
 * POST   /api/admin/firecrawl-settings → body: partial settings; {test:true} runs a live search
 * DELETE /api/admin/firecrawl-settings → removes the stored key
 *
 * The API key is NEVER returned to the client — GET returns a hasKey flag and a
 * masked preview only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Supabase is not configured. Firecrawl settings cannot be persisted without VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The FIRECRAWL_API_KEY env var (if set) will still be used by the research endpoints.',
    });
  }
  const supabase = getAdminSupabase();

  if (req.method === 'GET') {
    let stored: StoredFirecrawlSettings | null = null;
    try {
      stored = await loadFirecrawlSettings(supabase);
    } catch (e) {
      return res.status(502).json({ error: `Could not read Firecrawl settings: ${e instanceof Error ? e.message : 'unknown error'}` });
    }
    const envKey = process.env.FIRECRAWL_API_KEY?.trim();
    const hasStored = Boolean(stored?.apiKey);
    const hasEnv = Boolean(envKey);
    const source: 'stored' | 'env' | 'none' = hasStored ? 'stored' : hasEnv ? 'env' : 'none';
    const activeKey = stored?.apiKey || envKey || '';

    return res.status(200).json({
      hasKey: source !== 'none',
      hasStoredKey: hasStored,
      hasEnvFallback: hasEnv,
      source,
      keyPreview: activeKey ? maskFirecrawlKey(activeKey) : '',
      enabled: stored?.enabled ?? true,
      maxResults: stored?.maxResults ?? FIRECRAWL_DEFAULT_SETTINGS.maxResults,
      apiBaseUrl: stored?.apiBaseUrl ?? FIRECRAWL_DEFAULT_SETTINGS.apiBaseUrl,
      searchPath: stored?.searchPath ?? FIRECRAWL_DEFAULT_SETTINGS.searchPath,
      scrapeContent: stored?.scrapeContent ?? FIRECRAWL_DEFAULT_SETTINGS.scrapeContent,
    });
  }

  if (req.method === 'POST') {
    let body: Partial<StoredFirecrawlSettings> & { test?: boolean };
    try {
      body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {};
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    if (body.apiKey !== undefined && body.apiKey.trim() && body.apiKey.trim().length < 10) {
      return res.status(400).json({ error: 'Firecrawl API key appears too short.' });
    }

    let existing: StoredFirecrawlSettings | null = null;
    try {
      existing = await loadFirecrawlSettings(supabase);
    } catch (e) {
      return res.status(502).json({ error: `Could not read Firecrawl settings: ${e instanceof Error ? e.message : 'unknown error'}` });
    }

    // Blank apiKey = keep current; an explicit value replaces it.
    const next: StoredFirecrawlSettings = {
      apiKey: (body.apiKey && body.apiKey.trim()) ? body.apiKey.trim() : (existing?.apiKey ?? ''),
      enabled: body.enabled ?? existing?.enabled ?? true,
      maxResults: typeof body.maxResults === 'number'
        ? Math.min(10, Math.max(1, Math.round(body.maxResults)))
        : (existing?.maxResults ?? FIRECRAWL_DEFAULT_SETTINGS.maxResults),
      apiBaseUrl: (typeof body.apiBaseUrl === 'string' && body.apiBaseUrl.trim())
        ? body.apiBaseUrl.trim().replace(/\/+$/, '')
        : (existing?.apiBaseUrl ?? FIRECRAWL_DEFAULT_SETTINGS.apiBaseUrl),
      searchPath: (typeof body.searchPath === 'string' && body.searchPath.trim())
        ? (body.searchPath.trim().startsWith('/') ? body.searchPath.trim() : `/${body.searchPath.trim()}`)
        : (existing?.searchPath ?? FIRECRAWL_DEFAULT_SETTINGS.searchPath),
      scrapeContent: body.scrapeContent ?? existing?.scrapeContent ?? FIRECRAWL_DEFAULT_SETTINGS.scrapeContent,
    };

    // Test-connection: run a live throwaway search to verify key + credits.
    if (body.test) {
      const testKey = next.apiKey || process.env.FIRECRAWL_API_KEY?.trim() || '';
      if (!testKey) {
        return res.status(400).json({ error: 'An API key is required to test the connection.' });
      }
      try {
        const r = await firecrawlSearch({ ...next, apiKey: testKey }, 'Australian residential property market 2025');
        const pathNote = r.pathUsed === next.searchPath
          ? ''
          : ` (via ${r.pathUsed} — the configured path ${next.searchPath} returned 404, consider updating it)`;
        return res.status(200).json({
          ok: true,
          message: `Connection verified — Firecrawl returned ${r.results.length} results${pathNote}.`,
          pathUsed: r.pathUsed,
        });
      } catch (e) {
        const status = e instanceof FirecrawlError && e.status ? e.status : 502;
        return res.status(status).json({ error: e instanceof Error ? e.message : 'Search test failed.' });
      }
    }

    try {
      await saveFirecrawlSettings(supabase, next);
    } catch (e) {
      return res.status(502).json({ error: `Could not save Firecrawl settings — the database write failed: ${e instanceof Error ? e.message : 'unknown error'}` });
    }

    return res.status(200).json({
      ok: true,
      hasKey: Boolean(next.apiKey),
      keyPreview: next.apiKey ? maskFirecrawlKey(next.apiKey) : '',
      enabled: next.enabled,
      maxResults: next.maxResults,
      apiBaseUrl: next.apiBaseUrl,
      searchPath: next.searchPath,
      scrapeContent: next.scrapeContent,
    });
  }

  if (req.method === 'DELETE') {
    try {
      await deleteFirecrawlSettings(supabase);
    } catch (e) {
      return res.status(502).json({ error: `Could not remove Firecrawl settings: ${e instanceof Error ? e.message : 'unknown error'}` });
    }
    return res.status(200).json({ ok: true, message: 'Stored Firecrawl key removed.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
