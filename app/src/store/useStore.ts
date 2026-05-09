import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type {
  AdminConfig,
  MainInputs,
  DashboardData,
} from '../types';
import {
  defaultLandPaymentStages,
  defaultAcquisitionCosts,
  defaultDevelopmentCosts,
  defaultConstructionCosts,
  defaultMarketingCosts,
  defaultOtherStandardCosts,
  defaultPMFees,
  defaultSellingCosts,
  defaultGRVItems,
  defaultRentalIncome,
  defaultOtherIncome,
  defaultEquityDeveloper,
  defaultEquityJV,
  defaultEquityPreferred,
  defaultEquityAdditional,
  defaultLandLoan,
  defaultMezzanine,
  defaultSeniorFacility,
  defaultSeniorFacility2,
  defaultResidualStock,
  defaultOtherFinancingCosts,
  defaultMinEquityRequirement,
} from './defaults';
import { cloneStandardBuildSCurves } from '../engine/sCurves';

export type TabId = 'admin' | 'input' | 'timeDist' | 'actuals' | 'internalDash' | 'externalDash' | 'cashflow' | 'summary' | 'charts' | 'checks' | 'docs';

interface AppState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;

  admin: AdminConfig;
  setAdmin: (admin: Partial<AdminConfig>) => void;
  /** Replace admin wholesale (no merge). Use when loading a project record so that
   *  fields removed in the persisted payload are not silently retained from the
   *  prior session — see batch-1 fix for project-load state drift. */
  replaceAdmin: (admin: AdminConfig) => void;

  inputs: MainInputs;
  setInputs: (inputs: Partial<MainInputs>) => void;
  /** Replace inputs wholesale (no merge). Use when loading a project record so the
   *  prior project's fields cannot bleed through into the new project. */
  replaceInputs: (inputs: MainInputs) => void;
  updateInputField: <K extends keyof MainInputs>(key: K, value: MainInputs[K]) => void;

  dashboardData: DashboardData | null;
  setDashboardData: (data: DashboardData | null) => void;

  isCalculating: boolean;
  setIsCalculating: (v: boolean) => void;

  /** ID of the currently loaded/saved project (null if unsaved session). */
  currentProjectId: number | null;
  setCurrentProjectId: (id: number | null) => void;

  /** Global master list of project names. Hydrated from DB on startup; used as data validation when creating new projects. */
  projectList: string[];
  setProjectList: (list: string[]) => void;
}

const defaultAdmin: AdminConfig = {
  projectName: 'Project Demo',
  modelStartDate: 44927, // Jan 2023
  monthsPerPeriod: 1,
  lastActualsPeriod: 45900, // Sep 2025 (period 32)
  tolerance: 10,
  daysPerYear: 365,
  monthsPerYear: 12,
  currency: '$',
  sCurveOptions: [
    'Evenly Split',
    ...Array.from({ length: 49 }, (_, i) => `${i + 12} Month Build`),
    'Manual S-curve 1',
    'Manual S-curve 2',
    'Manual S-curve 3',
  ],
  manualSCurves: [[], [], []],
  buildSCurves: cloneStandardBuildSCurves(),
  itcRecoveryLagMonths: 0,
  applyGSTWithholding: false,
  contingencyGSTMode: 'full',
  // CR1 — default repayment sequence (legal priority). PR-D introduced this
  // field as configurable but didn't default it for fresh installs.
  repaymentSequence: ['senior', 'mezz', 'equity'],
};

