import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cotality (formerly CoreLogic) property-data integration.
 *
 * Cotality exposes its Australian / New Zealand property platform via a REST
 * API secured with the OAuth2 **client-credentials** flow (consumer key +
 * secret → bearer access token, valid up to 8h). See the Cotality Developer
 * Portal: https://developer.corelogic.asia/
 *
 * This module stores the credentials (admin-managed, server-only — never sent
 * to the browser) in the same sentinel-row pattern used by AI settings and
 * branding, performs the token exchange (cached in-memory until expiry), and
 * provides an OPTIONAL property-data lookup used to ground the AI benchmark
 * research in real Cotality figures.
 *
 * Because the exact data endpoints differ by subscription product, the API
 * base URL, token URL and the property-data path are all configurable. The
 * token/connection plumbing is standard and works out of the box; the data
 * path is opt-in (blank by default) so nothing 404s silently. Every data call
 * is best-effort: on any failure the caller degrades to web-search-only.
 */

export const COTALITY_SETTINGS_SENTINEL = '__cotality_settings__';

export type CotalityRegion = 'au' | 'nz';

/** Documented defaults (Australia). All overridable in the UI. */
export const COTALITY_DEFAULTS = {
  apiBaseUrl: 'https://api.corelogic.asia',
  // Cotality auth is a dedicated PingFederate host, separate from the API host.
  tokenUrl: 'https://auth.corelogic.asia/as/token.oauth2',
  region: 'au' as CotalityRegion,
};

export interface StoredCotalitySettings {
  clientId: string;
  clientSecret: string;
  /** OAuth2 token endpoint (client-credentials grant). */
  tokenUrl: string;
  /** Base URL for data requests, e.g. https://api.corelogic.asia */
  apiBaseUrl: string;
  region: CotalityRegion;
  /**
   * Optional path template for the property/suburb data lookup used to ground
   * AI research. Supports {suburb} {state} {postcode} placeholders, e.g.
   *   /property/au/v2/statistics?locality={suburb}&state={state}
   * Leave blank to use credentials only for connection verification (the AI
   * research then runs on web search alone).
   */
  propertyDataPath: string;
  enabled: boolean;
}

export const COTALITY_DEFAULT_SETTINGS: StoredCotalitySettings = {
  clientId: '',
  clientSecret: '',
  tokenUrl: COTALITY_DEFAULTS.tokenUrl,
  apiBaseUrl: COTALITY_DEFAULTS.apiBaseUrl,
  region: COTALITY_DEFAULTS.region,
  propertyDataPath: '',
  enabled: true,
};

/* ── Persistence (sentinel row in `projects.admin` JSONB) ──────────────────── */

export async function loadCotalitySettings(
  supabase: SupabaseClient,
): Promise<StoredCotalitySettings | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('admin')
    .eq('name', COTALITY_SETTINGS_SENTINEL)
    .maybeSingle();
  if (error || !data) return null;

  const adminCol = (data as { admin: Record<string, unknown> }).admin ?? {};
  const c = (adminCol as { cotalitySettings?: Partial<StoredCotalitySettings> }).cotalitySettings;
  if (!c) return null;

  return {
    clientId: typeof c.clientId === 'string' ? c.clientId : '',
    clientSecret: typeof c.clientSecret === 'string' ? c.clientSecret : '',
    tokenUrl: typeof c.tokenUrl === 'string' && c.tokenUrl ? c.tokenUrl : COTALITY_DEFAULTS.tokenUrl,
    apiBaseUrl: typeof c.apiBaseUrl === 'string' && c.apiBaseUrl ? c.apiBaseUrl : COTALITY_DEFAULTS.apiBaseUrl,
    region: c.region === 'nz' ? 'nz' : 'au',
    propertyDataPath: typeof c.propertyDataPath === 'string' ? c.propertyDataPath : '',
    enabled: c.enabled !== false,
  };
}

export async function saveCotalitySettings(
  supabase: SupabaseClient,
  settings: StoredCotalitySettings,
): Promise<void> {
  const adminPayload = { cotalitySettings: settings };
  const { data: existing } = await supabase
    .from('projects')
    .select('id')
    .eq('name', COTALITY_SETTINGS_SENTINEL)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('projects')
      .update({ admin: adminPayload, updated_at: new Date().toISOString() })
      .eq('name', COTALITY_SETTINGS_SENTINEL);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('projects')
      .insert({
        name: COTALITY_SETTINGS_SENTINEL,
        description: 'Cotality (CoreLogic) API settings (admin-managed). Do not edit directly.',
        admin: adminPayload,
        inputs: {},
      });
    if (error) throw new Error(error.message);
  }
}

export async function deleteCotalitySettings(supabase: SupabaseClient): Promise<void> {
  await supabase.from('projects').delete().eq('name', COTALITY_SETTINGS_SENTINEL);
  _tokenCache = null; // drop any cached token tied to old credentials
}

/**
 * Resolve active Cotality settings with precedence:
 *   1. Stored settings (admin UI), if enabled and credentials present.
 *   2. Env vars: COTALITY_CLIENT_ID + COTALITY_CLIENT_SECRET (+ optional
 *      COTALITY_TOKEN_URL / COTALITY_API_BASE_URL / COTALITY_DATA_PATH).
 * Returns null when no credentials are available anywhere.
 */
