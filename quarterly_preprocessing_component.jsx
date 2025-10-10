// QuarterlyPreprocessingView Component
// Complete preprocessing visualization component extracted from claims_arrival_settlement_diagram_editable_svg.jsx

function QuarterlyPreprocessingView({ claimData, oneBasedDevQuarters, setOneBasedDevQuarters, endDate, showPaymentDetails, setShowPaymentDetails, showQuarterlyAggregation, setShowQuarterlyAggregation, selectedClaim, priceIndexMap, priceIndexSeries, midQuarterIndexMap }) {
  if (!claimData) {
    return (
      <div className="text-center py-8 text-gray-500">
        Select a claim above to see its quarterly preprocessing
      </div>
    );
  }

  try {
    const { claimInfo, quarters } = claimData;

    // Check if inflation adjustment was applied
    const hasInflationAdjustment = quarters && quarters.length > 0 &&
      quarters.some(q => q.inflationAdjusted);

    // Validate data
    if (!claimInfo || !quarters || !Array.isArray(quarters)) {
      return (
        <div className="text-center py-8 text-gray-500">
          Error loading claim data. Please select a different claim.
        </div>
      );
    }

    const maxNominalAmount = Math.max(...quarters.map(q => isNaN(q.nominalAmount) ? 0 : q.nominalAmount), 1);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Quarterly Preprocessing: {claimInfo.claimId}</div>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={oneBasedDevQuarters}
              onChange={(e) => setOneBasedDevQuarters(e.target.checked)}
            />
            <span>1-based dev quarters</span>
          </label>
        </div>

        {/* Preprocessing Steps Overview */}
        <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="text-sm font-medium text-blue-900 mb-2">Key Preprocessing Steps:</div>
          <div className="space-y-1 text-sm text-blue-800">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <span><strong>Step 1:</strong> Continuous Timeline - View claim lifecycle from accident to settlement</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <span><strong>Step 2:</strong> Payment Details - Event timeline with quarter assignment</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <span><strong>Step 3:</strong> Quarterly Aggregation - Convert continuous timeline to quarterly periods</span>
            </div>
            {hasInflationAdjustment && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                <span><strong>Step 4:</strong> Inflation Adjustment - Adjust payments to observation end date</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <span><strong>Step {hasInflationAdjustment ? '5' : '4'}:</strong> Cumulative Payment Tracking - Track running totals by development quarter</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <span><strong>Step {hasInflationAdjustment ? '6' : '5'}:</strong> Outstanding Claim Liability Calculation - Calculate remaining liability</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <span><strong>Step {hasInflationAdjustment ? '7' : '6'}:</strong> Development Period & Training Row Generation - Create training rows for each observation period</span>
            </div>
          </div>
        </div>

        {/* Static covariates */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-2">Static Covariates</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div><strong>Type:</strong> {claimInfo.claimType}</div>
            <div><strong>Region:</strong> {claimInfo.region}</div>
            <div><strong>Postcode:</strong> {claimInfo.postcode}</div>
            <div><strong>Notify Lag:</strong> {claimInfo.notifyLag} quarters</div>
          </div>
        </div>

        {/* Timeline with accident date */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-3">Continuous Timeline</div>
          <div className="relative">
            <svg width="100%" height="100" viewBox="0 0 800 100">
              {(() => {
                // Calculate timeline bounds
                const timelineStart = claimInfo.accidentDate;
                const timelineEnd = claimInfo.settlementDate;
                const timelineSpan = timelineEnd.getTime() - timelineStart.getTime();

                // SVG dimensions
                const svgLeft = 40;
                const svgRight = 760;
                const svgWidth = svgRight - svgLeft;
                const timelineY = 40;

                // Scale function
                const timeScale = (date) => {
                  const t = date.getTime();
                  return svgLeft + ((t - timelineStart.getTime()) / timelineSpan) * svgWidth;
                };

                // Generate quarter boundaries
                const quarterBoundaries = [];
                let currentDate = new Date(timelineStart.getUTCFullYear(), 0, 1); // Start of year
                while (currentDate <= timelineEnd) {
                  if (currentDate >= timelineStart) {
                    quarterBoundaries.push(new Date(currentDate));
                  }
                  // Move to next quarter start
                  const month = currentDate.getMonth();
                  const nextQuarterMonth = Math.floor(month / 3) * 3 + 3;
                  if (nextQuarterMonth >= 12) {
                    currentDate = new Date(currentDate.getFullYear() + 1, 0, 1);
                  } else {
                    currentDate = new Date(currentDate.getFullYear(), nextQuarterMonth, 1);
                  }
                }
                // Add final boundary if needed
                const finalBoundary = new Date(timelineEnd.getUTCFullYear() + 1, 0, 1);
                if (quarterBoundaries.length === 0 || quarterBoundaries[quarterBoundaries.length - 1] < timelineEnd) {
                  quarterBoundaries.push(finalBoundary);
                }

                return (
                  <>
                    {/* Timeline base */}
                    <line x1={svgLeft} y1={timelineY} x2={svgRight} y2={timelineY} stroke="#64748b" strokeWidth="2" />

                    {/* Quarter boundaries and labels */}
                    {quarterBoundaries.map((boundary, i) => {
                      if (i === 0) return null; // Skip first boundary

                      const prevBoundary = quarterBoundaries[i - 1];
                      const x1 = timeScale(prevBoundary);
                      const x2 = timeScale(boundary);
                      const midX = (x1 + x2) / 2;

                      // Quarter info
                      const quarter = Math.floor(prevBoundary.getMonth() / 3) + 1;
                      const year = prevBoundary.getFullYear();

                      return (
                        <g key={i}>
                          {/* Quarter boundary ticks */}
                          <line x1={x1} y1={timelineY - 8} x2={x1} y2={timelineY + 8} stroke="#9ca3af" strokeWidth="1" />
                          {boundary <= timelineEnd && (
                            <line x1={x2} y1={timelineY - 8} x2={x2} y2={timelineY + 8} stroke="#9ca3af" strokeWidth="1" />
                          )}

                          {/* Quarter label */}
                          <text x={midX} y={timelineY - 12} fontSize="9" textAnchor="middle" fill="#6b7280">
                            {year}Q{quarter}
                          </text>
                        </g>
                      );
                    })}

                    {/* Accident date */}
                    <circle cx={timeScale(claimInfo.accidentDate)} cy={timelineY} r="6" fill="#ef4444" stroke="white" strokeWidth="2" />
                    <text x={timeScale(claimInfo.accidentDate)} y={timelineY + 20} fontSize="10" textAnchor="middle" fill="#374151">Accident</text>

                    {/* Notification */}
                    <circle cx={timeScale(claimInfo.notifyDate)} cy={timelineY} r="5" fill="white" stroke="#3b82f6" strokeWidth="2" />
                    <text x={timeScale(claimInfo.notifyDate)} y={timelineY + 20} fontSize="10" textAnchor="middle" fill="#374151">Notify</text>

                    {/* Payments */}
                    {selectedClaim.payments.map((payment, i) => {
                      const x = timeScale(payment.date);
                      return (
                        <g key={i}>
                          <g transform={`translate(${x}, ${timelineY})`}>
                            <line x1="-3" y1="-3" x2="3" y2="3" stroke="#10b981" strokeWidth="2" />
                            <line x1="-3" y1="3" x2="3" y2="-3" stroke="#10b981" strokeWidth="2" />
                          </g>
                          <text x={x} y={timelineY + 20} fontSize="9" textAnchor="middle" fill="#374151">${payment.amount.toFixed(2)}</text>
                        </g>
                      );
                    })}

                    {/* Settlement */}
                    <g transform={`translate(${timeScale(claimInfo.settlementDate)}, ${timelineY})`}>
                      <line x1="-4" y1="-4" x2="4" y2="4" stroke="#dc2626" strokeWidth="3" />
                      <line x1="-4" y1="4" x2="4" y2="-4" stroke="#dc2626" strokeWidth="3" />
                    </g>
                    <text x={timeScale(claimInfo.settlementDate)} y={timelineY + 20} fontSize="10" textAnchor="middle" fill="#374151">Settlement</text>
                  </>
                );
              })()}
            </svg>
          </div>
        </div>

        {/* Payment Details (Expandable) */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">Payment Details</div>
            <button
              onClick={() => setShowPaymentDetails(!showPaymentDetails)}
              className="text-xs px-3 py-1 bg-blue-200 hover:bg-blue-300 rounded-full transition-colors"
            >
              {showPaymentDetails ? 'Hide' : 'Show'} Details
            </button>
          </div>

          {showPaymentDetails && (
            <div className="bg-white rounded border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Event</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-center font-medium">Calendar Quarter</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-center font-medium">Dev Quarter</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Create combined list of all events
                    const events = [
                      {
                        type: 'accident',
                        date: claimInfo.accidentDate,
                        label: 'Accident',
                        amount: null
                      },
                      {
                        type: 'notification',
                        date: claimInfo.notifyDate,
                        label: 'Notification',
                        amount: null
                      },
                      ...selectedClaim.payments.map((payment, i) => ({
                        type: 'payment',
                        date: payment.date,
                        label: `Payment #${i + 1}`,
                        amount: payment.amount
                      })),
                      {
                        type: 'settlement',
                        date: claimInfo.settlementDate,
                        label: 'Settlement',
                        amount: null
                      }
                    ];

                    // Sort by date
                    events.sort((a, b) => a.date.getTime() - b.date.getTime());

                    return events.map((event, i) => {
                      const eventQuarter = getQuarterInfo(event.date, claimInfo.accidentDate);
                      const adjustedDevQuarter = eventQuarter.developmentQuarter + (oneBasedDevQuarters ? 1 : 0);
                      const isEvent = event.type !== 'payment';

                      return (
                        <tr key={i} className={`border-t border-gray-100 ${isEvent ? 'bg-gray-50' : ''}`}>
                          <td className={`px-3 py-2 ${isEvent ? 'font-medium text-gray-700' : 'text-gray-600'}`}>
                            {event.label}
                          </td>
                          <td className="px-3 py-2">{toISODate(event.date)}</td>
                          <td className="px-3 py-2 text-center font-mono">{eventQuarter.quarterKey}</td>
                          <td className="px-3 py-2 text-right font-medium">
                            {event.amount !== null ? `$${event.amount.toFixed(2)}` : ''}
                          </td>
                          <td className="px-3 py-2 text-center font-mono">Q{adjustedDevQuarter}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quarterly aggregation */}
        <div className="bg-yellow-50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">Quarterly Aggregation</div>
            <button
              onClick={() => setShowQuarterlyAggregation(!showQuarterlyAggregation)}
              className="text-xs px-3 py-1 bg-yellow-200 hover:bg-yellow-300 rounded-full transition-colors"
            >
              {showQuarterlyAggregation ? 'Hide' : 'Show'} Aggregation
            </button>
          </div>

          {showQuarterlyAggregation && (
            <div className="grid grid-cols-2 gap-6">
              {/* Left half - Visual bars */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-600 mb-2">Payment Composition</div>
                {quarters.map((quarter, i) => {
                  const quarterNominalAmount = quarter.nominalAmount || quarter.totalAmount;
                  return (
                    <div key={i} className="flex items-center gap-4 p-2 bg-white rounded border">
                      <div className="w-16 text-sm font-mono">
                        Dev Q{quarter.developmentQuarter}
                      </div>
                      <div className="w-20 text-sm">
                        {quarter.quarterKey}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 rounded overflow-hidden relative" style={{ width: `${(quarterNominalAmount / maxNominalAmount) * 100}%`, minWidth: '60px' }}>
                            {quarter.payments.map((payment, paymentIdx) => {
                              const colors = ['#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#451a03'];
                              const color = colors[paymentIdx % colors.length];
                              const paymentNominalAmount = payment.nominalAmount || payment.amount;
                              const paymentWidth = (paymentNominalAmount / quarterNominalAmount) * 100;
                              return (
                                <div
                                  key={paymentIdx}
                                  className="h-full flex items-center justify-center relative"
                                  style={{
                                    backgroundColor: color,
                                    width: `${paymentWidth}%`,
                                    minWidth: '2px'
                                  }}
                                  title={`Payment ${paymentIdx + 1}: $${paymentNominalAmount.toFixed(2)} on ${toISODate(payment.date)}`}
                                >
                                  {paymentWidth > 8 && (
                                    <span className="text-xs font-medium text-white drop-shadow-sm">
                                      ${paymentNominalAmount.toFixed(2)}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right half - Summary table */}
              <div>
                <div className="text-xs font-medium text-gray-600 mb-2">Quarterly Summary</div>
                <div className="bg-white rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Quarter</th>
                        <th className="px-3 py-2 text-right font-medium">Sum</th>
                        <th className="px-3 py-2 text-right font-medium">Count</th>
                        <th className="px-3 py-2 text-right font-medium">Min</th>
                        <th className="px-3 py-2 text-right font-medium">Avg</th>
                        <th className="px-3 py-2 text-right font-medium">Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quarters.map((quarter, i) => {
                        const payments = quarter.payments;
                        const nominalAmounts = payments.map(p => p.nominalAmount || p.amount);
                        const min = nominalAmounts.length > 0 ? Math.min(...nominalAmounts) : null;
                        const max = nominalAmounts.length > 0 ? Math.max(...nominalAmounts) : null;
                        const avg = nominalAmounts.length > 0 ? (nominalAmounts.reduce((a, b) => a + b, 0) / nominalAmounts.length) : null;
                        const quarterNominalAmount = quarter.nominalAmount || quarter.totalAmount;

                        return (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-3 py-2 font-mono">Dev Q{quarter.developmentQuarter}</td>
                            <td className="px-3 py-2 text-right font-medium">${quarterNominalAmount.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{quarter.paymentCount}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{min !== null ? `$${min.toFixed(2)}` : '-'}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{avg !== null ? `$${avg.toFixed(2)}` : '-'}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{max !== null ? `$${max.toFixed(2)}` : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Price Index Adjustment section (separate from quarterly aggregation) */}
        {hasInflationAdjustment && (
              <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                <div className="text-sm font-medium mb-3 text-orange-900">Price Index Adjustment</div>
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
                    <div className="text-xs font-medium text-orange-800 mb-2">Index Values & Adjustment Factors (by aggregated quarters)</div>
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
              </div>
            )}

        {/* Calculate Outstanding Claim Liability */}
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-3">Calculate Outstanding Claim Liability</div>
          {(() => {
            const observationQuarterKey = getQuarterInfo(endDate, claimInfo.accidentDate).quarterKey;
            const targetPI = priceIndexMap ? priceIndexMap[observationQuarterKey] : null;

            // Ultimate = total inflation-adjusted payments over the claim lifetime
            const midMap = midQuarterIndexMap || {};
            const ultimateClaimSize = quarters.reduce((sum, q) => {
              const srcMid = midMap[q.quarterKey] || (priceIndexMap ? priceIndexMap[q.quarterKey] : null);
              const factor = (targetPI && srcMid) ? (targetPI / srcMid) : 1.0;
              return sum + (q.nominalAmount || q.totalAmount) * factor;
            }, 0);

            return (
              <>
                <div className="text-sm mb-3">
                  <strong>Ultimate = Total Payments Over Claim Lifetime (adjusted to {observationQuarterKey}) = {formatCurrency(ultimateClaimSize)}</strong>
                </div>
                <div className="bg-white rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Quarter</th>
                        <th className="px-3 py-2 text-right font-medium">Cumulative Paid</th>
                        <th className="px-3 py-2 text-right font-medium">Outstanding Liability</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let cumulativeSum = 0;
                        return quarters.map((quarter, i) => {
                          const srcMid = midMap[quarter.quarterKey] || (priceIndexMap ? priceIndexMap[quarter.quarterKey] : null);
                          const factor = (targetPI && srcMid) ? (targetPI / srcMid) : 1.0;
                          const adjustedThisQuarter = (quarter.nominalAmount || quarter.totalAmount) * factor;
                          cumulativeSum += adjustedThisQuarter;
                          const outstandingLiability = Math.max(0, ultimateClaimSize - cumulativeSum);
                          return (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-3 py-2 font-mono">Dev Q{quarter.developmentQuarter}</td>
                              <td className="px-3 py-2 text-right font-medium">{formatCurrency(cumulativeSum)}</td>
                              <td className="px-3 py-2 text-right font-medium">{formatCurrency(outstandingLiability)}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
                <div className="text-xs text-gray-600 mt-2">
                  <strong>Formula:</strong> OCL = <span className="font-mono">Ultimate</span> − <span className="font-mono">CumulativePaidToDate</span>.
                </div>
              </>
            );
          })()}
        </div>


        {/* Development Period Calculation */}
        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
          <div className="text-sm font-medium mb-3 text-purple-900">Development Period & Training Row Generation</div>
          <div className="text-sm text-purple-800 mb-3">
            Each claim generates multiple training rows, one for each development quarter where we can observe the claim (up to the observation cutoff).
          </div>

          {(() => {
            // Calculate key metrics
            const notifyQuarter = getQuarterInfo(claimInfo.notifyDate, claimInfo.accidentDate).developmentQuarter;
            const settlementQuarter = getQuarterInfo(claimInfo.settlementDate, claimInfo.accidentDate).developmentQuarter;
            const observationQuarter = getQuarterInfo(endDate, claimInfo.accidentDate).developmentQuarter;

            // Calculate valid training rows (quarters where we can observe the claim up to observation cutoff)
            const maxObservableQuarter = Math.min(settlementQuarter, observationQuarter);
            const validNumRows = Math.max(0, maxObservableQuarter - notifyQuarter + 1);

            const svgHeight = 40 + validNumRows * 25; // Header + rows
            const startY = 35;
            const rowHeight = 15;
            const totalWidth = 560;

            return (
              <div className="space-y-4">
                {/* Visual Row Generation */}
                <div className="bg-gray-50 p-3 rounded">
                  <div className="text-xs font-medium mb-2">
                    Claim {claimInfo.claimId} → {validNumRows} Training Rows:
                  </div>
                  <svg width="100%" height={svgHeight} className="border rounded bg-white">
                    {/* Original claim representation at top */}
                    <rect x="20" y="10" width="560" height="15" fill="#E5E7EB" stroke="#9CA3AF" strokeWidth="1" rx="2" />
                    <text x="25" y="21" fontSize="10" fill="#374151" fontWeight="bold">
                      Original Claim {claimInfo.claimId}
                    </text>
                    <text x="450" y="21" fontSize="9" fill="#6B7280">
                      Notify Q{notifyQuarter} → Settle Q{settlementQuarter}
                    </text>

                    {/* Training rows */}
                    {Array.from({ length: validNumRows }, (_, i) => {
                      const y = startY + i * 25;
                      const currentQuarter = notifyQuarter + i;
                      const isLastObservableRow = currentQuarter === maxObservableQuarter;

                      // Calculate widths
                      const totalQuarters = settlementQuarter - notifyQuarter + 1;
                      const observedQuarters = currentQuarter - notifyQuarter + 1;
                      const cutoffWidth = (observedQuarters / totalQuarters) * totalWidth;

                      return (
                        <g key={i}>
                          {/* Full row background (censored part) */}
                          <rect
                            x="20"
                            y={y}
                            width={totalWidth}
                            height={rowHeight}
                            fill="#FEF3C7"
                            stroke="#F59E0B"
                            strokeWidth="1"
                            rx="2"
                            opacity="0.3"
                          />

                          {/* Visible (uncensored) part */}
                          {(() => {
                            // Compute outstanding liability for this row to decide color
                            const observationQuarter = getQuarterInfo(endDate, claimInfo.accidentDate);
                            const targetQuarterKey = observationQuarter.quarterKey;
                            const targetPI = priceIndexMap ? priceIndexMap[targetQuarterKey] : null;
                            const midMap = midQuarterIndexMap || {};
                            const ultimateClaimSize = quarters.reduce((sum, q) => {
                              const srcMid = midMap[q.quarterKey] || (priceIndexMap ? priceIndexMap[q.quarterKey] : null);
                              const factor = (targetPI && srcMid) ? (targetPI / srcMid) : 1.0;
                              return sum + (q.nominalAmount || q.totalAmount) * factor;
                            }, 0);

                            let cumulativeToDate = 0;
                            for (let qIdx = 0; qIdx < quarters.length; qIdx++) {
                              const q = quarters[qIdx];
                              if (q.developmentQuarter <= currentQuarter) {
                                const srcMid = midMap[q.quarterKey] || (priceIndexMap ? priceIndexMap[q.quarterKey] : null);
                                const factor = (targetPI && srcMid) ? (targetPI / srcMid) : 1.0;
                                cumulativeToDate += (q.nominalAmount || q.totalAmount) * factor;
                              }
                            }
                            const outstandingLiability = Math.max(0, ultimateClaimSize - cumulativeToDate);
                            const isZeroTarget = Math.round(outstandingLiability * 100) === 0;
                            const fillColor = isZeroTarget ? '#FEE2E2' : '#DBEAFE'; // red-100 if zero, otherwise blue-100

                            return (
                              <rect
                                x="20"
                                y={y}
                                width={cutoffWidth}
                                height={rowHeight}
                                fill={fillColor}
                                stroke="#3B82F6"
                                strokeWidth="1"
                                rx="2"
                              />
                            );
                          })()}

                          {/* Row label */}
                          <text x="25" y={y + 11} fontSize="9" fill="#374151" fontWeight="medium">
                            Row {i + 1}: Observe to Dev Q{currentQuarter}
                          </text>

                          {/* Outstanding liability value */}
                          <text x={20 + cutoffWidth - 5} y={y + 11} fontSize="8" fill="#1F2937" textAnchor="end" fontWeight="bold">
                            {(() => {
                              // Calculate outstanding liability at this development quarter
                              const observationQuarter = getQuarterInfo(endDate, claimInfo.accidentDate);
                              const targetPI = priceIndexMap ? priceIndexMap[observationQuarter.quarterKey] : null;
                              const midMap = midQuarterIndexMap || {};
                              const ultimateClaimSize = quarters.reduce((sum, q) => {
                                const srcMid = midMap[q.quarterKey] || (priceIndexMap ? priceIndexMap[q.quarterKey] : null);
                                const factor = (targetPI && srcMid) ? (targetPI / srcMid) : 1.0;
                                return sum + (q.nominalAmount || q.totalAmount) * factor;
                              }, 0);

                              let cumulativeToDate = 0;
                              for (let qIdx = 0; qIdx < quarters.length; qIdx++) {
                                const q = quarters[qIdx];
                                if (q.developmentQuarter <= currentQuarter) {
                                  const srcMid = midMap[q.quarterKey] || (priceIndexMap ? priceIndexMap[q.quarterKey] : null);
                                  const factor = (targetPI && srcMid) ? (targetPI / srcMid) : 1.0;
                                  cumulativeToDate += (q.nominalAmount || q.totalAmount) * factor;
                                }
                              }

                              const outstandingLiability = Math.max(0, ultimateClaimSize - cumulativeToDate);
                              return `Target: ${formatCurrency(outstandingLiability)}`;
                            })()}
                          </text>

                          {/* Cutoff line */}
                          <line
                            x1={20 + cutoffWidth}
                            y1={y}
                            x2={20 + cutoffWidth}
                            y2={y + rowHeight}
                            stroke="#DC2626"
                            strokeWidth="2"
                          />
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* Training Rows Table */}
                <div className="bg-white rounded border overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">Training Rows Generated</div>
                  <div className="max-h-60 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Row</th>
                          <th className="px-3 py-2 text-left font-medium">Description</th>
                          <th className="px-3 py-2 text-right font-medium">Total Paid to Date</th>
                          <th className="px-3 py-2 text-right font-medium">Outstanding Liability</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: validNumRows }, (_, i) => {
                          const currentQuarter = notifyQuarter + i;
                          const devPeriod = oneBasedDevQuarters ? currentQuarter + 1 : currentQuarter;

                          // Calculate outstanding liability and cumulative paid
                          const observationQuarter = getQuarterInfo(endDate, claimInfo.accidentDate);
                          const targetPI = priceIndexMap ? priceIndexMap[observationQuarter.quarterKey] : null;
                          const midMap = midQuarterIndexMap || {};
                          const ultimateClaimSize = quarters.reduce((sum, q) => {
                            const srcMid = midMap[q.quarterKey] || (priceIndexMap ? priceIndexMap[q.quarterKey] : null);
                            const factor = (targetPI && srcMid) ? (targetPI / srcMid) : 1.0;
                            return sum + (q.nominalAmount || q.totalAmount) * factor;
                          }, 0);

                          let cumulativeToDate = 0;
                          for (let qIdx = 0; qIdx < quarters.length; qIdx++) {
                            const q = quarters[qIdx];
                            if (q.developmentQuarter <= currentQuarter) {
                              const srcMid = midMap[q.quarterKey] || (priceIndexMap ? priceIndexMap[q.quarterKey] : null);
                              const factor = (targetPI && srcMid) ? (targetPI / srcMid) : 1.0;
                              cumulativeToDate += (q.nominalAmount || q.totalAmount) * factor;
                            }
                          }

                          const outstandingLiability = Math.max(0, ultimateClaimSize - cumulativeToDate);

                          return (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-3 py-2 text-left">
                                <span className="font-mono bg-blue-100 px-2 py-1 rounded text-blue-800 text-xs">R{i + 1}</span>
                              </td>
                              <td className="px-3 py-2 text-left text-xs">
                                Claim {claimInfo.claimId} at Dev Period {devPeriod}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-600">
                                {formatCurrency(cumulativeToDate)}
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-red-700">
                                {formatCurrency(outstandingLiability)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="text-xs text-gray-600">
                  <strong>Key insight:</strong> Each training row represents the claim's state at a specific development quarter,
                  with features based on information available up to that point and the target being the remaining outstanding liability.
                  <div className="mt-1"><strong>Discard rule:</strong> Rows where the target is <span className="font-mono">$0.00</span> are highlighted and will be <em>discarded</em> before model training.</div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error in QuarterlyPreprocessingView:', error);
    return (
      <div className="text-center py-8 text-red-500">
        Error rendering quarterly preprocessing view. Please try selecting a different claim.
      </div>
    );
  }
}

// Make the component globally available
window.QuarterlyPreprocessingView = QuarterlyPreprocessingView;