const defaultInputs: MainInputs = {
  preliminary: {
    dateOfFirstPeriod: 45017, // Apr 2023
    cashFlowPeriod: 'Monthly',
    projectLots: 178,
    projectGFA: 32133,
    siteArea: 1650,
    projectStartMonth: 1,
    projectSpanMonths: 74,
    projectEndMonth: 74,
    equityDistStartMonth: 74,
    equityDistSpanMonths: 1,
  },
  landPurchase: {
    landPurchasePrice: 124000000,
    prsvUplift: 56000000,
    prsvMonth: 33,
    prsvSpan: 1,
    gstRate: 0.1,
    gstApplicableLand: true,
    addGSTOnLandPrice: false,
    stampDutyState: 'QLD',
    stampDutyAmount: 7110525,
    interestOnDeposit: 0,
    profitShareToLandOwner: 0,
    paymentStages: defaultLandPaymentStages,
    acquisitionCosts: defaultAcquisitionCosts,
  },
  developmentCosts: defaultDevelopmentCosts,
  constructionCosts: defaultConstructionCosts,
  constructionContingencyPercent: 0.024889,
  marketingCosts: defaultMarketingCosts,
  otherStandardCosts: defaultOtherStandardCosts,
  pmFees: defaultPMFees,
  sellingCosts: defaultSellingCosts,
  frontEndSellingCosts: [],
  backEndSellingCosts: [],
  lettingFees: [],
  grvItems: defaultGRVItems,
  rentalIncome: defaultRentalIncome,
  otherIncome: defaultOtherIncome,
  equityDeveloper: defaultEquityDeveloper,
  equityJV: defaultEquityJV,
  equityPreferred: defaultEquityPreferred,
  equityAdditional: defaultEquityAdditional,
  landLoan: defaultLandLoan,
  mezzanine: defaultMezzanine,
  seniorFacility: defaultSeniorFacility,
  seniorFacility2: defaultSeniorFacility2,
  residualStockFacility: defaultResidualStock,
  otherFinancingCosts: defaultOtherFinancingCosts,
  minEquityRequirement: defaultMinEquityRequirement,
};

/**
 * Debounced localStorage wrapper — coalesces rapid setItem calls (typing in input
 * fields) into a single write. Reads are pass-through. Reduces serialization
 * overhead for the ~50KB+ inputs object on every keystroke.
 */
function createDebouncedLocalStorage(delayMs: number): StateStorage {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    for (const [key, value] of pending) localStorage.setItem(key, value);
    pending.clear();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush);
  }
  return {
    getItem: (key) => {
      if (pending.has(key)) return pending.get(key) ?? null;
      return localStorage.getItem(key);
    },
    setItem: (key, value) => {
      pending.set(key, value);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    removeItem: (key) => {
      pending.delete(key);
      localStorage.removeItem(key);
    },
  };
}

/**
 * CR1 — Migrate persisted store state across schema versions.
 * Exported so it can be unit-tested directly with synthetic v3/v4 fixtures.
 *
 * Versions:
 *   v2 — removed seniorFacility3 + additionalLoan1/2/3 from MainInputs.
 *   v3 — PM fee rate moved from `pmFees[0].units` (overloaded with the generic
 *        Units column) to dedicated `pmFees[0].feeRatePercent`.
 *   v4 — removed `dscrTarget` from AdminConfig (DSCR removed wholesale).
 *   v5 — default `admin.repaymentSequence = ['senior', 'mezz', 'equity']`
 *        when missing/undefined. PR-D added the field as configurable but
 *        without a migration step — v4 users hit the engine with undefined
 *        and the funding solver branches on this value.
 *   v6 — extended `admin.equityDrawdownMode` union with `'senior-first'` so
 *        debt absorbs the cost gap before equity once construction starts.
 *        Additive: missing/invalid values default to `'equity-first'` to
 *        preserve historical behaviour for v5 fixtures without explicit mode.
 *   v7 — renamed `equityDeveloper.fixedAmount` (and the same field on
 *        equityJV / equityPreferred / equityAdditional) to `equityCap` for
 *        schema clarity. The field is the cumulative equity cap the funding
 *        solver respects. Migration copies the old value across and deletes
 *        the old key.
 *   v8 — added `inputs.minEquityRequirement` term-sheet equity-floor
 *        cross-check. Additive: missing field is backfilled with
 *        `{ mode: 'percent', value: 0, basis: 'tdc-incl-finance-costs' }`
 *        which DISABLES the check (value=0). All v7 fixtures and saved
 *        projects therefore pass through with no behavioural change.
 *   v9 — Kew-UAT Bug 3: heal `minEquityRequirement.value > 1` when
 *        mode='percent' by dividing by 100 (legacy users typed `10`
 *        intending 10%; engine read it as 10× = 1000%). Idempotent on
 *        already-fractional values.
 *  v10 — Kew UAT v3 K (Land Loan interest payment frequency feature):
 *        backfill `interestPaymentFrequency: 1` (monthly) on every facility
 *        that lacks a finite positive value. Additive + idempotent — a
 *        facility already carrying a valid frequency is untouched.
 *  v11 — Dandenong B5 (gstRate persistence edge-case): heal
 *        `inputs.landPurchase.gstRate` when it is missing, null, non-finite,
 *        negative, or ≥ 1. Pre-v11 saved Supabase projects could land in the
 *        store with the field literally absent (older schema shapes) — the
 *        UI's PercentInput then rendered 0% via `(value ?? 0) * 100` while
 *        the engine silently clamped to 0.10 (Australian default), creating
 *        a confusing UI/engine mismatch the user could only resolve by
 *        manually re-typing the rate. v11 backfills the field to 0.10
 *        whenever it is not a finite value in [0, 1). Idempotent on a valid
 *        finite value in [0, 1) — pass-through. CONSERVATIVE: explicit 0
 *        IS preserved (legitimate non-Australian projects); only invalid
 *        shapes are healed.
 *
 * The function is idempotent on each version: running v11 migration on
 * already-migrated v11 data produces no change (the existence checks
 * short-circuit).
 */
