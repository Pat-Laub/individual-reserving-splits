// OutstandingLiabilityCalculation Component
// Calculates and displays outstanding claim liability

function OutstandingLiabilityCalculation({
  quarters,
  claimInfo,
  endDate,
  priceIndexMap,
  midQuarterIndexMap
}) {
  // Use utilities from global scope
  const { getQuarterInfo, formatCurrency } = window.utils;
  const [show, setShow] = React.useState(true);

  return (
    <div className="bg-green-50 p-4 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Calculate Outstanding Claim Liability</div>
        <button
          onClick={() => setShow(!show)}
          className="text-xs px-3 py-1 bg-green-200 hover:bg-green-300 rounded-full transition-colors"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {show && (
        <>
          {/* Terminology */}
          <div className="mb-4 text-sm text-gray-700">
            <div className="font-semibold text-green-900 mb-2">📖 Key Terminology</div>
            <div className="space-y-2">
              <div>
                <span className="font-semibold">Ultimate:</span> The total amount that will be paid out for a claim over its entire lifetime (from notification to settlement). 
                This is only known once the claim is fully settled.
              </div>
              
              <div>
                <span className="font-semibold">Incurred (Case Estimates):</span> A case estimator's best estimate of the remaining liability for a claim, at a given point in time before settlement. 
                This is a <strong>time series</strong> as multiple estimates are made as the claim develops. 
                These estimates are correlated with the true outstanding but contain estimation error, with earlier estimates typically being less accurate than later ones.
              </div>
              
              <div>
                <span className="font-semibold">Outstanding Claim Liability (Target Variable):</span> The true amount which is remaining to be paid out for a claim. 
                This is <strong>unknowable</strong> at any time before settlement. 
                This is the <strong>target variable</strong> for our prediction task—what we're trying to predict.
              </div>

              <div className="text-xs italic text-gray-600">
                Note: Both Incurred and Outstanding are also called "Case Estimates" in the actuarial literature, 
                but since the distinction between the <em>estimates</em> (incurred) and the <em>true value</em> (outstanding) 
                is key to our prediction task, we avoid that term as it can be confusing/misleading.
              </div>
            </div>
          </div>

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
      </>
      )}
    </div>
  );
}

// Make the component globally available
window.OutstandingLiabilityCalculation = OutstandingLiabilityCalculation;
