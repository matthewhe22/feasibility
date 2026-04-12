import type {
  CostLineItem,
  SellingCostConfig,
  RevenueLineItem,
  RentalIncomeItem,
  EquityConfig,
  DebtFacility,
  LandPaymentStage,
  AcquisitionCostItem,
} from '../types';

// ===== LAND PAYMENT STAGES =====
export const defaultLandPaymentStages: LandPaymentStage[] = [
  { id: 'dep', description: 'Deposit In Trust Account', percentOfLand: 0.0242, amount: 3000010, lumpSum: 0, monthStart: 1, monthSpan: 1 },
  { id: 'p1', description: 'Payment 1', percentOfLand: 0.0242, amount: 3000000, lumpSum: 0, monthStart: 7, monthSpan: 1 },
  { id: 'p2', description: 'Payment 2', percentOfLand: 0.0516, amount: 6399990, lumpSum: 0, monthStart: 15, monthSpan: 1 },
  { id: 'p3', description: 'Payment 3', percentOfLand: 0, amount: 0, lumpSum: 0, monthStart: 0, monthSpan: 0 },
  { id: 'uplift', description: 'Land Uplift', percentOfLand: 0, amount: 0, lumpSum: 0, monthStart: 0, monthSpan: 0 },
  { id: 'settle', description: 'Settlement (Balance) (Financial Close)', percentOfLand: 0.9, amount: 111600000, lumpSum: 0, monthStart: 30, monthSpan: 1 },
];

export const defaultAcquisitionCosts: AcquisitionCostItem[] = [
  { id: 'sd', description: 'Stamp Duty', percentOfLand: 0, amount: 7110524.94, lumpSum: 0, monthStart: 30, monthSpan: 1, addGST: false },
  { id: 'reg', description: 'Registration Fees', percentOfLand: 0, amount: 1134468.81, lumpSum: 0, monthStart: 30, monthSpan: 1, addGST: false },
  { id: 'pexa', description: 'PEXA Fees', percentOfLand: 0, amount: 0, lumpSum: 0, monthStart: 30, monthSpan: 1, addGST: false },
];

// ===== DEVELOPMENT COSTS (80 line items) =====
function dc(code: string, desc: string, total: number, addGST = true): CostLineItem {
  return {
    code, description: desc, costType: 'Development Costs',
    units: 1, baseRate: total, totalCosts: total,
    sCurve: 'Manual S-curve 1', monthStart: 2, monthSpan: 72,
    addGST, ctd: 0, ctc: total,
  };
}

