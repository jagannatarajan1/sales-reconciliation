import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
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

/* ddPoint is lowercase — matches actual API response */
const SECTIONS = [
  {
    title: 'Credit Card', color: 'blue', icon: '💳',
    fields: [
      { label: 'Manual Card Amount', key: 'manualCardAmount', monetary: true },
      { label: 'Card Amount',        key: 'cardAmount',       monetary: true },
    ],
  },
  {
    title: 'Cash', color: 'green', icon: '💵',
    fields: [
      { label: 'Last Safe',        key: 'lastSafe',       monetary: true },
      { label: 'Safe Drop Amount', key: 'safeDropAmount', monetary: true },
      { label: 'Cash (computed)',  key: 'cash',           monetary: true, readOnly: true, computed: true },
    ],
  },
  {
    title: 'Deductions', color: 'orange', icon: '📉',
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
    title: 'Supplier Payout', color: 'indigo', icon: '🧾',
    fields: [{ label: 'Supplier Payout', key: 'supplierInvoicesTotal', monetary: true }],
  },
  {
    title: 'Instant Lottery', color: 'purple', icon: '📦',
    fields: [
      { label: 'Total Count', key: 'instantLotteryTotalCount', monetary: false },
      { label: 'Total Sales', key: 'instantLotteryTotalSales', monetary: true  },
    ],
  },
  {
    title: 'Lottery',  color: 'gold', icon: '🎰',
    fields: [{ label: 'Lottery Value',  key: 'lotteryValue',  monetary: true }],
  },
  {
    title: 'Paypoint', color: 'teal', icon: '🎲',
    fields: [{ label: 'Paypoint Value', key: 'paypointValue', monetary: true }],
  },
  {
    title: 'Totals', color: 'rose', icon: '📊',
    fields: [
      { label: 'Summary Total',              key: 'summaryTotal', monetary: true, readOnly: true, computed: true },
      { label: 'Z-Report Total', key: 'zReportTotal', monetary: true },
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
      {SECTIONS.map((section) => (
        <div key={section.title} className={`ar-section ar-section--${section.color}`}>
          <div className="ar-section-header">
            <span>{section.icon}</span>
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
                ? (computedDifference <= 5 ? ' ar-field--ok' : ' ar-field--over')
                : '';
              return (
                <div key={field.key} className={`ar-field${fieldCls}`}>
                  <label className="ar-label">{field.label}</label>
                  <div className={`ar-input-wrap${isRO ? ' ar-input-wrap--ro' : ''}${isDiff && computedDifference <= 5 ? ' ar-input-wrap--ok' : ''}${isDiff && computedDifference > 5 ? ' ar-input-wrap--over' : ''}`}>
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
      ))}
    </div>
  );
}

/* ── Read-only section grid ───────────────────────────────────────────── */
function ReadOnlyGrid({ data }) {
  return (
    <div className="ar-grid">
      {SECTIONS.map((section) => (
        <div key={section.title} className={`ar-section ar-section--${section.color}`}>
          <div className="ar-section-header">
            <span>{section.icon}</span>
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
      ))}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────── */
export const AdminReconciliation = () => {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('pending');

  /* download bill */
  const todayStr = new Date().toISOString().split('T')[0];
  const [billDate, setBillDate]           = useState('');
  const [billFromDate, setBillFromDate]   = useState('');
  const [billToDate, setBillToDate]       = useState('');
  const [downloadingBill, setDownloadingBill]   = useState(false);
  const [downloadingRange, setDownloadingRange] = useState(false);

  /* pending (uncommitted) */
  const [loadingPending, setLoadingPending] = useState(true);
  const [submitting, setSubmitting]         = useState(false);
  const [pendingItems, setPendingItems]     = useState([]);
  const [selectedDate, setSelectedDate]     = useState(null);
  const [form, setForm]                     = useState({});
  /* committed records */
  const [loadingDates, setLoadingDates]         = useState(true);
  const [committedDates, setCommittedDates]     = useState([]);
  const [committedDatesError, setCommittedDatesError] = useState('');
  const [fromDate, setFromDate]                 = useState('');
  const [toDate, setToDate]                     = useState('');
  const [dateFilterError, setDateFilterError]   = useState('');
  const [selectedCommitted, setSelectedCommitted] = useState(new Date().toISOString().split('T')[0]);
  const [loadingRecord, setLoadingRecord]       = useState(false);
  const [committedRecord, setCommittedRecord]   = useState(null);
  const [isEditingCommitted, setIsEditingCommitted] = useState(false);
  const [editForm, setEditForm]                 = useState({});
  const [savingEdit, setSavingEdit]             = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

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

  const handleDownloadBill = async () => {
    if (!billDate) {
      showToast('Please select a date', 'error');
      return;
    }
    setDownloadingBill(true);
    try {
      await downloadFile(
        `${API_BASE}/admin/reconciliation/download-bill?date=${billDate}`,
        `zreport-bill-${billDate}.pdf`
      );
      showToast('Bill downloaded successfully');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDownloadingBill(false);
    }
  };

  const clearBillDate = () => setBillDate('');

  const clearBillRange = () => {
    setBillFromDate('');
    setBillToDate('');
  };

  const handleDownloadBillsRange = async () => {
    if (!billFromDate || !billToDate) {
      showToast('Please select both a from date and a to date', 'error');
      return;
    }
    if (billFromDate > billToDate) {
      showToast('From Date must be on or before To Date', 'error');
      return;
    }
    setDownloadingRange(true);
    try {
      await downloadFile(
        `${API_BASE}/admin/reconciliation/download-bills-range?fromDate=${billFromDate}&toDate=${billToDate}`,
        `zreport-bills-${billFromDate}-to-${billToDate}.zip`
      );
      showToast('Bills downloaded successfully');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDownloadingRange(false);
    }
  };

  /* fetch pending items on mount */
  useEffect(() => {
    const run = async () => {
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
          setSelectedDate(data.items[0].date);
          setForm(itemToForm(data.items[0]));
        } else {
          setPendingItems([]);
          setSelectedDate(null);
        }
      } catch {
        showToast('Failed to load pending data', 'error');
      } finally {
        setLoadingPending(false);
      }
    };
    run();
  }, [user.token]);

  /* switch date chip → reload form from cached item */
  const selectPendingDate = (date) => {
    const item = pendingItems.find((i) => i.date === date);
    if (!item) return;
    setSelectedDate(date);
    setForm(itemToForm(item));
  };

  /* fetch committed dates list — stores full objects {id, date, summaryTotal, …} */
  const loadCommittedDates = useCallback(async ({ fromDate: filterFromDate = '', toDate: filterToDate = '' } = {}) => {
    setLoadingDates(true);
    setCommittedDatesError('');
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
    } catch {
      setCommittedDates([]);
      setCommittedDatesError('Failed to load committed records. Please try again.');
      showToast('Failed to load committed dates', 'error');
    } finally {
      setLoadingDates(false);
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

  const handleSubmit = async () => {
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

      showToast(`${fmtDateShort(selectedDate)} submitted successfully`);

      /* remove submitted date and move to next */
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
      showToast('Failed to submit reconciliation', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const activeItem = pendingItems.find((i) => i.date === selectedDate);

  return (
    <div className="ar-page">

      {toast && (
        <div className={`ar-toast ar-toast--${toast.type}`}>
          <span className="ar-toast-icon">{toast.type === 'success' ? '✓' : '✕'}</span>
          {toast.message}
        </div>
      )}

      <button className="ar-back-btn" onClick={() => navigate('/admin/dashboard')}>
        ← Back to Dashboard
      </button>

      <div className="ar-tabs">
        <button
          className={`ar-tab ${activeTab === 'pending' ? 'ar-tab--active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          📋 Uncommitted Data
        </button>
        <button
          className={`ar-tab ${activeTab === 'committed' ? 'ar-tab--active' : ''}`}
          onClick={() => setActiveTab('committed')}
        >
          📅 Committed Records
        </button>
        <button
          className={`ar-tab ${activeTab === 'download' ? 'ar-tab--active' : ''}`}
          onClick={() => setActiveTab('download')}
        >
          🧾 Download Bill
        </button>
      </div>

      {activeTab === 'pending' && (
      <div className="ar-panel">
        <div className="ar-panel-header">
          <div>
            <h2 className="ar-panel-title">📋 Uncommitted Data</h2>
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
            <div className="ar-empty-icon">✅</div>
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
                  {item.summaryTotal != null && (
                    <span className="ar-chip-total">{fmtGBP(item.summaryTotal)}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Editable form for selected date */}
            {activeItem && (
              <div className="ar-form-section">
                <EditableGrid
                  form={form}
                  computedCash={computedCash}
                  computedSummaryTotal={computedSummaryTotal}
                  computedDifference={computedDifference}
                  onChange={handleChange}
                />
                {form.zReportTotal !== '' && form.zReportTotal !== '0' && form.zReportTotal !== 0 && (
                  <div className={`ar-diff-bar ${computedDifference <= 5 ? 'ar-diff-bar--ok' : 'ar-diff-bar--over'}`}>
                    <span>Difference: <strong>£{computedDifference.toFixed(2)}</strong></span>
                    <span>{computedDifference <= 5 ? '✓ Within £5.00 limit' : '✗ Exceeds £5.00 limit'}</span>
                  </div>
                )}

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

                <button
                  className="ar-submit-btn"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting && <span className="ar-btn-spinner" />}
                  {submitting ? 'Submitting…' : `Submit — ${fmtDateShort(selectedDate)}`}
                </button>
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
            <h2 className="ar-panel-title">📅 Committed Records</h2>
            <p className="ar-panel-sub">
              {committedDates.length > 0
                ? `${committedDates.length} committed date${committedDates.length !== 1 ? 's' : ''} — click a date or use the picker`
                : 'View past submitted reconciliations'}
            </p>
          </div>
        </div>

        <div className="ar-filter-toolbar">
          <div className="ar-filter-card">
            <div className="ar-filter-card-head">
              <span className="ar-filter-card-icon">📅</span>
              <span className="ar-filter-card-title">Pick a date</span>
            </div>
            <div className="ar-filter-card-body">
              <div className="ar-picker-row ar-picker-row--inline">
                <label className="ar-label" htmlFor="committed-picker">Date</label>
                <input
                  id="committed-picker"
                  type="date"
                  className="ar-date-input"
                  value={selectedCommitted}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setSelectedCommitted(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="ar-filter-card">
            <div className="ar-filter-card-head">
              <span className="ar-filter-card-icon">🗓️</span>
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
                {committedRecord.committedByName && (
                  <span className="ar-submitted-at">
                    By: {committedRecord.committedByName}
                  </span>
                )}
                {committedRecord.committedAt && (
                  <span className="ar-submitted-at">
                    Committed: {new Date(committedRecord.committedAt).toLocaleString('en-GB')}
                  </span>
                )}
                {!isEditingCommitted && (
                  <button className="ar-edit-btn" onClick={startEditingCommitted}>
                    ✎ Edit
                  </button>
                )}
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
            <h2 className="ar-panel-title">🧾 Download Bill</h2>
            <p className="ar-panel-sub">Download the Z-report bill received via Gmail for a specific date, or a range of dates.</p>
          </div>
        </div>

        <div className="ar-download-section">
          <h3 className="ar-download-heading">Single date</h3>
          <div className="ar-date-filter" aria-label="Download bill for a single date">
            <div className="ar-picker-row ar-picker-row--inline">
              <label className="ar-label" htmlFor="bill-date">Date</label>
              <input
                id="bill-date"
                type="date"
                className="ar-date-input"
                value={billDate}
                max={todayStr}
                onChange={(e) => setBillDate(e.target.value)}
              />
            </div>
            <div className="ar-filter-actions">
              <button
                className="ar-download-btn"
                onClick={handleDownloadBill}
                disabled={downloadingBill || !billDate}
              >
                {downloadingBill ? 'Downloading…' : '⬇ Download Bill'}
              </button>
              <button
                className="ar-filter-clear-btn"
                onClick={clearBillDate}
                disabled={downloadingBill || !billDate}
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className="ar-download-section">
          <h3 className="ar-download-heading">Date range</h3>
          <div className="ar-date-filter" aria-label="Download bills for a date range">
            <div className="ar-picker-row ar-picker-row--inline">
              <label className="ar-label" htmlFor="bill-from-date">From Date</label>
              <input
                id="bill-from-date"
                type="date"
                className="ar-date-input"
                value={billFromDate}
                max={todayStr}
                onChange={(e) => setBillFromDate(e.target.value)}
              />
            </div>
            <div className="ar-picker-row ar-picker-row--inline">
              <label className="ar-label" htmlFor="bill-to-date">To Date</label>
              <input
                id="bill-to-date"
                type="date"
                className="ar-date-input"
                value={billToDate}
                min={billFromDate || undefined}
                max={todayStr}
                onChange={(e) => setBillToDate(e.target.value)}
              />
            </div>
            <div className="ar-filter-actions">
              <button
                className="ar-download-btn"
                onClick={handleDownloadBillsRange}
                disabled={downloadingRange || !billFromDate || !billToDate}
              >
                {downloadingRange ? 'Downloading…' : '⬇ Download Bills (ZIP)'}
              </button>
              <button
                className="ar-filter-clear-btn"
                onClick={clearBillRange}
                disabled={downloadingRange || (!billFromDate && !billToDate)}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

    </div>
  );
};
