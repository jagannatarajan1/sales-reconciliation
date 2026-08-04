import { fmtGBP } from '../utils';

// Sticky bottom bar — stays visible while scrolling so the report's key
// totals are always in view, without needing a second sticky sidebar column
// that would fight the report's own max-width on narrow/tablet viewports.
export function SummaryPanel({ totalSuppliers, totalInvoices, grandTotal, lastUpdated }) {
  return (
    <div className="sp-summary-panel sp-no-print">
      <div className="sp-summary-inner">
        <div className="sp-summary-item">
          <span className="sp-summary-label">Suppliers</span>
          <span className="sp-summary-value">{totalSuppliers}</span>
        </div>
        <div className="sp-summary-item">
          <span className="sp-summary-label">Invoices</span>
          <span className="sp-summary-value">{totalInvoices}</span>
        </div>
        <div className="sp-summary-item">
          <span className="sp-summary-label">Total Amount</span>
          <span className="sp-summary-value sp-summary-value--primary">{fmtGBP(grandTotal)}</span>
        </div>
        <div className="sp-summary-item sp-summary-item--muted">
          <span className="sp-summary-label">Last Updated</span>
          <span className="sp-summary-value">{lastUpdated || '—'}</span>
        </div>
      </div>
    </div>
  );
}