export const defaultDevelopmentCosts: CostLineItem[] = [
  dc('2001', 'Air Quality', 16700),
  dc('2002', 'AV / IT Consultant', 163163),
  dc('2003', 'Building Surveyor', 290200),
  dc('2004', 'Consultant inspection Reports', 810000),
  dc('2005', 'Council Fees **NO GST**', 750846),
  dc('2006', 'Cultural Heritage', 17130),
  dc('2007', 'Community Consultation Specialist', 38474),
  dc('2008', 'DDA Consultant', 158000),
  dc('2009', 'Display - Constructions', 0),
  dc('2010', 'Engineer - Fire & Other', 112000),
  dc('2011', 'Engineer - Facade', 424500),
  dc('2012', 'Engineering - Acoustic', 60183),
  dc('2013', 'Engineering - Wind', 86000),
  dc('2014', 'Engineering-Mech/Elecl/Hyd', 1266700),
  dc('2015', 'Engineering-Struc/ Civil', 2302980),
  dc('2016', 'Engineering-Geo', 547511),
  dc('2017', 'Environmental Works', 0),
  dc('2018', 'ESD Consultant', 330450),
  dc('2019', 'Ecological Consultant', 8950),
  dc('2020', 'Electrical Design Consultant', 253420),
  dc('2021', 'EMF Consultant', 67788),
  dc('2022', 'F&B Compliance Consultant', 0),
  dc('2023', 'Infrastructure Costs', 2928518),
  dc('2024', 'Hydrologist', 128500),
  dc('2025', 'Interior Design', 639013),
  dc('2026', 'Legal Advisory Services For Planning', 71062),
  dc('2027', 'Marina Consultant', 18382),
  dc('2028', 'NBN', 171446),
  dc('2029', 'Open Space Levy **NO GST**', 0),
  dc('2030', 'Plans - Architect Working', 7273874),
  dc('2031', 'Plans - Landscaping', 405987),
  dc('2032', 'Play Design', 0),
  dc('2033', 'Power Upgrade', 204519),
  dc('2034', 'Pool Consultant', 106000),
  dc('2035', 'Quantity Survey Fees/ Inspection', 386000),
  dc('2036', 'Signage & Wayfinding Consultant', 141750),
  dc('2037', 'Specialist Flood Modelling', 40000),
  dc('2038', 'Superintendent', 1454580),
  dc('2039', 'Spa Consultant', 0),
  dc('2040', 'Surveyor Land', 685359),
  dc('2041', 'Town Planning', 710490),
  dc('2042', 'Traffic Consultant', 158521),
  dc('2043', 'Waste Consultant', 18760),
  dc('2044', 'Vertical Transport Consultant', 171750),
  dc('2045', 'Arborist', 11565),
  dc('2046', 'Hotel Interiors', 2889730),
  dc('2047', 'Specialist Lighting', 122250),
  dc('2048', 'OC Management', 30500),
  dc('2049', 'Hotel Consultants', 1609652),
  dc('2050', 'QFES', 75000),
  dc('2051', 'Retail & F&B Advisory', 444121),
  dc('2052', 'Site Due Diligence', 224923),
  dc('2053', 'QLEAVE **NO GST**', 0),
  dc('2054', 'Project Management Software', 218531),
  dc('2055', 'Public Art Contribution', 0),
  dc('2056', 'Other Consultant & Project Costs', 40000),
  dc('2057', 'Construction/Development Legals', 695000),
  dc('2059', 'Accounting Fees', 45455),
  dc('2060', 'Bank Fees *** NO GST ***', 0),
  dc('2061', 'Property Shell', 0),
  dc('2062', 'Council rates *** NO GST ***', 1275567),
  dc('2063', 'Disbursements on Settlement', 205500),
  dc('2064', 'Other Bonus *** NO GST ***', 0),
  dc('2065', 'KPI *** NO GST ***', 0),
  dc('2066', 'Communal Furniture', 1090909),
  dc('2067', 'Land Tax *** NO GST ***', 0),
  dc('2068', 'Legal (on loan)', 727273),
  dc('2069', 'Legal (on settlement)', 739800),
  dc('2070', 'Legal Costs (on purchase)', 90909),
  dc('2071', 'New Company', 18182),
  dc('2072', 'OVERHEADS - ADMIN', 16000000),
  dc('2073', 'Property Insurance', 45455),
  dc('2074', 'Utility Usage - during project', 21818),
  dc('2075', 'Valuation Fees', 505104),
  dc('2076', 'Wet Lease Rent', 0),
];

// ===== CONSTRUCTION COSTS =====
export const defaultConstructionCosts: CostLineItem[] = [
  {
    code: '4001', description: 'Living', costType: 'Total Construction Costs',
    units: 92771, baseRate: 6314.53, totalCosts: 585805180,
    sCurve: '41 Month Build', monthStart: 33, monthSpan: 41,
    addGST: true, ctd: 0, ctc: 585805180,
  },
];

// ===== MARKETING =====
export const defaultMarketingCosts: CostLineItem[] = [
  {
    code: '3001', description: 'Marketing', costType: 'Marketing & Advertising',
    units: 1, baseRate: 6181818, totalCosts: 6181818,
    sCurve: 'Evenly Split', monthStart: 13, monthSpan: 61,
    addGST: true, ctd: 4243905, ctc: 1937913,
  },
];

