# RV Research → RVVals Migration Plan

Goal: move the **Retirement Village Research** feature (page + UI + backend AI
setup) out of `matthewhe22/feasibility` and into `matthewhe22/RVVals` as a
standalone app.

This plan was prepared in a session that could **not** reach RVVals (scope was
locked to `feasibility`). To execute it, start a new Claude Code web session
whose environment grants access to **both** repos:

- `matthewhe22/feasibility` (source — read)
- `matthewhe22/RVVals` (target — write)

---

## 1. File inventory (what moves)

### Backend — Vercel serverless API (`api/`)

| Source file | Purpose | Migrate? |
|---|---|---|
| `api/research/retirement-village.ts` | **The RV endpoint** (`mode: 'suburbs' \| 'competitors'`) | ✅ required |
| `api/_lib/aiClient.ts` | Shared Gemini/DeepSeek/OpenRouter/NVIDIA caller + `mergeSources` | ✅ required |
| `api/_lib/aiSettings.ts` | Provider config, key storage, `resolveProviderChain` | ✅ required |
| `api/_lib/cotality.ts` | Cotality (CoreLogic) grounding | ✅ required |
| `api/_lib/tavily.ts` | Tavily web-search grounding | ✅ required |
| `api/_lib/researchCache.ts` | Response cache (Tavily quota protection) | ✅ required |
| `api/_lib/auth.ts` | CORS + admin JWT helpers | ✅ required |
| `api/_lib/supabase.ts` | Service-role Supabase client | ✅ required |
| `api/admin/ai-settings.ts` | Admin GET/POST AI provider settings | ✅ required (to configure providers) |
| `api/admin/cotality-settings.ts` | Admin Cotality creds + `{test:true}` | ✅ required |
| `api/admin/tavily-settings.ts` | Admin Tavily key + `{test:true}` | ✅ required |
| `api/admin/nvidia-models.ts` | Refresh NVIDIA model catalogue | ✅ required |
| `api/admin/openrouter-models.ts` | Refresh OpenRouter free-model catalogue | ✅ required |
| `api/admin/login.ts` | Admin login (issues JWT) | ✅ required |
| `api/benchmarks/research.ts` | Cost/GRV benchmark research | ⛔ feasibility-specific — **skip** unless RVVals wants it |
| `api/admin/projects.ts`, `project/`, `stats.ts` | Feaso project CRUD/stats | ⛔ feasibility-specific — **skip** |

### Frontend — React app (`app/src/`)

| Source file | Purpose | Migrate? |
|---|---|---|
| `components/research/RetirementVillageResearch.tsx` | **The RV page/UI** (only imports `useState` + `utils.formatCurrency`) | ✅ required |
| `admin/AdminApp.tsx` | Admin shell + nav (strip feaso-only tabs) | ✅ adapt |
| `admin/LoginPage.tsx` | Admin login UI | ✅ required |
| `admin/AISettingsPage.tsx` | AI provider config UI | ✅ required |
| `admin/CotalitySettingsPage.tsx` | Cotality config UI | ✅ required |
| `admin/TavilySettingsPage.tsx` | Tavily config UI | ✅ required |
| `admin/api.ts` | Client helpers for `/api/admin/*` | ✅ adapt (drop project/stats fns) |
| `admin/BrandingPage.tsx`, `StatsPage.tsx`, `ProjectsPage.tsx`, `ProjectSetupPage.tsx`, `projectSetupValidator.ts` | Feaso admin | ⛔ skip |
| `utils/` (just `formatCurrency`) | Number formatting | ✅ copy the one helper |

---

## 2. Dependency graph (import-level)

```
RetirementVillageResearch.tsx
  └─ utils.formatCurrency            (copy 1 fn)
  └─ POST /api/research/retirement-village

api/research/retirement-village.ts
  ├─ _lib/auth        (setCors)
  ├─ _lib/supabase    (getAdminSupabase, isSupabaseConfigured)
  ├─ _lib/aiSettings  (resolveProviderChain)
  ├─ _lib/cotality    (resolveCotalitySettings, fetchCotalityContext)
  ├─ _lib/tavily      (resolveTavilySettings, fetchTavilyContext)
  ├─ _lib/aiClient    (runAIResearch, mergeSources, AIResearchError, AIResearchSource)
  └─ _lib/researchCache (researchCacheKey, getCachedResearch, setCachedResearch)

Admin config pages → admin/api.ts → /api/admin/{ai-settings,cotality-settings,tavily-settings,login,nvidia-models,openrouter-models}
  → _lib/{auth,supabase,aiSettings,cotality,tavily}
```

No feaso engine/store dependency — the RV feature is cleanly separable.

---

## 3. Data store (Supabase)

