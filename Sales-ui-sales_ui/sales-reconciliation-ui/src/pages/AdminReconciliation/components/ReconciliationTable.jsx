import { useState, useRef, useEffect } from 'react';
import {
  FiChevronUp, FiChevronDown, FiMoreVertical, FiEye, FiCheckCircle, FiDownload,
  FiFileText, FiColumns,
} from 'react-icons/fi';
import { StatusBadge } from './StatusBadge';
import { VarianceBadge } from './VarianceBadge';
import { fmtGBP, fmtDateMed, fmtDateTime } from '../utils';

const COLUMNS = [
  { key: 'status', label: 'Status', sortable: false, optional: false },
  { key: 'date', label: 'Date', sortable: true, optional: false },
  { key: 'staffTotal', label: 'Staff Total', sortable: true, optional: false, align: 'right' },
  { key: 'zReportTotal', label: 'Z-Report Total', sortable: true, optional: false, align: 'right' },
  { key: 'variance', label: 'Variance', sortable: true, optional: false, align: 'right' },
  { key: 'documents', label: 'Documents', sortable: false, optional: true, align: 'center' },
  { key: 'lastUpdated', label: 'Last Updated', sortable: true, optional: true },
  { key: 'actions', label: 'Actions', sortable: false, optional: false, align: 'right' },
];

function Highlight({ text, term }) {
  if (!term || !text) return text || '—';
  const idx = String(text).toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rc-highlight">{text.slice(idx, idx + term.length)}</mark>
      {text.slice(idx + term.length)}
    </>
  );
}

function ColumnMenu({ visible, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const optionalColumns = COLUMNS.filter((c) => c.optional);

  return (
    <div className="rc-col-menu" ref={ref}>
      <button type="button" className="rc-btn rc-btn--ghost rc-btn--sm" onClick={() => setOpen((v) => !v)} aria-haspopup="true" aria-expanded={open}>
        <FiColumns /> Columns
      </button>
      {open && (
        <div className="rc-col-menu-popover" role="menu">
          {optionalColumns.map((c) => (
            <label key={c.key} className="rc-col-menu-item">
              <input
                type="checkbox"
                checked={visible[c.key] !== false}
                onChange={() => onToggle(c.key)}
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function RowActionsMenu({ row, onView, onApprove, onDownloadBill }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const canApprove = row.status === 'needs_review' || row.status === 'auto_matched';
  const hasRecord = row.status !== 'uncommitted';

  return (
    <div className="rc-row-menu" ref={ref}>
      <button
        type="button"
        className="rc-icon-btn"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Actions for ${row.date}`}
      >
        <FiMoreVertical />
      </button>
      {open && (
        <div className="rc-row-menu-popover" role="menu" onClick={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onView(row.date); }}>
            <FiEye /> View Details
          </button>
          {canApprove && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onApprove(row.date); }}>
              <FiCheckCircle /> Approve
            </button>
          )}
          {hasRecord && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onDownloadBill(row.date); }}>
              <FiDownload /> Download Bill
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ReconciliationTable({
  items, selected, onToggleSelect, onToggleSelectAll, onRowClick,
  sort, onSortChange, search,
  onView, onApprove, onDownloadBill, onViewDocuments,
}) {
  const [visibleColumns, setVisibleColumns] = useState({ documents: true, lastUpdated: true });
  const toggleColumn = (key) => setVisibleColumns((prev) => ({ ...prev, [key]: prev[key] === false ? true : false }));

  const columns = COLUMNS.filter((c) => !c.optional || visibleColumns[c.key] !== false);
  const allSelected = items.length > 0 && items.every((r) => selected.has(r.date));

  const sortIcon = (key) => {
    if (sort.sortBy !== key) return null;
    return sort.sortDir === 'asc' ? <FiChevronUp /> : <FiChevronDown />;
  };

  return (
    <div className="rc-table-wrap">
      <div className="rc-table-toolbar">
        <ColumnMenu visible={visibleColumns} onToggle={toggleColumn} />
      </div>
      <div className="rc-table-scroll">
        <table className="rc-table">
          <thead>
            <tr>
              <th className="rc-th rc-th--checkbox">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  aria-label="Select all rows on this page"
                />
              </th>
              {columns.map((col) => (
                <th key={col.key} className={`rc-th${col.align ? ` rc-th--${col.align}` : ''}`}>
                  {col.sortable ? (
                    <button type="button" className="rc-th-btn" onClick={() => onSortChange(col.key)}>
                      {col.label} {sortIcon(col.key)}
                    </button>
                  ) : col.key === 'documents' ? (
                    <span className="rc-th-label">{col.label}</span>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.date}
                className={`rc-tr${selected.has(row.date) ? ' rc-tr--selected' : ''}`}
                onClick={() => onRowClick(row.date)}
              >
                <td className="rc-td rc-td--checkbox" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.date)}
                    disabled={row.status === 'uncommitted'}
                    onChange={() => onToggleSelect(row.date)}
                    aria-label={`Select ${row.date}`}
                  />
                </td>
                {columns.map((col) => {
                  if (col.key === 'status') {
                    return <td key={col.key} className="rc-td"><StatusBadge status={row.status} /></td>;
                  }
                  if (col.key === 'date') {
                    return (
                      <td key={col.key} className="rc-td rc-td--strong">
                        <Highlight text={fmtDateMed(row.date)} term={search} />
                      </td>
                    );
                  }
                  if (col.key === 'staffTotal') {
                    return <td key={col.key} className="rc-td rc-td--right">{fmtGBP(row.staffTotal)}</td>;
                  }
                  if (col.key === 'zReportTotal') {
                    return <td key={col.key} className="rc-td rc-td--right">{fmtGBP(row.zReportTotal)}</td>;
                  }
                  if (col.key === 'variance') {
                    return <td key={col.key} className="rc-td rc-td--right"><VarianceBadge variance={row.variance} /></td>;
                  }
                  if (col.key === 'documents') {
                    return (
                      <td key={col.key} className="rc-td rc-td--center" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="rc-icon-btn" onClick={() => onViewDocuments(row.date)} aria-label={`View documents for ${row.date}`}>
                          <FiFileText />
                        </button>
                      </td>
                    );
                  }
                  if (col.key === 'lastUpdated') {
                    return <td key={col.key} className="rc-td rc-td--muted">{fmtDateTime(row.lastUpdated)}</td>;
                  }
                  if (col.key === 'actions') {
                    return (
                      <td key={col.key} className="rc-td rc-td--right" onClick={(e) => e.stopPropagation()}>
                        <RowActionsMenu row={row} onView={onView} onApprove={onApprove} onDownloadBill={onDownloadBill} />
                      </td>
                    );
                  }
                  return null;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
