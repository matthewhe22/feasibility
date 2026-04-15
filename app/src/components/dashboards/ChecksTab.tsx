import React from 'react';
import { useStore } from '../../store/useStore';
import { formatCurrency, formatPercent, sum } from '../../utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO';

interface CheckResult {
  id: string;
  category: string;
  description: string;
  expected: string;
  actual: string;
  variance?: string;
  status: CheckStatus;
  notes?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOLERANCE = 10; // $10 matching tolerance (same as engine)

function near(a: number, b: number, tol = TOLERANCE): boolean {
  return Math.abs(a - b) <= tol;
}

function statusColor(s: CheckStatus) {
  switch (s) {
    case 'PASS': return 'bg-green-100 text-green-800';
    case 'WARN': return 'bg-yellow-100 text-yellow-800';
    case 'FAIL': return 'bg-red-100 text-red-800';
    case 'INFO': return 'bg-blue-50 text-blue-700';
  }
}

function statusBadge(s: CheckStatus) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${statusColor(s)}`}>
      {s}
    </span>
  );
}

// ── CheckRow ──────────────────────────────────────────────────────────────────

function CheckRow({ check, isEven }: { check: CheckResult; isEven: boolean }) {
  return (
    <tr className={isEven ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'}>
      <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{check.category}</td>
      <td className="px-3 py-1.5 text-xs text-gray-800">{check.description}</td>
      <td className="px-3 py-1.5 text-xs font-mono text-right whitespace-nowrap">{check.expected}</td>
      <td className="px-3 py-1.5 text-xs font-mono text-right whitespace-nowrap">{check.actual}</td>
      <td className="px-3 py-1.5 text-xs font-mono text-right whitespace-nowrap">
        {check.variance ?? '—'}
      </td>
      <td className="px-3 py-1.5 text-center">{statusBadge(check.status)}</td>
      <td className="px-3 py-1.5 text-xs text-gray-500 italic">{check.notes ?? ''}</td>
    </tr>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ChecksTab() {
  const { dashboardData: data, inputs, admin } = useStore();

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        Run calculations to see the Checks & Reconciliation tab
      </div>
    );
  }

  const cf = data.cashflows;
  const f = data.feasibility;
  const cs = data.capitalStack;
  const tolerance = admin.tolerance ?? TOLERANCE;

  const checks: CheckResult[] = [];

  // ── 1. NET CASHFLOW BALANCE ──────────────────────────────────────────────────
  // Every period's net cashflow should sum to ≈ 0 (all inflows = all outflows)
  {
    const totalNet = sum(cf.map(c => c.netCashflow));
    const status: CheckStatus = Math.abs(totalNet) <= tolerance ? 'PASS' : Math.abs(totalNet) < 100_000 ? 'WARN' : 'FAIL';
    checks.push({
      id: 'net-cf',
      category: 'Cashflow',
      description: 'Sum of all monthly net cashflows ≈ 0',
      expected: formatCurrency(0),
      actual: formatCurrency(totalNet),
      variance: formatCurrency(totalNet),
      status,
      notes: 'Net = revenue + drawdowns + equity in − costs − repayments − equity out. Should balance to zero.',
    });
  }

  // ── 2. GRV RECONCILIATION ────────────────────────────────────────────────────
  // Sum of cashflow settlements must match sum of GRV input prices
  {
    const grvInputTotal = sum(inputs.grvItems.map(g => g.currentSalePrice));
    const cashflowSettlements = sum(cf.map(c => c.grvSettlements));
    const variance = cashflowSettlements - grvInputTotal;
    const status: CheckStatus = near(grvInputTotal, cashflowSettlements, 1) ? 'PASS' : 'FAIL';
    checks.push({
      id: 'grv-recon',
      category: 'Revenue',
      description: 'GRV inputs total == cashflow settlements total',
      expected: formatCurrency(grvInputTotal),
      actual: formatCurrency(cashflowSettlements),
      variance: formatCurrency(variance),
      status,
      notes: 'Verifies that all revenue line items are fully spread to settlement periods.',
    });
  }

  // ── 3. FEASIBILITY TOTAL COST vs CASHFLOW ────────────────────────────────────
  // Sum of all cost cashflow rows should equal feasibility totalCost
  {
    const cashflowTotalCosts = sum(cf.map(c =>
      c.landCosts + c.acquisitionCosts + c.developmentCosts + c.constructionCosts +
      c.contingency + c.marketingCosts + c.otherStandardCosts + c.pmFees +
      c.sellingCostsFrontEnd + c.sellingCostsBackEnd + c.otherFinancingCosts +
      c.gstOnCosts +
      (inputs.seniorFacility.isCapitalised ? 0 : c.seniorInterest + c.seniorFees) +
      (inputs.mezzanine.isCapitalised ? 0 : c.mezzInterest + c.mezzFees) +
      c.landLoanInterest + c.landLoanFees
    ));
    const variance = cashflowTotalCosts - f.totalCost;
    const status: CheckStatus = near(cashflowTotalCosts, f.totalCost, 100) ? 'PASS' : 'WARN';
    checks.push({
      id: 'cost-recon',
      category: 'Costs',
      description: 'Cashflow cost rows total ≈ Feasibility total cost',
      expected: formatCurrency(f.totalCost),
      actual: formatCurrency(cashflowTotalCosts),
      variance: formatCurrency(variance),
      status,
      notes: 'Capitalised interest accretes to balance and appears in repayment, not here.',
    });
  }

  // ── 4. GST RECONCILIATION ────────────────────────────────────────────────────
  // GST on revenue from cashflow must match feasibility gstOnRevenue
  {
    const cfGSTOnRevenue = sum(cf.map(c => c.gstOnRevenue));
    const cfGSTOnCosts = sum(cf.map(c => c.gstOnCosts));
    const cfNetGST = cfGSTOnRevenue - cfGSTOnCosts;
    const varianceRev = cfGSTOnRevenue - f.gstOnRevenue;
    const varianceCosts = cfGSTOnCosts - f.gst;
    const revenueOk = near(cfGSTOnRevenue, f.gstOnRevenue, 1);
    const costsOk = near(cfGSTOnCosts, f.gst, 1);
    const status: CheckStatus = revenueOk && costsOk ? 'PASS' : 'FAIL';
    checks.push({
      id: 'gst-revenue',
      category: 'GST',
      description: 'GST on revenue (cashflow) == feasibility gstOnRevenue',
      expected: formatCurrency(f.gstOnRevenue),
      actual: formatCurrency(cfGSTOnRevenue),
      variance: formatCurrency(varianceRev),
      status,
      notes: `GST rate: ${(inputs.landPurchase.gstRate * 100).toFixed(1)}%. GST is extracted from GST-inclusive sale prices.`,
    });
    checks.push({
      id: 'gst-costs',
      category: 'GST',
      description: 'GST on costs (cashflow) == feasibility gst (ITC)',
      expected: formatCurrency(f.gst),
      actual: formatCurrency(cfGSTOnCosts),
      variance: formatCurrency(varianceCosts),
      status: costsOk ? 'PASS' : 'FAIL',
      notes: 'GST paid to vendors on cost items where addGST = true.',
    });
    checks.push({
      id: 'gst-net',
      category: 'GST',
      description: 'Net GST payable to ATO (revenue − ITC)',
      expected: formatCurrency(f.gstNet),
      actual: formatCurrency(cfNetGST),
      variance: formatCurrency(cfNetGST - f.gstNet),
      status: near(cfNetGST, f.gstNet, 1) ? 'PASS' : 'FAIL',
      notes: 'Net GST = GST on Revenue − GST on Costs (input tax credits).',
    });
    // Warn if GST rate is zero or GST on revenue is unexpectedly zero
    if (inputs.landPurchase.gstRate === 0) {
      checks.push({
        id: 'gst-rate-zero',
        category: 'GST',
        description: 'GST rate is 0% — check if this is intentional',
        expected: '>0%',
        actual: '0%',
        status: 'WARN',
        notes: 'Set gstRate in Land Purchase inputs. Standard Australian GST rate is 10%.',
      });
    }
    if (f.gstOnRevenue === 0 && inputs.grvItems.some(g => g.gstIncluded)) {
      checks.push({
        id: 'gst-revenue-zero',
        category: 'GST',
        description: 'GST on revenue is $0 despite gstIncluded items existing',
        expected: '>$0',
        actual: '$0',
        status: 'FAIL',
        notes: 'Check that gstRate > 0 and GRV items with gstIncluded:true have currentSalePrice > 0.',
      });
    }
    if (f.gst === 0 && inputs.developmentCosts.some(c => c.addGST !== false)) {
      checks.push({
        id: 'gst-costs-zero',
        category: 'GST',
        description: 'GST on costs is $0 despite addGST items existing',
        expected: '>$0',
        actual: '$0',
        status: 'FAIL',
        notes: 'Check that gstRate > 0. This may indicate cost items were saved before the addGST field was added to the schema.',
      });
    }
  }

  // ── 5. DEBT BALANCE AT END ───────────────────────────────────────────────────
  // All debt facilities should be fully repaid by end of project
  {
    const lastCF = cf[cf.length - 1];
    const seniorEnd = lastCF?.seniorBalance ?? 0;
    const mezzEnd = lastCF?.mezzBalance ?? 0;
    const landEnd = lastCF?.landLoanBalance ?? 0;

    checks.push({
      id: 'senior-balance',
      category: 'Debt',
      description: 'Senior facility balance at end of project',
      expected: formatCurrency(0),
      actual: formatCurrency(seniorEnd),
      variance: formatCurrency(seniorEnd),
      status: Math.abs(seniorEnd) <= 1000 ? 'PASS' : Math.abs(seniorEnd) < 1_000_000 ? 'WARN' : 'FAIL',
      notes: 'Senior should be fully repaid by project end.',
    });
    checks.push({
      id: 'mezz-balance',
      category: 'Debt',
      description: 'Mezzanine facility balance at end of project',
      expected: formatCurrency(0),
      actual: formatCurrency(mezzEnd),
      variance: formatCurrency(mezzEnd),
      status: Math.abs(mezzEnd) <= 1000 ? 'PASS' : Math.abs(mezzEnd) < 1_000_000 ? 'WARN' : 'FAIL',
      notes: 'Mezzanine should be fully repaid by project end.',
    });
    checks.push({
      id: 'land-balance',
      category: 'Debt',
      description: 'Land loan balance at end of project',
      expected: formatCurrency(0),
      actual: formatCurrency(landEnd),
      variance: formatCurrency(landEnd),
      status: Math.abs(landEnd) <= 1000 ? 'PASS' : Math.abs(landEnd) < 1_000_000 ? 'WARN' : 'FAIL',
      notes: 'Land loan is typically refinanced into the senior facility at construction start.',
    });
  }

  // ── 6. EQUITY BALANCE ───────────────────────────────────────────────────────
  // Total equity injected == total equity repatriated + total profit distributed
  {
    const totalInjected = sum(cf.map(c => c.equityInjection));
    const totalRepatriated = sum(cf.map(c => c.equityRepatriation));
    const totalProfit = sum(cf.map(c => c.profitDistribution));
    const netEquity = totalRepatriated + totalProfit - totalInjected;
    checks.push({
      id: 'equity-balance',
      category: 'Equity',
      description: 'Equity In == Equity Repatriation + Profit Distributed',
      expected: formatCurrency(totalInjected),
      actual: formatCurrency(totalRepatriated + totalProfit),
      variance: formatCurrency(netEquity),
      status: near(totalInjected, totalRepatriated + totalProfit, 100) ? 'PASS' : 'WARN',
      notes: `Injected: ${formatCurrency(totalInjected)}, Repatriated: ${formatCurrency(totalRepatriated)}, Profit: ${formatCurrency(totalProfit)}`,
    });
  }

  // ── 7. SENIOR FACILITY WITHIN LIMIT ─────────────────────────────────────────
  {
    const seniorLimit = inputs.seniorFacility.facilityLimit;
    const peakBalance = Math.max(...cf.map(c => c.seniorBalance));
    const utilisation = seniorLimit > 0 ? peakBalance / seniorLimit : 0;
    const status: CheckStatus = peakBalance <= seniorLimit ? 'PASS' : 'FAIL';
    checks.push({
      id: 'senior-limit',
      category: 'Debt',
      description: 'Peak senior balance within facility limit',
      expected: `≤ ${formatCurrency(seniorLimit)}`,
      actual: formatCurrency(peakBalance),
      variance: formatCurrency(peakBalance - seniorLimit),
      status,
      notes: `Utilisation: ${formatPercent(utilisation)}`,
    });
  }

  // ── 8. CAPITAL STACK LTC ─────────────────────────────────────────────────────
  // Senior + Mezz + Equity ≈ Total Cost (LTC should be ~100%)
  {
    const totalLTC = cs.seniorLTC + cs.mezzLTC + cs.equityLTC;
    const stackTotal = cs.seniorAmount + cs.mezzAmount + cs.equityAmount;
    const variance = stackTotal - f.totalCost;
    const status: CheckStatus = Math.abs(totalLTC - 1) < 0.01 ? 'PASS' : Math.abs(totalLTC - 1) < 0.05 ? 'WARN' : 'FAIL';
    checks.push({
      id: 'capital-stack',
      category: 'Capital Stack',
      description: 'Capital stack LTC sums to ~100% of total cost',
      expected: '100.00%',
      actual: formatPercent(totalLTC),
      variance: formatPercent(totalLTC - 1),
      status,
      notes: `Stack: ${formatCurrency(stackTotal)} vs TotalCost: ${formatCurrency(f.totalCost)} (Δ ${formatCurrency(variance)})`,
    });
  }

  // ── 9. CONTINGENCY CHECK ─────────────────────────────────────────────────────
  {
    const inputContingencyPct = inputs.constructionContingencyPercent;
    const totalConstruction = sum(inputs.constructionCosts.map(c => c.totalCosts));
    const expectedContingency = totalConstruction * inputContingencyPct;
    const actualContingency = f.contingency;
    const variance = actualContingency - expectedContingency;
    checks.push({
      id: 'contingency',
      category: 'Costs',
      description: 'Contingency amount matches input % × construction costs',
      expected: `${formatPercent(inputContingencyPct)} × ${formatCurrency(totalConstruction)} = ${formatCurrency(expectedContingency)}`,
      actual: formatCurrency(actualContingency),
      variance: formatCurrency(variance),
      status: near(actualContingency, expectedContingency, 1) ? 'PASS' : 'WARN',
      notes: `${formatPercent(inputContingencyPct)} contingency rate applied to construction costs.`,
    });
  }

  // ── 10. PM FEE RATE CHECK ────────────────────────────────────────────────────
  {
    const pmRate = inputs.pmFees.length > 0 && inputs.pmFees[0].units > 0
      ? inputs.pmFees[0].units
      : 0.02;
    const totalCostsExcPM =
      f.totalCost - f.pmFee
      - (inputs.seniorFacility.isCapitalised ? 0 : f.seniorFinanceCosts)
      - (inputs.mezzanine.isCapitalised ? 0 : f.mezzFinanceCosts);
    const expectedPMFee = pmRate * (
      sum(inputs.landPurchase.paymentStages.map(s =>
        s.percentOfLand > 0 ? s.percentOfLand * inputs.landPurchase.landPurchasePrice : s.amount
      )) +
      inputs.landPurchase.prsvUplift +
      sum(inputs.landPurchase.acquisitionCosts.map(a => a.amount)) +
      sum(inputs.developmentCosts.map(c => c.totalCosts)) +
      sum(inputs.constructionCosts.map(c => c.totalCosts)) +
      f.contingency +
      sum(inputs.marketingCosts.map(c => c.totalCosts)) +
      sum(inputs.otherStandardCosts.map(c => c.totalCosts)) +
      sum(inputs.otherFinancingCosts.map(c => c.totalCosts))
    );
    const variance = f.pmFee - expectedPMFee;
    checks.push({
      id: 'pm-fee',
      category: 'Costs',
      description: `PM Fee = ${formatPercent(pmRate)} × eligible costs`,
      expected: formatCurrency(expectedPMFee),
      actual: formatCurrency(f.pmFee),
      variance: formatCurrency(variance),
      status: near(f.pmFee, expectedPMFee, 1000) ? 'PASS' : 'WARN',
      notes: `PM fee rate: ${formatPercent(pmRate)}. Applied to all costs excluding PM fee and selling commissions.`,
    });
  }

  // ── 11. LAND COST RECONCILIATION ─────────────────────────────────────────────
  {
    const inputLandTotal = inputs.landPurchase.landPurchasePrice + inputs.landPurchase.prsvUplift;
    const cashflowLand = sum(cf.map(c => c.landCosts));
    const variance = cashflowLand - inputLandTotal;
    checks.push({
      id: 'land-recon',
      category: 'Costs',
      description: 'Land cashflows total == Land purchase price + PRSV uplift',
      expected: formatCurrency(inputLandTotal),
      actual: formatCurrency(cashflowLand),
      variance: formatCurrency(variance),
      status: near(cashflowLand, inputLandTotal, 1) ? 'PASS' : 'FAIL',
      notes: `Purchase: ${formatCurrency(inputs.landPurchase.landPurchasePrice)}, PRSV: ${formatCurrency(inputs.landPurchase.prsvUplift)}`,
    });
  }

  // ── 12. ACQUISITION COSTS RECONCILIATION ────────────────────────────────────
  {
    const inputAcqTotal = sum(inputs.landPurchase.acquisitionCosts.map(a => a.amount));
    const cashflowAcq = sum(cf.map(c => c.acquisitionCosts));
    const variance = cashflowAcq - inputAcqTotal;
    checks.push({
      id: 'acq-recon',
      category: 'Costs',
      description: 'Acquisition costs cashflow == input stamp duty & fees',
      expected: formatCurrency(inputAcqTotal),
      actual: formatCurrency(cashflowAcq),
      variance: formatCurrency(variance),
      status: near(cashflowAcq, inputAcqTotal, 1) ? 'PASS' : 'FAIL',
    });
  }

  // ── 13. PROFIT CONSISTENCY ───────────────────────────────────────────────────
  // Feasibility profit should match: GRV − gstOnRevenue − totalCost
  {
    const derivedProfit = f.totalGRV - f.gstOnRevenue - f.totalCost;
    const variance = derivedProfit - f.totalProfit;
    checks.push({
      id: 'profit-consistency',
      category: 'Returns',
      description: 'Total Profit = GRV − GST on Revenue − Total Cost',
      expected: formatCurrency(derivedProfit),
      actual: formatCurrency(f.totalProfit),
      variance: formatCurrency(variance),
      status: near(derivedProfit, f.totalProfit, 1) ? 'PASS' : 'FAIL',
      notes: `GRV ${formatCurrency(f.totalGRV)} − GST on Rev ${formatCurrency(f.gstOnRevenue)} − Costs ${formatCurrency(f.totalCost)}`,
    });
  }

  // ── 14. PROFIT vs WATERFALL DISTRIBUTIONS ───────────────────────────────────
  // Profit from feasibility should closely match the sum of distributions from funding waterfall
  {
    const waterfallProfit = sum(cf.map(c => c.profitDistribution));
    const variance = waterfallProfit - f.totalProfit;
    const status: CheckStatus = Math.abs(variance) < 10_000 ? 'PASS' : Math.abs(variance) < 1_000_000 ? 'WARN' : 'FAIL';
    checks.push({
      id: 'profit-waterfall',
      category: 'Returns',
      description: 'Feasibility profit ≈ Sum of profit distributions (waterfall)',
      expected: formatCurrency(f.totalProfit),
      actual: formatCurrency(waterfallProfit),
      variance: formatCurrency(variance),
      status,
      notes: 'Difference may be due to timing rounding in the debt-solving iteration.',
    });
  }

  // ── 15. S-CURVE WARNINGS ────────────────────────────────────────────────────
  if (data.warnings && data.warnings.length > 0) {
    data.warnings.forEach((w, i) => {
      checks.push({
        id: `scurve-warn-${i}`,
        category: 'S-Curves',
        description: w,
        expected: 'No warnings',
        actual: 'Warning',
        status: 'WARN',
        notes: 'Falling back to parabolic or even-split approximation.',
      });
    });
  } else {
    checks.push({
      id: 'scurve-ok',
      category: 'S-Curves',
      description: 'All S-curves have weights defined',
      expected: 'No warnings',
      actual: 'No warnings',
      status: 'PASS',
    });
  }

  // ── 16. PROJECT SPAN ─────────────────────────────────────────────────────────
  {
    const lastSettlement = inputs.grvItems
      .filter(g => g.settlementMonth > 0)
      .reduce((max, g) => Math.max(max, g.settlementMonth + (g.settlementSpan || 1) - 1), 0);
    const projectSpan = inputs.preliminary.projectSpanMonths;
    const ok = lastSettlement <= projectSpan;
    checks.push({
      id: 'project-span',
      category: 'Timeline',
      description: 'Last settlement month falls within project span',
      expected: `≤ month ${projectSpan}`,
      actual: `month ${lastSettlement}`,
      status: ok ? 'PASS' : 'FAIL',
      notes: ok ? 'All settlements complete before project end.' : 'Some settlements extend beyond project span — expand span or adjust settlement months.',
    });
  }

  // ── Tallies ────────────────────────────────────────────────────────────────
  const passCount = checks.filter(c => c.status === 'PASS').length;
  const warnCount = checks.filter(c => c.status === 'WARN').length;
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const overallStatus: CheckStatus = failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'PASS';

  const categories = Array.from(new Set(checks.map(c => c.category)));

  return (
    <div>
      {/* Header */}
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-gray-800">Checks &amp; Reconciliation</h2>
        <p className="text-xs text-gray-500">Model integrity checks to verify calculation accuracy</p>
      </div>

      {/* Summary Banner */}
      <div className={`flex items-center gap-6 px-4 py-3 rounded-lg mb-5 border ${
        overallStatus === 'PASS' ? 'bg-green-50 border-green-300' :
        overallStatus === 'WARN' ? 'bg-yellow-50 border-yellow-300' :
        'bg-red-50 border-red-300'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`text-xl font-bold ${
            overallStatus === 'PASS' ? 'text-green-700' :
            overallStatus === 'WARN' ? 'text-yellow-700' :
            'text-red-700'
          }`}>
            {overallStatus === 'PASS' ? '✓ All Checks Passed' :
             overallStatus === 'WARN' ? '⚠ Warnings Present' :
             '✗ Failures Detected'}
          </span>
        </div>
        <div className="flex gap-4 ml-auto text-sm">
          <span className="font-semibold text-green-700">{passCount} PASS</span>
          <span className="font-semibold text-yellow-700">{warnCount} WARN</span>
          <span className="font-semibold text-red-700">{failCount} FAIL</span>
          <span className="text-gray-500">{checks.length} total</span>
        </div>
      </div>