Admin settings persist as **sentinel rows in the `projects` table**, in an
`admin` JSONB column:

- `__ai_settings__`     → `admin.aiSettings.keys.{gemini|deepseek|openrouter|nvidia}` + active provider/model
- `__cotality_settings__` → OAuth2 client id/secret, token/base URLs, region, data-path template
- `__tavily_settings__`  → api key, enabled, maxResults, searchDepth

**RVVals action:** provision a Supabase project and create a `projects` table
with at least an identity PK + a `name`/key text column + an `admin jsonb`
column (the sentinel rows are keyed by `name`). Confirm exact column names by
reading the `.from('projects')` queries in `aiSettings.ts` / `cotality.ts` /
`tavily.ts` during migration. There is **no committed SQL schema** in
feasibility — derive it from the lib queries.

---

## 4. Environment variables (Vercel project for RVVals)

Required / used by the migrated code:

```
# Supabase (server)
SUPABASE_URL                 (or VITE_SUPABASE_URL)
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL            (client, if used)

# Admin auth
ADMIN_USERNAME
ADMIN_PASSWORD
ADMIN_JWT_SECRET
ADMIN_CORS_ORIGIN

# AI providers (any subset; can also be saved via Admin UI)
GEMINI_API_KEY
DEEPSEEK_API_KEY
OPENROUTER_API_KEY
NVIDIA_API_KEY

# Grounding
TAVILY_API_KEY
TAVILY_CACHE_TTL_MS
TAVILY_MAX_RESULTS
TAVILY_SEARCH_DEPTH
COTALITY_CLIENT_ID
COTALITY_CLIENT_SECRET
COTALITY_TOKEN_URL
COTALITY_API_BASE_URL
COTALITY_REGION
COTALITY_DATA_PATH

# Cache
RESEARCH_CACHE_TTL_MS
```

(Note: `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` referenced in `aiSettings.ts`
resolution; confirm exact names there.)

---

## 5. NPM dependencies

**Root (`/package.json` — Vercel API runtime):**
```json
"@google/generative-ai": "^0.21.0",
"@supabase/supabase-js": "^2.103.0",
"@vercel/node": "^5.0.2",
"jsonwebtoken": "^9.0.2"
// devDeps: @types/jsonwebtoken, @types/node, typescript
```

**App (`app/package.json`):** RV page itself only needs React + Tailwind. Drop
feaso-only deps (recharts, exceljs, dexie, file-saver, zustand, @vercel/analytics)
unless RVVals reuses them. Minimum: `react`, `react-dom`, `tailwindcss`,
`@tailwindcss/vite`, `@supabase/supabase-js` (if client touches it), plus the
vite/eslint/ts devDeps.

**`vercel.json`** (copy + keep):
```json
{
  "buildCommand": "cd app && npm install && npm run build",
  "outputDirectory": "app/dist",
  "installCommand": "npm install && cd app && npm install",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

## 6. Frontend wiring to remove (feaso-specific)

`RetirementVillageResearch` is registered in `app/src/App.tsx`:
- import line 18, `TabId` union (line 74), tab list entry (line 85), render (line 375)
- also in `app/src/store/useStore.ts` `TabId` union (line 34)

In RVVals it should likely be the **primary/standalone page** (or one of a few),
not a tab buried in the feaso shell — so build a fresh minimal `App.tsx` around
it rather than copying the feaso `App.tsx`.

`AdminApp.tsx` nav: keep **AI Settings / Cotality Data / Tavily Search**; drop
**overview/projects/projectSetup/branding** tabs (and their pages).

---

## 7. Execution checklist (next session, both repos accessible)

1. `git clone` RVVals; inspect its current structure (may be empty/scaffold).
2. Decide layout — mirror feasibility's `app/` + `api/` split, or RVVals' own.
3. Copy the ✅ backend files into `api/` (preserve `_lib/` relative imports).
4. Copy the ✅ frontend files into `app/src/`; strip feaso-only admin tabs/pages.
5. Add `formatCurrency` to RVVals `utils`.
6. Build a minimal `App.tsx` that renders `RetirementVillageResearch` (+ admin route).
7. Add root + app `package.json` deps; add `vercel.json`.
8. Provision Supabase `projects` table (sentinel-row schema, §3).
9. Set Vercel env vars (§4).
10. `cd app && npm install && npm run build` — green build is the gate.
11. Commit on RVVals' designated branch; push.

---

## 8. Open questions for the user

- Does RVVals already have a scaffold/structure, or start clean?
- Keep the admin/Supabase settings layer, or hard-code provider keys via env
  only (simpler, no DB)? The current code expects the `projects` sentinel rows.
- Include the cost/GRV `benchmarks/research.ts` endpoint too, or RV-only?
