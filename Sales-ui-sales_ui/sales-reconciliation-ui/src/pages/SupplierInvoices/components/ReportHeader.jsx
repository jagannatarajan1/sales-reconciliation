import { FiArrowLeft, FiPieChart, FiClock } from 'react-icons/fi';

export function ReportHeader({ onBack, rangeLabel, lastUpdated }) {
  return (
    <div className="sp-header">
      <button type="button" className="sp-back-btn sp-no-print" onClick={onBack}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="sp-header-titles">
        <h1 className="sp-title"><FiPieChart /> Supplier Payout Report</h1>
        <p className="sp-subtitle">
          <span>{rangeLabel}</span>
          {lastUpdated && (
            <span className="sp-updated"><FiClock /> Updated {lastUpdated}</span>
          )}
        </p>
      </div>
    </div>
  );
}
