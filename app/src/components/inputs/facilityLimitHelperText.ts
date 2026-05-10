/**
 * Pure helper — Facility Limit input helper-text decision.
 *
 * Lives in its own module so it can be unit-tested without React and so
 * `FinancingInputs.tsx` keeps a clean component-only export surface (the
 * react-refresh/only-export-components lint rule disallows exporting
 * non-component values from a component file).
 *
 * Issue 1 (review batch): residual stock facilities are NOT in the
 * timing-aware shrink loop in funding.ts (PrincipalCapOverrides only
 * covers senior, senior2, mezz, landLoan). The capitalised-cap helper
 * text would be a false promise here, so we surface a manual-adjustment
 * caveat instead.
 */
export function getFacilityLimitHelperText(
  facility: { isCapitalised?: boolean },
  isResidualStock = false,
): string {
  const isCap = !!facility.isCapitalised;
  if (isResidualStock) {
    return isCap
      ? "Maximum committed principal. Residual stock facilities are not auto-sized — adjust this manually if cap-int compounding would breach the lender's covenant."
      : "Maximum principal drawn. Interest is paid as cash and doesn't add to outstanding balance.";
  }
  return isCap
    ? 'Maximum outstanding balance (includes accrued interest). Engine dynamically sizes principal during drawdown to keep peak balance within this limit.'
    : "Maximum principal drawn. Interest is paid as cash and doesn't add to outstanding balance.";
}
