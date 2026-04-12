import { create } from 'zustand';
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
  defaultEquityKokoda,
  defaultEquityJV,
  defaultEquityPreferred,
  defaultEquityAdditional,
  defaultLandLoan,
  defaultMezzanine,
  defaultSeniorFacility,
  defaultResidualStock,
  defaultAdditionalLoan,
  defaultOtherFinancingCosts,
} from './defaults';

export type TabId = 'admin' | 'input' | 'timeDist' | 'actuals' | 'internalDash' | 'externalDash' | 'cashflow' | 'summary' | 'charts';

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
}

export const useStore = create<AppState>((set) => ({
  activeTab: 'input',
  setActiveTab: (tab) => set({ activeTab: tab }),

  admin: {
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
  },
  setAdmin: (admin) => set((s) => ({ admin: { ...s.admin, ...admin } })),

  inputs: {
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
    equityKokoda: defaultEquityKokoda,
    equityJV: defaultEquityJV,
    equityPreferred: defaultEquityPreferred,
    equityAdditional: defaultEquityAdditional,
    landLoan: defaultLandLoan,
    mezzanine: defaultMezzanine,
    seniorFacility: defaultSeniorFacility,
    residualStockFacility: defaultResidualStock,
    additionalLoan1: { ...defaultAdditionalLoan, name: 'Additional Loan #1' },
    additionalLoan2: { ...defaultAdditionalLoan, name: 'Additional Loan #2' },
    additionalLoan3: { ...defaultAdditionalLoan, name: 'Additional Loan #3' },
    otherFinancingCosts: defaultOtherFinancingCosts,
  },
  setInputs: (inputs) => set((s) => ({ inputs: { ...s.inputs, ...inputs } })),
  updateInputField: (key, value) => set((s) => ({ inputs: { ...s.inputs, [key]: value } })),

  dashboardData: null,
  setDashboardData: (data) => set({ dashboardData: data }),

  isCalculating: false,
  setIsCalculating: (v) => set({ isCalculating: v }),
}));
