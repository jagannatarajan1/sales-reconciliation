import { FiCheckCircle, FiAlertTriangle, FiClock } from 'react-icons/fi';
import './ShiftBanner.css';

const fmtDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Replaces the "Showing {date} data — committed/not committed" banner that
// was copy-pasted (as `.date-banner` markup) across CashBanking, Paypoint,
// Lottery, CreditCardBanking and InstantLotteryInventory, extended with the
// active shift. Self-contained styling — does not depend on any page's
// local `.date-banner` CSS.
export const ShiftBanner = ({ date, isCommitted, shift, shiftLabel, shiftCutoff, shiftSource }) => {
  if (!date) return null;

  return (
    <div className="shift-banner">
      <span className="shift-banner__icon">
        {isCommitted ? <FiCheckCircle /> : <FiAlertTriangle />}
      </span>
      <span>
        Showing {fmtDate(date)} data — {isCommitted ? 'committed' : 'not yet committed'}
      </span>

      {shiftLabel && (
        <span
          className={`shift-banner__pill${shiftSource === 'override' ? ' shift-banner__pill--override' : ''}`}
          title={shiftSource === 'override' ? 'Manually set by an admin' : `Determined by the clock (cutoff ${shiftCutoff ?? ''})`}
        >
          <FiClock />
          {shiftLabel}
          {shift && shiftCutoff && (
            <span className="shift-banner__cutoff">
              {shift === 'NIGHT' ? `from ${shiftCutoff}` : `until ${shiftCutoff}`}
            </span>
          )}
          {shiftSource === 'override' && <span className="shift-banner__override-tag">manual</span>}
        </span>
      )}
    </div>
  );
};
