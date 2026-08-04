export function ReportTabs({ tab, onChange }) {
  return (
    <div className="sp-tabs" role="tablist" aria-label="Report grouping">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'supplier'}
        className={`sp-tab${tab === 'supplier' ? ' sp-tab--active' : ''}`}
        onClick={() => onChange('supplier')}
      >
        By Supplier
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'date'}
        className={`sp-tab${tab === 'date' ? ' sp-tab--active' : ''}`}
        onClick={() => onChange('date')}
      >
        By Date
      </button>
    </div>
  );
}
