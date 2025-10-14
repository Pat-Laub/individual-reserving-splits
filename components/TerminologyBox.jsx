// TerminologyBox Component
// Clarifies key terminology used throughout the preprocessing

function TerminologyBox() {
  const [show, setShow] = React.useState(true);

  return (
    <div className="mb-4 p-4 bg-amber-50 rounded-lg border border-amber-300">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-amber-900">📖 Key Terminology</div>
        <button
          onClick={() => setShow(!show)}
          className="text-xs px-3 py-1 bg-amber-200 hover:bg-amber-300 rounded-full transition-colors"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {show && (
        <div className="space-y-3 text-sm text-amber-900">
          <div className="bg-white p-3 rounded border border-amber-200">
            <div className="font-semibold mb-1">Incurred (Case Estimates)</div>
            <div className="text-gray-700">
              A case estimator's best estimate of the remaining liability for a claim, at a given point in time before settlement. 
              This is a <strong>time series</strong> as multiple estimates are made as the claim develops. 
              These estimates are correlated with the true outstanding but contain estimation error, with earlier estimates typically being less accurate than later ones.
            </div>
          </div>
          
          <div className="bg-white p-3 rounded border border-amber-200">
            <div className="font-semibold mb-1">Outstanding Claim Liability (Target Variable)</div>
            <div className="text-gray-700">
              The true amount which is remaining to be paid out for a claim. 
              This is <strong>unknowable</strong> at any time before settlement. 
              This is the <strong>target variable</strong> for our prediction task—what we're trying to predict.
            </div>
          </div>

          <div className="bg-amber-100 p-2 rounded border border-amber-300 text-xs">
            <strong>Note:</strong> Both of these are also called "Case Estimates" in the actuarial literature, 
            but since the distinction between the <em>estimates</em> (incurred) and the <em>true value</em> (outstanding) 
            is key to our prediction task, we avoid that term as it can be confusing/misleading.
          </div>
        </div>
      )}
    </div>
  );
}

// Make the component globally available
window.TerminologyBox = TerminologyBox;
