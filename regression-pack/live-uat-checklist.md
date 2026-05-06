# Live UAT Checklist — Pencil DM Feasibility prod walkthrough

This is the human-in-the-loop UAT that runs AFTER the engine-level regression
runner is green. It covers the UI / rendering / interaction surface that the
runner cannot validate offline.

**When to run:** every Vercel deploy that touches the engine, the dashboards,
the input UI, the persistence layer, or anything in `app/src/components/`.
Skip for lint-only / docs-only PRs.

**Time budget:** 25–35 minutes for the full sweep.

**Prerequisites**
- Latest deploy is live on https://pencil.capconnex.com.au
- A logged-in user account with the standard saved fixtures (Project Demo,
  Project Demo 2, Project Test, Sydney Tower Test v1, Melbourne Mid-Rise
  Test, Melbourne Mid-Rise Test — MixedUse-v1, Sydney Tower Test —
  UAT_Mock_BrisbaneMidRise)
- Browser DevTools open (Console + Network tab — watch for 4xx / 5xx)

---

## Section 1 — Smoke (per saved project, 3 min each)

For each saved project in the list above:

1. Open project from the project picker.
2. Wait for dashboard to render (no spinner, no "calculating…" stuck state).
3. **Console:** zero red errors. Yellow warnings OK.
4. **Network:** no 4xx / 5xx requests after initial load.
5. Header shows the correct project name and version label.
6. Active tab is "Input" by default.

✅ **Pass criterion:** all six checks for every saved project. Anything red:
escalate before sign-off.

---

## Section 2 — Dashboard (per saved project, 5 min each)

Switch to the **Dashboard** tab. Verify:

| Check                                     | Pass criterion |
|-------------------------------------------|----------------|
| Total GRV / Total Cost / Total Profit     | All three are non-zero finite numbers (or correctly labelled "N/A" on a zero-revenue fixture) |
| Capital Stack widget                       | All bars visible; equity LVR(NRV) cell is **em-dash** not a number; "Committed" and "Peak Outstanding" columns labelled clearly |
| KPI tiles                                 | IRR / Total CCR display "N/M (loss)" on loss-making fixtures (don't show negative %) |
| Peak Exposure                             | Peak debt / equity / month-of-peak all display |
| Profit Share Balance                      | Either zero or correctly-labelled-and-bounded magnitude (not $410M-style nonsense from B06) |
| Solver diagnostics (Engine status)        | Shows "Converged in N iterations" — not "Did not converge" |

✅ **Pass criterion:** all checks pass. Any single fail → list under Issues.

---

## Section 3 — Cashflow tab (per saved project, 5 min)

Switch to **Cashflow** and verify:

1. Number of rows = `projectSpanMonths` (read from Inputs > Preliminary).
2. **Closing balance** column = running cumulative net cashflow row-by-row.
   Spot-check 3 rows.
3. The final-row balance is approximately zero on a profitable project (residual
   < $10k).
4. **GST Withholding** row is visible IFF `applyGSTWithholding=true`.
5. **No NaN / Infinity** anywhere.
6. Stakeholder-trust deposit (if a payment stage labelled "Deposit In Trust")
   appears as a separate column / line, NOT mixed into equity injection.

✅ **Pass criterion:** all 6 conditions hold.

---

## Section 4 — Checks tab (per saved project, 4 min)

Switch to **Checks** and verify:

1. Total checks count is reasonable (typically 21–43 depending on facility mix).
2. PASS / WARN / FAIL counts shown at top.
3. **N/A** statuses (B07) displayed as collapsed grey rows with "skipped because
   X" reason — NOT as "21 total" silently hiding 4 omitted checks.
4. INFO-class messages (e.g. "Land Loan IPF=3") show with INFO badge, NOT in
   the WARN bucket (B08 invariant).
5. Per-iteration consolidator working: any covenant-overshoot or project-default
   appears as ONE summary line, not N copies (Q1/H1/H4 invariant).
6. Drilling into a FAIL shows actionable detail: numbers + the relevant code
   section name.

✅ **Pass criterion:** all 6 conditions hold.

---

## Section 5 — Input UI smoke (5 min, on Project Demo)

On the **Input** tab:

1. Edit a single field (e.g. landPurchasePrice) — wait for debounced re-calc.
   The Dashboard updates within ~500ms.
2. Reload the browser. Persistence works: the edited value is restored.
3. Save As / Save Project — round-trip works (open it back from the picker).
4. **Actuals tab** (if visible): per-line-item actuals input grid renders;
   typing a value updates the construction-cost row in real time. Excel
   import button visible.
5. **Reset to defaults** — clears the edit and restores defaultInputs.

---

## Section 6 — Schema migration smoke (one-shot, 2 min)

1. Open browser DevTools → Application → Local Storage → pencil-storage-v3
   (or current key).
2. Confirm `state.version === 5`.
3. (Optional, manual) — temporarily set `version` to 4 in localStorage,
   reload. Engine should run the v4→v5 migration silently and re-set version
   to 5. No data loss; repaymentSequence backfilled.

---

## Section 7 — Branding (1 min, optional)

If `appName` / `logoDataUrl` / `appBgColor` / `faviconDataUrl` set in admin:
header and tab favicon both reflect them.

---

## Sign-off

```
Reviewer:     _________________________
Date / time:  _________________________
Build commit: _________________________
Result:       ☐ ALL GREEN — safe to ship
              ☐ ISSUES FOUND (list below) — block ship until resolved

Issues:
1.
2.
3.
```

If any issue is BLOCKER-severity, stop the deploy and revert. PASS-WITH-FOLLOWUPS
items can ship; log them as next-batch P2 tickets.
