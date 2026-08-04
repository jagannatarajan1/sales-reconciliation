import {
  FiCreditCard, FiDollarSign, FiTrendingDown, FiFileText, FiPackage, FiAward, FiGrid, FiBarChart2,
} from 'react-icons/fi';

export const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';
export const RECONCILIATION_URL = `${API_BASE}/admin/reconciliation`;
export const VARIANCE_TOLERANCE = 5;

export const fmtGBP = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? '£0.00' : `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const fmtDateLong = (str) =>
  new Date(str).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

export const fmtDateMed = (str) =>
  new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export const fmtDateShort = (str) =>
  new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export const fmtDateTime = (str) => {
  if (!str) return '—';
  return new Date(str).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const toISODate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const todayStr = () => toISODate(new Date());

export const daysAgoStr = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

export const STATUS_META = {
  uncommitted: { label: 'Uncommitted', tone: 'neutral' },
  needs_review: { label: 'Needs Review', tone: 'danger' },
  auto_matched: { label: 'Matched', tone: 'success' },
  reconciled: { label: 'Reconciled', tone: 'brand' },
};

export const varianceBucket = (variance) => {
  const abs = Math.abs(parseFloat(variance) || 0);
  if (abs === 0) return 'zero';
  if (abs <= VARIANCE_TOLERANCE) return 'small';
  return 'large';
};

/* ddPoint is lowercase — matches actual API response */
export const SECTIONS = [
  {
    title: 'Credit Card', color: 'blue', icon: FiCreditCard,
    fields: [
      { label: 'Manual Card Amount', key: 'manualCardAmount', monetary: true },
      { label: 'Card Amount',        key: 'cardAmount',       monetary: true },
    ],
  },
  {
    title: 'Cash', color: 'green', icon: FiDollarSign,
    fields: [
      { label: 'Last Safe',        key: 'lastSafe',       monetary: true },
      { label: 'Safe Drop Amount', key: 'safeDropAmount', monetary: true },
      { label: 'Cash (computed)',  key: 'cash',           monetary: true, readOnly: true, computed: true },
    ],
  },
  {
    title: 'Deductions', color: 'orange', icon: FiTrendingDown,
    fields: [
      { label: 'Cashback',               key: 'cashback',             monetary: true },
      { label: 'Paypoint Payout',        key: 'paypointPayout',       monetary: true },
      { label: 'Instant Lottery Payout', key: 'instantLotteryPayout', monetary: true },
      { label: 'Lottery Payout',         key: 'lotteryPayout',        monetary: true },
      { label: 'News Voucher',           key: 'newsVoucher',          monetary: true },
      { label: 'DD Point',              key: 'ddPoint',              monetary: true },
    ],
  },
  {
    title: 'Supplier Payout', color: 'indigo', icon: FiFileText,
    fields: [{ label: 'Supplier Payout', key: 'supplierInvoicesTotal', monetary: true }],
  },
  {
    title: 'Instant Lottery', color: 'purple', icon: FiPackage,
    fields: [
      { label: 'Total Count', key: 'instantLotteryTotalCount', monetary: false },
      { label: 'Total Sales', key: 'instantLotteryTotalSales', monetary: true  },
    ],
  },
  {
    title: 'Lottery',  color: 'gold', icon: FiAward,
    fields: [{ label: 'Lottery Value',  key: 'lotteryValue',  monetary: true }],
  },
  {
    title: 'Paypoint', color: 'teal', icon: FiGrid,
    fields: [{ label: 'Paypoint Value', key: 'paypointValue', monetary: true }],
  },
  {
    title: 'Totals', color: 'rose', icon: FiBarChart2,
    fields: [
      { label: 'Summary Total', key: 'summaryTotal', monetary: true, readOnly: true, computed: true },
      // Never editable — always the actual Z-Report figure (live-parsed
      // server-side from the Gmail email), not something an admin can type
      // over. Enforced again on the backend in case this is ever bypassed.
      { label: 'Z-Report Total', key: 'zReportTotal', monetary: true, readOnly: true },
      { label: 'Difference',    key: 'difference',   monetary: true, readOnly: true, computed: true },
    ],
  },
];

export const itemToForm = (item) => ({
  manualCardAmount:         item?.manualCardAmount         ?? '',
  cardAmount:               item?.cardAmount               ?? '',
  lastSafe:                 item?.lastSafe                 ?? '',
  safeDropAmount:           item?.safeDropAmount           ?? '',
  cashback:                 item?.cashback                 ?? '',
  paypointPayout:           item?.paypointPayout           ?? '',
  instantLotteryPayout:     item?.instantLotteryPayout     ?? '',
  lotteryPayout:            item?.lotteryPayout            ?? '',
  newsVoucher:              item?.newsVoucher              ?? '',
  ddPoint:                  item?.ddPoint                  ?? '',
  supplierInvoicesTotal:    item?.supplierInvoicesTotal    ?? '',
  instantLotteryTotalCount: item?.instantLotteryTotalCount ?? '',
  instantLotteryTotalSales: item?.instantLotteryTotalSales ?? '',
  lotteryValue:             item?.lotteryValue             ?? '',
  paypointValue:            item?.paypointValue            ?? '',
  summaryTotal:             item?.summaryTotal             ?? '',
  zReportTotal:             item?.zReportTotal             ?? '',
  difference:               item?.difference               ?? '',
  adminNotes:               item?.adminNotes               ?? '',
});

/* Summary Total = sum of every income field, same formula the backend uses
   to compute a day's reconciliation — keeps the admin's live total in sync
   with whatever the edited fields currently add up to. */
export const computeSummaryTotal = (f) =>
  (parseFloat(f.manualCardAmount)         || 0) +
  (parseFloat(f.cardAmount)               || 0) +
  (parseFloat(f.lastSafe)                 || 0) +
  (parseFloat(f.safeDropAmount)           || 0) +
  (parseFloat(f.cashback)                 || 0) +
  (parseFloat(f.paypointPayout)           || 0) +
  (parseFloat(f.instantLotteryPayout)     || 0) +
  (parseFloat(f.newsVoucher)              || 0) +
  (parseFloat(f.ddPoint)                  || 0) +
  (parseFloat(f.lotteryPayout)            || 0) +
  (parseFloat(f.supplierInvoicesTotal)    || 0) +
  (parseFloat(f.instantLotteryTotalSales) || 0) +
  (parseFloat(f.lotteryValue)             || 0) +
  (parseFloat(f.paypointValue)            || 0);

export const downloadBlob = async (url, token, fallbackFileName) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Download failed. Please try again.');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const fileName = match ? match[1] : fallbackFileName;

  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
};
