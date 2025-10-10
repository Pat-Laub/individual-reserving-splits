// PreprocessingStepsOverview Component
// Displays an overview of all preprocessing steps

function PreprocessingStepsOverview({ hasInflationAdjustment }) {
  const [show, setShow] = React.useState(true);

  return (
    <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-blue-900">Key Preprocessing Steps:</div>
        <button
          onClick={() => setShow(!show)}
          className="text-xs px-3 py-1 bg-blue-200 hover:bg-blue-300 rounded-full transition-colors"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {show && (
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
      )}
    </div>
  );
}

// Make the component globally available
window.PreprocessingStepsOverview = PreprocessingStepsOverview;
