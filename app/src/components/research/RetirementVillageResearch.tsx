import { useState } from 'react';
import { formatCurrency } from '../../utils';
import { SuburbMap } from './SuburbMap';
import { exportRVResearchToExcel } from '../../utils/rvResearchExcel';
import { summariseByTypology } from '../../utils/typologySummary';
import { houseGrowth, suburbAverages } from '../../utils/suburbPricing';

/**
 * Retirement Village Property Research.
 *
 * Two independent research tools that combine the configured AI model (Admin →
 * AI Settings) with optional Cotality property data (Admin → Cotality Data):
 *   1. Surrounding-suburb pricing — median house / unit / $m² per related
 *      suburb + indicative averages (MHP, MUP, avg $/m²).
 *   2. Competitor villages — recently sold / listed units within a proximity
 *      radius, with price, date, beds, baths, study where available.
 */

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export interface ResearchSource { title: string; url: string; snippet?: string }
export interface CotalityNote { used: boolean; url?: string; reason?: string }

/** Mirror of SuburbMapData in api/_lib/staticMap.ts. */
export interface SuburbMapData {
  /** Stitched OSM tiles as a PNG data URL — no text drawn on it server-side. */
  image: string;
  markers: Array<{ x: number; y: number; label: string; color: string }>;
  attribution: string;
  width: number;
  height: number;
}

export interface SuburbRow {
  suburb: string;
  state?: string;
  postcode?: string;
  distanceKm?: number | null;
  medianHousePrice?: number | null;
  medianUnitPrice?: number | null;
  medianDollarPerSqm?: number | null;
  asOf?: string | null;
  /** Median house price 12 / 6 months before `asOf`, and the growth to now in
   *  percent (4.2 = +4.2%). Growth is derived from the prices when both exist. */
  medianHousePrice12mAgo?: number | null;
  medianHousePrice6mAgo?: number | null;
  houseGrowth12mPct?: number | null;
  houseGrowth6mPct?: number | null;
  /** Server-side geocoded (OpenStreetMap Nominatim) — null when unavailable. */
  lat?: number | null;
  lng?: number | null;
}
export interface SuburbsResult {
  village?: { name?: string; suburb?: string; state?: string; postcode?: string };
  suburbs: SuburbRow[];
  averages?: { avgMedianHousePrice?: number | null; avgMedianUnitPrice?: number | null; avgDollarPerSqm?: number | null };
  summary: string;
  sources: ResearchSource[];
  model?: string;
  provider?: string;
  timestamp?: string;
  cotality?: CotalityNote;
  groundingUsed?: boolean;
  /** Real OSM map (server-generated, api/_lib/staticMap.ts): stitched tiles as
   *  a PNG data URL plus marker positions. Labels are drawn client-side, where
   *  real fonts exist — see SuburbMapData in staticMap.ts. Null if the base-map
   *  fetch or geocoding failed. */
  map?: SuburbMapData | null;
}

export interface UnitRow {
  /** Owner/operator brand (Keyton, Aveo, Australian Unity…), not the village. */
  operator?: string | null;
  villageName: string;
  unitNumber?: string | null;
  address?: string | null;
  suburb?: string | null;
  distanceKm?: number | null;
  priceType?: 'sold' | 'listing' | null;
  price?: number | null;
  date?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  study?: boolean | null;
  carSpaces?: number | null;
  /** Internal/living area, m². `landSqm` is populated for villas / land-lease. */
  internalSqm?: number | null;
  landSqm?: number | null;
  unitType?: string | null;
  /** licence / loan-lease / leasehold / strata / rental — RV units rarely sell freehold. */
  tenure?: string | null;
  dmfSummary?: string | null;
  recurringFee?: number | null;
  recurringFeePeriod?: string | null;
  note?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
}
export interface CompetitorsResult {
  subject?: { name?: string; suburb?: string; state?: string; postcode?: string };
  proximityKm?: number;
  units: UnitRow[];
  summary: string;
  sources: ResearchSource[];
  model?: string;
  provider?: string;
  timestamp?: string;
  cotality?: CotalityNote;
  groundingUsed?: boolean;
}

