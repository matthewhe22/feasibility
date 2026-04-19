/**
 * exportToExcel.ts
 * Exports DashboardData (cashflow + all summary tables) to a formatted .xlsx
 * file using ExcelJS.  The layout mirrors the in-app tables exactly.
 *
 * Usage:
 *   await exportToExcel(data, admin, 'My Project');
 */
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { DashboardData, AdminConfig, MonthlyCashflow } from '../types';

// ── Colour palette (hex, no leading #) ──────────────────────────────────────
const CLR = {
  // Section header backgrounds
  costs:    'B91C1C', // red-800
  revenue:  '166534', // green-800
  senior:   '1E3A8A', // blue-800
  mezz:     '134E4A', // teal-800
  land:     '9A3412', // orange-800
  equity:   '581C87', // purple-800
  net:      '374151', // gray-700

  // Subtotal row fills
  costsSub:    'FEE2E2', // red-100
  revenueSub:  'DCFCE7', // green-100
  seniorSub:   'DBEAFE', // blue-100
  mezzSub:     'CCFBF1', // teal-100
  landSub:     'FFEDD5', // orange-100

  // Column chrome
  colHeader:  '374151', // gray-700
  colMonth:   '4B5563', // gray-600
  totalCol:   'E5E7EB', // gray-200
  summaryHdr: '1E3A8A', // blue-900 for dashboard section headers
  summaryAlt: 'F3F4F6', // gray-100

  white:  'FFFFFF',
  black:  '111827',
};

// ── Helper: apply fill + font to a cell ─────────────────────────────────────
function style(
  cell: ExcelJS.Cell,
  opts: {
    fill?: string;
    fontColor?: string;
    bold?: boolean;
    italic?: boolean;
    size?: number;
    numFmt?: string;
    hAlign?: ExcelJS.Alignment['horizontal'];
    wrapText?: boolean;
    border?: boolean;
  } = {},
) {
  if (opts.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + opts.fill } };
  }
  cell.font = {
    name: 'Calibri',
    size: opts.size ?? 9,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    color: { argb: 'FF' + (opts.fontColor ?? CLR.black) },
  };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  cell.alignment = {
    horizontal: opts.hAlign ?? 'left',
    vertical: 'middle',
    wrapText: opts.wrapText ?? false,
  };
  if (opts.border) {
    const b: ExcelJS.Border = { style: 'thin', color: { argb: 'FFD1D5DB' } };
    cell.border = { top: b, bottom: b, left: b, right: b };
  }
}

// ── Currency format string ───────────────────────────────────────────────────
const CURRENCY_FMT = '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)';
const PCT_FMT      = '0.00%';

// ── Row definition (same shape as SECTIONS in ProjectCashflow.tsx) ──────────
type RowDef = {
  label: string;
  getValue: (c: MonthlyCashflow) => number;
  bold?: boolean;
  subtotalFill?: string;
  headerFill?: string; // section divider row
};

