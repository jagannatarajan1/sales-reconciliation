import { FiCheckCircle } from 'react-icons/fi';
import './ShiftClosedNotice.css';

// Shown by the same six staff entry pages that render WaitingOnPriorShift
// (Cash Banking, Credit Card Banking, Lottery, Paypoint, Instant Lottery
// Inventory, Deductions), in place of the entry form, whenever GET
// /Summary/today reports `closed: true` for the active shift — an admin has
// marked this (date, shift) as not expected to happen (e.g. a holiday),
// via storeClosure.ts. A DIFFERENT state from WaitingOnPriorShift: that one
// means "hasn't had its turn yet", this one means "this shift was never
// going to happen at all", so it gets its own distinct message rather than
// reusing either the waiting copy or a normal (disabled) entry form.
//
// The admin's stated closure reason is never sent to staff at all (see
// ShiftBreakdownDto/StaffShiftDto server-side) — only that the shift is
// closed, never why, matching the same precedent as the force-unlock
// reason already being admin-only.
export const ShiftClosedNotice = () => (
  <div className="shift-closed-notice">
    <span className="shift-closed-notice__icon">
      <FiCheckCircle />
    </span>
    <div className="shift-closed-notice__body">
      <p className="shift-closed-notice__title">This shift is closed</p>
      <p className="shift-closed-notice__message">
        An admin has marked this shift as closed — no entry is needed here.
      </p>
    </div>
  </div>
);

export default ShiftClosedNotice;
