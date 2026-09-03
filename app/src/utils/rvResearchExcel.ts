/**
 * rvResearchExcel.ts
 * Exports RV Research's two result sets — surrounding-suburb pricing and
 * competitor villages — into one .xlsx workbook (ExcelJS + FileSaver, same
 * stack as exportToExcel.ts), one sheet each, run for whichever sections have
 * a result. The suburb-pricing sheet also embeds a map image plotting each
 * suburb's real position and its median house price (MHP).
 *
 * The map image itself is normally the real, server-generated one
 * (`SuburbsResult.mapImage` — an actual OSM map with tile background, built by
 * api/_lib/staticMap.ts) — embedded here as-is. `drawSuburbMapPng` below is
 * only a FALLBACK for when the server couldn't produce one (base-map fetch
 * failed, or an older cached response predates this field): it draws a plain
 * schematic (background + suburb dots + labels, no map tiles) on an offscreen
 * canvas, which is client-side-safe but deliberately not "a real map" — that's
 * exactly why it's a fallback and not the primary path. (The reason it can't
 * just screenshot the on-screen Leaflet map instead: Leaflet's OSM tile images
 * are cross-origin and OSM's public tile servers don't send CORS headers, so
 * any canvas a tile has been drawn onto is "tainted" and the browser refuses
 * to read its pixels back — `canvas.toDataURL()` throws.)
 */
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { SuburbsResult, CompetitorsResult, SuburbRow, UnitRow, ResearchSource } from '../components/research/RetirementVillageResearch';

const CURRENCY_FMT = '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)';

const HEADER_FILL = '1E3A8A'; // blue-900
const SUBHEADER_FILL = '374151'; // gray-700
const WHITE = 'FFFFFF';
const BLACK = '111827';

function style(
  cell: ExcelJS.Cell,
  opts: {
    fill?: string | undefined; fontColor?: string | undefined; bold?: boolean | undefined; italic?: boolean | undefined;
    size?: number | undefined; numFmt?: string | undefined; hAlign?: ExcelJS.Alignment['horizontal'] | undefined; wrapText?: boolean | undefined;
  } = {},
) {
  if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + opts.fill } };
  cell.font = { name: 'Calibri', size: opts.size ?? 10, bold: opts.bold ?? false, italic: opts.italic ?? false, color: { argb: 'FF' + (opts.fontColor ?? BLACK) } };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  cell.alignment = { horizontal: opts.hAlign ?? 'left', vertical: 'middle', wrapText: opts.wrapText ?? false };
}

function titleRow(ws: ExcelJS.Worksheet, text: string, span: number): number {
  const r = ws.addRow([text]);
  ws.mergeCells(r.number, 1, r.number, span);
  style(r.getCell(1), { fill: '111827', fontColor: WHITE, bold: true, size: 13 });
  r.height = 22;
  return r.number;
}

function metaRow(ws: ExcelJS.Worksheet, label: string, value: string, span: number): void {
  const r = ws.addRow([label, value]);
  ws.mergeCells(r.number, 2, r.number, span);
  style(r.getCell(1), { bold: true, size: 9 });
  style(r.getCell(2), { size: 9, wrapText: true });
}

function sourcesRows(ws: ExcelJS.Worksheet, sources: ResearchSource[], span: number): void {
  const hdr = ws.addRow(['Sources']);
  ws.mergeCells(hdr.number, 1, hdr.number, span);
  style(hdr.getCell(1), { fill: SUBHEADER_FILL, fontColor: WHITE, bold: true, size: 10 });
  if (!sources.length) {
    style(ws.addRow(['No sources returned.']).getCell(1), { italic: true, size: 9 });
    return;
  }
  for (const s of sources) {
    const r = ws.addRow([s.title || s.url, s.url]);
    ws.mergeCells(r.number, 2, r.number, span);
    style(r.getCell(1), { size: 9 });
    style(r.getCell(2), { size: 9, fontColor: '2563EB' });
    r.getCell(2).value = { text: s.url, hyperlink: s.url };
  }
}