      {/* Checks Table by Category */}
      {categories.map(cat => {
        const catChecks = checks.filter(c => c.category === cat);
        const catFail = catChecks.some(c => c.status === 'FAIL');
        const catWarn = catChecks.some(c => c.status === 'WARN');
        const catColor = catFail ? 'bg-red-700' : catWarn ? 'bg-yellow-600' : 'bg-green-700';

        return (
          <div key={cat} className="mb-5 border border-gray-200 rounded overflow-hidden">
            <div className={`${catColor} text-white text-xs font-bold px-3 py-1.5 flex items-center justify-between`}>
              <span>{cat}</span>
              <span className="text-white/70 text-[10px]">{catChecks.length} check{catChecks.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-600 text-[10px] uppercase">
                    <th className="px-3 py-1 text-left w-24">Category</th>
                    <th className="px-3 py-1 text-left">Check</th>
                    <th className="px-3 py-1 text-right w-36">Expected</th>
                    <th className="px-3 py-1 text-right w-36">Actual</th>
                    <th className="px-3 py-1 text-right w-28">Variance</th>
                    <th className="px-3 py-1 text-center w-16">Status</th>
                    <th className="px-3 py-1 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {catChecks.map((check, i) => (
                    <CheckRow key={check.id} check={check} isEven={i % 2 === 0} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* GST Explanation Panel */}
      <div className="bg-blue-50 border border-blue-200 rounded p-3 mt-2">
        <h3 className="text-xs font-bold text-blue-800 mb-2">GST Treatment in this Model</h3>
        <div className="text-xs text-blue-700 space-y-1">
          <p><strong>GST on Costs (ITC):</strong> GST paid to vendors on cost items where <code>addGST = true</code>. Claimable via BAS input tax credits. Included in total cost and in the funding waterfall as a cash outflow.</p>
          <p><strong>GST on Revenue:</strong> GST embedded in GST-inclusive sale prices (residential items where <code>gstIncluded = true</code>). Calculated using the margin scheme: <code>Sale Price × rate / (1 + rate)</code>. Remitted to the ATO.</p>
          <p><strong>Net GST Payable:</strong> GST on Revenue − GST on Costs (ITC). This is the net amount remitted to the ATO after claiming input tax credits.</p>
          <p className="text-blue-600 italic">Note: If "GST on Costs" shows $0, check that (1) gstRate &gt; 0% in Land Purchase inputs, and (2) cost items have <code>addGST = true</code>. Items saved before the addGST field was introduced may show as undefined (treated as false). Re-entering costs from the Inputs tab will fix this.</p>
        </div>
      </div>
    </div>
  );
}
