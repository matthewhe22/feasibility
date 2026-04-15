// ===== TIMELINE =====
export interface TimelineConfig {
  modelStartDate: number; // Excel serial date
  monthsPerPeriod: number;
  lastActualsPeriod: number; // Excel serial date
  totalPeriods: number;
}

export interface Period {
  index: number; // 0-based
  periodNumber: number; // 1-based
  startDate: Date;
  endDate: Date;
  daysInPeriod: number;
  isActual: boolean;
  isForecast: boolean;
  label: string; // e.g. "Jan-25"
}

// ===== COST ITEMS =====
export type CostType =
  | 'Land Purchase, PRSV & Acquisition Costs'
  | 'Development Costs'
  | 'Total Construction Costs'
  | 'Marketing & Advertising'
  | 'Other Standard Costs'
  | 'Development & Project Management Fees'
  | 'Selling & Leasing Costs'
  | 'Other Financing Costs'
  | 'Letting Fees & Incentives';

export type SCurveType =
  | 'Evenly Split'
  | 'Manual S-curve 1'
  | 'Manual S-curve 2'
  | 'Manual S-curve 3'
  | string; // e.g. "41 Month Build"

export interface LandPaymentStage {
  id: string;
  description: string;
  percentOfLand: number;
  amount: number;
  lumpSum: number;
  monthStart: number;
  monthSpan: number;
}

export interface AcquisitionCostItem {
  id: string;
  description: string;
  percentOfLand: number;
  amount: number;
  lumpSum: number;
  monthStart: number;
  monthSpan: number;
  addGST: boolean;
}

export interface CostLineItem {
  code: string;
  description: string;
  costType: CostType;
  units: number;
  baseRate: number;
  totalCosts: number;
  sCurve: SCurveType;
  monthStart: number;
  monthSpan: number;
  addGST: boolean;
  ctd: number;
  ctc: number;
  actuals?: number[]; // per-period actual spend (0-based period index); overrides forecast for actual periods
}

export interface ConstructionCostItem extends CostLineItem {
  contingencyPercent?: number;
}

export interface SellingCostConfig {
  code: string;
  description: string;
  salesCommission: number;
  preCommissionPercent: number;
  depositPercent: number;
  sCurve: SCurveType;
  addGST: boolean;
}

// ===== REVENUE =====
export type RevenueType =
  | 'Residential'
  | 'Retail F&B'
  | 'Commercial Office'
  | 'Hotel'
  | 'Management Rights'
  | 'Settlement Adjustments'
  | 'Gross Rental Income'
  | 'Other Income'
  | '-';

export interface RevenueLineItem {
  code: string;
  description: string;
  revenueType: RevenueType;
  units: number;
  totalArea: number;
  currentSalePrice: number;
  preSaleExchangeMonth: number;
  preSaleSpan: number;
  settlementMonth: number;
  settlementSpan: number;
  gstIncluded: boolean;
}

export interface RentalIncomeItem {
  code: string;
  description: string;
  revenueType: string;
  units: number;
  baseRate: number;
  sCurve: SCurveType;
  monthStart: number;
  monthSpan: number;
  addGST: boolean;
}

// ===== FINANCING =====
export interface EquityConfig {
  name: string;
  fixedAmount: number;
  percentage: number;
  interestRate: number;
  interestCompound: number; // 1=compound, 0=simple
  repayEquityBeforeDebt: number;
  equityContribution: number;
  profitShare: number;
  drawdownPriority: number; // 1 = drawn first, higher = drawn later; equity default 3
}

export interface DebtFacility {
  name: string;
  facilityLimit: number;
  startMonth: number;
  maturityMonth: number;
  interestRate: number;
  bbsy: number;
  margin: number;
  establishmentFeePercent: number;
  lineFeePercent: number;
  interestPaymentFrequency: number; // months
  isCapitalised: boolean;
  ltcTarget: number;
  lvrTarget: number;
  drawdownPriority: number; // 1 = drawn first, higher = drawn later; senior default 1, mezz default 2
}

// ===== ADMIN =====
export interface AdminConfig {
  projectName: string;
  modelStartDate: number;
  monthsPerPeriod: number;
  lastActualsPeriod: number;
  tolerance: number;
  daysPerYear: number;
  monthsPerYear: number;
  currency: string;
  sCurveOptions: string[];
  manualSCurves: number[][]; // 3 manual s-curves, each array of monthly %
  buildSCurves: Record<number, number[]>; // keyed by build duration (12–60), monthly weights
}

// ===== MAIN INPUTS =====
export interface ProjectPreliminary {
  dateOfFirstPeriod: number;
  cashFlowPeriod: string;
  projectLots: number;
  projectGFA: number;
  siteArea: number;
  projectStartMonth: number;
  projectSpanMonths: number;
  projectEndMonth: number;
  equityDistStartMonth: number;
  equityDistSpanMonths: number;
}

export interface LandPurchaseInputs {
  landPurchasePrice: number;
  prsvUplift: number;
  prsvMonth: number;
  prsvSpan: number;
  gstRate: number;
  gstApplicableLand: boolean;
  addGSTOnLandPrice: boolean;
  stampDutyState: string;
  stampDutyAmount: number;
  interestOnDeposit: number;
  profitShareToLandOwner: number;
  paymentStages: LandPaymentStage[];
  acquisitionCosts: AcquisitionCostItem[];
}

