/**
 * Stamp duty calculator by Australian state/territory.
 * Rates as at 2024–25 for commercial/non-residential land acquisitions.
 * All amounts in AUD.
 */

export type StampDutyState = 'QLD' | 'NSW' | 'VIC' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT';

export const STAMP_DUTY_STATES: StampDutyState[] = [
  'QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'ACT', 'NT',
];

/**
 * Concession/surcharge adjustments applied on top of the base transfer duty rate.
 *  - 'none':               Standard transfer duty
 *  - 'home-concession':    50% concession (QLD Duties Act 2001 s.87; similar in other states)
 *  - 'first-home':         First Home Owner Grant exemption (typically full exemption if eligible)
 *  - 'foreign-surcharge':  Additional foreign acquirer surcharge (approx 7-8% extra)
 */
export type StampDutyConcession = 'none' | 'home-concession' | 'first-home' | 'foreign-surcharge';

/** Foreign acquirer surcharge rates by state (approx 2024-25; verify with revenue office) */
const FOREIGN_SURCHARGE: Record<StampDutyState, number> = {
  QLD: 0.08, NSW: 0.08, VIC: 0.08, SA: 0.07, WA: 0.07, TAS: 0.08, ACT: 0.04, NT: 0.00,
};

/**
 * Calculate transfer duty (stamp duty) for a land/property acquisition.
 * Applies standard scale for non-residential/commercial property plus any
 * concession or foreign surcharge.
 *
 * @param landPrice   Purchase price in AUD (excl. GST)
 * @param state       Australian state or territory
 * @param concession  Optional concession/surcharge adjustment (default 'none')
 * @returns           Stamp duty amount in AUD
 */
export function calculateStampDuty(
  landPrice: number,
  state: StampDutyState,
  concession: StampDutyConcession = 'none',
): number {
  const base = calculateStampDutyBase(landPrice, state);
  if (base <= 0) return 0;
  switch (concession) {
    case 'home-concession': return base * 0.5;
    case 'first-home':      return 0;
    case 'foreign-surcharge': return base + landPrice * (FOREIGN_SURCHARGE[state] ?? 0);
    case 'none':
    default:                return base;
  }
}

