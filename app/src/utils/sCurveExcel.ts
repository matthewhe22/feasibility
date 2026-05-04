/**
 * sCurveExcel.ts
 * Download an S-curve template as an Excel workbook and parse an uploaded
 * workbook back into the admin store's manualSCurves / buildSCurves.
 *
 * Template layout (two sheets):
 *   "Manual S-Curves"  — columns: Month | Manual S-curve 1 | 2 | 3
 *   "Build S-Curves"   — columns: Month | 12 Month Build | 13 Month Build | … | 60 Month Build
 *
 * Upload supports either sheet independently; whichever sheets are present
 * are parsed and merged into the existing admin config.
 */

import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { AdminConfig } from '../types';

// ─── Styling helpers ──────────────────────────────────────────────────────────

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FF1D4ED8' }, // blue-700
};
const EDITABLE_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FFFEF9C3' }, // yellow-100
};
const REF_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FFE5E7EB' }, // gray-200
};
const BORDER: Partial<ExcelJS.Borders> = {
  top:    { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left:   { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right:  { style: 'thin', color: { argb: 'FFD1D5DB' } },
};

function styleHeader(cell: ExcelJS.Cell) {
  cell.fill = HEADER_FILL;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
  cell.border = BORDER;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function styleRef(cell: ExcelJS.Cell) {
  cell.fill = REF_FILL;
  cell.font = { bold: true, size: 9 };
  cell.border = BORDER;
  cell.alignment = { horizontal: 'center' };
}

function styleEditable(cell: ExcelJS.Cell) {
  cell.fill = EDITABLE_FILL;
  cell.font = { size: 9 };
  cell.border = BORDER;
  cell.numFmt = '0.000000';
  cell.alignment = { horizontal: 'right' };
}

// ─── Manual S-Curves sheet ────────────────────────────────────────────────────

function buildManualSheet(
  wb: ExcelJS.Workbook,
  manualSCurves: number[][],
  totalPeriods: number,
): void {
  const ws = wb.addWorksheet('Manual S-Curves', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
  });

  // Row 1: instruction banner
  ws.addRow(['Enter monthly weights in yellow cells. Values are normalised automatically — percentages summing to 100 are recommended.']);
  ws.mergeCells(1, 1, 1, 4);
  const instrCell = ws.getCell(1, 1);
  instrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
  instrCell.font = { bold: true, size: 9, color: { argb: 'FF92400E' } };
  instrCell.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(1).height = 18;

  // Row 2: column headers
  const headers = ['Month', 'Manual S-curve 1', 'Manual S-curve 2', 'Manual S-curve 3'];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => styleHeader(cell));
  headerRow.height = 20;

  // Column widths
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 18;

  // Data rows
  for (let m = 0; m < totalPeriods; m++) {
    const row = ws.addRow([
      m + 1,
      manualSCurves[0]?.[m] ?? 0,
      manualSCurves[1]?.[m] ?? 0,
      manualSCurves[2]?.[m] ?? 0,
    ]);
    styleRef(row.getCell(1));
    styleEditable(row.getCell(2));
    styleEditable(row.getCell(3));
    styleEditable(row.getCell(4));
    row.height = 14;
  }

  // Sum row
  const sumRow = ws.addRow(['Sum', '', '', '']);
  for (let c = 2; c <= 4; c++) {
    const cell = sumRow.getCell(c);
    cell.value = { formula: `SUM(${ws.getColumn(c).letter}3:${ws.getColumn(c).letter}${2 + totalPeriods})` } as ExcelJS.CellFormulaValue;
    cell.numFmt = '0.00';
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    cell.font = { bold: true, size: 9 };
    cell.border = BORDER;
    cell.alignment = { horizontal: 'right' };
  }
  sumRow.getCell(1).fill = REF_FILL;
  sumRow.getCell(1).font = { bold: true, size: 9 };
  sumRow.getCell(1).border = BORDER;
  sumRow.height = 16;
}

// ─── Build S-Curves sheet ─────────────────────────────────────────────────────

function buildBuildSheet(
  wb: ExcelJS.Workbook,
  buildSCurves: Record<number, number[]>,
): void {
  const durations = Array.from({ length: 49 }, (_, i) => i + 12); // 12–60
  const maxMonths = 60;
  const totalCols = 1 + durations.length;

  const ws = wb.addWorksheet('Build S-Curves', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
  });

  // Row 1: instruction banner
  ws.addRow(['Enter monthly weights in yellow cells. Each column is one build duration. Weights are normalised — percentages summing to 100 are recommended. Leave unused months as 0.']);
  ws.mergeCells(1, 1, 1, totalCols);
  const instrCell = ws.getCell(1, 1);
  instrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
  instrCell.font = { bold: true, size: 9, color: { argb: 'FF92400E' } };
  instrCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 24;

  // Row 2: column headers
  const headers = ['Month', ...durations.map(d => `${d} Month Build`)];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => styleHeader(cell));
  headerRow.height = 20;

  // Column widths
  ws.getColumn(1).width = 10;
  for (let c = 2; c <= totalCols; c++) {
    ws.getColumn(c).width = 13;
  }

  // Data rows
  for (let m = 0; m < maxMonths; m++) {
    const rowValues: (number | string)[] = [m + 1];
    for (const d of durations) {
      // Only include the weight if this month falls within the build duration
      if (m < d) {
        rowValues.push(buildSCurves[d]?.[m] ?? 0);
      } else {
        rowValues.push('');
      }
    }
    const row = ws.addRow(rowValues);
    styleRef(row.getCell(1));
    for (let c = 2; c <= totalCols; c++) {
      const dur = durations[c - 2];
      if (m < dur) {
        styleEditable(row.getCell(c));
      } else {
        // Grey out months beyond this build duration
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        row.getCell(c).border = BORDER;
        row.getCell(c).font = { size: 9, color: { argb: 'FFD1D5DB' } };
      }
    }
    row.height = 14;
  }

  // Sum row
  const sumRowValues: (string | ExcelJS.CellFormulaValue)[] = ['Sum'];
  for (let c = 2; c <= totalCols; c++) {
    const colLetter = ws.getColumn(c).letter;
    sumRowValues.push({ formula: `SUM(${colLetter}3:${colLetter}${2 + maxMonths})` } as ExcelJS.CellFormulaValue);
  }
  const sumRow = ws.addRow(sumRowValues);
  sumRow.getCell(1).fill = REF_FILL;
  sumRow.getCell(1).font = { bold: true, size: 9 };
  sumRow.getCell(1).border = BORDER;
  for (let c = 2; c <= totalCols; c++) {
    const cell = sumRow.getCell(c);
    cell.numFmt = '0.00';
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    cell.font = { bold: true, size: 9 };
    cell.border = BORDER;
    cell.alignment = { horizontal: 'right' };
  }
  sumRow.height = 16;
}