/**
 * Numeric fields are normalised server-side (api/_lib/normalizeUnits.ts), but
 * every read goes through this anyway: responses cached before that landed —
 * and any field the model returns in an unexpected shape — still carry strings
 * like "85" or "85 m²", and a bare `typeof x === 'number'` test drops them
 * silently, which is what emptied the internal-area and $/m² columns.
 */
export const toNum = (v: unknown): number | null => {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /-?\d+(?:\.\d+)?/.exec(v.replace(/,/g, ''));
  const n = m ? Number(m[0]) : NaN;
  return isFinite(n) ? n : null;
};

/** Companion to toNum for `study`: the model returns "Yes"/"No" as often as a
 *  boolean, and an uncoerced string is neither true nor false — which silently
 *  splits one typology into two groups. */
export const toBool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
};

const money = (v?: unknown) => {
  const n = toNum(v);
  return n === null ? '—' : formatCurrency(n);
};
const num = (v?: unknown) => {
  const n = toNum(v);
  return n === null ? '—' : String(n);
};

/** Area cell: internal m², with land m² beneath it for villas / land-lease. */
function area(u: UnitRow): React.ReactNode {
  const internal = toNum(u.internalSqm);
  const land = toNum(u.landSqm);
  if (internal == null && land == null) return '—';
  return (
    <>
      {internal ?? '—'}
      {land != null && <span className="block text-[10px] text-gray-500">{land} land</span>}
    </>
  );
}

/** Price per internal m² — the comparison that makes units of different sizes
 *  comparable. Only shown when both figures are real; never estimated. */
function dollarsPerSqm(u: UnitRow): string {
  const p = toNum(u.price);
  const a = toNum(u.internalSqm);
  if (p === null || p <= 0 || a === null || a <= 0) return '—';
  return formatCurrency(Math.round(p / a));
}

/** Most villages one run can research — each costs two AI calls per section. */
const MAX_VILLAGES = 5;

interface VillageInput {
  villageName: string;
  state: string;
  suburb: string;
  postcode: string;
}
const emptyVillage = (): VillageInput => ({ villageName: '', state: '', suburb: '', postcode: '' });

/** Signed percentage, e.g. "+4.2%" / "−1.3%". */
const pct = (v?: unknown) => {
  const n = toNum(v);
  if (n === null) return '—';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;
};
const pctClass = (v?: unknown) => {
  const n = toNum(v);
  return n === null ? '' : n > 0 ? 'text-emerald-700' : n < 0 ? 'text-red-700' : '';
};