// ===== OTHER STANDARD COSTS =====
export const defaultOtherStandardCosts: CostLineItem[] = [
  { code: '5001', description: 'Open Space Levy **NO GST**', costType: 'Other Standard Costs', units: 1, baseRate: 2345629, totalCosts: 2345629, sCurve: 'Evenly Split', monthStart: 33, monthSpan: 1, addGST: false, ctd: 0, ctc: 2345629 },
  { code: '5002', description: 'Bank Fees *** NO GST ***', costType: 'Other Standard Costs', units: 1, baseRate: 1000, totalCosts: 1000, sCurve: 'Manual S-curve 1', monthStart: 2, monthSpan: 72, addGST: false, ctd: 0, ctc: 1000 },
  { code: '5003', description: 'KPI *** NO GST ***', costType: 'Other Standard Costs', units: 1, baseRate: 1479100, totalCosts: 1479100, sCurve: 'Manual S-curve 1', monthStart: 2, monthSpan: 72, addGST: false, ctd: 0, ctc: 1479100 },
  { code: '5004', description: 'Land Tax *** NO GST ***', costType: 'Other Standard Costs', units: 1, baseRate: 4866443, totalCosts: 4866443, sCurve: 'Manual S-curve 1', monthStart: 2, monthSpan: 72, addGST: false, ctd: 0, ctc: 4866443 },
];

// ===== PM FEES =====
export const defaultPMFees: CostLineItem[] = [
  {
    code: '6001', description: 'Project Management Fees', costType: 'Development & Project Management Fees',
    units: 0.02, baseRate: 21327785, totalCosts: 23200301,
    sCurve: 'Evenly Split', monthStart: 22, monthSpan: 52,
    addGST: true, ctd: 9176909, ctc: 14023392,
  },
  {
    code: '6002', description: 'Coupon CTD', costType: 'Development & Project Management Fees',
    units: 1, baseRate: 0, totalCosts: 0,
    sCurve: 'Evenly Split', monthStart: 15, monthSpan: 60,
    addGST: true, ctd: 0, ctc: 0,
  },
];

