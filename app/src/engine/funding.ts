import type { Period, MainInputs, DebtFacility } from '../types';
import { sum } from '../utils';

// ===========================================================================
// FUNDING WARNINGS — two-tier accumulator.
//
// Tier 1: `_fundingWarnings` (string[]) — one-shot warnings emitted ONCE per
//   model run from non-iterative emit sites (land-loan timing, project default,
//   misconfiguration notes). Deduped by exact string in `getFundingWarnings`.
//
// Tier 2: `_pendingFundingState` (per-(kind,facility) accumulator) — per-period
//   findings that the iterative solver would otherwise emit dozens of times as
//   $X drifts each iteration. Reset at the START of each iteration; the LAST
//   iteration's data is the converged truth. Flushed once after the outer loop
//   into `_summaryWarnings`. Each call to solveFunding overwrites the prior
//   call's summaries (by stable key), so the prelim+final solve pair produces
//   ONE summary per (kind, facility), not two.
//
// The split exists because an array dedupe by exact string can't catch
// "Period 36 balance $111,591,453" vs "Period 37 balance $112,398,091" — same
// underlying covenant breach, different cents. Q1 fix: consolidate at source.
// ===========================================================================

const _fundingWarnings: string[] = [];

interface CovenantOvershoot {
  peakBalance: number;
  cap: number;
  peakPeriod: number;
  affectedPeriods: Set<number>;
  // Bug A — Two-tier severity routing. We need to know at flush time whether
  // the binding cap was a real lender covenant (LTC×TDC, LVR×NRV) vs the
  // engine's internal back-solved principal cap derived from facilityLimit.
  // - 'covenant' (LTC/LVR was the binding cap): a peak above this is a real
  //   lender covenant breach → WARN severity.
  // - 'facility' (back-solved principal cap derived from facilityLimit was
  //   binding): a peak above this is only a real lender breach if
  //   `peak > facilityLimit`. If `peak ≤ facilityLimit`, the engine's
  //   timing-aware principal cap converged below the user's true facility
  //   limit and the slip is internal — emit as INFO, not WARN.
  // `facilityLimit` is the user-set headline limit (un-back-solved); needed
  // at flush so we can decide WARN vs INFO without refetching inputs.
  bindingKind: 'covenant' | 'facility';
  facilityLimit: number;
}
interface AutoSize {
  requested: number;
  finalPeak: number;
  cap: number;
}
interface EquityBackstopOvershoot {
  peakAmount: number;
  peakCap: number;
  peakPeriod: number;
  affectedPeriods: Set<number>;
}

interface ProjectDefault {
  peakRemainingDebt: number;
  peakPeriod: number;
  affectedPeriods: Set<number>;
}

interface CapIntCeilingHit {
  totalCashSwitched: number;
  affectedPeriods: Set<number>;
}

interface MinEquityShortfall {
  actual: number;
  required: number;
  basisAmount: number;
  basisName: 'TDC' | 'TDC + financing costs';
  mode: 'percent' | 'amount';
  modeValue: number;
}

// Bug B — Equity-cap overshoot.
//
// The user enters a `equityDeveloper.equityCap` (and optionally
// `equityJV.equityCap`) on the Financing tab — that's the term-sheet equity
// commitment the developer is holding to. The engine has TWO mechanisms that
// can push `cumulativeEquityDeveloperDrawn` ABOVE that cap silently:
//
//   1. `minEquityRequirement` floor enforcement — pre-funds equity to meet the
//      term-sheet floor, ignoring the equity cap.
//   2. `equity-of-last-resort` backstop — when senior+mezz can't fund a
//      negative bank balance, equity fills the gap regardless of cap.
//
// Both are correct cash-mechanics behaviour (something has to fill a real
// funding gap), but a financier reading the Internal Dashboard sees
// `Equity drawn = $24.12M` while the user-set cap is `$16.5M` — no flag, no
// warning, no signal that the stated commitment was exceeded. The capital
// stack on the term sheet is misleading.
//
// Fix: at end of converged solve compare cumulativeEquityDeveloperDrawn to
// equityCap (when cap > 0) and route through the [FUNDING] consolidator with
// three severity tiers:
//   • overshoot ≤ 5% of cap         → INFO   (small auto-backstop, expected)
//   • 5% < overshoot ≤ 20%          → WARN   (real cap breach)
//   • overshoot > 20% OR > cap×1.5  → FAIL   (stack fundamentally inconsistent)
//
// Same logic for equityJV.equityCap when non-zero.
//
// `fundingGap` is the implied auto-backstopped amount = max(0, drawn − cap).
interface EquityCapOvershoot {
  entity: 'developer' | 'jv';
  drawn: number;
  cap: number;
  overshoot: number;          // = max(0, drawn − cap)
  overshootPct: number;       // = overshoot / cap (1.0 = 100%)
  severity: 'info' | 'warn' | 'fail';
  fundingGap: number;         // auto-backstopped to fill funding gap
}

interface PendingFundingState {
  covenantOvershoot: Map<string, CovenantOvershoot>;
  autoSize: Map<string, AutoSize>;
  facilityLimitOvershoot: Map<string, CovenantOvershoot>;
  equityBackstop: EquityBackstopOvershoot | null;
  projectDefault: ProjectDefault | null;
  capIntCeiling: Map<string, CapIntCeilingHit>;
  minEquityShortfall: MinEquityShortfall | null;
  // Bug B — populated post-solve in solveFunding via recordEquityCapOvershoot.
  // Map keyed by entity ('developer' | 'jv') so a project with both Developer
  // and JV equity can flag both independently. Cleared per solve (final wins).
  equityCapOvershoot: Map<'developer' | 'jv', EquityCapOvershoot>;
}

const _pendingFundingState: PendingFundingState = {
  covenantOvershoot: new Map(),
  autoSize: new Map(),
  facilityLimitOvershoot: new Map(),
  equityBackstop: null,
  projectDefault: null,
  capIntCeiling: new Map(),
  minEquityShortfall: null,
  equityCapOvershoot: new Map(),
};

const _summaryWarnings = new Map<string, string>();

function resetPendingFundingState(): void {
  _pendingFundingState.covenantOvershoot.clear();
  _pendingFundingState.autoSize.clear();
  _pendingFundingState.facilityLimitOvershoot.clear();
  _pendingFundingState.equityBackstop = null;
  _pendingFundingState.projectDefault = null;
  _pendingFundingState.capIntCeiling.clear();
  _pendingFundingState.minEquityShortfall = null;
  _pendingFundingState.equityCapOvershoot.clear();
}

function recordCapIntCeilingHit(facility: string, period: number, cashAmount: number): void {
  // FU2 — when capitalised interest would push senior balance above its M4
  // covenant cap for a period, the engine pays that period's interest in cash
  // instead of capitalising it. Track the affected periods + total cash-switched
  // amount so we can surface ONE consolidated [INFO] message at the end of solve.
  const cur = _pendingFundingState.capIntCeiling.get(facility);
  if (!cur) {
    _pendingFundingState.capIntCeiling.set(facility, { totalCashSwitched: cashAmount, affectedPeriods: new Set([period]) });
  } else {
    cur.totalCashSwitched += cashAmount;
    cur.affectedPeriods.add(period);
  }
}

function facilityLabel(key: string): string {
  switch (key) {
    case 'senior': return 'Senior #1';
    case 'senior2': return 'Senior #2';
    case 'mezz': return 'Mezz';
    default: return key;
  }
}

function recordCovenantOvershoot(
  facility: string,
  period: number,
  balance: number,
  cap: number,
  bindingKind: 'covenant' | 'facility',
  facilityLimit: number,
): void {
  const m = _pendingFundingState.covenantOvershoot;
  const cur = m.get(facility);
  if (!cur) {
    m.set(facility, {
      peakBalance: balance, cap, peakPeriod: period,
      affectedPeriods: new Set([period]),
      bindingKind, facilityLimit,
    });
  } else {
    cur.affectedPeriods.add(period);
    if (balance > cur.peakBalance) { cur.peakBalance = balance; cur.peakPeriod = period; }
    if (cap > cur.cap) cur.cap = cap;
    // Bug A — bindingKind escalates to 'covenant' if any period was bound by
    // the real LTC/LVR covenant. If ANY period saw a covenant-bound peak, the
    // overall summary should reflect a real covenant breach (WARN). A pure
    // facility-bound run only flips to INFO when no covenant breach occurred.
    if (bindingKind === 'covenant') cur.bindingKind = 'covenant';
    if (facilityLimit > cur.facilityLimit) cur.facilityLimit = facilityLimit;
  }
}

function recordFacilityLimitOvershoot(facility: string, period: number, balance: number, limit: number): void {
  // Bug A — kept as a sibling helper for the (currently empty) flush path
  // through `_pendingFundingState.facilityLimitOvershoot`. All per-period
  // emit sites now route through `recordCovenantOvershoot` with the proper
  // bindingKind so the two-tier WARN/INFO routing applies uniformly. Future
  // callers wanting a "definitely a real facility-limit breach" code path
  // can use this without going through the bindingKind decision tree.
  const m = _pendingFundingState.facilityLimitOvershoot;
  const cur = m.get(facility);
  if (!cur) {
    m.set(facility, {
      peakBalance: balance, cap: limit, peakPeriod: period,
      affectedPeriods: new Set([period]),
      bindingKind: 'facility', facilityLimit: limit,
    });
  } else {
    cur.affectedPeriods.add(period);
    if (balance > cur.peakBalance) { cur.peakBalance = balance; cur.peakPeriod = period; }
  }
}
// Suppress TS6133 for the currently-unused helper — see comment above.
void recordFacilityLimitOvershoot;

function recordAutoSize(facility: string, requested: number, finalPeak: number, cap: number): void {
  const m = _pendingFundingState.autoSize;
  const cur = m.get(facility);
  if (!cur) {
    m.set(facility, { requested, finalPeak, cap });
  } else {
    if (finalPeak > cur.finalPeak) cur.finalPeak = finalPeak;
  }
}

function recordEquityBackstopOvershoot(period: number, amount: number, cap: number): void {
  const cur = _pendingFundingState.equityBackstop;
  if (!cur) {
    _pendingFundingState.equityBackstop = {
      peakAmount: amount, peakCap: cap, peakPeriod: period, affectedPeriods: new Set([period]),
    };
  } else {
    cur.affectedPeriods.add(period);
    if (amount > cur.peakAmount) { cur.peakAmount = amount; cur.peakPeriod = period; cur.peakCap = cap; }
  }
}

function recordProjectDefault(period: number, remainingDebt: number): void {
  // B02 — Same per-iteration spam pattern as covenant overshoots: each
  // iteration's residual debt drifts by a few dollars, escapes Set-dedupe.
  // Consolidate to ONE summary message at end of converged solve.
  const cur = _pendingFundingState.projectDefault;
  if (!cur) {
    _pendingFundingState.projectDefault = {
      peakRemainingDebt: remainingDebt, peakPeriod: period, affectedPeriods: new Set([period]),
    };
  } else {
    cur.affectedPeriods.add(period);
    if (remainingDebt > cur.peakRemainingDebt) { cur.peakRemainingDebt = remainingDebt; cur.peakPeriod = period; }
  }
}

function recordMinEquityShortfall(
  actual: number,
  required: number,
  basisAmount: number,
  basisName: 'TDC' | 'TDC + financing costs',
  mode: 'percent' | 'amount',
  modeValue: number,
): void {
  // V8 — Term-sheet equity floor cross-check. Called ONCE per solveFunding
  // call after convergence, so the recorded values reflect the final
  // converged TDC (the basis-amount post-cap-int settles). The flush below
  // emits ONE consolidated [FUNDING] warning keyed `min-equity-shortfall`,
  // overwritten on the final solve so prelim+final pair surfaces only the
  // final result.
  _pendingFundingState.minEquityShortfall = {
    actual,
    required,
    basisAmount,
    basisName,
    mode,
    modeValue,
  };
}

// Bug B — Equity-cap-overshoot classifier + recorder.
//
// Severity ladder (called once per solve per entity, post-convergence):
//   • drawn ≤ cap (within $1 tolerance) → no record (PASS, nothing to flag)
//   • overshoot ≤ 5% of cap            → INFO  (small auto-backstop, expected
//                                                slop from minEquityRequirement
//                                                rounding or single-period
//                                                gap-fill)
//   • 5% < overshoot ≤ 20%             → WARN  (real cap breach — financier
//                                                should see the term-sheet
//                                                commitment was exceeded)
//   • overshoot > 20% OR drawn > cap×1.5 → FAIL (capital stack is fundamentally
//                                                  inconsistent with stated
//                                                  equity commitment — user
//                                                  must restructure)
function classifyEquityCapOvershoot(
  drawn: number,
  cap: number,
): 'info' | 'warn' | 'fail' | null {
  // $1 tolerance to mirror the min-equity warning emit branch.
  if (drawn <= cap + 1) return null;
  const overshoot = drawn - cap;
  const pct = cap > 0 ? overshoot / cap : Infinity;
  if (drawn > cap * 1.5 || pct > 0.20) return 'fail';
  if (pct > 0.05) return 'warn';
  return 'info';
}

function recordEquityCapOvershoot(
  entity: 'developer' | 'jv',
  drawn: number,
  cap: number,
  fundingGap: number,
): void {
  const severity = classifyEquityCapOvershoot(drawn, cap);
  if (severity === null) {
    // No overshoot — clear any prior solve's record so a prelim-fail/final-pass
    // pair doesn't leave a stale FAIL in summaries.
    _pendingFundingState.equityCapOvershoot.delete(entity);
    return;
  }
  const overshoot = drawn - cap;
  const overshootPct = cap > 0 ? overshoot / cap : Infinity;
  _pendingFundingState.equityCapOvershoot.set(entity, {
    entity, drawn, cap, overshoot, overshootPct, severity,
    fundingGap: Math.max(0, fundingGap),
  });
}

function fmtMoney(n: number): string { return `$${Math.round(n).toLocaleString()}`; }
function fmtPeriodRange(set: Set<number>): string {
  const arr = [...set].sort((a, b) => a - b);
  if (arr.length === 0) return '';
  if (arr.length === 1) return `month ${arr[0]}`;
  // detect contiguous run
  const min = arr[0]!, max = arr[arr.length - 1]!;
  if (max - min === arr.length - 1) return `months ${min}–${max}`;
  if (arr.length <= 4) return `months ${arr.join(', ')}`;
  return `months ${min}–${max} (${arr.length} periods)`;
}

