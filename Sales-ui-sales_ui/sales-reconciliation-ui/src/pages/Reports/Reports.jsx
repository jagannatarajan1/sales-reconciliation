import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiBarChart2, FiSearch, FiCheckCircle, FiUser, FiKey,
  FiClock, FiAlertTriangle, FiCreditCard, FiDollarSign, FiTrendingDown, FiPackage,
  FiAward, FiGrid, FiInbox, FiFileText,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import './Reports.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

/* ── Formatters ─────────────────────────────────────────────────────── */
const fmtGBP = (val) => {
  if (val == null) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : `£${n.toFixed(2)}`;
};

const varianceCls = (val) => {
  if (val == null) return '';
  const abs = Math.abs(parseFloat(val));
  if (isNaN(abs) || abs === 0) return 'rpt-ok';
  if (abs <= 5) return 'rpt-warn';
  return 'rpt-bad';
};

const fmtDateLong = (str) =>
  new Date(str).toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

const fmtDateMed = (str) =>
  new Date(str).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

const fmtDateTime = (str) =>
  new Date(str).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const getInputDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDefaultStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return getInputDate(date);
};

const getDefaultEndDate = () => getInputDate(new Date());


const SECTION_META = {
  'Credit Card':     { color: 'blue',   icon: FiCreditCard },
  'Cash':            { color: 'green',  icon: FiDollarSign },
  'Deductions':      { color: 'orange', icon: FiTrendingDown },
  'Instant Lottery': { color: 'purple', icon: FiPackage },
  'Lottery':         { color: 'gold',   icon: FiAward },
  'Paypoint':        { color: 'teal',   icon: FiGrid },
};

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
};

/* ── Summary card ───────────────────────────────────────────────────── */
function ReportCard({ row, isSelected, onClick, compact = false }) {
  return (
    <motion.div
      className={`rpt-date-item${isSelected ? ' rpt-date-item--active' : ''}${compact ? ' rpt-date-item--compact' : ''}`}
      onClick={onClick}
      variants={cardVariants}
      whileHover={{ y: -3 }}
    >
      <span className="rpt-date-item-text">{fmtDateMed(row.date)}</span>
      <span className="rpt-date-item-hint">{isSelected ? 'Open' : 'View'}</span>
    </motion.div>
  );
}

