import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiFileText, FiCalendar, FiBriefcase, FiUser, FiDollarSign, FiX,
  FiDownload, FiPrinter, FiPieChart, FiLock, FiUnlock,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import './SupplierInvoices.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const fmtGBP = (val) => {
  if (val == null) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : `£${n.toFixed(2)}`;
};

const fmtDateLong = (str) =>
  new Date(str).toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

const fmtDateMed = (str) =>
  new Date(str).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

const fmtTime = (str) => {
  if (!str) return '—';
  return new Date(str).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/* ── Date-list view ─────────────────────────────────────────────────── */
function DateList({ rows, onSelect, loading, selectedDate, rangeLabel }) {
  const sortedRows = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const totalInvoices = sortedRows.reduce((acc, row) => acc + (row.invoiceCount || 0), 0);
  const totalValue = sortedRows.reduce((acc, row) => acc + parseFloat(row.totalValue || 0), 0);

  if (loading) {
    return (
      <div className="si-center">
        <div className="si-spinner" />
        <p>Loading invoice dates…</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="si-empty-panel">
        <div className="si-empty-icon"><FiFileText /></div>
        <h3>No Invoice Dates Found</h3>
        <p>Supplier payouts entered by staff will appear here as a date navigator.</p>
      </div>
    );
  }

  return (
    <div className="si-panel">
      {rangeLabel && (
        <div className="si-range-pill">Showing period: {rangeLabel}</div>
      )}
      <div className="si-summary-bar">
        <div className="si-summary-item">
          <span className="si-summary-icon"><FiCalendar /></span>
          <div className="si-summary-text">
            <span className="si-summary-label">Available Days</span>
            <span className="si-summary-val">{sortedRows.length}</span>
          </div>
        </div>
        <div className="si-summary-item">
          <span className="si-summary-icon"><FiFileText /></span>
          <div className="si-summary-text">
            <span className="si-summary-label">Total Invoices</span>
            <span className="si-summary-val">{totalInvoices}</span>
          </div>
        </div>
        <div className="si-summary-item">
          <span className="si-summary-icon"><FiDollarSign /></span>
          <div className="si-summary-text">
            <span className="si-summary-label">Period Total</span>
            <span className="si-summary-val si-summary-val--primary">{fmtGBP(totalValue)}</span>
          </div>
        </div>
      </div>

      <motion.div
        className="si-date-nav-list"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
        initial="hidden"
        animate="visible"
      >
        {sortedRows.map((row) => (
          <motion.button
            key={row.date}
            className={`si-date-nav-item${selectedDate === row.date ? ' si-date-nav-item--active' : ''}`}
            onClick={() => onSelect(row.date)}
            variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } } }}
          >
            <span className="si-date-nav-date">{fmtDateMed(row.date)}</span>
            <span className="si-date-nav-meta">{row.invoiceCount} invoice{row.invoiceCount === 1 ? '' : 's'}</span>
            <span className="si-date-nav-total">{fmtGBP(row.totalValue)}</span>
            <span className="si-date-nav-arrow">→</span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}

/* ── Date-detail view ───────────────────────────────────────────────── */
// §2 — canManageLock gates the reopen/lock toggle to the same permission the
// backend PUT /suppliers/invoices/reopen/:date checks (commitHistory or
// superadmin) — see the SupplierInvoices root component below.
function DateDetail({ date, onBack, token, canManageLock }) {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [lockStatus, setLockStatus] = useState(null);
  const [togglingLock, setTogglingLock] = useState(false);
  const { showToast: notify } = useToast();

  const showToast = (message, type = 'error') => notify(message, type);

  const loadLockStatus = () => {
    fetch(`${API_BASE}/suppliers/invoices/lock-status?date=${encodeURIComponent(date)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data) setLockStatus(data); })
      .catch(() => {});
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/suppliers/invoices?date=${encodeURIComponent(date)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404) {
          setInvoices([]);
          return;
        }
        if (!res.ok) throw new Error();
        setInvoices(await res.json());
      } catch {
        showToast('Failed to load invoices for this date');
      } finally {
        setLoading(false);
      }
    };
    run();
    loadLockStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, token]);

  const handleToggleLock = async () => {
    setTogglingLock(true);
    try {
      const res = await fetch(`${API_BASE}/suppliers/invoices/reopen/${encodeURIComponent(date)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to update lock status');
      setLockStatus(prev => ({ ...prev, supplierInvoicesReopened: data.supplierInvoicesReopened, editable: !prev.isStaffCommitted || data.supplierInvoicesReopened }));
      notify(data.message || 'Updated', 'success');
    } catch (e) {
      showToast(e.message || 'Failed to update lock status');
    } finally {
      setTogglingLock(false);
    }
  };

  const dayTotal = invoices.reduce((acc, inv) => acc + parseFloat(inv.value || 0), 0);

  return (
    <div className="si-panel">
      <div className="si-detail-header">
        <button className="si-back-date-btn" onClick={onBack}>
          <FiArrowLeft /> Back to all dates
        </button>
        <div className="si-detail-title-block">
          <h2 className="si-detail-title"><FiFileText /> {fmtDateLong(date)}</h2>
          {!loading && invoices.length > 0 && (
            <div className="si-detail-meta">
              <span className="si-detail-count">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</span>
              <span className="si-detail-total">Total: {fmtGBP(dayTotal)}</span>
            </div>
          )}
        </div>
      </div>

      {lockStatus?.isStaffCommitted && (
        <div className={`si-lock-banner ${lockStatus.editable ? 'si-lock-banner--open' : 'si-lock-banner--locked'}`}>
          {lockStatus.editable ? <FiUnlock /> : <FiLock />}
          <span>
            {lockStatus.editable
              ? 'This date is committed but has been reopened — supplier invoices are editable.'
              : 'This date has been committed — supplier invoices are read-only for staff.'}
          </span>
          {canManageLock && (
            <button className="si-lock-toggle-btn" onClick={handleToggleLock} disabled={togglingLock}>
              {togglingLock ? 'Working…' : lockStatus.editable ? 'Lock Again' : 'Reopen for Editing'}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="si-center">
          <div className="si-spinner" />
          <p>Loading invoices…</p>
        </div>
      ) : invoices.length === 0 ? (
        <div className="si-empty-inline">
          <p>No invoices found for this date.</p>
        </div>
      ) : (
        <table className="si-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Invoice No.</th>
              <th className="si-th-right">Value</th>
              <th>Entered By</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv, idx) => (
              <tr key={inv.id ?? idx} className="si-row si-row--static">
                <td className="si-td-supplier">
                  <span className="si-supplier-name">
                    <FiBriefcase /> {inv.supplierName || inv.supplier || '—'}
                  </span>
                </td>
                <td className="si-td-invoice">
                  <code className="si-invoice-no">
                    {inv.invoiceNumber || inv.invoiceNo || '—'}
                  </code>
                </td>
                <td className="si-td-right si-amount">{fmtGBP(inv.value)}</td>
                <td className="si-td-staff">
                  <span className="si-staff-name">
                    <FiUser /> {inv.enteredBy || '—'}
                  </span>
                </td>
                <td className="si-td-time">{fmtTime(inv.time || inv.createdAt)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="si-tfoot-label">Day Total</td>
              <td className="si-tfoot-amount">{fmtGBP(dayTotal)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

/* ── Supplier Payout report — grouped by supplier, range-based ──────────
   D4: PDF / Excel / Print export of the current date-range filter, grouped
   by supplier with per-supplier and grand totals. This is the printable
   on-screen equivalent of the PDF/Excel files the backend generates from
   the same range, so what's on screen always matches what gets exported. */
function PayoutReport({ fromDate, toDate, token }) {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const { showToast: notify } = useToast();
  const showToast = (message, type = 'error') => notify(message, type);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ fromDate, toDate });
        const res = await fetch(`${API_BASE}/suppliers/invoices?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404) {
          setInvoices([]);
          return;
        }
        if (!res.ok) throw new Error();
        setInvoices(await res.json());
      } catch {
        showToast('Failed to load the supplier payout report for this range');
      } finally {
        setLoading(false);
      }
    };
    if (fromDate && toDate) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, token]);

  const bySupplier = new Map();
  for (const inv of invoices) {
    const key = inv.supplierName || inv.supplier || 'Unknown Supplier';
    const list = bySupplier.get(key) ?? [];
    list.push(inv);
    bySupplier.set(key, list);
  }
  const supplierNames = Array.from(bySupplier.keys()).sort((a, b) => a.localeCompare(b));
  const grandTotal = invoices.reduce((acc, inv) => acc + parseFloat(inv.value || 0), 0);

  const downloadBlob = async (url, fallbackFileName) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Download failed.');
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

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      await downloadBlob(
        `${API_BASE}/suppliers/invoices/download-pdf?${params.toString()}`,
        `supplier-payout-${fromDate}-to-${toDate}.pdf`,
      );
    } catch (e) {
      showToast(e.message);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadExcel = async () => {
    setDownloadingExcel(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      await downloadBlob(
        `${API_BASE}/suppliers/invoices/download-excel?${params.toString()}`,
        `supplier-payout-${fromDate}-to-${toDate}.xlsx`,
      );
    } catch (e) {
      showToast(e.message);
    } finally {
      setDownloadingExcel(false);
    }
  };

  const handlePrint = () => window.print();

  return (
    <div className="si-panel si-payout-report">
      <div className="si-payout-header">
        <h2 className="si-detail-title"><FiPieChart /> Supplier Payout Report</h2>
        <p className="si-payout-range">{fmtDateMed(fromDate)} to {fmtDateMed(toDate)}</p>
        <div className="si-payout-actions si-no-print">
          <button className="si-export-btn" onClick={handleDownloadPdf} disabled={downloadingPdf || loading}>
            <FiDownload /> {downloadingPdf ? 'Preparing…' : 'Download PDF'}
          </button>
          <button className="si-export-btn" onClick={handleDownloadExcel} disabled={downloadingExcel || loading}>
            <FiFileText /> {downloadingExcel ? 'Preparing…' : 'Download Excel'}
          </button>
          <button className="si-export-btn" onClick={handlePrint} disabled={loading}>
            <FiPrinter /> Print
          </button>
        </div>
      </div>

      {loading ? (
        <div className="si-center"><div className="si-spinner" /><p>Loading report…</p></div>
      ) : supplierNames.length === 0 ? (
        <div className="si-empty-inline"><p>No supplier invoices found for this range.</p></div>
      ) : (
        <>
          {supplierNames.map((supplierName) => {
            const rows = bySupplier.get(supplierName);
            const supplierTotal = rows.reduce((acc, inv) => acc + parseFloat(inv.value || 0), 0);
            return (
              <div key={supplierName} className="si-payout-supplier-block">
                <h3 className="si-payout-supplier-name"><FiBriefcase /> {supplierName}</h3>
                <table className="si-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Invoice No.</th>
                      <th>Entered By</th>
                      <th className="si-th-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((inv, idx) => (
                      <tr key={inv.id ?? idx} className="si-row si-row--static">
                        <td>{fmtDateMed(inv.date)}</td>
                        <td><code className="si-invoice-no">{inv.invoiceNumber || inv.invoiceNo || '—'}</code></td>
                        <td>{inv.enteredBy || '—'}</td>
                        <td className="si-td-right si-amount">{fmtGBP(inv.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="si-tfoot-label">Supplier Total</td>
                      <td className="si-tfoot-amount">{fmtGBP(supplierTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })}
          <div className="si-payout-grand-total">
            Grand Total: <span>{fmtGBP(grandTotal)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────── */
export const SupplierInvoices = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast: notify } = useToast();
  const [loading, setLoading]       = useState(true);
  const [dateRows, setDateRows]     = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  /* Range-only filter (D2) — no more single "specific date" card. Defaults
     to today so the existing daily-lookup workflow still works via a
     one-day range, exactly as it did with the specific-date picker. */
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [rangeError, setRangeError] = useState('');

  const showToast = (message, type = 'error') => notify(message, type);

  const backPath = user?.role === 'admin' ? '/admin/dashboard' : '/dashboard';

  // §2 — matches the backend's requirePermission(req, res, "commitHistory")
  // gate on PUT /suppliers/invoices/reopen/:date.
  const canManageLock = user?.role === 'superadmin'
    || (user?.role === 'admin' && Array.isArray(user?.permissions) && user.permissions.includes('commitHistory'));

  const fetchDates = useCallback(async (options = {}) => {
    const { silent = false } = options;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/suppliers/invoices/dates`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();

      const summaryData = await res.json();
      const sortedRows = [...(Array.isArray(summaryData) ? summaryData : [])].sort((a, b) => b.date.localeCompare(a.date));
      setDateRows(sortedRows);
    } catch {
      if (!silent) {
        showToast('Failed to load invoice dates');
      }
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  useEffect(() => { fetchDates(); }, [fetchDates]);

  const filteredRows = dateRows.filter((row) => {
    if (startDate && row.date < startDate) return false;
    if (endDate && row.date > endDate) return false;
    return true;
  });

  const rangeLabel = startDate || endDate
    ? [startDate, endDate].filter(Boolean).join(' to ')
    : '';

  const handleApplyRange = () => {
    if (startDate && endDate && startDate > endDate) {
      setRangeError('End date cannot be earlier than start date.');
      return;
    }
    setRangeError('');
    setSelectedDate(null);
  };

  const handleClearFilter = () => {
    const today = todayStr();
    setStartDate(today);
    setEndDate(today);
    setRangeError('');
    setSelectedDate(today);
  };

  return (
    <motion.div
      className="si-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >

      <button className="si-back-btn si-no-print" onClick={() => navigate(backPath)}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="si-page-header si-no-print">
        <h1 className="si-page-title"><FiFileText /> Supplier Payout</h1>
        <p className="si-page-sub">
          {selectedDate
            ? `Viewing ${fmtDateLong(selectedDate)}`
            : 'Choose a date range or click a date to view invoices'}
        </p>
      </div>

      <div className="si-filter-toolbar si-no-print">
        <div className="si-filter-card">
          <div className="si-filter-card-head">
            <span className="si-filter-card-icon"><FiCalendar /></span>
            <span className="si-filter-card-title">Today</span>
          </div>
          <div className="si-filter-card-body">
            <p className="si-filter-hint">Reset the range below back to today in one click.</p>
            <div className="si-filter-actions">
              <button type="button" className="si-today-btn" onClick={handleClearFilter}>
                Today
              </button>
            </div>
          </div>
        </div>

        <div className="si-filter-card">
          <div className="si-filter-card-head">
            <span className="si-filter-card-icon"><FiCalendar /></span>
            <span className="si-filter-card-title">Date range</span>
          </div>
          <div className="si-filter-card-body">
            <div className="si-filter-field">
              <label className="si-filter-label">Start Date</label>
              <input
                type="date"
                className="si-date-input"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (rangeError) setRangeError('');
                }}
              />
            </div>

            <div className="si-filter-field">
              <label className="si-filter-label">End Date</label>
              <input
                type="date"
                className="si-date-input"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  if (rangeError) setRangeError('');
                }}
              />
            </div>

            <div className="si-filter-actions">
              <button className="si-apply-btn" onClick={handleApplyRange}>Apply</button>
            </div>
          </div>
        </div>

        <button className="si-clear-btn si-clear-btn--standalone" onClick={handleClearFilter}>
          <FiX /> Reset to Today
        </button>
      </div>

      {rangeError && <div className="si-range-error si-no-print">{rangeError}</div>}

      {startDate && endDate && !rangeError && (
        <PayoutReport fromDate={startDate} toDate={endDate} token={user.token} />
      )}

      <div className="si-no-print">
        {selectedDate ? (
          <DateDetail
            date={selectedDate}
            onBack={() => setSelectedDate(null)}
            token={user.token}
            canManageLock={canManageLock}
          />
        ) : (
          <DateList
            rows={filteredRows}
            onSelect={(date) => setSelectedDate(date)}
            loading={loading}
            selectedDate={selectedDate}
            rangeLabel={rangeLabel}
          />
        )}
      </div>

    </motion.div>
  );
};
