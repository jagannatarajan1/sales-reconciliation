import { SECTIONS } from '../utils';

// One grid, two modes — collapses the old EditableGrid/ReadOnlyGrid pair
// into a single component (same markup either way, only whether inputs are
// writable differs) instead of maintaining two near-identical copies.
export function RecordGrid({ editable, form, computedCash, computedSummaryTotal, computedDifference, onChange }) {
  return (
    <div className="rc-field-grid">
      {SECTIONS.map((section) => {
        const SectionIcon = section.icon;
        return (
          <div key={section.title} className={`rc-field-section rc-field-section--${section.color}`}>
            <div className="rc-field-section-header">
              <SectionIcon />
              <span>{section.title}</span>
            </div>
            <div className="rc-field-section-body">
              {section.fields.map((field) => {
                const isRO = !editable || !!field.readOnly;
                let val;
                if (field.computed) {
                  val = field.key === 'cash'
                    ? computedCash.toFixed(2)
                    : field.key === 'summaryTotal'
                      ? computedSummaryTotal.toFixed(2)
                      : computedDifference.toFixed(2);
                } else {
                  val = form[field.key] ?? '';
                }

                if (!editable) {
                  return (
                    <div key={field.key} className="rc-field">
                      <span className="rc-field-label">{field.label}</span>
                      <span className="rc-field-value">{field.monetary ? `£${(parseFloat(val) || 0).toFixed(2)}` : (val === '' ? '—' : val)}</span>
                    </div>
                  );
                }

                const isDiff = field.key === 'difference';
                return (
                  <div key={field.key} className={`rc-field${isDiff ? (computedDifference <= 5 ? ' rc-field--ok' : ' rc-field--over') : ''}`}>
                    <label className="rc-field-label">{field.label}</label>
                    <div className={`rc-input-wrap${isRO ? ' rc-input-wrap--ro' : ''}`}>
                      {field.monetary && <span className={`rc-sym${isRO ? ' rc-sym--ro' : ''}`}>£</span>}
                      <input
                        type="number"
                        min="0"
                        step={field.monetary ? '0.01' : '1'}
                        className={`rc-input${isRO ? ' rc-input--ro' : ''}`}
                        value={val}
                        readOnly={isRO}
                        onChange={isRO ? undefined : (e) => onChange(field.key, e.target.value)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
