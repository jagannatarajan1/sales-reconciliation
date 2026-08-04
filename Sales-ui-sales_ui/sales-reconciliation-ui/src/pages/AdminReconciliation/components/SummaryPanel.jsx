import { FiCheckCircle, FiDownload, FiX } from 'react-icons/fi';
import { fmtGBP } from '../utils';

// Sticky bulk-action bar — appears once one or more rows are selected,
// summarizing exactly what's selected before committing to a bulk action.
export function SummaryPanel({ selectedRows, onApproveSelected, onExportSelected, onClear, approving }) {
  if (selectedRows.length === 0) return null;

  const matched = selectedRows.filter((r) => r.status === 'auto_matched' || r.status === 'reconciled').length;
  const pending = selectedRows.filter((r) => r.status === 'needs_review').length;
  const varianceTotal = selectedRows.reduce((sum, r) => sum + Math.abs(parseFloat(r.variance) || 0), 0);
  const approvable = selectedRows.filter((r) => r.status === 'needs_review' || r.status === 'auto_matched').length;

  return (
    <div className="rc-summary-panel rc-no-print">
      <div className="rc-summary-inner">
        <div className="rc-summary-stats">
          <div className="rc-summary-item">
            <span className="rc-summary-label">Selected</span>
            <span className="rc-summary-value">{selectedRows.length}</span>
          </div>
          <div className="rc-summary-item">
            <span className="rc-summary-label">Matched</span>
            <span className="rc-summary-value">{matched}</span>
          </div>
          <div className="rc-summary-item">
            <span className="rc-summary-label">Pending</span>
            <span className="rc-summary-value">{pending}</span>
          </div>
          <div className="rc-summary-item">
            <span className="rc-summary-label">Variance Total</span>
            <span className="rc-summary-value">{fmtGBP(varianceTotal)}</span>
          </div>
        </div>
        <div className="rc-summary-actions">
          <button type="button" className="rc-btn rc-btn--ghost" onClick={onClear}>
            <FiX /> Clear
          </button>
          <button type="button" className="rc-btn rc-btn--secondary" onClick={onExportSelected}>
            <FiDownload /> Export Selected
          </button>
          <button
            type="button"
            className="rc-btn rc-btn--primary"
            onClick={onApproveSelected}
            disabled={approving || approvable === 0}
          >
            {approving && <span className="rc-btn-spinner" />} {approving ? 'Approving…' : <><FiCheckCircle /> Approve Selected ({approvable})</>}
          </button>
        </div>
      </div>
    </div>
  );
}