export function migratePersistedState(persisted: unknown, version: number): unknown {
  const p = persisted as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return p;
  if (version < 2 && p.inputs && typeof p.inputs === 'object') {
    const inputs = p.inputs as Record<string, unknown>;
    delete inputs.seniorFacility3;
    delete inputs.additionalLoan1;
    delete inputs.additionalLoan2;
    delete inputs.additionalLoan3;
  }
  if (version < 4 && p.admin && typeof p.admin === 'object') {
    delete (p.admin as Record<string, unknown>).dscrTarget;
  }
  if (version < 3 && p.inputs && typeof p.inputs === 'object') {
    // Migrate legacy PM-fee rate. Adopt legacy `units` as the rate only when
    // it looks like a rate (strictly between 0 and 1). Anything outside that
    // range is most likely a quantity / dollar amount the user typed when the
    // engine silently treated it as 100%/10000%/etc — default to 0.02 (2%)
    // and rely on the runtime warning to nudge the user.
    const inputs = p.inputs as { pmFees?: Array<Record<string, unknown>> };
    if (Array.isArray(inputs.pmFees) && inputs.pmFees.length > 0) {
      const first = inputs.pmFees[0];
      if (first && typeof first === 'object' && first['feeRatePercent'] === undefined) {
        const legacyUnits = first['units'];
        if (typeof legacyUnits === 'number' && legacyUnits > 0 && legacyUnits < 1) {
          first['feeRatePercent'] = legacyUnits;
        } else {
          first['feeRatePercent'] = 0.02;
        }
      }
    }
  }
  // v5 — default repaymentSequence if missing. Idempotent on v5 data
  // (only writes when the field is genuinely missing/null/non-array).
  if (version < 5 && p.admin && typeof p.admin === 'object') {
    const admin = p.admin as Record<string, unknown>;
    const existing = admin.repaymentSequence;
    if (!Array.isArray(existing) || existing.length === 0) {
      admin.repaymentSequence = ['senior', 'mezz', 'equity'];
    }
  }
  // v6 — extend equityDrawdownMode union with 'senior-first'. Additive only:
  // existing projects keep their persisted mode if set; missing/null defaults
  // to 'equity-first' (current behaviour). Idempotent on v6 — only writes when
  // the field is missing AND we want a deterministic default. v5 projects with
  // an explicit 'equity-first' or 'pro-rata' value pass through unchanged.
  if (version < 6 && p.admin && typeof p.admin === 'object') {
    const admin = p.admin as Record<string, unknown>;
    const existing = admin.equityDrawdownMode;
    const allowed = new Set(['equity-first', 'pro-rata', 'senior-first']);
    if (typeof existing !== 'string' || !allowed.has(existing as string)) {
      admin.equityDrawdownMode = 'equity-first';
    }
  }
  // v7 — rename `equityDeveloper.fixedAmount` (and friends) to `equityCap` for
  // schema clarity. The field is the cumulative equity cap the funding solver
  // respects. Migration is non-destructive: copies any old `fixedAmount` value
  // into the new `equityCap` field (preserving the cap), then deletes the old
  // key. If both keys are present (theoretical race on a partly-migrated state),
  // `equityCap` wins. Idempotent on v7 — a state with no `fixedAmount` key is
  // a no-op.
  if (version < 7 && p.inputs && typeof p.inputs === 'object') {
    const inputs = p.inputs as Record<string, unknown>;
    const equityKeys = ['equityDeveloper', 'equityJV', 'equityPreferred', 'equityAdditional'];
    for (const key of equityKeys) {
      const ent = inputs[key];
      if (ent && typeof ent === 'object') {
        const e = ent as Record<string, unknown>;
        if (typeof e.equityCap !== 'number' && typeof e.fixedAmount === 'number') {
          e.equityCap = e.fixedAmount;
        }
        // Drop the old key in either case (idempotent — undefined delete OK).
        delete e.fixedAmount;
      }
    }
  }
  // v8 — backfill `inputs.minEquityRequirement` with the disabled default
  // (`value: 0` => no check). Additive only: a well-formed object is preserved
  // as-is; a partially-shaped object has missing/invalid keys filled in.
  // Idempotent on v8 — a fully-shaped object short-circuits with no writes.
  if (version < 8 && p.inputs && typeof p.inputs === 'object') {
    const inputs = p.inputs as Record<string, unknown>;
    const cur = inputs.minEquityRequirement;
    const isObj = (x: unknown): x is Record<string, unknown> =>
      typeof x === 'object' && x !== null && !Array.isArray(x);
    if (!isObj(cur)) {
      inputs.minEquityRequirement = {
        mode: 'percent',
        value: 0,
        basis: 'tdc-incl-finance-costs',
      };
    } else {
      const allowedMode = new Set(['percent', 'amount']);
      const allowedBasis = new Set(['tdc', 'tdc-incl-finance-costs']);
      if (typeof cur.mode !== 'string' || !allowedMode.has(cur.mode as string)) cur.mode = 'percent';
      if (typeof cur.value !== 'number' || !Number.isFinite(cur.value)) cur.value = 0;
      if (typeof cur.basis !== 'string' || !allowedBasis.has(cur.basis as string)) cur.basis = 'tdc-incl-finance-costs';
    }
  }
  // v9 — Bug 3 (Kew UAT): standardise `minEquityRequirement.value` semantic to
  // a fraction in [0, 1] when mode='percent'. Pre-v9 the engine multiplied the
  // raw value by basisAmount, so a user entering `10` (intending 10%) was
  // treated as 1000% × TDC ≈ $1.74B required equity. v9 heals legacy stored
  // values > 1 by dividing by 100 (10 → 0.10).
  //
  // CONSERVATIVE: only divides when (a) mode === 'percent' AND (b) value > 1.
  // Values in [0, 1] are left alone (already fraction-shaped). Amounts (mode
  // === 'amount') are dollar amounts, never touched. Idempotent on v9 — a
  // value already in [0, 1] in percent mode short-circuits.
  if (version < 9 && p.inputs && typeof p.inputs === 'object') {
    const inputs = p.inputs as Record<string, unknown>;
    const cur = inputs.minEquityRequirement as Record<string, unknown> | undefined;
    if (cur && typeof cur === 'object' && cur.mode === 'percent' &&
        typeof cur.value === 'number' && Number.isFinite(cur.value) && cur.value > 1) {
      cur.value = cur.value / 100;
    }
  }
  // v10 — Land Loan interest payment frequency. Existing land-loan (and other
  // facility) configs are backfilled with `interestPaymentFrequency: 1`
  // (monthly cash-pay, or monthly compound under capitalised mode) so all v9
  // fixtures and saved projects preserve their current behaviour. Additive +
  // idempotent — a facility that already has a finite, positive frequency is
  // left alone.
  if (version < 10 && p.inputs && typeof p.inputs === 'object') {
    const inputs = p.inputs as Record<string, unknown>;
    const facKeys = ['landLoan', 'seniorFacility', 'seniorFacility2', 'mezzanine', 'residualStockFacility'];
    for (const key of facKeys) {
      const fac = inputs[key];
      if (fac && typeof fac === 'object') {
        const f = fac as Record<string, unknown>;
        const cur = f.interestPaymentFrequency;
        if (typeof cur !== 'number' || !Number.isFinite(cur) || cur <= 0) {
          f.interestPaymentFrequency = 1;
        }
      }
    }
  }
  // v11 — Dandenong B5 (gstRate persistence). Heal `landPurchase.gstRate`
  // when the field is missing / null / non-finite / out of [0, 1). The UI's
  // PercentInput uses `(value ?? 0) * 100` so a missing value renders as 0%,
  // while the engine independently clamps to 0.10 — projects loaded from
  // Supabase with this shape silently disagreed between display and engine.
  // Backfilling at migration time fixes both surfaces in one place.
  // CONSERVATIVE: an explicit, valid 0 is preserved (legitimate non-Australian
  // GST regimes still possible). Idempotent on already-valid values.
  if (version < 11 && p.inputs && typeof p.inputs === 'object') {
    const inputs = p.inputs as Record<string, unknown>;
    const lp = inputs.landPurchase;
    if (lp && typeof lp === 'object') {
      const landPurchase = lp as Record<string, unknown>;
      const cur = landPurchase.gstRate;
      if (typeof cur !== 'number' || !Number.isFinite(cur) || cur < 0 || cur >= 1) {
        landPurchase.gstRate = 0.10;
      }
    }
  }
  return p;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      activeTab: 'input',
      setActiveTab: (tab) => set({ activeTab: tab }),

      admin: defaultAdmin,
      setAdmin: (admin) => set((s) => ({ admin: { ...s.admin, ...admin } })),
      replaceAdmin: (admin) => set({ admin }),

      inputs: defaultInputs,
      setInputs: (inputs) => set((s) => ({ inputs: { ...s.inputs, ...inputs } })),
      replaceInputs: (inputs) => set({ inputs }),
      updateInputField: (key, value) => set((s) => ({ inputs: { ...s.inputs, [key]: value } })),

      // dashboardData is NOT persisted (excluded via partialize below) —
      // it is always recomputed by runCalculations() on load.
      dashboardData: null,
      setDashboardData: (data) => set({ dashboardData: data }),

      isCalculating: false,
      setIsCalculating: (v) => set({ isCalculating: v }),

      currentProjectId: null,
      setCurrentProjectId: (id) => set({ currentProjectId: id }),

      // projectList is rehydrated from the DB on startup (App.tsx) — no need
      // to persist it in localStorage.
      projectList: [],
      setProjectList: (list) => set({ projectList: list }),
    }),
    {
      name: 'feasibility-store',
      // v2 = removed seniorFacility3 + additionalLoan1/2/3 from MainInputs.
      // v3 = PM fee rate moved from `pmFees[0].units` (overloaded with the
      //      generic Units column) to a dedicated `pmFees[0].feeRatePercent`
      //      field. See engine/index.ts and the v2-UAT P0 PM-Fee bug.
      // v4 = removed `dscrTarget` from AdminConfig — DSCR removed wholesale.
      // v5 = CR1 — default `admin.repaymentSequence = ['senior', 'mezz', 'equity']`
      //      when missing/undefined. PR-D (PR #31) added it as a configurable
      //      field but no migration step — v4 users hit the engine with
      //      undefined and the funding solver branches on this value.
      version: 11,
      migrate: migratePersistedState,
      // Debounce localStorage writes to coalesce rapid keystrokes into a single
      // serialization+write. 250 ms is imperceptible to users but eliminates
      // dozens of redundant writes per second when typing into input fields.
      storage: createJSONStorage(() => createDebouncedLocalStorage(250)),
      // Exclude transient runtime state from localStorage
      partialize: (state) => ({
        activeTab: state.activeTab,
        admin: state.admin,
        inputs: state.inputs,
        currentProjectId: state.currentProjectId,
        // dashboardData and isCalculating are intentionally excluded
      }),
      // Deep-merge persisted inputs/admin with current defaults so that newly
      // added fields (e.g. equityJV, equityPreferred) are never undefined when
      // loading an older persisted state. Drop legacy facility keys defensively
      // (in case migrate is bypassed by a stale schema version on disk).
      merge: (persisted, current) => {
        const p = persisted as Partial<AppState>;
        const legacyInputKeys = ['seniorFacility3', 'additionalLoan1', 'additionalLoan2', 'additionalLoan3'];
        const cleanInputs = { ...(p.inputs ?? {}) } as Record<string, unknown>;
        for (const k of legacyInputKeys) delete cleanInputs[k];
        // v4: drop legacy `dscrTarget` from admin.
        const cleanAdmin = { ...(p.admin ?? {}) } as Record<string, unknown>;
        delete cleanAdmin.dscrTarget;
        return {
          ...current,
          ...p,
          admin: { ...current.admin, ...cleanAdmin } as typeof current.admin,
          inputs: { ...current.inputs, ...cleanInputs } as typeof current.inputs,
        };
      },
    },
  ),
);
