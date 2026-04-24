import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  defaultSeniorFacility3,
  defaultResidualStock,
  defaultAdditionalLoan,
  defaultOtherFinancingCosts,
} from './defaults';

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
  buildSCurves: {},
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
  seniorFacility3: defaultSeniorFacility3,
  residualStockFacility: defaultResidualStock,
  additionalLoan1: { ...defaultAdditionalLoan, name: 'Additional Loan #1' },
  additionalLoan2: { ...defaultAdditionalLoan, name: 'Additional Loan #2' },
  additionalLoan3: { ...defaultAdditionalLoan, name: 'Additional Loan #3' },
  otherFinancingCosts: defaultOtherFinancingCosts,
};

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
    }),
    {
      name: 'feasibility-store',
      version: 1,
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
      // loading an older persisted state.
      merge: (persisted, current) => {
        const p = persisted as Partial<AppState>;
        return {
          ...current,
          ...p,
          admin: { ...current.admin, ...(p.admin ?? {}) },
          inputs: { ...current.inputs, ...(p.inputs ?? {}) },
        };
      },
    },
  ),
);
