import { FiBriefcase } from 'react-icons/fi';
import { GroupCard } from './GroupCard';
import { InvoiceTable } from './InvoiceTable';
import { fmtGBP } from '../utils';

export function SupplierCard({ group, expanded, onToggle }) {
  return (
    <GroupCard
      id={`supplier-panel-${group.key}`}
      icon={<FiBriefcase aria-hidden="true" />}
      title={group.name}
      meta={`${group.count} invoice${group.count === 1 ? '' : 's'}`}
      total={fmtGBP(group.total)}
      expanded={expanded}
      onToggle={onToggle}
    >
      <InvoiceTable invoices={group.invoices} variant="supplier" total={group.total} />
    </GroupCard>
  );
}
