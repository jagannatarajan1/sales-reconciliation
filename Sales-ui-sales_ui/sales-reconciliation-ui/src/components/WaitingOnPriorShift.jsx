import { FiClock } from 'react-icons/fi';
import './WaitingOnPriorShift.css';

// Shared "Night is waiting on Day" state, shown by every staff entry page
// (Cash Banking, Credit Card Banking, Lottery, Paypoint, Instant Lottery
// Inventory, Deductions) in place of the entry form — not just a disabled
// form — whenever GET /Summary/today or GET /Summary/shift-status reports
// `waitingOnDayShift: true`. That flag is only ever true for a NIGHT session
// on a date where Day has not yet been staff-committed (see
// isPriorShiftPending in Sales-api/src/lib/entryLock.ts); DAY and FULL_DAY
// sessions never see this.
//
// Self-contained styling, same convention as ShiftBanner — reuses the app's
// existing "info" colour tokens (the same ones behind AdminTillReconciliation's
// .tr-note-box/.tr-timing-note) rather than inventing a new palette.
export const WaitingOnPriorShift = ({ dayShiftHasEntries }) => (
  <div className="waiting-prior-shift">
    <span className="waiting-prior-shift__icon">
      <FiClock />
    </span>
    <div className="waiting-prior-shift__body">
      <p className="waiting-prior-shift__title">Waiting for the Day shift</p>
      <p className="waiting-prior-shift__message">
        {dayShiftHasEntries
          ? "The Day shift has started but hasn't been submitted yet. Night entries will open here as soon as Day shift is completed and submitted."
          : "The Day shift hasn't been submitted yet. Night entries will open here as soon as Day shift is completed and submitted."}
      </p>
      <p className="waiting-prior-shift__hint">
        If Day staff aren't available, an admin can unlock Night entry for today from the Reconciliation Calendar.
      </p>
    </div>
  </div>
);

export default WaitingOnPriorShift;