/** Draws a self-contained (no external images) map on an offscreen canvas:
 *  background, gridlines, one dot per geocoded suburb positioned by real
 *  lat/lng within the plotted set's bounding box, and a "Suburb: MHP" label
 *  beside each dot. Returns a PNG data URL, or null if nothing is plottable. */
function drawSuburbMapPng(suburbs: SuburbRow[]): { dataUrl: string; width: number; height: number } | null {
  const plottable = suburbs.filter(
    (s): s is SuburbRow & { lat: number; lng: number } =>
      typeof s.lat === 'number' && isFinite(s.lat) && typeof s.lng === 'number' && isFinite(s.lng),
  );
  if (plottable.length === 0) return null;

  const width = 640;
  const height = 420;
  const pad = 56;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const lats = plottable.map(s => s.lat);
  const lngs = plottable.map(s => s.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  // Guard against a single point (or all-identical coords) collapsing the scale.
  const latSpan = maxLat - minLat || 0.01;
  const lngSpan = maxLng - minLng || 0.01;

  const toXY = (lat: number, lng: number): [number, number] => {
    const x = pad + ((lng - minLng) / lngSpan) * (width - pad * 2);
    // Screen Y grows downward; latitude grows north (up), so invert.
    const y = pad + (1 - (lat - minLat) / latSpan) * (height - pad * 2);
    return [x, y];
  };

  const prices = plottable.map(s => s.medianHousePrice).filter((p): p is number => typeof p === 'number' && isFinite(p));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const money = (v?: number | null) => (typeof v === 'number' && isFinite(v) ? `$${Math.round(v).toLocaleString('en-AU')}` : '—');
  const colorFor = (price: number | null | undefined): string => {
    if (typeof price !== 'number' || !isFinite(price) || maxPrice <= minPrice) return '#7c3aed';
    const t = (price - minPrice) / (maxPrice - minPrice);
    return `hsl(${200 - t * 190}, 75%, 42%)`;
  };

  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.fillStyle = '#111827';
  ctx.fillText('Surrounding suburbs — median house price (MHP)', 12, 20);

  ctx.font = '11px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  for (const s of plottable) {
    const [x, y] = toXY(s.lat, s.lng);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = colorFor(s.medianHousePrice);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1f2937';
    ctx.stroke();

    const label = `${s.suburb}: ${money(s.medianHousePrice)}`;
    const textWidth = ctx.measureText(label).width;
    const boxX = Math.min(Math.max(x + 10, 4), width - textWidth - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(boxX - 3, y - 9, textWidth + 6, 18);
    ctx.fillStyle = '#111827';
    ctx.fillText(label, boxX, y);
  }

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

/* ── Sheet builders ──────────────────────────────────────────────────────── */

const SUBURB_SPAN = 9; // Suburb, State, Postcode, Median House, Median Unit, $/m², Dist, As of, (Lat/Lng dropped from view)

function buildSuburbsSheet(wb: ExcelJS.Workbook, r: SuburbsResult) {
  const ws = wb.addWorksheet('Suburb Pricing', { properties: { tabColor: { argb: 'FF' + HEADER_FILL } } });
  ws.getColumn(1).width = 20;
  for (let c = 2; c <= SUBURB_SPAN; c++) ws.getColumn(c).width = 16;

  titleRow(ws, `${r.village?.name || 'Retirement Village'} — Surrounding-Suburb Pricing`, SUBURB_SPAN);
  const loc = [r.village?.suburb, r.village?.state, r.village?.postcode].filter(Boolean).join(', ');
  if (loc) metaRow(ws, 'Village location', loc, SUBURB_SPAN);
  if (r.timestamp) metaRow(ws, 'Generated', new Date(r.timestamp).toLocaleString('en-AU'), SUBURB_SPAN);
  if (r.provider || r.model) metaRow(ws, 'Model', [r.provider, r.model].filter(Boolean).join(' / '), SUBURB_SPAN);
  metaRow(ws, 'Live web search', r.groundingUsed ? 'Yes' : 'No — figures may be from training data', SUBURB_SPAN);
  metaRow(ws, 'Summary', r.summary || '', SUBURB_SPAN);
  ws.addRow([]);

  const hdr = ws.addRow(['Suburb', 'State', 'Postcode', 'Median House', 'Median Unit', 'Median $/m²', 'Dist (km)', 'As of']);
  hdr.eachCell(cell => style(cell, { fill: HEADER_FILL, fontColor: WHITE, bold: true, size: 9 }));

  const suburbs = r.suburbs ?? [];
  for (const s of suburbs) {
    const row = ws.addRow([s.suburb, s.state ?? '', s.postcode ?? '', s.medianHousePrice ?? null, s.medianUnitPrice ?? null, s.medianDollarPerSqm ?? null, s.distanceKm ?? null, s.asOf ?? '']);
    row.eachCell((cell, colNum) => {
      const numeric = colNum === 4 || colNum === 5 || colNum === 6;
      style(cell, { size: 9, numFmt: numeric ? CURRENCY_FMT : (colNum === 7 ? '0.0' : undefined), hAlign: numeric || colNum === 7 ? 'right' : 'left' });
    });
  }

  const avg = r.averages;
  if (avg) {
    const row = ws.addRow(['Indicative average', '', '', avg.avgMedianHousePrice ?? null, avg.avgMedianUnitPrice ?? null, avg.avgDollarPerSqm ?? null, '', '']);
    row.eachCell((cell, colNum) => {
      const numeric = colNum === 4 || colNum === 5 || colNum === 6;
      style(cell, { fill: 'DCFCE7', bold: true, size: 9, numFmt: numeric ? CURRENCY_FMT : undefined, hAlign: numeric ? 'right' : 'left' });
    });
  }
  ws.addRow([]);

  // Prefer the real, server-generated map (actual OSM tile background + our
  // markers, api/_lib/staticMap.ts) — falls back to the client-drawn schematic
  // only if the server couldn't produce one (base-map fetch failed, or the
  // response predates this field).
  const map = r.mapImage ? { dataUrl: r.mapImage, width: 640, height: 420 } : drawSuburbMapPng(suburbs);
  if (map) {
    const imgId = wb.addImage({ base64: map.dataUrl, extension: 'png' });
    const anchorRow = ws.lastRow ? ws.lastRow.number : ws.rowCount;
    // ~7px per Excel column-width unit, ~20px per row — close enough to size
    // the embedded image without stretching it across the whole sheet.
    ws.addImage(imgId, { tl: { col: 0, row: anchorRow }, ext: { width: map.width, height: map.height } });
    for (let i = 0; i < Math.ceil(map.height / 20) + 1; i++) ws.addRow([]);
  } else {
    style(ws.addRow(['Map unavailable — no suburb could be geocoded.']).getCell(1), { italic: true, size: 9 });
  }
  ws.addRow([]);

  sourcesRows(ws, r.sources ?? [], SUBURB_SPAN);
}

const UNIT_SPAN = 18;

function buildCompetitorsSheet(wb: ExcelJS.Workbook, r: CompetitorsResult) {
  const ws = wb.addWorksheet('Competitor Villages', { properties: { tabColor: { argb: 'FF' + HEADER_FILL } } });
  ws.getColumn(1).width = 16;
  for (let c = 2; c <= UNIT_SPAN; c++) ws.getColumn(c).width = 14;

  titleRow(ws, `${r.subject?.name || 'Retirement Village'} — Competitor Villages`, UNIT_SPAN);
  const loc = [r.subject?.suburb, r.subject?.state, r.subject?.postcode].filter(Boolean).join(', ');
  if (loc) metaRow(ws, 'Subject location', loc, UNIT_SPAN);
  if (r.proximityKm) metaRow(ws, 'Proximity radius', `${r.proximityKm} km`, UNIT_SPAN);
  if (r.timestamp) metaRow(ws, 'Generated', new Date(r.timestamp).toLocaleString('en-AU'), UNIT_SPAN);
  if (r.provider || r.model) metaRow(ws, 'Model', [r.provider, r.model].filter(Boolean).join(' / '), UNIT_SPAN);
  metaRow(ws, 'Live web search', r.groundingUsed ? 'Yes' : 'No — figures may be from training data', UNIT_SPAN);
  metaRow(ws, 'Summary', r.summary || '', UNIT_SPAN);
  ws.addRow([]);

  const columns: Array<{ label: string; get: (u: UnitRow) => string | number | boolean | null | undefined; numFmt?: string }> = [
    { label: 'Operator', get: u => u.operator },
    { label: 'Village', get: u => u.villageName },
    { label: 'Unit', get: u => u.unitNumber },
    { label: 'Address', get: u => u.address },
    { label: 'Suburb', get: u => u.suburb },
    { label: 'Dist (km)', get: u => u.distanceKm },
    { label: 'Sold/Listing', get: u => u.priceType },
    { label: 'Price', get: u => u.price, numFmt: CURRENCY_FMT },
    { label: 'Date', get: u => u.date },
    { label: 'Beds', get: u => u.bedrooms },
    { label: 'Baths', get: u => u.bathrooms },
    { label: 'Study', get: u => (u.study == null ? null : u.study ? 'Yes' : 'No') },
    { label: 'Car', get: u => u.carSpaces },
    { label: 'Internal m²', get: u => u.internalSqm },
    { label: 'Land m²', get: u => u.landSqm },
    { label: 'Type', get: u => u.unitType },
    { label: 'Tenure', get: u => u.tenure },
    { label: 'DMF', get: u => u.dmfSummary },
    { label: 'Levy', get: u => (u.recurringFee != null ? `${u.recurringFee}${u.recurringFeePeriod ? '/' + u.recurringFeePeriod : ''}` : null) },
    { label: 'Note', get: u => u.note },
    { label: 'Source', get: u => u.source },
    { label: 'Source URL', get: u => u.sourceUrl },
  ];

  const hdr = ws.addRow(columns.map(c => c.label));
  hdr.eachCell(cell => style(cell, { fill: HEADER_FILL, fontColor: WHITE, bold: true, size: 9 }));

  const units = r.units ?? [];
  for (const u of units) {
    const row = ws.addRow(columns.map(c => (c.get(u) ?? '') as string | number));
    row.eachCell((cell, colNum) => {
      const col = columns[colNum - 1];
      if (!col) return;
      style(cell, { size: 9, numFmt: col.numFmt, hAlign: col.numFmt ? 'right' : 'left', wrapText: col.label === 'DMF' || col.label === 'Note' });
    });
    const urlCol = columns.findIndex(c => c.label === 'Source URL') + 1;
    if (urlCol > 0 && u.sourceUrl) row.getCell(urlCol).value = { text: u.sourceUrl, hyperlink: u.sourceUrl };
  }
  if (!units.length) style(ws.addRow(['No competitor units returned.']).getCell(1), { italic: true, size: 9 });
  ws.addRow([]);

  sourcesRows(ws, r.sources ?? [], UNIT_SPAN);
}

/* ── Main export function ───────────────────────────────────────────────── */

/**
 * exportRVResearchToExcel
 * One workbook covering both RV Research tools, whichever have a result:
 *   - "Suburb Pricing"      — section 1 table + averages + suburb map + sources
 *   - "Competitor Villages" — section 2 table + sources
 * No-ops (throws) if neither result is provided — callers should disable the
 * export action until at least one section has run.
 */
export async function exportRVResearchToExcel(
  villageName: string,
  suburbsResult: SuburbsResult | null,
  competitorsResult: CompetitorsResult | null,
): Promise<void> {
  if (!suburbsResult && !competitorsResult) {
    throw new Error('Run at least one of the two research sections before exporting.');
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Feasibility Model — RV Research';
  wb.created = new Date();
  wb.modified = new Date();

  if (suburbsResult) buildSuburbsSheet(wb, suburbsResult);
  if (competitorsResult) buildCompetitorsSheet(wb, competitorsResult);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const safeName = (villageName || 'RV_Research').replace(/[^a-zA-Z0-9]/g, '_');
  const timestamp = new Date().toISOString().slice(0, 10);
  saveAs(blob, `${safeName}_RV_Research_${timestamp}.xlsx`);
}
