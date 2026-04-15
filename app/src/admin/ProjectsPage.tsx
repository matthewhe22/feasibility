import { useEffect, useState, useCallback } from 'react';
import {
  fetchProjects, renameProject, deleteProject,
  type ProjectSummary,
} from './api';

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface RenameModal {
  id: number;
  name: string;
  description: string;
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination & search
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;

  // Rename modal
  const [renameModal, setRenameModal] = useState<RenameModal | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async (p: number, s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProjects({ page: p, limit: LIMIT, search: s, sort: 'updated', order: 'desc' });
      setProjects(res.projects);
      setTotalPages(res.pagination.pages);
      setTotal(res.pagination.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page, search); }, [load, page, search]);

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
  }

  // ── Rename ───────────────────────────────────────────────────────────────────
  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!renameModal) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      await renameProject(renameModal.id, renameModal.name, renameModal.description);
      setRenameModal(null);
      load(page, search);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setRenameBusy(false);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteProject(deleteTarget.id);
      setDeleteTarget(null);
      if (projects.length === 1 && page > 1) setPage(p => p - 1);
      else load(page, search);
    } catch {
      // ignore — leave modal open with a retry
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-white">Projects</h2>
        <span className="text-gray-500 text-sm">{total} total</span>
      </div>

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={handleSearchChange}
        placeholder="Search by name…"
        className="w-full sm:w-80 bg-gray-800 text-white rounded-lg px-4 py-2 text-sm
                   border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500
                   outline-none placeholder-gray-600 transition"
      />

      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-700/60 text-gray-400 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 text-left">ID</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left hidden md:table-cell">Description</th>
              <th className="px-4 py-3 text-left hidden lg:table-cell">Created</th>
              <th className="px-4 py-3 text-left">Updated</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-xs animate-pulse">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && projects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500 text-xs">
                  {search ? 'No projects match your search.' : 'No projects yet.'}
                </td>
              </tr>
            )}
            {!loading && projects.map(p => (
              <tr key={p.id} className="hover:bg-gray-700/40 transition-colors">
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.id}</td>
                <td className="px-4 py-3 text-white font-medium max-w-[200px] truncate">{p.name}</td>
                <td className="px-4 py-3 text-gray-400 hidden md:table-cell max-w-[180px] truncate">
                  {p.description || <span className="text-gray-600 italic">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">{fmt(p.created_at)}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{fmt(p.updated_at)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {/* Open in app */}
                    <a
                      href={`/?project=${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 font-medium transition"
                      title="Open in app"
                    >
                      Open
                    </a>
                    <button
                      onClick={() => {
                        setRenameModal({ id: p.id, name: p.name, description: p.description });
                        setRenameError(null);
                      }}
                      className="text-xs text-gray-400 hover:text-white font-medium transition"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => setDeleteTarget(p)}
                      className="text-xs text-red-400 hover:text-red-300 font-medium transition"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded-lg disabled:opacity-40
                       hover:bg-gray-700 transition text-xs"
          >
            ← Previous
          </button>
          <span className="text-gray-500 text-xs">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded-lg disabled:opacity-40
                       hover:bg-gray-700 transition text-xs"
          >
            Next →
          </button>
        </div>
      )}

      {/* ── Rename Modal ─────────────────────────────────────────────────── */}
      {renameModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-white mb-4">Rename Project</h3>
            <form onSubmit={handleRenameSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={renameModal.name}
                  onChange={e => setRenameModal(m => m ? { ...m, name: e.target.value } : m)}
                  required
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm
                             border border-gray-600 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={renameModal.description}
                  onChange={e => setRenameModal(m => m ? { ...m, description: e.target.value } : m)}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm
                             border border-gray-600 focus:border-blue-500 outline-none"
                  placeholder="Optional description"
                />
              </div>
              {renameError && (
                <p className="text-red-400 text-sm">{renameError}</p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRenameModal(null)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renameBusy}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm
                             font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {renameBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ─────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-white mb-2">Delete Project?</h3>
            <p className="text-gray-400 text-sm mb-6">
              <span className="text-white font-semibold">"{deleteTarget.name}"</span> will be permanently
              deleted. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteBusy}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm
                           font-semibold rounded-lg transition disabled:opacity-50"
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