function calculateStampDutyBase(landPrice: number, state: StampDutyState): number {
  if (landPrice <= 0) return 0;

  switch (state) {
    case 'QLD': {
      // Queensland transfer duty (general rate, non-concession)
      // $0–$5,000:       nil
      // $5,001–$75,000:  $1.50 per $100 over $5,000
      // $75,001–$540,000:$1,050 + $3.50 per $100 over $75,000
      // $540,001–$1,000,000: $17,325 + $4.50 per $100 over $540,000
      // Over $1,000,000: $38,025 + $5.75 per $100 over $1,000,000
      if (landPrice <= 5000) return 0;
      if (landPrice <= 75000) return (landPrice - 5000) * 0.015;
      if (landPrice <= 540000) return 1050 + (landPrice - 75000) * 0.035;
      if (landPrice <= 1000000) return 17325 + (landPrice - 540000) * 0.045;
      return 38025 + (landPrice - 1000000) * 0.0575;
    }

    case 'NSW': {
      // NSW transfer duty (standard scale, 2024–25)
      // $0–$16,000:      $1.25 per $100
      // $16,001–$35,000: $200 + $1.50 per $100 over $16,000
      // $35,001–$93,000: $485 + $1.75 per $100 over $35,000
      // $93,001–$351,000: $1,500 + $3.50 per $100 over $93,000
      // $351,001–$1,168,000: $10,530 + $4.50 per $100 over $351,000
      // Over $1,168,000: $47,295 + $5.50 per $100 over $1,168,000
      if (landPrice <= 16000) return landPrice * 0.0125;
      if (landPrice <= 35000) return 200 + (landPrice - 16000) * 0.015;
      if (landPrice <= 93000) return 485 + (landPrice - 35000) * 0.0175;
      if (landPrice <= 351000) return 1500 + (landPrice - 93000) * 0.035;
      if (landPrice <= 1168000) return 10530 + (landPrice - 351000) * 0.045;
      return 47295 + (landPrice - 1168000) * 0.055;
    }

    case 'VIC': {
      // Victoria stamp duty (standard rate, non-PPR)
      // $0–$25,000:      1.4%
      // $25,001–$130,000:$350 + 2.4% over $25,000
      // $130,001–$960,000:$2,870 + 6.0% over $130,000
      // Over $960,000:   5.5% of dutiable value (no concession)
      if (landPrice <= 25000) return landPrice * 0.014;
      if (landPrice <= 130000) return 350 + (landPrice - 25000) * 0.024;
      if (landPrice <= 960000) return 2870 + (landPrice - 130000) * 0.06;
      return landPrice * 0.055;
    }

    case 'SA': {
      // South Australia stamp duty (standard rate)
      // $0–$12,000:      $1.00 per $100
      // $12,001–$30,000: $120 + $2.00 per $100 over $12,000
      // $30,001–$50,000: $480 + $3.00 per $100 over $30,000
      // $50,001–$100,000:$1,080 + $3.50 per $100 over $50,000
      // $100,001–$200,000:$2,830 + $4.00 per $100 over $100,000
      // $200,001–$250,000:$6,830 + $4.25 per $100 over $200,000
      // $250,001–$300,000:$8,955 + $4.75 per $100 over $250,000
      // $300,001–$500,000:$11,330 + $5.00 per $100 over $300,000
      // Over $500,000:   $21,330 + $5.50 per $100 over $500,000
      if (landPrice <= 12000) return landPrice * 0.01;
      if (landPrice <= 30000) return 120 + (landPrice - 12000) * 0.02;
      if (landPrice <= 50000) return 480 + (landPrice - 30000) * 0.03;
      if (landPrice <= 100000) return 1080 + (landPrice - 50000) * 0.035;
      if (landPrice <= 200000) return 2830 + (landPrice - 100000) * 0.04;
      if (landPrice <= 250000) return 6830 + (landPrice - 200000) * 0.0425;
      if (landPrice <= 300000) return 8955 + (landPrice - 250000) * 0.0475;
      if (landPrice <= 500000) return 11330 + (landPrice - 300000) * 0.05;
      return 21330 + (landPrice - 500000) * 0.055;
    }

    case 'WA': {
      // Western Australia stamp duty (general rate)
      // $0–$80,000:      $1.90 per $100
      // $80,001–$100,000:$1,520 + $2.85 per $100 over $80,000
      // $100,001–$250,000:$2,090 + $3.80 per $100 over $100,000
      // $250,001–$500,000:$7,790 + $4.75 per $100 over $250,000
      // Over $500,000:   $19,665 + $5.15 per $100 over $500,000
      if (landPrice <= 80000) return landPrice * 0.019;
      if (landPrice <= 100000) return 1520 + (landPrice - 80000) * 0.0285;
      if (landPrice <= 250000) return 2090 + (landPrice - 100000) * 0.038;
      if (landPrice <= 500000) return 7790 + (landPrice - 250000) * 0.0475;
      return 19665 + (landPrice - 500000) * 0.0515;
    }

    case 'TAS': {
      // Tasmania stamp duty (general rate)
      // $0–$3,000:       nil
      // $3,001–$25,000:  $50
      // $25,001–$75,000: $50 + $1.75 per $100 over $25,000
      // $75,001–$200,000:$925 + $2.25 per $100 over $75,000
      // $200,001–$375,000:$3,737.50 + $3.50 per $100 over $200,000
      // $375,001–$725,000:$9,862.50 + $4.00 per $100 over $375,000
      // Over $725,000:   $23,862.50 + $4.50 per $100 over $725,000
      if (landPrice <= 3000) return 0;
      if (landPrice <= 25000) return 50;
      if (landPrice <= 75000) return 50 + (landPrice - 25000) * 0.0175;
      if (landPrice <= 200000) return 925 + (landPrice - 75000) * 0.0225;
      if (landPrice <= 375000) return 3737.5 + (landPrice - 200000) * 0.035;
      if (landPrice <= 725000) return 9862.5 + (landPrice - 375000) * 0.04;
      return 23862.5 + (landPrice - 725000) * 0.045;
    }

    case 'ACT': {
      // ACT conveyance duty (non-residential general rate, 2024–25)
      // Flat 6.67% on dutiable value for commercial property
      return landPrice * 0.0667;
    }

    case 'NT': {
      // Northern Territory stamp duty (general rate)
      // Uses formula: V = dutiable value / 1000
      // Duty = (0.06571441 × V² + 15 × V) × 1.08
      // Simplified bracket approach:
      // $0–$525,000:     formula
      // Over $525,000:   4.95% of dutiable value
      if (landPrice <= 525000) {
        const v = landPrice / 1000;
        return (0.06571441 * v * v + 15 * v) * 1.08;
      }
      return landPrice * 0.0495;
    }

    default:
      return 0;
  }
}
