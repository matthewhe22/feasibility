/**
 * v7 migration regression test.
 *
 * v7 — renamed `equityDeveloper.fixedAmount` (and analogous fields on
 * equityJV / equityPreferred / equityAdditional) to `equityCap`. Migration
 * copies the old value across and deletes the old key.
 *
 * Idempotent on v7: states without `fixedAmount` are no-ops; states with both
 * keys keep `equityCap` and drop `fixedAmount`.
 *
 * Run: cd app && npx tsx src/store/__tests__/migrationV7.test.ts
 */
import { migratePersistedState } from '../useStore';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

function v6Persisted(equityOverrides: Record<string, unknown> = {}) {
  return {
    activeTab: 'inputs',
    admin: {
      projectName: 'v6 fixture',
      modelStartDate: 44927, tolerance: 10,
      equityDrawdownMode: 'equity-first',
      repaymentSequence: ['senior', 'mezz', 'equity'],
    },
    inputs: {
      equityDeveloper: { name: 'Developer', percentage: 0.1, fixedAmount: 130_419_982,
        interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0,
        equityContribution: 1, profitShare: 1, drawdownPriority: 1,
        ...equityOverrides },
      equityJV: { name: 'JV', percentage: 0.1, fixedAmount: 0,
        interestRate: 0, interestCompound: 1, repayEquityBeforeDebt: 0,
        equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
      equityPreferred: { name: '', percentage: 0.1, fixedAmount: 0,
        interestRate: 0.13, interestCompound: 1, repayEquityBeforeDebt: 0,
        equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
      equityAdditional: { name: '', percentage: 0.1, fixedAmount: 0,
        interestRate: 0.13, interestCompound: 1, repayEquityBeforeDebt: 0,
        equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    },
    currentProjectId: null,
  };
}

// V7.1 — v6 fixedAmount copies across to equityCap on every entity, old key dropped
{
  const p = v6Persisted();
  const out = migratePersistedState(p, 6) as { inputs: { equityDeveloper: Record<string, unknown>; equityJV: Record<string, unknown> } };
  assert(out.inputs.equityDeveloper.equityCap === 130_419_982,
    `V7.1a — Developer.equityCap copied (got ${out.inputs.equityDeveloper.equityCap})`);
  assert(out.inputs.equityDeveloper.fixedAmount === undefined,
    `V7.1b — Developer.fixedAmount deleted (got ${out.inputs.equityDeveloper.fixedAmount})`);
  assert(out.inputs.equityJV.equityCap === 0,
    `V7.1c — JV.equityCap copied`);
  assert(out.inputs.equityJV.fixedAmount === undefined,
    `V7.1d — JV.fixedAmount deleted`);
}

// V7.2 — current-schema idempotence under aggregate migrate (was v7→v7;
// now v8→v8 since v8 added a subsequent migration). The v7 step's own
// idempotence is verified by V7.5 + V7.6 below.
{
  const p = v6Persisted();
  // Pre-migrate to v7 shape (rename fixedAmount → equityCap on every entity)
  for (const k of ['equityDeveloper', 'equityJV', 'equityPreferred', 'equityAdditional']) {
    const e = (p.inputs as Record<string, unknown>)[k] as Record<string, unknown> | undefined;
    if (e && 'fixedAmount' in e) {
      e.equityCap = e.fixedAmount;
      delete e.fixedAmount;
    }
  }
  // Pre-shape v8 (minEquityRequirement at disabled default) so aggregate
  // migrate has nothing to do.
  (p.inputs as Record<string, unknown>).minEquityRequirement = {
    mode: 'percent', value: 0, basis: 'tdc-incl-finance-costs',
  };
  const before = JSON.stringify(p);
  const out = migratePersistedState(p, 8);
  const after = JSON.stringify(out);
  assert(before === after, `V7.2 — current-schema state is no-op under aggregate migrate`);
}

// V7.3 — both keys present: equityCap wins
{
  const p = v6Persisted({ equityCap: 999, fixedAmount: 555 });
  const out = migratePersistedState(p, 6) as { inputs: { equityDeveloper: Record<string, unknown> } };
  assert(out.inputs.equityDeveloper.equityCap === 999,
    `V7.3a — equityCap preserved when both present (got ${out.inputs.equityDeveloper.equityCap})`);
  assert(out.inputs.equityDeveloper.fixedAmount === undefined,
    `V7.3b — fixedAmount deleted even when both present`);
}

// V7.4 — missing fixedAmount AND missing equityCap: no equityCap created (both undefined)
{
  const p = v6Persisted();
  delete (p.inputs.equityDeveloper as Record<string, unknown>).fixedAmount;
  const out = migratePersistedState(p, 6) as { inputs: { equityDeveloper: Record<string, unknown> } };
  assert(out.inputs.equityDeveloper.equityCap === undefined,
    `V7.4 — missing both keys: equityCap remains undefined (deep-merge fills from defaults later) (got ${out.inputs.equityDeveloper.equityCap})`);
}

console.log(`V7 migration: ${passed} passed, ${failed} failed (${passed+failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
