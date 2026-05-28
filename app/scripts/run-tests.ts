/**
 * Test runner — discovers and runs every `*.test.ts` under src/ via tsx.
 *
 * The suite is a collection of standalone tsx scripts, each with its own
 * hand-rolled assert harness that calls `process.exit(1)` on failure. This
 * runner executes them in series, captures their output, and fails the whole
 * run (exit 1) if ANY file exits non-zero — so a single red test can no longer
 * hide behind the absence of an aggregating runner.
 *
 * It also guards against the orphaned-file class of bug (a test named without
 * the `.test.ts` suffix): any *.ts file under a __tests__ dir that is NOT a
 * `.test.ts` and is NOT a shared helper is reported as a warning.
 *
 *   cd app && npm test
 */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const srcRoot = join(appRoot, 'src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const allFiles = walk(srcRoot);
const testFiles = allFiles.filter((f) => f.endsWith('.test.ts')).sort();

// Surface potentially-orphaned tests: a *.ts inside a __tests__ dir that is not
// a .test.ts and not an obvious shared helper.
const orphanCandidates = allFiles.filter(
  (f) =>
    f.includes(`${'__tests__'}`) &&
    f.endsWith('.ts') &&
    !f.endsWith('.test.ts') &&
    !/helpers?\.ts$/i.test(f) &&
    !/fixtures?\.ts$/i.test(f),
);
if (orphanCandidates.length > 0) {
  console.warn('⚠️  Possible orphaned test files (in __tests__ but not *.test.ts):');
  for (const f of orphanCandidates) console.warn(`     ${relative(appRoot, f)}`);
  console.warn('     Rename to *.test.ts so they run, or move helpers out of __tests__.\n');
}

let passedFiles = 0;
const failedFiles: string[] = [];

console.log(`Running ${testFiles.length} test files…\n`);
for (const file of testFiles) {
  const rel = relative(appRoot, file);
  const res = spawnSync('npx', ['tsx', file], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  if (res.status === 0) {
    passedFiles++;
    // Echo the one-line summary each file prints, if present.
    const summary = out.split('\n').reverse().find((l) => /passed,.*failed/i.test(l));
    console.log(`✅ ${rel}${summary ? `  — ${summary.trim()}` : ''}`);
  } else {
    failedFiles.push(rel);
    console.log(`❌ ${rel}`);
    console.log(out.split('\n').map((l) => `     ${l}`).join('\n'));
  }
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`TEST SUITE: ${passedFiles}/${testFiles.length} files passed${failedFiles.length ? `, ${failedFiles.length} FAILED` : ''}`);
console.log('═'.repeat(72));
if (failedFiles.length > 0) {
  console.log('\nFailed files:');
  for (const f of failedFiles) console.log(`  ✗ ${f}`);
  process.exit(1);
}
