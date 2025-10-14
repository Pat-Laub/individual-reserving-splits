// ClaimsPreprocessingDiagram Component
// Main component for preprocessing visualization

function ClaimsPreprocessingDiagram() {
  const { useState, useMemo, useEffect } = React;

  // Destructure utilities from global scope
  const {
    hashStringToSeed,
    clampDate,
    toISODate,
    daysBetween,
    addDays,
    generateClaims,
    aggregateClaimToQuarters,
    generatePriceIndexSeries,
    buildMidQuarterIndexMap,
  } = window.utils;

  // State management
  const [numClaims] = useState(20);
  const [startDateStr] = useState('2020-01-01');
  const [endDateStr] = useState('2025-01-01');
  const [minDurDays] = useState(180);
  const [maxDurDays] = useState(1095);
  const [maxPartials] = useState(20);
  const [seedText] = useState('preprocessing-diagram');
  const [dedupeMonthly] = useState(true);
  const [trainCutStr, setTrainCutStr] = useState('2021-06-30');
  const [valCutStr, setValCutStr] = useState('2023-06-30');
  const [testCutStr, setTestCutStr] = useState('2025-01-01');
  const [selectedClaimIndex, setSelectedClaimIndex] = useState(null);
  const [oneBasedDevQuarters, setOneBasedDevQuarters] = useState(true);
  const [showPaymentDetails, setShowPaymentDetails] = useState(true);
  const [showQuarterlyAggregation, setShowQuarterlyAggregation] = useState(true);

  const seed = useMemo(() => hashStringToSeed(seedText), [seedText]);

  // Parse start/end dates
  const [startDate, endDate] = useMemo(() => {
    const s = new Date(startDateStr);
    const e = new Date(endDateStr);
    const sOk = !isNaN(s.getTime()) ? s : new Date('2020-01-01T00:00:00Z');
    const eOk = !isNaN(e.getTime()) ? e : new Date('2025-01-01T00:00:00Z');
    return sOk.getTime() < eOk.getTime() ? [sOk, eOk] : [eOk, sOk];
  }, [startDateStr, endDateStr]);

  // Clamp & sort cutoffs
  const [trainCut, valCut, testCut] = useMemo(() => {
    const clamp = (d) => clampDate(d, startDate, endDate);
    const candidates = [trainCutStr, valCutStr, testCutStr]
      .map((s) => new Date(s))
      .filter((d) => !isNaN(d.getTime()))
      .map(clamp)
      .sort((a, b) => a.getTime() - b.getTime());
    if (candidates.length !== 3) {
      const a = clamp(new Date('2021-01-01'));
      const b = clamp(new Date('2023-01-01'));
      const c = clamp(new Date('2025-01-01'));
      return [a, b, c];
    }
    return candidates;
  }, [trainCutStr, valCutStr, testCutStr, startDate, endDate]);

  // Generate claims
  const autoClaims = useMemo(
    () =>
      generateClaims({
        n: numClaims,
        startDate,
        endDate,
        minDurDays,
        maxDurDays,
        maxPartials,
        seed,
        dedupeMonthly,
        observationEndDate: endDate,
      }),
    [numClaims, startDate, endDate, minDurDays, maxDurDays, maxPartials, seed, dedupeMonthly]
  );

  const claims = autoClaims;

  // Generate Price Index
  const { series: priceIndexSeries, map: priceIndexMap } = useMemo(() => {
    return generatePriceIndexSeries(startDate, endDate, seed);
  }, [startDate, endDate, seed]);

  // Build mid-quarter price index map
  const midQuarterIndexMap = useMemo(() => {
    return priceIndexMap ? buildMidQuarterIndexMap(priceIndexMap) : null;
  }, [priceIndexMap]);

  // Initialize cutoffs based on simulated data
  const [didInitCuts, setDidInitCuts] = useState(false);
  useEffect(() => {
    if (didInitCuts) return;
    const list = (claims || []).map((c) => c.notify).sort((a, b) => a.getTime() - b.getTime());
    const n = list.length;
    const obsEnd = new Date('2025-01-01T00:00:00Z');

    if (n >= 2) {
      const clampIdx = (idx) => Math.min(Math.max(idx, 0), n - 2);
      const target60 = Math.round(0.6 * n);
      const k60 = clampIdx(target60 - 1);
      const mid60 = new Date((list[k60].getTime() + list[k60 + 1].getTime()) / 2);

      const target80Raw = Math.round(0.8 * n) - 1;
      let k80 = clampIdx(target80Raw);
      if (k80 <= k60) k80 = clampIdx(k60 + 1);
      const mid80 = new Date((list[k80].getTime() + list[k80 + 1].getTime()) / 2);

      const tTrain = toISODate(clampDate(mid60, startDate, obsEnd));
      const tVal = toISODate(clampDate(mid80, startDate, obsEnd));
      const tTest = toISODate(clampDate(obsEnd, startDate, obsEnd));
      setTrainCutStr(tTrain);
      setValCutStr(tVal);
      setTestCutStr(tTest);
      setDidInitCuts(true);
    } else {
      const total = daysBetween(startDate, obsEnd);
      const tTrain = toISODate(addDays(startDate, Math.floor(0.6 * total)));
      const tVal = toISODate(addDays(startDate, Math.floor(0.8 * total)));
      const tTest = toISODate(obsEnd);
      setTrainCutStr(tTrain);
      setValCutStr(tVal);
      setTestCutStr(tTest);
      setDidInitCuts(true);
    }
  }, [claims, startDate, didInitCuts]);

  // Set default claim to CLM-0001
  useEffect(() => {
    if (selectedClaimIndex === null && claims.length > 0) {
      const clm0001Index = claims.findIndex(c => c.staticCovariates.claimId === 'CLM-0001');
      if (clm0001Index !== -1) {
        setSelectedClaimIndex(clm0001Index);
      } else {
        setSelectedClaimIndex(0);
      }
    }
  }, [claims, selectedClaimIndex]);

  // Selected claim quarterly data
  const selectedClaim = selectedClaimIndex !== null ? claims[selectedClaimIndex] : null;
  const quarterlyData = selectedClaim
    ? aggregateClaimToQuarters(selectedClaim, oneBasedDevQuarters, endDate, priceIndexMap)
    : null;

  return (
    <div className='w-full relative'>
      <div className='w-full p-4 flex flex-col items-center'>
        <div className='text-xl font-semibold mb-2'>Individual Reserving Data Preprocessing</div>
        <div className='mb-4 text-sm text-gray-600 text-center max-w-2xl'>
          This page demonstrates the preprocessing steps applied to individual insurance claims
          before they are used in machine learning models for reserving.
        </div>

        {/* Claim Selection Interface - Sticky */}
        {selectedClaim && (
          <div className='sticky top-0 z-50 w-full mb-6 p-3 bg-gray-50 rounded-lg border shadow-md'>
            <div className='flex items-center justify-between gap-4'>
              <button
                onClick={() => setSelectedClaimIndex((prev) => (prev > 0 ? prev - 1 : claims.length - 1))}
                className='px-3 py-2 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors'
                title='Previous claim'
              >
                ← Prev
              </button>
              <div className='flex-1 text-center'>
                <div className='text-sm font-medium'>
                  Claim {selectedClaimIndex + 1} of {claims.length}
                  <span className='text-gray-500 font-normal ml-2'>
                    ({selectedClaim.staticCovariates.claimId})
                  </span>
                </div>
                <div className='text-xs text-gray-600 mt-1'>
                  Use Prev/Next buttons to navigate between claims
                </div>
              </div>
              <button
                onClick={() => setSelectedClaimIndex((prev) => (prev < claims.length - 1 ? prev + 1 : 0))}
                className='px-3 py-2 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors'
                title='Next claim'
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Quarterly Preprocessing Section */}
        <div className='w-full max-w-6xl mx-auto p-4'>
          <QuarterlyPreprocessingView
            claimData={quarterlyData}
            oneBasedDevQuarters={oneBasedDevQuarters}
            setOneBasedDevQuarters={setOneBasedDevQuarters}
            endDate={endDate}
            showPaymentDetails={showPaymentDetails}
            setShowPaymentDetails={setShowPaymentDetails}
            showQuarterlyAggregation={showQuarterlyAggregation}
            setShowQuarterlyAggregation={setShowQuarterlyAggregation}
            selectedClaim={selectedClaim}
            priceIndexMap={priceIndexMap}
            priceIndexSeries={priceIndexSeries}
            midQuarterIndexMap={midQuarterIndexMap}
          />
        </div>
      </div>
    </div>
  );
}

// Make the component globally available
window.ClaimsPreprocessingDiagram = ClaimsPreprocessingDiagram;