function flushPendingFundingSummaries(): void {
  // Convert accumulated state to consolidated messages. Stable keys mean a
  // second solveFunding call (final after prelim) overwrites prior summaries.

  for (const [facility, info] of _pendingFundingState.covenantOvershoot) {
    // Bug A — Two-tier severity routing.
    //
    // Pre-fix the engine emitted a single [FUNDING] WARN whenever the peak
    // balance exceeded the engine's *internal* back-solved target. With the
    // closed-form back-solve assuming day-0 worst-case draw, the internal
    // target was up to ~28% below the lender's actual facility limit on
    // capitalised facilities — so the WARN fired for slips that the lender
    // wouldn't even see (the peak was still well within the headline limit).
    //
    // Post-fix: route the message based on what was actually breached.
    //   • bindingKind === 'covenant'   → real LTC/LVR breach. WARN.
    //   • bindingKind === 'facility' AND peak > facilityLimit
    //                                  → real lender breach of headline limit. WARN.
    //   • bindingKind === 'facility' AND peak ≤ facilityLimit
    //                                  → engine's timing-aware target was
    //                                    overshot by a small amount but the
    //                                    real lender limit still has headroom.
    //                                    INFO, not WARN — no real-world breach.
    const overshoot = info.peakBalance - info.cap;
    if (info.bindingKind === 'covenant') {
      const msg =
        `[FUNDING] ${facilityLabel(facility)} covenant cap exceeded by ${fmtMoney(overshoot)} ` +
        `— peak ${fmtMoney(info.peakBalance)} vs cap ${fmtMoney(info.cap)} ` +
        `(peak month ${info.peakPeriod}, affected ${fmtPeriodRange(info.affectedPeriods)}). ` +
        `Capitalised interest pushed balance above LTC/LVR ceiling — restructure: pay interest ` +
        `current or increase commitment.`;
      _summaryWarnings.set(`covenant-overshoot:${facility}`, msg);
    } else if (Number.isFinite(info.facilityLimit) && info.peakBalance > info.facilityLimit + 1) {
      // bindingKind === 'facility' AND real lender breach.
      const limitOvershoot = info.peakBalance - info.facilityLimit;
      const msg =
        `[FUNDING] ${facilityLabel(facility)} covenant cap exceeded by ${fmtMoney(limitOvershoot)} ` +
        `— peak ${fmtMoney(info.peakBalance)} vs facility limit ${fmtMoney(info.facilityLimit)} ` +
        `(peak month ${info.peakPeriod}, affected ${fmtPeriodRange(info.affectedPeriods)}). ` +
        `Capitalised interest pushed balance above committed facility limit — restructure: pay interest ` +
        `current or increase commitment.`;
      _summaryWarnings.set(`covenant-overshoot:${facility}`, msg);
    } else {
      // Internal slip only — peak is above the engine's timing-aware
      // back-solved target but still within the lender's facility limit.
      // Emit as INFO so dashboards / Checks tab can route to the info channel.
      const headroom = Number.isFinite(info.facilityLimit)
        ? Math.max(0, info.facilityLimit - info.peakBalance)
        : Infinity;
      const headroomLabel = Number.isFinite(headroom) ? fmtMoney(headroom) : 'covenant slack';
      const limitLabel = Number.isFinite(info.facilityLimit) ? fmtMoney(info.facilityLimit) : 'unconstrained';
      const msg =
        `[INFO] ${facilityLabel(facility)} cap-int slightly above timing-aware target by ${fmtMoney(overshoot)} ` +
        `— peak ${fmtMoney(info.peakBalance)}, target ${fmtMoney(info.cap)}, ` +
        `facility limit ${limitLabel} still has ${headroomLabel} headroom ` +
        `(peak month ${info.peakPeriod}, affected ${fmtPeriodRange(info.affectedPeriods)}). ` +
        `Engine's back-solved principal cap was a touch tight; no real lender breach.`;
      _summaryWarnings.set(`covenant-overshoot:${facility}`, msg);
    }
  }

  for (const [facility, info] of _pendingFundingState.facilityLimitOvershoot) {
    // Bug A — facilityLimitOvershoot is reserved for direct comparisons
    // against the user's headline facilityLimit (peak > facilityLimit by
    // construction), so this is always a real lender breach. WARN.
    const overshoot = info.peakBalance - info.cap;
    const msg =
      `[FUNDING] ${facilityLabel(facility)} covenant cap exceeded by ${fmtMoney(overshoot)} ` +
      `— peak ${fmtMoney(info.peakBalance)} vs facility limit ${fmtMoney(info.cap)} ` +
      `(peak month ${info.peakPeriod}, affected ${fmtPeriodRange(info.affectedPeriods)}). ` +
      `Capitalised interest pushed balance above committed facility limit.`;
    _summaryWarnings.set(`limit-overshoot:${facility}`, msg);
  }

  for (const [facility, info] of _pendingFundingState.autoSize) {
    const msg =
      `[INFO] Auto-sized ${facilityLabel(facility)} ${fmtMoney(info.requested)} → ${fmtMoney(info.finalPeak)} ` +
      `(within covenant cap ${fmtMoney(info.cap)}) to cover cost shortfall. LTC/LVR caps respected.`;
    _summaryWarnings.set(`auto-size:${facility}`, msg);
  }

  if (_pendingFundingState.equityBackstop) {
    const info = _pendingFundingState.equityBackstop;
    const msg =
      `Equity backstop ${fmtMoney(info.peakAmount)} exceeds remaining Developer cap ${fmtMoney(info.peakCap)} ` +
      `(peak month ${info.peakPeriod}, affected ${fmtPeriodRange(info.affectedPeriods)}) — project is underfunded.`;
    _summaryWarnings.set('equity-backstop-overshoot', msg);
  }

  for (const [facility, info] of _pendingFundingState.capIntCeiling) {
    const msg =
      `[INFO] ${facilityLabel(facility)} cap-int exceeds covenant cap at ${fmtPeriodRange(info.affectedPeriods)} ` +
      `— ${fmtMoney(info.totalCashSwitched)} of capitalised interest switched to cash-pay this period(s) to avoid breaching ` +
      `LTC/LVR ceiling. Bank balance absorbed the cash; revenue waterfall sees the same total interest, just timed earlier.`;
    _summaryWarnings.set(`capint-ceiling:${facility}`, msg);
  }

  if (_pendingFundingState.projectDefault) {
    const info = _pendingFundingState.projectDefault;
    const msg =
      `Project default: ${fmtMoney(info.peakRemainingDebt)} of debt unpaid at project end after equity ` +
      `clawback exhausted (residual at period ${info.peakPeriod}). ` +
      `Loss capitalised against equity (not residual debt).`;
    _summaryWarnings.set('project-default', msg);
  }

  if (_pendingFundingState.minEquityShortfall) {
    const info = _pendingFundingState.minEquityShortfall;
    const shortfall = info.required - info.actual;
    const reqLabel = info.mode === 'percent'
      ? `${(info.modeValue * 100).toFixed(2)}% of ${info.basisName} ${fmtMoney(info.basisAmount)}`
      : `${fmtMoney(info.modeValue)}`;
    const msg =
      `[FUNDING] Equity below minimum requirement — actual ${fmtMoney(info.actual)} vs required ${fmtMoney(info.required)} ` +
      `(shortfall ${fmtMoney(shortfall)}, basis: ${reqLabel}).`;
    _summaryWarnings.set('min-equity-shortfall', msg);
  } else {
    // V8 fix — when the FINAL solve passes the floor but a PRELIM solve had
    // recorded a shortfall (e.g. PM fee dropping between solves moved the
    // basis below the actual draws), the stale prelim summary would otherwise
    // persist in `_summaryWarnings`. The only way to drop a stale entry under
    // the existing keyed-Map pattern is an explicit delete on the no-find
    // branch — `set()` only overwrites when there is something to set.
    _summaryWarnings.delete('min-equity-shortfall');
  }

  // Bug B — Equity-cap overshoot. ONE consolidated message per entity per
  // solve; INFO-tier overshoots are still emitted (so dashboards / Checks tab
  // can surface a low-severity hint) but routed through `[INFO]` so the
  // overall page badge doesn't escalate to WARN. WARN/FAIL tiers route as
  // `[FUNDING]` so they cluster with the other funding-cluster warnings.
  for (const entity of ['developer', 'jv'] as const) {
    const info = _pendingFundingState.equityCapOvershoot.get(entity);
    const key = `equity-cap-overshoot:${entity}`;
    if (!info) {
      _summaryWarnings.delete(key);
      continue;
    }
    const label = entity === 'developer' ? 'Developer equity' : 'JV equity';
    const overPct = (info.overshootPct * 100).toFixed(0);
    const tag =
      info.severity === 'fail' ? '[FUNDING] FAIL' :
      info.severity === 'warn' ? '[FUNDING]'      :
      '[INFO]';
    const remedy = info.severity === 'fail'
      ? `Capital stack is fundamentally inconsistent with stated equity commitment — increase equity cap to ${fmtMoney(info.drawn)}+, raise senior/mezz facility, or reduce project scope.`
      : info.severity === 'warn'
      ? `Increase equity cap to ${fmtMoney(info.drawn)}+, raise senior/mezz facility, or reduce project scope.`
      : `Small auto-backstop within tolerance — review if intentional.`;
    const msg =
      `${tag} ${label} drawn ${fmtMoney(info.drawn)} exceeds user-set equity cap ${fmtMoney(info.cap)} ` +
      `by ${fmtMoney(info.overshoot)} (${overPct}% over) — engine auto-backstopped to fill a funding gap of ${fmtMoney(info.fundingGap)}. ` +
      remedy;
    _summaryWarnings.set(key, msg);
  }
}

export function clearFundingWarnings(): void {
  _fundingWarnings.length = 0;
  _summaryWarnings.clear();
  resetPendingFundingState();
}
export function getFundingWarnings(): string[] {
  // Tier 1 (one-shot) deduped by exact string + Tier 2 (consolidated summaries
  // keyed by kind:facility, last solveFunding call wins). solveFunding iterates
  // internally and is called twice from runCalculations (prelim + final).
  return [...new Set(_fundingWarnings), ..._summaryWarnings.values()];
}

// Zero-value facility used as a safe fallback when an optional facility is missing
// (e.g. when loading a project saved before Senior Facility #2 was added).
const EMPTY_FACILITY: DebtFacility = {
  name: '', facilityLimit: 0, startMonth: 0, maturityMonth: 0,
  interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0,
  lineFeePercent: 0, interestPaymentFrequency: 0, isCapitalised: false,
  ltcTarget: 0, lvrTarget: 0, drawdownPriority: 99,
};

// ===== DRAWDOWN SEQUENCE =====

export type DrawdownFacilityType = 'equity' | 'equityJV' | 'senior' | 'senior2' | 'mezz';

/** M3 — Cash-sweep order for the revenue waterfall (project-end repayment). */
export type RepaymentTranche = 'senior' | 'mezz' | 'equity';

export interface DrawdownSequenceEntry {
  type: DrawdownFacilityType;
  name: string;
  priority: number;
}

/**
 * Returns the drawdown sequence for the main funding sources — senior debt (1/2),
 * mezzanine debt, and equity — sorted by their user-configured drawdownPriority
 * (1 = drawn first, higher = drawn later).
 *
 * The land loan is excluded because it is drawn as a fixed lump sum at a specific
 * date and is not part of the flexible gap-filling waterfall.
 */
export function computeDrawdownSequence(inputs: MainInputs): DrawdownSequenceEntry[] {
  const sf   = inputs.seniorFacility;
  const sf2  = inputs.seniorFacility2;
  const mz   = inputs.mezzanine;
  const eq   = inputs.equityDeveloper;
  const eqJV = inputs.equityJV;

  const jvActive = eqJV && (eqJV.equityCap > 0 || eqJV.equityContribution > 0);

  const entries: DrawdownSequenceEntry[] = [
    ...(sf  ? [{ type: 'senior'     as DrawdownFacilityType, name: sf.name,  priority: sf.drawdownPriority  ?? 1 }] : []),
    ...(sf2 ? [{ type: 'senior2'    as DrawdownFacilityType, name: sf2.name, priority: sf2.drawdownPriority ?? 5 }] : []),
    ...(mz  ? [{ type: 'mezz'       as DrawdownFacilityType, name: mz.name,  priority: mz.drawdownPriority  ?? 2 }] : []),
    ...(eq  ? [{ type: 'equity'     as DrawdownFacilityType, name: eq.name,  priority: eq.drawdownPriority  ?? 3 }] : []),
    ...(jvActive ? [{ type: 'equityJV' as DrawdownFacilityType, name: eqJV.name, priority: eqJV.drawdownPriority ?? 4 }] : []),
  ];
  // Sort by priority, then by a deterministic facility-type order for ties.
  // This guarantees draw-down order is reproducible across runs even when two
  // facilities share the same priority.
  return entries.sort((a, b) =>
    a.priority - b.priority || DRAWDOWN_TYPE_ORDER[a.type] - DRAWDOWN_TYPE_ORDER[b.type],
  );
}

/**
 * Deterministic tie-breaker order for facilities sharing the same priority value.
 * Senior debt first → mezzanine → equity. Using `satisfies` makes adding a new
 * DrawdownFacilityType a compile-time error here, so the exhaustive ordering
 * can never silently drop a facility.
 */
const DRAWDOWN_TYPE_ORDER = {
  senior: 0,
  senior2: 1,
  mezz: 2,
  equity: 3,
  equityJV: 4,
} as const satisfies Record<DrawdownFacilityType, number>;

/**
 * Compile-time exhaustiveness assertion — call from the default branch of a
 * switch over DrawdownFacilityType to guarantee TypeScript flags missing cases.
 * If a new facility type is added without handling, this throws at runtime AND
 * fails the typecheck (because `value` would not be `never`).
 */
export function assertNeverDrawdown(value: never): never {
  throw new Error(`Unhandled DrawdownFacilityType: ${JSON.stringify(value)}`);
}

export interface FundingResult {
  // Monthly arrays
  landLoanBalance: number[];
  landLoanDrawdowns: number[];
  landLoanRepayments: number[];
  landLoanInterest: number[];
  landLoanFees: number[];
  /** LL2 — Senior takeout of land loan at construction start. Captures the
   *  amount senior absorbs from the land loan (principal + accrued interest)
   *  in one period for UI display. Underlying flows still appear in
   *  landLoanRepayments[i] and seniorDrawdowns[i]; this memo labels the
   *  combined transaction so the cashflow UI can render one row. */
  landLoanTakeoutBySenior: number[];

  seniorBalance: number[];
  seniorDrawdowns: number[];
  seniorRepayments: number[];
  seniorInterest: number[];
  seniorFees: number[];

  senior2Balance: number[];
  senior2Drawdowns: number[];
  senior2Repayments: number[];
  senior2Interest: number[];
  senior2Fees: number[];

  mezzBalance: number[];
  mezzDrawdowns: number[];
  mezzRepayments: number[];
  mezzInterest: number[];
  mezzFees: number[];

  equityInjections: number[];
  equityRepatriations: number[];
  profitDistributions: number[];
  equityJVInjections: number[];
  equityJVRepatriations: number[];
  jvProfitDistributions: number[];

  // Totals
  totalSeniorInterest: number;
  totalSeniorFees: number;
  totalSenior2Interest: number;
  totalSenior2Fees: number;
  totalMezzInterest: number;
  totalMezzFees: number;
  totalLandLoanInterest: number;
  totalLandLoanFees: number;
  totalEquityInjected: number;
  totalJVEquityInjected: number;
  peakDebt: number;
  peakEquity: number;
  peakEquityMonth: number; // 1-based
  seniorFacilitySize: number;
  seniorFacilityLimit: number;
  senior2FacilitySize: number;
  senior2FacilityLimit: number;
  mezzFacilitySize: number;
  /**
   * Issue 3 — Timing-aware back-solve raw peaks (would-be balance).
   *
   * `seniorFacilitySize` / `senior2FacilitySize` / `mezzFacilitySize` report
   * the POST cap-int ceiling peak — i.e. after FU2 has converted would-be
   * cap-int into cash-pay to keep balance <= covenant cap. That makes them
   * useless as a feedback signal for the timing-aware shrink loop in
   * `solveFunding`: by definition the post-ceiling peak never exceeds the
   * cap, so the outer shrink loop never sees an overshoot and the principal
   * cap never tightens. Result on Dandenong: $30M principal + forced cash-pay
   * overflow instead of the intended $22M principal + $8M cap-int rolling
   * into the same $30M cap.
   *
   * `rawPeak.X` is the WOULD-BE peak. Every period, BEFORE the cap-int
   * ceiling decides whether to capitalise or switch to cash-pay, we
   * accumulate `max(rawPeak.X, currentBalance + would-be-cap-int)`.
   * The outer shrink loop in `solveFunding` compares rawPeak.X against
   * facilityLimit (rather than the post-ceiling peak), so when timing
   * means cap-int would push balance over the cap, we shrink the principal
   * cap proportionally and re-solve. Cash-pay facilities are unaffected:
   * rawPeak.X tracks the running balance directly (no ceiling check fires)
   * so it equals *FacilitySize and the shrink loop is a no-op.
   *
   * Optional because legacy callers (createEmptyResult, direct
   * runFundingWaterfall users in tests) may not populate it; downstream
   * readers should treat undefined as a fallback to *FacilitySize.
   */
  rawPeak?: {
    senior: number;
    senior2: number;
    mezz: number;
    landLoan: number;
  };
  /** Whether the iterative solver converged within tolerance */
  converged: boolean;
  /** Number of iterations actually performed (1..maxIterations) */
  iterations: number;
  /**
   * CR3 — Iteration count at which convergence was achieved, or `null` if the
   * solver hit the iteration cap. Provided for tests / diagnostics that want
   * to assert "we converged with headroom" — `convergedIn < maxIterations`.
   * On known-good fixtures this should be well below the cap (typically 5–20);
   * a value approaching `maxIterations` is a calibration warning, even when
   * `converged === true`.
   */
  convergedIn: number | null;
  /** Final absolute finance-cost delta when solver exited (for diagnostics) */
  convergenceDelta: number;
  /**
   * V8 — Minimum-equity cross-check telemetry. Populated on EVERY solve regardless
   * of whether a shortfall fires, so the Checks tab and any other consumer can
   * read the engine's exact numbers (matching the [FUNDING] warning text). Two
   * earlier consumers (Checks tab + warning) recomputed the basis independently
   * and disagreed under GST-on-costs / lender-fee-GST conditions — funnelling
   * everyone through this struct ends the divergence.
   *
   * - When `minEquityRequirement.value === 0` (disabled): `required: 0`, `actual`
   *   reflects the true draws, `shortfall: 0`, basis is computed for diagnostics.
   * - The `basisAmount` matches the post-converged TDC the engine used (cash
   *   basis incl. recoverable GST + raw funding interest/fees).
   * - `shortfall = max(0, required - actual)` — same tolerance ($1) as the
   *   warning emit branch, so the two ALWAYS agree.
   */
  minEquityCheck: {
    required: number;
    actual: number;
    basisAmount: number;
    basisName: 'TDC' | 'TDC + financing costs';
    shortfall: number;
  };
  /**
   * Bug B — Equity-cap overshoot telemetry from the converged final solve.
   * Single source of truth for the [FUNDING] / [INFO] warning + Checks-tab
   * "Equity within user cap" row. Populated for BOTH entities (developer,
   * jv) regardless of whether either fired — `severity: 'pass'` means the
   * draw came in at or under the user-set cap.
   *
   * - When `equityDeveloper.equityCap === 0` (uncapped / disabled): developer
   *   record returns `severity: 'pass'`, `cap: 0`, with `drawn` reflecting
   *   the true draws — no warning emitted regardless of drawn amount.
   * - When `equityJV` is inactive: jv record returns `severity: 'pass'` with
   *   zeros — no warning emitted.
   * - `fundingGap` is the implied auto-backstopped amount (= overshoot when
   *   overshoot > 0). Lets the Checks tab tell the financier "the engine
   *   auto-injected $X to fill a real funding gap" without recomputing.
   */
  equityCapCheck: {
    developer: {
      drawn: number;
      cap: number;
      overshoot: number;
      overshootPct: number;
      severity: 'pass' | 'info' | 'warn' | 'fail';
      fundingGap: number;
    };
    jv: {
      drawn: number;
      cap: number;
      overshoot: number;
      overshootPct: number;
      severity: 'pass' | 'info' | 'warn' | 'fail';
      fundingGap: number;
    };
  };
}

function periodInterest(balance: number, rate: number, daysInPeriod: number, daysPerYear: number): number {
  if (balance <= 0 || rate <= 0 || daysInPeriod <= 0 || daysPerYear <= 0) return 0;
  return balance * rate * daysInPeriod / daysPerYear;
}

/**
 * Worst-case compound factor for a capitalised facility. Walks every active
 * period from `startIdx` to `endIdx` (inclusive) and accumulates the
 * per-period growth factor `(1 + annualRate * days[t] / daysPerYear)`. Used by
 * `backSolveCapitalisedPrincipalCap` so that the per-period rate matches the
 * engine's daily-rate convention exactly (see `periodInterest`). Returns 1 for
 * degenerate inputs so callers fall back to the un-back-solved limit.
 */
