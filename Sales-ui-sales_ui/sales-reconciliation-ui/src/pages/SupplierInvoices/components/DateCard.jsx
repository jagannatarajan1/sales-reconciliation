import { FiCalendar } from 'react-icons/fi';
import { GroupCard } from './GroupCard';
import { InvoiceTable } from './InvoiceTable';
import { fmtGBP, fmtDateLong } from '../utils';

export function DateCard({ group, expanded, onToggle }) {
  return (
    <GroupCard
      id={`date-panel-${group.key}`}
      icon={<FiCalendar aria-hidden="true" />}
      title={fmtDateLong(group.date)}
      meta={`${group.count} invoice${group.count === 1 ? '' : 's'}`}
      total={fmtGBP(group.total)}
      expanded={expanded}
      onToggle={onToggle}
    >
      <InvoiceTable invoices={group.invoices} variant="date" total={group.total} />
    </GroupCard>
  );
}
