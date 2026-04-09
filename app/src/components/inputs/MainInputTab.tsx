import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { CurrencyInput, PercentInput, NumberInput, SectionHeader } from '../common/FormFields';
import { FinancingInputs } from './FinancingInputs';
import { formatCurrency } from '../../utils';
import type { CostLineItem, RevenueLineItem } from '../../types';

function CostLineTable({ items, onChange }: {
  items: CostLineItem[];
  onChange: (items: CostLineItem[]) => void;
}) {
  const updateItem = (idx: number, field: keyof CostLineItem, value: any) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    if (field === 'units' || field === 'baseRate') {
      updated[idx].totalCosts = updated[idx].units * updated[idx].baseRate;
    }
    onChange(updated);
  };

  const total = items.reduce((s, i) => s + i.totalCosts, 0);

  return (
    <div className="mb-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-600 text-white">
              <th className="px-2 py-1 text-left w-16">Code</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-right w-24">Units</th>
              <th className="px-2 py-1 text-right w-28">Rate/Unit</th>
              <th className="px-2 py-1 text-right w-32">Total Costs</th>
              <th className="px-2 py-1 text-left w-32">S-Curve</th>
              <th className="px-2 py-1 text-right w-16">Start</th>
              <th className="px-2 py-1 text-right w-16">Span</th>
              <th className="px-2 py-1 text-center w-14">GST</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.code} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                <td className="px-2 py-0.5 text-gray-500">{item.code}</td>
                <td className="px-2 py-0.5">
                  <input
                    type="text" value={item.description}
                    onChange={e => updateItem(idx, 'description', e.target.value)}
                    className="w-full bg-transparent text-xs border-0 p-0 focus:ring-0"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="number" value={item.units} step="1"
                    onChange={e => updateItem(idx, 'units', parseFloat(e.target.value) || 0)}
                    className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="text" value={item.baseRate.toLocaleString('en-AU')}
                    onChange={e => updateItem(idx, 'baseRate', parseFloat(e.target.value.replace(/[^0-9.-]/g, '')) || 0)}
                    className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  />
                </td>
                <td className="px-2 py-0.5 text-right font-mono">{formatCurrency(item.totalCosts)}</td>
                <td className="px-1 py-0.5">
                  <select
                    value={item.sCurve}
                    onChange={e => updateItem(idx, 'sCurve', e.target.value)}
                    className="w-full text-[10px] bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  >
                    <option value="Evenly Split">Evenly Split</option>
                    <option value="Manual S-curve 1">Manual S-curve 1</option>
                    {Array.from({ length: 49 }, (_, i) => (
                      <option key={i} value={`${i + 12} Month Build`}>{i + 12} Month Build</option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="number" value={item.monthStart}
                    onChange={e => updateItem(idx, 'monthStart', parseInt(e.target.value) || 0)}
                    className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    type="number" value={item.monthSpan}
                    onChange={e => updateItem(idx, 'monthSpan', parseInt(e.target.value) || 0)}
                    className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                  />
                </td>
                <td className="px-2 py-0.5 text-center">
                  <input
                    type="checkbox" checked={item.addGST}
                    onChange={e => updateItem(idx, 'addGST', e.target.checked)}
                    className="w-3 h-3"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
              <td colSpan={4} className="px-2 py-1">Total</td>
              <td className="px-2 py-1 text-right font-mono">{formatCurrency(total)}</td>
              <td colSpan={4}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function GRVTable({ items, onChange }: {
  items: RevenueLineItem[];
  onChange: (items: RevenueLineItem[]) => void;
}) {
  const updateItem = (idx: number, field: keyof RevenueLineItem, value: any) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange(updated);
  };

  const total = items.reduce((s, i) => s + i.currentSalePrice, 0);

  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-green-700 text-white">
            <th className="px-2 py-1 text-left w-16">Code</th>
            <th className="px-2 py-1 text-left">Description</th>
            <th className="px-2 py-1 text-left w-28">Type</th>
            <th className="px-2 py-1 text-right w-36">Sale Price</th>
            <th className="px-2 py-1 text-right w-16">Pre-Sale</th>
            <th className="px-2 py-1 text-right w-16">Span</th>
            <th className="px-2 py-1 text-right w-16">Settle</th>
            <th className="px-2 py-1 text-right w-16">Span</th>
            <th className="px-2 py-1 text-center w-14">GST</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={item.code} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
              <td className="px-2 py-0.5 text-gray-500">{item.code}</td>
              <td className="px-2 py-0.5">{item.description}</td>
              <td className="px-2 py-0.5 text-[10px] text-gray-500">{item.revenueType}</td>
              <td className="px-1 py-0.5">
                <input
                  type="text" value={item.currentSalePrice.toLocaleString('en-AU')}
                  onChange={e => updateItem(idx, 'currentSalePrice', parseFloat(e.target.value.replace(/[^0-9.-]/g, '')) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" value={item.preSaleExchangeMonth}
                  onChange={e => updateItem(idx, 'preSaleExchangeMonth', parseInt(e.target.value) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" value={item.preSaleSpan}
                  onChange={e => updateItem(idx, 'preSaleSpan', parseInt(e.target.value) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" value={item.settlementMonth}
                  onChange={e => updateItem(idx, 'settlementMonth', parseInt(e.target.value) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-1 py-0.5">
                <input type="number" value={item.settlementSpan}
                  onChange={e => updateItem(idx, 'settlementSpan', parseInt(e.target.value) || 0)}
                  className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                />
              </td>
              <td className="px-2 py-0.5 text-center">
                <input type="checkbox" checked={item.gstIncluded}
                  onChange={e => updateItem(idx, 'gstIncluded', e.target.checked)}
                  className="w-3 h-3"
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
            <td colSpan={3} className="px-2 py-1">Total GRV</td>
            <td className="px-2 py-1 text-right font-mono">{formatCurrency(total)}</td>
            <td colSpan={5}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function MainInputTab() {
  const { inputs, setInputs } = useStore();
  const [section, setSection] = useState<string>('preliminary');

  const sections = [
    { id: 'preliminary', label: '1. General' },
    { id: 'land', label: '2.1 Land' },
    { id: 'devCosts', label: '2.2 Dev Costs' },
    { id: 'construction', label: '2.3 Construction' },
    { id: 'marketing', label: '2.4 Marketing' },
    { id: 'otherCosts', label: '2.5 Other Costs' },
    { id: 'pmFees', label: '2.6 PM Fees' },
    { id: 'selling', label: '2.7 Selling' },
    { id: 'grv', label: '3.1 GRV' },
    { id: 'financing', label: '4. Financing' },
    { id: 'otherFin', label: '4.3 Other Fin' },
  ];

  return (
    <div>
      {/* Section navigation */}
      <div className="flex flex-wrap gap-1 mb-4 bg-gray-100 p-2 rounded">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
              section === s.id
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Preliminary */}
      {section === 'preliminary' && (
        <div>
          <SectionHeader number="1.1" title="Preliminary" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4 space-y-1.5">
            <NumberInput label="Project Lots #" value={inputs.preliminary.projectLots}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, projectLots: v } })} />
            <NumberInput label="Project GFA SqM" value={inputs.preliminary.projectGFA}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, projectGFA: v } })} />
            <NumberInput label="Site Area SqM" value={inputs.preliminary.siteArea}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, siteArea: v } })} />
            <NumberInput label="Project Start Month" value={inputs.preliminary.projectStartMonth}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, projectStartMonth: v } })} />
            <NumberInput label="Project Duration (months)" value={inputs.preliminary.projectSpanMonths}
              onChange={v => setInputs({ preliminary: { ...inputs.preliminary, projectSpanMonths: v } })} />
          </div>
        </div>
      )}

      {/* Land */}
      {section === 'land' && (
        <div>
          <SectionHeader number="2.1" title="Land Purchase, PRSV & Acquisition Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-4 space-y-1.5">
            <CurrencyInput label="Land Purchase Price" value={inputs.landPurchase.landPurchasePrice}
              onChange={v => setInputs({ landPurchase: { ...inputs.landPurchase, landPurchasePrice: v } })} />
            <CurrencyInput label="PRSV Uplift" value={inputs.landPurchase.prsvUplift}
              onChange={v => setInputs({ landPurchase: { ...inputs.landPurchase, prsvUplift: v } })} />
            <PercentInput label="GST Rate" value={inputs.landPurchase.gstRate}
              onChange={v => setInputs({ landPurchase: { ...inputs.landPurchase, gstRate: v } })} />
            <CurrencyInput label="Stamp Duty" value={inputs.landPurchase.stampDutyAmount}
              onChange={v => setInputs({ landPurchase: { ...inputs.landPurchase, stampDutyAmount: v } })} />
          </div>
        </div>
      )}

      {/* Development Costs */}
      {section === 'devCosts' && (
        <div>
          <SectionHeader number="2.2" title="Development Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.developmentCosts}
              onChange={items => setInputs({ developmentCosts: items })} />
          </div>
        </div>
      )}

      {/* Construction */}
      {section === 'construction' && (
        <div>
          <SectionHeader number="2.3" title="Total Construction Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.constructionCosts}
              onChange={items => setInputs({ constructionCosts: items })} />
            <PercentInput label="Construction Contingency %" value={inputs.constructionContingencyPercent}
              onChange={v => setInputs({ constructionContingencyPercent: v })} />
          </div>
        </div>
      )}

      {/* Marketing */}
      {section === 'marketing' && (
        <div>
          <SectionHeader number="2.4" title="Marketing & Advertising" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.marketingCosts}
              onChange={items => setInputs({ marketingCosts: items })} />
          </div>
        </div>
      )}

      {/* Other Standard Costs */}
      {section === 'otherCosts' && (
        <div>
          <SectionHeader number="2.5" title="Other Standard Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.otherStandardCosts}
              onChange={items => setInputs({ otherStandardCosts: items })} />
          </div>
        </div>
      )}

      {/* PM Fees */}
      {section === 'pmFees' && (
        <div>
          <SectionHeader number="2.6" title="Development & Project Management Fees" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.pmFees}
              onChange={items => setInputs({ pmFees: items })} />
          </div>
        </div>
      )}

      {/* Selling */}
      {section === 'selling' && (
        <div>
          <SectionHeader number="2.7" title="Selling & Leasing Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse mb-3">
                <thead>
                  <tr className="bg-gray-600 text-white">
                    <th className="px-2 py-1 text-left">Description</th>
                    <th className="px-2 py-1 text-right w-24">Commission %</th>
                    <th className="px-2 py-1 text-right w-24">Pre-Sale %</th>
                    <th className="px-2 py-1 text-right w-24">Deposit %</th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.sellingCosts.map((sc, idx) => (
                    <tr key={sc.code} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-0.5">{sc.description}</td>
                      <td className="px-1 py-0.5">
                        <input type="text" value={(sc.salesCommission * 100).toFixed(4)}
                          onChange={e => {
                            const updated = [...inputs.sellingCosts];
                            updated[idx] = { ...updated[idx], salesCommission: parseFloat(e.target.value) / 100 || 0 };
                            setInputs({ sellingCosts: updated });
                          }}
                          className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <input type="text" value={(sc.preCommissionPercent * 100).toFixed(1)}
                          onChange={e => {
                            const updated = [...inputs.sellingCosts];
                            updated[idx] = { ...updated[idx], preCommissionPercent: parseFloat(e.target.value) / 100 || 0 };
                            setInputs({ sellingCosts: updated });
                          }}
                          className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-1 py-0.5">
                        <input type="text" value={(sc.depositPercent * 100).toFixed(1)}
                          onChange={e => {
                            const updated = [...inputs.sellingCosts];
                            updated[idx] = { ...updated[idx], depositPercent: parseFloat(e.target.value) / 100 || 0 };
                            setInputs({ sellingCosts: updated });
                          }}
                          className="w-full text-xs text-right bg-yellow-50 border border-gray-200 rounded px-1 py-0.5"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* GRV */}
      {section === 'grv' && (
        <div>
          <SectionHeader number="3.1" title="Gross Realisable Value (GRV)" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <GRVTable items={inputs.grvItems}
              onChange={items => setInputs({ grvItems: items })} />
          </div>
        </div>
      )}

      {/* Financing */}
      {section === 'financing' && <FinancingInputs />}

      {/* Other Financing Costs */}
      {section === 'otherFin' && (
        <div>
          <SectionHeader number="4.3" title="Other Financing Costs" />
          <div className="bg-white border border-t-0 border-gray-200 rounded-b p-3">
            <CostLineTable items={inputs.otherFinancingCosts}
              onChange={items => setInputs({ otherFinancingCosts: items })} />
          </div>
        </div>
      )}
    </div>
  );
}
