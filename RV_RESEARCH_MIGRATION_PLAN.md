# RV Research → RVVals Migration Plan (env-var-only, RV-only)

Goal: add the **Retirement Village Research** feature (one page + its AI
backend) to the existing `matthewhe22/RVVals` app.

**Locked decisions (from the user):**
1. RVVals **already has a scaffold** → add **one new page** to the existing App.
2. **Env-var-only provider keys — NO database.** Drop Supabase, the admin
   settings UI, and all `api/admin/*` config endpoints.
3. **RV only** — do **not** bring `api/benchmarks/research.ts`.

This plan was written in a session scoped to `feasibility` only (RVVals
unreachable). Execute it from a new session whose environment grants access to
**both** `matthewhe22/feasibility` (read source) and `matthewhe22/RVVals`
(write target). Confirm the git proxy authorizes RVVals for clone/push, not just
the GitHub MCP API.

---

## 1. Key finding: the resolvers already support env-only

No refactor of the resolution logic is needed — just stop passing a Supabase
client:

- `aiSettings.resolveProviderChain(supabase: SupabaseClient | null)` — pass
  **`null`** → it skips `loadAISettings` and resolves from `process.env` keys
  (`GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` / `NVIDIA_API_KEY`)
  and env models, ordering the active provider first.
- `cotality.resolveCotalitySettings(...)` — already falls back to
  `COTALITY_CLIENT_ID` / `COTALITY_CLIENT_SECRET` / `COTALITY_TOKEN_URL` /
  `COTALITY_API_BASE_URL` / `COTALITY_REGION` / `COTALITY_DATA_PATH`.
- `tavily.resolveTavilySettings(...)` — already falls back to `TAVILY_API_KEY`
  (+ `TAVILY_MAX_RESULTS` / `TAVILY_SEARCH_DEPTH` / `TAVILY_CACHE_TTL_MS`).
- `researchCache.ts` — pure in-memory `Map`, no DB. Copy as-is.
- `auth.ts` — only `setCors` is needed (drop the JWT/credential helpers).

The endpoint `api/research/retirement-village.ts` currently calls
`getAdminSupabase()` / `isSupabaseConfigured()` and passes the client to the
resolvers. **Edit it to pass `null`** and remove the `supabase` import.

---

## 2. Files to migrate

### Backend → RVVals `api/`

| Source file | Action |
|---|---|
| `api/research/retirement-village.ts` | Copy, then **edit**: remove `import ../_lib/supabase`; call resolvers with `null` instead of a client; drop the `isSupabaseConfigured()` gate. |
| `api/_lib/aiClient.ts` | Copy as-is. |
| `api/_lib/researchCache.ts` | Copy as-is. |
| `api/_lib/auth.ts` | Copy, **trim to `setCors`** (drop `validateCredentials`/`signToken`/`verifyToken`/`requireAdmin`), or copy whole — harmless. |
| `api/_lib/aiSettings.ts` | Copy. Optionally delete `loadAISettings`/`saveAISettings`/`deleteAISettings` (the only `SupabaseClient` consumers) + the model-refresh fetchers if unused. Keep `resolveProviderChain`, `ALLOWED_MODELS`, `defaultModelFor`, helpers. |
| `api/_lib/cotality.ts` | Copy. Optionally delete `loadCotalitySettings`/`saveCotalitySettings`/`deleteCotalitySettings`. Keep `resolveCotalitySettings`, `fetchCotalityContext`, `getCotalityToken`, types. |
| `api/_lib/tavily.ts` | Copy. Optionally delete `loadTavilySettings`/`saveTavilySettings`/`deleteTavilySettings`. Keep `resolveTavilySettings`, `fetchTavilyContext`, `tavilySearch`, types. |
| `api/_lib/supabase.ts` | **Do not copy.** |
| `api/admin/*` | **Do not copy** (ai-settings, cotality-settings, tavily-settings, nvidia-models, openrouter-models, login, projects, project/, stats). |
| `api/benchmarks/research.ts` | **Do not copy** (RV-only). |

> **`SupabaseClient` type dangle:** the three `_lib` resolver files import
> `type { SupabaseClient } from '@supabase/supabase-js'`. Two options:
> (a) keep `@supabase/supabase-js` as a dep (type-only, simplest), or
> (b) if you delete the `load/save/delete` fns, also remove the type import and
> change `resolve*` signatures from `SupabaseClient | null` to `null` (or drop
> the param). Option (a) is lower-risk for the first migration.

### Frontend → RVVals `app/src/` (or its equivalent)

