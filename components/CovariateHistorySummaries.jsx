// CovariateHistorySummaries.jsx
// Summarises covariate histories as-of a chosen development quarter:
//  • Near-static (latest non-missing up to cutoff)
//  • Time-series (mean, max, sd, sum, last up to cutoff)
// Also shows compact visualizations making the cutoff explicit.

function CovariateHistorySummaries({
  claimData,
  endDate,
  priceIndexMap,
  midQuarterIndexMap,
  oneBasedDevQuarters
}) {
  const { getQuarterInfo, formatCurrency } = window.utils || {};
  const [show, setShow] = React.useState(true);

  if (!claimData || !claimData.quarters || !Array.isArray(claimData.quarters) || !getQuarterInfo) {
    return null;
  }

  const { claimInfo, quarters } = claimData;

  // Sort and index quarters
  const qSorted = React.useMemo(
    () => [...quarters].sort((a, b) => a.developmentQuarter - b.developmentQuarter),
    [quarters]
  );

  const devQs = qSorted.map(q => q.developmentQuarter);
  const minDevQ = Math.min(...devQs);
  const maxDevQ = Math.max(...devQs);

  // Map devQ -> quarter object (assume at most one per dev quarter after aggregation)
  const byDev = React.useMemo(
    () => Object.fromEntries(qSorted.map(q => [q.developmentQuarter, q])),
    [qSorted]
  );

  // Initial cutoff: latest observed dev quarter
  const [cutoffDevQ, setCutoffDevQ] = React.useState(maxDevQ);

  // Little helpers
  const dispQ = (dq) => oneBasedDevQuarters ? dq + 1 : dq;
  const toRange = (start, end) =>
    Array.from({ length: end - start + 1 }, (_, i) => start + i);

  // ---- Near-static covariates (example histories) --------------------------
  // Postcode: known from notification onward (illustrative)
  const notifyDevQ = getQuarterInfo(claimInfo.notifyDate, claimInfo.accidentDate).developmentQuarter;
  const postcodeKnownFrom = Math.max(minDevQ, notifyDevQ);

  // Legal representation: an illustrative "nearly-static" covariate
  // For demo purposes, make it become known a couple of dev quarters after notification.
  const legalRepKnownFrom = Math.min(maxDevQ, postcodeKnownFrom + 2);

  const devRange = toRange(minDevQ, maxDevQ);
  const postcodeHistory = devRange.map(dq => (dq < postcodeKnownFrom ? null : claimInfo.postcode));
  const legalRepHistory = devRange.map(dq => (dq < legalRepKnownFrom ? null : 'Yes'));

  const latestNonMissing = (hist, uptoIdx) => {
    for (let i = Math.min(uptoIdx, hist.length - 1); i >= 0; i--) {
      if (hist[i] !== null && hist[i] !== undefined) return hist[i];
    }
    return null;
  };

  const cutoffIndex = Math.max(0, Math.min(devRange.length - 1, cutoffDevQ - minDevQ));

  const postcodeLatest = latestNonMissing(postcodeHistory, cutoffIndex);
  const legalRepLatest = latestNonMissing(legalRepHistory, cutoffIndex);

  // ---- Time-series covariates ---------------------------------------------
  // Incremental paid per dev quarter (nominal)
  const increments = devRange.map(dq => {
    const q = byDev[dq];
    const v = q ? (q.nominalAmount ?? q.totalAmount ?? 0) : 0;
    return isFinite(v) ? v : 0;
  });

  // Cumulative paid to date (nominal)
  const cumulative = (() => {
    const out = [];
    let s = 0;
    for (let i = 0; i < increments.length; i++) {
      s += increments[i];
      out.push(s);
    }
    return out;
  })();

  // Estimated remaining (inflation-adjusted to observation quarter), per dev quarter
  const adjustedIncrements = (() => {
    // Build adjustment factors using mid-quarter index if present, otherwise EoQ
    const obsQ = getQuarterInfo(endDate, claimInfo.accidentDate);
    const targetPI = priceIndexMap ? priceIndexMap[obsQ.quarterKey] : null;
    const midMap = midQuarterIndexMap || {};
    return devRange.map((dq) => {
      const q = byDev[dq];
      const nominal = q ? (q.nominalAmount ?? q.totalAmount ?? 0) : 0;
      const srcPI = q
        ? (midMap[q.quarterKey] || (priceIndexMap ? priceIndexMap[q.quarterKey] : null))
        : null;
      const factor = (srcPI && targetPI) ? (targetPI / srcPI) : 1.0;
      return nominal * factor;
    });
  })();

  const cumulativeAdj = (() => {
    const out = [];
    let s = 0;
    for (let i = 0; i < adjustedIncrements.length; i++) {
      s += adjustedIncrements[i];
      out.push(s);
    }
    return out;
  })();

  const ultimateAdj = cumulativeAdj[cumulativeAdj.length - 1] || 0;
  const remainingAdj = cumulativeAdj.map(c => Math.max(0, ultimateAdj - c));

  // Summary stats up to cutoff
  const statsUpTo = (arr, endIdx) => {
    const n = Math.max(0, endIdx + 1);
    if (n === 0) return { n: 0, sum: 0, mean: 0, max: 0, sd: 0, last: 0 };
    let sum = 0, max = -Infinity;
    for (let i = 0; i <= endIdx; i++) {
      const v = arr[i] ?? 0;
      sum += v;
      if (v > max) max = v;
    }
    const mean = sum / n;
    let varSum = 0;
    for (let i = 0; i <= endIdx; i++) {
      const v = arr[i] ?? 0;
      varSum += (v - mean) * (v - mean);
    }
    const sd = n > 1 ? Math.sqrt(varSum / (n - 1)) : 0;
    const last = arr[endIdx] ?? 0;
    return { n, sum, mean, max: isFinite(max) ? max : 0, sd, last };
  };

  const incStats = statsUpTo(adjustedIncrements, cutoffIndex);
  const cumStats = statsUpTo(cumulativeAdj, cutoffIndex);  // we will use 'last' for cum
  const remStats = statsUpTo(remainingAdj, cutoffIndex); // we will use 'last' for remaining

  // For labels/tooltips
  const cutoffQuarterKey = byDev[cutoffDevQ]?.quarterKey;
  const earliestQuarterKey = byDev[minDevQ]?.quarterKey;
  const latestQuarterKey = byDev[maxDevQ]?.quarterKey;

  // ---- Small visualization helpers ----------------------------------------
  const BarSpark = ({ values, cutoffIdx, height = 36 }) => {
    const n = values.length || 1;
    const maxV = Math.max(...values, 1);
    const w = 2 + n * 10; // 10px per bar + margins
    const pad = 4;
    const barW = Math.max(6, (w - 2 * pad) / n - 2);
    const x = (i) => pad + i * (barW + 2);
    const y = (v) => (height - pad) - (v / maxV) * (height - 2 * pad);
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${height}`} className="bg-white rounded border">
        <rect x="0" y="0" width={w} height={height} fill="#ffffff" />
        {values.map((v, i) => (
          <g key={i} title={`Dev Q${dispQ(devRange[i])}: ${formatCurrency ? formatCurrency(v) : v.toFixed(2)}`}>
            <rect
              x={x(i)}
              y={y(v)}
              width={barW}
              height={Math.max(0, height - pad - y(v))}
              rx="2"
              fill={i <= cutoffIdx ? "#93c5fd" : "#e5e7eb"}
              stroke={i <= cutoffIdx ? "#3b82f6" : "#9ca3af"}
              strokeWidth="0.5"
            />
          </g>
        ))}
        {/* Cutoff marker */}
        <line
          x1={x(cutoffIdx) + barW + 1}
          y1={pad}
          x2={x(cutoffIdx) + barW + 1}
          y2={height - pad}
          stroke="#dc2626"
          strokeWidth="1"
        />
      </svg>
    );
  };

  const LineSpark = ({ values, cutoffIdx, height = 36 }) => {
    const n = values.length || 1;
    const w = 2 + n * 10;
    const pad = 4;
    const maxV = Math.max(...values, 1);
    const minV = Math.min(...values, 0);
    const x = (i) => pad + i * ((w - 2 * pad) / Math.max(1, n - 1));
    const y = (v) => (height - pad) - ((v - minV) / Math.max(1e-9, (maxV - minV))) * (height - 2 * pad);
    const pathFull = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
    const pathObs = values.slice(0, cutoffIdx + 1).map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${height}`} className="bg-white rounded border">
        <rect x="0" y="0" width={w} height={height} fill="#ffffff" />
        {/* full series in light gray */}
        <path d={pathFull} fill="none" stroke="#e5e7eb" strokeWidth="1" />
        {/* observed-to-cutoff in blue */}
        <path d={pathObs} fill="none" stroke="#3b82f6" strokeWidth="1" />
        {/* Cutoff marker */}
        <line
          x1={x(cutoffIdx)}
          y1={pad}
          x2={x(cutoffIdx)}
          y2={height - pad}
          stroke="#dc2626"
          strokeWidth="1"
        />
      </svg>
    );
  };

  return (
    <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-indigo-900">Feature Summarisation (as‑of development cutoff)</div>
        <button
          onClick={() => setShow(!show)}
          className="text-xs px-3 py-1 bg-indigo-200 hover:bg-indigo-300 rounded-full transition-colors"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>

      {show && (
        <>
          {/* Control row */}
          <div className="bg-white rounded border p-3 mb-4">
            <div className="flex flex-col md:flex-row md:items-center md:gap-4">
              <div className="text-xs font-medium text-gray-700 mb-2 md:mb-0">
                Choose development cutoff:
              </div>
              <div className="flex-1 flex items-center gap-3">
                <span className="text-xs text-gray-600 font-mono">Dev Q{dispQ(minDevQ)}</span>
                <input
                  type="range"
                  min={minDevQ}
                  max={maxDevQ}
                  value={cutoffDevQ}
                  onChange={(e) => setCutoffDevQ(parseInt(e.target.value, 10))}
                  className="w-full"
                />
                <span className="text-xs text-gray-600 font-mono">Dev Q{dispQ(maxDevQ)}</span>
              </div>
              <div className="text-xs text-gray-700">
                <span className="font-mono bg-indigo-100 px-1 rounded mr-1">Cutoff: Dev Q{dispQ(cutoffDevQ)}</span>
                <span className="font-mono bg-gray-100 px-1 rounded">{cutoffQuarterKey || '-'}</span>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Near-static summarisation */}
            <div className="bg-white rounded border p-3">
              <div className="text-xs font-medium text-gray-700 mb-2">Near‑Static Covariates (latest up to cutoff)</div>

              <div className="text-xs text-gray-600 mb-2">
                Example histories (for demo): postcode becomes known from notification; legal representation becomes known later.
              </div>

              {/* Small per-quarter table */}
              <div className="overflow-auto border rounded mb-3">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium">Dev Q</th>
                      <th className="px-2 py-2 text-left font-medium">Calendar Q</th>
                      <th className="px-2 py-2 text-left font-medium">Postcode</th>
                      <th className="px-2 py-2 text-left font-medium">Legal Rep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devRange.map((dq, i) => {
                      const q = byDev[dq];
                      const pastCut = dq > cutoffDevQ;
                      return (
                        <tr key={dq} className={`border-t ${pastCut ? 'opacity-50' : ''}`}>
                          <td className="px-2 py-2 font-mono">Q{dispQ(dq)}</td>
                          <td className="px-2 py-2 font-mono">{q ? q.quarterKey : '-'}</td>
                          <td className="px-2 py-2 font-mono">{postcodeHistory[i] ?? 'NA'}</td>
                          <td className="px-2 py-2 font-mono">{legalRepHistory[i] ?? 'NA'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Summarised values as-of cutoff */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-indigo-50 border border-indigo-100 rounded p-2 text-xs">
                  <div className="text-gray-600">Most recent Postcode</div>
                  <div className="font-mono text-indigo-900 text-sm">
                    {postcodeLatest ?? 'NA'}
                  </div>
                </div>
                <div className="bg-indigo-50 border border-indigo-100 rounded p-2 text-xs">
                  <div className="text-gray-600">Claimant has legal representation</div>
                  <div className="font-mono text-indigo-900 text-sm">
                    {legalRepLatest ?? 'NA'}
                  </div>
                </div>
              </div>
            </div>

            {/* Time-series summarisation */}
            <div className="bg-white rounded border p-3">
              <div className="text-xs font-medium text-gray-700 mb-2">Time‑Series Covariates (summary up to cutoff)</div>

              <div className="space-y-3">
                {/* Incremental payments */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-gray-600">Incremental payments (inflation-adjusted)</div>
                  </div>
                  <BarSpark values={adjustedIncrements} cutoffIdx={cutoffIndex} />
                  <div className="grid grid-cols-4 gap-2 mt-2 text-xs">
                    <div className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-600">Mean</div>
                      <div className="font-medium">{formatCurrency ? formatCurrency(incStats.mean) : incStats.mean.toFixed(2)}</div>
                    </div>
                    <div className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-600">Max</div>
                      <div className="font-medium">{formatCurrency ? formatCurrency(incStats.max) : incStats.max.toFixed(2)}</div>
                    </div>
                    <div className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-600">SD</div>
                      <div className="font-medium">{formatCurrency ? formatCurrency(incStats.sd) : incStats.sd.toFixed(2)}</div>
                    </div>
                    <div className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-600">Sum</div>
                      <div className="font-medium">{formatCurrency ? formatCurrency(incStats.sum) : incStats.sum.toFixed(2)}</div>
                    </div>
                  </div>
                </div>

                {/* Cumulative paid */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-gray-600">Cumulative paid to date (inflation-adjusted)</div>
                  </div>
                  <LineSpark values={cumulativeAdj} cutoffIdx={cutoffIndex} />
                  <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                    <div className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-600">Last (as‑of cutoff)</div>
                      <div className="font-medium">{formatCurrency ? formatCurrency(cumStats.last) : cumStats.last.toFixed(2)}</div>
                    </div>
                    <div className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-600">Min/Max (to cutoff)</div>
                      <div className="font-medium">
                        {formatCurrency ? formatCurrency(Math.min(...cumulativeAdj.slice(0, cutoffIndex + 1))) : Math.min(...cumulativeAdj.slice(0, cutoffIndex + 1)).toFixed(2)}
                        {' '}–{' '}
                        {formatCurrency ? formatCurrency(Math.max(...cumulativeAdj.slice(0, cutoffIndex + 1))) : Math.max(...cumulativeAdj.slice(0, cutoffIndex + 1)).toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-600"># Quarters</div>
                      <div className="font-medium">{incStats.n}</div>
                    </div>
                  </div>
                </div>

                {/* Estimated remaining (adjusted) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-gray-600">
                      Estimated remaining (inflation‑adjusted to {getQuarterInfo(endDate, claimInfo.accidentDate).quarterKey})
                    </div>
                  </div>
                  <LineSpark values={remainingAdj} cutoffIdx={cutoffIndex} />
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-600">Last (as‑of cutoff)</div>
                      <div className="font-medium text-red-700">
                        {formatCurrency ? formatCurrency(remStats.last) : remStats.last.toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-gray-50 border rounded p-2">
                      <div className="text-gray-600">Ultimate (adj)</div>
                      <div className="font-medium">{formatCurrency ? formatCurrency(ultimateAdj) : ultimateAdj.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Final "features as-of cutoff" table */}
          <div className="bg-white rounded border p-3 mt-4">
            <div className="text-xs font-medium text-gray-700 mb-2">Training Features (as‑of Dev Q{dispQ(cutoffDevQ)})</div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Feature</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-left font-medium">Rule</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-3 py-2 font-mono">postcode_latest</td>
                    <td className="px-3 py-2">Near‑static</td>
                    <td className="px-3 py-2">Latest non‑missing ≤ cutoff</td>
                    <td className="px-3 py-2 text-right font-mono">{postcodeLatest ?? 'NA'}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-3 py-2 font-mono">legal_rep_latest</td>
                    <td className="px-3 py-2">Near‑static</td>
                    <td className="px-3 py-2">Latest non‑missing ≤ cutoff</td>
                    <td className="px-3 py-2 text-right font-mono">{legalRepLatest ?? 'NA'}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-3 py-2 font-mono">inc_paid_mean_q1..k</td>
                    <td className="px-3 py-2">Time‑series</td>
                    <td className="px-3 py-2">Mean of increments ≤ cutoff</td>
                    <td className="px-3 py-2 text-right">{formatCurrency ? formatCurrency(incStats.mean) : incStats.mean.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-3 py-2 font-mono">inc_paid_max_q1..k</td>
                    <td className="px-3 py-2">Time‑series</td>
                    <td className="px-3 py-2">Max of increments ≤ cutoff</td>
                    <td className="px-3 py-2 text-right">{formatCurrency ? formatCurrency(incStats.max) : incStats.max.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-3 py-2 font-mono">inc_paid_sd_q1..k</td>
                    <td className="px-3 py-2">Time‑series</td>
                    <td className="px-3 py-2">Std dev of increments ≤ cutoff</td>
                    <td className="px-3 py-2 text-right">{formatCurrency ? formatCurrency(incStats.sd) : incStats.sd.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-3 py-2 font-mono">cum_paid_last_qk</td>
                    <td className="px-3 py-2">Time‑series</td>
                    <td className="px-3 py-2">Last observed ≤ cutoff</td>
                    <td className="px-3 py-2 text-right">{formatCurrency ? formatCurrency(cumStats.last) : cumStats.last.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-3 py-2 font-mono">est_remaining_last_qk</td>
                    <td className="px-3 py-2">Time‑series (adj.)</td>
                    <td className="px-3 py-2">Last observed ≤ cutoff</td>
                    <td className="px-3 py-2 text-right text-red-700">{formatCurrency ? formatCurrency(remStats.last) : remStats.last.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-600 mt-2">
              <strong>Note:</strong> Incremental and cumulative values above are nominal; the estimated remaining uses
              inflation‑adjusted amounts consistent with your earlier steps.
            </div>
          </div>

          {/* Tiny legend */}
          <div className="text-[11px] text-gray-600 mt-3">
            Blue = used up to cutoff; gray = future (excluded). Red vertical line marks the cutoff dev quarter.
          </div>
          <div className="text-[11px] text-gray-600">
            Earliest quarter: <span className="font-mono">{earliestQuarterKey}</span> • Latest quarter: <span className="font-mono">{latestQuarterKey}</span>
          </div>
        </>
      )}
    </div>
  );
}

// Make globally available (consistent with other components)
window.CovariateHistorySummaries = CovariateHistorySummaries;
