import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

export function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="rc-pagination">
      <span className="rc-pagination-status">
        Showing <strong>{start}–{end}</strong> of <strong>{total}</strong> records
      </span>
      <div className="rc-pagination-controls">
        <button
          type="button"
          className="rc-pager-btn"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <FiChevronLeft /> Prev
        </button>
        <span className="rc-pagination-page">Page {page} of {totalPages}</span>
        <button
          type="button"
          className="rc-pager-btn"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next <FiChevronRight />
        </button>
      </div>
    </div>
  );
}
