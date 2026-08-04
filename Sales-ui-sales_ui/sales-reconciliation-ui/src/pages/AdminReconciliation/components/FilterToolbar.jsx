import { FiSearch, FiDownload, FiFileText, FiPrinter, FiX } from 'react-icons/fi';

export function FilterToolbar({
  filters, onFilterChange, onReset,
  onDownloadPdf, onDownloadExcel, onPrint,
  downloadingPdf, downloadingExcel, loading,
}) {
  return (
    <div className="rc-toolbar rc-no-print">
      <div className="rc-toolbar-row">
        <div className="rc-toolbar-left">
          <label className="rc-search">
            <FiSearch className="rc-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="rc-search-input"
              placeholder="Search by date, staff name, or notes…"
              value={filters.search}
              onChange={(e) => onFilterChange('search', e.target.value)}
              aria-label="Search reconciliation records"
            />
          </label>

          <div className="rc-range-group">
            <input
              type="date"
              className="rc-date-input"
              value={filters.fromDate}
              max={filters.toDate || undefined}
              onChange={(e) => onFilterChange('fromDate', e.target.value)}
              aria-label="From date"
            />
            <span className="rc-range-sep">to</span>
            <input
              type="date"
              className="rc-date-input"
              value={filters.toDate}
              min={filters.fromDate || undefined}
              onChange={(e) => onFilterChange('toDate', e.target.value)}
              aria-label="To date"
            />
          </div>

          <select
            className="rc-select"
            value={filters.status}
            onChange={(e) => onFilterChange('status', e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="uncommitted">Uncommitted</option>
            <option value="needs_review">Needs Review</option>
            <option value="auto_matched">Matched</option>
            <option value="reconciled">Reconciled</option>
          </select>

          <select
            className="rc-select"
            value={filters.variance}
            onChange={(e) => onFilterChange('variance', e.target.value)}
            aria-label="Filter by variance"
          >
            <option value="all">All Variances</option>
            <option value="zero">£0.00 Matched</option>
            <option value="small">Small (≤ £5.00)</option>
            <option value="large">Large (&gt; £5.00)</option>
          </select>

          <button type="button" className="rc-btn rc-btn--ghost" onClick={onReset}>
            <FiX /> Reset Filters
          </button>
        </div>

        <div className="rc-toolbar-right">
          <button type="button" className="rc-btn rc-btn--secondary" onClick={onDownloadExcel} disabled={downloadingExcel || loading}>
            <FiFileText /> {downloadingExcel ? 'Preparing…' : 'Export Excel'}
          </button>
          <button type="button" className="rc-btn rc-btn--secondary" onClick={onDownloadPdf} disabled={downloadingPdf || loading}>
            <FiDownload /> {downloadingPdf ? 'Preparing…' : 'Export PDF'}
          </button>
          <button type="button" className="rc-btn rc-btn--secondary" onClick={onPrint} disabled={loading}>
            <FiPrinter /> Print
          </button>
        </div>
      </div>
    </div>
  );
}
