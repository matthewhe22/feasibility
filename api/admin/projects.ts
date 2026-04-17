import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth';
import { getAdminSupabase, isSupabaseConfigured } from '../_lib/supabase';

/**
 * GET /api/admin/projects
 * Returns all projects (metadata only — admin + inputs are summarised to keep payload small).
 * Query params:
 *   ?page=1          pagination (default 1)
 *   ?limit=20        page size (default 20, max 100)
 *   ?search=name     filter by project name (case-insensitive)
 *   ?sort=updated    sort field: "updated" | "created" | "name" (default "updated")
 *   ?order=desc      sort direction: "asc" | "desc" (default "desc")
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Supabase is not configured. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    });
  }

  const supabase = getAdminSupabase();

  // Parse query params
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
  const search = String(req.query.search ?? '').trim();
  const sortField = String(req.query.sort ?? 'updated');
  const sortOrder = String(req.query.order ?? 'desc') === 'asc';
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const columnMap: Record<string, string> = {
    updated: 'updated_at',
    created: 'created_at',
    name: 'name',
  };
  const orderColumn = columnMap[sortField] ?? 'updated_at';

  // Count total matching rows for pagination metadata
  let countQuery = supabase
    .from('projects')
    .select('id', { count: 'exact', head: true });
  if (search) countQuery = countQuery.ilike('name', `%${search}%`);
  const { count } = await countQuery;

  // Fetch page of rows — exclude heavy JSONB columns (admin/inputs/dashboard_data)
  // to keep listing fast; full data is fetched in /api/admin/project/[id]
  let query = supabase
    .from('projects')
    .select('id, name, description, created_at, updated_at')
    .order(orderColumn, { ascending: sortOrder })
    .range(from, to);
  if (search) query = query.ilike('name', `%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    projects: data,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      pages: Math.ceil((count ?? 0) / limit),
    },
  });
}
