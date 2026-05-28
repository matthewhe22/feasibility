/**
 * deepMerge unit test — covers the semantics ProjectManager.handleLoad relies
 * on when normalising a loaded project record over the current defaults.
 *
 * Run: cd app && npx tsx src/utils/__tests__/deepMerge.test.ts
 */
import { deepMerge } from '../deepMerge';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// ── 1. Missing top-level keys are filled from default ───────────────────────
{
  const base = { a: 1, b: 'two', c: [1, 2, 3], d: { x: 1 } };
  const out = deepMerge(base as Record<string, unknown>, {});
  assert(out.a === 1, 'DM.1a — missing primitive filled');
  assert(out.b === 'two', 'DM.1b — missing string filled');
  assert(Array.isArray(out.c) && (out.c as number[]).length === 3, 'DM.1c — missing array filled');
  assert(typeof out.d === 'object' && (out.d as { x: number }).x === 1, 'DM.1d — missing object filled');
}

// ── 2. Override primitives win outright ─────────────────────────────────────
{
  const base = { a: 1, b: 'two' };
  const out = deepMerge(base as Record<string, unknown>, { a: 99, b: 'changed' });
  assert(out.a === 99, 'DM.2a — primitive override wins');
  assert(out.b === 'changed', 'DM.2b — string override wins');
}

// ── 3. Override arrays win outright (no element-wise merge) ─────────────────
{
  const base = { items: [1, 2, 3, 4] };
  const out = deepMerge(base as Record<string, unknown>, { items: [9] });
  assert(Array.isArray(out.items) && (out.items as number[]).length === 1, 'DM.3a — override array length wins');
  assert((out.items as number[])[0] === 9, 'DM.3b — override array contents win');
}

// ── 4. Override empty array also wins (override knows it wants nothing) ─────
{
  const base = { items: [1, 2, 3] };
  const out = deepMerge(base as Record<string, unknown>, { items: [] });
  assert(Array.isArray(out.items) && (out.items as unknown[]).length === 0, 'DM.4a — override empty array wins');
}

// ── 5. Nested plain objects merge field-by-field ────────────────────────────
{
  const base = { fac: { rate: 0.05, limit: 1_000_000, newField: 42 } };
  const out = deepMerge(
    base as Record<string, unknown>,
    { fac: { rate: 0.03, limit: 500_000 } } as Record<string, unknown>,
  );
  const fac = out.fac as { rate: number; limit: number; newField: number };
  assert(fac.rate === 0.03, 'DM.5a — nested override wins');
  assert(fac.limit === 500_000, 'DM.5b — nested override wins');
  assert(fac.newField === 42, 'DM.5c — nested missing field filled from default');
}

// ── 6. null and undefined override values are honoured (not back-filled) ────
{
  const base = { a: 1, b: 'two', nested: { x: 1 } };
  const out = deepMerge(
    base as Record<string, unknown>,
    { a: null, b: undefined } as Record<string, unknown>,
  );
  assert(out.a === null, 'DM.6a — explicit null override is preserved');
  assert(out.b === undefined, 'DM.6b — explicit undefined override is preserved');
  // The nested object should still come from base since override didn't supply it.
  assert((out.nested as { x: number }).x === 1, 'DM.6c — untouched nested key kept');
}

// ── 7. Override-only keys ride through (forward-compat) ─────────────────────
{
  const base = { a: 1 };
  const out = deepMerge(base as Record<string, unknown>, { futureField: 'hello' });
  assert((out as { futureField?: string }).futureField === 'hello', 'DM.7a — unknown override key preserved');
}

// ── 8. Inputs are NOT mutated ───────────────────────────────────────────────
{
  const base = { a: { x: 1 }, list: [1, 2, 3] };
  const override = { a: { y: 2 }, list: [9] };
  const baseCopy = JSON.parse(JSON.stringify(base));
  const overrideCopy = JSON.parse(JSON.stringify(override));
  deepMerge(base as Record<string, unknown>, override as Record<string, unknown>);
  assert(JSON.stringify(base) === JSON.stringify(baseCopy), 'DM.8a — base not mutated');
  assert(JSON.stringify(override) === JSON.stringify(overrideCopy), 'DM.8b — override not mutated');
}

// ── 9. Default value is deep-cloned (no shared mutable refs) ────────────────
{
  const base = { items: [{ x: 1 }] };
  const out = deepMerge(base as Record<string, unknown>, {});
  // Mutate the base — out should not see it.
  (base.items[0] as { x: number }).x = 999;
  const outItems = out.items as Array<{ x: number }>;
  assert(outItems[0]!.x === 1, 'DM.9a — defaulted value is deep-cloned (no shared ref)');
}

// ── 10. Null/undefined override returns a clone of the base ─────────────────
{
  const base = { a: 1, b: { c: 2 } };
  const out1 = deepMerge(base as Record<string, unknown>, null);
  const out2 = deepMerge(base as Record<string, unknown>, undefined);
  assert((out1 as { a: number }).a === 1, 'DM.10a — null override falls back to base');
  assert((out2 as { a: number }).a === 1, 'DM.10b — undefined override falls back to base');
  // Mutate base.b.c — out1 / out2 should not reflect the mutation.
  (base.b as { c: number }).c = 999;
  assert(((out1 as { b: { c: number } }).b.c) === 2, 'DM.10c — null-override path also deep-clones');
}

// ── 11. Prototype pollution is rejected ─────────────────────────────────────
// A tampered DB record carrying a literal `__proto__` key (own-enumerable
// after JSON.parse) must NOT mutate Object.prototype or the output's chain.
{
  const malicious = JSON.parse('{"a": 1, "__proto__": {"polluted": true}}');
  const out = deepMerge({ a: 0 } as Record<string, unknown>, malicious);
  assert(out.a === 1, 'DM.11a — benign key still merged alongside rejected __proto__');
  assert(({} as Record<string, unknown>).polluted === undefined,
    'DM.11b — Object.prototype not polluted');
  assert((out as Record<string, unknown>).polluted === undefined,
    'DM.11c — output prototype not polluted');
  // `constructor` / `prototype` override keys are likewise dropped.
  const out2 = deepMerge({ a: 0 } as Record<string, unknown>,
    JSON.parse('{"constructor": {"x": 1}, "prototype": {"y": 2}, "a": 5}'));
  assert(out2.a === 5 && out2.constructor === Object.prototype.constructor,
    'DM.11d — constructor/prototype override keys dropped');
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`deepMerge TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
