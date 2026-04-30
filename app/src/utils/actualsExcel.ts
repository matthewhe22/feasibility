/**
 * actualsExcel.ts
 * Generates an actuals template Excel file (pre-populated with existing actuals)
 * and parses an uploaded actuals Excel file back into the store data structures.
 *
 * Template layout (single sheet "Actuals"):
 *   Col A: Category   (reference, locked styling)
 *   Col B: Code       (match key — do not edit)
 *   Col C: Description
 *   Col D: Budget     (reference total from inputs)
 *   Col E…: P1, P2, …, Pn  (one column per actual period — editable, yellow)
 */

import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { MainInputs, AdminConfig, CostLineItem, RevenueLineItem, RentalIncomeItem, DebtFacility } from '../types';
import { excelDateToDate, addMonths, endOfMonth, formatMonthYear, dateToExcelSerial } from './index';

// ─── Period helpers ───────────────────────────────────────────────────────────

/** Returns the number of actual periods given admin config and project start. */
export function getActualPeriodCount(
  firstPeriodSerial: number,
  lastActualsPeriodSerial: number,
): number {
  if (!lastActualsPeriodSerial) return 0;
  const firstDate = excelDateToDate(firstPeriodSerial);
  const lastActualsDate = excelDateToDate(lastActualsPeriodSerial);
  let count = 0;
  for (let i = 0; i < 120; i++) {
    const d = new Date(addMonths(firstDate, i));
    d.setDate(1);
    const end = endOfMonth(d);
    if (end > lastActualsDate) break;
    count++;
  }
  return count;
}

/** Converts a 1-based month count back to an Excel serial date (end of that month). */
export function monthCountToExcelSerial(firstPeriodSerial: number, monthCount: number): number {
  if (monthCount <= 0) return 0;
  const firstDate = excelDateToDate(firstPeriodSerial);
  const d = new Date(addMonths(firstDate, monthCount - 1));
  d.setDate(1);
  return dateToExcelSerial(endOfMonth(d));
}

/** Returns "Mon-YY" labels for actual periods (e.g. ["Apr-23", "May-23", …]). */
export function getPeriodLabels(firstPeriodSerial: number, count: number): string[] {
  const firstDate = excelDateToDate(firstPeriodSerial);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(addMonths(firstDate, i));
    d.setDate(1);
    return formatMonthYear(endOfMonth(d));
  });
}

// ─── Styling helpers ──────────────────────────────────────────────────────────

