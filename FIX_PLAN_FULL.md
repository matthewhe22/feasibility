# Pencil DM Feasibility — Combined Fix Plan (post-Batch-1)

This is the truth-of-the-list for the work on branch `fix/dscr-removal-and-batch-2-4`. Items deduped across the v2 UAT report (`pencil_mock_uat_report_v2.md`) and the Melbourne UAT (`Melbourne_MixedUse_UAT_Report.docx`), with DSCR-only items removed.

Severity: **P0** = blocks lender / IC / governance use; **P1** = ship before next milestone; **P2** = polish.

## R-DSCR — Wholesale removal
Remove DSCR entirely: `DSCRSummary`, `data.dscr`, Table 12, Checks DSCR rows, `admin.dscrTarget`, all defaults. Persist v3→v4 migration that strips `dscrTarget` from saved `admin` blobs. Acceptance: `git grep -i dscr app/src` returns zero hits in non-test code.

## GST
- **G1 P0** Reconcile Table 1 vs Table 13 net GST.
- **G2 P0** Land cost apportionment to margin-scheme supplies (Div 75 / GSTR 2006/1).
- **G3 P0** Standard-rate retail (revenueType-driven supply type).
- **G4 P0** Disallow Input-Taxed + ITC>0 combinations; warn / zero-out.
- **G5 P1** Default `applyGSTWithholding` ON for residential.
- **G6 P1** Default `itcRecoveryLagMonths` to 1 (was 0).
- **G7 P1** Stamp-duty sanity check warning.
- **G8 P2** Add Table 1 vs Table 13 reconciliation check.

## Debt
- **D1 P0** Enforce facility limits (mezz, senior).
- **D2 P0** Land Loan interest accrual into the cashflow row.
- **D3 P0** Surface LVR/LTC covenant breaches (default LVR ≤ 65%, LTC ≤ 75%).
- **D4 P0** Capital Stack must equal Total Cost.
- **D5 P1** Separate "Coupon" from "All-in" rate; same BBSY across senior tranches.
- **D6 P2** Peak Senior balance check upgrade INFO → PASS/FAIL.

## Cashflow
- **C1 P0** Cashflow horizon = `projectSpanMonths`.
- **C2 P0** Balance "Total" cells show closing balance, not sum-of-monthlies.

## Dashboard
- **Dh1 P0** Table 11 GRV Summary by `revenueType`; clamp Unsold ≥ 0.
- **Dh2 P0** Table 9 Sales Commencement = `min(grvItems.preSaleExchangeMonth)`.
- **Dh3 P0** IRR display clip at ±999%.
- **Dh4 P1** Total Cash on Cash signed numerator.
- **Dh5 P1** Unsold GRV ≥ 0; warn.

## Checks
- **Ch1 P0** PM Fee variance check uses engine's iterative formula.
- **Ch2 P1** Bucket funding warnings under "Funding" not "S-Curves".
- **Ch3 P1** De-dupe duplicate funding warnings by message + period.
- **Ch4 P2** Net-GST reconciliation check (G8).

## UI / Labels
- **U1 P1** "Equity principal fully returned" mislabelled on loss-making projects.
- **U2 P2** Saved Projects "(0)" flicker.

## Out of scope
Demolition / OSD / public-domain cost lines (PM template territory), 5% vs 7-10% contingency (user assumption), VIC CIPT line item, GST anti-avoidance routing (legal scope).
