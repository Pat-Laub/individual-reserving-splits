// QuarterlyPreprocessingView Component
// Main orchestrator component that uses all sub-components

function QuarterlyPreprocessingView({ 
  claimData, 
  oneBasedDevQuarters, 
  setOneBasedDevQuarters, 
  endDate, 
  showPaymentDetails, 
  setShowPaymentDetails, 
  showQuarterlyAggregation, 
  setShowQuarterlyAggregation, 
  selectedClaim, 
  priceIndexMap, 
  priceIndexSeries, 
  midQuarterIndexMap 
}) {
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

        <PreprocessingStepsOverview hasInflationAdjustment={hasInflationAdjustment} />

        <StaticCovariates claimInfo={claimInfo} />

        <ContinuousTimeline claimInfo={claimInfo} selectedClaim={selectedClaim} />

        <PaymentDetails 
          claimInfo={claimInfo}
          selectedClaim={selectedClaim}
          oneBasedDevQuarters={oneBasedDevQuarters}
          showPaymentDetails={showPaymentDetails}
          setShowPaymentDetails={setShowPaymentDetails}
        />

        <QuarterlyAggregation 
          quarters={quarters}
          showQuarterlyAggregation={showQuarterlyAggregation}
          setShowQuarterlyAggregation={setShowQuarterlyAggregation}
        />

        {hasInflationAdjustment && (
          <PriceIndexAdjustment 
            quarters={quarters}
            claimInfo={claimInfo}
            endDate={endDate}
            priceIndexMap={priceIndexMap}
            priceIndexSeries={priceIndexSeries}
            midQuarterIndexMap={midQuarterIndexMap}
          />
        )}

        <OutstandingLiabilityCalculation 
          quarters={quarters}
          claimInfo={claimInfo}
          endDate={endDate}
          priceIndexMap={priceIndexMap}
          midQuarterIndexMap={midQuarterIndexMap}
        />

        <DevelopmentPeriodGeneration 
          claimInfo={claimInfo}
          quarters={quarters}
          endDate={endDate}
          oneBasedDevQuarters={oneBasedDevQuarters}
          priceIndexMap={priceIndexMap}
          midQuarterIndexMap={midQuarterIndexMap}
        />
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