| Source file | Action |
|---|---|
| `components/research/RetirementVillageResearch.tsx` | Copy. Only deps: `useState` + `formatCurrency`. Calls `POST /api/research/retirement-village`. |
| `utils` → `formatCurrency` | Copy just that helper into RVVals' utils. |
| `admin/*` pages | **Do not copy** (no admin UI in env-only mode). |

**Wiring:** add it as **one new page** in RVVals' existing scaffold — a new
route/tab/nav entry, however RVVals structures pages. Do **not** copy
feasibility's `App.tsx` or `useStore.ts`. Mirror RVVals' own page-registration
pattern (read its current `App`/router first).

---

## 3. Env vars (set in RVVals' Vercel project)

```
# AI providers — at least one
GEMINI_API_KEY            # only provider with native web search
DEEPSEEK_API_KEY
OPENROUTER_API_KEY
NVIDIA_API_KEY
# optional: ACTIVE_PROVIDER / model env vars — see ENV_MODEL map in aiSettings.ts

# Grounding (optional)
TAVILY_API_KEY
TAVILY_MAX_RESULTS        # 1–10
TAVILY_SEARCH_DEPTH       # basic | advanced
TAVILY_CACHE_TTL_MS
COTALITY_CLIENT_ID
COTALITY_CLIENT_SECRET
COTALITY_TOKEN_URL
COTALITY_API_BASE_URL
COTALITY_REGION           # au | nz
COTALITY_DATA_PATH        # path template w/ {suburb}{state}{postcode}

# Cache
RESEARCH_CACHE_TTL_MS
```

No `SUPABASE_*` / `ADMIN_*` vars needed (DB + admin auth removed). With no AI
key set, the endpoint returns its no-provider error — that's the expected
"unconfigured" state.

Confirm exact provider env-var names by reading `ENV_KEY` / `ENV_MODEL` in
`aiSettings.ts` during migration.

---

## 4. NPM deps

**Root `api` runtime (`/package.json`):**
```json
"@google/generative-ai": "^0.21.0",
"@vercel/node": "^5.0.2"
// + "@supabase/supabase-js": "^2.103.0"  ONLY if keeping the type import (option a)
// drop jsonwebtoken (no admin auth)
```

**App:** the RV page needs only React + Tailwind — use whatever RVVals' scaffold
already has; add nothing feaso-specific (no recharts/exceljs/dexie/zustand/etc).

**`vercel.json`:** RVVals likely already has one. Ensure serverless `api/`
functions are picked up and the SPA rewrite exists. Reference:
```json
{
  "buildCommand": "cd app && npm install && npm run build",
  "outputDirectory": "app/dist",
  "installCommand": "npm install && cd app && npm install",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```
Adapt to RVVals' actual layout (it may not use the `app/` subdir split).

---

## 5. Execution checklist (next session, both repos accessible)

1. Clone RVVals; read its structure — build tool, `api/` convention, how pages
   are registered, existing `package.json` / `vercel.json` / tsconfig.
2. Create `api/_lib/` and copy: `aiClient.ts`, `researchCache.ts`, `auth.ts`
   (setCors), `aiSettings.ts`, `cotality.ts`, `tavily.ts`.
3. Copy `api/research/retirement-village.ts` and edit it for env-only (§1):
   drop supabase import, pass `null` to resolvers, drop `isSupabaseConfigured`.
4. Copy `RetirementVillageResearch.tsx` into RVVals' components; add
   `formatCurrency` to utils.
5. Register it as one new page in RVVals' existing App/nav.
6. Add deps (§4); set env vars (§3).
7. Typecheck/build with RVVals' canonical build command (green = gate).
8. Smoke test: page renders; `POST /api/research/retirement-village`
   `{mode:'suburbs', village:'...'}` returns JSON (configured) or a clean
   no-provider error (unconfigured).
9. Commit on RVVals' designated branch; push. **No PR unless asked.**

---

## 6. Notes / risks

- `retirement-village.ts` is the only file needing real edits; everything else
  is copy-or-copy-and-trim.
- Keep the `cotality:{used,...}` / `tavily:{used,...}` response fields and the
  grounding badges in the UI — they degrade gracefully when unconfigured.
- The page's `formatCurrency` import path will change to match RVVals' utils
  location — fix the one import line.
- If RVVals isn't a Vercel project with `@vercel/node` serverless functions,
  the `api/*` handlers (typed `VercelRequest`/`VercelResponse`) must be adapted
  to its server framework — check before copying.
