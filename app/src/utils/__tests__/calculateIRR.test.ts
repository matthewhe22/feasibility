/**
 * Unit tests for calculateIRR (Newton-Raphson + bisection fallback).
 *
 * Covers the previously-untested production IRR routine, with emphasis on the
 * NEGATIVE-IRR case that the old `-rate/2` reflection could not reach (it
 * silently returned 0% for loss-making projects).
 */
import { calculateIRR } from '../index';

let passed = 0, failed = 0;
const failures: string[] = [];
function assertClose(actual: number, expected: number, tol: number, msg: string): void {
  if (Math.abs(actual - expected) <= tol) passed++;
  else { failed++; failures.push(`${msg} (expected ${expected} ±${tol}, got ${actual})`); }
}
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// Helper: monthly rate that an annual IRR implies, to build a cashflow with a
// known root. If monthly rate r gives annual (1+r)^12 - 1.
function annualToMonthly(annual: number): number {
  return Math.pow(1 + annual, 1 / 12) - 1;
}

// 1. Simple positive IRR: -100 at t0, +110 at t1 → monthly 10% → annual ≈ 213.8%
{
  const irr = calculateIRR([-100, 110]);
  const expectedAnnual = Math.pow(1.1, 12) - 1;
  assertClose(irr, expectedAnnual, 1e-4, 'positive IRR: -100, +110 over one month');
}

// 2. Construction-like stream with a known monthly root.
{
  const r = annualToMonthly(0.25); // 25% annual target
  // Build cashflows whose IRR is exactly r: invest 1000, get back at t12.
  const fv = 1000 * Math.pow(1 + r, 12);
  const irr = calculateIRR([-1000, ...Array(11).fill(0), fv]);
  assertClose(irr, 0.25, 1e-4, 'known 25% annual IRR recovered');
}

// 3. NEGATIVE IRR — loss-making project. Invest 1000, only get 800 back at t12.
//    This is the regression case: old code returned 0; must now be negative.
{
  const irr = calculateIRR([-1000, ...Array(11).fill(0), 800]);
  assert(irr < 0, `negative IRR for capital loss returns < 0 (got ${irr})`);
  // Sanity: 800/1000 over 12 months → monthly root, annualised.
  const monthlyRoot = Math.pow(0.8, 1 / 12) - 1;
  const expectedAnnual = Math.pow(1 + monthlyRoot, 12) - 1; // = -0.2
  assertClose(irr, expectedAnnual, 1e-4, 'negative IRR magnitude (≈ -20% annual)');
}

// 4. Mild negative IRR with intermediate cashflows.
{
  const irr = calculateIRR([-500, 100, 100, 100, 100]); // returns 400 < 500
  assert(irr < 0, `mild negative IRR (sum of inflows < outflow) is negative (got ${irr})`);
}

// 5. Edge: empty / all-zero / no sign change → 0.
{
  assert(calculateIRR([]) === 0, 'empty cashflows → 0');
  assert(calculateIRR([0, 0, 0]) === 0, 'all-zero → 0');
  assert(calculateIRR([100, 200, 300]) === 0, 'all-positive (no sign change) → 0');
  assert(calculateIRR([-100, -200]) === 0, 'all-negative (no sign change) → 0');
}

// 6. NPV at the recovered IRR should be ≈ 0 (root quality check).
{
  const cf = [-1000, 300, 400, 500, 200];
  const irr = calculateIRR(cf);
  const monthly = Math.pow(1 + irr, 1 / 12) - 1;
  let npv = 0;
  for (let t = 0; t < cf.length; t++) npv += cf[t]! / Math.pow(1 + monthly, t);
  assertClose(npv, 0, 1e-2, 'NPV at recovered IRR ≈ 0');
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`CALCULATE-IRR TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
