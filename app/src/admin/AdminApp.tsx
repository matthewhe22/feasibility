import { useState } from 'react';
import { LoginPage } from './LoginPage';
import { StatsPage } from './StatsPage';
import { ProjectsPage } from './ProjectsPage';
import { ProjectSetupPage } from './ProjectSetupPage';
import { BrandingPage } from './BrandingPage';
import { AISettingsPage } from './AISettingsPage';
import { CotalitySettingsPage } from './CotalitySettingsPage';
import { TavilySettingsPage } from './TavilySettingsPage';
import { clearToken, isLoggedIn } from './api';

type AdminTab = 'overview' | 'projects' | 'projectSetup' | 'branding' | 'aiSettings' | 'cotality' | 'tavily';

function NavItem({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'text-gray-400 hover:text-white hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  );
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState<AdminTab>('overview');

  function handleLogout() {
    clearToken();
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-gray-900 flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-gray-800/60 border-r border-gray-700 flex flex-col">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-gray-700">
          <p className="text-white font-bold text-sm">Feasibility Admin</p>
          <p className="text-gray-500 text-xs mt-0.5">Project Manager</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          <NavItem label="Overview" active={tab === 'overview'} onClick={() => setTab('overview')} />
          <NavItem label="Projects" active={tab === 'projects'} onClick={() => setTab('projects')} />
          <NavItem label="Project Setup" active={tab === 'projectSetup'} onClick={() => setTab('projectSetup')} />
          <NavItem label="Branding" active={tab === 'branding'} onClick={() => setTab('branding')} />
          <NavItem label="AI Settings" active={tab === 'aiSettings'} onClick={() => setTab('aiSettings')} />
          <NavItem label="Cotality Data" active={tab === 'cotality'} onClick={() => setTab('cotality')} />
          <NavItem label="Tavily Search" active={tab === 'tavily'} onClick={() => setTab('tavily')} />
        </nav>

        {/* Footer links */}
        <div className="p-4 border-t border-gray-700 space-y-2">
          <a
            href="/"
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to App
          </a>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-red-400 transition w-full"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-auto">
        {tab === 'overview' && <StatsPage />}
        {tab === 'projects' && <ProjectsPage />}
        {tab === 'projectSetup' && <ProjectSetupPage />}
        {tab === 'branding' && <BrandingPage />}
        {tab === 'aiSettings' && <AISettingsPage />}
        {tab === 'cotality' && <CotalitySettingsPage />}
        {tab === 'tavily' && <TavilySettingsPage />}
        {/* Pass children through if we need extra content injection later */}
        {children}
      </main>
    </div>
  );
}

export function AdminApp() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());

  if (!loggedIn) {
    return <LoginPage onSuccess={() => setLoggedIn(true)} />;
  }

  return (
    <AdminLayout>
      {/* placeholder — tabs rendered inside AdminLayout */}
      <></>
    </AdminLayout>
  );
}
