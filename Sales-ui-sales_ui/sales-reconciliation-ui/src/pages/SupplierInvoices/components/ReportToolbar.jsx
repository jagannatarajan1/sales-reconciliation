import { FiSearch, FiDownload, FiFileText, FiPrinter } from 'react-icons/fi';
import { ReportTabs } from './ReportTabs';

export function ReportToolbar({
  tab, onTabChange,
  startDate, endDate, onStartChange, onEndChange, onApply, rangeError,
  search, onSearchChange,
  onDownloadPdf, onDownloadExcel, onPrint,
  downloadingPdf, downloadingExcel, loading,
}) {
  return (
    <div className="sp-toolbar sp-no-print">
      <div className="sp-toolbar-row">
        <div className="sp-toolbar-left">
          <ReportTabs tab={tab} onChange={onTabChange} />

          <div className="sp-range-group">
            <input
              type="date"
              className="sp-date-input"
              value={startDate}
              onChange={(e) => onStartChange(e.target.value)}
              aria-label="Start date"
            />
            <span className="sp-range-sep">to</span>
            <input
              type="date"
              className="sp-date-input"
              value={endDate}
              onChange={(e) => onEndChange(e.target.value)}
              aria-label="End date"
            />
            <button type="button" className="sp-btn sp-btn--secondary" onClick={onApply} disabled={loading}>
              Apply
            </button>
          </div>

          <label className="sp-search">
            <FiSearch className="sp-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="sp-search-input"
              placeholder="Search supplier, invoice no…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search invoices"
            />
          </label>
        </div>

        <div className="sp-toolbar-right">
          <button type="button" className="sp-btn sp-btn--secondary" onClick={onDownloadPdf} disabled={downloadingPdf || loading}>
            <FiDownload /> {downloadingPdf ? 'Preparing…' : 'PDF'}
          </button>
          <button type="button" className="sp-btn sp-btn--secondary" onClick={onDownloadExcel} disabled={downloadingExcel || loading}>
            <FiFileText /> {downloadingExcel ? 'Preparing…' : 'Excel'}
          </button>
          <button type="button" className="sp-btn sp-btn--primary" onClick={onPrint} disabled={loading}>
            <FiPrinter /> Print
          </button>
        </div>
      </div>

      {rangeError && <div className="sp-range-error" role="alert">{rangeError}</div>}
    </div>
  );
}