const CASHFLOW_SECTIONS: {
  header: string;
  headerFill: string;
  rows: RowDef[];
}[] = [
  {
    header: 'COSTS',
    headerFill: CLR.costs,
    rows: [
      { label: 'Land Costs',            getValue: c => c.landCosts },
      { label: 'Acquisition Costs',     getValue: c => c.acquisitionCosts },
      { label: 'Development Costs',     getValue: c => c.developmentCosts },
      { label: 'Construction Costs',    getValue: c => c.constructionCosts },
      { label: 'Contingency',           getValue: c => c.contingency },
      { label: 'Marketing',             getValue: c => c.marketingCosts },
      { label: 'Other Standard Costs',  getValue: c => c.otherStandardCosts },
      { label: 'PM Fees',               getValue: c => c.pmFees },
      { label: 'Selling Costs',         getValue: c => c.sellingCostsFrontEnd },
      { label: 'Other Financing Costs', getValue: c => c.otherFinancingCosts },
      {
        label: 'Total Costs',
        getValue: c => c.landCosts + c.acquisitionCosts + c.developmentCosts + c.constructionCosts +
          c.contingency + c.marketingCosts + c.otherStandardCosts + c.pmFees +
          c.sellingCostsFrontEnd + c.otherFinancingCosts,
        bold: true, subtotalFill: CLR.costsSub,
      },
    ],
  },
  {
    header: 'REVENUE',
    headerFill: CLR.revenue,
    rows: [
      { label: 'GRV Settlements', getValue: c => c.grvSettlements },
      { label: 'Rental Income',   getValue: c => c.rentalIncome },
      { label: 'Other Income',    getValue: c => c.otherIncome },
      {
        label: 'Total Revenue',
        getValue: c => c.grvSettlements + c.rentalIncome + c.otherIncome,
        bold: true, subtotalFill: CLR.revenueSub,
      },
    ],
  },
  {
    header: 'SENIOR FACILITY',
    headerFill: CLR.senior,
    rows: [
      { label: 'Senior Drawdown',  getValue: c => c.seniorDrawdown },
      { label: 'Senior Repayment', getValue: c => c.seniorRepayment },
      { label: 'Senior Interest',  getValue: c => c.seniorInterest },
      { label: 'Senior Line fee',   getValue: c => c.seniorFees },
      { label: 'Senior Balance',   getValue: c => c.seniorBalance, bold: true, subtotalFill: CLR.seniorSub },
    ],
  },
  {
    header: 'MEZZANINE FACILITY',
    headerFill: CLR.mezz,
    rows: [
      { label: 'Mezz Drawdown',  getValue: c => c.mezzDrawdown },
      { label: 'Mezz Repayment', getValue: c => c.mezzRepayment },
      { label: 'Mezz Interest',  getValue: c => c.mezzInterest },
      { label: 'Mezz Fees',      getValue: c => c.mezzFees },
      { label: 'Mezz Balance',   getValue: c => c.mezzBalance, bold: true, subtotalFill: CLR.mezzSub },
    ],
  },
  {
    header: 'LAND LOAN',
    headerFill: CLR.land,
    rows: [
      { label: 'Land Loan Drawdown',  getValue: c => c.landLoanDrawdown },
      { label: 'Land Loan Repayment', getValue: c => c.landLoanRepayment },
      { label: 'Land Loan Interest',  getValue: c => c.landLoanInterest },
      { label: 'Land Loan Balance',   getValue: c => c.landLoanBalance, bold: true, subtotalFill: CLR.landSub },
    ],
  },
  {
    header: 'EQUITY',
    headerFill: CLR.equity,
    rows: [
      { label: 'Equity Injection',    getValue: c => c.equityInjection },
      { label: 'Equity Repatriation', getValue: c => c.equityRepatriation },
      { label: 'Profit Distribution', getValue: c => c.profitDistribution },
    ],
  },
  {
    header: 'NET POSITION',
    headerFill: CLR.net,
    rows: [
      { label: 'Net Cashflow',       getValue: c => c.netCashflow,       bold: true },
      { label: 'Cumulative Cashflow', getValue: c => c.cumulativeCashflow, bold: true },
    ],
  },
];

// ── Sheet 1: Cashflow ────────────────────────────────────────────────────────

