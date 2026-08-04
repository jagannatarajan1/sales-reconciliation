import { FiInbox, FiSearch, FiBriefcase, FiFileText } from 'react-icons/fi';

const VARIANTS = {
  noInvoices: {
    icon: <FiInbox aria-hidden="true" />,
    title: 'No invoices in this range',
    message: 'Try widening the date range, or enter some supplier invoices first.',
  },
  noSuppliers: {
    icon: <FiBriefcase aria-hidden="true" />,
    title: 'No suppliers found',
    message: 'No supplier invoices have been recorded for this period yet.',
  },
  noSearchResults: {
    icon: <FiSearch aria-hidden="true" />,
    title: 'No matching results',
    message: 'Try a different supplier name, invoice number, or clear your search.',
  },
  noReport: {
    icon: <FiFileText aria-hidden="true" />,
    title: 'No report available',
    message: 'Select a date range above to generate a payout report.',
  },
};

export function EmptyState({ variant = 'noInvoices' }) {
  const v = VARIANTS[variant] ?? VARIANTS.noInvoices;
  return (
    <div className="sp-empty">
      <div className="sp-empty-icon">{v.icon}</div>
      <h3 className="sp-empty-title">{v.title}</h3>
      <p className="sp-empty-message">{v.message}</p>
    </div>
  );
}
