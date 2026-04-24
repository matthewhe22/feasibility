/**
 * Standard build S-curves (12–60 months) for construction cost distribution.
 *
 * The curves follow a smooth parabolic-bell profile peaking around 55–60%
 * through the build period — a reasonable default for typical high-rise
 * residential and mixed-use projects. Each array sums to 1.0.
 *
 * Use these as a starting point; users should override via the Admin tab
 * (Manual S-curve upload) with project-specific or QS-validated curves
 * when available.
 */

/** Generate a smooth build S-curve of N months. Peak shifted slightly past mid-build. */
function generateBuildCurve(months: number): number[] {
  const weights: number[] = [];
  const peak = months * 0.55; // peak at ~55% through build
  const spread = months / 3.5;  // controls width of the curve
  let sum = 0;
  for (let i = 0; i < months; i++) {
    const t = i + 0.5; // mid-point of each month
    const w = Math.exp(-Math.pow((t - peak) / spread, 2));
    weights.push(w);
    sum += w;
  }
  return weights.map(w => w / sum);
}

/**
 * Pre-populated standard build S-curves keyed by build duration (12 to 60 months).
 * Each curve is an array of monthly weights summing to 1.0.
 */
export const STANDARD_BUILD_S_CURVES: Record<number, number[]> = Object.fromEntries(
  Array.from({ length: 49 }, (_, i) => {
    const months = 12 + i;
    return [months, generateBuildCurve(months)];
  })
);

/**
 * Returns a deep clone of the standard curves — useful when merging into the
 * admin config without mutating the shared source.
 */
export function cloneStandardBuildSCurves(): Record<number, number[]> {
  return Object.fromEntries(
    Object.entries(STANDARD_BUILD_S_CURVES).map(([k, v]) => [Number(k), [...v]])
  );
}
