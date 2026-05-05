/**
 * Sensitivity analysis framework.
 *
 * Runs the feasibility engine across a grid of input variations and returns
 * the impact on headline KPIs (profit, IRR, CoC). Designed for scenario
 * comparison and tornado chart rendering on the dashboard.
 */
import type { AdminConfig, MainInputs, DashboardData } from '../types';
import { runCalculations } from './index';

export interface SensitivityResult {
  variable: string;
  delta: number;        // Applied variation (e.g. -0.05 = -5%)
  deltaLabel: string;   // Human-readable label
  totalProfit: number;
  irr: number;
  cashOnCash: number;
  roi: number;
  peakDebt: number;
}

export interface SensitivityOutput {
  base: SensitivityResult;
  scenarios: SensitivityResult[];
}

export type SensitivityLever =
  | 'constructionCost'
  | 'grvPrice'
  | 'constructionContingency'
  | 'seniorMargin'
  | 'timeline';

/** Standard deltas for a tornado-chart style sensitivity run. */
export const STANDARD_DELTAS = [-0.10, -0.05, 0.05, 0.10];

function cloneInputs(inputs: MainInputs): MainInputs {
  return JSON.parse(JSON.stringify(inputs));
}

/**
 * Apply a single lever adjustment to a cloned inputs object and return it.
 * Does not mutate the source.
 */
export function applyLever(inputs: MainInputs, lever: SensitivityLever, delta: number): MainInputs {
  const next = cloneInputs(inputs);
  const factor = 1 + delta;
  switch (lever) {
    case 'constructionCost':
      next.constructionCosts = next.constructionCosts.map(c => ({
        ...c, totalCosts: c.totalCosts * factor, baseRate: c.baseRate * factor,
      }));
      break;
    case 'grvPrice':
      next.grvItems = next.grvItems.map(g => ({
        ...g, currentSalePrice: g.currentSalePrice * factor,
      }));
      break;
    case 'constructionContingency':
      next.constructionContingencyPercent = next.constructionContingencyPercent * factor;
      break;
    case 'seniorMargin':
      if (next.seniorFacility) {
        next.seniorFacility = { ...next.seniorFacility,
          margin: next.seniorFacility.margin * factor };
      }
      break;
    case 'timeline': {
      // Extend/compress construction span; shift settlement by the same delta
      const shift = Math.round((next.preliminary.projectSpanMonths ?? 0) * delta);
      next.preliminary = { ...next.preliminary,
        projectSpanMonths: next.preliminary.projectSpanMonths + shift,
        projectEndMonth: next.preliminary.projectEndMonth + shift };
      next.constructionCosts = next.constructionCosts.map(c => ({
        ...c, monthSpan: Math.max(1, c.monthSpan + shift) }));
      next.grvItems = next.grvItems.map(g => ({ ...g,
        settlementMonth: g.settlementMonth + shift }));
      break;
    }
  }
  return next;
}

function extractResult(variable: string, delta: number, data: DashboardData): SensitivityResult {
  return {
    variable,
    delta,
    deltaLabel: `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`,
    totalProfit: data.feasibility.totalProfit,
    irr: data.kpis.irr,
    cashOnCash: data.kpis.totalCashOnCash,
    roi: data.kpis.roi,
    peakDebt: data.peakExposure.peakDebt,
  };
}

/**
 * Run sensitivity analysis across the given levers and deltas.
 * Returns base case plus scenarios, suitable for tornado charts.
 */
export function runSensitivity(
  admin: AdminConfig,
  inputs: MainInputs,
  levers: SensitivityLever[],
  deltas: number[] = STANDARD_DELTAS,
): SensitivityOutput {
  const base = runCalculations(admin, inputs);
  const scenarios: SensitivityResult[] = [];

  for (const lever of levers) {
    for (const delta of deltas) {
      if (delta === 0) continue;
      const varied = applyLever(inputs, lever, delta);
      const result = runCalculations(admin, varied);
      scenarios.push(extractResult(lever, delta, result));
    }
  }

  return {
    base: extractResult('base', 0, base),
    scenarios,
  };
}

/**
 * Compute NPV of an equity cashflow stream at the given annual discount rate.
 */
export function calculateNPV(monthlyEquityCF: number[], annualRate: number): number {
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  let npv = 0;
  for (let t = 0; t < monthlyEquityCF.length; t++) {
    npv += (monthlyEquityCF[t] ?? 0) / Math.pow(1 + monthlyRate, t);
  }
  return npv;
}
