// InflationAdjustment Component
// Displays inflation adjustment visualization and calculations

function InflationAdjustment({
  quarters,
  claimInfo,
  endDate,
  priceIndexMap,
  priceIndexSeries,
  midQuarterIndexMap
}) {
  // Use utilities from global scope
  const { getQuarterInfo, formatCurrency } = window.utils;
  const [show, setShow] = React.useState(true);

  return (
    <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-orange-900">Inflation Adjustment</div>
        <button
          onClick={() => setShow(!show)}
          className="text-xs px-3 py-1 bg-orange-200 hover:bg-orange-300 rounded-full transition-colors"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {show && (
        <>
          <div className="text-sm text-orange-800 mb-3">
            We typically make all the monetary values be in terms of today's money, or at least in terms of the currency's worth at the final quarter in the dataset.
          </div>
          <div className="text-sm text-orange-800 mb-3">
            Because quarterly aggregation loses exact payment dates, we assume payments occur at the <strong>middle</strong> of each quarter.
            The index we use at mid‑quarter is the geometric mean of neighbouring end‑of‑quarter indices:
            <span className="ml-1 font-mono bg-orange-100 px-1 rounded">PI<sub>mid</sub>(q) = √[ PI<sub>eoq</sub>(q−1) · PI<sub>eoq</sub>(q) ]</span>.
            The adjustment becomes <span className="font-mono bg-orange-100 px-1 rounded">AdjFactor(q) = PI<sub>eoq</sub>(target) / PI<sub>mid</sub>(q)</span>.
          </div>

          {/* Price Index chart: plot end-of-quarter (line) and mid-quarter (dots) */}
          <div className="bg-white rounded border p-3 mb-4">
            <div className="text-xs font-medium text-gray-700 mb-2">Price Index (End-of-Quarter vs Mid-Quarter)</div>
            {(() => {
              if (!priceIndexSeries || priceIndexSeries.length === 0) return <div className="text-xs text-gray-500">No index data.</div>;
              const w = 720, h = 180, pad = 32;
              const xs = priceIndexSeries.map(p => p.index);
              // Build mid series from map
              const midMap = midQuarterIndexMap || {};
              const midSeries = priceIndexSeries.map(p => ({ quarterKey: p.quarterKey, index: midMap[p.quarterKey] || p.index }));

              const minY = Math.min(Math.min(...xs), Math.min(...midSeries.map(p => p.index))) * 0.98;
              const maxY = Math.max(Math.max(...xs), Math.max(...midSeries.map(p => p.index))) * 1.02;
              const n = priceIndexSeries.length;
              const xScale = (i) => pad + (i / (n - 1)) * (w - 2 * pad);
              const yScale = (v) => h - pad - ((v - minY) / (maxY - minY)) * (h - 2 * pad);
              const linePath = priceIndexSeries.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.index)}`).join(' ');

              return (
                <svg width="100%" viewBox={`0 0 ${w} ${h}`}>
                  <rect x="0" y="0" width={w} height={h} fill="#ffffff" />
                  {/* EoQ line */}
                  <path d={linePath} fill="none" stroke="#f59e0b" strokeWidth="2" />
                  {/* Mid-quarter dots */}
                  {midSeries.map((p, i) => (
                    <circle key={i} cx={xScale(i)} cy={yScale(p.index)} r="2.5" fill="#1d4ed8" />
                  ))}
                  {/* axes */}
                  <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#e5e7eb" />
                  <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#e5e7eb" />
                  {/* labels */}
                  <text x={pad} y={pad - 8} fontSize="10" fill="#6b7280">Index</text>
                  <text x={pad} y={h - 8} fontSize="10" fill="#6b7280">{priceIndexSeries[0].quarterKey}</text>
                  <text x={w - pad} y={h - 8} fontSize="10" textAnchor="end" fill="#6b7280">{priceIndexSeries[priceIndexSeries.length - 1].quarterKey}</text>
                  <text x={w - pad} y={pad} fontSize="10" textAnchor="end" fill="#6b7280">Orange: EoQ line • Blue: Mid‑Q</text>
                </svg>
              )
            })()}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Index values & factors for used quarters */}
            <div>
              <div className="text-xs font-medium text-orange-800 mb-2">Adjusting payments for inflation</div>
              <div className="bg-white rounded border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Source Quarter</th>
                      <th className="px-2 py-1 text-right font-medium">PI<sub>eoq</sub>(source)</th>
                      <th className="px-2 py-1 text-right font-medium">PI<sub>mid</sub>(source)</th>
                      <th className="px-2 py-1 text-left font-medium">Target Quarter</th>
                      <th className="px-2 py-1 text-right font-medium">PI<sub>eoq</sub>(target)</th>
                      <th className="px-2 py-1 text-right font-medium">Adj Factor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const usedQs = [...new Set(quarters.map(q => q.quarterKey))].sort();
                      const targetQuarterKey = getQuarterInfo(endDate, claimInfo.accidentDate).quarterKey;
                      const targetPI = priceIndexMap ? priceIndexMap[targetQuarterKey] : null;
                      return usedQs.map((qk, i) => {
                        const srcPI_eoq = priceIndexMap ? priceIndexMap[qk] : null;
                        const srcPI_mid = (midQuarterIndexMap && midQuarterIndexMap[qk]) ? midQuarterIndexMap[qk] : srcPI_eoq;
                        const factor = (srcPI_mid && targetPI) ? (targetPI / srcPI_mid) : 1.0;
                        return (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-2 py-1 font-mono">{qk}</td>
                            <td className="px-2 py-1 text-right font-mono">{srcPI_eoq ? srcPI_eoq.toFixed(2) : '-'}</td>
                            <td className="px-2 py-1 text-right font-mono">{srcPI_mid ? srcPI_mid.toFixed(2) : '-'}</td>
                            <td className="px-2 py-1 font-mono">{targetQuarterKey}</td>
                            <td className="px-2 py-1 text-right font-mono">{targetPI ? targetPI.toFixed(2) : '-'}</td>
                            <td className="px-2 py-1 text-right font-mono">{factor.toFixed(4)}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Quarter-level Adjustments Table (uses mid-quarter) */}
            <div>
              <div className="text-xs font-medium text-orange-800 mb-2">Quarter-Level Adjustments</div>
              <div className="bg-white rounded border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Dev Quarter</th>
                      <th className="px-3 py-2 text-left font-medium">Calendar Quarter</th>
                      <th className="px-3 py-2 text-right font-medium">Nominal Sum</th>
                      <th className="px-3 py-2 text-right font-medium">Adj Factor</th>
                      <th className="px-3 py-2 text-right font-medium">Adjusted Sum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarters.map((quarter, i) => {
                      const calendarQuarterKey = quarter.quarterKey;
                      const targetQuarterKey = getQuarterInfo(endDate, claimInfo.accidentDate).quarterKey;
                      const targetPI = priceIndexMap ? priceIndexMap[targetQuarterKey] : null;
                      const srcPI_mid = (midQuarterIndexMap && midQuarterIndexMap[calendarQuarterKey]) ? midQuarterIndexMap[calendarQuarterKey] : (priceIndexMap ? priceIndexMap[calendarQuarterKey] : null);
                      const displayFactor = (srcPI_mid && targetPI) ? (targetPI / srcPI_mid) : 1.0;
                      const adjustedSum = (quarter.nominalAmount || quarter.totalAmount) * displayFactor;

                      if (quarter.paymentCount === 0) {
                        return (
                          <tr key={i} className="border-t border-gray-100 opacity-60">
                            <td className="px-3 py-2 font-mono">Dev Q{quarter.developmentQuarter}</td>
                            <td className="px-3 py-2 font-mono">{calendarQuarterKey}</td>
                            <td className="px-3 py-2 text-right font-medium">{formatCurrency(quarter.nominalAmount)}</td>
                            <td className="px-3 py-2 text-right text-gray-600 font-mono">-</td>
                            <td className="px-3 py-2 text-right font-medium text-orange-700">{formatCurrency(quarter.nominalAmount)}</td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-mono">Dev Q{quarter.developmentQuarter}</td>
                          <td className="px-3 py-2 font-mono">{calendarQuarterKey}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(quarter.nominalAmount)}</td>
                          <td className="px-3 py-2 text-right text-gray-600 font-mono">{displayFactor.toFixed(4)}</td>
                          <td className="px-3 py-2 text-right font-medium text-orange-700">{formatCurrency(adjustedSum)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-orange-100 border border-orange-300 rounded text-sm text-orange-900">
            <strong>Note:</strong> From this point forward, all dollar amounts are inflation-adjusted to {getQuarterInfo(endDate, claimInfo.accidentDate).quarterKey}. 
            The nominal (unadjusted) values are discarded and no longer displayed.
          </div>
        </>
      )}
    </div>
  );
}

// Make the component globally available
window.InflationAdjustment = InflationAdjustment;
