import { FiClock } from 'react-icons/fi';
import { fmtDateTime } from '../utils';

// Covers "Timeline", "Approval History" and "Activity Log" in one place —
// all three would otherwise just be the same AuditLog rows for this date
// presented three different ways, so this shows that one real trail once.
export function ActivityTimeline({ entries, loading }) {
  if (loading) {
    return <div className="rc-timeline-loading">Loading activity…</div>;
  }
  if (!entries || entries.length === 0) {
    return <p className="rc-muted">No recorded activity for this date yet.</p>;
  }

  return (
    <ol className="rc-timeline">
      {entries.map((e) => (
        <li key={e.id} className="rc-timeline-item">
          <span className="rc-timeline-dot" aria-hidden="true" />
          <div className="rc-timeline-body">
            <span className="rc-timeline-label">{e.label}</span>
            <span className="rc-timeline-meta">
              {e.userName ? `${e.userName} · ` : ''}<FiClock aria-hidden="true" /> {fmtDateTime(e.createdAt)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