const REF_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FFE5E7EB' }, // gray-200
};
const EDITABLE_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FFFEF9C3' }, // yellow-100
};
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FF1D4ED8' }, // blue-700
};
const CAT_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FFDBEAFE' }, // blue-100
};
const BORDER: Partial<ExcelJS.Borders> = {
  top:    { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left:   { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right:  { style: 'thin', color: { argb: 'FFD1D5DB' } },
};
const CURRENCY_FMT = '#,##0';

function styleHeader(cell: ExcelJS.Cell) {
  cell.fill = HEADER_FILL;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
  cell.border = BORDER;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function styleRef(cell: ExcelJS.Cell, bold = false) {
  cell.fill = REF_FILL;
  cell.font = { bold, size: 9 };
  cell.border = BORDER;
}

function styleEditable(cell: ExcelJS.Cell) {
  cell.fill = EDITABLE_FILL;
  cell.font = { size: 9 };
  cell.border = BORDER;
  cell.numFmt = CURRENCY_FMT;
  cell.alignment = { horizontal: 'right' };
}

function styleCategoryRow(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = CAT_FILL;
    cell.font = { bold: true, size: 9, color: { argb: 'FF1E3A8A' } };
    cell.border = BORDER;
  }
}

// ─── Row builders ─────────────────────────────────────────────────────────────

function addCostRow(
  ws: ExcelJS.Worksheet,
  category: string,
  item: CostLineItem,
  numPeriods: number,
) {
  const actuals = item.actuals ?? [];
  const values: (number | string)[] = [
    category,
    item.code,
    item.description,
    item.totalCosts,
    ...Array.from({ length: numPeriods }, (_, i) => actuals[i] ?? 0),
  ];
  const row = ws.addRow(values);
  styleRef(row.getCell(1));
  styleRef(row.getCell(2), true);
  styleRef(row.getCell(3));
  row.getCell(4).fill = REF_FILL;
  row.getCell(4).font = { size: 9 };
  row.getCell(4).border = BORDER;
  row.getCell(4).numFmt = CURRENCY_FMT;
  row.getCell(4).alignment = { horizontal: 'right' };
  for (let c = 5; c < 5 + numPeriods; c++) {
    styleEditable(row.getCell(c));
  }
  row.height = 14;
}

function addGRVRow(
  ws: ExcelJS.Worksheet,
  item: RevenueLineItem,
  numPeriods: number,
) {
  const actuals = item.actuals ?? [];
  const values: (number | string)[] = [
    'GRV Revenue',
    item.code,
    item.description,
    item.currentSalePrice,
    ...Array.from({ length: numPeriods }, (_, i) => actuals[i] ?? 0),
  ];
  const row = ws.addRow(values);
  styleRef(row.getCell(1));
  styleRef(row.getCell(2), true);
  styleRef(row.getCell(3));
  row.getCell(4).fill = REF_FILL;
  row.getCell(4).font = { size: 9 };
  row.getCell(4).border = BORDER;
  row.getCell(4).numFmt = CURRENCY_FMT;
  row.getCell(4).alignment = { horizontal: 'right' };
  for (let c = 5; c < 5 + numPeriods; c++) {
    styleEditable(row.getCell(c));
  }
  row.height = 14;
}

function addIncomeRow(
  ws: ExcelJS.Worksheet,
  category: string,
  item: RentalIncomeItem,
  numPeriods: number,
) {
  const budget = item.units * item.baseRate;
  const actuals = item.actuals ?? [];
  const values: (number | string)[] = [
    category,
    item.code,
    item.description,
    budget,
    ...Array.from({ length: numPeriods }, (_, i) => actuals[i] ?? 0),
  ];
  const row = ws.addRow(values);
  styleRef(row.getCell(1));
  styleRef(row.getCell(2), true);
  styleRef(row.getCell(3));
  row.getCell(4).fill = REF_FILL;
  row.getCell(4).font = { size: 9 };
  row.getCell(4).border = BORDER;
  row.getCell(4).numFmt = CURRENCY_FMT;
  row.getCell(4).alignment = { horizontal: 'right' };
  for (let c = 5; c < 5 + numPeriods; c++) {
    styleEditable(row.getCell(c));
  }
  row.height = 14;
}

function addCategoryHeader(ws: ExcelJS.Worksheet, label: string, totalCols: number) {
  const row = ws.addRow([label]);
  ws.mergeCells(row.number, 1, row.number, totalCols);
  styleCategoryRow(row, totalCols);
  row.height = 16;
}

// Synthetic codes used for financing actuals rows (col B key for parse matching).
// Format: <FACILITY>_<METRIC>
export const FINANCING_ACTUALS_CODES = {
  LAND_DRAW:  'LAND_DRAW',  LAND_REPAY: 'LAND_REPAY',  LAND_INT:  'LAND_INT',  LAND_FEES:  'LAND_FEES',
  SNR_DRAW:   'SNR_DRAW',   SNR_REPAY:  'SNR_REPAY',   SNR_INT:   'SNR_INT',   SNR_FEES:   'SNR_FEES',
  SNR2_DRAW:  'SNR2_DRAW',  SNR2_REPAY: 'SNR2_REPAY',  SNR2_INT:  'SNR2_INT',  SNR2_FEES:  'SNR2_FEES',
  SNR3_DRAW:  'SNR3_DRAW',  SNR3_REPAY: 'SNR3_REPAY',  SNR3_INT:  'SNR3_INT',  SNR3_FEES:  'SNR3_FEES',
  MEZZ_DRAW:  'MEZZ_DRAW',  MEZZ_REPAY: 'MEZZ_REPAY',  MEZZ_INT:  'MEZZ_INT',  MEZZ_FEES:  'MEZZ_FEES',
};

function addFinancingRow(
  ws: ExcelJS.Worksheet,
  category: string,
  code: string,
  description: string,
  facilityLimit: number,
  existingActuals: number[] | undefined,
  numPeriods: number,
) {
  const actuals = existingActuals ?? [];
  const values: (number | string)[] = [
    category, code, description, facilityLimit,
    ...Array.from({ length: numPeriods }, (_, i) => actuals[i] ?? 0),
  ];
  const row = ws.addRow(values);
  styleRef(row.getCell(1));
  styleRef(row.getCell(2), true);
  styleRef(row.getCell(3));
  row.getCell(4).fill = REF_FILL;
  row.getCell(4).font = { size: 9 };
  row.getCell(4).border = BORDER;
  row.getCell(4).numFmt = CURRENCY_FMT;
  row.getCell(4).alignment = { horizontal: 'right' };
  for (let c = 5; c < 5 + numPeriods; c++) {
    styleEditable(row.getCell(c));
  }
  row.height = 14;
}

function addFinancingFacilityRows(
  ws: ExcelJS.Worksheet,
  facility: DebtFacility,
  prefix: string,
  numPeriods: number,
) {
  if (!facility || facility.facilityLimit === 0) return;
  const cat = 'Financing';
  addFinancingRow(ws, cat, `${prefix}_DRAW`,  `${facility.name} – Drawdown`,        facility.facilityLimit, facility.actualsDrawdown,  numPeriods);
  addFinancingRow(ws, cat, `${prefix}_REPAY`, `${facility.name} – Repayment`,       facility.facilityLimit, facility.actualsRepayment, numPeriods);
  addFinancingRow(ws, cat, `${prefix}_INT`,   `${facility.name} – Interest`,         0,                     facility.actualsInterest,  numPeriods);
  addFinancingRow(ws, cat, `${prefix}_FEES`,  `${facility.name} – Fees (line+est)`, 0,                     facility.actualsFees,      numPeriods);
}

// ─── Public: download template ────────────────────────────────────────────────

export async function downloadActualsTemplate(
  inputs: MainInputs,
  admin: AdminConfig,
): Promise<void> {
  const numPeriods = getActualPeriodCount(
    inputs.preliminary.dateOfFirstPeriod,
    admin.lastActualsPeriod,
  );
  if (numPeriods === 0) {
    alert('Current Month is 0 — set a current month before downloading the template.');
    return;
  }

  const periodLabels = getPeriodLabels(inputs.preliminary.dateOfFirstPeriod, numPeriods);
  const totalCols = 4 + numPeriods;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Feasibility Model';
  const ws = wb.addWorksheet('Actuals', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }],
  });

  // ── Row 1: instruction banner ──
  ws.addRow(['⚠  DO NOT change column A (Category) or column B (Code). Enter actual values in yellow cells only.']);
  ws.mergeCells(1, 1, 1, totalCols);
  const instrCell = ws.getCell(1, 1);
  instrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
  instrCell.font = { bold: true, size: 9, color: { argb: 'FF92400E' } };
  instrCell.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(1).height = 18;

  // ── Row 2: column headers ──
  const headers = ['Category', 'Code', 'Description', 'Budget ($)', ...periodLabels];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => styleHeader(cell));
  headerRow.height = 20;

  // ── Column widths ──
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 9;
  ws.getColumn(3).width = 32;
  ws.getColumn(4).width = 14;
  for (let c = 5; c <= totalCols; c++) {
    ws.getColumn(c).width = 12;
  }

  // ── Cost rows ──
  const costGroups: { label: string; items: CostLineItem[] }[] = [
    { label: 'Development Costs',   items: inputs.developmentCosts },
    { label: 'Construction Costs',  items: inputs.constructionCosts },
    { label: 'Marketing Costs',     items: inputs.marketingCosts },
    { label: 'Other Standard Costs', items: inputs.otherStandardCosts },
    { label: 'Other Financing Costs', items: inputs.otherFinancingCosts },
  ];

  for (const { label, items } of costGroups) {
    addCategoryHeader(ws, label, totalCols);
    for (const item of items) {
      addCostRow(ws, label, item, numPeriods);
    }
  }

  // ── Revenue rows ──
  addCategoryHeader(ws, 'GRV Revenue', totalCols);
  for (const item of inputs.grvItems) {
    addGRVRow(ws, item, numPeriods);
  }

  addCategoryHeader(ws, 'Rental Income', totalCols);
  for (const item of inputs.rentalIncome) {
    addIncomeRow(ws, 'Rental Income', item, numPeriods);
  }

  addCategoryHeader(ws, 'Other Income', totalCols);
  for (const item of inputs.otherIncome) {
    addIncomeRow(ws, 'Other Income', item, numPeriods);
  }

  // ── Financing actuals rows (one section per active facility) ──
  const hasAnyFinancing = [
    inputs.landLoan, inputs.seniorFacility, inputs.seniorFacility2,
    inputs.mezzanine,
  ].some(f => f && f.facilityLimit > 0);

  if (hasAnyFinancing) {
    addCategoryHeader(ws, 'Financing – Actual Drawdowns, Repayments & Costs', totalCols);
    addFinancingFacilityRows(ws, inputs.landLoan,        'LAND', numPeriods);
    addFinancingFacilityRows(ws, inputs.seniorFacility,  'SNR',  numPeriods);
    addFinancingFacilityRows(ws, inputs.seniorFacility2, 'SNR2', numPeriods);
    addFinancingFacilityRows(ws, inputs.mezzanine,       'MEZZ', numPeriods);
  }

  // ── Save ──
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const projectName = admin.projectName?.replace(/[^a-z0-9]/gi, '_') || 'project';
  saveAs(blob, `${projectName}_actuals_template.xlsx`);
}

