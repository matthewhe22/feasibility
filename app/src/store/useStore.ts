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
} from './defaults';
import { cloneStandardBuildSCurves } from '../engine/sCurves';

export type TabId = 'admin' | 'input' | 'timeDist' | 'actuals' | 'internalDash' | 'externalDash' | 'cashflow' | 'summary' | 'charts' | 'checks' | 'docs';

interface AppState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;

  admin: AdminConfig;
  setAdmin: (admin: Partial<AdminConfig>) => void;

  inputs: MainInputs;
  setInputs: (inputs: Partial<MainInputs>) => void;
  updateInputField: <K extends keyof MainInputs>(key: K, value: MainInputs[K]) => void;

  dashboardData: DashboardData | null;
  setDashboardData: (data: DashboardData) => void;

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
  dscrTarget: 1.25,
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

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      activeTab: 'input',
      setActiveTab: (tab) => set({ activeTab: tab }),

      admin: defaultAdmin,
      setAdmin: (admin) => set((s) => ({ admin: { ...s.admin, ...admin } })),

      inputs: defaultInputs,
      setInputs: (inputs) => set((s) => ({ inputs: { ...s.inputs, ...inputs } })),
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
      // The migrate fn drops those keys if they exist in the persisted payload.
      version: 2,
      migrate: (persisted, version) => {
        const p = persisted as Record<string, unknown> | null;
        if (!p || typeof p !== 'object') return p;
        if (version < 2 && p.inputs && typeof p.inputs === 'object') {
          const inputs = p.inputs as Record<string, unknown>;
          delete inputs.seniorFacility3;
          delete inputs.additionalLoan1;
          delete inputs.additionalLoan2;
          delete inputs.additionalLoan3;
        }
        return p;
      },
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
        const legacyKeys = ['seniorFacility3', 'additionalLoan1', 'additionalLoan2', 'additionalLoan3'];
        const cleanInputs = { ...(p.inputs ?? {}) } as Record<string, unknown>;
        for (const k of legacyKeys) delete cleanInputs[k];
        return {
          ...current,
          ...p,
          admin: { ...current.admin, ...(p.admin ?? {}) },
          inputs: { ...current.inputs, ...cleanInputs } as typeof current.inputs,
        };
      },
    },
  ),
);
