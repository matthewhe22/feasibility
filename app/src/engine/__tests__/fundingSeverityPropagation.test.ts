/**
 * Issue 2 (review batch) — FAIL severity propagation.
 *
 * Background: PR #57 introduced explicit prefix tags in funding warning
 * text ([FUNDING] FAIL ..., [FUNDING] ..., [INFO] ..., [FUNDING] [INFO] ...)
 * intended to drive the dashboard banner colour and the Checks-tab row
 * status. Pre-fix, the engine's warningsDetail builder only mapped the word
 * "solver" to severity 'error' and put EVERY other funding message at
 * severity 'warning'. So a [FUNDING] FAIL message — Dandenong 15/75/10
 * with 46% equity-cap overshoot — would render yellow WARN instead of
 * red FAIL.
 *
 * Fix: parse the prefix in classifyFundingWarning and map:
 *   • [FUNDING] FAIL ...           → severity 'error', category 'funding'
 *   • [INFO] ... | [FUNDING] [INFO] → severity 'info',  category 'funding'
 *   • contains "solver"            → severity 'error', category 'solver'
 *   • else                         → severity 'warning', category 'funding'
 *
 * Run: cd app && npx tsx src/engine/__tests__/fundingSeverityPropagation.test.ts
 */
import { classifyFundingWarning } from '../index';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// I2.1 — [FUNDING] FAIL ... → error / funding (was warning pre-fix)
{
  const m = '[FUNDING] FAIL Developer equity drawn $46.0M exceeds user-set equity cap $31.5M by $14.5M (46% over) — engine auto-backstopped to fill a funding gap of $14.5M. Capital stack is fundamentally inconsistent with stated equity commitment — increase equity cap to $46.0M+, raise senior/mezz facility, or reduce project scope.';
  const r = classifyFundingWarning(m);
  assert(r.severity === 'error', 'I2.1a — [FUNDING] FAIL → severity error (got ' + r.severity + ')');
  assert(r.category === 'funding', 'I2.1b — [FUNDING] FAIL → category funding (got ' + r.category + ')');
}

// I2.2 — [FUNDING] (no FAIL) → warning / funding (existing default)
{
  const m = '[FUNDING] Mezzanine covenant cap exceeded by $1.2M — increase facility limit or reduce loan size.';
  const r = classifyFundingWarning(m);
  assert(r.severity === 'warning', 'I2.2a — [FUNDING] non-FAIL → severity warning (got ' + r.severity + ')');
  assert(r.category === 'funding', 'I2.2b — [FUNDING] non-FAIL → category funding');
}

// I2.3 — [INFO] ... → info / funding
{
  const m = '[INFO] Auto-sized Senior #1 $80.0M -> $79.4M to keep peak balance within facility limit.';
  const r = classifyFundingWarning(m);
  assert(r.severity === 'info', 'I2.3a — [INFO] → severity info (got ' + r.severity + ')');
  assert(r.category === 'funding', 'I2.3b — [INFO] → category funding');
}

// I2.4 — [FUNDING] [INFO] ... → info / funding (legacy combined prefix)
{
  const m = '[FUNDING] [INFO] Land Loan IPF>1 cash-pay window summary.';
  const r = classifyFundingWarning(m);
  assert(r.severity === 'info', 'I2.4a — [FUNDING] [INFO] → severity info (got ' + r.severity + ')');
  assert(r.category === 'funding', 'I2.4b — [FUNDING] [INFO] → category funding');
}

// I2.5 — Solver non-convergence → error / solver (PR #46 path preserved)
{
  const m = 'Debt solver did not converge within 50 iterations (final delta $850).';
  const r = classifyFundingWarning(m);
  assert(r.severity === 'error', 'I2.5a — solver → severity error');
  assert(r.category === 'solver', 'I2.5b — solver → category solver');
}

// I2.6 — Plain message with no recognised prefix → warning / funding
{
  const m = 'Cap-int back-solve: Senior #1 principal cap reduced from $80.0M to $74.5M.';
  const r = classifyFundingWarning(m);
  assert(r.severity === 'warning', 'I2.6a — unprefixed → severity warning (got ' + r.severity + ')');
  assert(r.category === 'funding', 'I2.6b — unprefixed → category funding');
}

// I2.7 — Solver overrides FAIL prefix (defensive: a message that mentions
// solver and starts with [FUNDING] FAIL would still route to solver-error;
// prevents a perplexing UI mismatch where the row says "solver" but is
// flagged as a generic FAIL).
{
  const m = '[FUNDING] FAIL solver did not converge.';
  const r = classifyFundingWarning(m);
  assert(r.severity === 'error', 'I2.7a — solver-in-FAIL → severity error');
  assert(r.category === 'solver', 'I2.7b — solver-in-FAIL → category solver (solver beats FAIL)');
}

console.log('\nIssue 2 — Funding Severity Propagation — ' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  x ' + f)); process.exit(1); }
