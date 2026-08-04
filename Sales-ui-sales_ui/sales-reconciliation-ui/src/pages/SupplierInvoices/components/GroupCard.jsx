import { FiChevronDown } from 'react-icons/fi';

// Shared expand/collapse shell for SupplierCard and DateCard — the two
// group types render identical chrome, only the icon/title/meta differ.
export function GroupCard({ id, icon, title, meta, total, expanded, onToggle, children }) {
  return (
    <div className={`sp-card${expanded ? ' sp-card--expanded' : ''}`}>
      <button
        type="button"
        className="sp-card-header"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={id}
      >
        <span className="sp-card-icon">{icon}</span>
        <span className="sp-card-title">{title}</span>
        <span className="sp-card-meta">{meta}</span>
        <span className="sp-card-total">{total}</span>
        <span className={`sp-card-chevron${expanded ? ' sp-card-chevron--open' : ''}`} aria-hidden="true">
          <FiChevronDown />
        </span>
      </button>

      {expanded && (
        <div className="sp-card-body" id={id}>
          {children}
        </div>
      )}
    </div>
  );
}
