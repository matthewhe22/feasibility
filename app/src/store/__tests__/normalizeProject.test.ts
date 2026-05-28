/**
 * Tests for normalizeLoadedProject + schema-version stamping.
 *
 * Guards two fixes:
 *  - Demo/DB records are migrated AND defaults-backfilled through one shared
 *    pipeline (no crash on legacy-shaped records missing array fields).
 *  - Records stamped with the current schema version skip the migration ladder
 *    (so non-idempotent heuristic steps can't re-fire on already-healed data),
 *    while unstamped legacy records still migrate from version 0.
 */
import {
  normalizeLoadedProject, readSchemaVersion, stampSchemaVersion,
} from '../normalizeProject';
import { CURRENT_SCHEMA_VERSION, defaultAdmin } from '../useStore';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// 1. stamp + read round-trip.
{
  const stamped = stampSchemaVersion(defaultAdmin);
  assert(readSchemaVersion(stamped) === CURRENT_SCHEMA_VERSION,
    `stamp/read round-trips to current version (got ${readSchemaVersion(stamped)})`);
  assert(readSchemaVersion({}) === 0, 'unstamped admin reads as version 0');
  assert(readSchemaVersion(null) === 0, 'null admin reads as version 0');
}

// 2. Legacy-shaped record (missing arrays/objects) is backfilled, not crashed.
{
  const rawAdmin = { projectName: 'Legacy' }; // missing most fields
  const rawInputs = { preliminary: { projectLots: 5 } }; // missing arrays/facilities
  const { admin, inputs } = normalizeLoadedProject(rawAdmin, rawInputs);
  assert(admin.projectName === 'Legacy', 'user value preserved through normalize');
  assert(Array.isArray(inputs.constructionCosts), 'missing array backfilled from defaults');
  assert(inputs.landLoan != null && typeof inputs.landLoan === 'object',
    'missing facility object backfilled from defaults');
  assert(inputs.preliminary.projectLots === 5, 'nested user value preserved');
}

// 3. Stamped-current record: a legacy v6-style `fixedAmount` is NOT migrated
//    (version >= 7 already), proving the ladder is skipped for stamped records.
{
  const rawAdmin = stampSchemaVersion(defaultAdmin); // version = CURRENT
  const rawInputs = {
    equityDeveloper: { fixedAmount: 16_500_000 }, // legacy shape, no equityCap
  };
  const { inputs } = normalizeLoadedProject(rawAdmin, rawInputs);
  // Migration skipped → legacy fixedAmount NOT copied into equityCap by v7.
  const dev = inputs.equityDeveloper as unknown as Record<string, unknown>;
  assert(dev.equityCap === undefined || typeof dev.equityCap === 'number',
    'stamped record: v7 migration did not run (equityCap not synthesised from fixedAmount)');
}

// 4. Unstamped legacy record (version 0): v7 migration DOES run and copies
//    fixedAmount → equityCap.
{
  const rawAdmin = { projectName: 'Old' }; // unstamped → version 0
  const rawInputs = { equityDeveloper: { fixedAmount: 16_500_000 } };
  const { inputs } = normalizeLoadedProject(rawAdmin, rawInputs);
  const dev = inputs.equityDeveloper as unknown as Record<string, unknown>;
  assert(dev.equityCap === 16_500_000,
    `legacy record: v7 migration copied fixedAmount→equityCap (got ${dev.equityCap})`);
  assert(dev.fixedAmount === undefined, 'legacy record: old fixedAmount key dropped by v7');
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`NORMALIZE-PROJECT TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
