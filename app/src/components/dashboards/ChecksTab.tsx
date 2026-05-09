import { useStore } from '../../store/useStore';
import { formatCurrency, formatPercent, sum } from '../../utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO' | 'N/A';

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
    case 'N/A':  return 'bg-gray-100 text-gray-600';
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
      c.gstOnCosts - c.itcRecovery +   // net GST on costs = 0 (ITC fully offsets)
      (inputs.seniorFacility.isCapitalised ? 0 : c.seniorInterest + c.seniorFees) +
      (inputs.mezzanine.isCapitalised ? 0 : c.mezzInterest + c.mezzFees) +
      c.landLoanInterest + c.landLoanFees
    ));
    const variance = cashflowTotalCosts - f.totalCost;
    const anyCapitalised = inputs.seniorFacility.isCapitalised || inputs.mezzanine.isCapitalised;
    // When senior/mezz interest is capitalised the variance is expected: capitalised
    // interest accretes to the loan balance and appears in repayments, not as a
    // discrete cost row. Flag as INFO (not WARN) so it doesn't look like an error.
    const status: CheckStatus = near(cashflowTotalCosts, f.totalCost, 100) ? 'PASS'
      : anyCapitalised ? 'INFO'
      : 'WARN';
    checks.push({
      id: 'cost-recon',
      category: 'Costs',
      description: 'Cashflow cost rows total ≈ Feasibility total cost',
      expected: formatCurrency(f.totalCost),
      actual: formatCurrency(cashflowTotalCosts),
      variance: formatCurrency(variance),
      status,
      notes: anyCapitalised
        ? 'Variance = capitalised senior/mezz interest & fees. These accrete to the loan balance and are repaid as part of principal repayments — they are included in the Feasibility total cost but excluded from the cashflow cost rows shown here. This is expected.'
        : 'Cashflow cost rows should closely match Feasibility total cost. A non-trivial variance may indicate a spreading or timing issue.',
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
    // Bug 4 (Kew UAT): GST rate = 0 is silently wrong on Australian projects.
    // Bump to FAIL when the project has GST-bearing items so the user can't
    // miss it. WARN-level when no GST-bearing items exist (legitimate non-AU
    // / zero-rated treatment). Either way, prepend the standout 🚨 marker so
    // the row sticks out at the top of the GST category.
    if (inputs.landPurchase.gstRate === 0) {
      const hasGstBearingItems =
        inputs.grvItems.some(g => g.gstIncluded) ||
        inputs.constructionCosts.some(c => c.addGST) ||
        inputs.developmentCosts.some(c => c.addGST) ||
        inputs.marketingCosts.some(c => c.addGST) ||
        inputs.otherStandardCosts.some(c => c.addGST);
      checks.push({
        id: 'gst-rate-zero',
        category: 'GST',
        description: hasGstBearingItems
          ? '🚨 GST rate is 0% — but project has GST-bearing items (Australian GST default is 10%)'
          : 'GST rate is 0% — confirm this is intentional (non-AU / zero-rated treatment)',
        expected: '0.10 (Australian GST)',
        actual: '0%',
        status: hasGstBearingItems ? 'FAIL' : 'WARN',
        notes: hasGstBearingItems
          ? 'Set gstRate to 0.10 in the Land Purchase inputs (Section 1.1). Standard Australian GST is 10%. The engine cannot recover ITCs or recognise GST output at 0% — your cashflow and net-GST checks will be wrong.'
          : 'Set gstRate in Land Purchase inputs. Standard Australian GST rate is 10%. Leave at 0% only if the project is genuinely outside Australian GST (export, financial supply, etc).',
      });
    }
    // B09 — Suppress the consequential "GST on revenue / costs is $0" warnings
    // when gstRate is 0%. The first check ('gst-rate-zero') already covers
    // the diagnosis; the others are downstream consequences of the same
    // misconfiguration and just create noise. Emit them only when gstRate > 0
    // (in which case zero-revenue / zero-cost GST is genuinely surprising).
    if (inputs.landPurchase.gstRate > 0 && f.gstOnRevenue === 0 && inputs.grvItems.some(g => g.gstIncluded)) {
      checks.push({
        id: 'gst-revenue-zero',
        category: 'GST',
        description: 'GST on revenue is $0 despite gstIncluded items existing',
        expected: '>$0',
        actual: '$0',
        status: 'WARN',
        notes: 'gstIncluded items present but GST on revenue is zero — supply-type routing may be coercing all items to input-taxed. Verify supplyType / revenueType.',
      });
    }
    if (inputs.landPurchase.gstRate > 0) {
      // Check ALL cost categories that the engine applies GST to, not just dev costs
      const allGSTCostItems = [
        ...inputs.developmentCosts,
        ...inputs.constructionCosts,
        ...inputs.marketingCosts,
        ...inputs.pmFees,
        ...inputs.otherStandardCosts,
        ...inputs.otherFinancingCosts,
      ];
      if (f.gst === 0 && allGSTCostItems.some(c => c.addGST !== false)) {
        checks.push({
          id: 'gst-costs-zero',
          category: 'GST',
          description: 'GST on costs is $0 despite addGST items existing',
          expected: '>$0',
          actual: '$0',
          status: 'WARN',
          notes: 'gstRate > 0 and addGST=true on cost items, yet GST on costs is zero — a routing or schema bug. Investigate.',
        });
      }
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
  // Total equity returned to the developer = principal repatriation + profit
  // distribution. On a profitable project the developer should receive AT
  // LEAST what they put in (PASS). On a loss-making project, returned <
  // injected (FAIL — the gap is the realised loss).
  // B04 — previously this check compared injection vs repatriation alone,
  // ignoring profitDistribution. On Sydney Tower v1 ($117.3M injected, $117.3M
  // repatriated, $112.4M profit) the check displayed a $68,915 'deficit'
  // because principal returned was $68k short of injection — but the developer
  // received $229.7M total. Including profit in the comparison produces an
  // accurate verdict; the principal-only sub-accounting is preserved in notes.
  {
    const totalInjected = sum(cf.map(c => c.equityInjection));
    const totalRepatriated = sum(cf.map(c => c.equityRepatriation));
    const totalProfit = sum(cf.map(c => c.profitDistribution));
    const totalReturned = totalRepatriated + totalProfit;
    const variance = totalReturned - totalInjected;
    const status: CheckStatus =
      Math.abs(variance) <= 100 ? 'PASS'
      : variance > 0 ? 'PASS'                       // returned > injected (profit) → PASS
      : f.totalProfit < 0 ? 'FAIL'                   // loss-making + deficit → FAIL
      : Math.abs(variance) < 1_000 ? 'WARN'          // small principal residual on a profitable project
      : 'FAIL';
    checks.push({
      id: 'equity-balance',
      category: 'Equity',
      description: 'Equity returned (principal + profit) ≥ injected',
      expected: `≥ ${formatCurrency(totalInjected)}`,
      actual: formatCurrency(totalReturned),
      variance: formatCurrency(variance),
      status,
      notes: `Injected: ${formatCurrency(totalInjected)}, Principal repatriated: ${formatCurrency(totalRepatriated)}, ` +
        `Profit distributed: ${formatCurrency(totalProfit)}, Total returned: ${formatCurrency(totalReturned)}.` +
        (variance < -100 && f.totalProfit < 0
          ? ` Project is loss-making; deficit ${formatCurrency(-variance)} is a real loss of equity.`
          : variance < -100
          ? ` Small principal-side residual; likely cap-int rounding in the waterfall sweep.`
          : ''),
    });
  }

  // ── 6.5 EQUITY MEETS MINIMUM REQUIREMENT ────────────────────────────────────
  // V8 — Term-sheet equity floor cross-check. Reads the engine's converged
  // `data.minEquityCheck` telemetry directly so this row's numbers match the
  // [FUNDING] warning byte-for-byte. The earlier implementation recomputed the
  // basis from `feasibility.totalCost` (input-side ex-GST rollup) and could
  // disagree with the engine's cash-basis-incl-GST computation on any
  // GST-bearing project — funnelling everyone through the engine struct ends
  // that divergence.
  // Status:
  //   • value === 0      → N/A   (check disabled — back-compat default)
  //   • shortfall === 0  → PASS  (engine confirms actual ≥ required)
  //   • shortfall > 0    → FAIL  (engine recorded a shortfall)
  {
    const minEq = inputs.minEquityRequirement;
    const ch = data.minEquityCheck;
    if (!minEq || !Number.isFinite(minEq.value) || minEq.value <= 0) {
      checks.push({
        id: 'min-equity',
        category: 'Equity',
        description: 'Equity meets minimum requirement',
        expected: 'Not configured',
        actual: '—',
        status: 'N/A',
        notes: 'Set Inputs → Financing → Minimum Equity Requirement (value > 0) to enable this term-sheet cross-check.',
      });
    } else if (!ch) {
      // Defensive: engine didn't populate (legacy cached dashboard data).
      checks.push({
        id: 'min-equity',
        category: 'Equity',
        description: 'Equity meets minimum requirement',
        expected: '—',
        actual: '—',
        status: 'N/A',
        notes: 'Engine telemetry unavailable — re-run calculations to refresh.',
      });
    } else {
      const variance = ch.actual - ch.required;
      const status: CheckStatus = ch.shortfall === 0 ? 'PASS' : 'FAIL';
      const reqDescriptor = minEq.mode === 'percent'
        ? `${(minEq.value * 100).toFixed(2)}% of ${ch.basisName} (${formatCurrency(ch.basisAmount)})`
        : formatCurrency(minEq.value);
      checks.push({
        id: 'min-equity',
        category: 'Equity',
        description: 'Equity meets minimum requirement',
        expected: `≥ ${formatCurrency(ch.required)}`,
        actual: formatCurrency(ch.actual),
        variance: formatCurrency(variance),
        status,
        notes: status === 'PASS'
          ? `Term-sheet floor: ${reqDescriptor}. Actual cash equity meets or exceeds the floor.`
          : `Term-sheet floor: ${reqDescriptor}. Shortfall of ${formatCurrency(ch.shortfall)} — restructure: increase equity or reduce TDC.`,
      });
    }
  }

  // ── 6.6 EQUITY WITHIN USER CAP ──────────────────────────────────────────────
  // Bug B — surface when the engine's auto-backstop (minEquityRequirement
  // floor + equity-of-last-resort gap-fill) pushed cumulativeEquity above
  // the user-set `equityDeveloper.equityCap` (and `equityJV.equityCap` if
  // active). Both mechanisms are correct cash-mechanics behaviour, but a
  // financier reading the Internal Dashboard sees `Equity drawn = $24.12M`
  // while the term-sheet commitment is `$16.5M` with NO indication that
  // the stated cap was breached.
  //
  // Reads the engine's `data.equityCapCheck` telemetry directly so this
  // row's numbers match the [FUNDING] warning byte-for-byte.
  //
  // Status mapping (mirrors engine severity ladder):
  //   • cap === 0 (uncapped) AND no JV cap → N/A (check disabled)
  //   • severity === 'pass'                → PASS
  //   • severity === 'info'                → INFO  (≤ 5% over)
  //   • severity === 'warn'                → WARN  (5–20% over)
  //   • severity === 'fail'                → FAIL  (> 20% over OR > cap×1.5)
  //
  // For projects with both Developer and JV caps, the worst severity wins
  // and the notes string lists both lines.
  {
    const ecc = data.equityCapCheck;
    const devCapped = !!ecc?.developer && ecc.developer.cap > 0;
    const jvCapped  = !!ecc?.jv && ecc.jv.cap > 0;

    if (!ecc || (!devCapped && !jvCapped)) {
      checks.push({
        id: 'equity-cap',
        category: 'Equity',
        description: 'Equity within user cap',
        expected: 'Not configured',
        actual: '—',
        status: 'N/A',
        notes: 'Set Inputs → Financing → Developer Equity Cap (value > 0) to enable this term-sheet cross-check. ' +
          'When `equityCap = 0` the engine treats developer equity as uncapped gap-fill (legacy behaviour preserved).',
      });
    } else {
      // Map severity → CheckStatus, take the worst across entities.
      const sevRank = (sev: 'pass' | 'info' | 'warn' | 'fail'): number =>
        sev === 'fail' ? 3 : sev === 'warn' ? 2 : sev === 'info' ? 1 : 0;
      const devSev = devCapped ? ecc.developer.severity : 'pass';
      const jvSev  = jvCapped  ? ecc.jv.severity        : 'pass';
      const worstSev = sevRank(devSev) >= sevRank(jvSev) ? devSev : jvSev;
      const status: CheckStatus =
        worstSev === 'fail' ? 'FAIL' :
        worstSev === 'warn' ? 'WARN' :
        worstSev === 'info' ? 'INFO' :
        'PASS';

      // Expected/actual values use the binding (worst) entity for the
      // headline numbers. Notes string lists both entities for transparency.
      const binding = (sevRank(devSev) >= sevRank(jvSev)) ? ecc.developer : ecc.jv;
      const bindingLabel = (sevRank(devSev) >= sevRank(jvSev)) ? 'Developer' : 'JV';
      const overshoot = binding.overshoot;
      const overshootPctLabel = formatPercent(binding.overshootPct);
      const variance = -overshoot; // negative = over the cap

      const lines: string[] = [];
      if (devCapped) {
        lines.push(
          `Developer: drawn ${formatCurrency(ecc.developer.drawn)} vs cap ${formatCurrency(ecc.developer.cap)}` +
          (ecc.developer.overshoot > 0
            ? ` (${formatCurrency(ecc.developer.overshoot)} over, ${formatPercent(ecc.developer.overshootPct)})`
            : ' (within cap)'),
        );
      }
      if (jvCapped) {
        lines.push(
          `JV: drawn ${formatCurrency(ecc.jv.drawn)} vs cap ${formatCurrency(ecc.jv.cap)}` +
          (ecc.jv.overshoot > 0
            ? ` (${formatCurrency(ecc.jv.overshoot)} over, ${formatPercent(ecc.jv.overshootPct)})`
            : ' (within cap)'),
        );
      }
      const remedy =
        status === 'FAIL'
          ? ` Capital stack is fundamentally inconsistent with stated equity commitment — increase ${bindingLabel} cap to ${formatCurrency(binding.drawn)}+, raise senior/mezz facility, or reduce project scope.`
          : status === 'WARN'
          ? ` Auto-backstop filled funding gap of ${formatCurrency(binding.fundingGap)}. Increase ${bindingLabel} cap to ${formatCurrency(binding.drawn)}+, raise senior/mezz facility, or reduce project scope.`
          : status === 'INFO'
          ? ` Small auto-backstop within tolerance (${overshootPctLabel} over) — review if intentional.`
          : '';
      checks.push({
        id: 'equity-cap',
        category: 'Equity',
        description: 'Equity within user cap',
        expected: `≤ ${formatCurrency(binding.cap)}`,
        actual: formatCurrency(binding.drawn),
        variance: overshoot > 0 ? formatCurrency(variance) : formatCurrency(0),
        status,
        notes: lines.join('. ') + '.' + remedy,
      });
    }
  }

  // ── 7. SENIOR FACILITY WITHIN LIMIT ─────────────────────────────────────────
  {
    // R10 — use the engine-sized senior limit (= min of input limit, LTC ceiling,
    // LVR ceiling) so this check aligns with the per-period warnings that the
    // funding solver emits. Previously this check used the raw input limit
    // (e.g. \$145M) while the warnings used the engine-sized limit (e.g. \$110.79M),
    // which made the dashboard internally inconsistent. Box Hill UAT R10.
    const seniorLimit = data.capitalStack.seniorAmount > 0
      ? data.capitalStack.seniorAmount
      : inputs.seniorFacility.facilityLimit;
    const peakBalance = Math.max(...cf.map(c => c.seniorBalance));
    const utilisation = seniorLimit > 0 ? peakBalance / seniorLimit : 0;
    const overLimit = peakBalance > seniorLimit;
    // When senior interest is capitalised it accretes to the outstanding balance,
    // which can legitimately push the balance above the stated facility limit.
    // That is expected behaviour — only flag FAIL when the facility is NOT capitalised.
    const status: CheckStatus = !overLimit ? 'PASS'
      : inputs.seniorFacility.isCapitalised ? 'WARN'
      : 'FAIL';
    checks.push({
      id: 'senior-limit',
      category: 'Debt',
      description: 'Peak senior balance within facility limit',
      expected: `≤ ${formatCurrency(seniorLimit)}`,
      actual: formatCurrency(peakBalance),
      variance: formatCurrency(peakBalance - seniorLimit),
      status,
      notes: inputs.seniorFacility.isCapitalised && overLimit
        ? `Capitalised interest accretes to the balance and can push it above the stated limit — this is expected. The facility limit controls principal drawdowns only. Utilisation (peak/limit): ${formatPercent(utilisation)}.`
        : `Utilisation: ${formatPercent(utilisation)}`,
    });
  }

  // ── 8. CAPITAL STACK LTC ─────────────────────────────────────────────────────
  // Informational breakdown of Senior / Mezz / Equity LTC percentages.
  // K02 (Kew UAT v3): the prior label flagged values >100% as "typical for
  // revolving facility", which read as alarmist. Reframe as neutral peak
  // utilisation — committed limits + auto-sized headroom; ratios above 100%
  // are expected under M4 auto-sizing because LTC numerators use peak
  // outstanding balances rather than committed limits.
  {
    const totalLTC = cs.seniorLTC + cs.mezzLTC + cs.equityLTC;
    const stackTotal = cs.seniorAmount + cs.mezzAmount + cs.equityAmount;
    const variance = stackTotal - f.totalCost;
    checks.push({
      id: 'capital-stack',
      category: 'Capital Stack',
      description: 'Capital stack breakdown (Senior / Mezz / Equity LTC)',
      expected: '≥ 100.00% under M4 auto-sizing',
      actual: formatPercent(totalLTC),
      variance: formatPercent(totalLTC - 1),
      status: 'INFO',
      notes: `Funding sources peak utilisation: ${formatPercent(totalLTC)} (committed limits + auto-sized headroom; ratio > 100% expected under M4 auto-sizing). Stack: ${formatCurrency(stackTotal)} vs TotalCost: ${formatCurrency(f.totalCost)} (Δ ${formatCurrency(variance)}).`,
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
  // Aligns with the engine's iterative converge: engine writes f.pmFee and
  // spreads it across the cashflow PM Fees row. Both should sum to the same
  // figure. The previous version of this check ran a manual formula that
  // excluded capitalised finance costs from the base, which the engine
  // includes — producing a spurious +$389K WARN on the Melbourne UAT
  // (Ch1 finding). The current check is the real cross-section invariant.
  {
    const rawPmRate = inputs.pmFees[0]?.feeRatePercent;
    const pmRate = (typeof rawPmRate === 'number' && rawPmRate > 0 && rawPmRate < 1)
      ? rawPmRate : 0.02;
    const cashflowPMTotal = sum(cf.map(c => c.pmFees));
    const variance = cashflowPMTotal - f.pmFee;
    checks.push({
      id: 'pm-fee',
      category: 'Costs',
      description: `PM Fee — cashflow sums match feasibility total`,
      expected: formatCurrency(f.pmFee),
      actual: formatCurrency(cashflowPMTotal),
      variance: formatCurrency(variance),
      status: near(cashflowPMTotal, f.pmFee, 1000) ? 'PASS' : 'WARN',
      notes: `PM fee rate ${formatPercent(pmRate)} applied to total non-PM costs (incl. capitalised finance costs and GST on those costs) per engine/index.ts.`,
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
  // totalProfit = settled revenue − gstOnRevenue − totalCost
  // Uses settled revenue (not raw GRV) so unsettled items don't inflate profit.
  {
    const derivedProfit = f.totalSettlementsRevenue - f.gstOnRevenue - f.totalCost;
    const variance = derivedProfit - f.totalProfit;
    checks.push({
      id: 'profit-consistency',
      category: 'Returns',
      description: 'Total Profit = Settled Revenue − GST on Revenue − Total Cost',
      expected: formatCurrency(derivedProfit),
      actual: formatCurrency(f.totalProfit),
      variance: formatCurrency(variance),
      status: near(derivedProfit, f.totalProfit, 1) ? 'PASS' : 'FAIL',
      notes: `Settled Rev ${formatCurrency(f.totalSettlementsRevenue)} − GST on Rev ${formatCurrency(f.gstOnRevenue)} − Costs ${formatCurrency(f.totalCost)}`,
    });
  }

  // ── 14. PROFIT ↔ WATERFALL RECONCILIATION ──────────────────────────────────
  // The two profits this check has historically compared are NOT the same
  // accounting object:
  //   feasibilityProfit = settlements + rentals + other - GSTonRev - totalCost
  //                     (accounting profit, can be negative)
  //   waterfallProfit   = Σ profitDistributions in the funding waterfall
  //                     (residual after senior/mezz/equity repayment, floored at 0)
  //
  // For a profitable project they should agree to within rounding. For a
  // loss-making project they cannot agree: the waterfall floors at 0 by
  // construction, so the variance always equals the unrepatriated equity
  // plus any unpaid debt. Calling that "rounding" is wrong (UAT v2 issue #5).
  //
  // We now compute reconciledWaterfall = waterfallProfit
  //                                    − unrepatriatedEquity
  //                                    − unpaidDebt
  // and assert reconciledWaterfall ≈ feasibilityProfit. Loss-making projects
  // PASS this check with a clear breakdown in the notes; reconciliation gaps
  // beyond that breakdown still FAIL.
  {
    const waterfallProfit = sum(cf.map(c => c.profitDistribution));
    const equityInjected = sum(cf.map(c => c.equityInjection));
    const equityReturned = sum(cf.map(c => c.equityRepatriation));
    const unrepatriatedEquity = Math.max(0, equityInjected - equityReturned);
    // Ending facility balances = last period's closing balance (kept on each
    // monthly cashflow row so we don't need a new FundingResult field).
    const lastIdx = cf.length - 1;
    const unpaidSenior = lastIdx >= 0 ? (cf[lastIdx]?.seniorBalance ?? 0) + (cf[lastIdx]?.senior2Balance ?? 0) : 0;
    const unpaidMezz = lastIdx >= 0 ? (cf[lastIdx]?.mezzBalance ?? 0) : 0;
    const unpaidLand = lastIdx >= 0 ? (cf[lastIdx]?.landLoanBalance ?? 0) : 0;
    const unpaidDebt = unpaidSenior + unpaidMezz + unpaidLand;
    const reconciledWaterfall = waterfallProfit - unrepatriatedEquity - unpaidDebt;
    const variance = reconciledWaterfall - f.totalProfit;
    // R2 residual handling (PR-A). PR #28 closed the structural double-count;
    // any remaining variance is solver/rounding residual that scales with
    // project size. PASS when within $10k; WARN when within max($500k, 0.5%
    // of total cost) — covers larger projects where rounding is naturally
    // larger; FAIL only when the variance is a real reconciliation bug.
    const warnTol = Math.max(500_000, f.totalCost * 0.005);
    const status: CheckStatus = Math.abs(variance) < 10_000 ? 'PASS'
      : Math.abs(variance) < warnTol ? 'WARN' : 'FAIL';
    checks.push({
      id: 'profit-waterfall',
      category: 'Returns',
      description: 'Feasibility profit ≈ Waterfall − unrepatriated equity − unpaid debt',
      expected: formatCurrency(f.totalProfit),
      actual: formatCurrency(reconciledWaterfall),
      variance: formatCurrency(variance),
      status,
      notes:
        `Waterfall distributions ${formatCurrency(waterfallProfit)} ` +
        `− unrepatriated equity ${formatCurrency(unrepatriatedEquity)} ` +
        `− unpaid debt ${formatCurrency(unpaidDebt)} ` +
        `(senior ${formatCurrency(unpaidSenior)} / mezz ${formatCurrency(unpaidMezz)} / land ${formatCurrency(unpaidLand)})` +
        `. Loss-making projects: this PASSes when feasibility profit equals the negative of the equity+debt shortfall.`,
    });
  }

  // ── 15. ENGINE WARNINGS — routed by category (R3) ──────────────────────────
  // Earlier versions of this block dumped *every* engine warning under
  // "S-Curves" with boilerplate notes, which mis-categorised funding and
  // revenue messages. Now we read warningsDetail (which carries the actual
  // category from engine/index.ts) and route accordingly. Per-message status
  // is upgraded based on content cues.
  const warningsDetail = data.warningsDetail ?? [];
  const sCurveWarns = warningsDetail.filter(w => w.category === 'sCurve');
  const fundingWarns = warningsDetail.filter(w => w.category === 'funding' || w.category === 'solver');
  const revenueWarns = warningsDetail.filter(w => w.category === 'revenue');
  const gstWarns = warningsDetail.filter(w => w.category === 'gst');
  const generalWarns = warningsDetail.filter(w => w.category === 'general');

  // S-Curve warnings — INFO (unconfigured fallback) vs WARN (empty array)
  if (sCurveWarns.length > 0) {
    sCurveWarns.forEach((w, i) => {
      const isUnconfigured = w.message.includes('falling back to even split');
      checks.push({
        id: `scurve-warn-${i}`,
        category: 'S-Curves',
        description: w.message,
        expected: 'Weights defined',
        actual: 'Using fallback',
        status: isUnconfigured ? 'INFO' : 'WARN',
        notes: isUnconfigured
          ? 'Manual S-curve has no weights configured — using even-split fallback. Configure weights in the Admin → Time Distribution tab if a custom profile is needed.'
          : 'Build S-curve array is empty — falling back to parabolic approximation. Define monthly weights in the Admin tab.',
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

  // Funding warnings — WARN by default; FAIL on solver-non-convergence (severity error)
  // B07 — guarantee a Funding row even when there are no warnings, so the
  // total-checks count doesn't silently shrink when all is well.
  if (fundingWarns.length === 0) {
    checks.push({
      id: 'funding-ok',
      category: 'Funding',
      description: 'No funding/solver warnings',
      expected: 'No warnings',
      actual: 'No warnings',
      status: 'PASS',
      notes: 'All facility covenants respected; debt solver converged within tolerance.',
    });
  } else {
    fundingWarns.forEach((w, i) => {
      const isSolverError = w.severity === 'error';
      // B08 — Prefix-aware severity. Messages prefixed with [INFO] are
      // informational notes (auto-size summaries, IPF>1 disclosure) — render
      // as INFO not WARN. The Q1 consolidator already emits auto-size with
      // this prefix; B08 also adds it to the LL IPF>1 INFO note.
      const isInfo = !isSolverError && /^\[INFO\]/.test(w.message);
      const status: CheckStatus = isSolverError ? 'FAIL' : isInfo ? 'INFO' : 'WARN';
      checks.push({
        id: `funding-warn-${i}`,
        category: 'Funding',
        description: w.message,
        expected: 'Within facility limits / converged',
        actual: 'See message',
        status,
        notes: isSolverError
          ? 'Debt solver did not converge — finance costs and facility sizes may be inaccurate.'
          : isInfo
          ? 'Informational note from the funding solver — no action required.'
          : 'Funding constraint or covenant flag from the cashflow solver.',
      });
    });
  }

  // Revenue warnings — WARN. B07 — empty case shown as PASS.
  if (revenueWarns.length === 0) {
    checks.push({
      id: 'revenue-ok',
      category: 'Revenue',
      description: 'No revenue input warnings',
      expected: 'No warnings',
      actual: 'No warnings',
      status: 'PASS',
      notes: 'All revenue items have valid timing inputs.',
    });
  } else {
    revenueWarns.forEach((w, i) => {
      checks.push({
        id: `revenue-warn-${i}`,
        category: 'Revenue',
        description: w.message,
        expected: 'Valid revenue inputs',
        actual: 'See message',
        status: 'WARN',
        notes: 'Revenue line item input ordering or span overflow.',
      });
    });
  }

  // GST warnings — WARN. B07 — empty case shown as PASS.
  if (gstWarns.length === 0) {
    checks.push({
      id: 'gst-ok',
      category: 'GST',
      description: 'No GST configuration warnings',
      expected: 'No warnings',
      actual: 'No warnings',
      status: 'PASS',
      notes: 'GST rate, supply-type routing and cost-side classification all internally consistent.',
    });
  } else {
    gstWarns.forEach((w, i) => {
      checks.push({
        id: `gst-warn-${i}`,
        category: 'GST',
        description: w.message,
        expected: 'Valid GST configuration',
        actual: 'See message',
        status: 'WARN',
        notes: 'GST configuration or supply-type routing flag.',
      });
    });
  }

  // General/uncategorised — WARN
  generalWarns.forEach((w, i) => {
    checks.push({
      id: `general-warn-${i}`,
      category: 'General',
      description: w.message,
      expected: 'No issues',
      actual: 'See message',
      status: 'WARN',
    });
  });

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
          <p><strong>Net GST Payable (Table 1, book balance):</strong> GST on Revenue − GST on Costs (ITC). The book balance from the developer's P&L view, before applying any s.14-250 withholding credit.</p>
          <p><strong>Net GST Cash to ATO (Table 13, post-withholding):</strong> Book balance − withholding-already-paid by purchaser at settlement (TAA 1953 Sch 1, s.14-250). For margin-scheme residential where withholding fully covers the supply, this can be a refund. The two tables differ by the withholding amount — both are correct in their own context.</p>
          <p><strong>Withholding (memo):</strong> Per the GST at Settlement regime, the purchaser of new residential premises (or potential residential land) withholds 1/11 of the contract price and remits direct to the ATO; the developer claims that as a BAS credit. Cashflow modelling now treats this as attribution-only — see PR #28.</p>
          <p className="text-blue-600 italic">Note: If "GST on Costs" shows $0, check that (1) gstRate &gt; 0% in Land Purchase inputs, and (2) cost items have <code>addGST = true</code>. Items saved before the addGST field was introduced may show as undefined (treated as false). Re-entering costs from the Inputs tab will fix this.</p>
        </div>
      </div>
    </div>
  );
}