// ===== SELLING COSTS CONFIG =====
export const defaultSellingCosts: SellingCostConfig[] = [
  { code: '7001', description: 'Tower 3 Ferry Building', salesCommission: 0.03864, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  { code: '7002', description: 'Tower 4 Store Houses', salesCommission: 0.03864, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  { code: '7003', description: 'Tower 5 Skyform SP1', salesCommission: 0.03864, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  { code: '7004', description: 'Tower 5 Skyform SP2 / Tower 2 Interloom SP1', salesCommission: 0.03864, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  { code: '7005', description: 'Tower 2 Interloom SP2', salesCommission: 0.03864, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  { code: '7006', description: 'Commercial (Retail)', salesCommission: 0.02727, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  { code: '7007', description: 'Commercial (F&B/Retail)', salesCommission: 0.02727, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  { code: '7008', description: 'Commercial (Office)', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  { code: '7009', description: 'T1 Commercial (F&B/Retail)', salesCommission: 0.02727, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  { code: '7010', description: 'Hotel', salesCommission: 0.02278, preCommissionPercent: 0, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
];

// ===== GRV (Revenue) =====
export const defaultGRVItems: RevenueLineItem[] = [
  { code: '9001', description: 'Tower 3 Ferry Building', revenueType: 'Residential', units: 1, totalArea: 1, currentSalePrice: 284827258, preSaleExchangeMonth: 32, preSaleSpan: 2, settlementMonth: 55, settlementSpan: 1, gstIncluded: true },
  { code: '9002', description: 'Tower 4 Store Houses', revenueType: 'Residential', units: 1, totalArea: 12719, currentSalePrice: 122139731, preSaleExchangeMonth: 32, preSaleSpan: 2, settlementMonth: 56, settlementSpan: 1, gstIncluded: true },
  { code: '9003', description: 'Tower 5 Skyform SP1', revenueType: 'Residential', units: 1, totalArea: 0, currentSalePrice: 45361949, preSaleExchangeMonth: 32, preSaleSpan: 2, settlementMonth: 61, settlementSpan: 1, gstIncluded: true },
  { code: '9004', description: 'Tower 5 Skyform SP2 / Tower 2 Interloom SP1', revenueType: 'Residential', units: 1, totalArea: 0, currentSalePrice: 249802066, preSaleExchangeMonth: 30, preSaleSpan: 3, settlementMonth: 63, settlementSpan: 1, gstIncluded: true },
  { code: '9005', description: 'Tower 2 Interloom SP2', revenueType: 'Residential', units: 1, totalArea: 0, currentSalePrice: 287444239, preSaleExchangeMonth: 30, preSaleSpan: 10, settlementMonth: 65, settlementSpan: 1, gstIncluded: true },
  { code: '9006', description: 'Commercial (Retail)', revenueType: 'Retail F&B', units: 1, totalArea: 0, currentSalePrice: 23139349, preSaleExchangeMonth: 18, preSaleSpan: 50, settlementMonth: 60, settlementSpan: 1, gstIncluded: false },
  { code: '9007', description: 'Commercial (F&B/Retail)', revenueType: 'Retail F&B', units: 1, totalArea: 0, currentSalePrice: 40346650, preSaleExchangeMonth: 18, preSaleSpan: 50, settlementMonth: 66, settlementSpan: 1, gstIncluded: false },
  { code: '9008', description: 'Commercial (Office)', revenueType: 'Commercial Office', units: 1, totalArea: 0, currentSalePrice: 12000000, preSaleExchangeMonth: 18, preSaleSpan: 50, settlementMonth: 66, settlementSpan: 1, gstIncluded: false },
  { code: '9009', description: 'T1 Commercial (F&B/Retail)', revenueType: 'Retail F&B', units: 1, totalArea: 0, currentSalePrice: 16172357, preSaleExchangeMonth: 74, preSaleSpan: 1, settlementMonth: 74, settlementSpan: 1, gstIncluded: false },
  { code: '9010', description: 'Hotel', revenueType: 'Hotel', units: 0, totalArea: 0, currentSalePrice: 171641716, preSaleExchangeMonth: 74, preSaleSpan: 1, settlementMonth: 74, settlementSpan: 1, gstIncluded: false },
  { code: '9012', description: 'Interest on Deposits', revenueType: 'Settlement Adjustments', units: 0, totalArea: 0, currentSalePrice: 8649869, preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 74, settlementSpan: 1, gstIncluded: false },
  { code: '9013', description: 'Management Rights', revenueType: 'Management Rights', units: 0, totalArea: 0, currentSalePrice: 340000, preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 65, settlementSpan: 1, gstIncluded: true },
];

// ===== RENTAL INCOME =====
export const defaultRentalIncome: RentalIncomeItem[] = [
  { code: '9101', description: '', revenueType: 'Gross Rental Income', units: 1, baseRate: 0, sCurve: 'Evenly Split', monthStart: 30, monthSpan: 12, addGST: false },
];

// ===== OTHER INCOME =====
export const defaultOtherIncome: RentalIncomeItem[] = [
  { code: '9201', description: 'other income', revenueType: 'Other Income', units: 1, baseRate: 0, sCurve: 'Evenly Split', monthStart: 40, monthSpan: 12, addGST: false },
];

// ===== EQUITY =====
export const defaultEquityKokoda: EquityConfig = {
  name: 'Developer',
  fixedAmount: 130419982,
  percentage: 0.1,
  interestRate: 0,
  interestCompound: 0,
  repayEquityBeforeDebt: 0,
  equityContribution: 1.0,
  profitShare: 1.0,
  drawdownPriority: 1, // equity drawn first (before debt)
};

export const defaultEquityJV: EquityConfig = {
  name: 'JV Partner',
  fixedAmount: 0,
  percentage: 0.1,
  interestRate: 0,
  interestCompound: 1,
  repayEquityBeforeDebt: 0,
  equityContribution: 0,
  profitShare: 0,
  drawdownPriority: 1,
};

export const defaultEquityPreferred: EquityConfig = {
  name: 'Preferred Equity',
  fixedAmount: 0,
  percentage: 0.1,
  interestRate: 0.13,
  interestCompound: 1,
  repayEquityBeforeDebt: 0,
  equityContribution: 0,
  profitShare: 0,
  drawdownPriority: 1,
};

export const defaultEquityAdditional: EquityConfig = {
  name: 'Additional Equity #1',
  fixedAmount: 0,
  percentage: 0.1,
  interestRate: 0.13,
  interestCompound: 1,
  repayEquityBeforeDebt: 0,
  equityContribution: 0,
  profitShare: 0,
  drawdownPriority: 1,
};

// ===== DEBT FACILITIES =====
export const defaultLandLoan: DebtFacility = {
  name: 'Land Loan Facility',
  facilityLimit: 120000000,
  startMonth: 30,
  maturityMonth: 3,
  interestRate: 0.11265,
  bbsy: 0,
  margin: 0.11265,
  establishmentFeePercent: 0.016167,
  lineFeePercent: 0,
  interestPaymentFrequency: 3,
  isCapitalised: false,
  ltcTarget: 0,
  lvrTarget: 0,
  drawdownPriority: 0, // land loan is a lump-sum at fixed date, not part of gap-fill sequence
};

export const defaultMezzanine: DebtFacility = {
  name: 'Mezzanine Finance',
  facilityLimit: 0,
  startMonth: 0,
  maturityMonth: 0,
  interestRate: 0.15,
  bbsy: 0,
  margin: 0.15,
  establishmentFeePercent: 0.015,
  lineFeePercent: 0,
  interestPaymentFrequency: 0,
  isCapitalised: true,
  ltcTarget: 0.1,
  lvrTarget: 0,
  drawdownPriority: 3, // mezz drawn third (after equity, before senior)
};

export const defaultSeniorFacility: DebtFacility = {
  name: 'Senior Construction Facility',
  facilityLimit: 767034632,
  startMonth: 33,
  maturityMonth: 33,
  interestRate: 0.0215,
  bbsy: 0.0196,
  margin: 0.0215,
  establishmentFeePercent: 0.005,
  lineFeePercent: 0.0215,
  interestPaymentFrequency: 0,
  isCapitalised: true,
  ltcTarget: 0.89,
  lvrTarget: 0.72,
  drawdownPriority: 4, // senior drawn last (after equity, land loan, mezz)
};

export const defaultResidualStock: DebtFacility = {
  name: 'Residual Stock Facility',
  facilityLimit: 0,
  startMonth: 0,
  maturityMonth: 0,
  interestRate: 0,
  bbsy: 0,
  margin: 0,
  establishmentFeePercent: 0,
  lineFeePercent: 0,
  interestPaymentFrequency: 0,
  isCapitalised: true,
  ltcTarget: 0.84,
  lvrTarget: 0.754,
  drawdownPriority: 4,
};

export const defaultAdditionalLoan: DebtFacility = {
  name: 'Additional Loan',
  facilityLimit: 0,
  startMonth: 0,
  maturityMonth: 0,
  interestRate: 0,
  bbsy: 0,
  margin: 0,
  establishmentFeePercent: 0,
  lineFeePercent: 0,
  interestPaymentFrequency: 0,
  isCapitalised: true,
  ltcTarget: 0,
  lvrTarget: 0,
  drawdownPriority: 5,
};

// ===== OTHER FINANCING COSTS =====
export const defaultOtherFinancingCosts: CostLineItem[] = [
  {
    code: '16001', description: 'Extension fee', costType: 'Other Financing Costs',
    units: 1, baseRate: 15687080, totalCosts: 15687080,
    sCurve: 'Evenly Split', monthStart: 16, monthSpan: 15,
    addGST: false, ctd: 0, ctc: 15687080,
  },
];
