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
 * activity. Vercel Cron (see `crons` in vercel.json) calls this daily and it
 * refreshes a heartbeat sentinel row (`__keepalive__`) in the `projects`
 * table. A write is used rather than a bare SELECT so the activity is
 * unambiguous. `.github/workflows/supabase-keepalive.yml` writes the same row
 * directly via the Supabase REST API as an independent second scheduler.
 *
 * When CRON_SECRET is set in the Vercel env, Vercel sends it as
 * `Authorization: Bearer <secret>` on cron invocations and anything else is
 * rejected. Without it the endpoint is open, which is harmless: it only
 * reports whether a one-row read succeeded.
 */
export const KEEPALIVE_SENTINEL = '__keepalive__';

/** Upsert the heartbeat row; update first, insert only on the very first run. */
async function writeHeartbeat(pingedAt: string): Promise<void> {
  const supabase = getAdminSupabase();
  const admin = { keepAlive: { lastPingAt: pingedAt, source: 'vercel-cron' } };

  const { data: updated, error: updateError } = await supabase
    .from('projects')
    .update({ admin, updated_at: pingedAt })
    .eq('name', KEEPALIVE_SENTINEL)
    .select('id');
  if (updateError) throw new Error(updateError.message);
  if (updated && updated.length > 0) return;

  const { error: insertError } = await supabase
    .from('projects')
    .insert({
      name: KEEPALIVE_SENTINEL,
      description: 'Supabase keep-alive heartbeat (written by a scheduled job). Do not edit.',
      admin,
      inputs: {},
    });
  if (insertError) throw new Error(insertError.message);
}

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
  const pingedAt = new Date().toISOString();
  try {
    await writeHeartbeat(pingedAt);
  } catch (e) {
    const reason = describeCause(e);
    console.error('[keep-alive] Supabase ping failed:', reason);
    return res.status(502).json({ ok: false, error: reason });
  }

  return res.status(200).json({
    ok: true,
    pingedAt,
    latencyMs: Date.now() - startedAt,
  });
}
