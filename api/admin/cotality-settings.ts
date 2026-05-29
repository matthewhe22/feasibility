import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';
import {
  loadCotalitySettings,
  saveCotalitySettings,
  deleteCotalitySettings,
  getCotalityToken,
  maskClientId,
  CotalityError,
  COTALITY_DEFAULTS,
  COTALITY_DEFAULT_SETTINGS,
  type StoredCotalitySettings,
  type CotalityRegion,
} from '../_lib/cotality';

/**
 * GET    /api/admin/cotality-settings → masked settings + status (no secret)
 * POST   /api/admin/cotality-settings → body: partial settings; {test:true} verifies the token exchange
 * DELETE /api/admin/cotality-settings → removes the stored credentials
 *
 * The Client Secret is NEVER returned to the client — GET returns a hasSecret
 * flag and a masked Client ID preview only.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Supabase is not configured. Cotality settings cannot be persisted without VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The COTALITY_CLIENT_ID / COTALITY_CLIENT_SECRET env vars (if set) will still be used by /api/benchmarks/research.',
    });
  }
  const supabase = getAdminSupabase();

  if (req.method === 'GET') {
    const stored = await loadCotalitySettings(supabase);
    const envId = process.env.COTALITY_CLIENT_ID?.trim();
    const hasStored = Boolean(stored?.clientId && stored?.clientSecret);
    const hasEnv = Boolean(envId && process.env.COTALITY_CLIENT_SECRET?.trim());
    const source: 'stored' | 'env' | 'none' = hasStored ? 'stored' : hasEnv ? 'env' : 'none';
    const activeId = stored?.clientId || envId || '';

    return res.status(200).json({
      hasCredentials: source !== 'none',
      hasStoredCredentials: hasStored,
      hasEnvFallback: hasEnv,
      source,
      clientIdPreview: activeId ? maskClientId(activeId) : '',
      tokenUrl: stored?.tokenUrl ?? COTALITY_DEFAULTS.tokenUrl,
      apiBaseUrl: stored?.apiBaseUrl ?? COTALITY_DEFAULTS.apiBaseUrl,
      region: stored?.region ?? COTALITY_DEFAULTS.region,
      propertyDataPath: stored?.propertyDataPath ?? '',
      enabled: stored?.enabled ?? true,
      defaults: COTALITY_DEFAULTS,
    });
  }

  if (req.method === 'POST') {
    let body: Partial<StoredCotalitySettings> & { test?: boolean };
    try {
      body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) ?? {};
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const existing = await loadCotalitySettings(supabase);

    // Merge incoming patch over existing (or defaults). A blank clientSecret
    // means "keep current"; an explicit value replaces it.
    const next: StoredCotalitySettings = {
      clientId: (body.clientId ?? existing?.clientId ?? '').trim(),
      clientSecret: (body.clientSecret && body.clientSecret.trim())
        ? body.clientSecret.trim()
        : (existing?.clientSecret ?? ''),
      tokenUrl: (body.tokenUrl ?? existing?.tokenUrl ?? COTALITY_DEFAULT_SETTINGS.tokenUrl).trim(),
      apiBaseUrl: (body.apiBaseUrl ?? existing?.apiBaseUrl ?? COTALITY_DEFAULT_SETTINGS.apiBaseUrl).trim(),
      region: ((body.region ?? existing?.region ?? 'au') === 'nz' ? 'nz' : 'au') as CotalityRegion,
      propertyDataPath: (body.propertyDataPath ?? existing?.propertyDataPath ?? '').trim(),
      enabled: body.enabled ?? existing?.enabled ?? true,
    };

    // Validate URLs early so a typo doesn't silently break token exchange.
    for (const [field, val] of [['tokenUrl', next.tokenUrl], ['apiBaseUrl', next.apiBaseUrl]] as const) {
      try { new URL(val); } catch {
        return res.status(400).json({ error: `${field} must be a valid URL (got "${val}").` });
      }
    }

    // Test-connection: verify the credentials by performing a token exchange.
    if (body.test) {
      if (!next.clientId || !next.clientSecret) {
        return res.status(400).json({ error: 'A Client ID and Client Secret are required to test the connection.' });
      }
      try {
        await getCotalityToken(next);
        return res.status(200).json({ ok: true, message: 'Connection verified — obtained an access token from Cotality.' });
      } catch (e) {
        const status = e instanceof CotalityError && e.status ? e.status : 502;
        return res.status(status).json({ error: e instanceof Error ? e.message : 'Token exchange failed.' });
      }
    }

    await saveCotalitySettings(supabase, next);
    return res.status(200).json({
      ok: true,
      hasCredentials: Boolean(next.clientId && next.clientSecret),
      clientIdPreview: next.clientId ? maskClientId(next.clientId) : '',
      tokenUrl: next.tokenUrl,
      apiBaseUrl: next.apiBaseUrl,
      region: next.region,
      propertyDataPath: next.propertyDataPath,
      enabled: next.enabled,
    });
  }

  if (req.method === 'DELETE') {
    await deleteCotalitySettings(supabase);
    return res.status(200).json({ ok: true, message: 'Stored Cotality credentials removed.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