function buildCashflowSheet(ws: ExcelJS.Worksheet, cashflows: MonthlyCashflow[]) {
  const cf = cashflows;
  const totalCols = cf.length;

  // Column widths: col 1 = label (28), col 2 = total (14), then period cols (10 each)
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 14;
  for (let c = 3; c <= totalCols + 2; c++) ws.getColumn(c).width = 10;

  // Row 1: Period numbers
  const r1 = ws.addRow(['Period', 'Total', ...cf.map(c => c.period.periodNumber)]);
  r1.height = 16;
  r1.eachCell((cell, colNum) => {
    style(cell, {
      fill: CLR.colHeader, fontColor: CLR.white, bold: true,
      hAlign: colNum === 1 ? 'left' : 'center', size: 9,
    });
  });

  // Row 2: Month labels
  const r2 = ws.addRow(['Month', '', ...cf.map(c => c.period.label)]);
  r2.height = 14;
  r2.eachCell((cell, colNum) => {
    style(cell, {
      fill: CLR.colMonth, fontColor: CLR.white,
      hAlign: colNum === 1 ? 'left' : 'center', size: 9,
    });
  });

  // Freeze the header rows and label column
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];

  // Data sections
  for (const section of CASHFLOW_SECTIONS) {
    // Section header row (spans all cols)
    const hdrRow = ws.addRow([section.header]);
    hdrRow.height = 14;
    ws.mergeCells(hdrRow.number, 1, hdrRow.number, totalCols + 2);
    style(hdrRow.getCell(1), { fill: section.headerFill, fontColor: CLR.white, bold: true, size: 9 });

    // Data rows
    for (const row of section.rows) {
      const values: (string | number)[] = [
        row.label,
        cf.reduce((s, c) => s + row.getValue(c), 0),
        ...cf.map(c => row.getValue(c)),
      ];
      const dataRow = ws.addRow(values);
      dataRow.height = 13;
      const rowFill = row.subtotalFill;

      dataRow.eachCell((cell, colNum) => {
        const isLabel = colNum === 1;
        const isTotal = colNum === 2;
        const val = isLabel ? undefined : (cell.value as number);

        style(cell, {
          fill: rowFill,
          fontColor: (val !== undefined && val < 0) ? 'DC2626' : CLR.black,
          bold: row.bold,
          hAlign: isLabel ? 'left' : 'right',
          numFmt: isLabel ? undefined : CURRENCY_FMT,
          size: 9,
        });

        if (isTotal) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
          cell.border = {
            right: { style: 'medium', color: { argb: 'FF9CA3AF' } },
          };
        }
      });
    }
  }

  // Outer border on the header rows
  for (let c = 1; c <= totalCols + 2; c++) {
    const cell = ws.getRow(1).getCell(c);
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF6B7280' } } };
  }
}

// ── Sheet 2: Summary Dashboard ───────────────────────────────────────────────

function writeSection(
  ws: ExcelJS.Worksheet,
  title: string,
  rows: [string, string | number, string?][],   // [label, value, optional note]
  startRow: number,
): number {
  // Title row
  const titleRow = ws.getRow(startRow);
  titleRow.height = 16;
  const tc = titleRow.getCell(1);
  tc.value = title;
  ws.mergeCells(startRow, 1, startRow, 3);
  style(tc, { fill: CLR.summaryHdr, fontColor: CLR.white, bold: true, size: 10 });

  let r = startRow + 1;
  for (const [label, value, note] of rows) {
    const row = ws.getRow(r);
    row.height = 13;
    const lc = row.getCell(1);
    const vc = row.getCell(2);
    const nc = row.getCell(3);

    lc.value = label;
    vc.value = value;
    if (note) nc.value = note;

    const isAlt = (r - startRow) % 2 === 0;
    const numericVal = typeof value === 'number' ? value : null;

    style(lc, { fill: isAlt ? CLR.summaryAlt : undefined, size: 9 });
    style(vc, {
      fill: isAlt ? CLR.summaryAlt : undefined,
      hAlign: 'right',
      bold: false,
      fontColor: (numericVal !== null && numericVal < 0) ? 'DC2626' : CLR.black,
      size: 9,
    });
    if (note) style(nc, { fill: isAlt ? CLR.summaryAlt : undefined, italic: true, fontColor: '6B7280', size: 8 });

    r++;
  }

  return r + 1; // blank gap after section
}

