import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AdminApp } from './admin/AdminApp.tsx'

// Route /admin (and any sub-path) to the admin panel; everything else goes to
// the regular feasibility app.  Both share the same index.html entry point —
// Vercel's SPA rewrite rule ensures all paths serve this file.
const isAdminRoute = window.location.pathname.startsWith('/admin');

if (isAdminRoute) {
  // Defence-in-depth: robots.txt disallows /admin, but we also emit a
  // page-level noindex in case a crawler follows a stray inbound link.
  const robots = document.createElement('meta');
  robots.name = 'robots';
  robots.content = 'noindex,nofollow,noarchive';
  document.head.appendChild(robots);
  document.title = 'Admin — Pencil';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminRoute ? <AdminApp /> : <App />}
  </StrictMode>,
)
