import type { CompetitorScope } from '../components/research/RetirementVillageResearch';

/** "Sales since 2025-10-22 and current listings within 5 km. Excluded: 3 older sales, …" */
export function scopeText(sc: CompetitorScope): string {
  const dropped = [
    sc.excludedOldSales && `${sc.excludedOldSales} sale${sc.excludedOldSales > 1 ? 's' : ''} older than 12 months`,

    sc.excludedOutsideRadius && `${sc.excludedOutsideRadius} unit${sc.excludedOutsideRadius > 1 ? 's' : ''} beyond ${sc.radiusKm} km`,
  ].filter(Boolean);
  const undated = sc.undatedSalesKept ?? 0;
  return `Scope: sales since ${sc.soldSince} and current listings, within ${sc.radiusKm} km.` +
    (dropped.length ? ` Excluded: ${dropped.join(', ')}.` : '') +
    (undated ? ` ${undated} sale${undated > 1 ? 's' : ''} kept with no published date (flagged in the row note).` : '');
}
