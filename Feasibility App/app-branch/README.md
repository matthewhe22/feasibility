# Pencil — Branding branch

Apply this set to a new branch `brand/pencil` in `matthewhe22/feasibility`, then PR to main.

## Files in this folder
- `app/index.html` — adds Google Fonts (Plex Sans, Plex Mono, Fraunces), retitles tab to "Pencil — Feasibility Engine"
- `app/public/favicon.svg` — new Pencil mark favicon (replaces existing)
- `app/src/index.css` — Pencil design tokens + base typography + custom scrollbar
- `app/src/App.tsx` — Header replaced with Pencil wordmark + ochre-accent tab row (see below)

## App.tsx header patch
Replace the `<header>…</header>` block and the `<nav>` tab-row block with:

```tsx
{/* Pencil branded header */}
<header className="pencil-header px-6 py-4 flex items-center justify-between">
  <div className="flex items-center gap-4">
    <svg width="44" height="44" viewBox="0 0 100 100">
      <rect x="14" y="44" width="58" height="14" fill="none" stroke="#F4F1EA" strokeWidth="2.5"/>
      <rect x="72" y="44" width="8" height="14" fill="#F4F1EA"/>
      <polygon points="80,44 96,51 80,58" fill="#C48A3C"/>
      <line x1="14" y1="72" x2="86" y2="72" stroke="#F4F1EA" strokeWidth="2"/>
    </svg>
    <div>
      <div className="pencil-wordmark text-2xl leading-none">Pencil</div>
      <div className="pencil-tagline mt-1">Feasibility · Engine</div>
    </div>
    <div className="ml-6 pencil-num text-xs text-gray-400">
      {admin.projectName || 'Property Development Feasibility'}
    </div>
  </div>
  <div className="flex gap-2">
    <button onClick={() => setShowProjectManager(true)}
      className="pencil-num text-xs px-4 py-2 border border-[#3a3e44] hover:bg-[#1A1D21] transition">
      Projects
    </button>
    <button onClick={calculate} disabled={isCalculating}
      className="pencil-num text-xs px-5 py-2 bg-[#C48A3C] text-[#0E1012] font-semibold hover:bg-[#D89A47] disabled:opacity-60 transition">
      {isCalculating ? 'Calculating…' : 'Run Calculations'}
    </button>
  </div>
</header>

{/* Pencil tab row */}
<nav className="bg-white border-b border-[#CFC7B5] sticky top-0 z-10">
  <div className="flex px-6">
    {TABS.map(tab => (
      <button
        key={tab.id}
        onClick={() => setActiveTab(tab.id as Parameters<typeof setActiveTab>[0])}
        className={`pencil-tab px-5 py-3 border-b-2 transition-colors ${
          activeTab === tab.id
            ? 'pencil-tab-active'
            : 'border-transparent text-[#6A6558] hover:text-[#0E1012]'
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>
</nav>
```

Also update the footer — replace with:
```tsx
<footer className="bg-[#0E1012] text-[#8A8574] text-xs text-center py-3 pencil-num">
  <div>Pencil — Feasibility Engine · v1.0</div>
  <div className="text-[#5A5548] text-[10px] mt-1">
    Last updated: {new Date(__BUILD_TIME__).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
  </div>
</footer>
```

And change the default `appTitle` fallback:
```tsx
const appTitle = admin.appName || 'Pencil — Feasibility Engine';
```

## Git commands
```
cd feasibility
git checkout -b brand/pencil
# copy app-branch/app/* over app/*
git add app/
git commit -m "brand: apply Pencil identity (Plex type, paper+ink+ochre, new favicon)"
git push -u origin brand/pencil
# open PR to main
```