// ─── Public: parse uploaded file ─────────────────────────────────────────────

export interface ActualsParseResult {
  /** code → array of per-period actual values (length = numPeriods) */
  actualsMap: Map<string, number[]>;
  /** Codes found in the file but not matched in any input array */
  unmatchedCodes: string[];
  /** How many items were successfully matched and updated */
  matchedCount: number;
  numPeriods: number;
}

export async function parseActualsFile(
  file: File,
  numPeriods: number,
): Promise<ActualsParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet('Actuals');
  if (!ws) throw new Error('Sheet "Actuals" not found. Please use the downloaded template.');

  const actualsMap = new Map<string, number[]>();
  const unmatchedCodes: string[] = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return; // skip instruction + header rows

    const codeCell = row.getCell(2).value;
    const code = codeCell != null ? String(codeCell).trim() : '';
    if (!code) return;

    // Skip category header rows (col A bold, col B empty or matches col A)
    const catCell = row.getCell(1).value;
    if (catCell && String(catCell) === code) return;

    const values: number[] = [];
    for (let col = 5; col < 5 + numPeriods; col++) {
      const v = row.getCell(col).value;
      values.push(typeof v === 'number' ? Math.max(0, v) : 0);
    }

    actualsMap.set(code, values);
  });

  return { actualsMap, unmatchedCodes, matchedCount: 0, numPeriods };
}

