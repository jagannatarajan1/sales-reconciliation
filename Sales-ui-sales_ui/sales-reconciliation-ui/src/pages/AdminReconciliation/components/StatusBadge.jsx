import { STATUS_META } from '../utils';

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? STATUS_META.uncommitted;
  return <span className={`rc-badge rc-badge--${meta.tone}`}>{meta.label}</span>;
}