function buildSummarySheet(ws: ExcelJS.Worksheet, data: DashboardData, projectName: string) {
  ws.getColumn(1).width = 38;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 32;

  // Title
  const titleRow = ws.getRow(1);
  const tc = titleRow.getCell(1);
  tc.value = projectName + ' — Feasibility Summary';
  ws.mergeCells(1, 1, 1, 3);
  style(tc, { fill: '111827', fontColor: CLR.white, bold: true, size: 13 });
  titleRow.height = 22;

  const { feasibility: f, kpis, capitalStack: cs, debtSummary: ds, debtRates: dr, keyDates: kd, equityReturns } = data;

  let row = 3;

  // ── Feasibility Summary ──
  row = writeSection(ws, 'FEASIBILITY SUMMARY', [
    ['Gross Realisable Value (GRV)',   f.totalGRV,   CURRENCY_FMT],
    ['Land Cost',                      -f.land,       CURRENCY_FMT],
    ['Stamp Duty',                     -f.stampDuty,  CURRENCY_FMT],
    ['Construction & Contingency',     -f.buildCosts, CURRENCY_FMT],
    ['Development Costs',              -f.standardCosts, CURRENCY_FMT],
    ['Marketing & Advertising',        -f.marketingAndAdvertising, CURRENCY_FMT],
    ['Sales Commissions',              -f.salesCommissions, CURRENCY_FMT],
    ['PM Fees',                        -f.pmFee, CURRENCY_FMT],
    ['Senior Finance Costs',           -f.seniorFinanceCosts, CURRENCY_FMT],
    ['Mezz Finance Costs',             -f.mezzFinanceCosts, CURRENCY_FMT],
    ['Other Financing Costs',          -f.otherFinancingCosts, CURRENCY_FMT],
    ['GST',                            -f.gst, CURRENCY_FMT],
    ['Total Cost',                     -f.totalCost, CURRENCY_FMT],
    ['Total Profit',                    f.totalProfit, CURRENCY_FMT],
  ].map(([l, v, _fmt]) => [l as string, v as number]), row);

  // ── KPIs ──
  row = writeSection(ws, 'KEY PERFORMANCE INDICATORS', [
    ['IRR (equity, monthly compounded)',    kpis.irr,            ''],
    ['ROI (profit / total cost)',           kpis.roi,            ''],
    ['Cash-on-Cash (total)',                kpis.totalCashOnCash, ''],
    ['Cash-on-Cash (annualised)',           kpis.annualCashOnCash, ''],
  ].map(([l, v]) => [l as string, v as number]), row);

  // Format KPI values as percentages
  const kpiStartRow = row - 5;
  for (let r2 = kpiStartRow + 1; r2 <= kpiStartRow + 4; r2++) {
    ws.getRow(r2).getCell(2).numFmt = PCT_FMT;
  }

  // ── Capital Stack ──
  row = writeSection(ws, 'CAPITAL STACK', [
    ['Senior Facility',  cs.seniorAmount, ''],
    ['  LTC',            cs.seniorLTC,    ''],
    ['  LVR',            cs.seniorLVR,    ''],
    ['Mezzanine',        cs.mezzAmount,   ''],
    ['  LTC',            cs.mezzLTC,      ''],
    ['  LVR',            cs.mezzLVR,      ''],
    ['Equity',           cs.equityAmount, ''],
    ['  LTC',            cs.equityLTC,    ''],
    ['Total Capital',    cs.total,        ''],
  ].map(([l, v]) => [l as string, v as number]), row);

  // Apply formats
  const csStart = row - 10;
  for (const [offset, fmt] of [[1, CURRENCY_FMT], [2, PCT_FMT], [3, PCT_FMT], [4, CURRENCY_FMT], [5, PCT_FMT], [6, PCT_FMT], [7, CURRENCY_FMT], [8, PCT_FMT], [9, CURRENCY_FMT]] as [number, string][]) {
    ws.getRow(csStart + offset).getCell(2).numFmt = fmt;
  }

  // ── Debt Summary ──
  row = writeSection(ws, 'DEBT SUMMARY', [
    ['Senior Principal',        ds.seniorPrincipal],
    ['Senior Interest & Fees',  ds.seniorInterest],
    ['Senior Total',            ds.seniorTotal],
    ['Mezz Principal',          ds.mezzPrincipal],
    ['Mezz Interest & Fees',    ds.mezzInterest],
    ['Mezz Total',              ds.mezzTotal],
    ['Total Debt',              ds.totalDebt],
  ].map(([l, v]) => [l as string, v as number]), row);
  const dsSt = row - 8;
  for (let r2 = dsSt + 1; r2 <= dsSt + 7; r2++) ws.getRow(r2).getCell(2).numFmt = CURRENCY_FMT;

  // ── Debt Rates ──
  row = writeSection(ws, 'DEBT RATES', [
    ['Senior Margin',        dr.seniorMargin,       ''],
    ['Senior BBSY',          dr.seniorBBSY,         ''],
    ['Senior All-In',        dr.seniorAllIn,        ''],
    ['Senior Establishment', dr.seniorEstablishment, ''],
    ['Senior Line Fee',      dr.seniorLineFee,      ''],
    ['Mezz All-In',          dr.mezzAllIn,          ''],
    ['Land Loan All-In',     dr.landAllIn,          ''],
  ].map(([l, v]) => [l as string, v as number]), row);
  const drSt = row - 8;
  for (let r2 = drSt + 1; r2 <= drSt + 7; r2++) ws.getRow(r2).getCell(2).numFmt = PCT_FMT;

  // ── Key Dates ──
  row = writeSection(ws, 'KEY DATES & DURATIONS', [
    ['Contract Start',              kd.contractStartDate],
    ['Land Settlement',             kd.landSettlement],
    ['Construction Start',          kd.constructionStart],
    ['Construction Completion',     kd.constructionCompletion],
    ['Sales Commencement',          kd.salesCommencement],
    ['Sales Settlement Completed',  kd.salesSettlementCompleted],
    ['Project Duration',            `${kd.projectDurationMonths} months`],
    ['Construction Duration',       `${kd.constructionTimeMonths} months`],
    ['Land to Settlement',          `${kd.landToSettlementMonths} months`],
  ].map(([l, v]) => [l as string, v as string | number]), row);

  // ── Equity Returns ──
  row = writeSection(ws, 'EQUITY RETURNS — TOTAL', [
    ['Equity Contributed',     equityReturns.total.totalEquityContributed],
    ['IRR',                    equityReturns.total.irr],
    ['Profit Share',           equityReturns.total.totalProfitShare],
    ['Profit Share %',         equityReturns.total.profitSharePercent],
    ['Equity Repatriation',    equityReturns.total.totalEquityRepatriation],
  ].map(([l, v]) => [l as string, v as number]), row);

  // ── GRV Summary ──
  const { grvSummary } = data;
  row = writeSection(ws, 'GRV SUMMARY', [
    ['Total Apartment GRV',    grvSummary.totalApartmentGRV],
    ['GRV Sold / Exchanged',   grvSummary.grvSoldExchanged],
    ['Unsold GRV',             grvSummary.unsoldGRV],
  ].map(([l, v]) => [l as string, v as number]), row);
  const grvSt = row - 4;
  for (let r2 = grvSt + 1; r2 <= grvSt + 3; r2++) ws.getRow(r2).getCell(2).numFmt = CURRENCY_FMT;
}

// ── Main export function ─────────────────────────────────────────────────────

/**
 * exportToExcel
 * Generates a formatted .xlsx workbook with two sheets:
 *   1. "Cashflow"  — period-by-period cashflow matching the app table
 *   2. "Summary"   — feasibility summary, KPIs, capital stack, debt, dates
 *
 * The file is automatically downloaded via FileSaver.
 */
export async function exportToExcel(
  data: DashboardData,
  _admin: AdminConfig,
  projectName = 'Feasibility',
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Feasibility Model';
  wb.created  = new Date();
  wb.modified = new Date();

  // ── Sheet 1: Cashflow ──
  const wsCashflow = wb.addWorksheet('Cashflow', {
    views: [],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    properties: { tabColor: { argb: 'FF' + CLR.net } },
  });
  buildCashflowSheet(wsCashflow, data.cashflows);

  // ── Sheet 2: Summary ──
  const wsSummary = wb.addWorksheet('Summary', {
    properties: { tabColor: { argb: 'FF' + CLR.summaryHdr } },
  });
  buildSummarySheet(wsSummary, data, projectName);

  // ── Serialise and download ──
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const timestamp = new Date().toISOString().slice(0, 10);
  saveAs(blob, `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.xlsx`);
}
