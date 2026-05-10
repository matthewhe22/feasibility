/**
 * Issue 1 (review batch) — Residual stock facility helper text.
 *
 * `FinancingInputs.tsx` renders a one-line helper under "Facility Limit"
 * explaining whether the limit is on peak balance (cap-int compounded into
 * balance) or principal drawn (cash-pay interest). PR #56 added a copy
 * fragment that promised the engine "dynamically sizes principal during
 * drawdown to keep peak balance within this limit" — but `funding.ts`
 * `PrincipalCapOverrides` and the timing-aware shrink loop only cover
 * `senior`, `senior2`, `mezz`, and `landLoan`. Residual stock is NOT in
 * the loop, so that copy is a false promise on the residual-stock card.
 *
 * The fix branches the helper text on `isResidualStock`. For a capitalised
 * residual-stock facility, the message must direct the user to adjust the
 * limit manually rather than implying engine sizing.
 *
 * Run: cd app && npx tsx src/components/inputs/__tests__/residualStockHelperText.test.ts
 */
import { getFacilityLimitHelperText } from '../facilityLimitHelperText';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// I1.1 — Residual stock + capitalised: must NOT promise dynamic sizing;
// must direct the user to adjust the limit manually.
{
  const text = getFacilityLimitHelperText({ isCapitalised: true }, true);
  assert(!text.includes('dynamically sizes'),
    'I1.1a — residual+cap text must not mention "dynamically sizes" (got: "' + text + '")');
  assert(text.includes('not auto-sized') || text.includes('adjust this manually'),
    'I1.1b — residual+cap text must surface the manual-adjust caveat (got: "' + text + '")');
  assert(text.includes('residual stock') || text.includes('Residual stock') || text.includes('committed principal'),
    'I1.1c — residual+cap text must reference residual stock or committed principal (got: "' + text + '")');
}

// I1.2 — Residual stock + cash-pay: cash-pay default copy.
{
  const text = getFacilityLimitHelperText({ isCapitalised: false }, true);
  assert(text.includes('Maximum principal drawn'),
    'I1.2a — residual+cash text shows "Maximum principal drawn" (got: "' + text + '")');
  assert(text.includes('paid as cash'),
    'I1.2b — residual+cash text mentions cash-pay (got: "' + text + '")');
}

// I1.3 — Senior/mezz/landLoan + capitalised: keep the dynamic-sizing
// promise. The engine DOES auto-size these facilities.
{
  const text = getFacilityLimitHelperText({ isCapitalised: true }, false);
  assert(text.includes('dynamically sizes'),
    'I1.3a — non-residual+cap text retains "dynamically sizes" (got: "' + text + '")');
  assert(text.includes('peak balance'),
    'I1.3b — non-residual+cap text references peak balance (got: "' + text + '")');
}

// I1.4 — Default isResidualStock arg behaves identically to explicit false.
{
  const a = getFacilityLimitHelperText({ isCapitalised: true });
  const b = getFacilityLimitHelperText({ isCapitalised: true }, false);
  assert(a === b, 'I1.4 — default false matches explicit false');
}

console.log('\nIssue 1 — Residual Stock Helper Text — ' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  x ' + f)); process.exit(1); }