export function RetirementVillageResearch() {
  const [villages, setVillages] = useState<VillageInput[]>([emptyVillage()]);
  const [proximityKm, setProximityKm] = useState(5);

  // Results are indexed by village row.
  const [subLoading, setSubLoading] = useState<string | null>(null);
  const [subErrors, setSubErrors] = useState<Array<string | null>>([]);
  const [subResults, setSubResults] = useState<Array<SuburbsResult | null>>([]);

  const [compLoading, setCompLoading] = useState<string | null>(null);
  const [compErrors, setCompErrors] = useState<Array<string | null>>([]);
  const [compResults, setCompResults] = useState<Array<CompetitorsResult | null>>([]);

  const setVillageCount = (n: number) => {
    setVillages(v => (n > v.length ? [...v, ...Array.from({ length: n - v.length }, emptyVillage)] : v.slice(0, n)));
    setSubResults(r => r.slice(0, n)); setSubErrors(e => e.slice(0, n));
    setCompResults(r => r.slice(0, n)); setCompErrors(e => e.slice(0, n));
  };
  const updateVillage = (i: number, patch: Partial<VillageInput>) =>
    setVillages(v => v.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const setAt = <T,>(set: React.Dispatch<React.SetStateAction<Array<T | null>>>, i: number, value: T) =>
    set(arr => { const next = [...arr]; next[i] = value; return next; });

  async function research<T>(mode: 'suburbs' | 'competitors', v: VillageInput, extra?: Record<string, unknown>): Promise<T> {
    const r = await fetch('/api/research/retirement-village', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        villageName: v.villageName.trim(),
        state: v.state || undefined,
        suburb: v.suburb.trim() || undefined,
        postcode: v.postcode.trim() || undefined,
        proximityKm,
        ...extra,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    return (await r.json()) as T;
  }

  /** Indices of the rows that have a village name — blank rows are skipped. */
  const namedRows = () => villages.map((v, i) => (v.villageName.trim() ? i : -1)).filter(i => i >= 0);

  // Villages run one after another rather than in parallel: each request
  // already fans out to several searches, and free-tier AI keys rate-limit
  // bursts.
  const runSuburbs = async () => {
    const rows = namedRows();
    if (!rows.length) { setSubErrors(['Enter a retirement village name first.']); return; }
    const prior = subResults;
    setSubErrors([]); setSubResults([]);
    for (const [n, i] of rows.entries()) {
      const v = villages[i];
      if (!v) continue;
      setSubLoading(rows.length > 1 ? `${n + 1} / ${rows.length}` : '');
      // A re-run (a result already showing) is an explicit request for fresh data —
      // bypass the server's 6h response cache so a live figure that moved since the
      // last pull (e.g. a portal's rolling-median recalculation) actually shows up,
      // instead of silently re-serving the same cached answer. The first run for a
      // village still hits the cache normally, so identical lookups within the
      // window (incl. from other users) don't each spend search credits.
      const refresh = Boolean(prior[i]);
      try { setAt(setSubResults, i, await research<SuburbsResult>('suburbs', v, refresh ? { refresh: true } : undefined)); }
      catch (e) { setAt(setSubErrors, i, e instanceof Error ? e.message : 'Research failed.'); }
    }
    setSubLoading(null);
  };

  const runCompetitors = async () => {
    const rows = namedRows();
    if (!rows.length) { setCompErrors(['Enter a retirement village name first.']); return; }
    const prior = compResults;
    setCompErrors([]); setCompResults([]);
    for (const [n, i] of rows.entries()) {
      const v = villages[i];
      if (!v) continue;
      setCompLoading(rows.length > 1 ? `${n + 1} / ${rows.length}` : '');
      // See runSuburbs — a re-run bypasses the response cache so it actually
      // re-searches instead of re-serving the same cached answer.
      const refresh = Boolean(prior[i]);
      // Reuse this village's confirmed nearby-suburb list from section 1 (if it's
      // been run) so competitor search covers the proximity radius. Without it
      // the server resolves the suburb list itself.
      const nearbySuburbs = (subResults[i]?.suburbs ?? [])
        .filter(s => s.distanceKm == null || s.distanceKm <= proximityKm)
        .map(s => s.suburb)
        .filter(Boolean);
      const extra: Record<string, unknown> = {};
      if (nearbySuburbs.length) extra.nearbySuburbs = nearbySuburbs;
      if (refresh) extra.refresh = true;
      try { setAt(setCompResults, i, await research<CompetitorsResult>('competitors', v, Object.keys(extra).length ? extra : undefined)); }
      catch (e) { setAt(setCompErrors, i, e instanceof Error ? e.message : 'Research failed.'); }
    }
    setCompLoading(null);
  };

  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportEntries = villages
    .map((v, i) => ({ villageName: v.villageName.trim(), suburbs: subResults[i] ?? null, competitors: compResults[i] ?? null }))
    .filter(e => e.suburbs || e.competitors);
  const canExport = exportEntries.length > 0;
  const runExport = async () => {
    setExportError(null);
    setExporting(true);
    try { await exportRVResearchToExcel(exportEntries); }
    catch (e) { setExportError(e instanceof Error ? e.message : 'Export failed.'); }
    finally { setExporting(false); }
  };

  const multi = villages.length > 1;
  const heading = (i: number) => multi ? (
    <h4 className="text-xs font-bold text-purple-800 border-b border-purple-200 pb-1 mb-2 mt-1">
      Village {i + 1}: {villages[i]?.villageName.trim() || '(unnamed)'}
    </h4>
  ) : null;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Retirement Village Property Research</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Combines the configured AI model (Admin → AI Settings) with Cotality property data (Admin → Cotality Data)
              to research surrounding-suburb pricing and nearby retirement-village competitors. Figures are indicative —
              verify against the linked sources before relying on them.
            </p>
          </div>
          <button onClick={runExport} disabled={!canExport || exporting}
            title={canExport ? 'Export every village and section that has run to one Excel workbook' : 'Run at least one section below first'}
            className="text-[11px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-3 py-1.5 rounded font-medium whitespace-nowrap">
            {exporting ? 'Exporting…' : '⬇ Export to Excel'}
          </button>
        </div>
        {exportError && <p className="text-[11px] text-red-600 mt-1">{exportError}</p>}
        <p className="text-[11px] text-amber-700 mt-1">
          Tip: live results (current villages.com.au / downsizing.com.au listings) need a <strong>Gemini</strong> model
          with web search, or a <strong>Firecrawl</strong> key — DeepSeek has no live search of its own. Set these in Admin.
        </p>
      </div>

      {/* Shared inputs — one row per village */}
      <div className="border border-gray-200 bg-white rounded p-3 mb-4">
        <label className="flex items-center gap-2 text-[11px] text-gray-600 mb-3">
          Number of villages to research
          <select value={villages.length} onChange={e => setVillageCount(parseInt(e.target.value, 10))}
            disabled={subLoading !== null || compLoading !== null}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-yellow-50 focus:ring-1 focus:ring-blue-400">
            {Array.from({ length: MAX_VILLAGES }, (_, k) => k + 1).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {multi && <span className="text-gray-400">Each section researches the villages one after another.</span>}
        </label>
        {villages.map((v, i) => (
          <div key={i} className={`grid grid-cols-1 md:grid-cols-12 gap-3 items-end ${i > 0 ? 'mt-3 pt-3 border-t border-gray-100' : ''}`}>
            <Field className="md:col-span-5" label={`${multi ? `Village ${i + 1} — r` : 'R'}etirement village name *`}>
              <input value={v.villageName} onChange={e => updateVillage(i, { villageName: e.target.value })}
                placeholder="e.g. Aveo Springfield"
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-yellow-50 focus:ring-1 focus:ring-blue-400" />
            </Field>
            <Field className="md:col-span-2" label="State">
              <select value={v.state} onChange={e => updateVillage(i, { state: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-yellow-50 focus:ring-1 focus:ring-blue-400">
                <option value="">(auto)</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field className="md:col-span-3" label="Suburb (optional — improves grounding)">
              <input value={v.suburb} onChange={e => updateVillage(i, { suburb: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-yellow-50 focus:ring-1 focus:ring-blue-400" />
            </Field>
            <Field className="md:col-span-2" label="Postcode (optional)">
              <input value={v.postcode} onChange={e => updateVillage(i, { postcode: e.target.value })} inputMode="numeric"
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-yellow-50 focus:ring-1 focus:ring-blue-400" />
            </Field>
          </div>
        ))}
      </div>

      {/* Section 1 — Surrounding suburb pricing */}
      <Section
        title="1. Surrounding-suburb pricing"
        subtitle="Median house price (MHP) now, 12 and 6 months ago with growth, median unit price (MUP) and median $/m² for each village's suburb and adjacent suburbs."
        onRun={runSuburbs}
        running={subLoading !== null}
        runLabel="Research suburb prices"
        runningLabel={subLoading ? `Researching ${subLoading}…` : undefined}
      >
        {villages.map((_, i) => (subResults[i] || subErrors[i]) && (
          <div key={i} className={i > 0 ? 'mt-5' : ''}>
            {heading(i)}
            {subErrors[i] && <ErrorBox error={subErrors[i]!} />}
            {subResults[i] && <SuburbsResultView result={subResults[i]!} />}
          </div>
        ))}
      </Section>

      {/* Section 2 — Competitor villages */}
      <Section
        title="2. Competitor retirement villages"
        subtitle={`All substantiable past sales and current listings within the proximity radius — operator, village, unit, beds/baths/study/car, m², price, $/m², date and tenure/DMF terms — sourced from villages.com.au, downsizing.com.au, operator sites & portals.${subResults.some(Boolean) ? ' Using the suburb list from section 1 to cover the whole radius.' : ''}`}
        onRun={runCompetitors}
        running={compLoading !== null}
        runLabel="Research competitors"
        runningLabel={compLoading ? `Researching ${compLoading}…` : undefined}
        extraControl={
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
            Proximity
            <input type="number" min={1} max={50} value={proximityKm}
              onChange={e => setProximityKm(Math.max(1, parseInt(e.target.value, 10) || 5))}
              className="w-16 text-xs border border-gray-300 rounded px-1.5 py-1 bg-yellow-50 text-right" />
            km
          </label>
        }
      >
        {villages.map((_, i) => (compResults[i] || compErrors[i]) && (
          <div key={i} className={i > 0 ? 'mt-5' : ''}>
            {heading(i)}
            {compErrors[i] && <ErrorBox error={compErrors[i]!} />}
            {compResults[i] && <CompetitorsResultView result={compResults[i]!} />}
          </div>
        ))}
      </Section>
    </div>
  );
}

function SuburbsResultView({ result }: { result: SuburbsResult }) {
  const a = suburbAverages(result);
  return (
    <div>
      <Meta result={result} />
      <p className="text-[11px] text-gray-700 mb-2">{result.summary}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <Th>Suburb</Th><Th>State</Th><Th className="text-right">Median House</Th>
              <Th className="text-right">MHP 12m ago</Th><Th className="text-right">12m growth</Th>
              <Th className="text-right">MHP 6m ago</Th><Th className="text-right">6m growth</Th>
              <Th className="text-right">Median Unit</Th><Th className="text-right">Median $/m²</Th>
              <Th className="text-right">Dist (km)</Th><Th>As of</Th>
            </tr>
          </thead>
          <tbody>
            {result.suburbs?.map((s, i) => {
              const g12 = houseGrowth(s, '12m');
              const g6 = houseGrowth(s, '6m');
              return (
                <tr key={i} className="border-b border-gray-100">
                  <Td className="capitalize font-medium">{s.suburb}</Td>
                  <Td>{s.state ?? '—'}{s.postcode ? ` ${s.postcode}` : ''}</Td>
                  <Td className="text-right font-mono">{money(s.medianHousePrice)}</Td>
                  <Td className="text-right font-mono text-gray-600">{money(s.medianHousePrice12mAgo)}</Td>
                  <Td className={`text-right font-mono ${pctClass(g12)}`}>{pct(g12)}</Td>
                  <Td className="text-right font-mono text-gray-600">{money(s.medianHousePrice6mAgo)}</Td>
                  <Td className={`text-right font-mono ${pctClass(g6)}`}>{pct(g6)}</Td>
                  <Td className="text-right font-mono">{money(s.medianUnitPrice)}</Td>
                  <Td className="text-right font-mono">{money(s.medianDollarPerSqm)}</Td>
                  <Td className="text-right">{num(s.distanceKm)}</Td>
                  <Td className="text-gray-500">{s.asOf ?? '—'}</Td>
                </tr>
              );
            })}
            <tr className="bg-emerald-50 font-bold border-t-2 border-emerald-300">
              <Td className="text-emerald-900">Indicative average</Td><Td />
              <Td className="text-right font-mono text-emerald-900">{money(a.mhp)}</Td>
              <Td className="text-right font-mono text-emerald-900">{money(a.mhp12mAgo)}</Td>
              <Td className={`text-right font-mono ${pctClass(a.growth12m)}`}>{pct(a.growth12m)}</Td>
              <Td className="text-right font-mono text-emerald-900">{money(a.mhp6mAgo)}</Td>
              <Td className={`text-right font-mono ${pctClass(a.growth6m)}`}>{pct(a.growth6m)}</Td>
              <Td className="text-right font-mono text-emerald-900">{money(a.mup)}</Td>
              <Td className="text-right font-mono text-emerald-900">{money(a.psm)}</Td>
              <Td /><Td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        Growth = current MHP ÷ MHP 12 (or 6) months earlier − 1, from realestate.com.au's price history; the published
        growth figure is shown where the prior median isn't. The average growth is the mean of the per-suburb figures.
      </p>
      <Averages avgMHP={a.mhp} avgMUP={a.mup} avgPSM={a.psm} growth12m={a.growth12m} growth6m={a.growth6m} />
      <SuburbMap suburbs={result.suburbs ?? []} />
      <Sources sources={result.sources} />
    </div>
  );
}

function CompetitorsResultView({ result }: { result: CompetitorsResult }) {
  return (
    <div>
      <Meta result={result} />
      <p className="text-[11px] text-gray-700 mb-2">{result.summary}</p>
      <TypologySummary units={result.units ?? []} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <Th>Operator</Th><Th>Village</Th><Th>Unit</Th><Th>Type</Th>
              <Th className="text-right">Beds</Th><Th className="text-right">Baths</Th>
              <Th className="text-center">Study</Th><Th className="text-right">Car</Th>
              <Th className="text-right">m²</Th>
              <Th className="text-right">Price</Th><Th className="text-right">$/m²</Th>
              <Th>Sold / Listing</Th><Th>Date</Th><Th>Tenure / DMF</Th>
              <Th className="text-right">Dist</Th><Th>Source</Th>
            </tr>
          </thead>
          <tbody>
            {result.units?.length ? result.units.map((u, i) => (
              <tr key={i} className="border-b border-gray-100 align-top">
                <Td className="text-gray-700">{u.operator ?? '—'}</Td>
                <Td className="font-medium">{u.villageName}
                  {(u.suburb || u.address) && <span className="block text-[10px] text-gray-500">{u.address || u.suburb}</span>}
                  {u.note && <span className="block text-[10px] text-gray-400 italic">{u.note}</span>}
                </Td>
                <Td className="font-mono text-gray-700">{u.unitNumber ?? '—'}</Td>
                <Td>{u.unitType ?? '—'}</Td>
                <Td className="text-right">{num(u.bedrooms)}</Td>
                <Td className="text-right">{num(u.bathrooms)}</Td>
                <Td className="text-center">{u.study == null ? '—' : u.study ? 'Yes' : 'No'}</Td>
                <Td className="text-right">{num(u.carSpaces)}</Td>
                <Td className="text-right">{area(u)}</Td>
                <Td className="text-right font-mono">{money(u.price)}</Td>
                <Td className="text-right font-mono text-gray-600">{dollarsPerSqm(u)}</Td>
                <Td>{u.priceType ? <Badge type={u.priceType} /> : '—'}</Td>
                <Td className="text-gray-600">{u.date ?? '—'}</Td>
                <Td className="text-gray-600">
                  {u.tenure ?? '—'}
                  {u.dmfSummary && <span className="block text-[10px] text-gray-500">{u.dmfSummary}</span>}
                  {typeof u.recurringFee === 'number' && (
                    <span className="block text-[10px] text-gray-500">
                      Levy {money(u.recurringFee)}{u.recurringFeePeriod ? `/${u.recurringFeePeriod}` : ''}
                    </span>
                  )}
                </Td>
                <Td className="text-right">{num(u.distanceKm)}</Td>
                <Td>
                  {u.sourceUrl
                    ? <a href={u.sourceUrl} target="_blank" rel="noopener" className="text-blue-600 underline">{u.source || 'link'}</a>
                    : (u.source ?? '—')}
                </Td>
              </tr>
            )) : (
              <tr><Td className="text-gray-500 italic">No competitor units returned.</Td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Sources sources={result.sources} />
    </div>
  );
}

/* ── small presentational helpers ──────────────────────────────────────────── */

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Section({
  title, subtitle, onRun, running, runLabel, runningLabel, extraControl, children,
}: {
  title: string; subtitle: string; onRun: () => void; running: boolean; runLabel: string;
  /** Shown on the button while running — e.g. progress through several villages. */
  runningLabel?: string | undefined;
  extraControl?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-200 bg-white rounded mb-4">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 bg-gray-50 rounded-t flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-sm font-bold text-gray-800">{title}</h3>
          <p className="text-[10px] text-gray-500">{subtitle}</p>
        </div>
        {extraControl}
        <button onClick={onRun} disabled={running}
          className="text-[11px] bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-3 py-1.5 rounded font-medium">
          {running ? (runningLabel ?? 'Researching…') : runLabel}
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th scope="col" className={`px-2 py-1.5 font-semibold text-gray-600 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 ${className}`}>{children}</td>;
}

function Badge({ type }: { type: 'sold' | 'listing' }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
      type === 'sold' ? 'bg-green-50 border-green-300 text-green-800' : 'bg-blue-50 border-blue-300 text-blue-800'
    }`}>{type === 'sold' ? 'Sold' : 'Listing'}</span>
  );
}

/**
 * Average price and $/m² per typology (beds / baths / study), above the unit
 * list — the comparison that drives a feasibility, rather than any single sale.
 * Each average shows the number of units behind it, so a one-unit "average"
 * can't be read as a market rate.
 */
function TypologySummary({ units }: { units: UnitRow[] }) {
  const rows = summariseByTypology(units);
  if (rows.length === 0) return null;
  return (
    <div className="mb-3 border border-gray-200 rounded overflow-hidden">
      <div className="px-2 py-1.5 bg-gray-100 border-b border-gray-200">
        <h4 className="text-[11px] font-bold text-gray-700">Summary by typology</h4>
        <p className="text-[10px] text-gray-500">
          Average price and $/m² per bed / bath / study combination. Averages ignore units with no
          published price or internal area — the count beside each shows how many they came from.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 text-left">
              <Th>Typology</Th>
              <Th className="text-right">Units</Th>
              <Th className="text-right">Avg price</Th>
              <Th className="text-right">Avg m²</Th>
              <Th className="text-right">Avg $/m²</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-100">
                <Td className="font-medium">{r.label}</Td>
                <Td className="text-right">{r.count}</Td>
                <Td className="text-right font-mono">
                  {money(r.avgPrice)}
                  {r.avgPrice !== null && r.pricedCount < r.count && (
                    <span className="block text-[10px] text-gray-400">from {r.pricedCount}</span>
                  )}
                </Td>
                <Td className="text-right font-mono">{num(r.avgInternalSqm)}</Td>
                <Td className="text-right font-mono">
                  {money(r.avgDollarPerSqm)}
                  {r.avgDollarPerSqm !== null && r.sqmCount < r.count && (
                    <span className="block text-[10px] text-gray-400">from {r.sqmCount}</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Averages({ avgMHP, avgMUP, avgPSM, growth12m, growth6m }: {
  avgMHP: number | null; avgMUP: number | null; avgPSM: number | null; growth12m: number | null; growth6m: number | null;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-3">
      <Stat label="Indicative avg median house price (MHP)" value={money(avgMHP)} />
      <Stat label="Avg MHP growth — last 12 months" value={pct(growth12m)} />
      <Stat label="Avg MHP growth — last 6 months" value={pct(growth6m)} />
      <Stat label="Indicative avg median unit price (MUP)" value={money(avgMUP)} />
      <Stat label="Indicative avg $/m²" value={money(avgPSM)} />
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-emerald-200 bg-emerald-50 rounded p-2 text-center">
      <div className="text-[10px] text-emerald-700">{label}</div>
      <div className="text-base font-bold font-mono text-emerald-900">{value}</div>
    </div>
  );
}

/** " (Firecrawl, 5 results)", " (Gemini native + Firecrawl, 5 results)" when both
 *  ran — empty when no search tool was recorded, e.g. a response cached before
 *  this field existed. */
function searchToolSuffix(result: {
  webSearch?: { used: boolean; provider?: 'firecrawl' | 'tavily'; results?: number };
  tavily?: { used: boolean; results?: number };
  geminiNativeSearchUsed?: boolean;
}): string {
  const ws = result.webSearch;
  const tool = ws?.used
    ? (ws.provider === 'firecrawl' ? 'Firecrawl' : ws.provider === 'tavily' ? 'Tavily' : null)
    : result.tavily?.used ? 'Tavily' : null;
  const combined = result.geminiNativeSearchUsed && tool;
  const label = combined ? `Gemini native + ${tool}` : tool;
  if (!label) return '';
  const count = ws?.results ?? result.tavily?.results;
  return count ? ` (${label}, ${count} results)` : ` (${label})`;
}

function Meta({ result }: { result: {
  model?: string; provider?: string; cotality?: CotalityNote; groundingUsed?: boolean;
  /** Names the search tool that ran; `tavily` is the legacy equivalent. */
  webSearch?: { used: boolean; provider?: 'firecrawl' | 'tavily'; results?: number };
  tavily?: { used: boolean; results?: number };
  /** Gemini's own Google-Search tool, tracked separately so the badge can show
   *  "combined" when Firecrawl was ALSO injected into the same request. */
  geminiNativeSearchUsed?: boolean;
} }) {
  // groundingUsed is explicitly false when the active model has no live web
  // search (DeepSeek) OR when Gemini's grounding fell back (quota/permission).
  // Without live search the model relies on training data — it can't pull
  // current villages.com.au / downsizing.com.au listings — so warn the user.
  const noWebSearch = result.groundingUsed === false;
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 flex-wrap">
        {result.cotality?.used && (
          <span className="text-[10px] inline-flex items-center gap-1 bg-blue-100 border border-blue-300 text-blue-900 rounded px-1.5 py-0.5">
            ◆ Grounded in Cotality data
            {result.cotality.url && <a href={result.cotality.url} target="_blank" rel="noopener" className="underline ml-1">(source)</a>}
          </span>
        )}
        {result.groundingUsed
          ? <span className="text-[10px] bg-purple-50 border border-purple-200 text-purple-700 rounded px-1.5 py-0.5">Live web search{searchToolSuffix(result)}</span>
          : <span className="text-[10px] bg-amber-50 border border-amber-300 text-amber-800 rounded px-1.5 py-0.5">No live web search</span>}
        {result.model && <span className="text-[10px] text-gray-400">model: {result.model}</span>}
        {result.cotality && !result.cotality.used && result.cotality.reason && (
          <span className="text-[10px] text-amber-700">{result.cotality.reason}</span>
        )}
      </div>
      {noWebSearch && (
        <div className="mt-1.5 text-[10px] bg-amber-50 border border-amber-300 text-amber-800 rounded px-2 py-1">
          ⚠ The active model{result.provider ? ` (${result.provider})` : ''} ran <strong>without live web search</strong>, so these
          figures come from the model's training data — they may be stale and won't reflect current
          villages.com.au / downsizing.com.au listings. For live, sourced results add a
          <strong> Firecrawl</strong> (or Tavily) key in <span className="font-mono">Admin → Firecrawl Search</span> — it grounds
          every provider — or use a <strong>Gemini</strong> model, which searches natively
          {result.provider === 'gemini' ? '. Gemini grounding fell back here — likely a quota/permission limit; Firecrawl grounding avoids that quota entirely.' : '.'}
        </div>
      )}
    </div>
  );
}

function ErrorBox({ error }: { error: string }) {
  return (
    <div className="p-2 mb-2 text-[11px] bg-red-50 border border-red-200 text-red-800 rounded">
      <span className="font-semibold">Research failed:</span> {error}
      {error.toLowerCase().includes('not configured') && (
        <span className="block mt-1 text-red-600">Add a Gemini API key in Admin → AI Settings (free tier from aistudio.google.com).</span>
      )}
    </div>
  );
}

function Sources({ sources }: { sources?: ResearchSource[] }) {
  if (!sources?.length) return <p className="text-[10px] italic text-gray-400 mt-2">No sources returned.</p>;
  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold text-gray-500 mb-1">Sources</p>
      <ul className="space-y-0.5">
        {sources.map((s, i) => (
          <li key={i} className="text-[10px]">
            <a href={s.url} target="_blank" rel="noopener" className="text-blue-600 underline">{s.title || s.url}</a>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-gray-400 mt-2 italic">
        Indicative only — retirement-village units often transact under licence / DMF arrangements. Verify against the linked sources.
      </p>
    </div>
  );
}
