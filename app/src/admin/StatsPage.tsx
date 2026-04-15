import { useEffect, useState } from 'react';
import { fetchStats, type AdminStats } from './api';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function StatsPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch(e => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-xl p-6 text-sm">
        {error}
      </div>
    );
  }

  if (!stats) {
    return <div className="text-gray-500 text-sm animate-pulse">Loading statistics…</div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white">Overview</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Projects" value={stats.totalProjects} />
        <StatCard
          label="Updated (last 7 days)"
          value={stats.recentlyUpdated}
          sub="projects with recent activity"
        />
        <StatCard
          label="New (last 30 days)"
          value={stats.createdLast30Days}
          sub="projects created"
        />
      </div>

      {/* Recent activity */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-200">Recently Updated</h3>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {stats.latestProjects.map((p, i) => (
              <tr key={p.id} className={i % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
                <td className="px-5 py-3 text-gray-300 font-medium">{p.name}</td>
                <td className="px-5 py-3 text-right text-gray-500 text-xs">
                  {timeAgo(p.updated_at)}
                </td>
              </tr>
            ))}
            {stats.latestProjects.length === 0 && (
              <tr>
                <td colSpan={2} className="px-5 py-6 text-center text-gray-500 text-xs">
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-gray-600 text-xs text-right">
        Generated {new Date(stats.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}
