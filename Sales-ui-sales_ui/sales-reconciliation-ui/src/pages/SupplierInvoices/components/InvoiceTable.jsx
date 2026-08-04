import { useState, useMemo } from 'react';
import { FiBriefcase, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { fmtGBP, fmtDateMed } from '../utils';

const PAGE_SIZE = 8;

const SUPPLIER_COLUMNS = [
  { key: 'invoiceNo', label: 'Invoice No.', align: 'center' },
  { key: 'date', label: 'Date', align: 'left' },
  { key: 'enteredBy', label: 'Entered By', align: 'left' },
  { key: 'value', label: 'Value', align: 'right' },
];

const DATE_COLUMNS = [
  { key: 'supplierName', label: 'Supplier', align: 'left' },
  { key: 'invoiceNo', label: 'Invoice No.', align: 'center' },
  { key: 'enteredBy', label: 'Entered By', align: 'left' },
  { key: 'value', label: 'Value', align: 'right' },
];

function cellContent(inv, key) {
  switch (key) {
    case 'invoiceNo':
      return <code className="sp-invoice-no">{inv.invoiceNo || '—'}</code>;
    case 'date':
      return fmtDateMed(inv.date);
    case 'enteredBy':
      return inv.enteredBy || '—';
    case 'value':
      return fmtGBP(inv.value);
    case 'supplierName':
      return <span className="sp-supplier-inline"><FiBriefcase aria-hidden="true" /> {inv.supplierName || '—'}</span>;
    default:
      return null;
  }
}

// All rows stay mounted (not sliced) so print CSS can force every row back
// into view — only the current page's rows carry `sp-tr--hidden`, which a
// print media query overrides. Keeps on-screen pagination without losing
// data when the report is printed.
export function InvoiceTable({ invoices, variant, total }) {
  const columns = variant === 'date' ? DATE_COLUMNS : SUPPLIER_COLUMNS;
  const [sortKey, setSortKey] = useState(variant === 'date' ? 'invoiceNo' : 'date');
  const [sortDir, setSortDir] = useState(variant === 'date' ? 'asc' : 'desc');
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const rows = [...invoices];
    rows.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'value') {
        av = parseFloat(av || 0);
        bv = parseFloat(bv || 0);
      } else {
        av = String(av ?? '').toLowerCase();
        bv = String(bv ?? '').toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [invoices, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;

  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  return (
    <div className="sp-table-wrap">
      <table className="sp-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`sp-th sp-th--${col.align}`}
                aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" className="sp-th-btn" onClick={() => toggleSort(col.key)}>
                  {col.label}
                  {sortKey === col.key && (
                    <span className="sp-sort-arrow" aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv, idx) => (
            <tr
              key={inv.id ?? idx}
              className={`sp-tr${idx >= pageStart && idx < pageEnd ? '' : ' sp-tr--hidden'}`}
            >
              {columns.map((col) => (
                <td key={col.key} className={`sp-td sp-td--${col.align}`}>
                  {cellContent(inv, col.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={columns.length - 1} className="sp-tfoot-label">Total</td>
            <td className="sp-tfoot-amount">{fmtGBP(total)}</td>
          </tr>
        </tfoot>
      </table>

      {totalPages > 1 && (
        <div className="sp-pager sp-no-print">
          <button
            type="button"
            className="sp-pager-btn"
            disabled={safePage === 1}
            onClick={() => setPage(safePage - 1)}
            aria-label="Previous page"
          >
            <FiChevronLeft />
          </button>
          <span className="sp-pager-status">Page {safePage} of {totalPages}</span>
          <button
            type="button"
            className="sp-pager-btn"
            disabled={safePage === totalPages}
            onClick={() => setPage(safePage + 1)}
            aria-label="Next page"
          >
            <FiChevronRight />
          </button>
        </div>
      )}
    </div>
  );
}
