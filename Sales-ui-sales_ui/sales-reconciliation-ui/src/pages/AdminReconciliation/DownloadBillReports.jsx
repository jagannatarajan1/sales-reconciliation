import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FiSearch, FiCheckCircle, FiUser, FiKey, FiClock, FiAlertTriangle,
  FiCreditCard, FiDollarSign, FiTrendingDown, FiPackage, FiAward, FiGrid,
  FiInbox, FiFileText, FiPrinter, FiDownload, FiBarChart2, FiArrowLeft,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';
const REPORTS_URL = `${API_BASE}/admin/reports`;

const fmtGBP = (val) => {
  if (val == null) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : `£${n.toFixed(2)}`;
};

const varianceCls = (val) => {
  if (val == null) return '';
  const abs = Math.abs(parseFloat(val));
  if (isNaN(abs) || abs === 0) return 'ar-rpt-ok';
  if (abs <= 5) return 'ar-rpt-warn';
  return 'ar-rpt-bad';
};

const fmtDateLong = (str) =>
  new Date(str).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const fmtDateMed = (str) =>
  new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtDateTime = (str) =>
  new Date(str).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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

const gridVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } };
const cardVariants = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } } };

const reconciliationStatus = (row) =>
  row.isAdminReconciled ? 'Reconciled' : row.isStaffCommitted ? 'Committed' : 'Pending';

function ReportCard({ row, isSelected, onClick }) {
  const status = reconciliationStatus(row);
  return (
    <motion.div
      className={`ar-rpt-item${isSelected ? ' ar-rpt-item--active' : ''}`}
      onClick={onClick}
      variants={cardVariants}
      whileHover={{ y: -3 }}
    >
      <span className="ar-rpt-item-text">{fmtDateMed(row.date)}</span>
      <span className={`ar-rpt-status-pill ar-rpt-status-pill--${status.toLowerCase()}`}>{status}</span>
      <span className="ar-rpt-item-hint">{isSelected ? 'Open' : 'View'}</span>
    </motion.div>
  );
}