export async function resolveCotalitySettings(
  supabase: SupabaseClient | null,
): Promise<(StoredCotalitySettings & { source: 'stored' | 'env' }) | null> {
  if (supabase) {
    const stored = await loadCotalitySettings(supabase);
    if (stored && stored.clientId && stored.clientSecret && stored.enabled) {
      return { ...stored, source: 'stored' };
    }
  }
  const id = process.env.COTALITY_CLIENT_ID?.trim();
  const secret = process.env.COTALITY_CLIENT_SECRET?.trim();
  if (id && secret) {
    return {
      clientId: id,
      clientSecret: secret,
      tokenUrl: process.env.COTALITY_TOKEN_URL?.trim() || COTALITY_DEFAULTS.tokenUrl,
      apiBaseUrl: process.env.COTALITY_API_BASE_URL?.trim() || COTALITY_DEFAULTS.apiBaseUrl,
      region: (process.env.COTALITY_REGION?.trim() === 'nz' ? 'nz' : 'au'),
      propertyDataPath: process.env.COTALITY_DATA_PATH?.trim() || '',
      enabled: true,
      source: 'env',
    };
  }
  return null;
}

/* ── OAuth2 token (client-credentials), cached until ~5 min before expiry ──── */

interface TokenCacheEntry {
  token: string;
  expiresAt: number; // epoch ms
  key: string;       // clientId|tokenUrl — invalidate when credentials change
}
let _tokenCache: TokenCacheEntry | null = null;

export class CotalityError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'CotalityError';
    this.status = status;
  }
}

/**
 * Obtain a bearer token via the OAuth2 client-credentials grant. Cached
 * in-memory until 5 minutes before expiry. Throws CotalityError on failure.
 */
export async function getCotalityToken(
  s: Pick<StoredCotalitySettings, 'clientId' | 'clientSecret' | 'tokenUrl'>,
): Promise<string> {
  const key = `${s.clientId}|${s.tokenUrl}`;
  const now = Date.now();
  if (_tokenCache && _tokenCache.key === key && _tokenCache.expiresAt > now + 5 * 60_000) {
    return _tokenCache.token;
  }

  // Cotality's PingFederate token endpoint authenticates the client with HTTP
  // Basic auth (client_secret_basic). Some client configs instead expect the
  // credentials in the body (client_secret_post), so try Basic first and fall
  // back to body-param auth on a 400/401 before giving up.
  const basic = Buffer.from(`${s.clientId}:${s.clientSecret}`).toString('base64');

  const post = async (mode: 'basic' | 'body'): Promise<Response> => {
    const params = new URLSearchParams({ grant_type: 'client_credentials' });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (mode === 'basic') {
      headers.Authorization = `Basic ${basic}`;
    } else {
      params.set('client_id', s.clientId);
      params.set('client_secret', s.clientSecret);
    }
    return fetch(s.tokenUrl, { method: 'POST', headers, body: params.toString() });
  };

  let resp: Response;
  try {
    resp = await post('basic');
    if (resp.status === 400 || resp.status === 401) {
      // Client may be configured for client_secret_post — retry that way.
      resp = await post('body');
    }
  } catch (e) {
    throw new CotalityError(
      `Could not reach the Cotality token endpoint (${s.tokenUrl}): ${e instanceof Error ? e.message : 'network error'}`,
    );
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 400) {
      throw new CotalityError(
        `Cotality rejected the credentials (HTTP ${resp.status}). Check the Client ID / Secret and token URL in Admin → Cotality Data. ${txt.slice(0, 200)}`,
        resp.status,
      );
    }
    throw new CotalityError(`Cotality token request failed (HTTP ${resp.status}): ${txt.slice(0, 300)}`, resp.status);
  }

  const json = (await resp.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new CotalityError('Cotality token response did not contain an access_token.');
  }
  const ttlMs = (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000;
  _tokenCache = { token: json.access_token, expiresAt: now + ttlMs, key };
  return json.access_token;
}

/* ── Optional property-data lookup (best-effort grounding context) ─────────── */

export interface CotalityContext {
  /** Truncated JSON/string payload fetched from the configured data path. */
  data: string;
  /** The resolved URL that was queried (for transparency/citation). */
  url: string;
}

function fillPath(template: string, vars: { suburb?: string; state?: string; postcode?: string }): string {
  return template
    .replace(/\{suburb\}/gi, encodeURIComponent(vars.suburb ?? ''))
    .replace(/\{state\}/gi, encodeURIComponent(vars.state ?? ''))
    .replace(/\{postcode\}/gi, encodeURIComponent(vars.postcode ?? ''));
}

/**
 * Fetch grounding context from the configured Cotality property-data path.
 * Returns null (never throws) when not configured or on any failure — the
 * caller falls back to web-search-only research.
 */
export async function fetchCotalityContext(
  s: StoredCotalitySettings,
  vars: { suburb?: string; state?: string; postcode?: string },
): Promise<CotalityContext | null> {
  if (!s.propertyDataPath) return null;
  // Require at least a suburb or postcode to make a meaningful, scoped request.
  if (!vars.suburb && !vars.postcode) return null;

  let token: string;
  try {
    token = await getCotalityToken(s);
  } catch {
    return null; // connection issues must not break AI research
  }

  const path = fillPath(s.propertyDataPath, vars);
  const url = path.startsWith('http')
    ? path
    : `${s.apiBaseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    // Cap the payload so we don't blow the AI context window.
    return { data: text.slice(0, 4000), url };
  } catch {
    return null;
  }
}

/** Mask a client id like "abcd1234efgh" → "abcd***efgh". */
export function maskClientId(id: string): string {
  if (id.length <= 8) return '***';
  return `${id.slice(0, 4)}***${id.slice(-4)}`;
}
