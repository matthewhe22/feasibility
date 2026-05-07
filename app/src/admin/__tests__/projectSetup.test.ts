/**
 * Unit tests for `validateProjectName` — the pure validator used by the admin
 * Project Setup UI's "Save as new project" affordance.
 *
 * Run: cd app && npx tsx src/admin/__tests__/projectSetup.test.ts
 */
import { validateProjectName } from '../projectSetupValidator';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// Happy path — fresh name, empty list
{
  const err = validateProjectName('Project Syd new test', []);
  assert(err === null, `Happy 1 — fresh name on empty list should pass (got '${err}')`);
}

// Happy path — fresh name, populated list (case differs)
{
  const err = validateProjectName('UAT-test-2026-05', ['Project Demo', 'Box Hill 250']);
  assert(err === null, `Happy 2 — non-matching name should pass (got '${err}')`);
}

// Trim whitespace before save (leading + trailing)
{
  const err = validateProjectName('   New Project   ', []);
  assert(err === null, `Happy 3 — leading/trailing whitespace trimmed (got '${err}')`);
}

// Empty string rejected
{
  const err = validateProjectName('', []);
  assert(err !== null && /empty/i.test(err), `Empty 1 — empty string rejected (got '${err}')`);
}

// Whitespace-only rejected
{
  const err = validateProjectName('     ', []);
  assert(err !== null && /empty/i.test(err), `Empty 2 — whitespace-only rejected (got '${err}')`);
}

// Duplicate (exact match) rejected
{
  const err = validateProjectName('Project Demo', ['Project Demo']);
  assert(err !== null && /already/i.test(err), `Dup 1 — exact-match duplicate rejected (got '${err}')`);
}

// Duplicate (case-insensitive) rejected
{
  const err = validateProjectName('PROJECT demo', ['Project Demo']);
  assert(err !== null && /already/i.test(err), `Dup 2 — case-insensitive duplicate rejected (got '${err}')`);
}

// Duplicate after trim rejected
{
  const err = validateProjectName('  Project Demo  ', ['Project Demo']);
  assert(err !== null && /already/i.test(err), `Dup 3 — duplicate after trim rejected (got '${err}')`);
}

// Over 50 chars rejected
{
  const longName = 'A'.repeat(51);
  const err = validateProjectName(longName, []);
  assert(err !== null && /50 characters/i.test(err) && /51/.test(err),
    `Length 1 — 51-char name rejected with explicit count (got '${err}')`);
}

// Exactly 50 chars allowed
{
  const exact = 'A'.repeat(50);
  const err = validateProjectName(exact, []);
  assert(err === null, `Length 2 — exactly 50 chars allowed (got '${err}')`);
}

// Trim then check 51 chars (after trim) rejected
{
  const err = validateProjectName('   ' + 'A'.repeat(51) + '   ', []);
  assert(err !== null && /50 characters/i.test(err),
    `Length 3 — trim before length check (got '${err}')`);
}

// Validator never mutates the input list
{
  const list = ['Existing'];
  const before = JSON.stringify(list);
  validateProjectName('New', list);
  assert(JSON.stringify(list) === before, `Purity — validator does not mutate the list`);
}

console.log(`Project Setup validator: ${passed} passed, ${failed} failed (${passed+failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
