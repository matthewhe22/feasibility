import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';

/**
 * GET /api/admin/stats
 * Returns high-level statistics about the stored projects.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Supabase is not configured.',
    });
  }

  const supabase = getAdminSupabase();

  // Total project count
  const { count: total } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true });

  // Most recently updated project
  const { data: recentRows } = await supabase
    .from('projects')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false })
    .limit(5);

  // Oldest project
  const { data: oldestRow } = await supabase
    .from('projects')
    .select('id, name, created_at')
    .order('created_at', { ascending: true })
    .limit(1);

  // Projects updated in the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .gte('updated_at', sevenDaysAgo);

  // Projects created in the last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: newCount } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', thirtyDaysAgo);

  return res.status(200).json({
    totalProjects: total ?? 0,
    recentlyUpdated: recentCount ?? 0,
    createdLast30Days: newCount ?? 0,
    latestProjects: recentRows ?? [],
    oldestProject: oldestRow?.[0] ?? null,
    generatedAt: new Date().toISOString(),
  });
}
