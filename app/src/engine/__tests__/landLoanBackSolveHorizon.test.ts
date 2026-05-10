/**
 * Issue 5 (review batch) — Land loan back-solve horizon at senior takeout.
 *
 * Background: PR #32 (LL2) refinances the land loan in full when the senior
 * facility starts (`hasSenior && i === snrStartIdx`). Cap-int compounding
 * past `senior.startMonth - 1` therefore never materialises in reality.
 * Pre-fix, both back-solve sites in funding.ts used `landLoan.maturityMonth`
 * as the compounding horizon, making the closed-form principal cap
 * unnecessarily conservative on every project that takes senior out
 * before LL maturity.
 *
 * Fix: clip the horizon to `senior.startMonth - 1` whenever:
 *   • a senior facility exists (facilityLimit > 0), AND
 *   • senior starts after period 0 (startMonth > 0), AND
 *   • takeout fires before LL maturity
 *     (senior.startMonth - 1 < landLoanMaturityIdx)
 *
 * Run: cd app && npx tsx src/engine/__tests__/landLoanBackSolveHorizon.test.ts
 */
import { computeLandLoanBackSolveEndIdx } from '../funding';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// I5.1 — User-spec invariant: LL maturity month 12 (idx 11), senior start
// month 7 (takeout at idx 6). Effective horizon must be 6, not 11.
{
  const llMaturityIdx = 12 - 1;       // 11
  const senior = { facilityLimit: 80_000_000, startMonth: 7 };
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx);
  assert(out === 6,
    'I5.1 — clip to senior.startMonth-1=6 when takeout is before LL maturity (got ' + out + ')');
}

// I5.2 — No senior takeout (facilityLimit === 0): use full LL maturity.
{
  const llMaturityIdx = 11;
  const senior = { facilityLimit: 0, startMonth: 7 };
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx);
  assert(out === llMaturityIdx,
    'I5.2 — no-senior case keeps full LL maturity horizon (got ' + out + ')');
}

// I5.3 — Senior starts at period 0 (startMonth === 0): treated as "no
// distinct takeout window", use full LL maturity.
{
  const llMaturityIdx = 11;
  const senior = { facilityLimit: 80_000_000, startMonth: 0 };
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx);
  assert(out === llMaturityIdx,
    'I5.3 — senior.startMonth=0 keeps full LL maturity horizon (got ' + out + ')');
}

// I5.4 — Senior takeout AFTER LL natural maturity: no clip (LL is gone
// before senior arrives, so there is no takeout transaction). Keep full
// LL maturity horizon for back-solve.
{
  const llMaturityIdx = 5; // LL matures at idx 5 (month 6)
  const senior = { facilityLimit: 80_000_000, startMonth: 12 }; // takeout at idx 11
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx);
  assert(out === llMaturityIdx,
    'I5.4 — senior starts after LL maturity → keep LL horizon (got ' + out + ', expected ' + llMaturityIdx + ')');
}

// I5.5 — Edge: senior takeout EXACTLY at LL maturity. Pre-fix logic used
// strict less-than, so an equality match keeps the LL horizon (no
// effective shortening from clipping to the same value).
{
  const llMaturityIdx = 11;
  const senior = { facilityLimit: 80_000_000, startMonth: 12 }; // takeout idx 11 == LL maturity idx
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx);
  assert(out === llMaturityIdx,
    'I5.5 — takeout==LL maturity → keep LL horizon (got ' + out + ')');
}

// I5.6 — Senior takeout one period before LL maturity: clip by exactly 1.
{
  const llMaturityIdx = 11;
  const senior = { facilityLimit: 80_000_000, startMonth: 11 }; // takeout idx 10
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx);
  assert(out === 10,
    'I5.6 — takeout one period before maturity clips by 1 (got ' + out + ')');
}

// I5.7 — Defensive: a senior with facilityLimit > 0 but startMonth at 0
// is treated as no-takeout (covered by I5.3 too). Smoke-test a low-magnitude
// negative path to make the helper's gating behaviour explicit.
{
  const llMaturityIdx = 11;
  const senior = { facilityLimit: 1, startMonth: 0 };
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx);
  assert(out === llMaturityIdx, 'I5.7 — facilityLimit>0 but startMonth=0 keeps LL horizon (got ' + out + ')');
}


// IA.1 — Issue A new gate: landLoan.startMonth === 0 (no land loan present)
// → keep full LL maturity (no clip). With backwards-compat default, the
// old call (2 args) would clip; new behaviour requires explicit landLoan
// with startMonth>0 to clip.
{
  const llMaturityIdx = 11;
  const senior = { facilityLimit: 80_000_000, startMonth: 7 };
  const landLoan = { startMonth: 0 };
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx, landLoan);
  assert(out === llMaturityIdx,
    'IA.1 — landLoan.startMonth=0 keeps full LL horizon (got ' + out + ')');
}

// IA.2 — Issue A new gate: landLoan.startMonth > senior.startMonth
// (LL begins AFTER senior takeover — degenerate config, no takeout
// refinance). Keep full LL horizon (no clip).
{
  const llMaturityIdx = 11;
  const senior = { facilityLimit: 80_000_000, startMonth: 7 };
  const landLoan = { startMonth: 8 }; // LL starts AFTER senior takeover
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx, landLoan);
  assert(out === llMaturityIdx,
    'IA.2 — landLoan.startMonth > senior.startMonth keeps full LL horizon (got ' + out + ')');
}

// IA.3 — Issue A: landLoan.startMonth === senior.startMonth (boundary —
// LL starts on the same period as senior takeover). Allow clip — the
// takeout still fires at senior.startMonth.
{
  const llMaturityIdx = 11;
  const senior = { facilityLimit: 80_000_000, startMonth: 7 };
  const landLoan = { startMonth: 7 };
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx, landLoan);
  assert(out === 6,
    'IA.3 — landLoan.startMonth == senior.startMonth still clips (got ' + out + ')');
}

// IA.4 — Issue A: landLoan.startMonth < senior.startMonth, normal
// case — clip applies (matches I5.1 behaviour).
{
  const llMaturityIdx = 11;
  const senior = { facilityLimit: 80_000_000, startMonth: 7 };
  const landLoan = { startMonth: 1 };
  const out = computeLandLoanBackSolveEndIdx(senior, llMaturityIdx, landLoan);
  assert(out === 6,
    'IA.4 — normal LL-before-senior config clips (got ' + out + ')');
}
console.log('\nIssue 5 — Land Loan Back-Solve Horizon — ' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  x ' + f)); process.exit(1); }