/**
 * Apply a parsed actualsMap to all input arrays.
 * Returns updated inputs and a summary of what was matched.
 */
export function applyActualsToInputs(
  inputs: MainInputs,
  result: ActualsParseResult,
): {
  updatedInputs: Partial<MainInputs>;
  matchedCount: number;
  unmatchedCodes: string[];
} {
  const { actualsMap, numPeriods } = result;
  const remaining = new Set(actualsMap.keys());
  let matchedCount = 0;

  function applyToCostItems(items: typeof inputs.developmentCosts) {
    return items.map(item => {
      if (actualsMap.has(item.code)) {
        remaining.delete(item.code);
        matchedCount++;
        const raw = actualsMap.get(item.code)!;
        // Pad or trim to exactly numPeriods
        const actuals = Array.from({ length: numPeriods }, (_, i) => raw[i] ?? 0);
        return { ...item, actuals };
      }
      // Replace mode: clear existing actuals for items not in upload
      return { ...item, actuals: undefined };
    });
  }

  function applyToGRVItems(items: typeof inputs.grvItems) {
    return items.map(item => {
      if (actualsMap.has(item.code)) {
        remaining.delete(item.code);
        matchedCount++;
        const raw = actualsMap.get(item.code)!;
        const actuals = Array.from({ length: numPeriods }, (_, i) => raw[i] ?? 0);
        return { ...item, actuals };
      }
      return { ...item, actuals: undefined };
    });
  }

  function applyToIncomeItems(items: typeof inputs.rentalIncome) {
    return items.map(item => {
      if (actualsMap.has(item.code)) {
        remaining.delete(item.code);
        matchedCount++;
        const raw = actualsMap.get(item.code)!;
        const actuals = Array.from({ length: numPeriods }, (_, i) => raw[i] ?? 0);
        return { ...item, actuals };
      }
      return { ...item, actuals: undefined };
    });
  }

  // ── Financing actuals: map synthetic codes to facility fields ──
  function applyToFacility(
    facility: MainInputs['landLoan'],
    prefix: string,
  ): MainInputs['landLoan'] {
    if (!facility) return facility;
    let updated = { ...facility };
    const drawCode  = `${prefix}_DRAW`;
    const repayCode = `${prefix}_REPAY`;
    const intCode   = `${prefix}_INT`;
    const feesCode  = `${prefix}_FEES`;

    if (actualsMap.has(drawCode)) {
      remaining.delete(drawCode); matchedCount++;
      updated = { ...updated, actualsDrawdown: Array.from({ length: numPeriods }, (_, i) => actualsMap.get(drawCode)![i] ?? 0) };
    } else {
      updated = { ...updated, actualsDrawdown: undefined };
    }
    if (actualsMap.has(repayCode)) {
      remaining.delete(repayCode); matchedCount++;
      updated = { ...updated, actualsRepayment: Array.from({ length: numPeriods }, (_, i) => actualsMap.get(repayCode)![i] ?? 0) };
    } else {
      updated = { ...updated, actualsRepayment: undefined };
    }
    if (actualsMap.has(intCode)) {
      remaining.delete(intCode); matchedCount++;
      updated = { ...updated, actualsInterest: Array.from({ length: numPeriods }, (_, i) => actualsMap.get(intCode)![i] ?? 0) };
    } else {
      updated = { ...updated, actualsInterest: undefined };
    }
    if (actualsMap.has(feesCode)) {
      remaining.delete(feesCode); matchedCount++;
      updated = { ...updated, actualsFees: Array.from({ length: numPeriods }, (_, i) => actualsMap.get(feesCode)![i] ?? 0) };
    } else {
      updated = { ...updated, actualsFees: undefined };
    }
    return updated;
  }

  const updatedInputs: Partial<MainInputs> = {
    developmentCosts:   applyToCostItems(inputs.developmentCosts),
    constructionCosts:  applyToCostItems(inputs.constructionCosts),
    marketingCosts:     applyToCostItems(inputs.marketingCosts),
    otherStandardCosts: applyToCostItems(inputs.otherStandardCosts),
    otherFinancingCosts: applyToCostItems(inputs.otherFinancingCosts),
    grvItems:           applyToGRVItems(inputs.grvItems),
    rentalIncome:       applyToIncomeItems(inputs.rentalIncome),
    otherIncome:        applyToIncomeItems(inputs.otherIncome),
    landLoan:           applyToFacility(inputs.landLoan,        'LAND'),
    seniorFacility:     applyToFacility(inputs.seniorFacility,  'SNR'),
    seniorFacility2:    applyToFacility(inputs.seniorFacility2, 'SNR2'),
    mezzanine:          applyToFacility(inputs.mezzanine,       'MEZZ'),
  };

  return {
    updatedInputs,
    matchedCount,
    unmatchedCodes: Array.from(remaining),
  };
}
