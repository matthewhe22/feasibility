import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../../_lib/supabase';

function notConfigured(res: VercelResponse) {
  return res.status(503).json({
    error: 'Supabase is not configured. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
  });
}

/**
 * /api/admin/project/[id]
 *
 * GET    — full project record (id, name, description, dates, admin, inputs, dashboard_data)
 * PATCH  — rename: { name?, description? }
 * DELETE — permanently delete the project
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  if (!isSupabaseConfigured()) return notConfigured(res);

  const id = Number(req.query.id);
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid project id' });

  const supabase = getAdminSupabase();

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Project not found' });
    return res.status(200).json({ project: data });
  }

  // ── PATCH ────────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.name === 'string') {
      if (body.name.trim().length === 0) {
        return res.status(400).json({ error: 'name cannot be empty' });
      }
      updates.name = body.name.trim();
    }
    if (typeof body.description === 'string') {
      updates.description = body.description;
    }

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ error: 'Provide name or description to update' });
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select('id, name, description, updated_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ project: data });
  }

  // ── DELETE ───────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
