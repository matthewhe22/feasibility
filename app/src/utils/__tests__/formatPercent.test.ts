import { formatPercent } from '../index';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; return; }
  failed++; failures.push(msg);
}

assert(formatPercent(0.0810) === '8.10%', 'normal value formatted');
assert(formatPercent(0) === '0.00%', 'zero formatted');
assert(formatPercent(-0.5) === '-50.00%', 'negative formatted');
assert(formatPercent(15) === '>999.00%', 'absurd positive (e.g. e+42 IRR) clipped at +999%');
assert(formatPercent(-30) === '<-999.00%', 'absurd negative clipped at -999%');
assert(formatPercent(NaN) === 'N/A', 'NaN renders as N/A');
assert(formatPercent(Infinity) === 'N/A', 'Infinity renders as N/A');

console.log(`\nFORMAT-PERCENT TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  for (const f of failures) console.log('  ✗', f);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
