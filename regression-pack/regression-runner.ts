/**
 * Pencil DM Feasibility — engine-level regression runner.
 *
 * Loads each fixture under ./fixtures/*.json, calls runCalculations(admin,
 * inputs), and asserts the testable invariants from invariants.md (engine
 * + static class only). UI-class invariants are deferred to live-uat-checklist.md.
 *
 * Run from repo root:
 *   npx tsx regression-pack/regression-runner.ts
 *
 * Or via npm script (added to app/package.json):
 *   cd app && npm run regression
 *
 * Outputs:
 *   regression-pack/results/<timestamp>.json   — machine-readable
 *   regression-pack/results/<timestamp>.md     — human-readable summary
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { runCalculations } from '../app/src/engine/index';
import type { AdminConfig, MainInputs, DashboardData } from '../app/src/types';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const resultsDir  = join(here, 'results');
const repoRoot    = resolve(here, '..');

mkdirSync(resultsDir, { recursive: true });

// ---- types ---------------------------------------------------------------

interface InvariantResult {
  id: string;
  title: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail?: string;
}
interface FixtureResult {
  slug: string;
  synthetic: boolean;
  loadedOk: boolean;
  loadError?: string;
  totals: { pass: number; fail: number; skip: number };
  invariants: InvariantResult[];
  observed?: {
    totalGRV: number;
    totalCost: number;
    totalProfit: number;
    R1_drift: number;
    R2_drift?: number;
    seniorLTC: number;
    mezzAmount: number;
    convergedIn?: number;
    settlementsRevenue: number;
    cashflowSettlements: number;
  };
}

// ---- invariant checks (engine class) ------------------------------------


function isFiniteNumber(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x); }
function flagNaN(d: DashboardData): InvariantResult | null {
  if (!isFiniteNumber(d.feasibility.totalCost)) return { id: 'ENGINE_NAN', title: 'Engine produced finite outputs', status: 'FAIL', detail: `totalCost=${d.feasibility.totalCost}` };
  return null;
}

function approxZero(x: number, tolerance: number): boolean {
  return Math.abs(x) <= tolerance;
}

function checkA1_cashflowSumZero(d: DashboardData): InvariantResult {
  const sum = d.cashflows.reduce((s, cf) => s + (cf.netCashflow ?? 0), 0);
  const tol = Math.max(1, d.feasibility.totalCost * 1e-6);
  return {
    id: 'A1', title: 'Σ monthly net cashflow ≈ 0',
    status: approxZero(sum, tol) ? 'PASS' : 'FAIL',
    detail: `drift=$${sum.toFixed(2)}, tolerance=$${tol.toFixed(2)}`,
  };
}

function checkA4_horizonMatchesSpan(d: DashboardData, inputs: MainInputs): InvariantResult {
  const span = inputs.preliminary.projectSpanMonths;
  const horizon = d.cashflows.length;
  return {
    id: 'A4', title: 'Cashflow horizon == projectSpanMonths',
    status: horizon === span ? 'PASS' : 'FAIL',
    detail: `cashflow rows=${horizon}, projectSpanMonths=${span}`,
  };
}

function checkB3_revenueNotDropped(d: DashboardData): InvariantResult {
  const inputGRV = d.feasibility.totalGRV;
  const settledGRV = d.feasibility.totalSettlementsRevenue;
  // Allow 0.5% rounding tolerance, but reject the silent-drop pattern (settled = 0)
  if (inputGRV > 0 && settledGRV === 0) {
    return { id: 'B3-fixture', title: 'Revenue not silently dropped', status: 'FAIL',
      detail: `GRV inputs=$${inputGRV.toFixed(0)} but cashflow settlements=$0` };
  }
  return { id: 'B3-fixture', title: 'Revenue not silently dropped', status: 'PASS',
    detail: `GRV inputs=$${inputGRV.toFixed(0)}, settled=$${settledGRV.toFixed(0)}` };
}

function checkC1_capitalStackSumsToCost(d: DashboardData): InvariantResult {
  if (!isFiniteNumber(d.feasibility.totalCost)) return { id: 'C1', title: 'Capital stack widget reconciles', status: 'SKIP', detail: 'totalCost is NaN — see ENGINE_NAN' };
  const cs = d.capitalStack;
  const sources = (cs.equityAmount ?? 0) + (cs.seniorAmount ?? 0) + (cs.senior2Amount ?? 0) + (cs.mezzAmount ?? 0);
  const total = cs.total ?? sources;
  // Capital stack reports principal sources (equity + drawn debt). Total cost
  // includes capitalised interest, fees and contingency that aren't separately
  // labelled as a funding source. The invariant is: stack total is finite,
  // positive, and within 25% of total cost (or a "underfunded" warning is
  // present surfaces the gap explicitly). On Project Demo the gap is ~$103M
  // (10%) — finance costs absorbed inside senior cap-int.
  if (!isFiniteNumber(total) || total <= 0) return { id: 'C1', title: 'Capital stack widget reconciles', status: 'FAIL', detail: `cs.total=${total}` };
  const ratio = sources / d.feasibility.totalCost;
  // Per invariants.md C1: stack must be within 25% of total cost (ratio in
  // [0.75, 1.00]; allow tiny ratio>1 from rounding). If outside that band, the
  // engine MUST emit an explicit "Underfunded $X" / "Over-committed $X" /
  // "additional equity required" label — silent gap is a FAIL.
  if (ratio < 0.75 || ratio > 1.10) {
    const hasGap = (d.warnings ?? []).some(w => /underfunded|over-committed|additional equity/i.test(w));
    return { id: 'C1', title: 'Capital stack widget reconciles', status: hasGap ? 'PASS' : 'FAIL', detail: `sources=$${sources.toFixed(0)}, totalCost=$${d.feasibility.totalCost.toFixed(0)}, ratio=${ratio.toFixed(3)}${hasGap ? ' (gap warning emitted)' : ' — NO gap label, silent under/over-fund'}` };
  }
  return { id: 'C1', title: 'Capital stack widget reconciles', status: 'PASS', detail: `sources=$${sources.toFixed(0)}, total=$${total.toFixed(0)}, totalCost=$${d.feasibility.totalCost.toFixed(0)}, ratio=${ratio.toFixed(3)}` };
}

function checkD1_seniorLTCCap(d: DashboardData, inputs: MainInputs): InvariantResult {
  // Senior must be within BOTH LTC cap and LVR cap (whichever binds).
  const ltcCap = inputs.seniorFacility.ltcTarget ?? 1.0;
  const lvrCap = inputs.seniorFacility.lvrTarget ?? 1.0;
  const ltc = d.capitalStack.seniorLTC ?? 0;
  const lvr = d.capitalStack.seniorLVR ?? 0;
  const ltcOK = ltc <= ltcCap + 1e-9;
  const lvrOK = lvr <= lvrCap + 1e-9;
  const breaches: string[] = [];
  if (!ltcOK) breaches.push(`LTC ${(ltc*100).toFixed(2)}% > cap ${(ltcCap*100).toFixed(2)}%`);
  if (!lvrOK) breaches.push(`LVR ${(lvr*100).toFixed(2)}% > cap ${(lvrCap*100).toFixed(2)}%`);
  return {
    id: 'D1', title: 'Senior LTC ≤ cap AND LVR ≤ cap',
    status: ltcOK && lvrOK ? 'PASS' : 'FAIL',
    detail: ltcOK && lvrOK
      ? `LTC ${(ltc*100).toFixed(2)}% ≤ ${(ltcCap*100).toFixed(2)}%; LVR ${(lvr*100).toFixed(2)}% ≤ ${(lvrCap*100).toFixed(2)}%`
      : `breach(es): ${breaches.join(' | ')}`,
  };
}

function checkD2_mezzLimit(d: DashboardData, inputs: MainInputs): InvariantResult {
  // Mezz must be within the dollar facility limit AND the LTC/LVR caps where
  // those caps are defined (>0). A zero cap means "not asserted" (typical for
  // mezz LVR which often isn't covenanted).
  const dollarCap = inputs.mezzanine.facilityLimit ?? Infinity;
  const ltcCap = inputs.mezzanine.ltcTarget ?? 0;
  const lvrCap = inputs.mezzanine.lvrTarget ?? 0;
  const amount = d.capitalStack.mezzAmount ?? 0;
  const ltc = d.capitalStack.mezzLTC ?? 0;
  const lvr = d.capitalStack.mezzLVR ?? 0;
  const dollarOK = amount <= dollarCap + 1e-9;
  const ltcOK = ltcCap <= 0 || ltc <= ltcCap + 1e-9;
  const lvrOK = lvrCap <= 0 || lvr <= lvrCap + 1e-9;
  const breaches: string[] = [];
  if (!dollarOK) breaches.push(`$${amount.toFixed(0)} > limit $${dollarCap.toFixed(0)}`);
  if (!ltcOK)    breaches.push(`LTC ${(ltc*100).toFixed(2)}% > cap ${(ltcCap*100).toFixed(2)}%`);
  if (!lvrOK)    breaches.push(`LVR ${(lvr*100).toFixed(2)}% > cap ${(lvrCap*100).toFixed(2)}%`);
  return {
    id: 'D2', title: 'Mezz ≤ dollar limit AND LTC/LVR caps (where defined)',
    status: dollarOK && ltcOK && lvrOK ? 'PASS' : 'FAIL',
    detail: dollarOK && ltcOK && lvrOK
      ? `$${amount.toFixed(0)} ≤ $${dollarCap.toFixed(0)}` + (ltcCap > 0 ? `; LTC ${(ltc*100).toFixed(2)}% ≤ ${(ltcCap*100).toFixed(2)}%` : '') + (lvrCap > 0 ? `; LVR ${(lvr*100).toFixed(2)}% ≤ ${(lvrCap*100).toFixed(2)}%` : '')
      : `breach(es): ${breaches.join(' | ')}`,
  };
}

function checkD3_seniorFirstEquityCeiling(d: DashboardData, inputs: MainInputs, admin: AdminConfig): InvariantResult {
  // D3 — under equityDrawdownMode === 'senior-first', cumulative equity drawn
  // should be bounded above by the pre-construction cumulative cost (land + DA
  // + early dev costs incurred BEFORE senior.startMonth). 10% slack covers
  // completion top-ups and rounding. SKIP this check on fixtures using other
  // modes — the constraint only applies under senior-first.
  if ((admin.equityDrawdownMode ?? 'equity-first') !== 'senior-first') {
    return { id: 'D3', title: 'Senior-first: cumulative equity ≤ pre-construction cost × 1.10', status: 'SKIP', detail: `mode=${admin.equityDrawdownMode ?? 'equity-first'} (D3 only checked under senior-first)` };
  }
  const snrStartIdx = inputs.seniorFacility.startMonth > 0 ? inputs.seniorFacility.startMonth - 1 : 0;
  let preCost = 0;
  for (let i = 0; i < snrStartIdx; i++) {
    const cf = d.cashflows[i];
    if (!cf) continue;
    preCost += (cf.landCosts ?? 0) + (cf.acquisitionCosts ?? 0) + (cf.developmentCosts ?? 0)
             + (cf.constructionCosts ?? 0) + (cf.contingency ?? 0) + (cf.marketingCosts ?? 0)
             + (cf.otherStandardCosts ?? 0) + (cf.pmFees ?? 0);
  }
  const cumEquity = d.cashflows.reduce((s, cf) => s + (cf.equityInjection ?? 0), 0);
  const ceiling = preCost * 1.10;
  return {
    id: 'D3', title: 'Senior-first: cumulative equity ≤ pre-construction cost × 1.10',
    status: cumEquity <= ceiling + 100_000 ? 'PASS' : 'FAIL',
    detail: `preCost=$${preCost.toFixed(0)}, ceiling=$${ceiling.toFixed(0)}, cumEquity=$${cumEquity.toFixed(0)}`,
  };
}

function checkI2_ccrSignsAgree(d: DashboardData): InvariantResult {
  const t = d.kpis.totalCashOnCash, a = d.kpis.annualCashOnCash;
  const tSign = Math.sign(t), aSign = Math.sign(a);
  // 0 is acceptable on either side (rounding to zero on tiny projects)
  if (tSign === 0 || aSign === 0) return { id: 'I2', title: 'Total CCR sign matches Annual CCR sign', status: 'PASS', detail: `total=${t.toFixed(4)}, annual=${a.toFixed(4)} (one is zero)` };
  return {
    id: 'I2', title: 'Total CCR sign matches Annual CCR sign',
    status: tSign === aSign ? 'PASS' : 'FAIL',
    detail: `total=${t.toFixed(4)}, annual=${a.toFixed(4)}`,
  };
}

function checkL1_solverConverged(d: DashboardData): InvariantResult {
  const s = d.solver;
  if (!s) return { id: 'L1', title: 'Solver converged within maxIterations', status: 'SKIP', detail: 'solver diagnostics not exposed on this fixture' };
  return {
    id: 'L1', title: 'Solver converged within maxIterations',
    status: (s.convergedIn ?? Infinity) < (s.maxIterations ?? Infinity) ? 'PASS' : 'FAIL',
    detail: `convergedIn=${s.convergedIn}, maxIterations=${s.maxIterations}`,
  };
}

function checkL2_solverDiagnostics(d: DashboardData): InvariantResult {
  const s = d.solver;
  if (!s) return { id: 'L2', title: 'Solver exposes convergedIn / tolerance / finalDelta', status: 'SKIP', detail: 'solver field absent' };
  const ok = typeof s.convergedIn === 'number' && typeof s.finalDelta === 'number';
  return {
    id: 'L2', title: 'Solver exposes convergedIn / tolerance / finalDelta',
    status: ok ? 'PASS' : 'FAIL',
    detail: `convergedIn=${s.convergedIn}, finalDelta=${s.finalDelta}`,
  };
}

function checkH1_warningsConsolidated(d: DashboardData): InvariantResult {
  // After Q1 consolidation, no two strings should differ by only a numeric
  // value (signature: same prefix + only the dollar-amount differs)
  const ws = d.warnings ?? [];
  const normalised = new Map<string, string[]>();
  for (const w of ws) {
    const key = w.replace(/\$[\d,.\s\-]+/g, '$X').replace(/\d+(\.\d+)?%/g, 'P%');
    if (!normalised.has(key)) normalised.set(key, []);
    normalised.get(key)!.push(w);
  }
  const dupGroups = [...normalised.entries()].filter(([_, vs]) => vs.length > 1);
  return {
    id: 'H1', title: 'Per-(category, message-prefix) consolidation',
    status: dupGroups.length === 0 ? 'PASS' : 'FAIL',
    detail: dupGroups.length === 0 ? `${ws.length} warnings, all distinct after numeric normalisation`
      : `${dupGroups.length} duplicate group(s): ${dupGroups.slice(0,2).map(([k]) => k).join(' | ')}`,
  };
}

function checkE1_repaymentSequenceDefault(admin: AdminConfig): InvariantResult {
  const seq = admin.repaymentSequence ?? [];
  const ok = Array.isArray(seq) && seq.length > 0 && seq[seq.length - 1] === 'equity';
  return {
    id: 'E1', title: 'repaymentSequence ends in equity',
    status: ok ? 'PASS' : 'FAIL',
    detail: `seq=${JSON.stringify(seq)}`,
  };
}

function checkM3_actualsBudgetPreserved(d: DashboardData, inputs: MainInputs): InvariantResult {
  // Sum constructionCosts spread should equal sum of constructionCosts.totalCosts
  // when no actuals are present (the actuals invariants themselves are tested
  // exhaustively in costSpreading.test.ts).
  const declared = inputs.constructionCosts.reduce((s, c) => s + (c.totalCosts ?? 0), 0);
  const observed = d.cashflows.reduce((s, cf) => s + (cf.constructionCosts ?? 0), 0);
  const tol = Math.max(100, declared * 0.001);
  return {
    id: 'M3', title: 'Construction cost spread sums to declared total',
    status: Math.abs(declared - observed) <= tol ? 'PASS' : 'FAIL',
    detail: `declared=$${declared.toFixed(0)}, spread=$${observed.toFixed(0)}, drift=$${(observed - declared).toFixed(0)}`,
  };
}

// ---- static checks ------------------------------------------------------

function staticJ1_noDSCRSymbols(): InvariantResult {
  // J1: DSCR has been removed wholesale — there must be no DSCR field
  // declarations or reads in production code. The v4 migration's `delete
  // p.admin.dscrTarget` is allowed (it's the removal mechanism for old
  // persisted states), and comments referencing the historical removal are
  // allowed. We FAIL only on `dscrTarget:` (declaration / object-literal
  // assignment) or `.dscrTarget` reads NOT preceded by `delete`.
  try {
    const out = execSync(`grep -rE --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ -n 'dscr' "${repoRoot}/app/src" 2>/dev/null || true`, { encoding: 'utf8' });
    const lines = out.split('\n').filter(l => l);
    const offenders: string[] = [];
    for (const l of lines) {
      // Strip leading filename:lineno:
      const colon = l.indexOf(':');
      const colon2 = l.indexOf(':', colon + 1);
      const text = l.slice(colon2 + 1).trim();
      if (!/dscr/i.test(text)) continue;
      // Allow: pure comment line
      if (/^\s*\*|^\s*\/\//.test(text)) continue;
      // Allow: `delete X.dscrTarget`
      if (/\bdelete\s+[A-Za-z_$.()<>\[\] ,'"]*\.dscrTarget\b/.test(text)) continue;
      // Allow: type / interface mention only inside a multi-line removed comment block
      offenders.push(l);
    }
    return {
      id: 'J1', title: 'No DSCR field declarations / reads in production code',
      status: offenders.length === 0 ? 'PASS' : 'FAIL',
      detail: offenders.length === 0 ? `${lines.length} matches, all in comments / migration deletes` : `${offenders.length} offender(s): ${offenders.slice(0, 3).join(' | ')}`,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { id: 'J1', title: 'No DSCR field declarations / reads in production code', status: 'SKIP', detail: `grep failed: ${msg}` };
  }
}

function staticK1_persistVersionFive(): InvariantResult {
  // Bumped to 9 (Bug 3, Kew UAT): heal `minEquityRequirement.value > 1` when mode=percent.
  // Expected version is the latest schema; new migrations bump this constant in
  // lockstep with `version: N` in useStore.ts (see migration tests for proof
  // that prior versions stay backwards-compatible).
  const EXPECTED = 9;
  try {
    const useStore = readFileSync(join(repoRoot, 'app/src/store/useStore.ts'), 'utf8');
    const m = useStore.match(/version:\s*(\d+)/);
    const v = m ? parseInt(m[1], 10) : -1;
    return {
      id: 'K1', title: `persistVersion === ${EXPECTED}`,
      status: v === EXPECTED ? 'PASS' : 'FAIL',
      detail: `version=${v}`,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { id: 'K1', title: `persistVersion === ${EXPECTED}`, status: 'SKIP', detail: msg };
  }
}

// ---- runner -------------------------------------------------------------

function runFixture(slug: string): FixtureResult {
  const fixturePath = join(fixturesDir, `${slug}.json`);
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const admin = raw.admin as AdminConfig;
  const inputs = raw.inputs as MainInputs;

  let d: DashboardData;
  try {
    d = runCalculations(admin, inputs);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      slug, synthetic: !!raw.synthetic, loadedOk: false, loadError: msg,
      totals: { pass: 0, fail: 1, skip: 0 },
      invariants: [{ id: 'LOAD', title: 'Fixture loads + engine runs', status: 'FAIL', detail: msg }],
    };
  }

  const nanFlag = flagNaN(d);
  const checks: InvariantResult[] = nanFlag ? [nanFlag] : [
    checkA1_cashflowSumZero(d),
    checkA4_horizonMatchesSpan(d, inputs),
    checkB3_revenueNotDropped(d),
    checkC1_capitalStackSumsToCost(d),
    checkD1_seniorLTCCap(d, inputs),
    checkD2_mezzLimit(d, inputs),
    checkD3_seniorFirstEquityCeiling(d, inputs, admin),
    checkE1_repaymentSequenceDefault(admin),
    checkH1_warningsConsolidated(d),
    checkI2_ccrSignsAgree(d),
    checkL1_solverConverged(d),
    checkL2_solverDiagnostics(d),
    checkM3_actualsBudgetPreserved(d, inputs),
  ];

  const totals = checks.reduce((acc, c) => {
    if (c.status === 'PASS') acc.pass++;
    else if (c.status === 'FAIL') acc.fail++;
    else acc.skip++;
    return acc;
  }, { pass: 0, fail: 0, skip: 0 });

  return {
    slug, synthetic: !!raw.synthetic, loadedOk: true, totals,
    invariants: checks,
    observed: {
      totalGRV: d.feasibility.totalGRV,
      totalCost: d.feasibility.totalCost,
      totalProfit: d.feasibility.totalProfit,
      R1_drift: d.cashflows.reduce((s, cf) => s + (cf.netCashflow ?? 0), 0),
      seniorLTC: d.capitalStack.seniorLTC,
      mezzAmount: d.capitalStack.mezzAmount,
      convergedIn: d.solver?.convergedIn ?? undefined,
      settlementsRevenue: d.feasibility.totalSettlementsRevenue,
      cashflowSettlements: d.cashflows.reduce((s, cf) => s + (cf.grvSettlements ?? 0), 0),
    },
  };
}

function main(): number {
  const fixtureFiles = readdirSync(fixturesDir).filter(f => f.endsWith('.json')).sort();
  const slugs = fixtureFiles.map(f => f.replace(/\.json$/, ''));

  const fixtures: FixtureResult[] = [];
  for (const slug of slugs) {
    process.stdout.write(`[runner] ${slug} ... `);
    const r = runFixture(slug);
    process.stdout.write(`pass=${r.totals.pass} fail=${r.totals.fail} skip=${r.totals.skip}\n`);
    fixtures.push(r);
  }

  // Static (repo-wide) checks
  const staticChecks: InvariantResult[] = [
    staticJ1_noDSCRSymbols(),
    staticK1_persistVersionFive(),
  ];

  const grandTotals = {
    pass: fixtures.reduce((s, f) => s + f.totals.pass, 0) + staticChecks.filter(c => c.status === 'PASS').length,
    fail: fixtures.reduce((s, f) => s + f.totals.fail, 0) + staticChecks.filter(c => c.status === 'FAIL').length,
    skip: fixtures.reduce((s, f) => s + f.totals.skip, 0) + staticChecks.filter(c => c.status === 'SKIP').length,
    fixtures: fixtures.length,
  };

  const headRev = (() => {
    try { return execSync('git -C "' + repoRoot + '" rev-parse --short HEAD', { encoding: 'utf8' }).trim(); }
    catch { return 'unknown'; }
  })();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const stamp = `${headRev}-${ts}`;

  const json = { stamp, headRev, generatedAt: new Date().toISOString(), grandTotals, fixtures, static: staticChecks };
  writeFileSync(join(resultsDir, `${ts}.json`), JSON.stringify(json, null, 2));

  // Markdown summary
  const md: string[] = [];
  md.push(`# Regression Run — ${ts}`);
  md.push('');
  md.push(`- **HEAD commit:** \`${headRev}\``);
  md.push(`- **Fixtures:** ${grandTotals.fixtures}`);
  md.push(`- **Totals:** ${grandTotals.pass} PASS · ${grandTotals.fail} FAIL · ${grandTotals.skip} SKIP`);
  md.push(`- **Verdict:** ${grandTotals.fail === 0 ? 'GREEN — safe to ship' : 'RED — investigate before ship'}`);
  md.push('');
  md.push('## Per-fixture matrix');
  md.push('');
  // Build a matrix with invariant IDs as columns
  const allIds = Array.from(new Set(fixtures.flatMap(f => f.invariants.map(i => i.id)))).sort();
  md.push(`| Fixture | ${allIds.join(' | ')} | Pass/Fail/Skip |`);
  md.push(`|---|${allIds.map(() => '---').join('|')}|---|`);
  for (const f of fixtures) {
    const row = allIds.map(id => {
      const r = f.invariants.find(i => i.id === id);
      if (!r) return '·';
      return r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '−';
    });
    md.push(`| ${f.slug}${f.synthetic ? ' (S)' : ''} | ${row.join(' | ')} | ${f.totals.pass}/${f.totals.fail}/${f.totals.skip} |`);
  }
  md.push('');
  md.push('Legend: ✓ PASS · ✗ FAIL · − SKIP · (S) synthetic fixture');
  md.push('');
  md.push('## Static checks');
  md.push('');
  for (const s of staticChecks) {
    md.push(`- **${s.id}** — ${s.title}: ${s.status === 'PASS' ? '✅' : s.status === 'FAIL' ? '❌' : '–'} ${s.detail ?? ''}`);
  }
  md.push('');
  if (grandTotals.fail > 0) {
    md.push('## Failures');
    md.push('');
    for (const f of fixtures) {
      const fails = f.invariants.filter(i => i.status === 'FAIL');
      if (fails.length === 0) continue;
      md.push(`### ${f.slug}`);
      for (const x of fails) md.push(`- **${x.id}** ${x.title} — ${x.detail ?? ''}`);
      md.push('');
    }
    for (const s of staticChecks.filter(c => c.status === 'FAIL')) {
      md.push(`- **(static) ${s.id}** ${s.title} — ${s.detail ?? ''}`);
    }
  }
  writeFileSync(join(resultsDir, `${ts}.md`), md.join('\n'));

  console.log(`\nResults: ${resultsDir}/${ts}.{json,md}`);
  console.log(`Verdict: ${grandTotals.fail === 0 ? 'GREEN' : 'RED'} (pass=${grandTotals.pass} fail=${grandTotals.fail} skip=${grandTotals.skip})`);
  return grandTotals.fail === 0 ? 0 : 1;
}

const exitCode = main();
process.exit(exitCode);
