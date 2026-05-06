# Pencil DM Feasibility — Regression Pack

Reusable end-to-end regression suite for the Pencil DM Feasibility engine. Run
this BEFORE signing off a deploy. It catches the kinds of regressions that the
engagement audit history (PRs #28–#37) shipped fixes for: cashflow drift,
returns reconciliation, capital-stack drift, covenant breaches, GST classifier
errors, schema-migration breakage, S-curve / actuals overlay correctness.

## Pre-flight checklist

- [ ] Repo at the commit you want to ship (typically `main` HEAD or a release
      candidate branch tip).
- [ ] `app/node_modules` installed (`cd app && npm ci`).
- [ ] `tsx` available (it's a devDep — `npm ci` covers it).
- [ ] For the LIVE UAT layer only: a Chrome MCP session connected to a logged-in
      browser viewing https://pencil.capconnex.com.au.
- [ ] For the agent-prompts layer: a Claude session with subagent capability.

## Layers

| Layer                                  | What it does                                                                                  | Run by   | Time   |
|----------------------------------------|----------------------------------------------------------------------------------------------|----------|--------|
| 1. Engine-level batch runner           | 13 fixtures × 12 invariants + 2 static checks → JSON + markdown summary                       | offline  | ~10s   |
| 2. Agent reviews (tax / financier / PM)| Three sub-agent reviews of headline outputs against assumption pack                           | manual   | 5 min  |
| 3. Live UAT walkthrough                | Click through prod, validate UI / persistence / cashflow / checks tabs                        | manual   | 25 min |
| 4. Compile regression report           | Fill the DOCX template with runner output, sub-agent verdicts, UAT sign-off                   | manual   | 10 min |

The engine runner is fully offline. Layers 2–4 are human-driven and only needed
if engine-runner is GREEN.

## Layer 1 — Engine runner

```bash
cd app
npm run regression
```

Or directly:

```bash
npx tsx regression-pack/regression-runner.ts
```

**What happens.** The script loads each `regression-pack/fixtures/*.json` payload,
runs `runCalculations(admin, inputs)` on it, and asserts twelve invariants from
`invariants.md` (the engine-class subset). It also runs two static checks (DSCR
removal, persistVersion === 5).

**Output.**

- `regression-pack/results/<timestamp>.json` — machine-readable result
- `regression-pack/results/<timestamp>.md`   — human-readable summary

**Verdict.**

- **GREEN** — `pass=N, fail=0, skip=0` for some N. Safe to proceed to UAT.
- **RED**   — any FAIL. Stop. Open the markdown file's "Failures" section.
  Each entry includes the fixture, invariant ID, observed values, and tolerance.
  Cross-reference with `invariants.md` for the canonical statement.

**Performance.** Roughly 6–10 seconds end-to-end on a current MacBook. The
engine itself is the bottleneck.

## Layer 2 — Sub-agent reviews

Three template prompts in `agent-prompts/`:

- `tax.md` — GST treatment, supply classification, withholding s.14-250
- `financier.md` — covenant compliance, auto-sizing, repayment sequence, fees
- `pm.md` — $/sqm benchmarks, margin sanity, scope vs timeline

For each saved fixture in scope of this deploy, fill the placeholders
(`{{PROJECT_NAME}}`, etc.) with the engine output and the assumption pack, then
ask three sub-agents in parallel. Each returns a verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL)
plus a structured WORKS / ISSUES / QUESTIONS block.

**Stop conditions.** Any sub-agent returning `FAIL` blocks the deploy. Multiple
`PASS-WITH-FOLLOWUPS` is acceptable — log them as next-batch P2 items.

## Layer 3 — Live UAT walkthrough

Follow `live-uat-checklist.md` against the latest Vercel deploy URL. Six sections,
~25 minutes total. Each section has explicit pass criteria. Sign-off block at
the bottom.

This catches: stuck loading states, broken persistence, mis-rendered widgets,
visible NaN, copy/paste / drag-drop UI bugs — anything the offline engine runner
can't see.

## Layer 4 — Regression report

Fill in `regression-report-template.docx` with the four layers' outputs:

1. Executive verdict + ship recommendation
2. Per-fixture invariant matrix (tick/cross grid)
3. Top issues (if any)
4. Sub-agent verdicts
5. Live UAT walkthrough result
6. Sign-off block

Output the filled report to `~/Documents/.../<feature>_Regression_Report.docx`
or upload to Drive.

## Interpretation rules

| Situation                                                | Action                                                                       |
|---------------------------------------------------------|------------------------------------------------------------------------------|
| Engine runner GREEN, all 3 sub-agents PASS, live UAT clean | **SHIP**                                                                  |
| Engine runner GREEN, sub-agents PASS-WITH-FOLLOWUPS only | **SHIP** + log followups                                                     |
| Engine runner RED on baseline-historical fixtures        | **HOLD** — investigate before any further work                               |
| Engine runner GREEN, live UAT issue                      | **HOLD** if BLOCKER-severity; SHIP otherwise + log                          |
| Engine runner GREEN, sub-agent FAIL                      | **HOLD** — sub-agent caught something the invariants don't cover            |
| Engine runner GREEN but a fixture's outputs differ materially from the baseline despite all-PASS | **INVESTIGATE** — the runner only catches what's in `invariants.md`. The baseline file lets you spot silent drift. |

## Adding a new fixture

1. Add a new entry to `fixtures/_generate.mjs` with a slug, project name, and
   any deltas off the Project Demo baseline.
2. Run `node regression-pack/fixtures/_generate.mjs` to write the JSON +
   metadata.md.
3. Run the runner to confirm the fixture passes (it will load and process the
   new fixture automatically — just `*.json` discovery).

## Adding a new invariant

1. Add the canonical statement + code reference + test method to `invariants.md`.
2. Add a `checkXX_*` function in `regression-runner.ts`.
3. Wire it into the `checks` array in `runFixture()`.
4. Re-run; confirm it passes on baseline. If a fixture is now newly failing,
   that's a real regression — investigate before merging the invariant.
5. Update the matrix column list in `regression-report-template.docx`.

## Baseline files

The most recent green baseline is the file in `results/` named
`baseline-<commit>-<timestamp>.{json,md}`. New regression runs should be diffed
against the baseline (any newly-failing invariant is a regression to ship-block;
any newly-passing invariant is a tighter assertion to celebrate).

To capture a new baseline (rare — only after a known-good deploy + audit):

```bash
cd app && npm run regression
cp regression-pack/results/<latest>.json   regression-pack/results/baseline-$(git rev-parse --short HEAD)-$(date +%Y-%m-%d).json
cp regression-pack/results/<latest>.md     regression-pack/results/baseline-$(git rev-parse --short HEAD)-$(date +%Y-%m-%d).md
git add regression-pack/results/baseline-*
git commit -m "chore(regression): refresh baseline at $(git rev-parse --short HEAD)"
```

## Layout

```
regression-pack/
├── README.md                          ← this file
├── invariants.md                      ← canonical invariant list
├── regression-runner.ts               ← offline runner
├── regression-report-template.docx    ← polished report template
├── live-uat-checklist.md              ← human UAT walkthrough
├── fixtures/
│   ├── _generate.mjs                  ← regenerate fixtures from defaults
│   ├── <slug>.json                    ← per-fixture payload (13 of these)
│   └── <slug>.metadata.md             ← per-fixture metadata (13 of these)
├── agent-prompts/
│   ├── tax.md
│   ├── financier.md
│   └── pm.md
└── results/
    ├── <timestamp>.json               ← per-run runner output
    ├── <timestamp>.md                 ← per-run human summary
    └── baseline-<commit>-<ts>.{json,md} ← committed baseline reference
```

## Limitations

- Synthetic fixtures (all 13) are reconstructed from Project Demo defaults +
  per-fixture overrides, not scraped from prod localStorage. This is fine for
  invariant testing but doesn't validate prod-specific input states. To capture
  a truly verbatim prod fixture, scrape `localStorage.getItem('pencil-storage-v3')`
  (or the current versioned key) from a logged-in browser tab and replace
  the synthetic file. Mark `synthetic: false` in the JSON.
- The runner doesn't drive the UI — UI invariants live in `live-uat-checklist.md`.
- Zustand `persist` migrations are tested by existing unit tests
  (`store/__tests__/migrationCR1.test.ts`), not by this runner.
- The runner relies on the engine's TypeScript compiling cleanly — any TS
  error in `app/src/engine/` will surface as a tsx import failure.

## Escalate vs ship — quick rule

Ship if and only if: engine runner GREEN ∧ all sub-agents PASS-or-PASS-WITH-FOLLOWUPS
∧ live UAT has no BLOCKER-severity issue. Otherwise hold.