export interface MainInputs {
  preliminary: ProjectPreliminary;
  landPurchase: LandPurchaseInputs;
  developmentCosts: CostLineItem[];
  constructionCosts: CostLineItem[];
  constructionContingencyPercent: number;
  marketingCosts: CostLineItem[];
  otherStandardCosts: CostLineItem[];
  pmFees: CostLineItem[];
  sellingCosts: SellingCostConfig[];
  frontEndSellingCosts: CostLineItem[];
  backEndSellingCosts: CostLineItem[];
  lettingFees: CostLineItem[];
  grvItems: RevenueLineItem[];
  rentalIncome: RentalIncomeItem[];
  otherIncome: RentalIncomeItem[];
  equityKokoda: EquityConfig;
  equityJV: EquityConfig;
  equityPreferred: EquityConfig;
  equityAdditional: EquityConfig;
  landLoan: DebtFacility;
  mezzanine: DebtFacility;
  seniorFacility: DebtFacility;
  residualStockFacility: DebtFacility;
  additionalLoan1: DebtFacility;
  additionalLoan2: DebtFacility;
  additionalLoan3: DebtFacility;
  otherFinancingCosts: CostLineItem[];
}

// ===== CALCULATION RESULTS =====
export interface MonthlyCashflow {
  period: Period;
  // Costs
  landCosts: number;
  acquisitionCosts: number;
  developmentCosts: number;
  constructionCosts: number;
  contingency: number;
  marketingCosts: number;
  otherStandardCosts: number;
  pmFees: number;
  sellingCostsFrontEnd: number;
  sellingCostsBackEnd: number;
  lettingFees: number;
  otherFinancingCosts: number;
  gstOnCosts: number;
  // Revenue
  grvSettlements: number;
  grvDeposits: number;
  rentalIncome: number;
  otherIncome: number;
  gstOnRevenue: number;
  // Funding
  landLoanDrawdown: number;
  landLoanRepayment: number;
  landLoanInterest: number;
  landLoanFees: number;
  seniorDrawdown: number;
  seniorRepayment: number;
  seniorInterest: number;
  seniorFees: number;
  mezzDrawdown: number;
  mezzRepayment: number;
  mezzInterest: number;
  mezzFees: number;
  equityInjection: number;
  equityRepatriation: number;
  profitDistribution: number;
  // Balances
  landLoanBalance: number;
  seniorBalance: number;
  mezzBalance: number;
  equityBalance: number;
  netCashflow: number;
  cumulativeCashflow: number;
}

// ===== DASHBOARD =====
export interface FeasibilitySummary {
  totalGRV: number;
  land: number;
  stampDuty: number;
  buildCosts: number;
  contingency: number;
  seniorFinanceCosts: number;
  mezzFinanceCosts: number;
  otherFinancingCosts: number;
  standardCosts: number;
  /** GST paid to vendors on costs (input tax credits claimable via BAS) */
  gst: number;
  /** GST embedded in sale prices and remitted to ATO */
  gstOnRevenue: number;
  /** Net GST payable to ATO = gstOnRevenue - gst */
  gstNet: number;
  marketingAndAdvertising: number;
  salesCommissions: number;
  pmFee: number;
  totalCost: number;
  totalProfit: number;
  loanCouponInterest: number;
  totalProfitAfterCoupon: number;
}

export interface KPIs {
  totalCashOnCash: number;
  annualCashOnCash: number;
  roi: number;
  irr: number;
}

export interface CapitalStack {
  seniorAmount: number;
  seniorLTC: number;
  seniorLVR: number;
  mezzAmount: number;
  mezzLTC: number;
  mezzLVR: number;
  equityAmount: number;
  equityLTC: number;
  equityLVR: number;
  total: number;
}

export interface DebtSummary {
  seniorPrincipal: number;
  seniorInterest: number;
  seniorTotal: number;
  mezzPrincipal: number;
  mezzInterest: number;
  mezzTotal: number;
  totalPrincipal: number;
  totalInterest: number;
  totalDebt: number;
}

export interface DebtRates {
  seniorEstablishment: number;
  seniorLineFee: number;
  seniorMargin: number;
  seniorBBSY: number;
  seniorAllIn: number;
  mezzEstablishment: number;
  mezzLineFee: number;
  mezzMargin: number;
  mezzBBSY: number;
  mezzAllIn: number;
  landEstablishment: number;
  landLineFee: number;
  landMargin: number;
  landBBSY: number;
  landAllIn: number;
}

export interface KeyDates {
  contractStartDate: string;
  establishJV: string;
  salesCommencement: string;
  landSettlement: string;
  constructionStart: string;
  constructionCompletion: string;
  salesSettlementCompleted: string;
  projectDurationMonths: number;
  constructionTimeMonths: number;
  planningDesignMonths: number;
  landToSettlementMonths: number;
}

export interface EquityReturnSummary {
  entity: string;
  fundingContribPercent: number;
  totalEquityContributed: number;
  irr: number;
  equityRepatriation1st: number;
  equityRepatriation2nd: number;
  totalEquityRepatriation: number;
  establishmentFee: number;
  couponInterest: number;
  couponInterestPercent: number;
  profitShareBalance: number;
  profitSharePercent: number;
  totalProfitShare: number;
}

export interface DashboardData {
  feasibility: FeasibilitySummary;
  kpis: KPIs;
  capitalStack: CapitalStack;
  debtSummary: DebtSummary;
  debtRates: DebtRates;
  keyDates: KeyDates;
  equityReturns: {
    total: EquityReturnSummary;
    jvPartner: EquityReturnSummary;
    developer: EquityReturnSummary;
  };
  otherIndicators: {
    peakInterestHoldingCostPerMonth: number;
  };
  grvSummary: {
    totalApartmentGRV: number;
    grvSoldExchanged: number;
    unsoldGRV: number;
  };
  cashflows: MonthlyCashflow[];
  warnings: string[]; // S-curve and other calculation warnings
}
