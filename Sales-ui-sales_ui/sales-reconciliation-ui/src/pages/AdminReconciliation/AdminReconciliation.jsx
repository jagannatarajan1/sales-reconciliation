import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiClipboard, FiCalendar, FiFileText, FiCreditCard, FiDollarSign,
  FiTrendingDown, FiPackage, FiAward, FiGrid, FiBarChart2, FiCheckCircle,
  FiXCircle, FiEdit2, FiDownload,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { DownloadBillReports } from './DownloadBillReports';
import { VARIANCE_TOLERANCE } from '../../constants';
import './AdminReconciliation.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const fmtGBP = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? '£0.00' : `£${n.toFixed(2)}`;
};

const fmtDateLong = (str) =>
  new Date(str).toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

const fmtDateShort = (str) =>
  new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

const fmtDateTime = (str) =>
  new Date(str).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/* Committed-by / last-edited-by audit block — shared shape across the
   Uncommitted Data and Committed Records tabs so the same record always
   shows the same two-line "label above value" style. */
function AuditInfo({ items }) {
  const visible = items.filter((i) => i.value);
  if (visible.length === 0) return null;
  return (
    <div className="ar-audit-row">
      {visible.map((i) => (
        <div key={i.label} className="ar-audit-item">
          <span className="ar-label">{i.label}</span>
          <span className="ar-audit-value">{i.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ddPoint is lowercase — matches actual API response */
const SECTIONS = [
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
      { label: 'Summary Total',              key: 'summaryTotal', monetary: true, readOnly: true, computed: true },
      // Never editable — always the actual Z-Report figure (live-parsed
      // server-side from the Gmail email), not something an admin can type
      // over. Enforced again on the backend in case this is ever bypassed.
      { label: 'Z-Report Total', key: 'zReportTotal', monetary: true, readOnly: true },
      { label: 'Difference',                 key: 'difference',   monetary: true, readOnly: true, computed: true },
    ],
  },
];

const itemToForm = (item) => ({
  manualCardAmount:         item.manualCardAmount         ?? '',
  cardAmount:               item.cardAmount               ?? '',
  lastSafe:                 item.lastSafe                 ?? '',
  safeDropAmount:           item.safeDropAmount           ?? '',
  cashback:                 item.cashback                 ?? '',
  paypointPayout:           item.paypointPayout           ?? '',
  instantLotteryPayout:     item.instantLotteryPayout     ?? '',
  lotteryPayout:            item.lotteryPayout            ?? '',
  newsVoucher:              item.newsVoucher              ?? '',
  ddPoint:                  item.ddPoint                  ?? '',
  supplierInvoicesTotal:    item.supplierInvoicesTotal    ?? '',
  instantLotteryTotalCount: item.instantLotteryTotalCount ?? '',
  instantLotteryTotalSales: item.instantLotteryTotalSales ?? '',
  lotteryValue:             item.lotteryValue             ?? '',
  paypointValue:            item.paypointValue            ?? '',
  summaryTotal:             item.summaryTotal             ?? '',
  zReportTotal:             item.zReportTotal             ?? '',
  difference:               item.difference               ?? '',
  adminNotes:               '',
});

/* Summary Total = sum of every income field, same formula the backend uses
   to compute a day's reconciliation — keeps the admin's live total in sync
   with whatever the edited fields currently add up to. */
const computeSummaryTotal = (f) =>
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

/* ── Editable section grid ────────────────────────────────────────────── */
function EditableGrid({ form, computedCash, computedSummaryTotal, computedDifference, onChange }) {
  return (
    <div className="ar-grid">
      {SECTIONS.map((section) => {
        const SectionIcon = section.icon;
        return (
        <div key={section.title} className={`ar-section ar-section--${section.color}`}>
          <div className="ar-section-header">
            <SectionIcon />
            <span>{section.title}</span>
          </div>
          <div className="ar-section-body">
            {section.fields.map((field) => {
              const isRO = !!field.readOnly;
              let val;
              if (field.computed) {
                val = field.key === 'cash'
                  ? computedCash.toFixed(2)
                  : field.key === 'summaryTotal'
                    ? computedSummaryTotal.toFixed(2)
                    : computedDifference.toFixed(2);
              } else {
                val = form[field.key] ?? '';
              }
              const isDiff = field.key === 'difference';
              const fieldCls = isDiff
                ? (computedDifference <= VARIANCE_TOLERANCE ? ' ar-field--ok' : ' ar-field--over')
                : '';
              return (
                <div key={field.key} className={`ar-field${fieldCls}`}>
                  <label className="ar-label">{field.label}</label>
                  <div className={`ar-input-wrap${isRO ? ' ar-input-wrap--ro' : ''}${isDiff && computedDifference <= VARIANCE_TOLERANCE ? ' ar-input-wrap--ok' : ''}${isDiff && computedDifference > VARIANCE_TOLERANCE ? ' ar-input-wrap--over' : ''}`}>
                    {field.monetary && (
                      <span className={`ar-sym${isRO ? ' ar-sym--ro' : ''}`}>£</span>
                    )}
                    <input
                      type="number"
                      min="0"
                      step={field.monetary ? '0.01' : '1'}
                      className={`ar-input${isRO ? ' ar-input--ro' : ''}`}
                      value={val}
                      readOnly={isRO}
                      onChange={isRO ? undefined : (e) => onChange(field.key, e.target.value)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}

/* ── Read-only section grid ───────────────────────────────────────────── */
function ReadOnlyGrid({ data }) {
  return (
    <div className="ar-grid">
      {SECTIONS.map((section) => {
        const SectionIcon = section.icon;
        return (
        <div key={section.title} className={`ar-section ar-section--${section.color}`}>
          <div className="ar-section-header">
            <SectionIcon />
            <span>{section.title}</span>
          </div>
          <div className="ar-section-body">
            {section.fields.map((field) => (
              <div key={field.key} className="ar-field">
                <span className="ar-label">{field.label}</span>
                <span className="ar-value">
                  {field.monetary
                    ? fmtGBP(data[field.key])
                    : (data[field.key] ?? '—')}
                </span>
              </div>
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}

const SHIFT_LABEL = { DAY: 'Day Shift', NIGHT: 'Night Shift' };

const shiftStatusLabel = (status) => ({
  PENDING: 'Pending',
  OK: 'OK',
  VARIANCE: 'Variance',
  RESOLVED: 'Resolved',
}[status] ?? status);

/* One shift's full provenance chain — original / staff entered / admin
   adjusted / final — labelled explicitly throughout per the requirement that
   this must never read as a single bare "X Report: £nnn" figure, since that
   loses exactly the history this panel exists to show. */
function ShiftCard({ shift, date, token, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  if (!shift) {
    return (
      <div className="ar-shift-card ar-shift-card--empty">
        <div className="ar-shift-card-header">
          <span className="ar-shift-card-title">{SHIFT_LABEL.DAY}</span>
          <span className="ar-shift-status-pill ar-shift-status-pill--pending">No data yet</span>
        </div>
      </div>
    );
  }

  const isVariance = shift.finalStatus === 'VARIANCE';
  const wasEdited = shift.adminEditedTotal != null;

  const startEdit = () => {
    setAmount(shift.originalTotal != null ? String(shift.originalTotal) : '');
    setReason('');
    setEditing(true);
  };

  const submitEdit = async () => {
    const total = parseFloat(amount);
    if (isNaN(total)) return showToast('Enter a valid amount', 'error');
    if (!reason.trim()) return showToast('A reason is required', 'error');

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/admin/reconciliation/shift/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date, shift: shift.shift, adminEditedTotal: total, reason: reason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Save failed');
      }
      showToast(`${SHIFT_LABEL[shift.shift]} correction saved`);
      setEditing(false);
      await onUpdated();
    } catch (e) {
      showToast(e.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`ar-shift-card${isVariance ? ' ar-shift-card--variance' : ''}`}>
      <div className="ar-shift-card-header">
        <span className="ar-shift-card-title">{SHIFT_LABEL[shift.shift] ?? shift.shift}</span>
        <span className={`ar-shift-status-pill ar-shift-status-pill--${(shift.finalStatus || '').toLowerCase()}`}>
          {shiftStatusLabel(shift.finalStatus)}
        </span>
      </div>

      <div className="ar-shift-chain">
        <div className="ar-shift-chain-row">
          <span className="ar-label">Original X Report</span>
          <span className="ar-value">{shift.originalTotal != null ? fmtGBP(shift.originalTotal) : '—'}</span>
        </div>
        {shift.xReportCount > 1 && (
          <div className="ar-shift-reprint-note">{shift.xReportCount} X-Reports found — totals summed</div>
        )}
        <div className="ar-shift-chain-row">
          <span className="ar-label">Staff Entered Value</span>
          <span className="ar-value">{shift.staffEnteredTotal != null ? fmtGBP(shift.staffEnteredTotal) : '—'}</span>
        </div>
        <div className="ar-shift-chain-row">
          <span className="ar-label">Entered By</span>
          <span className="ar-value">{shift.staffEnteredByName || '—'}</span>
        </div>
        <div className="ar-shift-chain-row">
          <span className="ar-label">Original Difference</span>
          <span className="ar-value">{shift.originalDifference != null ? fmtGBP(shift.originalDifference) : '—'}</span>
        </div>

        {wasEdited && (
          <>
            <div className="ar-shift-chain-divider" />
            <div className="ar-shift-chain-row">
              <span className="ar-label">Admin Adjusted Value</span>
              <span className="ar-value">{fmtGBP(shift.adminEditedTotal)}</span>
            </div>
            <div className="ar-shift-chain-row">
              <span className="ar-label">Edited By</span>
              <span className="ar-value">{shift.adminEditedByName || '—'}</span>
            </div>
            <div className="ar-shift-chain-row">
              <span className="ar-label">Edited At</span>
              <span className="ar-value">{shift.adminEditedAt ? fmtDateTime(shift.adminEditedAt) : '—'}</span>
            </div>
            <div className="ar-shift-chain-row">
              <span className="ar-label">Reason</span>
              <span className="ar-value">{shift.adminEditReason || '—'}</span>
            </div>
          </>
        )}

        <div className="ar-shift-chain-divider" />
        <div className="ar-shift-chain-row ar-shift-chain-row--final">
          <span className="ar-label">Final Approved Value</span>
          <span className="ar-value">{shift.finalTotal != null ? fmtGBP(shift.finalTotal) : '—'}</span>
        </div>
        <div className="ar-shift-chain-row ar-shift-chain-row--final">
          <span className="ar-label">Final Difference</span>
          <span className="ar-value">{shift.finalDifference != null ? fmtGBP(shift.finalDifference) : '—'}</span>
        </div>
      </div>

      {editing ? (
        <div className="ar-shift-edit-form">
          <div className="ar-field">
            <label className="ar-label">Corrected Amount (£)</label>
            <input
              type="number" step="0.01" className="ar-input"
              value={amount} onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="ar-field">
            <label className="ar-label">Reason (required)</label>
            <textarea
              className="ar-notes" rows={2}
              placeholder="e.g. Corrected after checking the physical X report."
              value={reason} onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="ar-shift-edit-actions">
            <button className="ar-submit-btn ar-submit-btn--sm" onClick={submitEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save Correction'}
            </button>
            <button className="ar-cancel-btn ar-cancel-btn--sm" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        shift.originalTotal != null && (
          <button className="ar-shift-edit-btn" onClick={startEdit}>
            <FiEdit2 /> Correct This Shift
          </button>
        )
      )}
    </div>
  );
}

function ShiftBreakdownPanel({ date, shifts, xVsZ, token, onUpdated }) {
  const dayShift = shifts.find((s) => s.shift === 'DAY') ?? null;
  const nightShift = shifts.find((s) => s.shift === 'NIGHT') ?? null;

  if (!dayShift && !nightShift && !xVsZ) return null;

  return (
    <div className="ar-shift-breakdown">
      <div className="ar-shift-breakdown-title">Shift Breakdown</div>
      <div className="ar-shift-cards">
        <ShiftCard shift={dayShift} date={date} token={token} onUpdated={onUpdated} />
        <ShiftCard shift={nightShift} date={date} token={token} onUpdated={onUpdated} />
      </div>

      {xVsZ && (
        <div className={`ar-xvz-summary${xVsZ.inTolerance ? '' : ' ar-xvz-summary--over'}`}>
          <div className="ar-shift-chain-row">
            <span className="ar-label">Final X Total (Day + Night)</span>
            <span className="ar-value">{xVsZ.xSum != null ? fmtGBP(xVsZ.xSum) : '—'}</span>
          </div>
          <div className="ar-shift-chain-row">
            <span className="ar-label">Z-Report Total</span>
            <span className="ar-value">{xVsZ.zReportTotal != null ? fmtGBP(xVsZ.zReportTotal) : '—'}</span>
          </div>
          <div className="ar-shift-chain-row ar-shift-chain-row--final">
            <span className="ar-label">Z Difference</span>
            <span className="ar-value">{fmtGBP(xVsZ.difference)}</span>
          </div>
          <div className="ar-shift-chain-row">
            <span className="ar-label">Z Result</span>
            <span className="ar-value">{xVsZ.inTolerance ? 'OK' : 'Requires Review'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────── */
export const AdminReconciliation = () => {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const { showToast: notify } = useToast();
  const [activeTab, setActiveTab] = useState('pending');

  /* pending (uncommitted) — read-only until Edit is pressed; nothing is sent
     to the server until Save, so edits can be abandoned with Cancel */
  const [loadingPending, setLoadingPending] = useState(true);
  const [submitting, setSubmitting]         = useState(false);
  const [pendingItems, setPendingItems]     = useState([]);
  const [selectedDate, setSelectedDate]     = useState(null);
  const [form, setForm]                     = useState({});
  const [isEditingPending, setIsEditingPending] = useState(false);
  /* committed records */
  const [loadingDates, setLoadingDates]         = useState(true);
  const [committedDates, setCommittedDates]     = useState([]);
  const [committedDatesError, setCommittedDatesError] = useState('');
  const [fromDate, setFromDate]                 = useState('');
  const [toDate, setToDate]                     = useState('');
  const [dateFilterError, setDateFilterError]   = useState('');
  /* the 7 most recently committed dates — always unfiltered, shown as quick
     chips directly below the date-range picker per the owner's request */
  const [recentCommits, setRecentCommits]       = useState([]);
  const [loadingRecentCommits, setLoadingRecentCommits] = useState(true);
  const [selectedCommitted, setSelectedCommitted] = useState(new Date().toISOString().split('T')[0]);
  const [loadingRecord, setLoadingRecord]       = useState(false);
  const [committedRecord, setCommittedRecord]   = useState(null);
  const [isEditingCommitted, setIsEditingCommitted] = useState(false);
  const [editForm, setEditForm]                 = useState({});
  const [savingEdit, setSavingEdit]             = useState(false);
  const [downloadingBill, setDownloadingBill]   = useState(false);

  const showToast = (message, type = 'success') => notify(message, type);

  /* ── Download bill helpers ── */
  const downloadFile = async (url, fallbackFileName) => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${user.token}` },
    });
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

  // Download the full Sales Reconciliation report (Stage 3's single-date PDF
  // renderer) for the currently viewed committed record — the properly
  // formatted report, not the raw Z-report-email PDF.
  const handleDownloadBill = async () => {
    if (!selectedCommitted) return;
    setDownloadingBill(true);
    try {
      await downloadFile(
        `${API_BASE}/admin/reconciliation/download-bill?date=${selectedCommitted}`,
        `reconciliation-report-${selectedCommitted}.pdf`
      );
      showToast('Bill downloaded successfully');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDownloadingBill(false);
    }
  };

  /* fetch pending items — reused on mount and after a shift correction is
     saved, so ShiftBreakdownPanel's edit action can refresh the same list
     rather than the page needing a full reload to see the resolved status */
  const loadPendingItems = useCallback(async () => {
    setLoadingPending(true);
    try {
      const res  = await fetch(`${API_BASE}/admin/reconciliation/pending`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();

      if (data.hasPending && Array.isArray(data.items) && data.items.length > 0) {
        setPendingItems(data.items);
        /* auto-select first (most recent) date */
        setSelectedDate((prev) => (prev && data.items.some((i) => i.date === prev) ? prev : data.items[0].date));
        setForm(itemToForm(data.items.find((i) => i.date === (selectedDate ?? data.items[0].date)) ?? data.items[0]));
      } else {
        setPendingItems([]);
        setSelectedDate(null);
      }
    } catch {
      showToast('Failed to load pending data', 'error');
    } finally {
      setLoadingPending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  useEffect(() => {
    const run = async () => { await loadPendingItems(); };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  /* switch date chip → reload form from cached item, dropping any in-progress
     edit so a half-typed value can't bleed across dates */
  const selectPendingDate = (date) => {
    const item = pendingItems.find((i) => i.date === date);
    if (!item) return;
    setSelectedDate(date);
    setForm(itemToForm(item));
    setIsEditingPending(false);
  };

  const startEditingPending = () => setIsEditingPending(true);

  /* Cancel → discard edits by re-deriving the form from the cached item */
  const cancelEditingPending = () => {
    const item = pendingItems.find((i) => i.date === selectedDate);
    if (item) setForm(itemToForm(item));
    setIsEditingPending(false);
  };

  /* fetch committed dates list — stores full objects {id, date, summaryTotal, …}.
     When called unfiltered (mount, or "Clear Filter"), the same response also
     refreshes the "Recent Commits" chips below — the backend already orders
     desc, so the first 7 of an unfiltered fetch are exactly the 7 most
     recently committed dates. This deliberately reuses that one fetch rather
     than firing a second network call just for the recent-7 chips. */
  const loadCommittedDates = useCallback(async ({ fromDate: filterFromDate = '', toDate: filterToDate = '' } = {}) => {
    setLoadingDates(true);
    setCommittedDatesError('');
    const isUnfiltered = !filterFromDate && !filterToDate;
    if (isUnfiltered) setLoadingRecentCommits(true);
    try {
      const params = new URLSearchParams();
      if (filterFromDate) params.set('fromDate', filterFromDate);
      if (filterToDate) params.set('toDate', filterToDate);
      const query = params.toString();
      const res  = await fetch(`${API_BASE}/admin/reconciliation/committed${query ? `?${query}` : ''}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const records = Array.isArray(data) ? data : [];
      setCommittedDates(records);
      if (isUnfiltered) setRecentCommits(records.slice(0, 7));
    } catch {
      setCommittedDates([]);
      setCommittedDatesError('Failed to load committed records. Please try again.');
      showToast('Failed to load committed dates', 'error');
    } finally {
      setLoadingDates(false);
      if (isUnfiltered) setLoadingRecentCommits(false);
    }
  }, [user.token]);

  useEffect(() => { loadCommittedDates(); }, [loadCommittedDates]);

  const applyDateFilter = () => {
    if (fromDate && toDate && fromDate > toDate) {
      setDateFilterError('From Date cannot be later than To Date.');
      return;
    }

    setDateFilterError('');
    loadCommittedDates({ fromDate, toDate });
  };

  const clearDateFilter = () => {
    setFromDate('');
    setToDate('');
    setDateFilterError('');
    loadCommittedDates();
  };

  /* fetch a specific committed record */
  const fetchRecord = useCallback(async (date) => {
    setLoadingRecord(true);
    setCommittedRecord(null);
    try {
      const res = await fetch(`${API_BASE}/admin/reconciliation/committed/${date}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (res.status === 404) return; // no data — empty state shown below
      if (!res.ok) throw new Error();
      const data = await res.json();
      // backend returns {message: "..."} when no data exists for the date
      if (data.message || !data.date) return;
      setCommittedRecord(data);
    } catch {
      showToast(`Failed to load record for ${fmtDateShort(date)}`, 'error');
    } finally {
      setLoadingRecord(false);
    }
  }, [user.token]);

  useEffect(() => {
    if (selectedCommitted) fetchRecord(selectedCommitted);
    else setCommittedRecord(null);
    setIsEditingCommitted(false);
  }, [selectedCommitted, fetchRecord]);

  const editComputedCash =
    (parseFloat(editForm.lastSafe) || 0) + (parseFloat(editForm.safeDropAmount) || 0);

  const editComputedSummaryTotal = computeSummaryTotal(editForm);

  const editComputedDifference = Math.abs(
    editComputedSummaryTotal - (parseFloat(editForm.zReportTotal) || 0)
  );

  const startEditingCommitted = () => {
    setEditForm(itemToForm(committedRecord));
    setIsEditingCommitted(true);
  };

  const handleEditChange = (key, value) =>
    setEditForm((prev) => ({ ...prev, [key]: value }));

  const handleSaveEdit = async () => {
    if (!selectedCommitted) return;
    setSavingEdit(true);
    try {
      const body = {
        date:                 selectedCommitted,
        manualCardAmount:     parseFloat(editForm.manualCardAmount)     || 0,
        cardAmount:           parseFloat(editForm.cardAmount)           || 0,
        lastSafe:             parseFloat(editForm.lastSafe)             || 0,
        safeDropAmount:       parseFloat(editForm.safeDropAmount)       || 0,
        cashback:             parseFloat(editForm.cashback)             || 0,
        paypointPayout:       parseFloat(editForm.paypointPayout)       || 0,
        instantLotteryPayout: parseFloat(editForm.instantLotteryPayout) || 0,
        lotteryPayout:        parseFloat(editForm.lotteryPayout)        || 0,
        newsVoucher:          parseFloat(editForm.newsVoucher)          || 0,
        ddPoint:              parseFloat(editForm.ddPoint)              || 0,
        supplierInvoicesTotal: parseFloat(editForm.supplierInvoicesTotal) || 0,
        lotteryValue:         parseFloat(editForm.lotteryValue)         || 0,
        paypointValue:        parseFloat(editForm.paypointValue)        || 0,
        summaryTotal:         editComputedSummaryTotal,
        zReportTotal:         parseFloat(editForm.zReportTotal)         || 0,
        difference:           editComputedDifference,
        adminNotes:           editForm.adminNotes || '',
      };

      const res = await fetch(`${API_BASE}/admin/reconciliation/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${user.token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      showToast(`${fmtDateShort(selectedCommitted)} updated successfully`);
      setIsEditingCommitted(false);
      await fetchRecord(selectedCommitted);
      loadCommittedDates();
    } catch {
      showToast('Failed to save changes', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const computedCash =
    (parseFloat(form.lastSafe) || 0) + (parseFloat(form.safeDropAmount) || 0);

  const computedSummaryTotal = computeSummaryTotal(form);

  const computedDifference = Math.abs(
    computedSummaryTotal - (parseFloat(form.zReportTotal) || 0)
  );

  const handleChange = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /* Save — the only point at which an Uncommitted Data edit reaches the
     server. Persisting it reconciles the date, so it leaves this list. */
  const handleSavePending = async () => {
    if (!selectedDate) return;
    setSubmitting(true);
    try {
      const body = {
        date:                 selectedDate,
        manualCardAmount:     parseFloat(form.manualCardAmount)     || 0,
        cardAmount:           parseFloat(form.cardAmount)           || 0,
        lastSafe:             parseFloat(form.lastSafe)             || 0,
        safeDropAmount:       parseFloat(form.safeDropAmount)       || 0,
        cashback:             parseFloat(form.cashback)             || 0,
        paypointPayout:       parseFloat(form.paypointPayout)       || 0,
        instantLotteryPayout: parseFloat(form.instantLotteryPayout) || 0,
        lotteryPayout:        parseFloat(form.lotteryPayout)        || 0,
        newsVoucher:          parseFloat(form.newsVoucher)          || 0,
        ddPoint:              parseFloat(form.ddPoint)              || 0,
        supplierInvoicesTotal: parseFloat(form.supplierInvoicesTotal) || 0,
        lotteryValue:         parseFloat(form.lotteryValue)         || 0,
        paypointValue:        parseFloat(form.paypointValue)        || 0,
        summaryTotal:         computedSummaryTotal,
        zReportTotal:         parseFloat(form.zReportTotal)         || 0,
        difference:           computedDifference,
        adminNotes:           form.adminNotes || '',
      };

      const res = await fetch(`${API_BASE}/admin/reconciliation/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${user.token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();

      showToast(`${fmtDateShort(selectedDate)} saved successfully`);
      setIsEditingPending(false);

      /* remove saved date and move to next */
      const remaining = pendingItems.filter((i) => i.date !== selectedDate);
      setPendingItems(remaining);
      if (remaining.length > 0) {
        setSelectedDate(remaining[0].date);
        setForm(itemToForm(remaining[0]));
      } else {
        setSelectedDate(null);
        setForm({});
      }

      /* refresh committed dates dropdown */
      loadCommittedDates();
    } catch {
      showToast('Failed to save changes', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const activeItem = pendingItems.find((i) => i.date === selectedDate);

  /* What the read-only view of the pending date shows: the form values with
     the three derived fields folded in, so it matches the editable grid
     field-for-field. */
  const pendingView = {
    ...form,
    cash: computedCash,
    summaryTotal: computedSummaryTotal,
    difference: computedDifference,
  };

  return (
    <motion.div
      className="ar-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >

      <button className="ar-back-btn" onClick={() => navigate('/admin/dashboard')}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="ar-tabs">
        <button
          className={`ar-tab ${activeTab === 'pending' ? 'ar-tab--active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          <FiClipboard /> Uncommitted Data
        </button>
        <button
          className={`ar-tab ${activeTab === 'committed' ? 'ar-tab--active' : ''}`}
          onClick={() => setActiveTab('committed')}
        >
          <FiCalendar /> Committed Records
        </button>
        <button
          className={`ar-tab ${activeTab === 'download' ? 'ar-tab--active' : ''}`}
          onClick={() => setActiveTab('download')}
        >
          <FiFileText /> Download Bill
        </button>
      </div>

      {activeTab === 'pending' && (
      <div className="ar-panel">
        <div className="ar-panel-header">
          <div>
            <h2 className="ar-panel-title"><FiClipboard /> Uncommitted Data</h2>
            <p className="ar-panel-sub">
              {pendingItems.length > 0
                ? `${pendingItems.length} date${pendingItems.length !== 1 ? 's' : ''} awaiting admin reconciliation`
                : 'Dates pending admin reconciliation'}
            </p>
          </div>
          {activeItem && (
            <span className="ar-date-badge">{fmtDateLong(activeItem.date)}</span>
          )}
        </div>

        {loadingPending ? (
          <div className="ar-center">
            <div className="ar-spinner" />
            <p>Loading pending data…</p>
          </div>
        ) : pendingItems.length === 0 ? (
          <div className="ar-empty">
            <div className="ar-empty-icon"><FiCheckCircle /></div>
            <h3>All Caught Up</h3>
            <p>No entries require admin reconciliation. All differences are within the £5.00 limit.</p>
          </div>
        ) : (
          <>
            {/* Date chip selector */}
            <div className="ar-date-chips">
              {pendingItems.map((item) => (
                <button
                  key={item.date}
                  className={`ar-chip ar-chip--committed${item.date === selectedDate ? ' ar-chip--active' : ''}`}
                  onClick={() => selectPendingDate(item.date)}
                >
                  <span className="ar-chip-date">{fmtDateShort(item.date)}</span>
                  {(item.shifts || []).length > 0 && (
                    <span className="ar-chip-shift-badges">
                      {item.shifts.map((s) => (
                        <span
                          key={s.shift}
                          className={`ar-chip-shift-badge${s.finalStatus === 'VARIANCE' ? ' ar-chip-shift-badge--variance' : ''}`}
                          title={`${SHIFT_LABEL[s.shift] ?? s.shift}: ${shiftStatusLabel(s.finalStatus)}`}
                        >
                          {s.shift === 'NIGHT' ? 'N' : 'D'}
                        </span>
                      ))}
                    </span>
                  )}
                  {item.summaryTotal != null && (
                    <span className="ar-chip-total">{fmtGBP(item.summaryTotal)}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Selected date — read-only until Edit is pressed */}
            {activeItem && (
              <div className="ar-form-section">
                <div className="ar-status-block">
                  <span className={`ar-rpt-status-pill ar-rpt-status-pill--${activeItem.isStaffCommitted ? 'committed' : 'pending'}`}>
                    {activeItem.isStaffCommitted ? 'Committed — Awaiting Admin Review' : 'Uncommitted'}
                  </span>
                  <AuditInfo
                    items={
                      activeItem.isStaffCommitted
                        ? [
                            { label: 'Committed By', value: activeItem.committedByName },
                            { label: 'Committed At', value: activeItem.committedAt ? fmtDateTime(activeItem.committedAt) : null },
                          ]
                        : [
                            { label: 'Last Edited By', value: activeItem.lastEditedByName },
                            { label: 'Last Edited At', value: activeItem.lastEditedAt ? fmtDateTime(activeItem.lastEditedAt) : null },
                          ]
                    }
                  />
                </div>

                <ShiftBreakdownPanel
                  date={selectedDate}
                  shifts={activeItem.shifts || []}
                  xVsZ={activeItem.xVsZ}
                  token={user.token}
                  onUpdated={loadPendingItems}
                />

                {isEditingPending ? (
                  <EditableGrid
                    form={form}
                    computedCash={computedCash}
                    computedSummaryTotal={computedSummaryTotal}
                    computedDifference={computedDifference}
                    onChange={handleChange}
                  />
                ) : (
                  <ReadOnlyGrid data={pendingView} />
                )}
                {form.zReportTotal !== '' && form.zReportTotal !== '0' && form.zReportTotal !== 0 && (
                  <div className={`ar-diff-bar ${computedDifference <= VARIANCE_TOLERANCE ? 'ar-diff-bar--ok' : 'ar-diff-bar--over'}`}>
                    <span>Difference: <strong>£{computedDifference.toFixed(2)}</strong></span>
                    <span>
                      {computedDifference <= VARIANCE_TOLERANCE ? <FiCheckCircle /> : <FiXCircle />}
                      {computedDifference <= VARIANCE_TOLERANCE
                        ? ` Within £${VARIANCE_TOLERANCE.toFixed(2)} limit`
                        : ` Exceeds £${VARIANCE_TOLERANCE.toFixed(2)} limit`}
                    </span>
                  </div>
                )}

                {activeItem.staffNotes && (
                  <div className="ar-committed-notes">
                    <span className="ar-label">Staff Notes</span>
                    <p>{activeItem.staffNotes}</p>
                  </div>
                )}

                {isEditingPending ? (
                  <div className="ar-notes-wrap">
                    <label className="ar-label">Admin Notes</label>
                    <textarea
                      className="ar-notes"
                      placeholder="Enter any notes about this reconciliation…"
                      value={form.adminNotes || ''}
                      rows={3}
                      onChange={(e) => handleChange('adminNotes', e.target.value)}
                    />
                  </div>
                ) : form.adminNotes ? (
                  <div className="ar-committed-notes">
                    <span className="ar-label">Admin Notes</span>
                    <p>{form.adminNotes}</p>
                  </div>
                ) : null}

                {isEditingPending ? (
                  <div className="ar-edit-actions">
                    <button
                      className="ar-submit-btn"
                      onClick={handleSavePending}
                      disabled={submitting}
                    >
                      {submitting && <span className="ar-btn-spinner" />}
                      {submitting ? 'Saving…' : `Save — ${fmtDateShort(selectedDate)}`}
                    </button>
                    <button
                      className="ar-cancel-btn"
                      onClick={cancelEditingPending}
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="ar-edit-actions">
                    <button className="ar-edit-btn" onClick={startEditingPending}>
                      <FiEdit2 /> Edit
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      )}

      {activeTab === 'committed' && (
      <div className="ar-panel">
        <div className="ar-panel-header">
          <div>
            <h2 className="ar-panel-title"><FiCalendar /> Committed Records</h2>
            <p className="ar-panel-sub">
              {committedDates.length > 0
                ? `${committedDates.length} committed date${committedDates.length !== 1 ? 's' : ''} — filter by range or pick a recent commit below`
                : 'View past submitted reconciliations'}
            </p>
          </div>
        </div>

        <div className="ar-filter-toolbar">
          <div className="ar-filter-card">
            <div className="ar-filter-card-head">
              <span className="ar-filter-card-icon"><FiCalendar /></span>
              <span className="ar-filter-card-title">Date range</span>
            </div>
            <div className="ar-filter-card-body" aria-label="Filter committed records by date range">
              <div className="ar-picker-row ar-picker-row--inline">
                <label className="ar-label" htmlFor="committed-from-date">From Date</label>
                <input
                  id="committed-from-date"
                  type="date"
                  className="ar-date-input"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setDateFilterError('');
                  }}
                />
              </div>
              <div className="ar-picker-row ar-picker-row--inline">
                <label className="ar-label" htmlFor="committed-to-date">To Date</label>
                <input
                  id="committed-to-date"
                  type="date"
                  className="ar-date-input"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setDateFilterError('');
                  }}
                />
              </div>
              <div className="ar-filter-actions">
                <button className="ar-filter-apply-btn" onClick={applyDateFilter} disabled={loadingDates}>
                  {loadingDates ? 'Loading…' : 'Apply Filter'}
                </button>
                <button className="ar-filter-clear-btn" onClick={clearDateFilter} disabled={loadingDates}>
                  Clear Filter
                </button>
              </div>
            </div>
          </div>
        </div>

        {dateFilterError && <div className="ar-filter-error" role="alert">{dateFilterError}</div>}

        {/* Recent Commits — always the 7 most recently committed dates,
            independent of the date-range filter above, per the owner's
            request for quick access without having to filter first. */}
        <div className="ar-recent-commits">
          <span className="ar-recent-commits-label">Recent Commits</span>
          {loadingRecentCommits ? (
            <div className="ar-center ar-center--inline">
              <div className="ar-spinner ar-spinner--sm" />
              <span>Loading…</span>
            </div>
          ) : recentCommits.length > 0 ? (
            <div className="ar-date-chips ar-date-chips--committed">
              {recentCommits.map((item) => (
                <button
                  key={item.date}
                  className={`ar-chip ar-chip--committed${item.date === selectedCommitted ? ' ar-chip--active' : ''}`}
                  onClick={() => setSelectedCommitted(item.date)}
                >
                  <span className="ar-chip-date">{fmtDateShort(item.date)}</span>
                  {item.summaryTotal != null && (
                    <span className="ar-chip-total">{fmtGBP(item.summaryTotal)}</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <p className="ar-muted">No committed records yet.</p>
          )}
        </div>

        {/* Quick-select chips — only when committed dates are loaded */}
        {loadingDates ? (
          <div className="ar-center ar-center--inline">
            <div className="ar-spinner ar-spinner--sm" />
            <span>Loading committed dates…</span>
          </div>
        ) : committedDatesError ? (
          <div className="ar-notice" role="alert">{committedDatesError}</div>
        ) : committedDates.length > 0 ? (
          <div className="ar-date-chips ar-date-chips--committed">
            {committedDates.map((item) => (
              <button
                key={item.date}
                className={`ar-chip ar-chip--committed${item.date === selectedCommitted ? ' ar-chip--active' : ''}`}
                onClick={() => setSelectedCommitted(item.date)}
              >
                <span className="ar-chip-date">{fmtDateShort(item.date)}</span>
                {item.summaryTotal != null && (
                  <span className="ar-chip-total">{fmtGBP(item.summaryTotal)}</span>
                )}
                {item.isStaffCommitted && (
                  <span className="ar-source-badge ar-source-badge--staff">Staff</span>
                )}
                {item.isAdminReconciled && (
                  <span className="ar-source-badge ar-source-badge--admin">Admin</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="ar-muted">No committed records yet — they will appear here as chips once submitted.</p>
        )}

        {/* Record detail */}
        {selectedCommitted && (
          loadingRecord ? (
            <div className="ar-center">
              <div className="ar-spinner" />
              <p>Loading record for {fmtDateShort(selectedCommitted)}…</p>
            </div>
          ) : committedRecord ? (
            <div className="ar-record-detail">
              <div className="ar-record-header">
                <span className="ar-date-badge">{fmtDateLong(selectedCommitted)}</span>
                {committedRecord.isStaffCommitted && (
                  <span className="ar-source-badge ar-source-badge--staff">Staff</span>
                )}
                {committedRecord.isAdminReconciled && (
                  <span className="ar-source-badge ar-source-badge--admin">Admin</span>
                )}
                {!isEditingCommitted && (
                  <>
                    <button
                      className="ar-download-btn ar-download-btn--inline"
                      onClick={handleDownloadBill}
                      disabled={downloadingBill}
                    >
                      <FiDownload /> {downloadingBill ? 'Downloading…' : 'Download Bill'}
                    </button>
                    <button className="ar-edit-btn" onClick={startEditingCommitted}>
                      <FiEdit2 /> Edit
                    </button>
                  </>
                )}
              </div>

              <div className="ar-status-block">
                <AuditInfo
                  items={[
                    { label: 'Committed By', value: committedRecord.committedByName },
                    { label: 'Committed At', value: committedRecord.committedAt ? fmtDateTime(committedRecord.committedAt) : null },
                    { label: 'Admin Submitted By', value: committedRecord.adminSubmittedByName },
                    { label: 'Admin Submitted At', value: committedRecord.adminSubmittedAt ? fmtDateTime(committedRecord.adminSubmittedAt) : null },
                  ]}
                />
              </div>

              {isEditingCommitted ? (
                <>
                  <EditableGrid
                    form={editForm}
                    computedCash={editComputedCash}
                    computedSummaryTotal={editComputedSummaryTotal}
                    computedDifference={editComputedDifference}
                    onChange={handleEditChange}
                  />
                  <div className="ar-notes-wrap">
                    <label className="ar-label">Admin Notes</label>
                    <textarea
                      className="ar-notes"
                      placeholder="Enter any notes about this reconciliation…"
                      value={editForm.adminNotes || ''}
                      rows={3}
                      onChange={(e) => handleEditChange('adminNotes', e.target.value)}
                    />
                  </div>
                  <div className="ar-edit-actions">
                    <button
                      className="ar-submit-btn"
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                    >
                      {savingEdit && <span className="ar-btn-spinner" />}
                      {savingEdit ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button
                      className="ar-cancel-btn"
                      onClick={() => setIsEditingCommitted(false)}
                      disabled={savingEdit}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <ReadOnlyGrid data={committedRecord} />
                  {committedRecord.staffNotes && (
                    <div className="ar-committed-notes">
                      <span className="ar-label">Staff Notes</span>
                      <p>{committedRecord.staffNotes}</p>
                    </div>
                  )}
                  {committedRecord.adminNotes && (
                    <div className="ar-committed-notes">
                      <span className="ar-label">Admin Notes</span>
                      <p>{committedRecord.adminNotes}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="ar-notice">
              Staff have not yet committed any values for {fmtDateShort(selectedCommitted)}.
            </div>
          )
        )}
      </div>
      )}

      {activeTab === 'download' && (
      <div className="ar-panel">
        <div className="ar-panel-header">
          <div>
            <h2 className="ar-panel-title"><FiFileText /> Download Bill</h2>
            <p className="ar-panel-sub">
              Browse committed reconciliation reports, view the full field-by-field Z-Report
              comparison, and export a date range as PDF or Excel.
            </p>
          </div>
        </div>

        <DownloadBillReports />
      </div>
      )}

    </motion.div>
  );
};
