import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiMail, FiCheckCircle, FiXCircle, FiDownload, FiPrinter,
  FiFileText, FiInbox, FiEye,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import './AdminZReports.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const getInputDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDefaultStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return getInputDate(date);
};

const getDefaultEndDate = () => getInputDate(new Date());

const fmtDateMed = (str) =>
  new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtDateLong = (str) =>
  new Date(str).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const fmtDateTime = (str) =>
  new Date(str).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const gridVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.03 } } };
const cardVariants = { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] } } };

export const AdminZReports = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast: notify } = useToast();
  const showToast = (message, type = 'success') => notify(message, type);

  const [fromDate, setFromDate] = useState(getDefaultStartDate());
  const [toDate, setToDate] = useState(getDefaultEndDate());
  const [rangeError, setRangeError] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [selectedDate, setSelectedDate] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null);

  const [downloadingRange, setDownloadingRange] = useState(false);
  const [downloadingSingle, setDownloadingSingle] = useState(false);

  const isRangeValid = Boolean(fromDate && toDate && new Date(toDate) >= new Date(fromDate));

  const downloadBlob = async (url, fallbackFileName) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${user.token}` } });
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

  const loadRange = async (event) => {
    event?.preventDefault();
    if (!fromDate || !toDate) {
      setRangeError('Please select both dates.');
      return;
    }
    if (!isRangeValid) {
      setRangeError('End date cannot be earlier than the start date.');
      return;
    }
    setRangeError('');
    setLoading(true);
    setSelectedDate(null);
    setDetail(null);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const res = await fetch(`${API_BASE}/z-reports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items ?? []);
      setHasSearched(true);
    } catch {
      showToast('Failed to load Z-reports for this range', 'error');
    } finally {
      setLoading(false);
    }
  };

  const viewDate = async (date) => {
    setSelectedDate(date);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`${API_BASE}/z-reports/${date}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      setDetail(await res.json());
    } catch {
      showToast(`Failed to load the Z-report for ${fmtDateMed(date)}`, 'error');
      setSelectedDate(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDownloadSingle = async (date) => {
    setDownloadingSingle(true);
    try {
      await downloadBlob(`${API_BASE}/z-reports/${date}/download-pdf`, `zreport-bill-${date}.pdf`);
      showToast('Download started');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDownloadingSingle(false);
    }
  };

  const handleDownloadRange = async () => {
    if (!isRangeValid) {
      showToast('Select a valid date range to download', 'error');
      return;
    }
    setDownloadingRange(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      await downloadBlob(
        `${API_BASE}/z-reports/download-pdf-range?${params.toString()}`,
        `zreports-${fromDate}-to-${toDate}.zip`,
      );
      showToast('Download started');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDownloadingRange(false);
    }
  };

  const handlePrint = () => window.print();

  const foundCount = items.filter((i) => i.found).length;

  return (
    <motion.div
      className="zr-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <button className="zr-back-btn zr-no-print" onClick={() => navigate('/admin/dashboard')}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="zr-page-header zr-no-print">
        <h1 className="zr-page-title"><FiMail /> Z Reports</h1>
        <p className="zr-page-sub">
          Browse Z-report emails received over a date range — view the raw text, or download as PDF.
        </p>
      </div>

      <div className="zr-picker-panel zr-no-print">
        <div className="zr-picker-row zr-picker-row--stacked">
          <div className="zr-picker-field">
            <label className="zr-picker-label" htmlFor="zr-from-date">From Date</label>
            <input
              id="zr-from-date"
              type="date"
              className="zr-date-input"
              value={fromDate}
              max={toDate || new Date().toISOString().split('T')[0]}
              onChange={(e) => { setFromDate(e.target.value); setRangeError(''); }}
            />
          </div>
          <div className="zr-picker-field">
            <label className="zr-picker-label" htmlFor="zr-to-date">To Date</label>
            <input
              id="zr-to-date"
              type="date"
              className="zr-date-input"
              value={toDate}
              min={fromDate || undefined}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => { setToDate(e.target.value); setRangeError(''); }}
            />
          </div>
          <button className="zr-picker-btn" onClick={loadRange} disabled={loading || !isRangeValid}>
            {loading ? 'Loading…' : 'Browse'}
          </button>
          <button
            className="zr-picker-btn zr-picker-btn--secondary"
            onClick={handleDownloadRange}
            disabled={downloadingRange || loading || !isRangeValid || foundCount === 0}
          >
            <FiDownload /> {downloadingRange ? 'Preparing…' : 'Download Range (ZIP)'}
          </button>
        </div>
        {rangeError && <p className="zr-range-error">{rangeError}</p>}
        {hasSearched && !rangeError && (
          <p className="zr-range-summary">
            {items.length} date{items.length !== 1 ? 's' : ''} in range — {foundCount} with a Z-report email found
          </p>
        )}
      </div>

      {loading ? (
        <div className="zr-center zr-no-print">
          <div className="zr-spinner" />
          <p>Loading Z-reports…</p>
        </div>
      ) : detailLoading ? (
        <div className="zr-center zr-no-print">
          <div className="zr-spinner" />
          <p>Loading report…</p>
        </div>
      ) : selectedDate && detail ? (
        <div className="zr-detail-panel">
          <div className="zr-detail-toolbar zr-no-print">
            <button className="zr-back-btn" onClick={() => { setSelectedDate(null); setDetail(null); }}>
              <FiArrowLeft /> Back to list
            </button>
            <div className="zr-detail-actions">
              <button className="zr-action-btn" onClick={handlePrint}>
                <FiPrinter /> Print
              </button>
              <button
                className="zr-action-btn"
                onClick={() => handleDownloadSingle(selectedDate)}
                disabled={downloadingSingle || !detail.found}
              >
                <FiDownload /> {downloadingSingle ? 'Preparing…' : 'Download PDF'}
              </button>
            </div>
          </div>

          <div className="zr-print-header">
            <h2>Z-Report — {fmtDateLong(detail.date)}</h2>
            {detail.receivedAt && <p>Received: {fmtDateTime(detail.receivedAt)}</p>}
          </div>

          {detail.found ? (
            <pre className="zr-report-body">{detail.body}</pre>
          ) : (
            <div className="zr-empty-inline zr-no-print">
              <FiXCircle /> No Z-report email found for this date.
            </div>
          )}
        </div>
      ) : hasSearched && items.length === 0 ? (
        <div className="zr-empty-panel zr-no-print">
          <div className="zr-empty-icon"><FiInbox /></div>
          <h3>No dates in this range</h3>
          <p>Try widening the date range.</p>
        </div>
      ) : hasSearched ? (
        <motion.div className="zr-grid zr-no-print" variants={gridVariants} initial="hidden" animate="visible">
          {items.map((item) => (
            <motion.div
              key={item.date}
              className={`zr-item${item.found ? ' zr-item--found' : ' zr-item--missing'}`}
              variants={cardVariants}
              whileHover={{ y: -3 }}
            >
              <div className="zr-item-date">{fmtDateMed(item.date)}</div>
              <div className={`zr-item-status ${item.found ? 'zr-status-ok' : 'zr-status-na'}`}>
                {item.found ? <><FiCheckCircle /> Found</> : <><FiXCircle /> Not Found</>}
              </div>
              <div className="zr-item-actions">
                {item.found && (
                  <>
                    <button className="zr-item-btn" onClick={() => viewDate(item.date)}>
                      <FiEye /> View
                    </button>
                    <button className="zr-item-btn" onClick={() => handleDownloadSingle(item.date)} disabled={downloadingSingle}>
                      <FiFileText /> PDF
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <div className="zr-empty-panel zr-no-print">
          <div className="zr-empty-icon"><FiMail /></div>
          <h3>Pick a date range and click Browse</h3>
          <p>Z-report emails are checked day-by-day against the connected Gmail inbox.</p>
        </div>
      )}
    </motion.div>
  );
};

export default AdminZReports;