/* ── Detail breakdown panel ─────────────────────────────────────────── */
function DetailPanel({ detail }) {
  if (!detail) return null;

  // Group detail.fields by section, preserving API order
  const sections = [];
  const sectionMap = {};
  for (const f of (detail.fields ?? [])) {
    if (!sectionMap[f.section]) {
      sectionMap[f.section] = [];
      sections.push({ name: f.section, rows: sectionMap[f.section] });
    }
    sectionMap[f.section].push(f);
  }

  return (
    <>
      <div className="rpt-detail-head">
        <div>
          <h2 className="rpt-detail-title"><FiSearch /> Full Breakdown</h2>
          <p className="rpt-detail-sub">{fmtDateLong(detail.date)}</p>
        </div>
        <div className="rpt-detail-badges">
          {detail.zReportAvailable
            ? <span className="rpt-badge rpt-badge--ok"><FiCheckCircle /> Z-Report Available</span>
            : <span className="rpt-badge rpt-badge--na">Z-Report Unavailable</span>}
          {detail.isStaffCommitted  && <span className="rpt-badge rpt-badge--staff">Staff</span>}
          {detail.isAdminReconciled && <span className="rpt-badge rpt-badge--admin">Admin</span>}
        </div>
      </div>

      <div className="rpt-meta-row">
        {detail.committedByName ? (
          <div className="rpt-meta-item">
            <span className="rpt-meta-label">Committed By</span>
            <span className="rpt-meta-value"><FiUser /> {detail.committedByName}</span>
          </div>
        ) : detail.adminSubmittedByName ? (
          <div className="rpt-meta-item">
            <span className="rpt-meta-label">Committed By</span>
            <span className="rpt-meta-value"><FiKey /> Admin only</span>
          </div>
        ) : null}
        {detail.committedAt && (
          <div className="rpt-meta-item">
            <span className="rpt-meta-label">Committed At</span>
            <span className="rpt-meta-value"><FiClock /> {fmtDateTime(detail.committedAt)}</span>
          </div>
        )}
        {detail.adminSubmittedByName && (
          <div className="rpt-meta-item">
            <span className="rpt-meta-label">Admin Submitted By</span>
            <span className="rpt-meta-value"><FiKey /> {detail.adminSubmittedByName}</span>
          </div>
        )}
        {detail.adminSubmittedAt && (
          <div className="rpt-meta-item">
            <span className="rpt-meta-label">Admin Submitted At</span>
            <span className="rpt-meta-value"><FiClock /> {fmtDateTime(detail.adminSubmittedAt)}</span>
          </div>
        )}
      </div>

      {!detail.zReportAvailable && (
        <div className="rpt-zreport-warn">
          <FiAlertTriangle /> Z-Report was not available for this date — comparison columns show staff values only.
        </div>
      )}

      {/* Per-section comparison tables built directly from API fields */}
      {sections.map(({ name, rows }) => {
        const meta = SECTION_META[name] ?? { color: 'blue', icon: FiFileText };
        const SectionIcon = meta.icon;
        return (
          <div key={name} className={`rpt-section rpt-section--${meta.color}`}>
            <div className="rpt-section-header">
              <SectionIcon />
              <span>{name}</span>
            </div>
            <table className="rpt-compare-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Staff Value</th>
                  <th>Z-Report Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.field}>
                    <td className="rpt-field-label">{f.field}</td>
                    <td className="rpt-field-val">{fmtGBP(f.staffValue)}</td>
                    <td className="rpt-field-val rpt-field-zreport">
                      {detail.zReportAvailable ? fmtGBP(f.zReportValue) : <span className="rpt-na">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Totals */}
      <div className="rpt-section rpt-section--rose">
        <div className="rpt-section-header"><FiBarChart2 /><span>Totals</span></div>
        <table className="rpt-compare-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Staff Value</th>
              <th>Z-Report Value</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="rpt-field-label">Total</td>
              <td className="rpt-field-val">{fmtGBP(detail.staffTotal)}</td>
              <td className="rpt-field-val rpt-field-zreport">
                {detail.zReportAvailable ? fmtGBP(detail.zReportTotal) : <span className="rpt-na">—</span>}
              </td>
              <td className={`rpt-field-val ${detail.zReportAvailable ? varianceCls(detail.totalVariance) : ''}`}>
                {detail.zReportAvailable ? fmtGBP(detail.totalVariance) : <span className="rpt-na">—</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {detail.adminNotes && (
        <div className="rpt-notes">
          <span className="rpt-notes-label">Admin Notes</span>
          <p>{detail.adminNotes}</p>
        </div>
      )}
    </>
  );
}

/* ── Main component ─────────────────────────────────────────────────── */
export const Reports = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast: notify } = useToast();

  const [loading, setLoading]             = useState(true);
  const [reports, setReports]             = useState([]);
  const [selectedDate, setSelectedDate]   = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail]               = useState(null);
  const [startDate, setStartDate]         = useState(getDefaultStartDate());
  const [endDate, setEndDate]             = useState(getDefaultEndDate());
  const [rangeError, setRangeError]       = useState('');
  const [rangeLoading, setRangeLoading]   = useState(false);
  const [isExporting, setIsExporting]     = useState(false);

  const showToast = (message, type = 'success') => notify(message, type);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        const res = await fetch(`${API_BASE}/reports${params.toString() ? `?${params.toString()}` : ''}`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setReports([...data].sort((a, b) => new Date(b.date) - new Date(a.date)));
      } catch {
        showToast('Failed to load reports', 'error');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [user.token]);

  const loadDetail = async (date) => {
    setSelectedDate(date);
    setLoadingDetail(true);
    setDetail(null);
    try {
      const res = await fetch(`${API_BASE}/reports/${date}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      setDetail(await res.json());
    } catch {
      showToast(`No report found for ${fmtDateMed(date)}`, 'error');
      setSelectedDate(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleCardClick = (date) => {
    if (selectedDate === date) {
      setSelectedDate(null);
      setDetail(null);
      return;
    }
    loadDetail(date);
  };

  const isRangeValid = Boolean(startDate && endDate && new Date(endDate) >= new Date(startDate));
  const rangeSummary = startDate && endDate
    ? `Showing reports from ${fmtDateMed(startDate)} to ${fmtDateMed(endDate)}`
    : 'Showing all available reports';

  const handleApplyRange = async (event) => {
    event?.preventDefault();

    if (!startDate || !endDate) {
      setRangeError('Please select both dates.');
      return;
    }

    if (!isRangeValid) {
      setRangeError('End date cannot be earlier than the start date.');
      return;
    }

    setRangeError('');
    setSelectedDate(null);
    setDetail(null);
    setRangeLoading(true);
    setLoading(true);

    try {
      const params = new URLSearchParams({ startDate, endDate });
      const res = await fetch(`${API_BASE}/reports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
      setReports(sorted);
      setSelectedDate(null);
      setDetail(null);
    } catch {
      showToast('Failed to load reports for the selected range', 'error');
    } finally {
      setRangeLoading(false);
      setLoading(false);
    }
  };

  const handleStartDateChange = (value) => {
    setStartDate(value);
    if (endDate && value > endDate) {
      setEndDate(value);
    }
    if (rangeError) {
      setRangeError('');
    }
  };

  const handleEndDateChange = (value) => {
    setEndDate(value);
    if (!startDate || !value) {
      if (rangeError) setRangeError('');
      return;
    }
    if (new Date(value) < new Date(startDate)) {
      setRangeError('End date cannot be earlier than the start date.');
    } else if (rangeError) {
      setRangeError('');
    }
  };

  const handleDownloadPdf = async () => {
    if (!isRangeValid || !startDate || !endDate) {
      showToast('Select a valid date range to download the PDF', 'error');
      return;
    }

    setIsExporting(true);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const res = await fetch(`${API_BASE}/reports/download-pdf?${params.toString()}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();

      // The backend returns a single PDF for one date, or a ZIP of one PDF per date
      // when the range spans more than one — download whichever it sent, using its
      // own filename (falls back to a sensible name if the header is ever missing).
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const fallbackExt = contentType.includes('zip') ? 'zip' : 'pdf';
      const fileName = match ? match[1] : `reconciliation-reports-${startDate}-to-${endDate}.${fallbackExt}`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      showToast('Download started', 'success');
    } catch {
      showToast('Failed to download PDF', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackToList = () => {
    setSelectedDate(null);
    setDetail(null);
  };

  const handleClearFilter = async () => {
    const defaultStart = getDefaultStartDate();
    const defaultEnd = getDefaultEndDate();
    setStartDate(defaultStart);
    setEndDate(defaultEnd);
    setRangeError('');
    setSelectedDate(null);
    setDetail(null);
    setRangeLoading(true);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/reports`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setReports([...data].sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch {
      showToast('Failed to reset reports', 'error');
    } finally {
      setRangeLoading(false);
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="rpt-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >

      <button className="rpt-back-btn" onClick={() => navigate('/admin/dashboard')}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="rpt-page-header">
        <h1 className="rpt-page-title"><FiBarChart2 /> Reconciliation Reports</h1>
        <p className="rpt-page-sub">
          Date-wise history — staff entered values, Z-Report comparison, variance and who completed each reconciliation.
        </p>
      </div>

      <div className="rpt-picker-panel">
        <div className="rpt-picker-row rpt-picker-row--stacked">
          <div className="rpt-picker-field">
            <label className="rpt-picker-label" htmlFor="rpt-start-date">Start Date</label>
            <input
              id="rpt-start-date"
              type="date"
              className="rpt-date-input"
              value={startDate}
              max={endDate || new Date().toISOString().split('T')[0]}
              onChange={(e) => handleStartDateChange(e.target.value)}
            />
          </div>
          <div className="rpt-picker-field">
            <label className="rpt-picker-label" htmlFor="rpt-end-date">End Date</label>
            <input
              id="rpt-end-date"
              type="date"
              className="rpt-date-input"
              value={endDate}
              min={startDate || undefined}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => handleEndDateChange(e.target.value)}
            />
          </div>
          <button
            className="rpt-picker-btn"
            onClick={handleApplyRange}
            disabled={rangeLoading || loading || !startDate || !endDate || !isRangeValid}
          >
            {rangeLoading ? 'Applying…' : 'Apply'}
          </button>
          <button
            className="rpt-picker-btn rpt-picker-btn--secondary"
            onClick={handleClearFilter}
          >
            Clear Filter
          </button>
          <button
            className="rpt-picker-btn rpt-picker-btn--secondary"
            onClick={handleDownloadPdf}
            disabled={isExporting || rangeLoading || loading || reports.length === 0 || !isRangeValid}
          >
            {isExporting ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
        {rangeError ? (
          <p className="rpt-range-error">{rangeError}</p>
        ) : (
          <p className="rpt-range-summary">{rangeSummary}</p>
        )}
      </div>

      {loading || rangeLoading ? (
        <div className="rpt-center">
          <div className="rpt-spinner" />
          <p>Loading reports…</p>
        </div>
      ) : loadingDetail ? (
        <div className="rpt-center">
          <div className="rpt-spinner" />
          <p>Loading breakdown…</p>
        </div>
      ) : selectedDate && detail ? (
        <div className="rpt-detail-panel">
          <div className="rpt-detail-toolbar">
            <button className="rpt-back-btn" onClick={handleBackToList}><FiArrowLeft /> Back to reports</button>
          </div>
          <DetailPanel detail={detail} />
        </div>
      ) : reports.length === 0 ? (
        <div className="rpt-empty-panel">
          <div className="rpt-empty-icon"><FiInbox /></div>
          <h3>No reports found for this range</h3>
          <p>Try widening the date range or selecting a different period.</p>
        </div>
      ) : (
        <motion.div
          className="rpt-grid"
          variants={gridVariants}
          initial="hidden"
          animate="visible"
        >
          {reports.map((row) => (
            <ReportCard
              key={row.date}
              row={row}
              isSelected={row.date === selectedDate}
              onClick={() => handleCardClick(row.date)}
              compact
            />
          ))}
        </motion.div>
      )}

    </motion.div>
  );
};
