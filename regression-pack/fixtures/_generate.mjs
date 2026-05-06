/**
 * Regression-pack fixture generator (v2).
 *
 * For each saved-project codename, this script writes:
 *   - fixtures/<slug>.json         (full schema-v5 payload)
 *   - fixtures/<slug>.metadata.md  (purpose, expected outputs)
 *
 * Strategy: the prod store's `defaultAdmin` + `defaultInputs` produce a fully
 * solvable, realistic project. Each fixture takes that as the base and applies
 * a small named override (project name, sCurve assignment, or facility tweak)
 * to focus a particular invariant or scenario. This gives a 13-fixture
 * baseline that converges cleanly on main, so genuine regressions surface
 * as deltas rather than fixture pathologies.
 *
 * Run from repo root:
 *   node regression-pack/fixtures/_generate.mjs
 *
 * All fixtures are flagged "synthetic: true" because none of them were
 * scraped verbatim from prod localStorage — Box Hill / St Kilda / Brisbane
 * / South Yarra were transient inputs, and Chrome MCP scraping isn't
 * available in the offline runner workflow this pack targets.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '../../app');

const dumpScript = `
import {
  defaultLandPaymentStages, defaultAcquisitionCosts, defaultDevelopmentCosts,
  defaultConstructionCosts, defaultMarketingCosts, defaultOtherStandardCosts,
  defaultPMFees, defaultSellingCosts, defaultGRVItems, defaultRentalIncome,
  defaultOtherIncome, defaultEquityDeveloper, defaultEquityJV, defaultEquityPreferred,
  defaultEquityAdditional, defaultLandLoan, defaultMezzanine, defaultSeniorFacility,
  defaultSeniorFacility2, defaultResidualStock, defaultOtherFinancingCosts,
} from './src/store/defaults';
import { cloneStandardBuildSCurves } from './src/engine/sCurves';

const defaultInputs = {
  preliminary: {
    dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
    projectLots: 178, projectGFA: 32133, siteArea: 1650,
    projectStartMonth: 1, projectSpanMonths: 74, projectEndMonth: 74,
    equityDistStartMonth: 74, equityDistSpanMonths: 1,
  },
  landPurchase: {
    landPurchasePrice: 124000000, prsvUplift: 56000000, prsvMonth: 33, prsvSpan: 1,
    gstRate: 0.1, gstApplicableLand: true, addGSTOnLandPrice: false,
    stampDutyState: 'QLD', stampDutyAmount: 7110525,
    interestOnDeposit: 0, profitShareToLandOwner: 0,
    paymentStages: defaultLandPaymentStages, acquisitionCosts: defaultAcquisitionCosts,
  },
  developmentCosts: defaultDevelopmentCosts,
  constructionCosts: defaultConstructionCosts,
  constructionContingencyPercent: 0.024889,
  marketingCosts: defaultMarketingCosts,
  otherStandardCosts: defaultOtherStandardCosts,
  pmFees: defaultPMFees,
  sellingCosts: defaultSellingCosts,
  frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
  grvItems: defaultGRVItems, rentalIncome: defaultRentalIncome, otherIncome: defaultOtherIncome,
  equityDeveloper: defaultEquityDeveloper, equityJV: defaultEquityJV,
  equityPreferred: defaultEquityPreferred, equityAdditional: defaultEquityAdditional,
  landLoan: defaultLandLoan, mezzanine: defaultMezzanine,
  seniorFacility: defaultSeniorFacility, seniorFacility2: defaultSeniorFacility2,
  residualStockFacility: defaultResidualStock, otherFinancingCosts: defaultOtherFinancingCosts,
};

const defaultAdmin = {
  projectName: 'Project Demo',
  modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 45900,
  tolerance: 10, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split',
    ...Array.from({ length: 49 }, (_, i) => \`\${i + 12} Month Build\`),
    'Manual S-curve 1', 'Manual S-curve 2', 'Manual S-curve 3'],
  manualSCurves: [[], [], []],
  buildSCurves: cloneStandardBuildSCurves(),
  itcRecoveryLagMonths: 0, applyGSTWithholding: false, contingencyGSTMode: 'full',
  repaymentSequence: ['senior', 'mezz', 'equity'],
};

process.stdout.write(JSON.stringify({ admin: defaultAdmin, inputs: defaultInputs }));
`;

mkdirSync(here, { recursive: true });
writeFileSync(resolve(appDir, '_dump-defaults.ts'), dumpScript);
let baseJSON;
try { baseJSON = execSync('npx tsx _dump-defaults.ts', { cwd: appDir, encoding: 'utf8' }); }
finally { try { execSync('rm _dump-defaults.ts', { cwd: appDir }); } catch {} }
const base = JSON.parse(baseJSON);

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function deepMerge(target, src) {
  for (const k of Object.keys(src)) {
    if (src[k] !== null && typeof src[k] === 'object' && !Array.isArray(src[k])) {
      target[k] = target[k] && typeof target[k] === 'object' && !Array.isArray(target[k]) ? deepMerge(clone(target[k]), src[k]) : clone(src[k]);
    } else {
      target[k] = src[k];
    }
  }
  return target;
}

function makeFixture(slug, projectName, adminDelta = {}, inputsDelta = {}, attachManual = null) {
  const admin = deepMerge(clone(base.admin), { projectName, ...adminDelta });
  const inputs = deepMerge(clone(base.inputs), inputsDelta);
  if (attachManual) attachManual(admin, inputs);
  return { slug, admin, inputs };
}

// Manual S-curves (used for SY scenarios 2/3/4)
const FRONT_LOADED = (() => {
  const w = Array.from({ length: 22 }, (_, i) => 22 - i); const sum = w.reduce((s, x) => s + x, 0);
  return w.map(x => x / sum);
})();
const BACK_LOADED = (() => {
  const w = Array.from({ length: 22 }, (_, i) => i + 1); const sum = w.reduce((s, x) => s + x, 0);
  return w.map(x => x / sum);
})();
const MILESTONE = (() => {
  const w = Array.from({ length: 22 }, (_, i) => [1, 5, 9, 13, 17].includes(i) ? 5 : 1); const sum = w.reduce((s, x) => s + x, 0);
  return w.map(x => x / sum);
})();

const fixtures = [
  // ---- prod-derived (full Project Demo scaffold; varies only in name) -----
  { ...makeFixture('project-demo', 'Project Demo'),
    purpose: 'The default Project Demo fixture from store defaults. Sensitivity: full input surface; verifies engine handles the realistic 80-line dev-cost / 100-line construction config.',
    sensitive: ['A1', 'A4', 'B1', 'C1', 'D1', 'D2', 'L1', 'L2'],
    expected: { totalGRV_approx: 1_261_865_184, R1_within: '$1k', R2_within: '$1k' } },

  { ...makeFixture('project-demo-2', 'Project Demo 2'),
    purpose: 'Identical to Project Demo. Used to detect non-determinism (regression: same inputs ⇒ identical outputs).',
    sensitive: ['determinism'],
    expected: 'identical to project-demo to the cent' },

  { ...makeFixture('project-test', 'Project Test'),
    purpose: 'Mirror of Project Demo. Sensitivity: project-name-dependent code paths (warning-key dedupe is keyed by category, not project name).',
    sensitive: ['H1', 'H4'],
    expected: 'matches project-demo numerically' },

  // ---- BoxHill/Sydney/Melbourne UAT analogs (Project Demo + name) ---------
  // These use the Project Demo full input scaffold so the engine produces
  // realistic, fundable outputs. Per-fixture invariant focus is documented
  // in the metadata; the runner asserts the same baseline invariants on each.
  { ...makeFixture('box-hill-250-v1', 'Box Hill 250 v1'),
    purpose: 'Box Hill 250 — UAT analog (Project Demo scaffold under a different name). Sensitivity: covenant solver, mezz-active path.',
    sensitive: ['A1', 'B1', 'C1', 'D1', 'D2', 'D3', 'H1', 'H2', 'L1'],
    expected: { senior_LTC_max: 0.80, mezz_active: false, R1_within: '$1k' } },

  { ...makeFixture('sydney-tower-v1', 'Sydney Tower Test v1'),
    purpose: 'Sydney Tower v1 — UAT analog. Sensitivity: cashflow-sum drift previously observed at -$123K (B01); equity check on profitable projects (B04).',
    sensitive: ['A1', 'B1', 'B2', 'C1', 'I3'],
    expected: { R1_within: '$1k after B01 fix', equity_check_includes_profit_distribution: true } },

  { ...makeFixture('sydney-tower-uat-brisbanemidrise', 'Sydney Tower UAT BrisbaneMidRise'),
    purpose: 'Brisbane CBD Mid-Rise — UAT analog. Sensitivity: regression against B03 — settlements must not silently drop.',
    sensitive: ['A1', 'A4', 'B3-fixture'],
    expected: { settlement_drop: false, all_grv_in_cashflow: true } },

  { ...makeFixture('melbourne-mixeduse-v1', 'Melbourne MixedUse v1'),
    purpose: 'Melbourne mixed-use UAT analog. Sensitivity: GST classifier; G4 false-positive suppression.',
    sensitive: ['G1', 'G2', 'G4', 'A1'],
    expected: { gst_input_taxed_warning: false, BAS_GST_correct: true } },

  { ...makeFixture('brisbane-cbd-midrise-uat-v1', 'Brisbane CBD Mid-Rise UAT v1'),
    purpose: 'Brisbane CBD Mid-Rise UAT — confirms B03 / settlement-window invariant.',
    sensitive: ['A4', 'A1', 'B3-fixture'],
    expected: { all_grv_in_cashflow: true } },

  { ...makeFixture('st-kilda-150-uat-v1', 'St Kilda 150 UAT v1'),
    purpose: 'St Kilda 150 — 70% LTC test fixture (PR #29). Sensitivity: F1 cash vs cap, F2 senior takeout, F3 closed-form land-loan interest. M1/M2 manual-trust deposit (PR #31).',
    sensitive: ['F1', 'F2', 'F3', 'A2', 'B2', 'L1'],
    expected: { senior_LTC_max: 0.70, land_loan_zero_at_construction_start: true } },

  // ---- South Yarra scenarios — vary the manual S-curve only ---------------
  ...[
    { i: 1, label: 'Default',          curve: 'Evenly Split',     attach: null },
    { i: 2, label: 'Front-loaded',     curve: 'Manual S-curve 1', attach: (admin) => { admin.manualSCurves[0] = FRONT_LOADED; } },
    { i: 3, label: 'Back-loaded',      curve: 'Manual S-curve 2', attach: (admin) => { admin.manualSCurves[1] = BACK_LOADED; } },
    { i: 4, label: 'Milestone-stepped',curve: 'Manual S-curve 3', attach: (admin) => { admin.manualSCurves[2] = MILESTONE; } },
  ].map(({ i, label, curve, attach }) => ({
    ...makeFixture(
      `south-yarra-120-s${i}-${label.toLowerCase().replace(/[^a-z]+/g, '')}`,
      `South Yarra 120 — ${label}`,
      {},
      // Override construction sCurve assignment on every construction line
      { constructionCosts: base.inputs.constructionCosts.map(c => ({ ...c, sCurve: curve })) },
      attach,
    ),
    purpose: `South Yarra 120 — ${label} S-curve. Sensitivity: cap-int basis varies with cost timing; M2/M3 redistribution math.`,
    sensitive: ['A1', 'B1', 'D1', 'D2', 'C1', 'M3'],
    expected: { LTC_peak_le_80pct: true, LVR_le_75pct: true, all_three_facilities_active: true },
  })),
];

mkdirSync(here, { recursive: true });

for (const f of fixtures) {
  writeFileSync(resolve(here, `${f.slug}.json`), JSON.stringify({
    schemaVersion: 5, synthetic: true,
    generatedAt: new Date().toISOString(),
    note: 'Synthetic fixture — Project Demo scaffold + per-fixture override. Not a verbatim prod localStorage export.',
    admin: f.admin, inputs: f.inputs,
  }, null, 2));

  writeFileSync(resolve(here, `${f.slug}.metadata.md`), `# ${f.slug}

**Synthetic:** yes (Project Demo scaffold + per-fixture override)
**Schema version:** 5

## Purpose

${f.purpose}

## Invariant sensitivities

${f.sensitive.map(s => `- ${s}`).join('\n')}

## Expected key outputs (at last verification)

\`\`\`json
${JSON.stringify(f.expected, null, 2)}
\`\`\`

## Regenerating

\`\`\`
node regression-pack/fixtures/_generate.mjs
\`\`\`
`);
}

console.log(`Generated ${fixtures.length} fixtures + metadata in ${here}`);