// ─── Public: download template ────────────────────────────────────────────────

export async function downloadSCurveTemplate(admin: AdminConfig): Promise<void> {
  const totalPeriods = 74; // standard project span; manual curves use this length

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Feasibility Model';
  wb.created = new Date();

  buildManualSheet(wb, admin.manualSCurves ?? [[], [], []], totalPeriods);
  buildBuildSheet(wb, admin.buildSCurves ?? {});

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const projectName = admin.projectName?.replace(/[^a-z0-9]/gi, '_') || 'project';
  saveAs(blob, `${projectName}_scurves_template.xlsx`);
}

// ─── Public: parse uploaded file ─────────────────────────────────────────────

export interface SCurveParseResult {
  manualSCurves?: number[][];
  buildSCurves?: Record<number, number[]>;
  warnings: string[];
}

export async function parseSCurveFile(file: File): Promise<SCurveParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const warnings: string[] = [];
  let manualSCurves: number[][] | undefined;
  let buildSCurves: Record<number, number[]> | undefined;

  // ── Manual S-Curves sheet ──
  const manualWs = wb.getWorksheet('Manual S-Curves');
  if (manualWs) {
    const curves: number[][] = [[], [], []];
    manualWs.eachRow((row, rowNum) => {
      if (rowNum <= 2) return; // skip instruction + header
      const monthCell = row.getCell(1).value;
      if (monthCell == null || String(monthCell) === 'Sum') return;
      for (let ci = 0; ci < 3; ci++) {
        const v = row.getCell(ci + 2).value;
        const num = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
        curves[ci].push(isNaN(num) ? 0 : Math.max(0, num));
      }
    });
    // Only include curves that have any non-zero data
    const anyData = curves.some(c => c.some(v => v > 0));
    if (anyData) {
      manualSCurves = curves;
    } else {
      warnings.push('Manual S-Curves sheet found but all values are zero — skipped.');
    }
  }

  // ── Build S-Curves sheet ──
  const buildWs = wb.getWorksheet('Build S-Curves');
  if (buildWs) {
    // Parse header row to map column index → duration
    let headerRow: ExcelJS.Row | undefined;
    buildWs.eachRow((row, rowNum) => {
      if (rowNum === 2) headerRow = row;
    });

    if (headerRow) {
      const colMap: { colIdx: number; duration: number }[] = [];
      headerRow.eachCell((cell, colNum) => {
        if (colNum === 1) return;
        const m = String(cell.value ?? '').match(/^(\d+)\s*Month\s*Build$/i);
        if (m) colMap.push({ colIdx: colNum, duration: parseInt(m[1]) });
      });

      if (colMap.length > 0) {
        const curves: Record<number, number[]> = {};
        for (const { duration } of colMap) {
          curves[duration] = [];
        }

        buildWs.eachRow((row, rowNum) => {
          if (rowNum <= 2) return;
          const monthCell = row.getCell(1).value;
          if (monthCell == null || String(monthCell) === 'Sum') return;
          for (const { colIdx, duration } of colMap) {
            const v = row.getCell(colIdx).value;
            const num = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
            curves[duration].push(isNaN(num) ? 0 : Math.max(0, num));
          }
        });

        // Keep only curves with data
        const validCurves: Record<number, number[]> = {};
        for (const { duration } of colMap) {
          if (curves[duration].some(w => w > 0)) {
            // Trim trailing zeros to the actual build duration
            const arr = curves[duration].slice(0, duration);
            validCurves[duration] = arr;
          }
        }

        if (Object.keys(validCurves).length > 0) {
          buildSCurves = validCurves;
        } else {
          warnings.push('Build S-Curves sheet found but all values are zero — skipped.');
        }
      }
    }
  }

  if (!manualWs && !buildWs) {
    throw new Error('No recognised sheets found. Expected "Manual S-Curves" and/or "Build S-Curves".\nPlease use the downloaded template.');
  }

  return { manualSCurves, buildSCurves, warnings };
}
