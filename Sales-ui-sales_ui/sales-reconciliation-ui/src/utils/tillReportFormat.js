// Shared presentational helpers for rendering raw till-report data (from
// Sales-api/src/lib/tillReportReconciliation.ts / staffTillReportView.ts)
// as plain English, human-readable values. Extracted out of
// AdminTillReconciliation.jsx so the staff-facing MyShiftReport page can
// format currency/time/dates and translate the raw department category enum
// the exact same way the admin page does — one source of truth for "what
// does £ / a shop-local minute / MERCHANDISE actually look like on screen."
//
// Keep this file free of anything comparison-specific (S1/S2/variance/status
// formatting) — that stays local to AdminTillReconciliation.jsx, which is
// the only page that ever renders a comparison. This file is for a single
// report's own values only.

export const fmtGBP = (val) => {
  if (val === null || val === undefined) return '—';
  const n = Number(val);
  return Number.isNaN(n) ? '—' : `£${n.toFixed(2)}`;
};

export const fmtCount = (val) => (val === null || val === undefined ? '—' : String(val));

export const pad2 = (n) => String(n).padStart(2, '0');

// printedMinutes is shop-local wall-clock minutes-of-day straight off the
// till slip (see tillReportReconciliation.ts's doc comment) -- pure
// arithmetic, never run through a timezone conversion.
export const fmtMinutesOfDay = (mins) => {
  if (mins === null || mins === undefined) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)}${period}`;
};

// Void occurredAt is an ISO string whose UTC fields are actually the
// shop-local wall-clock numbers as printed on the till slip (same
// deliberate construction as printedAt on the backend) -- read back with UTC
// getters, never local getters, or it silently shifts by the viewer's
// timezone offset.
export const fmtShopTime = (isoStr) => {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  return fmtMinutesOfDay(d.getUTCHours() * 60 + d.getUTCMinutes());
};

// Translates the raw backend department category enum into plain English —
// never render MERCHANDISE/LOTTERY_GROUP verbatim in JSX.
export const DEPT_CATEGORY_LABEL = { MERCHANDISE: 'Shop', LOTTERY_GROUP: 'Lottery & PayPoint' };
