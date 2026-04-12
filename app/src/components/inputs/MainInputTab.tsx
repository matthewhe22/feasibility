import { useState, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { CurrencyInput, PercentInput, NumberInput, SectionHeader } from '../common/FormFields';
import { FinancingInputs } from './FinancingInputs';
import { formatCurrency, excelDateToDate, addMonths, endOfMonth } from '../../utils';
import { calculateStampDuty, STAMP_DUTY_STATES, type StampDutyState } from '../../utils/stampDuty';
import type { CostLineItem, RevenueLineItem } from '../../types';

// ── Manual S-Curve Editor ─────────────────────────────────────────────────────
// Renders a period-by-period weight input for one manual S-curve.
// Values are raw weights (any positive number); they are normalised to 1.0 by
// the cost-spreading engine so only the relative shape matters.
function SCurveEditor({
  curveIndex: _curveIndex,
  label,
  values,
  totalPeriods,
  onChange,
}: {
  curveIndex: number;
  label: string;
  values: number[];
  totalPeriods: number;
  onChange: (updated: number[]) => void;
}) {
  const padded = Array.from({ length: totalPeriods }, (_, i) => values[i] ?? 0);
  const total = padded.reduce((s, v) => s + v, 0);

  const update = (idx: number, raw: string) => {
    const v = parseFloat(raw);
    const next = [...padded];
    next[idx] = isNaN(v) ? 0 : Math.max(0, v);
    onChange(next);
  };

  const clear = () => onChange(Array(totalPeriods).fill(0));

  // Rows of 12 months each
  const rows: number[][] = [];
  for (let r = 0; r < totalPeriods; r += 12) {
    rows.push(padded.slice(r, Math.min(r + 12, totalPeriods)));
  }

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${Math.abs(total - 100) < 0.05 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
          Sum: {total.toFixed(2)}%
        </span>
        <button
          onClick={clear}
          className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
        >
          Clear
        </button>
        <span className="text-xs text-gray-400">(values are relative weights — normalised automatically)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            {rows.map((row, rowIdx) => (
              <tr key={`h${rowIdx}`} className="bg-gray-600 text-white">
                <th className="px-2 py-1 text-left w-16 whitespace-nowrap">Year {rowIdx + 1}</th>
                {row.map((_, colIdx) => {
                  const period = rowIdx * 12 + colIdx + 1;
                  return (
                    <th key={colIdx} className="px-1 py-1 text-center w-14">M{period}</th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={`r${rowIdx}`} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-2 py-0.5 text-gray-500 font-medium">
                  {`${rowIdx * 12 + 1}–${Math.min(rowIdx * 12 + row.length, totalPeriods)}`}
                </td>
                {row.map((val, colIdx) => {
                  const period = rowIdx * 12 + colIdx;
                  return (
                    <td key={colIdx} className="px-0.5 py-0.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={val === 0 ? '' : val}
                        placeholder="0"
                        onChange={e => update(period, e.target.value)}
                        className="w-14 text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Build S-Curve Editor ──────────────────────────────────────────────────────
// Editor for a single N-Month Build S-curve (user-defined monthly weights).
function BuildSCurveEditor({
  buildMonths,
  values,
  onChange,
}: {
  buildMonths: number;
  values: number[];
  onChange: (updated: number[]) => void;
}) {
  const padded = Array.from({ length: buildMonths }, (_, i) => values[i] ?? 0);
  const total = padded.reduce((s, v) => s + v, 0);
  const hasData = total > 0;

  const update = (idx: number, raw: string) => {
    const v = parseFloat(raw);
    const next = [...padded];
    next[idx] = isNaN(v) ? 0 : Math.max(0, v);
    onChange(next);
  };

  const clear = () => onChange(Array(buildMonths).fill(0));

  // Rows of 12 months each
  const rows: number[][] = [];
  for (let r = 0; r < buildMonths; r += 12) {
    rows.push(padded.slice(r, Math.min(r + 12, buildMonths)));
  }

  return (
    <div className="mb-1">
      <div className="flex items-center gap-3 mb-1">
        <span className={`text-xs px-2 py-0.5 rounded ${hasData ? (Math.abs(total - 100) < 0.5 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700') : 'bg-gray-100 text-gray-500'}`}>
          Sum: {total.toFixed(1)}% {!hasData && '(parabolic fallback)'}
        </span>
        {hasData && (
          <button onClick={clear} className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">
            Clear
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            {rows.map((row, rowIdx) => (
              <tr key={`h${rowIdx}`} className="bg-gray-500 text-white">
                <th className="px-2 py-0.5 text-left w-12">Y{rowIdx + 1}</th>
                {row.map((_, colIdx) => {
                  const period = rowIdx * 12 + colIdx + 1;
                  return <th key={colIdx} className="px-1 py-0.5 text-center w-12">M{period}</th>;
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={`r${rowIdx}`} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-2 py-0.5 text-gray-400 text-[10px]">{rowIdx * 12 + 1}–{Math.min(rowIdx * 12 + row.length, buildMonths)}</td>
                {row.map((val, colIdx) => {
                  const period = rowIdx * 12 + colIdx;
                  return (
                    <td key={colIdx} className="px-0.5 py-0.5">
                      <input
                        type="number" min="0" step="0.01"
                        value={val === 0 ? '' : val}
                        placeholder="0"
                        onChange={e => update(period, e.target.value)}
                        className="w-12 text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CSV/Excel S-Curve importer ─────────────────────────────────────────────────
// Expected format (CSV):
//   Row 1 (header): Month, 12 Month Build, 13 Month Build, ..., 60 Month Build
//   Rows 2+: monthly weight values, one row per month
//
// Returns a partial Record<number, number[]> with curves that have data.
function parseBuildSCurvesCSV(csvText: string): Record<number, number[]> {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return {};

  const headers = lines[0].split(',').map(h => h.trim());
  const result: Record<number, number[]> = {};

  // Map column index to build duration
  const colMap: { colIdx: number; duration: number }[] = [];
  for (let c = 1; c < headers.length; c++) {
    const m = headers[c].match(/^(\d+)\s*Month\s*Build$/i);
    if (m) {
      colMap.push({ colIdx: c, duration: parseInt(m[1]) });
    }
  }

  for (const { colIdx, duration } of colMap) {
    const weights: number[] = [];
    for (let r = 1; r < lines.length; r++) {
      const cols = lines[r].split(',');
      const val = parseFloat(cols[colIdx] ?? '0');
      weights.push(isNaN(val) ? 0 : val);
    }
    // Only include if any non-zero
    if (weights.some(w => w > 0)) {
      result[duration] = weights;
    }
  }
  return result;
}

// ── Actuals Cost Editor ───────────────────────────────────────────────────────
// Simple per-line-item actuals entry: enter total actual cost for each period.
// The number of columns shown = number of actual periods (from admin.lastActualsPeriod).
// This component uses the store directly to access admin for period count.
function ActualCostsEditor({ label, items, onChange }: {
  label: string;
  items: CostLineItem[];
  onChange: (items: CostLineItem[]) => void;
}) {
  const { admin, inputs: storeInputs } = useStore();
  // Determine how many actual periods to show
  const firstDate = excelDateToDate(storeInputs.preliminary.dateOfFirstPeriod);
  const lastActualsDate = excelDateToDate(admin.lastActualsPeriod);
  let actualPeriods = 0;
  for (let i = 0; i < 120; i++) {
    const start = addMonths(firstDate, i);
    start.setDate(1);
    const end = endOfMonth(start);
    if (end > lastActualsDate) break;
    actualPeriods++;
  }
  if (actualPeriods === 0) {
    return (
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-gray-700 mb-1">{label}</h4>
        <p className="text-xs text-gray-400 italic">No actual periods defined (set Last Actuals Period in Admin).</p>
      </div>
    );
  }

  const updateActual = (itemIdx: number, periodIdx: number, raw: string) => {
    const v = parseFloat(raw);
    const updated = [...items];
    const item = { ...updated[itemIdx] };
    const actuals = [...(item.actuals ?? new Array(periodIdx + 1).fill(0))];
    while (actuals.length <= periodIdx) actuals.push(0);
    actuals[periodIdx] = isNaN(v) ? 0 : Math.max(0, v);
    item.actuals = actuals;
    updated[itemIdx] = item;
    onChange(updated);
  };

  const clearActuals = (itemIdx: number) => {
    const updated = [...items];
    updated[itemIdx] = { ...updated[itemIdx], actuals: undefined };
    onChange(updated);
  };

  const periodHeaders = Array.from({ length: actualPeriods }, (_, i) => `P${i + 1}`);

  return (
    <div className="mb-6">
      <h4 className="text-xs font-semibold text-gray-700 mb-2">{label}</h4>
      <div className="overflow-x-auto">
        <table className="text-[10px] border-collapse">
          <thead>
            <tr className="bg-gray-600 text-white">
              <th className="px-2 py-1 text-left w-16">Code</th>
              <th className="px-2 py-1 text-left w-40">Description</th>
              <th className="px-2 py-1 text-right w-24">Budget</th>
              <th className="px-2 py-1 text-right w-20">Actions</th>
              {periodHeaders.map(h => (
                <th key={h} className="px-1 py-1 text-center w-20">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, itemIdx) => {
              const totalActuals = (item.actuals ?? []).reduce((s, v) => s + (v || 0), 0);
              const hasActuals = totalActuals > 0;
              return (
                <tr key={item.code} className={`border-b border-gray-100 ${itemIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="px-2 py-0.5 text-gray-500">{item.code}</td>
                  <td className="px-2 py-0.5 truncate max-w-[160px]" title={item.description}>{item.description}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(item.totalCosts)}</td>
                  <td className="px-1 py-0.5 text-center">
                    {hasActuals && (
                      <button
                        onClick={() => clearActuals(itemIdx)}
                        className="text-[9px] bg-red-100 hover:bg-red-200 text-red-600 px-1.5 py-0.5 rounded"
                      >
                        Clear
                      </button>
                    )}
                  </td>
                  {periodHeaders.map((_, pIdx) => (
                    <td key={pIdx} className="px-0.5 py-0.5">
                      <input
                        type="number" min="0" step="1000"
                        value={(item.actuals?.[pIdx] ?? 0) === 0 ? '' : (item.actuals?.[pIdx] ?? 0)}
                        placeholder="0"
                        onChange={e => updateActual(itemIdx, pIdx, e.target.value)}
                        className="w-20 text-[10px] text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CostLineTable({ items, onChange }: {
  items: CostLineItem[];
  onChange: (items: CostLineItem[]) => void;
}) {
  const updateItem = (idx: number, field: keyof CostLineItem, value: any) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    if (field === 'units' || field === 'baseRate') {
      updated[idx].totalCosts = updated[idx].units * updated[idx].baseRate;
    }
    onChange(updated);
  };

  const total = items.reduce((s, i) => s + i.totalCosts, 0);

  return (
    <div className="mb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-600 text-white">
              <th className="px-2 py-1 text-left w-16">Code</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-right w-24">Units</th>
              <th className="px-2 py-1 text-right w-28">Rate/Unit</th>
              <th className="px-2 py-1 text-right w-32">Total Costs</th>
              <th className="px-2 py-1 text-left w-32">S-Curve</th>
              <th className="px-2 py-1 text-right w-16">Start</th>
              <th className="px-2 py-1 text-right w-16">Span</th>
              <th className="px-2 py-1 text-center w-14">GST</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.code} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                <td className="px-2 py-0.5 text-gray-500">{item.code}</td>
                <td className="px-2 py-0.5">
                  <input
                    type="text" value={item.description}
                    onChange={e => updateItem(idx, 'description', e.target.value)}
                    className="w-full bg-transparent text-xs border-0 p-0 focus:ring-0"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="number" value={item.units} step="1"
                    onChange={e => updateItem(idx, 'units', parseFloat(e.target.value) || 0)}
                    className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="text" value={item.baseRate.toLocaleString('en-AU')}
                    onChange={e => updateItem(idx, 'baseRate', parseFloat(e.target.value.replace(/[^0-9.-]/g, '')) || 0)}
                    className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  />
                </td>
                <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(item.totalCosts)}</td>
                <td className="px-1 py-0.5">
                  <select
                    value={item.sCurve}
                    onChange={e => updateItem(idx, 'sCurve', e.target.value)}
                    className="w-full text-[10px] bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  >
                    <option value="Evenly Split">Evenly Split</option>
                    <option value="Manual S-curve 1">Manual S-curve 1</option>
                    <option value="Manual S-curve 2">Manual S-curve 2</option>
                    <option value="Manual S-curve 3">Manual S-curve 3</option>
                    {Array.from({ length: 49 }, (_, i) => (
                      <option key={i} value={`${i + 12} Month Build`}>{i + 12} Month Build</option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="number" value={item.monthStart}
                    onChange={e => updateItem(idx, 'monthStart', parseInt(e.target.value) || 0)}
                    className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="number" value={item.monthSpan}
                    onChange={e => updateItem(idx, 'monthSpan', parseInt(e.target.value) || 0)}
                    className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  />
                </td>
                <td className="px-2 py-0.5 text-center">
                  <input
                    type="checkbox" checked={item.addGST}
                    onChange={e => updateItem(idx, 'addGST', e.target.checked)}
                    className="w-3 h-3"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
              <td colSpan={4} className="px-2 py-1">Total</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(total)}</td>
              <td colSpan={4}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function GRVTable({ items, onChange }: {
  items: RevenueLineItem[];
  onChange: (items: RevenueLineItem[]) => void;
}) {
  const updateItem = (idx: number, field: keyof RevenueLineItem, value: any) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange(updated);
  };

  const total = items.reduce((s, i) => s + i.currentSalePrice, 0);

  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-green-700 text-white">
            <th className="px-2 py-1 text-left w-16">Code</th>
            <th className="px-2 py-1 text-left">Description</th>
            <th className="px-2 py-1 text-left w-28">Type</th>
            <th className="px-2 py-1 text-right w-36">Sale Price</th>
            <th className="px-2 py-1 text-right w-16">Pre-Sale</th>
            <th className="px-2 py-1 text-right w-16">Span</th>
            <th className="px-2 py-1 text-right w-16">Settle</th>
            <th className="px-2 py-1 text-right w-16">Span</th>
            <th className="px-2 py-1 text-center w-14">GST</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={item.code} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
              <td className="px-2 py-0.5 text-gray-500">{item.code}</td>
              <td className="px-2 py-0.5">
                  <input
                    type="text" value={item.description}
                    onChange={e => updateItem(idx, 'description', e.target.value)}
                    className="w-full bg-transparent text-xs border-0 p-0 focus:ring-0"
                  />
                </td>
              <td className="px-2 py-0.5 text-[10px] text-gray-500">{item.revenueType}</td>
              <td className="px-1 py-0.5">
                <input
                  type="text" value={item.currentSalePrice.toLocaleString('en-AU')}
                  onChange={e => updateItem(idx, 'currentSalePrice', parseFloat(e.target.value.replace(/[^0-9.-]/g, '')) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" value={item.preSaleExchangeMonth}
                  onChange={e => updateItem(idx, 'preSaleExchangeMonth', parseInt(e.target.value) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" value={item.preSaleSpan}
                  onChange={e => updateItem(idx, 'preSaleSpan', parseInt(e.target.value) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" value={item.settlementMonth}
                  onChange={e => updateItem(idx, 'settlementMonth', parseInt(e.target.value) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" value={item.settlementSpan}
                  onChange={e => updateItem(idx, 'settlementSpan', parseInt(e.target.value) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-0.5 text-center">
                <input type="checkbox" checked={item.gstIncluded}
                  onChange={e => updateItem(idx, 'gstIncluded', e.target.checked)}
                  className="w-3 h-3"
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
            <td colSpan={3} className="px-2 py-1">Total GRV</td>
            <td className="px-2 py-1 text-right font-mono">{formatCurrency(total)}</td>
            <td colSpan={5}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function MainInputTab() {
  const { inputs, setInputs, admin, setAdmin } = useStore();
  const [section, setSection] = useState<string>('preliminary');
  const [selectedBuildDuration, setSelectedBuildDuration] = useState<number>(41);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const sections = [
    { id: 'preliminary', label: '1. General' },
    { id: 'land', label: '2.1 Land' },
    { id: 'devCosts', label: '2.2 Dev Costs' },
    { id: 'construction', label: '2.3 Construction' },
    { id: 'marketing', label: '2.4 Marketing' },
    { id: 'otherCosts', label: '2.5 Other Costs' },
    { id: 'pmFees', label: '2.6 PM Fees' },
    { id: 'selling', label: '2.7 Selling' },
    { id: 'grv', label: '3.1 GRV' },
    { id: 'financing', label: '4. Financing' },
    { id: 'otherFin', label: '4.3 Other Fin' },
    { id: 'actuals', label: 'Actuals' },
    { id: 'sCurves', label: 'S-Curves' },
  ];

  const totalPeriods = inputs.preliminary.projectSpanMonths || 74;

  const updateSCurve = (curveIdx: number, updated: number[]) => {
    const next = [...(admin.manualSCurves ?? [[], [], []])];
    next[curveIdx] = updated;
    setAdmin({ manualSCurves: next });
  };

  const updateBuildSCurve = (duration: number, updated: number[]) => {
    const next = { ...(admin.buildSCurves ?? {}) };
    next[duration] = updated;
    setAdmin({ buildSCurves: next });
  };

  // Stamp duty auto-calculation
  const handleStateChange = (state: StampDutyState) => {
    const landPrice = inputs.landPurchase.landPurchasePrice;
    const autoSD = calculateStampDuty(landPrice, state);
    // Also update the acquisition cost item for stamp duty (id='sd')
    const updatedAcq = inputs.landPurchase.acquisitionCosts.map(a =>
      a.id === 'sd' ? { ...a, amount: autoSD } : a
    );
    setInputs({
      landPurchase: {
        ...inputs.landPurchase,
        stampDutyState: state,
        stampDutyAmount: autoSD,
        acquisitionCosts: updatedAcq,
      },
    });
  };

  const handleLandPriceChangeWithSD = (landPrice: number) => {
    const state = (inputs.landPurchase.stampDutyState as StampDutyState) || 'QLD';
    const autoSD = calculateStampDuty(landPrice, state);
    const updatedAcq = inputs.landPurchase.acquisitionCosts.map(a =>
      a.id === 'sd' ? { ...a, amount: autoSD } : a
    );
    setInputs({
      landPurchase: {
        ...inputs.landPurchase,
        landPurchasePrice: landPrice,
        stampDutyAmount: autoSD,
        acquisitionCosts: updatedAcq,
      },
    });
  };

  // CSV import for build S-curves
  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsed = parseBuildSCurvesCSV(text);
      if (Object.keys(parsed).length === 0) {
        alert('No build S-curve data found. Ensure CSV has headers like "12 Month Build", "41 Month Build" etc.');
        return;
      }
      const next = { ...(admin.buildSCurves ?? {}), ...parsed };
      setAdmin({ buildSCurves: next });
      alert(`Imported ${Object.keys(parsed).length} build S-curve(s): ${Object.keys(parsed).map(k => `${k} Month`).join(', ')}`);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  return (
    <div>
      {/* Section navigation */}
      <div className="flex flex-wrap gap-1 mb-4 bg-gray-100 p-2 rounded">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
              section === s.id
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Preliminary */}
      {section === 'preliminary' && (
        <div>
          <SectionHeader number="1.1" title="Preliminary" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4 space-y-1.5">
            <NumberInput label="Project Lots #" value={inputs.preliminary.projectLots}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, projectLots: v } })} />
            <NumberInput label="Project GFA SqM" value={inputs.preliminary.projectGFA}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, projectGFA: v } })} />
            <NumberInput label="Site Area SqM" value={inputs.preliminary.siteArea}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, siteArea: v } })} />
            <NumberInput label="Project Start Month" value={inputs.preliminary.projectStartMonth}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, projectStartMonth: v } })} />
            <NumberInput label="Project Duration (months)" value={inputs.preliminary.projectSpanMonths}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, projectSpanMonths: v } })} />
          </div>
        </div>
      )}

      {/* Land */}
      {section === 'land' && (
        <div>
          <SectionHeader number="2.1" title="Land Purchase, PRSV & Acquisition Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4 space-y-1.5">
            <CurrencyInput label="Land Purchase Price" value={inputs.landPurchase.landPurchasePrice}
              onChange={handleLandPriceChangeWithSD} />
            <CurrencyInput label="PRSV Uplift" value={inputs.landPurchase.prsvUplift}
              onChange={v => setInputs({ landPurchase: { ...inputs.landPurchase, prsvUplift: v } })} />
            <PercentInput label="GST Rate" value={inputs.landPurchase.gstRate}
              onChange={v => setInputs({ landPurchase: { ...inputs.landPurchase, gstRate: v } })} />
            {/* Stamp Duty by State */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600 w-40 shrink-0">State</span>
              <select
                value={inputs.landPurchase.stampDutyState || 'QLD'}
                onChange={e => handleStateChange(e.target.value as StampDutyState)}
                className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500"
              >
                {STAMP_DUTY_STATES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <span className="text-xs text-gray-400">auto-calculates stamp duty</span>
            </div>
            <CurrencyInput label="Stamp Duty (auto)" value={inputs.landPurchase.stampDutyAmount}
              onChange={v => {
                const updatedAcq = inputs.landPurchase.acquisitionCosts.map(a =>
                  a.id === 'sd' ? { ...a, amount: v } : a
                );
                setInputs({ landPurchase: { ...inputs.landPurchase, stampDutyAmount: v, acquisitionCosts: updatedAcq } });
              }} />
          </div>
        </div>
      )}

      {/* Development Costs */}
      {section === 'devCosts' && (
        <div>
          <SectionHeader number="2.2" title="Development Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.developmentCosts}
              onChange={items => setInputs({ developmentCosts: items })} />
          </div>
        </div>
      )}

      {/* Construction */}
      {section === 'construction' && (
        <div>
          <SectionHeader number="2.3" title="Total Construction Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.constructionCosts}
              onChange={items => setInputs({ constructionCosts: items })} />
            <PercentInput label="Construction Contingency %" value={inputs.constructionContingencyPercent}
              onChange={v => setInputs({ constructionContingencyPercent: v })} />
          </div>
        </div>
      )}

      {/* Marketing */}
      {section === 'marketing' && (
        <div>
          <SectionHeader number="2.4" title="Marketing & Advertising" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.marketingCosts}
              onChange={items => setInputs({ marketingCosts: items })} />
          </div>
        </div>
      )}

      {/* Other Standard Costs */}
      {section === 'otherCosts' && (
        <div>
          <SectionHeader number="2.5" title="Other Standard Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.otherStandardCosts}
              onChange={items => setInputs({ otherStandardCosts: items })} />
          </div>
        </div>
      )}

      {/* PM Fees */}
      {section === 'pmFees' && (
        <div>
          <SectionHeader number="2.6" title="Development & Project Management Fees" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.pmFees}
              onChange={items => setInputs({ pmFees: items })} />
          </div>
        </div>
      )}

      {/* Selling */}
      {section === 'selling' && (
        <div>
          <SectionHeader number="2.7" title="Selling & Leasing Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse mb-3">
                <thead>
                  <tr className="bg-gray-600 text-white">
                    <th className="px-2 py-1 text-left">Description</th>
                    <th className="px-2 py-1 text-right w-24">Commission %</th>
                    <th className="px-2 py-1 text-right w-24">Pre-Sale %</th>
                    <th className="px-2 py-1 text-right w-24">Deposit %</th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.sellingCosts.map((sc, idx) => (
                    <tr key={sc.code} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-0.5">
                        <input
                          type="text" value={sc.description}
                          onChange={e => {
                            const updated = [...inputs.sellingCosts];
                            updated[idx] = { ...updated[idx], description: e.target.value };
                            setInputs({ sellingCosts: updated });
                          }}
                          className="w-full bg-transparent text-xs border-0 p-0 focus:ring-0"
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <input type="text" value={(sc.salesCommission * 100).toFixed(4)}
                          onChange={e => {
                            const updated = [...inputs.sellingCosts];
                            updated[idx] = { ...updated[idx], salesCommission: parseFloat(e.target.value) / 100 || 0 };
                            setInputs({ sellingCosts: updated });
                          }}
                          className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <input type="text" value={(sc.preCommissionPercent * 100).toFixed(1)}
                          onChange={e => {
                            const updated = [...inputs.sellingCosts];
                            updated[idx] = { ...updated[idx], preCommissionPercent: parseFloat(e.target.value) / 100 || 0 };
                            setInputs({ sellingCosts: updated });
                          }}
                          className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <input type="text" value={(sc.depositPercent * 100).toFixed(1)}
                          onChange={e => {
                            const updated = [...inputs.sellingCosts];
                            updated[idx] = { ...updated[idx], depositPercent: parseFloat(e.target.value) / 100 || 0 };
                            setInputs({ sellingCosts: updated });
                          }}
                          className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* GRV */}
      {section === 'grv' && (
        <div>
          <SectionHeader number="3.1" title="Gross Realisable Value (GRV)" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <GRVTable items={inputs.grvItems}
              onChange={items => setInputs({ grvItems: items })} />
          </div>
        </div>
      )}

      {/* Financing */}
      {section === 'financing' && <FinancingInputs />}

      {/* Other Financing Costs */}
      {section === 'otherFin' && (
        <div>
          <SectionHeader number="4.3" title="Other Financing Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.otherFinancingCosts}
              onChange={items => setInputs({ otherFinancingCosts: items })} />
          </div>
        </div>
      )}

      {/* Actuals */}
      {section === 'actuals' && (
        <div>
          <SectionHeader number="6" title="Actual Costs by Period" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4">
            <p className="text-xs text-gray-500 mb-4">
              Enter actual costs incurred for each line item in each period.
              The engine will use these values for actual periods (up to the "Last Actuals Period" in Admin)
              and redistribute the remaining budget over forecast periods using the S-curve weighting.
              Leave blank to use the S-curve forecast for all periods.
            </p>
            <ActualCostsEditor
              label="Development Costs"
              items={inputs.developmentCosts}
              onChange={items => setInputs({ developmentCosts: items })}
            />
            <ActualCostsEditor
              label="Construction Costs"
              items={inputs.constructionCosts}
              onChange={items => setInputs({ constructionCosts: items })}
            />
            <ActualCostsEditor
              label="Marketing Costs"
              items={inputs.marketingCosts}
              onChange={items => setInputs({ marketingCosts: items })}
            />
            <ActualCostsEditor
              label="Other Standard Costs"
              items={inputs.otherStandardCosts}
              onChange={items => setInputs({ otherStandardCosts: items })}
            />
            <ActualCostsEditor
              label="Other Financing Costs"
              items={inputs.otherFinancingCosts}
              onChange={items => setInputs({ otherFinancingCosts: items })}
            />
          </div>
        </div>
      )}

      {/* Manual S-Curves */}
      {section === 'sCurves' && (
        <div>
          <SectionHeader number="5" title="S-Curve Distributions" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4">
            <p className="text-xs text-gray-500 mb-4">
              Enter monthly weight values for each S-curve. Values are normalised automatically —
              entering percentages that sum to 100 is recommended for readability.
              Build S-curves without user-defined weights fall back to a parabolic approximation.
            </p>

            {/* Manual S-curves 1–3 */}
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Manual S-Curves (for custom cost distributions)</h4>
            {[0, 1, 2].map(idx => (
              <SCurveEditor
                key={idx}
                curveIndex={idx}
                label={`Manual S-curve ${idx + 1}`}
                values={admin.manualSCurves?.[idx] ?? []}
                totalPeriods={totalPeriods}
                onChange={updated => updateSCurve(idx, updated)}
              />
            ))}

            {/* Build S-curves 12–60 Month */}
            <h4 className="text-sm font-semibold text-gray-700 mt-6 mb-3">Build S-Curves (12–60 Month Build)</h4>
            <p className="text-xs text-gray-500 mb-3">
              Define exact monthly weight distributions for each build duration.
              Construction cost line items with an "N Month Build" S-curve will use these weights.
              Durations without user-defined weights use a parabolic bell approximation.
            </p>

            {/* CSV Upload */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => csvInputRef.current?.click()}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-medium"
              >
                Upload from CSV
              </button>
              <span className="text-xs text-gray-400">
                CSV format: header row with "Month, 12 Month Build, 13 Month Build, ..." — one weight per row per month
              </span>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={handleCSVImport}
              />
              <button
                onClick={() => {
                  if (confirm('Clear all build S-curve data? Curves will revert to parabolic fallback.')) {
                    setAdmin({ buildSCurves: {} });
                  }
                }}
                className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded font-medium ml-auto"
              >
                Clear All Build Curves
              </button>
            </div>

            {/* Build duration selector + editor */}
            <div className="flex items-center gap-3 mb-4">
              <label className="text-xs font-medium text-gray-600">Select Build Duration:</label>
              <select
                value={selectedBuildDuration}
                onChange={e => setSelectedBuildDuration(parseInt(e.target.value))}
                className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-1"
              >
                {Array.from({ length: 49 }, (_, i) => i + 12).map(d => {
                  const hasData = (admin.buildSCurves?.[d]?.length ?? 0) > 0 &&
                    (admin.buildSCurves[d]?.some(w => w > 0) ?? false);
                  return (
                    <option key={d} value={d}>{d} Month Build{hasData ? ' ✓' : ''}</option>
                  );
                })}
              </select>
              <span className="text-xs text-gray-500">
                {(admin.buildSCurves?.[selectedBuildDuration]?.some(w => w > 0))
                  ? `User-defined (${(admin.buildSCurves[selectedBuildDuration]?.reduce((s, v) => s + v, 0) ?? 0).toFixed(1)}% sum)`
                  : 'Using parabolic fallback — enter weights below to override'}
              </span>
            </div>

            <BuildSCurveEditor
              key={selectedBuildDuration}
              buildMonths={selectedBuildDuration}
              values={admin.buildSCurves?.[selectedBuildDuration] ?? []}
              onChange={updated => updateBuildSCurve(selectedBuildDuration, updated)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
