import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describeCause, getAdminSupabase, isSupabaseConfigured } from './supabase';

/**
 * GET /api/cron/keep-alive
 *
 * Not a standalone function: the Vercel Hobby plan caps a deployment at 12
 * serverless functions, so vercel.json rewrites this path to
 * `/api/admin/stats?keepalive=1` and that handler delegates here.
 *
 * Supabase free-tier projects are paused after a stretch of no database
 * activity. Vercel Cron (see `crons` in vercel.json) calls this every 3 days and
 * it runs a tiny read against the `projects` table, which counts as activity
 * and keeps the project awake.
 *
 * When CRON_SECRET is set in the Vercel env, Vercel sends it as
 * `Authorization: Bearer <secret>` on cron invocations and anything else is
 * rejected. Without it the endpoint is open, which is harmless: it only
 * reports whether a one-row read succeeded.
 */
export async function handleKeepAlive(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Supabase is not configured. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    });
  }

  const startedAt = Date.now();
  try {
    const { error } = await getAdminSupabase()
      .from('projects')
      .select('id')
      .limit(1);
    if (error) throw new Error(error.message);
  } catch (e) {
    const reason = describeCause(e);
    console.error('[keep-alive] Supabase ping failed:', reason);
    return res.status(502).json({ ok: false, error: reason });
  }

  return res.status(200).json({
    ok: true,
    pingedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
  });
}