export function capInterestCompoundFactor(
  periods: Period[],
  daysPerYear: number,
  startIdx: number,
  endIdx: number,
  annualRate: number,
): number {
  if (!Number.isFinite(annualRate) || annualRate <= 0) return 1;
  if (!Number.isFinite(daysPerYear) || daysPerYear <= 0) return 1;
  if (startIdx < 0 || endIdx < startIdx) return 1;
  let factor = 1;
  const lastIdx = Math.min(endIdx, periods.length - 1);
  for (let t = startIdx; t <= lastIdx; t++) {
    const days = periods[t]?.daysInPeriod ?? 0;
    if (days <= 0) continue;
    factor *= 1 + (annualRate * days) / daysPerYear;
  }
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/**
 * Back-solve the *principal* cap for a capitalised facility so that the
 * worst-case peak outstanding balance over the loan term stays at-or-below the
 * user-configured `facilityLimit` (which lenders interpret as a covenant cap
 * on peak outstanding balance, NOT a draw cap).
 *
 * Worst case (most conservative): full principal drawn at the first active
 * period, all interest capitalised through to maturity with no repayments:
 *
 *     balance(t)        = principal * prod_{s=start..t} (1 + r_s)
 *     balance(maturity) = principal * prod_{s=start..end} (1 + r_s) = principal * F
 *     balance <= facilityLimit  =>  principal_cap = facilityLimit / F
 *
 * where r_s = annualRate * days[s] / daysPerYear (matches the engine's daily
 * rate convention). For non-capitalised facilities the formula reverts:
 * interest is cash-paid and never adds to balance, so `principal_cap = facilityLimit`.
 *
 * This is conservative: real drawdowns are progressive over construction, so
 * realised cap-int is less than the worst-case here. Erring conservatively
 * protects the lender's covenant. Line fees and establishment fees are NOT
 * included in the back-solve formula - those are caught mid-solve by the FU2
 * cap-int ceiling guard.
 */
export function backSolveCapitalisedPrincipalCap(
  facility: DebtFacility,
  facilityLimit: number,
  periods: Period[],
  daysPerYear: number,
  startIdx: number,
  endIdx: number,
  annualRate: number,
): number {
  if (!facility?.isCapitalised) return facilityLimit;
  if (!Number.isFinite(facilityLimit) || facilityLimit <= 0) return facilityLimit;
  const factor = capInterestCompoundFactor(periods, daysPerYear, startIdx, endIdx, annualRate);
  if (!Number.isFinite(factor) || factor <= 1) return facilityLimit;
  return facilityLimit / factor;
}

/**
 * Returns the line fee basis balance for a given facility configuration.
 *   - 'peak-drawn'         (default): peak drawn balance from the prior solver iteration
 *   - 'committed-limit':   the full committed/approved limit (conservative term-sheet convention)
 *   - 'undrawn-commitment': undrawn portion = max(0, limit − currentDrawn)
 */
function resolveLineFeeBase(
  facility: DebtFacility,
  committedLimit: number,
  currentDrawn: number,
  peakDrawnPrev: number,
): number {
  const basis = facility.lineFeeBasis ?? 'peak-drawn';
  if (basis === 'committed-limit') return committedLimit;
  if (basis === 'undrawn-commitment') return Math.max(0, committedLimit - currentDrawn);
  return peakDrawnPrev;
}

/**
 * Iterative debt solver.
 * The circular dependency: TDC includes finance costs, facility size depends on TDC via LTC,
 * facility size determines interest, interest is part of finance costs in TDC.
 */

/**
 * V8 — Single source of truth for the min-equity cross-check. Used by
 * solveFunding for both the [FUNDING] warning emit and the FundingResult
 * telemetry (consumed by the Checks tab), so the two ALWAYS agree.
 *
 * Basis reconstruction:
 *   - `tdcExFin` = sum of cash-basis monthly costs ex-finance (INCLUDES
 *     recoverable GST on costs — this is the periodic-cash array the engine
 *     spreads against the bank balance, NOT the input-side ex-GST rollup).
 *   - `tdcInclFin` = `tdcExFin` + raw funding interest/fees from the
 *     converged result (incl. lender-fee GST uplift when applicable).
 * Both numbers match the engine's true converged TDC — Checks tab consumers
 * MUST read these via `FundingResult.minEquityCheck` rather than recomputing
 * from `FeasibilitySummary.totalCost`, which is the input-side rollup and
 * misses gstOnCosts.
 */
function computeMinEquityCheck(
  minEq: import('../types').MinEquityRequirement | undefined,
  result: FundingResult,
  monthlyCostsExcFinance: number[],
): FundingResult['minEquityCheck'] {
  const tdcExFin = sum(monthlyCostsExcFinance);
  const finCosts =
    result.totalSeniorInterest + result.totalSeniorFees +
    result.totalSenior2Interest + result.totalSenior2Fees +
    result.totalMezzInterest + result.totalMezzFees +
    result.totalLandLoanInterest + result.totalLandLoanFees;
  const tdcInclFin = tdcExFin + finCosts;
  const useInclFin = !minEq || minEq.basis === 'tdc-incl-finance-costs';
  const basisAmount = useInclFin ? tdcInclFin : tdcExFin;
  const basisName: 'TDC' | 'TDC + financing costs' =
    useInclFin ? 'TDC + financing costs' : 'TDC';
  const actual = result.totalEquityInjected;
  // Bug 3 (Kew UAT): when mode='percent', `value` is a FRACTION in [0, 1]
  // (e.g. 0.10 for 10%). Pre-fix the engine multiplied the raw value × basisAmount,
  // so a user entering `10` (meaning 10%) was treated as 1000% (10× TDC).
  // The v9 migration heals legacy stored values > 1; this is a belt-and-braces
  // defensive console warning if anything still slips through.
  if (minEq && minEq.mode === 'percent' && Number.isFinite(minEq.value) && minEq.value > 1) {
    console.warn(
      `[minEquityRequirement] value=${minEq.value} > 1 with mode='percent'. ` +
      `Expected a fraction in [0, 1] (e.g. 0.10 for 10%). Treating as percent literal — ` +
      `dividing by 100. Update your input or run the v9 migration.`,
    );
  }
  const normalisedValue = (minEq && minEq.mode === 'percent' && Number.isFinite(minEq.value) && minEq.value > 1)
    ? minEq.value / 100
    : (minEq?.value ?? 0);
  const required = (minEq && Number.isFinite(minEq.value) && minEq.value > 0)
    ? (minEq.mode === 'percent' ? normalisedValue * basisAmount : minEq.value)
    : 0;
  // $1 tolerance to mirror the warning emit branch.
  const shortfall = (required > 0 && actual + 1 < required) ? required - actual : 0;
  return { required, actual, basisAmount, basisName, shortfall };
}


/**
 * Issue 5 — Effective land-loan back-solve compounding horizon.
 *
 * Returns the period index (0-based, inclusive) at which the land-loan
 * back-solve loop should stop compounding cap-int. PR #32 (LL2) refinances
 * the land loan in full when the senior facility starts, so cap-int
 * compounding past `senior.startMonth - 1` never materialises in reality.
 * Using the full `landLoan.maturityMonth` horizon makes the closed-form
 * principal cap unnecessarily conservative on every project that takes
 * senior out before LL maturity.
 *
 * Clipping is applied only when:
 *   • a senior facility exists (facilityLimit > 0), AND
 *   • senior starts after period 0 (startMonth > 0), AND
 *   • a land loan actually exists (landLoan.startMonth > 0), AND
 *   • the land loan starts on-or-before senior takeover
 *     (landLoan.startMonth <= senior.startMonth) — otherwise no takeout
 *     refinance applies, AND
 *   • takeout fires strictly before the LL would naturally mature
 *     (`senior.startMonth - 1 < landLoanMaturityIdx`)
 *
 * Otherwise the original LL maturity end-index is returned unchanged.
 *
 * Exported so the invariant test can exercise the threshold without spinning
 * up the engine.
 */
export function computeLandLoanBackSolveEndIdx(
  senior: { facilityLimit: number; startMonth: number },
  landLoanMaturityEndIdx: number,
  landLoan: { startMonth: number } = { startMonth: 1 },
): number {
  if (
    senior.facilityLimit > 0 &&
    senior.startMonth > 0 &&
    landLoan.startMonth > 0 &&
    landLoan.startMonth <= senior.startMonth &&
    (senior.startMonth - 1) < landLoanMaturityEndIdx
  ) {
    return senior.startMonth - 1;
  }
  return landLoanMaturityEndIdx;
}

export function solveFunding(
  periods: Period[],
  monthlyCostsExcFinance: number[],
  monthlyRevenue: number[],
  _monthlyGSTNet: number[],
  gstOnRevenue: number[],
  inputs: MainInputs,
  daysPerYear: number,
  tolerance: number,
  maxIterations = 50,
  equityDrawdownMode: 'equity-first' | 'pro-rata' | 'senior-first' = 'equity-first',
  // M3 — Cash-sweep order for the revenue waterfall. Default = legal priority.
  repaymentSequence: readonly RepaymentTranche[] = ['senior', 'mezz', 'equity'],
): FundingResult {
  const n = periods.length;

  let prevSeniorFinCosts = 0;
  let prevMezzFinCosts = 0;
  let prevSenior2FinCosts = 0;
  // Peak drawn balances from prior iteration — used as the line fee basis.
  // Converges to the actual peak debt for each facility.
  let prevPeakSnrBalance  = 0;
  let prevPeakSnr2Balance = 0;
  let prevPeakMezzBalance = 0;
  let result: FundingResult = createEmptyResult(n);
  let converged = false;
  let iterationsRun = 0;
  let finalDelta = Infinity;

  // ─────────────────────────────────────────────────────────────────────────
  // Solution 2 — Timing-aware principal cap loop (Option 2a).
  //
  // For capitalised facilities, the closed-form `backSolveCapitalisedPrincipalCap`
  // assumes worst-case day-0 full draw and compounds the entire principal
  // through to maturity. Real drawdowns are progressive over construction
  // (gap-fill from negative bank balance) and revenue inflows reduce the
  // outstanding balance from settlement onward — so the actual peak is
  // strictly below what the closed-form predicts. Applying the closed-form
  // as a hard cap on principal leaves ~25-30% of facility headroom unused
  // on typical multi-year capitalised builds.
  //
  // Approach: start permissive (principal cap = facilityLimit, the lender's
  // headline limit), run the cost-convergence solver, then observe the actual
  // peak balance. If peak > facilityLimit, scale the principal cap down by
  // (facilityLimit / peak) and re-run. This finds the largest principal that
  // keeps observed peak ≤ facilityLimit under the actual drawdown schedule.
  //
  // Convergence is monotonic-shrinking (the cap only goes down between outer
  // iterations) and typically settles in 3-5 outer passes. If the loop
  // doesn't converge, the previous (looser) cap result is the last fully
  // valid attempt — but `BackSolveOuterCapMargin` keeps a small safety
  // buffer below facilityLimit on the FIRST attempt that has peak >
  // facilityLimit, and we also fall back to the closed-form cap as the
  // ultimate safety floor.
  //
  // Cash-pay facilities: closed-form already returns facilityLimit (no
  // compounding), so we skip the override / shrink path entirely for them.
  // ─────────────────────────────────────────────────────────────────────────

  const senior   = inputs.seniorFacility  ?? EMPTY_FACILITY;
  const senior2  = inputs.seniorFacility2 ?? EMPTY_FACILITY;
  const mezz     = inputs.mezzanine       ?? EMPTY_FACILITY;
  const landLoan = inputs.landLoan        ?? EMPTY_FACILITY;

  // Closed-form caps (worst-case) used as the SAFETY FLOOR if the
  // timing-aware loop doesn't converge. These are also the values the engine
  // would use without Solution 2, so falling back to them is at-least-as-safe
  // as pre-Solution-2 behaviour.
  const _snrStartFloor  = senior.startMonth   > 0 ? senior.startMonth   - 1 : -1;
  const _snr2StartFloor = senior2.startMonth  > 0 ? senior2.startMonth  - 1 : -1;
  const _mezzStartFloor = mezz.startMonth     > 0 ? mezz.startMonth     - 1 : -1;
  const _llStartFloor   = landLoan.startMonth > 0 ? landLoan.startMonth - 1 : -1;
  const _snrEndFloor    = senior.maturityMonth   > 0 ? senior.maturityMonth   - 1 : n - 1;
  const _snr2EndFloor   = senior2.maturityMonth  > 0 ? senior2.maturityMonth  - 1 : n - 1;
  const _mezzEndFloor   = mezz.maturityMonth     > 0 ? mezz.maturityMonth     - 1 : n - 1;
  const _llMaturityEndFloor = landLoan.maturityMonth > 0 ? landLoan.maturityMonth - 1 : n - 1;
  // Issue 5 — see `computeLandLoanBackSolveEndIdx`.
  const _llEndFloor = computeLandLoanBackSolveEndIdx(senior, _llMaturityEndFloor, landLoan);
  const seniorClosedFormCap = backSolveCapitalisedPrincipalCap(
    senior, senior.facilityLimit > 0 ? senior.facilityLimit : Infinity,
    periods, daysPerYear, _snrStartFloor, _snrEndFloor, senior.margin + senior.bbsy);
  const senior2ClosedFormCap = backSolveCapitalisedPrincipalCap(
    senior2, senior2.facilityLimit > 0 ? senior2.facilityLimit : Infinity,
    periods, daysPerYear, _snr2StartFloor, _snr2EndFloor, senior2.margin + senior2.bbsy);
  const mezzClosedFormCap = backSolveCapitalisedPrincipalCap(
    mezz, mezz.facilityLimit > 0 ? mezz.facilityLimit : Infinity,
    periods, daysPerYear, _mezzStartFloor, _mezzEndFloor, mezz.margin + mezz.bbsy);
  const landLoanClosedFormCap = backSolveCapitalisedPrincipalCap(
    landLoan, landLoan.facilityLimit > 0 ? landLoan.facilityLimit : 0,
    periods, daysPerYear, _llStartFloor, _llEndFloor, landLoan.interestRate);

  // Timing-aware overrides — start permissive at facilityLimit for
  // capitalised facilities. For cash-pay facilities we leave the override
  // unset so `runFundingWaterfall` falls through to the (no-op) closed-form.
  const principalCapOverrides: PrincipalCapOverrides = {};
  if (senior.isCapitalised && senior.facilityLimit > 0) {
    principalCapOverrides.senior = senior.facilityLimit;
  }
  if (senior2.isCapitalised && senior2.facilityLimit > 0) {
    principalCapOverrides.senior2 = senior2.facilityLimit;
  }
  if (mezz.isCapitalised && mezz.facilityLimit > 0) {
    principalCapOverrides.mezz = mezz.facilityLimit;
  }
  if (landLoan.isCapitalised && landLoan.facilityLimit > 0) {
    principalCapOverrides.landLoan = landLoan.facilityLimit;
  }

  // Outer-loop bookkeeping — see comment block above for rationale.
  // 6 outer iters is plenty: typical convergence is 3-5; the proportional
  // scaler shrinks geometrically because each outer pass reduces both the
  // cap AND the peak (cap-int is roughly proportional to principal).
  const maxBackSolveOuterIters = 6;
  const backSolveTolerance = Math.max(tolerance, 100); // $100 cushion for rounding
  const backSolveSafetyMargin = 0.999; // shrink to 99.9% of facilityLimit/peak ratio
  let outerConverged = false;
  let lastValidOverrides: PrincipalCapOverrides | null = null;

  for (let outer = 0; outer < maxBackSolveOuterIters; outer++) {
    // Reset cost-convergence state for each outer iteration so each pass is
    // a clean cost-convergence solve under the current principal caps.
    prevSeniorFinCosts = 0;
    prevMezzFinCosts   = 0;
    prevSenior2FinCosts = 0;
    prevPeakSnrBalance  = 0;
    prevPeakSnr2Balance = 0;
    prevPeakMezzBalance = 0;
    converged = false;
    finalDelta = Infinity;

    // ── INNER: cost-convergence loop (the original loop, now nested). ──
    for (let iter = 0; iter < maxIterations; iter++) {
      iterationsRun = iter + 1;
      resetPendingFundingState();
      const tdc = sum(monthlyCostsExcFinance)
        + prevSeniorFinCosts + prevMezzFinCosts
        + prevSenior2FinCosts;

      result = runFundingWaterfall(
        periods, monthlyCostsExcFinance, monthlyRevenue, _monthlyGSTNet, gstOnRevenue,
        inputs, tdc, daysPerYear,
        prevPeakSnrBalance, prevPeakSnr2Balance, prevPeakMezzBalance,
        equityDrawdownMode,
        repaymentSequence,
        principalCapOverrides,
      );

      const newSeniorFinCosts = result.totalSeniorInterest + result.totalSeniorFees
        + result.totalLandLoanInterest + result.totalLandLoanFees;
      const newMezzFinCosts = result.totalMezzInterest + result.totalMezzFees;
      const newSenior2FinCosts = result.totalSenior2Interest + result.totalSenior2Fees;

      const seniorDiff  = Math.abs(newSeniorFinCosts  - prevSeniorFinCosts);
      const mezzDiff    = Math.abs(newMezzFinCosts    - prevMezzFinCosts);
      const senior2Diff = Math.abs(newSenior2FinCosts - prevSenior2FinCosts);
      finalDelta = Math.max(seniorDiff, mezzDiff, senior2Diff);

      if (finalDelta < tolerance) {
        converged = true;
        break;
      }
      prevSeniorFinCosts  = newSeniorFinCosts;
      prevMezzFinCosts    = newMezzFinCosts;
      prevSenior2FinCosts = newSenior2FinCosts;
      prevPeakSnrBalance  = result.seniorFacilitySize;
      prevPeakSnr2Balance = result.senior2FacilitySize;
      prevPeakMezzBalance = result.mezzFacilitySize;
    }

    // ── OUTER convergence check: did observed peaks exceed facilityLimit? ──
    let mustShrink = false;

    const checkAndShrink = (
      key: keyof PrincipalCapOverrides,
      facility: DebtFacility,
      observedPeak: number,
    ): void => {
      if (!facility.isCapitalised || facility.facilityLimit <= 0) return;
      const cap = principalCapOverrides[key];
      if (cap === undefined) return;
      const limit = facility.facilityLimit;
      if (observedPeak > limit + backSolveTolerance) {
        // Shrink proportionally with safety margin — cap-int compounds
        // roughly linearly with principal (over a single outer step), so
        // (limit / peak) is a reasonable shrink factor. Multiplying by
        // backSolveSafetyMargin (0.999) gives a sliver of buffer to
        // counteract rounding / non-linearity.
        const shrinkFactor = (limit / observedPeak) * backSolveSafetyMargin;
        principalCapOverrides[key] = cap * shrinkFactor;
        mustShrink = true;
      }
    };

    // Issue 3 — feed checkAndShrink the WOULD-BE peak (rawPeak) instead of
    // the POST cap-int ceiling peak (*FacilitySize). The post-ceiling peak
    // is, by construction, never above the covenant cap (FU2 converts cap-int
    // to cash-pay specifically to keep it under), so the shrink loop never
    // sees an overshoot and the principal cap never tightens. rawPeak is the
    // balance the engine WOULD have produced if cap-int had been free to
    // capitalise — which is the right signal for sizing principal.
    const rawPeak = result.rawPeak ?? {
      senior:  result.seniorFacilitySize,
      senior2: result.senior2FacilitySize,
      mezz:    result.mezzFacilitySize,
      landLoan: 0,
    };
    checkAndShrink('senior',   senior,   rawPeak.senior);
    checkAndShrink('senior2',  senior2,  rawPeak.senior2);
    checkAndShrink('mezz',     mezz,     rawPeak.mezz);
    // Land loan peak: lump-sum balance immediately after draw is the peak,
    // which equals the override (no revenue/repayment before maturity here).
    // The outer check is still useful because cap-int compounds toward
    // maturity. We use the closed-form factor to project the peak.
    if (landLoan.isCapitalised && landLoan.facilityLimit > 0) {
      const llCap = principalCapOverrides.landLoan;
      if (llCap !== undefined) {
        const factor = capInterestCompoundFactor(
          periods, daysPerYear, _llStartFloor, _llEndFloor, landLoan.interestRate);
        const projectedPeak = llCap * factor;
        if (projectedPeak > landLoan.facilityLimit + backSolveTolerance) {
          const shrinkFactor = (landLoan.facilityLimit / projectedPeak) * backSolveSafetyMargin;
          principalCapOverrides.landLoan = llCap * shrinkFactor;
          mustShrink = true;
        }
      }
    }

    if (!mustShrink) {
      outerConverged = true;
      lastValidOverrides = { ...principalCapOverrides };
      break;
    }
    // Save the last attempt that overshot — if we run out of outer iters,
    // we'll fall back to the closed-form floor in the post-loop block below.
    lastValidOverrides = { ...principalCapOverrides };
  }

  // Solution 2 — outer non-convergence safety net.
  //
  // If the timing-aware loop didn't settle within `maxBackSolveOuterIters`,
  // the last solve had peak > facilityLimit + tolerance. Fall back to the
  // closed-form cap (worst-case, guaranteed to satisfy peak ≤ facilityLimit
  // by construction) and re-run cost-convergence. This is at-least-as-safe
  // as pre-Solution-2 behaviour.
  if (!outerConverged) {
    if (senior.isCapitalised && senior.facilityLimit > 0)   principalCapOverrides.senior   = seniorClosedFormCap;
    if (senior2.isCapitalised && senior2.facilityLimit > 0) principalCapOverrides.senior2  = senior2ClosedFormCap;
    if (mezz.isCapitalised && mezz.facilityLimit > 0)       principalCapOverrides.mezz     = mezzClosedFormCap;
    if (landLoan.isCapitalised && landLoan.facilityLimit > 0) principalCapOverrides.landLoan = landLoanClosedFormCap;

    prevSeniorFinCosts = 0;
    prevMezzFinCosts   = 0;
    prevSenior2FinCosts = 0;
    prevPeakSnrBalance  = 0;
    prevPeakSnr2Balance = 0;
    prevPeakMezzBalance = 0;
    converged = false;

    _fundingWarnings.push(
      `[INFO] Timing-aware principal back-solve did not converge in ${maxBackSolveOuterIters} outer iterations — ` +
      `falling back to closed-form (worst-case) caps. Some facility headroom may go unused.`
    );
    lastValidOverrides = { ...principalCapOverrides };
  }

  // Suppress the no-op TypeScript var-unused; we keep the pointer for
  // diagnostics but don't read it after fallback.
  void lastValidOverrides;

  // Final cost-convergence pass under the chosen (timing-aware or fallback)
  // principal caps. This is the original solver loop, gated by `iter < maxIterations`.
  for (let iter = 0; iter < maxIterations; iter++) {
    iterationsRun = iter + 1;
    // Reset per-iteration accumulator: per-period covenant breaches, auto-size
    // running peaks, and equity backstop overshoots are populated fresh each
    // iteration — the LAST iteration's data is the converged truth (Q1 fix).
    resetPendingFundingState();
    const tdc = sum(monthlyCostsExcFinance)
      + prevSeniorFinCosts + prevMezzFinCosts
      + prevSenior2FinCosts;

    result = runFundingWaterfall(
      periods, monthlyCostsExcFinance, monthlyRevenue, _monthlyGSTNet, gstOnRevenue,
      inputs, tdc, daysPerYear,
      prevPeakSnrBalance, prevPeakSnr2Balance, prevPeakMezzBalance,
      equityDrawdownMode,
      repaymentSequence,
      principalCapOverrides,
    );

    const newSeniorFinCosts = result.totalSeniorInterest + result.totalSeniorFees
      + result.totalLandLoanInterest + result.totalLandLoanFees;
    const newMezzFinCosts = result.totalMezzInterest + result.totalMezzFees;
    const newSenior2FinCosts = result.totalSenior2Interest + result.totalSenior2Fees;

    const seniorDiff  = Math.abs(newSeniorFinCosts  - prevSeniorFinCosts);
    const mezzDiff    = Math.abs(newMezzFinCosts    - prevMezzFinCosts);
    const senior2Diff = Math.abs(newSenior2FinCosts - prevSenior2FinCosts);
    finalDelta = Math.max(seniorDiff, mezzDiff, senior2Diff);

    // CR3 — convergence criterion + failure-mode documentation.
    //
    // Threshold: `tolerance` (passed in from runCalculations, default $50 in
    // engine config — small enough that downstream KPIs are stable to <$0.01,
    // big enough to clear typical floating-point rounding on a 50-month build).
    // The check uses MAX(senior, mezz, senior2) finance-cost delta rather than
    // sum, so a single facility that's still drifting holds back convergence
    // even if the others have settled.
    //
    // Convergence behaviour at the iteration cap (maxIterations, default 50):
    //   • If finalDelta < tolerance: `converged = true`, loop breaks, the
    //     last result is exact within rounding.
    //   • If we hit `iter === maxIterations - 1` without converging: the
    //     loop exits with `converged = false` and `convergedIn = null`. The
    //     LAST iteration's values are returned (final-cost estimate is still
    //     close — within ~$tolerance × 2 typically — but the convergence
    //     warning fires below).
    //   • A non-converged result is NOT a crash. Finance costs and facility
    //     sizes may be off by up to the last delta; downstream calcs proceed.
    //   • Diagnostic signals: `convergedIn` (iteration count, null if capped),
    //     `convergenceDelta` (final delta), `converged` (boolean).
    //
    // Tests should assert convergedIn < maxIterations on known-good fixtures.
    // A fixture that suddenly takes 49 iterations to converge (still passing)
    // is a trending signal — likely a recent change is making the solver
    // brittle even before it crosses the cap.
    if (finalDelta < tolerance) {
      converged = true;
      break;
    }

    prevSeniorFinCosts  = newSeniorFinCosts;
    prevMezzFinCosts    = newMezzFinCosts;
    prevSenior2FinCosts = newSenior2FinCosts;
    prevPeakSnrBalance  = result.seniorFacilitySize;
    prevPeakSnr2Balance = result.senior2FacilitySize;
    prevPeakMezzBalance = result.mezzFacilitySize;
  }

  // V8 — Min-equity-requirement cross-check. Computed ONCE on the converged
  // final-iteration result via the shared `computeMinEquityCheck` helper —
  // single source of truth for both the [FUNDING] warning and the
  // `FundingResult.minEquityCheck` telemetry consumed by the Checks tab.
  // Idempotent w.r.t. solver iterations: only the final pass records.
  // value=0 disables the warning emit (back-compat for v7 fixtures); the
  // telemetry is still populated below for consumers that want diagnostics.
  {
    const minEq = inputs.minEquityRequirement;
    const check = computeMinEquityCheck(minEq, result, monthlyCostsExcFinance);
    result.minEquityCheck = check;
    if (minEq && Number.isFinite(minEq.value) && minEq.value > 0 && check.shortfall > 0) {
      recordMinEquityShortfall(
        check.actual,
        check.required,
        check.basisAmount,
        check.basisName,
        minEq.mode,
        minEq.value,
      );
    }
  }

  // Bug B — Equity-cap overshoot cross-check. Computed ONCE on the converged
  // final-iteration result. The `cumulativeEquityDeveloperDrawn` includes
  // injections from BOTH the minEquityRequirement floor and the
  // equity-of-last-resort backstop — both can push the draw past the
  // user-set equityCap. We surface this as a [FUNDING] / [INFO] consolidator
  // entry plus telemetry on `result.equityCapCheck` so the Checks tab can
  // render a "Equity within user cap" row that matches the warning text
  // byte-for-byte.
  //
  // Decomposition of cumulativeEquityDeveloperDrawn = jv + developer:
  //   • developer = totalEquityInjected − totalJVEquityInjected
  //   • jv        = totalJVEquityInjected
  //
  // `equityCap === 0` is treated as UNCAPPED (back-compat for v7 fixtures and
  // the common "equity is gap-fill, no fixed cap" scenario). Severity 'pass'
  // is recorded on the telemetry but no warning is emitted.
  {
    const dev = inputs.equityDeveloper;
    const jv  = inputs.equityJV;
    const totalEq = result.totalEquityInjected;
    const jvEq    = result.totalJVEquityInjected;
    const developerEq = Math.max(0, totalEq - jvEq);
    const developerCapInput = (dev && Number.isFinite(dev.equityCap)) ? dev.equityCap : 0;
    const jvCapInput        = (jv  && Number.isFinite(jv.equityCap))  ? jv.equityCap  : 0;

    // Developer entry — cap=0 means uncapped (no warning, severity=pass).
    const devSeverity = developerCapInput > 0
      ? (classifyEquityCapOvershoot(developerEq, developerCapInput) ?? 'pass')
      : 'pass';
    const devOvershoot = developerCapInput > 0 ? Math.max(0, developerEq - developerCapInput) : 0;
    const devPct = developerCapInput > 0 ? devOvershoot / developerCapInput : 0;
    result.equityCapCheck.developer = {
      drawn: developerEq,
      cap: developerCapInput,
      overshoot: devOvershoot,
      overshootPct: devPct,
      severity: devSeverity,
      fundingGap: devOvershoot,
    };
    if (developerCapInput > 0) {
      recordEquityCapOvershoot('developer', developerEq, developerCapInput, devOvershoot);
    } else {
      _pendingFundingState.equityCapOvershoot.delete('developer');
    }

    // JV entry — only enforce when JV is active AND has a positive cap.
    const jvActive = !!(jv && (jv.equityCap > 0 || jv.equityContribution > 0));
    const jvSeverity = (jvActive && jvCapInput > 0)
      ? (classifyEquityCapOvershoot(jvEq, jvCapInput) ?? 'pass')
      : 'pass';
    const jvOvershoot = (jvActive && jvCapInput > 0) ? Math.max(0, jvEq - jvCapInput) : 0;
    const jvPct = (jvActive && jvCapInput > 0) ? jvOvershoot / jvCapInput : 0;
    result.equityCapCheck.jv = {
      drawn: jvEq,
      cap: jvCapInput,
      overshoot: jvOvershoot,
      overshootPct: jvPct,
      severity: jvSeverity,
      fundingGap: jvOvershoot,
    };
    if (jvActive && jvCapInput > 0) {
      recordEquityCapOvershoot('jv', jvEq, jvCapInput, jvOvershoot);
    } else {
      _pendingFundingState.equityCapOvershoot.delete('jv');
    }
  }

  // Q1 — flush the consolidated per-(kind,facility) summaries from the FINAL
  // converged iteration into _summaryWarnings. This call's writes overwrite any
  // prior solveFunding call's summaries by stable key (so the prelim+final
  // solve pair produces ONE summary per kind, not two).
  flushPendingFundingSummaries();

  result.converged = converged;
  result.iterations = iterationsRun;
  result.convergedIn = converged ? iterationsRun : null;
  result.convergenceDelta = finalDelta;

  if (!converged) {
    _fundingWarnings.push(
      `Debt solver did not converge within ${maxIterations} iterations — ` +
      `final delta $${Math.round(finalDelta).toLocaleString()} exceeds tolerance $${tolerance}. ` +
      `Finance costs and facility sizes may be inaccurate; increase maxIterations or tolerance.`
    );
  }

  // Apply financing actuals overlay (post-convergence, does not affect waterfall logic).
  applyFinancingActualsOverlay(result, periods, inputs);

  return result;
}

/**
 * Overlays user-entered financing actuals onto the model-calculated result arrays
 * for actual periods only. The waterfall balances and forecast periods are unchanged.
 */
function applyFinancingActualsOverlay(
  result: FundingResult,
  periods: Period[],
  inputs: MainInputs,
): void {
  const landLoan = inputs.landLoan ?? EMPTY_FACILITY;
  const senior   = inputs.seniorFacility  ?? EMPTY_FACILITY;
  const senior2  = inputs.seniorFacility2 ?? EMPTY_FACILITY;
  const mezz     = inputs.mezzanine       ?? EMPTY_FACILITY;

  let anyActuals = false;

  for (let i = 0; i < periods.length; i++) {
    if (!periods[i]?.isActual) continue;

    // Land loan
    const llD = landLoan.actualsDrawdown?.[i];  if (llD  != null) { result.landLoanDrawdowns[i]  = llD;  anyActuals = true; }
    const llR = landLoan.actualsRepayment?.[i]; if (llR != null) { result.landLoanRepayments[i] = llR;  anyActuals = true; }
    const llI = landLoan.actualsInterest?.[i];  if (llI != null) { result.landLoanInterest[i]   = llI;  anyActuals = true; }
    const llF = landLoan.actualsFees?.[i];      if (llF != null) { result.landLoanFees[i]       = llF;  anyActuals = true; }

    // Senior 1
    const s1D = senior.actualsDrawdown?.[i];  if (s1D != null) { result.seniorDrawdowns[i]  = s1D; anyActuals = true; }
    const s1R = senior.actualsRepayment?.[i]; if (s1R != null) { result.seniorRepayments[i] = s1R; anyActuals = true; }
    const s1I = senior.actualsInterest?.[i];  if (s1I != null) { result.seniorInterest[i]   = s1I; anyActuals = true; }
    const s1F = senior.actualsFees?.[i];      if (s1F != null) { result.seniorFees[i]       = s1F; anyActuals = true; }

    // Senior 2
    const s2D = senior2.actualsDrawdown?.[i];  if (s2D != null) { result.senior2Drawdowns[i]  = s2D; anyActuals = true; }
    const s2R = senior2.actualsRepayment?.[i]; if (s2R != null) { result.senior2Repayments[i] = s2R; anyActuals = true; }
    const s2I = senior2.actualsInterest?.[i];  if (s2I != null) { result.senior2Interest[i]   = s2I; anyActuals = true; }
    const s2F = senior2.actualsFees?.[i];      if (s2F != null) { result.senior2Fees[i]       = s2F; anyActuals = true; }

    // Mezzanine
    const mzD = mezz.actualsDrawdown?.[i];  if (mzD != null) { result.mezzDrawdowns[i]  = mzD; anyActuals = true; }
    const mzR = mezz.actualsRepayment?.[i]; if (mzR != null) { result.mezzRepayments[i] = mzR; anyActuals = true; }
    const mzI = mezz.actualsInterest?.[i];  if (mzI != null) { result.mezzInterest[i]   = mzI; anyActuals = true; }
    const mzF = mezz.actualsFees?.[i];      if (mzF != null) { result.mezzFees[i]       = mzF; anyActuals = true; }
  }

  // Recompute running totals from the overlaid arrays so dashboard figures reflect actuals.
  if (anyActuals) {
    result.totalLandLoanInterest = sum(result.landLoanInterest);
    result.totalLandLoanFees     = sum(result.landLoanFees);
    result.totalSeniorInterest   = sum(result.seniorInterest);
    result.totalSeniorFees       = sum(result.seniorFees);
    result.totalSenior2Interest  = sum(result.senior2Interest);
    result.totalSenior2Fees      = sum(result.senior2Fees);
    result.totalMezzInterest     = sum(result.mezzInterest);
    result.totalMezzFees         = sum(result.mezzFees);
  }
}

/**
 * Solution 2 — timing-aware principal cap overrides.
 *
 * `principalCapOverrides` lets `solveFunding` thread iteratively-tightened
 * principal caps into the waterfall. When a value is `undefined`, the engine
 * falls back to the closed-form `backSolveCapitalisedPrincipalCap` (worst-case
 * day-0 full-draw assumption). When a value is provided, it overrides the
 * back-solve and is used directly as the facility's hard principal limit.
 *
 * `solveFunding` starts the timing-aware loop with overrides == facilityLimit
 * (most permissive — this is the headline limit that the closed-form would
 * shrink to ~72% of for a typical 3yr facility). After each solve, observed
 * peaks are compared to facilityLimit and overrides are scaled down
 * proportionally. This lets capitalised facilities approach their actual
 * lender limit instead of being capped at the closed-form's worst-case
 * principal — typically unlocking ~25-30% of headroom on multi-year builds
 * where progressive drawdown means cap-int compounds on a smaller average
 * balance than the worst case.
 *
 * Cash-pay facilities are unaffected — closed-form already returns
 * facilityLimit unchanged for `isCapitalised=false`, and the loop in
 * `solveFunding` skips override updates for them.
 */
interface PrincipalCapOverrides {
  senior?: number;
  senior2?: number;
  mezz?: number;
  landLoan?: number;
}

function runFundingWaterfall(
  periods: Period[],
  monthlyCostsExcFinance: number[],
  monthlyRevenue: number[],
  _monthlyGSTNet: number[],
  gstOnRevenue: number[],
  inputs: MainInputs,
  tdc: number,
  daysPerYear: number,
  peakSnrBalancePrev = 0,
  peakSnr2BalancePrev = 0,
  peakMezzBalancePrev = 0,
  equityDrawdownMode: 'equity-first' | 'pro-rata' | 'senior-first' = 'equity-first',
  // M3 — Cash-sweep order for the revenue waterfall.
  repaymentSequence: readonly RepaymentTranche[] = ['senior', 'mezz', 'equity'],
  // Solution 2 — timing-aware principal cap overrides (see interface comment).
  principalCapOverrides: PrincipalCapOverrides = {},
): FundingResult {
  const n = periods.length;
  const landLoan = inputs.landLoan        ?? EMPTY_FACILITY;
  const senior   = inputs.seniorFacility  ?? EMPTY_FACILITY;
  const senior2  = inputs.seniorFacility2 ?? EMPTY_FACILITY;
  const mezz     = inputs.mezzanine       ?? EMPTY_FACILITY;

  const drawdownSequence = computeDrawdownSequence(inputs);

  // ===== NRV for LVR =====
  const totalGRV = inputs.grvItems.reduce((s, g) => s + g.currentSalePrice, 0);
  const gstOnResidential = inputs.grvItems
    .filter(g => g.gstIncluded)
    .reduce((s, g) => s + g.currentSalePrice * inputs.landPurchase.gstRate / (1 + inputs.landPurchase.gstRate), 0);
  // Bug 6 (Kew UAT): broadcast 1 sellingCost row across all grvItems for the
  // NRV calc, matching the engine-wide pickSellingCost behaviour. Pre-fix the
  // NRV understated commission deductions when sellingCosts.length === 1.
  const pickSC = (idx: number) =>
    inputs.sellingCosts.length === 1 ? inputs.sellingCosts[0] : inputs.sellingCosts[idx];
  const backEndSelling = inputs.grvItems.reduce((s, g, idx) => {
    const sc = pickSC(idx);
    if (!sc) return s;
    return s + g.currentSalePrice * sc.salesCommission * (1 - sc.preCommissionPercent);
  }, 0);
  const frontEndSelling = inputs.grvItems.reduce((s, g, idx) => {
    const sc = pickSC(idx);
    if (!sc) return s;
    return s + g.currentSalePrice * sc.salesCommission * sc.preCommissionPercent;
  }, 0);
  const nrv = totalGRV - gstOnResidential - backEndSelling - frontEndSelling;

  // ===== Facility limits (LTC / LVR) — M4: auto-size to covenant caps =====
  // The user-configured facilityLimit represents the term-sheet commitment.
  // The LTC/LVR caps are the covenant ceilings. Pre-fix the engine bound
  // senior at min(facility, ltc, lvr), so even with LTC/LVR headroom remaining
  // a low facilityLimit caused the equity backstop to fire on underfunded
  // projects. M4: senior/mezz auto-size up to min(ltcCap, lvrCap), with a
  // funding warning when the actual peak balance exceeds the user-configured
  // facilityLimit. LTC/LVR caps are NEVER breached.
  //
  // CAP-INT FIX: lenders treat `facilityLimit` as a covenant cap on PEAK
  // OUTSTANDING BALANCE — not a draw cap. For a capitalised facility, accruing
  // interest itself adds to the balance, so the principal we can safely draw
  // is strictly less than the headline facility limit. We back-solve the
  // principal so that worst-case (full draw at start, full compounding to
  // maturity, no repayments) keeps balance ≤ facilityLimit. See
  // `backSolveCapitalisedPrincipalCap`. Cash-pay facilities are unchanged.
  // Local timeline indices for the back-solve — kept in sync with the canonical
  // timeline-flag block below.
  const _snrStartIdxBS  = senior.startMonth   > 0 ? senior.startMonth   - 1 : -1;
  const _snr2StartIdxBS = senior2.startMonth  > 0 ? senior2.startMonth  - 1 : -1;
  const _mezzStartIdxBS = mezz.startMonth     > 0 ? mezz.startMonth     - 1 : -1;
  const _llStartIdxBS   = landLoan.startMonth > 0 ? landLoan.startMonth - 1 : -1;
  const _snrEndIdxBS    = senior.maturityMonth   > 0 ? senior.maturityMonth   - 1 : n - 1;
  const _snr2EndIdxBS   = senior2.maturityMonth  > 0 ? senior2.maturityMonth  - 1 : n - 1;
  const _mezzEndIdxBS   = mezz.maturityMonth     > 0 ? mezz.maturityMonth     - 1 : n - 1;
  const _llMaturityEndIdxBS = landLoan.maturityMonth > 0 ? landLoan.maturityMonth - 1 : n - 1;
  // Issue 5 — see `computeLandLoanBackSolveEndIdx`.
  const _llEndIdxBS = computeLandLoanBackSolveEndIdx(senior, _llMaturityEndIdxBS, landLoan);

  const seniorLtcLimit  = senior.ltcTarget  > 0 ? tdc * senior.ltcTarget  : Infinity;
  const seniorLvrLimit  = senior.lvrTarget  > 0 ? nrv * senior.lvrTarget  : Infinity;
  const seniorFacilityHardLimitRaw = senior.facilityLimit > 0 ? senior.facilityLimit : Infinity;
  // Solution 2 — timing-aware override (when provided by solveFunding's outer
  // loop) replaces the closed-form worst-case back-solve. Closed-form remains
  // the safety fallback for direct callers / unit tests / first-iteration.
  const seniorFacilityHardLimit = principalCapOverrides.senior !== undefined
    ? principalCapOverrides.senior
    : backSolveCapitalisedPrincipalCap(
        senior, seniorFacilityHardLimitRaw, periods, daysPerYear,
        _snrStartIdxBS, _snrEndIdxBS, senior.margin + senior.bbsy);
  const seniorCovenantCap = Math.min(seniorLtcLimit, seniorLvrLimit);
  const seniorRequestedLimit = senior.facilityLimit > 0 ? seniorFacilityHardLimit : seniorCovenantCap;
  const seniorLimit     = Math.min(seniorRequestedLimit, seniorCovenantCap);
  // Auto-size cap — Bug 2 (Kew UAT): facilityLimit MUST act as a hard ceiling
  // alongside LTC and LVR, so that senior peak ≤ min(LTC×TDC, LVR×NRV, facilityLimit).
  // Pre-fix, seniorAutoSizeCap = covenantCap, which let auto-size grow senior past
  // user-configured facilityLimit when covenants had headroom — surfaced as a
  // facilityLimitOvershoot warning but did not bind. Now the user-configured
  // facilityLimit binds and the equity backstop fires when all three caps are hit.
  // Cap-int fix: when capitalised, `seniorFacilityHardLimit` is the back-solved
  // principal cap, so the auto-size loop can never draw enough principal for
  // worst-case compounded balance to exceed the user-set facilityLimit.
  const seniorAutoSizeCap = Math.min(seniorCovenantCap, seniorFacilityHardLimit);

  const senior2LtcLimit = senior2.ltcTarget > 0 ? tdc * senior2.ltcTarget : Infinity;
  const senior2LvrLimit = senior2.lvrTarget > 0 ? nrv * senior2.lvrTarget : Infinity;
  // senior2 hard cap not currently exposed (senior2Limit serves the role).
  const senior2CovenantCap = Math.min(senior2LtcLimit, senior2LvrLimit);
  const senior2FacilityHardLimitRaw = senior2.facilityLimit > 0 ? senior2.facilityLimit : Infinity;
  const senior2FacilityHardLimit = principalCapOverrides.senior2 !== undefined
    ? principalCapOverrides.senior2
    : backSolveCapitalisedPrincipalCap(
        senior2, senior2FacilityHardLimitRaw, periods, daysPerYear,
        _snr2StartIdxBS, _snr2EndIdxBS, senior2.margin + senior2.bbsy);
  const senior2Limit    = Math.min(senior2FacilityHardLimit, senior2CovenantCap);
  // (senior2 doesn't currently use a separate auto-size cap; senior2Limit serves that role.)

  const mezzLtcLimit    = mezz.ltcTarget    > 0 ? tdc * mezz.ltcTarget    : Infinity;
  const mezzLvrLimit    = mezz.lvrTarget    > 0 ? nrv * mezz.lvrTarget    : Infinity;
  const mezzFacilityHardLimitRaw = mezz.facilityLimit > 0 ? mezz.facilityLimit : Infinity;
  const mezzFacilityHardLimit = principalCapOverrides.mezz !== undefined
    ? principalCapOverrides.mezz
    : backSolveCapitalisedPrincipalCap(
        mezz, mezzFacilityHardLimitRaw, periods, daysPerYear,
        _mezzStartIdxBS, _mezzEndIdxBS, mezz.margin + mezz.bbsy);
  const mezzCovenantCap = Math.min(mezzLtcLimit, mezzLvrLimit);
  const mezzRequestedLimit = mezz.facilityLimit > 0 ? mezzFacilityHardLimit : mezzCovenantCap;
  const mezzLimit       = Math.min(mezzRequestedLimit, mezzCovenantCap);
  const mezzAutoSizeCap = Math.min(mezzCovenantCap, mezzFacilityHardLimit);

  // Land loan — lump-sum draw at startMonth. Back-solve the actual principal
  // drawn so that capitalised interest doesn't push the balance past
  // facilityLimit before the land loan matures (or is repaid by senior). For
  // cash-pay land loans the formula reverts to facilityLimit. Solution 2 —
  // timing-aware override applies if provided.
  const landLoanDrawCap = principalCapOverrides.landLoan !== undefined
    ? principalCapOverrides.landLoan
    : backSolveCapitalisedPrincipalCap(
        landLoan,
        landLoan.facilityLimit > 0 ? landLoan.facilityLimit : 0,
        periods, daysPerYear,
        _llStartIdxBS, _llEndIdxBS, landLoan.interestRate);

  // Cap-int back-solve transparency notice. When the back-solve materially
  // reduces the principal cap below the user-set facilityLimit (>1% reduction),
  // surface a one-shot INFO note explaining: the lender's covenant cap is on
  // PEAK OUTSTANDING BALANCE, so capitalised facilities can only draw a
  // fraction of facilityLimit as principal — cap-int compounds the rest. The
  // capital stack widget will show this back-solved principal cap rather than
  // the headline limit; the C1 regression invariant uses this text to
  // recognise that the smaller stack is correct, not silent under-funding.
  const _emitBackSolveNote = (
    label: string, raw: number, solved: number, annualRate: number, periodsCount: number,
  ): void => {
    if (!Number.isFinite(raw) || raw <= 0 || solved >= raw - 1) return;
    if (raw - solved < raw * 0.01) return; // <1% shrinkage — noise, skip.
    _summaryWarnings.set(`capint-backsolve:${label}`,
      `[INFO] Cap-int back-solve: ${label} principal cap reduced from ${fmtMoney(raw)} ` +
      `(facilityLimit, lender covenant on peak balance) to ${fmtMoney(solved)} ` +
      `at ${(annualRate * 100).toFixed(2)}% over ${periodsCount} periods. ` +
      `Capitalised interest compounds the principal up to facilityLimit by maturity — ` +
      `the capital stack widget reports the principal cap; the gap to total cost is ` +
      `cap-int + revenue inflows (additional equity required only if revenue and equity ` +
      `together can't fund the residual gap).`);
  };
  if (senior.isCapitalised && senior.facilityLimit > 0) {
    _emitBackSolveNote('Senior #1', seniorFacilityHardLimitRaw, seniorFacilityHardLimit,
      senior.margin + senior.bbsy, Math.max(0, _snrEndIdxBS - _snrStartIdxBS + 1));
  }
  if (senior2.isCapitalised && senior2.facilityLimit > 0) {
    _emitBackSolveNote('Senior #2', senior2FacilityHardLimitRaw, senior2FacilityHardLimit,
      senior2.margin + senior2.bbsy, Math.max(0, _snr2EndIdxBS - _snr2StartIdxBS + 1));
  }
  if (mezz.isCapitalised && mezz.facilityLimit > 0) {
    _emitBackSolveNote('Mezzanine', mezzFacilityHardLimitRaw, mezzFacilityHardLimit,
      mezz.margin + mezz.bbsy, Math.max(0, _mezzEndIdxBS - _mezzStartIdxBS + 1));
  }
  if (landLoan.isCapitalised && landLoan.facilityLimit > 0) {
    _emitBackSolveNote('Land Loan', landLoan.facilityLimit, landLoanDrawCap,
      landLoan.interestRate, Math.max(0, _llEndIdxBS - _llStartIdxBS + 1));
  }


  // ===== Equity caps (per entity) =====
  const totalCostsExcFin  = sum(monthlyCostsExcFinance);
  const equityFixedDeveloper = inputs.equityDeveloper.equityCap;
  const equityPctDeveloper   = inputs.equityDeveloper.percentage;
  const developerCap = equityFixedDeveloper > 0 ? equityFixedDeveloper : totalCostsExcFin * equityPctDeveloper;

  const isJVActive = inputs.equityJV && (inputs.equityJV.equityCap > 0 || inputs.equityJV.equityContribution > 0);
  const equityFixedJV = inputs.equityJV?.equityCap ?? 0;
  const equityPctJV   = inputs.equityJV?.percentage  ?? 0;
  const jvCap = isJVActive ? (equityFixedJV > 0 ? equityFixedJV : totalCostsExcFin * equityPctJV) : 0;

  // Total cap (used for excess-equity repatriation at senior start)
  const totalEquityCap = developerCap + jvCap;

  // ===== Timeline flags =====
  const snrStartIdx  = senior.startMonth  > 0 ? senior.startMonth  - 1 : -1;
  const snr2StartIdx = senior2.startMonth > 0 ? senior2.startMonth - 1 : -1;
  const mezzStartIdx = mezz.startMonth    > 0 ? mezz.startMonth    - 1 : -1;

  // Maturity indices (0-indexed inclusive end). When maturityMonth is 0 or
  // not set, the facility runs to the end of the timeline.
  const snrEndIdx  = senior.maturityMonth  > 0 ? senior.maturityMonth  - 1 : n - 1;
  const snr2EndIdx = senior2.maturityMonth > 0 ? senior2.maturityMonth - 1 : n - 1;

  const hasSenior  = senior.facilityLimit  > 0 && snrStartIdx  >= 0;
  const hasSenior2 = senior2.facilityLimit > 0 && snr2StartIdx >= 0;
  const hasMezz    = mezz.facilityLimit    > 0 && mezzStartIdx >= 0;
  const llStartIdx = landLoan.startMonth   > 0 ? landLoan.startMonth - 1 : -1;

  // ===== Initialize arrays =====
  const llBalance    = new Array(n).fill(0);
  const llDrawdowns  = new Array(n).fill(0);
  const llRepayments = new Array(n).fill(0);
  const llInterest   = new Array(n).fill(0);
  const llFees       = new Array(n).fill(0);

  const snrBalance    = new Array(n).fill(0);
  const snrDrawdowns  = new Array(n).fill(0);
  const snrRepayments = new Array(n).fill(0);
  const snrInterest   = new Array(n).fill(0);
  const snrFees       = new Array(n).fill(0);

  const snr2Balance    = new Array(n).fill(0);
  const snr2Drawdowns  = new Array(n).fill(0);
  const snr2Repayments = new Array(n).fill(0);
  const snr2Interest   = new Array(n).fill(0);
  const snr2Fees       = new Array(n).fill(0);

  const mzBalance    = new Array(n).fill(0);
  const mzDrawdowns  = new Array(n).fill(0);
  const mzRepayments = new Array(n).fill(0);
  const mzInterest   = new Array(n).fill(0);
  const mzFees       = new Array(n).fill(0);

  const eqInjections    = new Array(n).fill(0);
  const eqRepatriations = new Array(n).fill(0);
  const profitDist      = new Array(n).fill(0);
  const jvInjections    = new Array(n).fill(0);
  const jvRepatriations = new Array(n).fill(0);
  const jvProfitDist    = new Array(n).fill(0);

  // Equity/profit distributions are gated: no distributions before equityDistStartMonth.
  // Surplus cash accumulates in the project bank account and carries forward.
  const eqDistStartIdx = (inputs.preliminary.equityDistStartMonth ?? 0) - 1;

  // ===== Running state =====
  let heldBankBalance     = 0; // surplus cash held when distributions are gated
  let llRunningBalance    = 0;
  let snrRunningBalance   = 0;
  let snr2RunningBalance  = 0;
  let mzRunningBalance    = 0;
  let llAccruedInterest   = 0;
  // LL2 — Track the senior-takeout transaction at construction start as a
  // single per-period figure for UI display. landLoanRepayments[i] +
  // seniorDrawdowns[i] still record the underlying flows; this memo just
  // labels the combined transaction so it can render as one row.
  const landLoanTakeoutBySenior = new Array(n).fill(0);

  let cumulativeEquity    = 0;
  let jvCumulative        = 0;
  let totalEqRepatriated  = 0;
  let totalJVRepatriated  = 0;
  let totalMezzDrawn      = 0;

  let totalSeniorInterest  = 0;
  let totalSeniorFees      = 0;
  let totalSenior2Interest = 0;
  let totalSenior2Fees     = 0;
  let totalMezzInterest    = 0;
  let totalMezzFees        = 0;
  let totalLandInterest    = 0;
  let totalLandFees        = 0;
  let peakDebt             = 0;
  let peakSnrBalance       = 0;
  let peakSnr2Balance      = 0;
  let peakMezzBalance      = 0;
  let peakEquityDrawn      = 0;
  let peakEquityMonth      = 0;

  // Issue 3 — Timing-aware back-solve raw peaks (would-be balance, before
  // cap-int hard ceiling converts to cash-pay). See FundingResult.rawPeak
  // doc for the full rationale. The shrink loop in `solveFunding` reads
  // these to detect overshoots that the post-ceiling *FacilitySize peaks
  // would otherwise hide.
  let rawPeakSnrBalance    = 0;
  let rawPeakSnr2Balance   = 0;
  let rawPeakMezzBalance   = 0;
  let rawPeakLandLoanBal   = 0;
  // Issue B — Per-facility "would-be" running balance: parallels each
  // *RunningBalance but compounds the cap-int the FU2 ceiling suppresses.
  // The shrink loop reads rawPeak* — feeding it raw balances detects
  // overshoots that the post-ceiling actuals hide. For cash-pay facilities
  // raw==actual (mirror only); divergence is exclusive to capitalised
  // facilities whose cap-int ceiling fires at least once.
  let rawSnrBalance        = 0;
  let rawSnr2Balance       = 0;
  let rawMezzBalance       = 0;
  let rawLLBalance         = 0;

  const snrAllInRate  = senior.margin  + senior.bbsy;
  const snr2AllInRate = senior2.margin + senior2.bbsy;
  const mezzAllInRate = mezz.margin    + mezz.bbsy;

  // K01 — Lender GST uplift on fees flows through cash. When the lender is
  // not GST-exempt (`lenderIsGSTExempt === false`), the fee they charge is
  // GST-inclusive and the developer cannot recover the GST as ITC (financial
  // supply acquisitions, GSTA s.11-15(2)(a)). Pre-fix the uplift was added
  // to `feasibility.totalCost` (via the `feeUplift()` calls in index.ts) but
  // never deducted from `bankBalance` — so feasibility profit was lower than
  // the waterfall sum by exactly the uplift on every project with at least
  // one non-exempt facility (Kew Demo Extra: $3.47M wedge). Apply the uplift
  // as cash on the same period the fee is charged, regardless of whether the
  // fee itself is capitalised — the GST portion is always a cash outflow.
  const _gstRate = inputs.landPurchase?.gstRate ?? 0;
  const feeUpliftCash = (
    facility: { lenderIsGSTExempt?: boolean } | undefined,
    fee: number,
  ): number => {
    if (!facility || facility.lenderIsGSTExempt !== false || fee <= 0) return 0;
    return fee * _gstRate;
  };

  // ===== SINGLE PASS =====
  for (let i = 0; i < n; i++) {
    const days         = periods[i]?.daysInPeriod ?? 0;
    // seniorActive: facility is within its committed term → line fees charged + drawdowns allowed.
    // seniorDrawActive: drawdowns gated by maturity (industry convention — after
    // maturity the facility is closed; remaining balance accrues interest until
    // repaid via revenue sweep / refinance / residual stock takeout, but no NEW
    // principal can be drawn). Historically this was open-ended ("extension
    // period") which produced senior facilities silently extending draws to
    // project end whenever maturityMonth < projectSpanMonths — opposite of the
    // user's expectation. To opt back into extension semantics, set maturityMonth
    // = projectSpanMonths explicitly.
    //
    // constructionPhaseActive: tracks whether the project has reached senior-1's
    // startMonth, independent of senior-1's maturity. Used as the gate for the
    // senior-first gap-fill MODE branch — senior-first iterates senior →
    // senior-2 → mezz → equity via per-facility flags, so the mode should keep
    // applying after senior-1 matures (otherwise the user's selected ordering
    // silently flips to equity-first and equity is drawn ahead of still-active
    // senior-2 / mezz).
    //
    // The pro-rata MODE stays gated on seniorDrawActive because pro-rata's
    // semantic is "split each period's gap between developer equity and
    // senior-1" — when senior-1 is mature, no split is possible, and falling
    // through to the equity-first else branch correctly exercises senior-2 /
    // mezz / JV / developer in standard priority order.
    const seniorActive      = hasSenior  && i >= snrStartIdx  && i <= snrEndIdx;
    const senior2Active     = hasSenior2 && i >= snr2StartIdx && i <= snr2EndIdx;
    const seniorDrawActive  = hasSenior  && i >= snrStartIdx  && i <= snrEndIdx;
    const senior2DrawActive = hasSenior2 && i >= snr2StartIdx && i <= snr2EndIdx;
    const constructionPhaseActive = hasSenior && i >= snrStartIdx;

    // ── 1. Opening balances ────────────────────────────────────────────────────
    const llOpenBalance   = llRunningBalance;
    const snrOpenBalance  = snrRunningBalance;
    const snr2OpenBalance = snr2RunningBalance;
    const mzOpenBalance   = mzRunningBalance;
    // Issue B — raw open balances feed `periodInterest` for the would-be
    // cap-int that the FU2 ceiling may suppress on actuals.
    const rawSnrOpenBalance  = rawSnrBalance;
    const rawSnr2OpenBalance = rawSnr2Balance;
    const rawMezzOpenBalance = rawMezzBalance;
    // LL has no in-loop cap-int ceiling, so no rawLLOpenBalance is needed —
    // rawLLBalance mirrors llRunningBalance exactly through every change.

    // Carry forward any surplus held from prior periods (distributions gated)
    let bankBalance = heldBankBalance;
    heldBankBalance = 0;

    // ── 2. Land loan lump-sum draw + establishment fee ─────────────────────────
    // Debt facility fees (establishment, line fees) are modelled as GST-free.
    // This assumes the lender is an exempt financial institution (GSTA s.40-60).
    // For non-bank facilities, verify whether fees are GST-inclusive in the term sheet.
    if (i === llStartIdx && landLoan.facilityLimit > 0) {
      // D2: A land loan drawn the same period as senior is repaid immediately
      // (step 4 below), so no interest accrues. That's correct for the modelled
      // sequence but typically reflects a misconfiguration: a land loan is
      // intended as a 3-6 month bridge before construction draws on senior.
      // Surface a warning so the user can reconcile their term-sheet timing.
      if (hasSenior && landLoan.startMonth >= (senior.startMonth ?? landLoan.startMonth + 1)) {
        _fundingWarnings.push(
          `Land Loan starts month ${landLoan.startMonth} but Senior starts month ${senior.startMonth} — land loan is repaid same period it is drawn, so no land-loan interest accrues. Confirm the bridge period (typical pattern: land-loan precedes senior by 3-6 months).`
        );
      }
      // R19 — Land-loan interest payment-frequency. Interest accrues on the
      // previous period's closing balance (llOpenBalance), so the drawdown
      // period itself never shows an interest charge — the open balance is $0
      // at the start of the drawdown period. With monthly frequency (=1), the
      // first interest charge appears one period after drawdown. With
      // quarterly (=3), the first interest appears in period drawdown+3 (the
      // 3rd full period of accrual).
      //
      // Kew UAT v3 K (feature): under cash-pay mode, frequency drives when
      // accrued interest hits the bank account (every freq periods). Under
      // capitalised mode the frequency setting is IRRELEVANT — interest
      // compounds into the balance every period regardless. The INFO note
      // below is therefore only emitted on cash-pay land loans.
      const llFreqRaw = (landLoan.interestPaymentFrequency ?? 1) > 0
        ? (landLoan.interestPaymentFrequency ?? 1) : 1;
      if (llFreqRaw > 1 && !landLoan.isCapitalised) {
        // B08 — Prefix with [INFO] so ChecksTab's prefix-aware routing renders
        // this as INFO not WARN.
        const cadenceLabel = llFreqRaw === 3
          ? 'Quarterly land-loan interest schedule active'
          : `Land-loan interest schedule = every ${llFreqRaw} periods`;
        _fundingWarnings.push(
          `[INFO] ${cadenceLabel} (cash-pay mode). Interest accrues monthly on the prior closing balance and is paid in cash at the end of each ${llFreqRaw}-period window — first cash charge: period ${landLoan.startMonth + llFreqRaw}.`
        );
      }
      // Cap-int fix: when the land loan is capitalised, the principal we
      // can safely draw is back-solved (`landLoanDrawCap`) so that the
      // worst-case compounded balance at maturity stays at-or-below the user
      // facilityLimit (covenant cap on peak balance). For cash-pay land
      // loans `landLoanDrawCap === landLoan.facilityLimit` so the drawdown
      // is unchanged from prior behaviour.
      const llActualDraw = landLoanDrawCap;
      llDrawdowns[i]     = llActualDraw;
      llRunningBalance  += llActualDraw;
      rawLLBalance      += llActualDraw;
      bankBalance       += llActualDraw;
      const estFee = llActualDraw * landLoan.establishmentFeePercent;
      if (estFee > 0) {
        llFees[i]      = estFee;
        totalLandFees += estFee;
        bankBalance   -= estFee;
        // K01 — GST uplift on non-exempt lender fees (always cash). Also
        // inflate the per-period fee field and total so feasibility totalCost
        // and cashflow netCashflow share a single source of truth.
        const upliftAmt = feeUpliftCash(landLoan, estFee);
        if (upliftAmt > 0) {
          bankBalance   -= upliftAmt;
          llFees[i]     += upliftAmt;
          totalLandFees += upliftAmt;
        }
      }
    }

    // ── 3. Land loan interest (accrued; cash-pay or capitalised per flag) ────
    // LL1: when landLoan.isCapitalised is true, accrued interest compounds into
    // llRunningBalance (no cash outflow during the holding period); when false
    // (default) interest is paid in cash each payment-frequency cycle. The
    // flag was previously ignored — interest was always cash-paid even on
    // facilities the user marked as capitalised. This is the more common
    // practice: most land loans are interest-only paid in cash during the
    // bridge period; some are capitalised so the developer holds no cash
    // burden until takeout.
    if (llOpenBalance > 0) {
      const accrued = periodInterest(llOpenBalance, landLoan.interestRate, days, daysPerYear);
      llAccruedInterest += accrued;

      const monthsSinceLLStart = i - llStartIdx;
      // Kew UAT v3 K — frequency only applies in cash-pay mode. Capitalised
      // land loans compound monthly regardless of the configured frequency
      // (the freq setting is exposed only for cash-pay schedules; the UI
      // disables the field when isCapitalised=true).
      const llFreq = landLoan.isCapitalised
        ? 1
        : (landLoan.interestPaymentFrequency > 0 ? landLoan.interestPaymentFrequency : 1);
      if ((monthsSinceLLStart + 1) % llFreq === 0) {
        llInterest[i]      = llAccruedInterest;
        totalLandInterest += llAccruedInterest;
        if (landLoan.isCapitalised) {
          // Capitalised: compound into balance; no cash impact this period.
          // The takeout transaction (step 4) will repay this in full from senior.
          llRunningBalance += llAccruedInterest;
          rawLLBalance     += llAccruedInterest;
          // Track as a synthetic drawdown for cashflow balance — interest
          // creates new debt rather than draining cash.
          llDrawdowns[i] += llAccruedInterest;
        } else {
          // Cash-pay: direct outflow at end of every llFreq-period window.
          // For freq=1 this fires every period; for freq=3 the cashflow shows
          // zero interest in periods 1,2,4,5,7,8,... and 3× monthly accrual
          // in periods 3,6,9,...
          bankBalance -= llAccruedInterest;
        }
        llAccruedInterest = 0;
      }
    }

    // ── 4. Senior takeout of land loan at construction start (LL2). ───────────
    // The senior facility refinances the land loan in full: senior drawdown
    // pays principal + any unpaid accrued interest directly. No net cash
    // movement to the project — it's a balance-sheet swap (land debt → senior
    // debt). Tracked separately via the dedicated memo so the cashflow UI
    // shows this as a single "Senior Takeout of Land Loan: $X" line rather
    // than two unbalanced rows.
    //
    // Covenant guard: if the takeout would push senior past its covenant cap,
    // emit a [FUNDING] warning. The takeout still happens (real-world senior
    // does refinance the land loan), but the project is in covenant breach
    // territory — the user must adjust facility / equity.
    if (hasSenior && i === snrStartIdx && llRunningBalance > 0) {
      // First, settle any unpaid accrued interest into the running balance so
      // the takeout amount captures the full obligation.
      if (llAccruedInterest > 0) {
        llRunningBalance += llAccruedInterest;
        rawLLBalance     += llAccruedInterest;
        // B01 — at takeout the unpaid accrued interest is de facto rolled
        // into senior (no actual cash outflow from the developer's bank
        // account; senior refinances it). This applies to BOTH branches:
        //   - capitalised LL: matches the LL1 capitalised path naturally.
        //   - cash-pay LL: when takeout happens between freq cycles, the
        //     stub interest hasn't been cash-paid yet. The cleanest model
        //     mirrors the cap-int branch — record as a synthetic drawdown
        //     so the cashflow row stays balanced.
        // Without this, netCashflow showed a residual drift of ~stub-interest
        // each takeout (Sydney v1 −$123K, Project Demo −$765K, Project Test
        // −$1.15M; magnitudes scaling with land-loan rate × span).
        llDrawdowns[i]    += llAccruedInterest;
        llInterest[i]     += llAccruedInterest;
        totalLandInterest += llAccruedInterest;
        llAccruedInterest  = 0;
      }
      const takeoutAmount = llRunningBalance;
      // Senior absorbs the takeout: drawdown + balance increase, no cash impact.
      snrDrawdowns[i]   += takeoutAmount;
      snrRunningBalance += takeoutAmount;
      rawSnrBalance     += takeoutAmount;
      rawPeakSnrBalance = Math.max(rawPeakSnrBalance, rawSnrBalance);
      // Land loan: explicit repayment, no cash decrement (senior paid it).
      llRepayments[i]   += takeoutAmount;
      llRunningBalance   = 0;
      rawLLBalance       = 0;
      // Track for UI display.
      landLoanTakeoutBySenior[i] = takeoutAmount;

      // Covenant guard: warn if takeout pushed senior past covenant cap.
      // Q1: route through the consolidator — the takeout-specific message is
      // preserved as a one-shot warning so the user sees the cause; the peak
      // / period-range is captured by the consolidated covenant-overshoot
      // summary emitted at end of solve.
      if (snrRunningBalance > seniorAutoSizeCap + 1) {
        // Bug A — same routing as the period-end emit. See mezz comment above.
        const seniorBinding: 'covenant' | 'facility' =
          seniorCovenantCap < seniorFacilityHardLimit ? 'covenant' : 'facility';
        recordCovenantOvershoot('senior', i + 1, snrRunningBalance, seniorAutoSizeCap,
          seniorBinding, senior.facilityLimit > 0 ? senior.facilityLimit : Infinity);
      }
    }
    llBalance[i] = llRunningBalance;

    // ── 5. Operating costs ─────────────────────────────────────────────────────
    bankBalance -= monthlyCostsExcFinance[i] ?? 0;

    // ── 6. Interest & fees on all senior facilities and mezz ──────────────────

    // Senior 1
    if (snrOpenBalance > 0) {
      const snrInt = periodInterest(snrOpenBalance, snrAllInRate, days, daysPerYear);
      snrInterest[i]      = snrInt;
      totalSeniorInterest += snrInt;
      if (senior.isCapitalised) {
        // Issue B — accrue WOULD-BE cap-int onto rawSnrBalance unconditionally.
        // rawSnrInt compounds on rawSnrOpenBalance (the un-capped raw balance),
        // so rawPeakSnrBalance is the true no-ceiling peak the shrink loop
        // needs to detect overshoots that FU2 hides.
        const rawSnrInt = periodInterest(rawSnrOpenBalance, snrAllInRate, days, daysPerYear);
        rawSnrBalance += rawSnrInt;
        rawPeakSnrBalance = Math.max(rawPeakSnrBalance, rawSnrBalance);
        // FU2 — Cap-int ceiling: if capitalising this period's interest would
        // push the senior running balance above its M4 covenant cap, switch
        // THIS period's interest to cash-pay instead of capitalising. Avoids
        // the previously-observed [FUNDING] covenant overshoot caused by
        // accrued interest accumulating on a balance already at the cap.
        if (snrRunningBalance + snrInt > seniorAutoSizeCap + 1) {
          bankBalance -= snrInt;
          recordCapIntCeilingHit('senior', i + 1, snrInt);
        } else {
          snrRunningBalance += snrInt;
          snrDrawdowns[i]   += snrInt;
        }
      } else {
        bankBalance -= snrInt;
      }
    }
    if (seniorActive) {
      let periodFees = 0;
      // Line fee basis: default 'peak-drawn' converges via the iterative solver.
      //   Some term sheets use 'committed-limit' (charge on approved facility size) or
      //   'undrawn-commitment' (charge only on the undrawn portion — commitment fee style).
      //   Configure via seniorFacility.lineFeeBasis. KEEP DEFAULT BEHAVIOR UNLESS
      //   TERM SHEET SPECIFIES OTHERWISE — see CLAUDE.md for methodology notes.
      const snrLineFeeBase = resolveLineFeeBase(senior, seniorLimit, snrRunningBalance, peakSnrBalancePrev);
      periodFees += periodInterest(snrLineFeeBase, senior.lineFeePercent, days, daysPerYear);
      if (i === snrStartIdx) {
        periodFees += seniorLimit * senior.establishmentFeePercent;
      }
      if (periodFees > 0) {
        snrFees[i]        = periodFees;
        totalSeniorFees  += periodFees;
        if (senior.isCapitalised) {
          // Issue B — fees always grow the would-be balance even when the
          // ceiling diverts them to cash. rawSnrBalance therefore captures
          // the unsuppressed peak.
          rawSnrBalance += periodFees;
          rawPeakSnrBalance = Math.max(rawPeakSnrBalance, rawSnrBalance);
          // FU2 — same cap-int ceiling guard for capitalised fees.
          if (snrRunningBalance + periodFees > seniorAutoSizeCap + 1) {
            bankBalance -= periodFees;
            recordCapIntCeilingHit('senior', i + 1, periodFees);
          } else {
            snrRunningBalance += periodFees;
            snrDrawdowns[i]   += periodFees;
          }
        } else {
          bankBalance -= periodFees;
        }
        // K01 — GST uplift on non-exempt senior fees (always cash, never capitalised).
        const upliftAmt = feeUpliftCash(senior, periodFees);
        if (upliftAmt > 0) {
          bankBalance     -= upliftAmt;
          snrFees[i]      += upliftAmt;
          totalSeniorFees += upliftAmt;
        }
      }
    }

    // Senior 2
    if (snr2OpenBalance > 0) {
      const snr2Int = periodInterest(snr2OpenBalance, snr2AllInRate, days, daysPerYear);
      snr2Interest[i]      = snr2Int;
      totalSenior2Interest += snr2Int;
      if (senior2.isCapitalised) {
        // Issue B — see senior interest block.
        const rawSnr2Int = periodInterest(rawSnr2OpenBalance, snr2AllInRate, days, daysPerYear);
        rawSnr2Balance += rawSnr2Int;
        rawPeakSnr2Balance = Math.max(rawPeakSnr2Balance, rawSnr2Balance);
        if (snr2RunningBalance + snr2Int > senior2CovenantCap + 1) {
          bankBalance -= snr2Int;
          recordCapIntCeilingHit('senior2', i + 1, snr2Int);
        } else {
          snr2RunningBalance += snr2Int;
          snr2Drawdowns[i]   += snr2Int;
        }
      } else {
        bankBalance -= snr2Int;
      }
    }
    if (senior2Active) {
      let periodFees = 0;
      const snr2LineFeeBase = resolveLineFeeBase(senior2, senior2Limit, snr2RunningBalance, peakSnr2BalancePrev);
      periodFees += periodInterest(snr2LineFeeBase, senior2.lineFeePercent, days, daysPerYear);
      if (i === snr2StartIdx) {
        periodFees += senior2Limit * senior2.establishmentFeePercent;
      }
      if (periodFees > 0) {
        snr2Fees[i]       = periodFees;
        totalSenior2Fees += periodFees;
        if (senior2.isCapitalised) {
          // Issue B — see senior fees block.
          rawSnr2Balance += periodFees;
          rawPeakSnr2Balance = Math.max(rawPeakSnr2Balance, rawSnr2Balance);
          if (snr2RunningBalance + periodFees > senior2CovenantCap + 1) {
            bankBalance -= periodFees;
            recordCapIntCeilingHit('senior2', i + 1, periodFees);
          } else {
            snr2RunningBalance += periodFees;
            snr2Drawdowns[i]   += periodFees;
          }
        } else {
          bankBalance -= periodFees;
        }
        // K01 — GST uplift on non-exempt Senior #2 fees (always cash).
        const upliftAmt = feeUpliftCash(senior2, periodFees);
        if (upliftAmt > 0) {
          bankBalance      -= upliftAmt;
          snr2Fees[i]      += upliftAmt;
          totalSenior2Fees += upliftAmt;
        }
      }
    }

    // Mezzanine interest
    if (mzOpenBalance > 0) {
      const mzInt = periodInterest(mzOpenBalance, mezzAllInRate, days, daysPerYear);
      mzInterest[i]      = mzInt;
      totalMezzInterest += mzInt;
      if (mezz.isCapitalised) {
        // Issue B — accrue would-be cap-int onto rawMezzBalance regardless
        // of the FU2 ceiling firing. This is the signal that lets the
        // timing-aware shrink loop tighten the principal cap when interest
        // accrual on a near-cap balance would otherwise get silently
        // converted to cash-pay (the original Dandenong bug).
        const rawMzInt = periodInterest(rawMezzOpenBalance, mezzAllInRate, days, daysPerYear);
        rawMezzBalance += rawMzInt;
        rawPeakMezzBalance = Math.max(rawPeakMezzBalance, rawMezzBalance);
        if (mzRunningBalance + mzInt > mezzAutoSizeCap + 1) {
          bankBalance -= mzInt;
          recordCapIntCeilingHit('mezz', i + 1, mzInt);
        } else {
          mzRunningBalance += mzInt;
          mzDrawdowns[i]   += mzInt;
          totalMezzDrawn   += mzInt; // capitalised interest increases effective drawn amount
        }
      } else {
        bankBalance -= mzInt;
      }

      const mzLineFeeBase = resolveLineFeeBase(mezz, mezzLimit, mzRunningBalance, peakMezzBalancePrev);
      const mzLineFee = periodInterest(mzLineFeeBase, mezz.lineFeePercent, days, daysPerYear);
      if (mzLineFee > 0) {
        mzFees[i]       += mzLineFee;
        totalMezzFees   += mzLineFee;
        if (mezz.isCapitalised) {
          // Issue B — fees grow the would-be balance even when the ceiling
          // diverts them to cash.
          rawMezzBalance += mzLineFee;
          rawPeakMezzBalance = Math.max(rawPeakMezzBalance, rawMezzBalance);
          if (mzRunningBalance + mzLineFee > mezzAutoSizeCap + 1) {
            bankBalance -= mzLineFee;
            recordCapIntCeilingHit('mezz', i + 1, mzLineFee);
          } else {
            mzRunningBalance += mzLineFee;
            mzDrawdowns[i]   += mzLineFee;
            totalMezzDrawn   += mzLineFee; // capitalised fees also count toward limit
          }
        } else {
          bankBalance -= mzLineFee;
        }
        // K01 — GST uplift on non-exempt mezz line fee (always cash).
        const upliftAmt = feeUpliftCash(mezz, mzLineFee);
        if (upliftAmt > 0) {
          bankBalance   -= upliftAmt;
          mzFees[i]     += upliftAmt;
          totalMezzFees += upliftAmt;
        }
      }
    }
    if (hasMezz && i === mezzStartIdx) {
      const mzEstFee = mezzLimit * mezz.establishmentFeePercent;
      if (mzEstFee > 0) {
        mzFees[i]     += mzEstFee;
        totalMezzFees += mzEstFee;
        if (mezz.isCapitalised) {
          // Issue B — est fee grows would-be balance even when ceiling diverts.
          rawMezzBalance += mzEstFee;
          rawPeakMezzBalance = Math.max(rawPeakMezzBalance, rawMezzBalance);
          if (mzRunningBalance + mzEstFee > mezzAutoSizeCap + 1) {
            bankBalance -= mzEstFee;
            recordCapIntCeilingHit('mezz', i + 1, mzEstFee);
          } else {
            mzRunningBalance += mzEstFee;
            mzDrawdowns[i]   += mzEstFee;
          }
        } else {
          bankBalance -= mzEstFee;
        }
        // K01 — GST uplift on non-exempt mezz establishment fee (always cash).
        const upliftAmt = feeUpliftCash(mezz, mzEstFee);
        if (upliftAmt > 0) {
          bankBalance   -= upliftAmt;
          mzFees[i]     += upliftAmt;
          totalMezzFees += upliftAmt;
        }
      }
    }

    // ── 7. Senior 1 initialisation: land loan refi + excess equity repatriation ─
    if (hasSenior && i === snrStartIdx) {
      if (llRepayments[i] > 0) {
        snrDrawdowns[i]   += llRepayments[i];
        snrRunningBalance += llRepayments[i];
        rawSnrBalance     += llRepayments[i];
        rawPeakSnrBalance = Math.max(rawPeakSnrBalance, rawSnrBalance);
        bankBalance       += llRepayments[i];
      }
      if (cumulativeEquity > totalEquityCap) {
        const excess   = cumulativeEquity - totalEquityCap;
        const snrAvail = Math.max(0, seniorLimit - snrRunningBalance);
        const draw     = Math.min(excess, snrAvail);
        if (draw > 0) {
          snrDrawdowns[i]    += draw;
          snrRunningBalance  += draw;
          rawSnrBalance      += draw;
          rawPeakSnrBalance = Math.max(rawPeakSnrBalance, rawSnrBalance);
          // Split repatriation pro-rata between JV and Developer
          const jvFrac = cumulativeEquity > 0 ? jvCumulative / cumulativeEquity : 0;
          const jvRep  = draw * jvFrac;
          jvRepatriations[i] += jvRep;
          eqRepatriations[i] += draw;
          jvCumulative       -= jvRep;
          cumulativeEquity   -= draw;
          totalJVRepatriated += jvRep;
          totalEqRepatriated += draw;
        }
      }
    }

    // ── 8. Revenue ────────────────────────────────────────────────────────────
    bankBalance += (monthlyRevenue[i] ?? 0) - (gstOnRevenue[i] ?? 0);

    // ── 9. Gap fill ────────────────────────────────────────────────────────────
    if (bankBalance < 0) {
      if (equityDrawdownMode === 'pro-rata' && seniorDrawActive) {
        // Pro-rata: split the gap proportionally between Developer equity and senior each period.
        // M4 — Auto-size senior up to the covenant cap (not the requested limit).
        //
        // Gate uses `seniorDrawActive` (NOT `constructionPhaseActive`) because
        // pro-rata's semantic is specifically "split this period's gap between
        // developer equity and senior-1". When senior-1 is mature, no split is
        // possible — falling through to the equity-first else branch below lets
        // senior-2 / mezz / JV / developer all be exercised via the standard
        // priority loop, instead of being silently skipped by the pro-rata
        // branch's inner loop (which only handles JV).
        const gap = -bankBalance;
        const eqAvail  = Math.max(0, developerCap - (cumulativeEquity - jvCumulative));
        const snrAvail = Math.max(0, seniorAutoSizeCap - snrRunningBalance);
        const totalAvail = eqAvail + snrAvail;
        if (totalAvail > 0) {
          const eqDraw  = Math.min(gap * (eqAvail  / totalAvail), eqAvail);
          const snrDraw = Math.min(gap * (snrAvail / totalAvail), snrAvail);
          if (eqDraw > 0) {
            eqInjections[i] += eqDraw;
            cumulativeEquity += eqDraw;
            bankBalance      += eqDraw;
          }
          if (snrDraw > 0) {
            snrDrawdowns[i]   += snrDraw;
            snrRunningBalance += snrDraw;
            rawSnrBalance     += snrDraw;
            rawPeakSnrBalance = Math.max(rawPeakSnrBalance, rawSnrBalance);
            bankBalance       += snrDraw;
          }
        }
        // JV equity and other facilities still fill in priority order after pro-rata
        for (const entry of drawdownSequence) {
          if (bankBalance >= 0) break;
          if (entry.type === 'equityJV' && isJVActive) {
            const avail = Math.max(0, jvCap - jvCumulative);
            if (avail > 0) {
              const draw = Math.min(-bankBalance, avail);
              jvInjections[i] += draw; eqInjections[i] += draw;
              jvCumulative += draw; cumulativeEquity += draw; bankBalance += draw;
            }
          }
        }
      } else if (equityDrawdownMode === 'senior-first' && constructionPhaseActive) {
        // Senior-first (recommended for standard Australian dev finance): once
        // construction has started, debt facilities absorb the gap BEFORE equity.
        // Equity only steps in when all debt is at LTC/LVR/facility cap. Pre-
        // construction periods (handled by the else branch below) keep the
        // existing equity-priority behaviour, so equity still covers land + DA.
        //
        // Review #2 fix — debt is iterated in TRANCHE order (senior → senior2 →
        // mezz), NOT by drawdownPriority. Filtering drawdownSequence preserved
        // priority order, which on default settings (mezz=3, senior=4) put mezz
        // first inside the debt batch — exactly opposite of intended behaviour.
        // Build the senior-first iteration order explicitly from the typed
        // facilities, ignoring drawdownPriority for debt; equity facilities
        // retain their relative drawdownPriority order in the second batch.
        const tranchOrderTypes = ['senior', 'senior2', 'mezz'] as const;
        const debtEntries = tranchOrderTypes
          .map(t => drawdownSequence.find(e => e.type === t))
          .filter((e): e is typeof drawdownSequence[number] => e !== undefined);
        const equityEntries = drawdownSequence.filter(e =>
          e.type !== 'senior' && e.type !== 'senior2' && e.type !== 'mezz');
        const debtFirstSequence = [...debtEntries, ...equityEntries];
        for (const entry of debtFirstSequence) {
          if (bankBalance >= 0) break;

          if (entry.type === 'senior' && seniorDrawActive) {
            const avail = Math.max(0, seniorAutoSizeCap - snrRunningBalance);
            if (avail > 0) {
              const draw         = Math.min(-bankBalance, avail);
              snrDrawdowns[i]   += draw;
              snrRunningBalance += draw;
              rawSnrBalance     += draw;
              rawPeakSnrBalance = Math.max(rawPeakSnrBalance, rawSnrBalance);
              bankBalance       += draw;
            }
          } else if (entry.type === 'senior2' && senior2DrawActive) {
            const avail = Math.max(0, senior2Limit - snr2RunningBalance);
            if (avail > 0) {
              const draw          = Math.min(-bankBalance, avail);
              snr2Drawdowns[i]   += draw;
              snr2RunningBalance += draw;
              rawSnr2Balance     += draw;
              rawPeakSnr2Balance = Math.max(rawPeakSnr2Balance, rawSnr2Balance);
              bankBalance        += draw;
            }
          } else if (entry.type === 'mezz' && hasMezz && i >= mezzStartIdx) {
            const avail = Math.max(0, mezzAutoSizeCap - totalMezzDrawn);
            if (avail > 0) {
              const draw         = Math.min(-bankBalance, avail);
              mzDrawdowns[i]    += draw;
              mzRunningBalance  += draw;
              rawMezzBalance    += draw;
              rawPeakMezzBalance = Math.max(rawPeakMezzBalance, rawMezzBalance);
              totalMezzDrawn    += draw;
              bankBalance       += draw;
            }
          } else if (entry.type === 'equity') {
            const avail = Math.max(0, developerCap - (cumulativeEquity - jvCumulative));
            if (avail > 0) {
              const draw       = Math.min(-bankBalance, avail);
              eqInjections[i] += draw;
              cumulativeEquity += draw;
              bankBalance      += draw;
            }
          } else if (entry.type === 'equityJV' && isJVActive) {
            const avail = Math.max(0, jvCap - jvCumulative);
            if (avail > 0) {
              const draw         = Math.min(-bankBalance, avail);
              jvInjections[i]   += draw;
              eqInjections[i]   += draw;
              jvCumulative      += draw;
              cumulativeEquity  += draw;
              bankBalance       += draw;
            }
          }
        }
      } else {
        // Equity-first (default): draw in strict priority order
        for (const entry of drawdownSequence) {
          if (bankBalance >= 0) break;

          if (entry.type === 'senior' && seniorDrawActive) {
            // M4 — Auto-size headroom: avail is computed against the covenant
            // cap, not the requested facilityLimit. If the balance grows beyond
            // facilityLimit, the engine surfaces an 'Auto-sized senior' notice.
            const avail = Math.max(0, seniorAutoSizeCap - snrRunningBalance);
            if (avail > 0) {
              const draw         = Math.min(-bankBalance, avail);
              snrDrawdowns[i]   += draw;
              snrRunningBalance += draw;
              rawSnrBalance     += draw;
              rawPeakSnrBalance = Math.max(rawPeakSnrBalance, rawSnrBalance);
              bankBalance       += draw;
            }
          } else if (entry.type === 'senior2' && senior2DrawActive) {
            const avail = Math.max(0, senior2Limit - snr2RunningBalance);
            if (avail > 0) {
              const draw          = Math.min(-bankBalance, avail);
              snr2Drawdowns[i]   += draw;
              snr2RunningBalance += draw;
              rawSnr2Balance     += draw;
              rawPeakSnr2Balance = Math.max(rawPeakSnr2Balance, rawSnr2Balance);
              bankBalance        += draw;
            }
          } else if (entry.type === 'mezz' && hasMezz && i >= mezzStartIdx) {
            // M4 — Auto-size headroom (mirror senior).
            const avail = Math.max(0, mezzAutoSizeCap - totalMezzDrawn);
            if (avail > 0) {
              const draw         = Math.min(-bankBalance, avail);
              mzDrawdowns[i]    += draw;
              mzRunningBalance  += draw;
              rawMezzBalance    += draw;
              rawPeakMezzBalance = Math.max(rawPeakMezzBalance, rawMezzBalance);
              totalMezzDrawn    += draw;
              bankBalance       += draw;
            }
          } else if (entry.type === 'equity') {
            const avail = Math.max(0, developerCap - (cumulativeEquity - jvCumulative));
            if (avail > 0) {
              const draw       = Math.min(-bankBalance, avail);
              eqInjections[i] += draw;
              cumulativeEquity += draw;
              bankBalance      += draw;
            }
          } else if (entry.type === 'equityJV' && isJVActive) {
            const avail = Math.max(0, jvCap - jvCumulative);
            if (avail > 0) {
              const draw         = Math.min(-bankBalance, avail);
              jvInjections[i]   += draw;
              eqInjections[i]   += draw;
              jvCumulative      += draw;
              cumulativeEquity  += draw;
              bankBalance       += draw;
            }
          }
        }
      }

      // Equity backstop — developer (Developer) is always the equity of last resort
      if (bankBalance < 0) {
        const backstop = -bankBalance;
        const developerUsed = cumulativeEquity - jvCumulative;
        const developerRemaining = Math.max(0, developerCap - developerUsed);
        if (backstop > developerRemaining + 1) {
          // Q1 — consolidate per-period equity-backstop overshoots
          recordEquityBackstopOvershoot(i + 1, backstop, developerRemaining);
        }
        eqInjections[i] += backstop;
        cumulativeEquity += backstop;
        bankBalance       = 0;
      }
    }

    // ── 10. Revenue sweep — order driven by repaymentSequence (M3). ──────────
    // Default legal priority: senior → mezz → equity. Cash-sweep alternative:
    // mezz → senior → equity (sometimes used on retail fund mandates). Equity
    // is enforced last by convention regardless of where it appears in the
    // sequence. Senior #2 always follows Senior #1 inside the "senior" tranche.
    if (bankBalance > 0) {
      const repaySenior = () => {
        if (bankBalance > 0 && snrRunningBalance > 0) {
          const repay        = Math.min(bankBalance, snrRunningBalance);
          snrRepayments[i]  += repay;
          snrRunningBalance -= repay;
          rawSnrBalance     -= repay;
          bankBalance       -= repay;
        }
        if (bankBalance > 0 && snr2RunningBalance > 0) {
          const repay         = Math.min(bankBalance, snr2RunningBalance);
          snr2Repayments[i]  += repay;
          snr2RunningBalance -= repay;
          rawSnr2Balance    -= repay;
          bankBalance        -= repay;
        }
      };
      const repayMezz = () => {
        if (bankBalance > 0 && mzRunningBalance > 0) {
          const repay        = Math.min(bankBalance, mzRunningBalance);
          mzRepayments[i]   += repay;
          mzRunningBalance  -= repay;
          rawMezzBalance    -= repay;
          bankBalance       -= repay;
        }
      };
      // Walk the configured sequence; equity handled separately after debt is done.
      for (const t of repaymentSequence) {
        if (bankBalance <= 0) break;
        if (t === 'senior') repaySenior();
        else if (t === 'mezz') repayMezz();
        // 'equity' tranche handled below — equity is always processed last
      }
      // If equity isn't explicitly in the sequence, still process it last.
      if (bankBalance > 0) {
        if (i < eqDistStartIdx && i < n - 1) {
          // Before the distribution window: hold surplus in the project account.
          // Exception: at the final period, release held balance regardless of window.
          heldBankBalance += bankBalance;
          bankBalance      = 0;
        } else {
          // Equity repatriation — pro-rata between JV and Developer based on outstanding
          const jvOutstanding     = Math.max(0, jvCumulative - totalJVRepatriated);
          const totalOutstanding  = Math.max(0, cumulativeEquity - totalEqRepatriated);
          if (totalOutstanding > 0) {
            const eqReturn  = Math.min(bankBalance, totalOutstanding);
            const jvFrac    = jvOutstanding / totalOutstanding;
            const jvRep     = eqReturn * jvFrac;
            jvRepatriations[i]  += jvRep;
            eqRepatriations[i]  += eqReturn;
            totalJVRepatriated  += jvRep;
            totalEqRepatriated  += eqReturn;
            bankBalance         -= eqReturn;
          }
          if (bankBalance > 0) {
            // Profit distribution — jvShr is stored as a decimal fraction (e.g. 0.15 = 15%).
            // Apply it directly; dev gets the remainder implicitly via profitDist - jvProfitDist.
            const jvShr    = inputs.equityJV?.profitShare ?? 0;
            const jvProfit = bankBalance * jvShr;
            jvProfitDist[i] += jvProfit;
            profitDist[i]   += bankBalance;
            bankBalance      = 0;
          }
        }
      }
    }

    // ── 10c. Senior maturity balloon repayment ──────────────────────────────
    // At maturity the facility is hard-closed (matches the seniorDrawActive
    // gating above). If the revenue sweep above didn't fully clear the balance,
    // pull whatever's left from the project bank account; if the bank is short,
    // force an equity backstop draw to cover the residual. This makes the
    // facility actually go to $0 on its maturity month instead of accruing
    // interest indefinitely. For lender-facing models with planned residual-stock
    // refinance, set the senior `maturityMonth` to the refinance month and size
    // the residual stock facility accordingly — the equity backstop only fires
    // when neither revenue nor a takeover facility cleared the balance in time.
    const closeOutAtMaturity = (
      isMaturityPeriod: boolean,
      runningBalance: number,
      applyRepay: (amt: number) => void,
    ) => {
      if (!isMaturityPeriod || runningBalance <= 1) return;
      let toRepay = runningBalance;
      const fromBank = Math.min(Math.max(0, bankBalance), toRepay);
      if (fromBank > 0) {
        bankBalance -= fromBank;
        toRepay     -= fromBank;
        applyRepay(fromBank);
      }
      if (toRepay > 1) {
        // Equity-of-last-resort backstop. Track against the developer cap so the
        // [FUNDING] equity-cap-overshoot warning still fires when the maturity
        // shortfall pushes the converged draw past the user-set ceiling.
        const developerUsed = cumulativeEquity - jvCumulative;
        const developerRemaining = Math.max(0, developerCap - developerUsed);
        if (toRepay > developerRemaining + 1) {
          recordEquityBackstopOvershoot(i + 1, toRepay, developerRemaining);
        }
        eqInjections[i]  += toRepay;
        cumulativeEquity += toRepay;
        applyRepay(toRepay);
      }
    };
    closeOutAtMaturity(hasSenior && i === snrEndIdx, snrRunningBalance, (amt) => {
      snrRepayments[i]  += amt;
      snrRunningBalance -= amt;
      rawSnrBalance     -= amt;
    });
    closeOutAtMaturity(hasSenior2 && i === snr2EndIdx, snr2RunningBalance, (amt) => {
      snr2Repayments[i]  += amt;
      snr2RunningBalance -= amt;
      rawSnr2Balance     -= amt;
    });

    // ── 10b. Final-period equity clawback (M2). ─────────────────────────────
    // At project end, if any debt remains AND any equity has been repatriated,
    // claw back the equity to fully repay the debt. Cap-int residual on debt
    // must be 0 except when project revenue + total equity is collectively
    // insufficient (genuine default scenario, separately flagged below).
    // Repayment order honours the configured repaymentSequence.
    if (i === n - 1) {
      const debtResidual = snrRunningBalance + snr2RunningBalance + mzRunningBalance;
      if (debtResidual > 1 && totalEqRepatriated > 1) {
        const clawback = Math.min(debtResidual, totalEqRepatriated);
        // Reverse equity repatriation by reducing the most-recent eqRepatriations entry.
        // Walk back through the timeline for the period that has the most repatriation.
        let remaining = clawback;
        for (let k = i; k >= 0 && remaining > 1; k--) {
          const reverse = Math.min(remaining, eqRepatriations[k] ?? 0);
          if (reverse > 0) {
            eqRepatriations[k] = (eqRepatriations[k] ?? 0) - reverse;
            // JV repatriation pro-rata reversal — we keep the JV/Dev split proportional
            // to the original return (totalEqRepatriated already includes JV).
            const jvShare = (totalJVRepatriated > 0 && totalEqRepatriated > 0)
              ? (jvRepatriations[k] ?? 0) / (eqRepatriations[k] + reverse)
              : 0;
            const jvReverse = reverse * jvShare;
            jvRepatriations[k] = Math.max(0, (jvRepatriations[k] ?? 0) - jvReverse);
            totalJVRepatriated -= jvReverse;
            totalEqRepatriated -= reverse;
            remaining -= reverse;
          }
        }
        // Now apply the clawback to debt in repaymentSequence order. Re-use the
        // tranche order to mirror the cash-sweep semantics.
        let toApply = clawback - remaining; // actually clawed-back amount
        for (const t of repaymentSequence) {
          if (toApply <= 1) break;
          if (t === 'senior') {
            if (snrRunningBalance > 0) {
              const r = Math.min(snrRunningBalance, toApply);
              snrRepayments[i] = (snrRepayments[i] ?? 0) + r;
              snrRunningBalance -= r;
              rawSnrBalance     -= r;
              toApply -= r;
            }
            if (toApply > 1 && snr2RunningBalance > 0) {
              const r = Math.min(snr2RunningBalance, toApply);
              snr2Repayments[i] = (snr2Repayments[i] ?? 0) + r;
              snr2RunningBalance -= r;
              rawSnr2Balance     -= r;
              toApply -= r;
            }
          } else if (t === 'mezz') {
            if (mzRunningBalance > 0) {
              const r = Math.min(mzRunningBalance, toApply);
              mzRepayments[i] = (mzRepayments[i] ?? 0) + r;
              mzRunningBalance -= r;
              rawMezzBalance   -= r;
              toApply -= r;
            }
          }
        }
      }
      // Default check: if debt remains AFTER clawback exhausted, surface as default.
      // B02 — consolidate per-iteration spam: each iteration's residual differs
      // by a few dollars and escapes the exact-string Set-dedupe; route through
      // the accumulator so end-of-solve produces ONE summary message.
      const remainingDebt = snrRunningBalance + snr2RunningBalance + mzRunningBalance;
      if (remainingDebt > 1) {
        recordProjectDefault(i + 1, remainingDebt);
      }
    }

    // ── 11. Record closing balances ────────────────────────────────────────────
    snrBalance[i]   = Math.max(0, snrRunningBalance);
    snr2Balance[i]  = Math.max(0, snr2RunningBalance);
    mzBalance[i]    = Math.max(0, mzRunningBalance);

    // D1: Facility-cap overshoot. If capitalised interest has pushed a balance
    // above its committed limit, the model is implicitly relying on an
    // accordion the lender hasn't committed. Surface so the term sheet can be
    // restructured (or interest paid current rather than capitalised).
    // Q1 — consolidate per-period covenant breaches & auto-size INFOs.
    // Iterations of the solver drift $X each pass; the consolidator keeps the
    // peak across iterations and emits ONE summary at end of converged solve.
    if (mzRunningBalance > mezzAutoSizeCap + 1) {
      // Bug A — bindingKind tracks WHICH cap of the min() set the binding.
      // If covenant cap (LTC/LVR) < facility-derived cap, the binding cap is
      // a real lender covenant — peak above is a covenant breach (WARN).
      // Otherwise the binding cap is the back-solved facility principal cap
      // and a peak above is only a real breach if peak > facilityLimit
      // (decided at flush). mezz.facilityLimit is the user's headline limit.
      const mezzBinding: 'covenant' | 'facility' =
        mezzCovenantCap < mezzFacilityHardLimit ? 'covenant' : 'facility';
      recordCovenantOvershoot('mezz', i + 1, mzRunningBalance, mezzAutoSizeCap,
        mezzBinding, mezz.facilityLimit > 0 ? mezz.facilityLimit : Infinity);
    } else if (mezzRequestedLimit > 0 && mezzRequestedLimit < mezzAutoSizeCap && mzRunningBalance > mezzRequestedLimit + 1) {
      recordAutoSize('mezz', mezzRequestedLimit, mzRunningBalance, mezzAutoSizeCap);
    }
    // M4 — Distinguish auto-size (within covenant) from genuine over-cap
    // (capitalised interest pushed beyond covenant). Q1 — consolidate per-period
    // emits via the accumulator: peak / period-range / single summary at end.
    if (snrRunningBalance > seniorAutoSizeCap + 1) {
      // Bug A — see mezz comment above. seniorCovenantCap = min(LTC, LVR);
      // seniorFacilityHardLimit = back-solved principal cap (timing-aware).
      const seniorBinding: 'covenant' | 'facility' =
        seniorCovenantCap < seniorFacilityHardLimit ? 'covenant' : 'facility';
      recordCovenantOvershoot('senior', i + 1, snrRunningBalance, seniorAutoSizeCap,
        seniorBinding, senior.facilityLimit > 0 ? senior.facilityLimit : Infinity);
    } else if (seniorRequestedLimit > 0 && seniorRequestedLimit < seniorAutoSizeCap && snrRunningBalance > seniorRequestedLimit + 1) {
      recordAutoSize('senior', seniorRequestedLimit, snrRunningBalance, seniorAutoSizeCap);
    }
    if (senior2Limit > 0 && snr2RunningBalance > senior2Limit + 1) {
      // Q1 — consolidate per-period Senior #2 cap overshoots. Bug A — route
      // through recordCovenantOvershoot with the proper bindingKind so the
      // two-tier WARN/INFO flush applies uniformly to all three facilities.
      const senior2Binding: 'covenant' | 'facility' =
        senior2CovenantCap < senior2FacilityHardLimit ? 'covenant' : 'facility';
      recordCovenantOvershoot('senior2', i + 1, snr2RunningBalance, senior2Limit,
        senior2Binding, senior2.facilityLimit > 0 ? senior2.facilityLimit : Infinity);
    }

    peakDebt = Math.max(peakDebt,
      snrRunningBalance + snr2RunningBalance
      + llRunningBalance + mzRunningBalance);
    peakSnrBalance  = Math.max(peakSnrBalance,  snrRunningBalance);
    peakSnr2Balance = Math.max(peakSnr2Balance, snr2RunningBalance);
    peakMezzBalance = Math.max(peakMezzBalance, mzRunningBalance);

    // Issue 3 — Baseline raw-peak floor. The interest/fee cap-int ceiling
    // already updated rawPeak* with would-be values BEFORE the ceiling
    // fired (see senior/mezz interest blocks above). For cash-pay
    // facilities (no ceiling fires) and for periods where principal
    // drawdown alone exceeds the prior raw peak, ensure rawPeak* stays
    // >= the post-period running balance so the shrink loop never
    // under-counts the actual exposure.
    rawPeakSnrBalance  = Math.max(rawPeakSnrBalance,  rawSnrBalance);
    rawPeakSnr2Balance = Math.max(rawPeakSnr2Balance, rawSnr2Balance);
    rawPeakMezzBalance = Math.max(rawPeakMezzBalance, rawMezzBalance);
    rawPeakLandLoanBal = Math.max(rawPeakLandLoanBal, rawLLBalance);

    // Peak equity outstanding (cumulative injections − repatriations at this period)
    const equityOutstanding = cumulativeEquity - totalEqRepatriated;
    if (equityOutstanding > peakEquityDrawn) {
      peakEquityDrawn = equityOutstanding;
      peakEquityMonth = i + 1;
    }
  }

  return {
    landLoanBalance: llBalance,
    landLoanDrawdowns: llDrawdowns,
    landLoanRepayments: llRepayments,
    landLoanInterest: llInterest,
    landLoanFees: llFees,
    landLoanTakeoutBySenior,

    seniorBalance: snrBalance,
    seniorDrawdowns: snrDrawdowns,
    seniorRepayments: snrRepayments,
    seniorInterest: snrInterest,
    seniorFees: snrFees,

    senior2Balance: snr2Balance,
    senior2Drawdowns: snr2Drawdowns,
    senior2Repayments: snr2Repayments,
    senior2Interest: snr2Interest,
    senior2Fees: snr2Fees,

    mezzBalance: mzBalance,
    mezzDrawdowns: mzDrawdowns,
    mezzRepayments: mzRepayments,
    mezzInterest: mzInterest,
    mezzFees: mzFees,

    equityInjections: eqInjections,
    equityRepatriations: eqRepatriations,
    profitDistributions: profitDist,
    equityJVInjections: jvInjections,
    equityJVRepatriations: jvRepatriations,
    jvProfitDistributions: jvProfitDist,

    totalSeniorInterest,
    totalSeniorFees,
    totalSenior2Interest,
    totalSenior2Fees,
    totalMezzInterest,
    totalMezzFees,
    totalLandLoanInterest: totalLandInterest,
    totalLandLoanFees: totalLandFees,
    totalEquityInjected: cumulativeEquity,
    totalJVEquityInjected: jvCumulative,
    peakDebt,
    peakEquity: peakEquityDrawn,
    peakEquityMonth,
    seniorFacilitySize:  peakSnrBalance,
    seniorFacilityLimit: hasSenior ? seniorLimit : 0,
    senior2FacilitySize: peakSnr2Balance,
    senior2FacilityLimit: hasSenior2 ? senior2Limit : 0,
    mezzFacilitySize: peakMezzBalance,
    // Issue 3 — Timing-aware would-be peaks for the shrink loop. See
    // FundingResult.rawPeak doc for full rationale.
    rawPeak: {
      senior:   rawPeakSnrBalance,
      senior2:  rawPeakSnr2Balance,
      mezz:     rawPeakMezzBalance,
      landLoan: rawPeakLandLoanBal,
    },
    // Populated in solveFunding():
    converged: false,
    convergedIn: null,
    iterations: 0,
    convergenceDelta: 0,
    minEquityCheck: {
      required: 0, actual: 0, basisAmount: 0,
      basisName: 'TDC + financing costs', shortfall: 0,
    },
    equityCapCheck: {
      developer: { drawn: 0, cap: 0, overshoot: 0, overshootPct: 0, severity: 'pass', fundingGap: 0 },
      jv:        { drawn: 0, cap: 0, overshoot: 0, overshootPct: 0, severity: 'pass', fundingGap: 0 },
    },
  };
}

function createEmptyResult(n: number): FundingResult {
  const z = () => new Array(n).fill(0);
  return {
    landLoanBalance: z(), landLoanDrawdowns: z(), landLoanRepayments: z(),
    landLoanInterest: z(), landLoanFees: z(), landLoanTakeoutBySenior: z(),
    seniorBalance: z(), seniorDrawdowns: z(), seniorRepayments: z(),
    seniorInterest: z(), seniorFees: z(),
    senior2Balance: z(), senior2Drawdowns: z(), senior2Repayments: z(),
    senior2Interest: z(), senior2Fees: z(),
    mezzBalance: z(), mezzDrawdowns: z(), mezzRepayments: z(),
    mezzInterest: z(), mezzFees: z(),
    equityInjections: z(), equityRepatriations: z(), profitDistributions: z(),
    equityJVInjections: z(), equityJVRepatriations: z(), jvProfitDistributions: z(),
    totalSeniorInterest: 0, totalSeniorFees: 0,
    totalSenior2Interest: 0, totalSenior2Fees: 0,
    totalMezzInterest: 0, totalMezzFees: 0,
    totalLandLoanInterest: 0, totalLandLoanFees: 0,
    totalEquityInjected: 0, totalJVEquityInjected: 0,
    peakDebt: 0,
    peakEquity: 0, peakEquityMonth: 0,
    seniorFacilitySize: 0, seniorFacilityLimit: 0,
    senior2FacilitySize: 0, senior2FacilityLimit: 0,
    mezzFacilitySize: 0,
    rawPeak: { senior: 0, senior2: 0, mezz: 0, landLoan: 0 },
    converged: false,
    convergedIn: null, iterations: 0, convergenceDelta: Infinity,
    // Empty stub — overwritten by computeMinEquityCheck post-convergence.
    minEquityCheck: {
      required: 0, actual: 0, basisAmount: 0,
      basisName: 'TDC + financing costs', shortfall: 0,
    },
    equityCapCheck: {
      developer: { drawn: 0, cap: 0, overshoot: 0, overshootPct: 0, severity: 'pass', fundingGap: 0 },
      jv:        { drawn: 0, cap: 0, overshoot: 0, overshootPct: 0, severity: 'pass', fundingGap: 0 },
    },
  };
}
