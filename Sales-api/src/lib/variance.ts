// Single source of truth for the reconciliation tolerance.
//
// This value used to be a bare `5` copy-pasted into commitEmail.ts and
// adminReconciliation.routes.ts (and twice more in the frontend). Keeping
// them in step by hand is exactly the kind of thing that drifts silently, so
// every backend tolerance check now goes through here.
//
// Frontend mirror: Sales-ui-sales_ui/sales-reconciliation-ui/src/constants.js
export const VARIANCE_TOLERANCE = Number(process.env.VARIANCE_TOLERANCE ?? 5);

/**
 * True when a variance is small enough to be considered reconciled.
 *
 * ALWAYS compares the absolute value. Differences in this system are signed —
 * a shift can be under OR over — and a raw `difference <= 5` silently treats
 * every negative variance as "fine", no matter how large. That was a real bug
 * in commitEmail.ts; do not reintroduce it by comparing directly.
 */
export function isWithinTolerance(difference: number): boolean {
  return Math.abs(difference) <= VARIANCE_TOLERANCE;
}
