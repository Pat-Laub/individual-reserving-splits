// PaymentDetails Component
// Displays expandable payment details with quarter assignment

function PaymentDetails({ 
  claimInfo, 
  selectedClaim, 
  oneBasedDevQuarters, 
  showPaymentDetails, 
  setShowPaymentDetails 
}) {
  // Use utilities from global scope
  const { getQuarterInfo, toISODate } = window.utils;

  return (
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
        <>
          <div className="text-sm text-gray-700 mb-3">
            The series of payments made to the insured are spread out over many days. However reserving datasets often don't keep this daily-level view of the data, but instead summarise the payments by month, quarter, or year.
          </div>
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
        </>
      )}
    </div>
  );
}

// Make the component globally available
window.PaymentDetails = PaymentDetails;
