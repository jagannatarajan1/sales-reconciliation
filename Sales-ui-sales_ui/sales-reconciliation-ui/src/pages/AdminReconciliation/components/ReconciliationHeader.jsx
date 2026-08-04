import { FiArrowLeft, FiRefreshCw, FiClock } from 'react-icons/fi';
import { fmtDateTime } from '../utils';

export function ReconciliationHeader({ onBack, onRefresh, refreshing, lastUpdated }) {
  return (
    <div className="rc-header">
      <button type="button" className="rc-back-btn rc-no-print" onClick={onBack}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="rc-header-row">
        <div className="rc-header-titles">
          <h1 className="rc-title">Reconciliation</h1>
          <p className="rc-subtitle">Review, compare, and resolve reconciliation records.</p>
        </div>

        <div className="rc-header-actions rc-no-print">
          {lastUpdated && (
            <span className="rc-updated"><FiClock /> Updated {fmtDateTime(lastUpdated)}</span>
          )}
          <button type="button" className="rc-btn rc-btn--secondary" onClick={onRefresh} disabled={refreshing}>
            <FiRefreshCw className={refreshing ? 'rc-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  );
}
