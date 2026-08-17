import { FiCalendar } from 'react-icons/fi';
import { GroupCard } from './GroupCard';
import { InvoiceTable } from './InvoiceTable';
import PhotoAttachments from '../../../components/PhotoAttachments';
import { PHOTO_SECTIONS } from '../../../constants/photoSections';
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
      {/* This is the payout report, not the entry screen — invoice photos are
          captured on Deductions and shown here read-only alongside the day
          they belong to. Only mounted while the group is expanded so a wide
          range does not fetch every day's images at once. */}
      {expanded && (
        <PhotoAttachments
          section={PHOTO_SECTIONS.supplierInvoices}
          date={String(group.date).split('T')[0]}
          readOnly
          compact
          title="Invoice Photos"
        />
      )}
    </GroupCard>
  );
}