function DetailPanel({ detail, onPrint }) {
  if (!detail) return null;

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
      <div className="ar-rpt-print-header">
        <h2>Sales Reconciliation Report</h2>
        <p>{fmtDateLong(detail.date)}</p>
      </div>

      <div className="ar-rpt-detail-head">
        <div>
          <h2 className="ar-rpt-detail-title"><FiSearch /> Full Breakdown</h2>
          <p className="ar-rpt-detail-sub">{fmtDateLong(detail.date)}</p>
        </div>
        <div className="ar-rpt-detail-badges ar-no-print">
          <span className={`ar-rpt-status-pill ar-rpt-status-pill--${reconciliationStatus(detail).toLowerCase()}`}>
            {reconciliationStatus(detail)}
          </span>
          {detail.zReportAvailable
            ? <span className="ar-rpt-badge ar-rpt-badge--ok"><FiCheckCircle /> Z-Report Available</span>
            : <span className="ar-rpt-badge ar-rpt-badge--na">Z-Report Unavailable</span>}
          <button className="ar-rpt-print-btn" onClick={onPrint}><FiPrinter /> Print</button>
        </div>
      </div>

      <div className="ar-rpt-meta-row">
        {detail.committedByName ? (
          <div className="ar-rpt-meta-item">
            <span className="ar-label">Committed By</span>
            <span className="ar-rpt-meta-value"><FiUser /> {detail.committedByName}</span>
          </div>
        ) : detail.adminSubmittedByName ? (
          <div className="ar-rpt-meta-item">
            <span className="ar-label">Committed By</span>
            <span className="ar-rpt-meta-value"><FiKey /> Admin only</span>
          </div>
        ) : null}
        {detail.committedAt && (
          <div className="ar-rpt-meta-item">
            <span className="ar-label">Committed At</span>
            <span className="ar-rpt-meta-value"><FiClock /> {fmtDateTime(detail.committedAt)}</span>
          </div>
        )}
        {detail.adminSubmittedByName && (
          <div className="ar-rpt-meta-item">
            <span className="ar-label">Admin Submitted By</span>
            <span className="ar-rpt-meta-value"><FiKey /> {detail.adminSubmittedByName}</span>
          </div>
        )}
        {detail.adminSubmittedAt && (
          <div className="ar-rpt-meta-item">
            <span className="ar-label">Admin Submitted At</span>
            <span className="ar-rpt-meta-value"><FiClock /> {fmtDateTime(detail.adminSubmittedAt)}</span>
          </div>
        )}
      </div>

      {!detail.zReportAvailable && (
        <div className="ar-rpt-zreport-warn">
          <FiAlertTriangle /> Z-Report was not available for this date — comparison columns show entered values only.
        </div>
      )}

      {sections.map(({ name, rows }) => {
        const meta = SECTION_META[name] ?? { color: 'blue', icon: FiFileText };
        const SectionIcon = meta.icon;
        return (
          <div key={name} className={`ar-section ar-section--${meta.color}`}>
            <div className="ar-section-header">
              <SectionIcon />
              <span>{name}</span>
            </div>
            <table className="ar-rpt-compare-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Entered Value</th>
                  <th>Z-Report Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.field}>
                    <td className="ar-rpt-field-label">{f.field}</td>
                    <td className="ar-rpt-field-val">{fmtGBP(f.staffValue)}</td>
                    <td className="ar-rpt-field-val ar-rpt-field-zreport">
                      {detail.zReportAvailable ? fmtGBP(f.zReportValue) : <span className="ar-rpt-na">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="ar-section ar-section--rose">
        <div className="ar-section-header"><FiBarChart2 /><span>Totals</span></div>
        <table className="ar-rpt-compare-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Entered Value</th>
              <th>Z-Report Value</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ar-rpt-field-label">Total</td>
              <td className="ar-rpt-field-val">{fmtGBP(detail.staffTotal)}</td>
              <td className="ar-rpt-field-val ar-rpt-field-zreport">
                {detail.zReportAvailable ? fmtGBP(detail.zReportTotal) : <span className="ar-rpt-na">—</span>}
              </td>
              <td className={`ar-rpt-field-val ${detail.zReportAvailable ? varianceCls(detail.totalVariance) : ''}`}>
                {detail.zReportAvailable ? fmtGBP(detail.totalVariance) : <span className="ar-rpt-na">—</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {detail.staffNotes && (
        <div className="ar-committed-notes">
          <span className="ar-label">Staff Notes</span>
          <p>{detail.staffNotes}</p>
        </div>
      )}

      {detail.adminNotes && (
        <div className="ar-committed-notes">
          <span className="ar-label">Admin Notes</span>
          <p>{detail.adminNotes}</p>
        </div>
      )}
    </>
  );
}

// Admin ↔ Reconciliation Review ↔ Download Bill. Browses committed
// reconciliation history with a full field-by-field Z-Report comparison per
// date, and exports a date range as PDF or Excel — replaces the previous
// raw-Z-report-email ZIP download on this tab. Backed by /api/admin/reports,
// gated on the "commitHistory" permission (same as the rest of this page).
export const DownloadBillReports = () => {
  const { user } = useAuth();
  const { showToast: notify } = useToast();
  const showToast = (message, type = 'success') => notify(message, type);

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
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  const downloadFile = async (url, fallbackFileName) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${user.token}` } });
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

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);

        const res = await fetch(`${REPORTS_URL}${params.toString() ? `?${params.toString()}` : ''}`, {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = async (date) => {
    setSelectedDate(date);
    setLoadingDetail(true);
    setDetail(null);
    try {
      const res = await fetch(`${REPORTS_URL}/${date}`, { headers: { Authorization: `Bearer ${user.token}` } });
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
      const res = await fetch(`${REPORTS_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setReports([...data].sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch {
      showToast('Failed to load reports for the selected range', 'error');
    } finally {
      setRangeLoading(false);
      setLoading(false);
    }
  };

  const handleStartDateChange = (value) => {
    setStartDate(value);
    if (endDate && value > endDate) setEndDate(value);
    if (rangeError) setRangeError('');
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
      const res = await fetch(`${REPORTS_URL}/download-pdf?${params.toString()}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();

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

  const handleDownloadExcel = async () => {
    if (!isRangeValid || !startDate || !endDate) {
      showToast('Select a valid date range to download the Excel file', 'error');
      return;
    }
    setIsExportingExcel(true);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      await downloadFile(
        `${REPORTS_URL}/download-excel?${params.toString()}`,
        `sales-reconciliation-${startDate}-to-${endDate}.xlsx`
      );
      showToast('Download started', 'success');
    } catch {
      showToast('Failed to download Excel file', 'error');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handlePrintDetail = () => window.print();

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
      const res = await fetch(REPORTS_URL, { headers: { Authorization: `Bearer ${user.token}` } });
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
    <div className="ar-rpt-root">
      <div className="ar-rpt-picker ar-no-print">
        <div className="ar-picker-row ar-picker-row--inline">
          <label className="ar-label" htmlFor="ar-rpt-start-date">Start Date</label>
          <input
            id="ar-rpt-start-date"
            type="date"
            className="ar-date-input"
            value={startDate}
            max={endDate || new Date().toISOString().split('T')[0]}
            onChange={(e) => handleStartDateChange(e.target.value)}
          />
        </div>
        <div className="ar-picker-row ar-picker-row--inline">
          <label className="ar-label" htmlFor="ar-rpt-end-date">End Date</label>
          <input
            id="ar-rpt-end-date"
            type="date"
            className="ar-date-input"
            value={endDate}
            min={startDate || undefined}
            max={new Date().toISOString().split('T')[0]}
            onChange={(e) => handleEndDateChange(e.target.value)}
          />
        </div>
        <div className="ar-filter-actions">
          <button
            className="ar-filter-apply-btn"
            onClick={handleApplyRange}
            disabled={rangeLoading || loading || !startDate || !endDate || !isRangeValid}
          >
            {rangeLoading ? 'Applying…' : 'Apply'}
          </button>
          <button className="ar-filter-clear-btn" onClick={handleClearFilter}>
            Clear Filter
          </button>
          <button
            className="ar-download-btn"
            onClick={handleDownloadPdf}
            disabled={isExporting || rangeLoading || loading || reports.length === 0 || !isRangeValid}
          >
            <FiDownload /> {isExporting ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            className="ar-download-btn"
            onClick={handleDownloadExcel}
            disabled={isExportingExcel || rangeLoading || loading || reports.length === 0 || !isRangeValid}
          >
            <FiFileText /> {isExportingExcel ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
        {rangeError ? (
          <p className="ar-filter-error">{rangeError}</p>
        ) : (
          <p className="ar-rpt-range-summary">{rangeSummary}</p>
        )}
      </div>

      {loading || rangeLoading ? (
        <div className="ar-center ar-no-print">
          <div className="ar-spinner" />
          <p>Loading reports…</p>
        </div>
      ) : loadingDetail ? (
        <div className="ar-center ar-no-print">
          <div className="ar-spinner" />
          <p>Loading breakdown…</p>
        </div>
      ) : selectedDate && detail ? (
        <div className="ar-rpt-detail-panel">
          <div className="ar-rpt-detail-toolbar ar-no-print">
            <button className="ar-edit-btn" onClick={handleBackToList}><FiArrowLeft /> Back to reports</button>
          </div>
          <DetailPanel detail={detail} onPrint={handlePrintDetail} />
        </div>
      ) : reports.length === 0 ? (
        <div className="ar-empty ar-no-print">
          <div className="ar-empty-icon"><FiInbox /></div>
          <h3>No reports found for this range</h3>
          <p>Try widening the date range or selecting a different period.</p>
        </div>
      ) : (
        <motion.div className="ar-rpt-grid ar-no-print" variants={gridVariants} initial="hidden" animate="visible">
          {reports.map((row) => (
            <ReportCard
              key={row.date}
              row={row}
              isSelected={row.date === selectedDate}
              onClick={() => handleCardClick(row.date)}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
};
