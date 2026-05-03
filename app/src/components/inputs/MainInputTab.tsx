import React, { useState, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { CurrencyInput, PercentInput, NumberInput, SectionHeader } from '../common/FormFields';
import { FinancingInputs } from './FinancingInputs';
import { formatCurrency, excelDateToDate, addMonths, endOfMonth } from '../../utils';
import { calculateStampDuty, STAMP_DUTY_STATES, type StampDutyState } from '../../utils/stampDuty';
import {
  getActualPeriodCount,
  monthCountToExcelSerial,
  getPeriodLabels,
  downloadActualsTemplate,
  parseActualsFile,
  applyActualsToInputs,
} from '../../utils/actualsExcel';
import { downloadSCurveTemplate, parseSCurveFile } from '../../utils/sCurveExcel';
import type { CostLineItem, RevenueLineItem, DebtFacility } from '../../types';

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
            <th className="px-2 py-1 text-center w-20 cursor-help" title="GST Included in sale price? Check for GST-taxable supplies (residential, new commercial property). Uncheck for input-taxed or GST-free supplies (going concern, residential rental). Determines whether the margin scheme deduction applies.">GST Inc.</th>
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

// ── Financing Actuals Editor ──────────────────────────────────────────────────
// Per-period actual entry for a single debt facility: drawdown, repayment,
// interest, and fees (line fee + establishment fee combined).
function FinancingActualsEditor({
  label,
  facility,
  actualPeriods,
  onChange,
}: {
  label: string;
  facility: DebtFacility;
  actualPeriods: number;
  onChange: (updated: DebtFacility) => void;
}) {
  if (actualPeriods === 0 || !facility || facility.facilityLimit === 0) return null;

  const periodHeaders = Array.from({ length: actualPeriods }, (_, i) => `P${i + 1}`);

  const rows: { key: 'actualsDrawdown' | 'actualsRepayment' | 'actualsInterest' | 'actualsFees'; label: string }[] = [
    { key: 'actualsDrawdown',  label: 'Drawdown' },
    { key: 'actualsRepayment', label: 'Repayment' },
    { key: 'actualsInterest',  label: 'Interest' },
    { key: 'actualsFees',      label: 'Fees (line+est)' },
  ];

  const updateCell = (field: typeof rows[number]['key'], periodIdx: number, raw: string) => {
    const v = parseFloat(raw);
    const current = [...(facility[field] ?? new Array(periodIdx + 1).fill(0))];
    while (current.length <= periodIdx) current.push(0);
    current[periodIdx] = isNaN(v) ? 0 : Math.max(0, v);
    onChange({ ...facility, [field]: current });
  };

  const clearRow = (field: typeof rows[number]['key']) => {
    onChange({ ...facility, [field]: undefined });
  };

  const hasAny = rows.some(r => (facility[r.key] ?? []).some(v => v > 0));

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <h5 className="text-[10px] font-bold text-gray-700">{label}</h5>
        {hasAny && (
          <button
            onClick={() => onChange({ ...facility, actualsDrawdown: undefined, actualsRepayment: undefined, actualsInterest: undefined, actualsFees: undefined })}
            className="text-[9px] bg-red-100 hover:bg-red-200 text-red-600 px-1.5 py-0.5 rounded"
          >Clear All</button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="text-[10px] border-collapse">
          <thead>
            <tr className="bg-gray-500 text-white">
              <th className="px-2 py-1 text-left w-28">Metric</th>
              <th className="px-1 py-1 w-14">Actions</th>
              {periodHeaders.map(h => (
                <th key={h} className="px-1 py-1 text-center w-20">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label: rowLabel }, rowIdx) => {
              const vals = facility[key] ?? [];
              const hasRowActuals = vals.some(v => v > 0);
              return (
                <tr key={key} className={`border-b border-gray-100 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="px-2 py-0.5 font-medium text-gray-600">{rowLabel}</td>
                  <td className="px-1 py-0.5 text-center">
                    {hasRowActuals && (
                      <button
                        onClick={() => clearRow(key)}
                        className="text-[9px] bg-red-100 hover:bg-red-200 text-red-600 px-1.5 py-0.5 rounded"
                      >Clear</button>
                    )}
                  </td>
                  {periodHeaders.map((_, pIdx) => (
                    <td key={pIdx} className="px-0.5 py-0.5">
                      <input
                        type="number" min="0" step="1000"
                        value={(vals[pIdx] ?? 0) === 0 ? '' : (vals[pIdx] ?? 0)}
                        placeholder="0"
                        onChange={e => updateCell(key, pIdx, e.target.value)}
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

// ── Actuals Section ───────────────────────────────────────────────────────────
// Handles: Current Month input, Excel download/upload, manual per-period entry.
function ActualsSection() {
  const { inputs, setInputs, admin, setAdmin } = useStore();

  // ── Current month derived from admin.lastActualsPeriod ──
  const currentMonth = getActualPeriodCount(
    inputs.preliminary.dateOfFirstPeriod,
    admin.lastActualsPeriod,
  );

  const resolvedLabel = (() => {
    if (currentMonth <= 0) return '—';
    const labels = getPeriodLabels(inputs.preliminary.dateOfFirstPeriod, currentMonth);
    return labels[labels.length - 1];
  })();

  const handleCurrentMonthChange = (val: number) => {
    const clamped = Math.max(0, Math.min(120, Math.round(val)));
    const serial = clamped === 0 ? 0 : monthCountToExcelSerial(
      inputs.preliminary.dateOfFirstPeriod,
      clamped,
    );
    setAdmin({ lastActualsPeriod: serial });
  };

  // ── Upload state ──
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'success' | 'error';
    matched: number;
    unmatched: string[];
    message?: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const clearAll = () => {
    if (!confirm('Clear ALL actual entries (costs, revenue, and financing)?')) return;
    const clearCosts = (items: typeof inputs.developmentCosts) =>
      items.map(i => ({ ...i, actuals: undefined }));
    const clearRev = (items: typeof inputs.grvItems) =>
      items.map(i => ({ ...i, actuals: undefined }));
    const clearInc = (items: typeof inputs.rentalIncome) =>
      items.map(i => ({ ...i, actuals: undefined }));
    const clearFacility = (f: typeof inputs.landLoan) =>
      f ? { ...f, actualsDrawdown: undefined, actualsRepayment: undefined, actualsInterest: undefined, actualsFees: undefined } : f;
    setInputs({
      developmentCosts:   clearCosts(inputs.developmentCosts),
      constructionCosts:  clearCosts(inputs.constructionCosts),
      marketingCosts:     clearCosts(inputs.marketingCosts),
      otherStandardCosts: clearCosts(inputs.otherStandardCosts),
      otherFinancingCosts: clearCosts(inputs.otherFinancingCosts),
      grvItems:    clearRev(inputs.grvItems),
      rentalIncome: clearInc(inputs.rentalIncome),
      otherIncome:  clearInc(inputs.otherIncome),
      landLoan:        clearFacility(inputs.landLoan),
      seniorFacility:  clearFacility(inputs.seniorFacility),
      seniorFacility2: clearFacility(inputs.seniorFacility2),
      seniorFacility3: clearFacility(inputs.seniorFacility3),
      mezzanine:       clearFacility(inputs.mezzanine),
    });
    setUploadStatus(null);
  };

  const handleDownload = async () => {
    if (currentMonth === 0) {
      alert('Set Current Month to at least 1 before downloading the template.');
      return;
    }
    await downloadActualsTemplate(inputs, admin);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (currentMonth === 0) {
      alert('Set Current Month before uploading.');
      e.target.value = '';
      return;
    }
    setIsUploading(true);
    setUploadStatus(null);
    try {
      const parsed = await parseActualsFile(file, currentMonth);
      const { updatedInputs, matchedCount, unmatchedCodes } = applyActualsToInputs(inputs, parsed);
      setInputs(updatedInputs);
      setUploadStatus({ type: 'success', matched: matchedCount, unmatched: unmatchedCodes });
    } catch (err) {
      setUploadStatus({
        type: 'error',
        matched: 0,
        unmatched: [],
        message: err instanceof Error ? err.message : 'Upload failed.',
      });
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div>
      <SectionHeader number="6" title="Actual Costs & Revenue by Period">
        <button
          onClick={clearAll}
          className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
        >Clear All</button>
      </SectionHeader>

      <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4">

        {/* ── Current Month + bulk upload controls ── */}
        <div className="mb-5 p-3 bg-indigo-50 border border-indigo-200 rounded">
          <p className="text-xs font-bold text-indigo-800 mb-3">Actuals Settings</p>

          {/* Current Month */}
          <div className="flex items-center gap-3 mb-3">
            <label className="text-xs font-semibold text-gray-700 w-36 shrink-0">Current Month</label>
            <input
              type="number"
              min={0}
              max={120}
              step={1}
              value={currentMonth === 0 ? '' : currentMonth}
              placeholder="0"
              onChange={e => handleCurrentMonthChange(parseFloat(e.target.value) || 0)}
              className="w-20 text-xs text-right border border-gray-300 rounded px-2 py-0.5 bg-white"
            />
            <span className="text-xs text-indigo-700 font-medium">
              {currentMonth > 0 ? `→ ${resolvedLabel}` : '(set a month number to activate actuals)'}
            </span>
          </div>

          {/* Download / Upload */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleDownload}
              disabled={currentMonth === 0}
              className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-3 py-1 rounded flex items-center gap-1"
            >
              ↓ Download Template
            </button>
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={currentMonth === 0 || isUploading}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-1 rounded flex items-center gap-1"
            >
              {isUploading ? 'Uploading…' : '↑ Upload Actuals (.xlsx)'}
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={handleUpload}
            />
            <span className="text-[10px] text-gray-400">
              Download the template, fill in actual values in yellow cells, then upload. Uploading replaces all existing actuals.
            </span>
          </div>

          {/* Upload result banner */}
          {uploadStatus && (
            <div className={`mt-2 p-2 rounded text-xs ${
              uploadStatus.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {uploadStatus.type === 'success' ? (
                <>
                  <span className="font-semibold">Upload successful</span>
                  {' — '}
                  {uploadStatus.matched} line item{uploadStatus.matched !== 1 ? 's' : ''} updated.
                  {uploadStatus.unmatched.length > 0 && (
                    <span className="ml-2 text-amber-700">
                      {uploadStatus.unmatched.length} unmatched code{uploadStatus.unmatched.length !== 1 ? 's' : ''}:{' '}
                      {uploadStatus.unmatched.join(', ')}
                    </span>
                  )}
                </>
              ) : (
                <><span className="font-semibold">Error:</span> {uploadStatus.message}</>
              )}
            </div>
          )}
        </div>

        {/* ── Manual per-period entry (costs) ── */}
        <p className="text-xs text-gray-500 mb-3">
          You can also enter or adjust actual values manually below.
          Actual-period values are used directly; the remaining budget is redistributed
          over forecast periods using the S-curve weighting.
        </p>

        {currentMonth === 0 ? (
          <p className="text-xs text-gray-400 italic">Set Current Month above to activate the actuals editors.</p>
        ) : (
          <>
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

            {/* ── Financing Facilities Actuals ── */}
            <div className="mt-4 mb-2">
              <p className="text-xs font-semibold text-gray-700 mb-1">Financing Facility Actuals</p>
              <p className="text-[10px] text-gray-500 mb-3">
                Enter actual drawdowns, repayments, interest, and fees for each active facility.
                These override the model-calculated values for display in actual periods only —
                the underlying waterfall calculation is unchanged.
              </p>
            </div>
            <FinancingActualsEditor
              label={inputs.landLoan?.name || 'Land Loan'}
              facility={inputs.landLoan}
              actualPeriods={currentMonth}
              onChange={f => setInputs({ landLoan: f })}
            />
            <FinancingActualsEditor
              label={inputs.seniorFacility?.name || 'Senior Facility'}
              facility={inputs.seniorFacility}
              actualPeriods={currentMonth}
              onChange={f => setInputs({ seniorFacility: f })}
            />
            <FinancingActualsEditor
              label={inputs.seniorFacility2?.name || 'Senior Facility #2'}
              facility={inputs.seniorFacility2}
              actualPeriods={currentMonth}
              onChange={f => setInputs({ seniorFacility2: f })}
            />
            <FinancingActualsEditor
              label={inputs.seniorFacility3?.name || 'Senior Facility #3'}
              facility={inputs.seniorFacility3}
              actualPeriods={currentMonth}
              onChange={f => setInputs({ seniorFacility3: f })}
            />
            <FinancingActualsEditor
              label={inputs.mezzanine?.name || 'Mezzanine'}
              facility={inputs.mezzanine}
              actualPeriods={currentMonth}
              onChange={f => setInputs({ mezzanine: f })}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function MainInputTab() {
  const { inputs, setInputs, admin, setAdmin } = useStore();
  const [section, setSection] = useState<string>('preliminary');
  const [selectedBuildDuration, setSelectedBuildDuration] = useState<number>(41);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);

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
    const concession = inputs.landPurchase.stampDutyConcession ?? 'none';
    const autoSD = calculateStampDuty(landPrice, state, concession);
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
    if (inputs.landPurchase.stampDutyManual) {
      // Manual override — do not recompute
      setInputs({ landPurchase: { ...inputs.landPurchase, landPurchasePrice: landPrice } });
      return;
    }
    const state = (inputs.landPurchase.stampDutyState as StampDutyState) || 'QLD';
    const concession = inputs.landPurchase.stampDutyConcession ?? 'none';
    const autoSD = calculateStampDuty(landPrice, state, concession);
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

  const handleConcessionChange = (concession: 'none' | 'home-concession' | 'first-home' | 'foreign-surcharge') => {
    const state = (inputs.landPurchase.stampDutyState as StampDutyState) || 'QLD';
    const landPrice = inputs.landPurchase.landPurchasePrice;
    const autoSD = calculateStampDuty(landPrice, state, concession);
    const updatedAcq = inputs.landPurchase.acquisitionCosts.map(a =>
      a.id === 'sd' ? { ...a, amount: autoSD } : a
    );
    setInputs({
      landPurchase: {
        ...inputs.landPurchase,
        stampDutyConcession: concession,
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
    e.target.value = '';
  };

  // Excel upload for all S-curves (manual + build)
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const result = await parseSCurveFile(file);
      let summary: string[] = [];

      const nextAdmin: Partial<typeof admin> = {};

      if (result.manualSCurves) {
        nextAdmin.manualSCurves = result.manualSCurves;
        const filled = result.manualSCurves.filter(c => c.some(v => v > 0)).length;
        summary.push(`${filled} manual S-curve(s) imported`);
      }
      if (result.buildSCurves) {
        nextAdmin.buildSCurves = { ...(admin.buildSCurves ?? {}), ...result.buildSCurves };
        summary.push(`${Object.keys(result.buildSCurves).length} build S-curve(s) imported: ${Object.keys(result.buildSCurves).map(k => `${k}mo`).join(', ')}`);
      }

      if (summary.length === 0) {
        alert('No S-curve data found in the uploaded file.');
        return;
      }

      setAdmin(nextAdmin);

      const msg = ['S-curves imported successfully:', ...summary, ...(result.warnings.length ? ['', 'Warnings:', ...result.warnings] : [])].join('\n');
      alert(msg);
    } catch (err) {
      alert(`Failed to parse S-curve file:\n${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadSCurveTemplate(admin);
    } catch (err) {
      alert(`Failed to generate template:\n${err instanceof Error ? err.message : String(err)}`);
    }
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
          <SectionHeader number="1.1" title="Preliminary">
            <button
              onClick={() => {
                if (!confirm('Clear all General inputs?')) return;
                setInputs({
                  preliminary: { ...inputs.preliminary, projectLots: 0, projectGFA: 0, siteArea: 0, projectStartMonth: 0, projectSpanMonths: 0 },
                  landPurchase: { ...inputs.landPurchase, gstRate: 0 },
                });
              }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4 space-y-1.5">
            <p className="text-[11px] text-gray-500 italic">
              Project name and master project list are managed in the <strong>Admin Portal</strong> (top-right corner).
            </p>
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
            <PercentInput label="GST Rate" value={inputs.landPurchase.gstRate}
              onChange={v => setInputs({ landPurchase: { ...inputs.landPurchase, gstRate: v } })} />
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600 w-40 shrink-0" title="Months between paying GST on costs and receiving the ATO ITC refund via BAS. 0 = same-period (Excel default). Set 1–3 for realistic quarterly BAS lag.">ITC Recovery Lag (months)</span>
              <input type="number" min={0} max={6}
                value={admin.itcRecoveryLagMonths ?? 0}
                onChange={e => setAdmin({ itcRecoveryLagMonths: parseInt(e.target.value) || 0 })}
                className="w-20 text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
              />
              <span className="text-xs text-gray-400">0 = same-period (Excel match)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600 w-40 shrink-0" title="Equity-first: all equity drawn before any senior debt. Pro-rata: equity and senior drawn simultaneously at a fixed ratio each period.">Equity Drawdown Mode</span>
              <select
                value={admin.equityDrawdownMode ?? 'equity-first'}
                onChange={e => setAdmin({ equityDrawdownMode: e.target.value as 'equity-first' | 'pro-rata' })}
                className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-1"
              >
                <option value="equity-first">Equity-First (default)</option>
                <option value="pro-rata">Pro-Rata (equity:senior concurrent)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600 w-40 shrink-0" title="GSTA s.72-55: purchaser of new residential premises withholds 1/11 at settlement and remits to ATO. Reduces developer cash at settlement.">GST Withholding (res.)</span>
              <select
                value={admin.applyGSTWithholding ? 'yes' : 'no'}
                onChange={e => setAdmin({ applyGSTWithholding: e.target.value === 'yes' })}
                className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-1"
              >
                <option value="no">Off (default – net settlement modelled)</option>
                <option value="yes">On (s.72-55 withholding applies)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600 w-40 shrink-0" title="'Full' applies GST to the contingency reserve (legacy, assumes reserve spent on creditable acquisitions). 'None' defers GST until actual spend.">Contingency GST</span>
              <select
                value={admin.contingencyGSTMode ?? 'full'}
                onChange={e => setAdmin({ contingencyGSTMode: e.target.value as 'full' | 'none' })}
                className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-1"
              >
                <option value="full">Full (default)</option>
                <option value="none">None (defer until spend)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600 w-40 shrink-0" title="Target minimum DSCR (Debt Service Coverage Ratio). Lenders typically require 1.25x.">DSCR Target</span>
              <input type="number" min={0} max={5} step={0.05}
                value={admin.dscrTarget ?? 1.25}
                onChange={e => setAdmin({ dscrTarget: parseFloat(e.target.value) || 1.25 })}
                className="w-20 text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
              />
              <span className="text-xs text-gray-400">× (1.25 standard)</span>
            </div>
          </div>
        </div>
      )}

      {/* Land */}
      {section === 'land' && (
        <div>
          <SectionHeader number="2.1" title="Land Purchase, PRSV & Acquisition Costs">
            <button
              onClick={() => {
                if (!confirm('Clear all Land inputs?')) return;
                setInputs({
                  landPurchase: {
                    ...inputs.landPurchase,
                    landPurchasePrice: 0, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
                    stampDutyAmount: 0, interestOnDeposit: 0, profitShareToLandOwner: 0,
                    paymentStages: [], acquisitionCosts: [],
                  },
                });
              }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4 space-y-1.5">
            <CurrencyInput label="Land Purchase Price" value={inputs.landPurchase.landPurchasePrice}
              onChange={handleLandPriceChangeWithSD} />
            <CurrencyInput label="PRSV Uplift" value={inputs.landPurchase.prsvUplift}
              onChange={v => setInputs({ landPurchase: { ...inputs.landPurchase, prsvUplift: v } })} />
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
            {/* Stamp Duty Concession/Surcharge */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600 w-40 shrink-0" title="Concession or surcharge applied to standard transfer duty. Home concession = 50% reduction; First Home = full exemption; Foreign surcharge adds ~7-8%.">Concession / Surcharge</span>
              <select
                value={inputs.landPurchase.stampDutyConcession ?? 'none'}
                onChange={e => handleConcessionChange(e.target.value as 'none' | 'home-concession' | 'first-home' | 'foreign-surcharge')}
                className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500"
              >
                <option value="none">None (standard rate)</option>
                <option value="home-concession">Home concession (50% reduction)</option>
                <option value="first-home">First Home Owner (exempt)</option>
                <option value="foreign-surcharge">Foreign acquirer surcharge</option>
              </select>
            </div>
            {/* Manual Override Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600 w-40 shrink-0" title="When enabled, the Stamp Duty field is edited manually and is not recomputed when the land price or state changes.">Manual Stamp Duty</span>
              <select
                value={inputs.landPurchase.stampDutyManual ? 'yes' : 'no'}
                onChange={e => setInputs({ landPurchase: { ...inputs.landPurchase, stampDutyManual: e.target.value === 'yes' } })}
                className="text-xs bg-yellow-50 border border-gray-300 rounded px-2 py-1"
              >
                <option value="no">No (auto-calc from state + concession)</option>
                <option value="yes">Yes (manual override)</option>
              </select>
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
          <SectionHeader number="2.2" title="Development Costs">
            <button
              onClick={() => { if (confirm('Clear all Development Costs?')) setInputs({ developmentCosts: [] }); }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.developmentCosts}
              onChange={items => setInputs({ developmentCosts: items })} />
          </div>
        </div>
      )}

      {/* Construction */}
      {section === 'construction' && (
        <div>
          <SectionHeader number="2.3" title="Total Construction Costs">
            <button
              onClick={() => { if (confirm('Clear all Construction Costs?')) setInputs({ constructionCosts: [], constructionContingencyPercent: 0 }); }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
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
          <SectionHeader number="2.4" title="Marketing & Advertising">
            <button
              onClick={() => { if (confirm('Clear all Marketing Costs?')) setInputs({ marketingCosts: [] }); }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.marketingCosts}
              onChange={items => setInputs({ marketingCosts: items })} />
          </div>
        </div>
      )}

      {/* Other Standard Costs */}
      {section === 'otherCosts' && (
        <div>
          <SectionHeader number="2.5" title="Other Standard Costs">
            <button
              onClick={() => { if (confirm('Clear all Other Standard Costs?')) setInputs({ otherStandardCosts: [] }); }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.otherStandardCosts}
              onChange={items => setInputs({ otherStandardCosts: items })} />
          </div>
        </div>
      )}

      {/* PM Fees */}
      {section === 'pmFees' && (
        <div>
          <SectionHeader number="2.6" title="Development & Project Management Fees">
            <button
              onClick={() => { if (confirm('Clear all PM Fees?')) setInputs({ pmFees: [] }); }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.pmFees}
              onChange={items => setInputs({ pmFees: items })} />
          </div>
        </div>
      )}

      {/* Selling */}
      {section === 'selling' && (
        <div>
          <SectionHeader number="2.7" title="Selling & Leasing Costs">
            <button
              onClick={() => { if (confirm('Clear all Selling Costs?')) setInputs({ sellingCosts: [], frontEndSellingCosts: [], backEndSellingCosts: [] }); }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
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
          <SectionHeader number="3.1" title="Gross Realisable Value (GRV)">
            <button
              onClick={() => { if (confirm('Clear all GRV, Rental & Other Income?')) setInputs({ grvItems: [], rentalIncome: [], otherIncome: [] }); }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <GRVTable items={inputs.grvItems}
              onChange={items => setInputs({ grvItems: items })} />
          </div>
        </div>
      )}

      {/* Financing */}
      {section === 'financing' && (
        <div>
          <div className="flex justify-end mb-1">
            <button
              onClick={() => {
                if (!confirm('Clear all Financing inputs? This resets all equity and debt facilities to zero.')) return;
                const zeroEquity = { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 };
                const zeroDebt = { name: '', facilityLimit: 0, startMonth: 0, maturityMonth: 0, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: false, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1 };
                setInputs({
                  equityDeveloper: { ...zeroEquity, name: 'Developer' },
                  equityJV: { ...zeroEquity, name: 'JV Partner' },
                  equityPreferred: { ...zeroEquity, name: 'Preferred Equity' },
                  equityAdditional: { ...zeroEquity, name: 'Additional Equity' },
                  landLoan: { ...zeroDebt, name: 'Land Loan' },
                  mezzanine: { ...zeroDebt, name: 'Mezzanine' },
                  seniorFacility: { ...zeroDebt, name: 'Senior Facility' },
                  residualStockFacility: { ...zeroDebt, name: 'Residual Stock' },
                  additionalLoan1: { ...zeroDebt, name: 'Additional Loan #1' },
                  additionalLoan2: { ...zeroDebt, name: 'Additional Loan #2' },
                  additionalLoan3: { ...zeroDebt, name: 'Additional Loan #3' },
                });
              }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </div>
          <FinancingInputs />
        </div>
      )}

      {/* Other Financing Costs */}
      {section === 'otherFin' && (
        <div>
          <SectionHeader number="4.3" title="Other Financing Costs">
            <button
              onClick={() => { if (confirm('Clear all Other Financing Costs?')) setInputs({ otherFinancingCosts: [] }); }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.otherFinancingCosts}
              onChange={items => setInputs({ otherFinancingCosts: items })} />
          </div>
        </div>
      )}

      {/* Actuals */}
      {section === 'actuals' && (
        <ActualsSection />
      )}

      {/* Manual S-Curves */}
      {section === 'sCurves' && (
        <div>
          <SectionHeader number="5" title="S-Curve Distributions">
            <button
              onClick={handleDownloadTemplate}
              className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded flex items-center gap-1"
              title="Download all S-curves as Excel template"
            >↓ Excel</button>
            <button
              onClick={() => xlsxInputRef.current?.click()}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded flex items-center gap-1"
              title="Upload S-curves from Excel file"
            >↑ Excel</button>
            <button
              onClick={() => { if (confirm('Clear all Manual S-Curve weights?')) setAdmin({ manualSCurves: [[], [], []], buildSCurves: {} }); }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded"
            >Clear All</button>
          </SectionHeader>
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

            {/* Upload / Download toolbar */}
            <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
              {/* Excel download */}
              <button
                onClick={handleDownloadTemplate}
                className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1"
              >
                <span>↓</span> Download Excel Template
              </button>
              <span className="text-xs text-gray-500">Download current S-curves as .xlsx to edit &amp; re-upload</span>

              <span className="text-gray-300 mx-1">|</span>

              {/* Excel upload */}
              <button
                onClick={() => xlsxInputRef.current?.click()}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1"
              >
                <span>↑</span> Upload Excel (.xlsx)
              </button>
              <input
                ref={xlsxInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleExcelUpload}
              />

              {/* CSV upload (legacy) */}
              <button
                onClick={() => csvInputRef.current?.click()}
                className="text-xs bg-gray-500 hover:bg-gray-600 text-white px-3 py-1.5 rounded font-medium flex items-center gap-1"
              >
                <span>↑</span> Upload CSV
              </button>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={handleCSVImport}
              />
              <span className="text-xs text-gray-400 hidden sm:inline">CSV: "Month, 12 Month Build, ..." format</span>

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

