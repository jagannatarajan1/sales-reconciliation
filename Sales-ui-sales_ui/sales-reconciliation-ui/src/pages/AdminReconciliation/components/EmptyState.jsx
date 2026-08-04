import { FiInbox, FiSearch, FiFileText, FiFile } from 'react-icons/fi';

const VARIANTS = {
  noRecords: {
    icon: <FiInbox aria-hidden="true" />,
    title: 'No reconciliations in this range',
    message: 'Try widening the date range, or check back once staff start committing daily totals.',
  },
  noSearchResults: {
    icon: <FiSearch aria-hidden="true" />,
    title: 'No matching results',
    message: 'Try a different search term, or clear your filters.',
  },
  noReports: {
    icon: <FiFileText aria-hidden="true" />,
    title: 'No reports available',
    message: 'Select a date range to see reconciliation reports.',
  },
  noDocuments: {
    icon: <FiFile aria-hidden="true" />,
    title: 'No documents for this date',
    message: 'No Z-Report email or generated bill is available yet.',
  },
};

export function EmptyState({ variant = 'noRecords' }) {
  const v = VARIANTS[variant] ?? VARIANTS.noRecords;
  return (
    <div className="rc-empty">
      <div className="rc-empty-icon">{v.icon}</div>
      <h3 className="rc-empty-title">{v.title}</h3>
      <p className="rc-empty-message">{v.message}</p>
    </div>
  );
}
