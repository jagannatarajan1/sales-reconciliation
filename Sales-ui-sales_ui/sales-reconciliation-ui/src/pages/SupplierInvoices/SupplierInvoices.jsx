import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiFileText, FiCalendar, FiBriefcase, FiUser, FiDollarSign, FiX,
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
function DateDetail({ date, onBack, token }) {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const { showToast: notify } = useToast();

  const showToast = (message, type = 'error') => notify(message, type);

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
  }, [date, token]);

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

/* ── Main component ─────────────────────────────────────────────────── */
export const SupplierInvoices = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast: notify } = useToast();
  const [loading, setLoading]       = useState(true);
  const [dateRows, setDateRows]     = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [specificDate, setSpecificDate] = useState(todayStr());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rangeError, setRangeError] = useState('');

  const showToast = (message, type = 'error') => notify(message, type);

  const backPath = user?.role === 'admin' ? '/admin/dashboard' : '/dashboard';

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

  const handleViewSpecificDate = () => {
    if (!specificDate) return;
    setRangeError('');
    setSelectedDate(specificDate);
  };

  const handleApplyRange = () => {
    if (startDate && endDate && startDate > endDate) {
      setRangeError('End date cannot be earlier than start date.');
      return;
    }
    setRangeError('');
    setSelectedDate(null);
  };

  const handleClearFilter = () => {
    setStartDate('');
    setEndDate('');
    setRangeError('');
    setSpecificDate(todayStr());
    setSelectedDate(todayStr());
  };

  return (
    <motion.div
      className="si-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >

      <button className="si-back-btn" onClick={() => navigate(backPath)}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="si-page-header">
        <h1 className="si-page-title"><FiFileText /> Supplier Payout</h1>
        <p className="si-page-sub">
          {selectedDate
            ? `Viewing ${fmtDateLong(selectedDate)}`
            : 'Choose a date range or click a date to view invoices'}
        </p>
      </div>

      <div className="si-filter-toolbar">
        <div className="si-filter-card">
          <div className="si-filter-card-head">
            <span className="si-filter-card-icon"><FiCalendar /></span>
            <span className="si-filter-card-title">Specific date</span>
          </div>
          <div className="si-filter-card-body">
            <div className="si-filter-field">
              <label className="si-filter-label">Date</label>
              <input
                type="date"
                className="si-date-input"
                value={specificDate}
                onChange={(e) => setSpecificDate(e.target.value)}
              />
            </div>
            <div className="si-filter-actions">
              <button
                type="button"
                className="si-today-btn"
                onClick={() => { setSpecificDate(todayStr()); setRangeError(''); setSelectedDate(todayStr()); }}
              >
                Today
              </button>
              <button className="si-apply-btn" onClick={handleViewSpecificDate}>View</button>
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
          <FiX /> Clear filters
        </button>
      </div>

      {rangeError && <div className="si-range-error">{rangeError}</div>}

      {selectedDate ? (
        <DateDetail
          date={selectedDate}
          onBack={() => setSelectedDate(null)}
          token={user.token}
        />
      ) : (
        <DateList
          rows={filteredRows}
          onSelect={(date) => {
            setSpecificDate(date);
            setSelectedDate(date);
          }}
          loading={loading}
          selectedDate={selectedDate}
          rangeLabel={rangeLabel}
        />
      )}

    </motion.div>
  );
};
