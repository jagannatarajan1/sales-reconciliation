import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiRefreshCw, FiAlertCircle, FiCheckCircle, FiChevronLeft, FiChevronRight, FiLock } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import "./ShopSale.css";

const SUMMARY_URL = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/Summary`;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (year, month, day) => `${year}-${pad2(month + 1)}-${pad2(day)}`;

// ── Shop Sale calendar (§1) ──────────────────────────────────────────────
// Full month grid; any date already committed (per
// GET /Summary/committed-dates, which any authenticated staff member can
// call) renders disabled/greyed-out and unclickable. Pending/uncommitted
// dates — and only those — remain selectable. No per-day Z-report info is
// shown inside the cells, just enabled/disabled state.
function ShopSaleCalendar({ token, selectedDate, onSelectDate, onShowActiveDate }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [committedDates, setCommittedDates] = useState(new Set());
  const [loadingDates, setLoadingDates] = useState(false);

  const todayYmd = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  const isCurrentMonthView = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  useEffect(() => {
    if (!token) return;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const fromDate = ymd(viewYear, viewMonth, 1);
    const toDate = ymd(viewYear, viewMonth, daysInMonth);

    setLoadingDates(true);
    fetch(`${SUMMARY_URL}/committed-dates?fromDate=${fromDate}&toDate=${toDate}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : { dates: [] }))
      .then((data) => setCommittedDates(new Set(Array.isArray(data.dates) ? data.dates : [])))
      .catch(() => setCommittedDates(new Set()))
      .finally(() => setLoadingDates(false));
  }, [token, viewYear, viewMonth]);

  const goToPrevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  };

  const goToNextMonth = () => {
    if (isCurrentMonthView) return; // never browse into the future
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  };

  // Build a 7-column grid padded with the previous/next month's days so
  // every week row is complete — those padding cells are always disabled.
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - leadingBlanks + 1;
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
    const dateStr = inMonth ? ymd(viewYear, viewMonth, dayNum) : null;
    cells.push({ dayNum, inMonth, dateStr });
  }

  return (
    <div className="sc-calendar">
      <div className="sc-calendar-nav">
        <button type="button" className="sc-nav-btn" onClick={goToPrevMonth} aria-label="Previous month">
          <FiChevronLeft />
        </button>
        <span className="sc-nav-label">{MONTH_LABELS[viewMonth]} {viewYear}</span>
        <button
          type="button"
          className="sc-nav-btn"
          onClick={goToNextMonth}
          disabled={isCurrentMonthView}
          aria-label="Next month"
        >
          <FiChevronRight />
        </button>
      </div>

      <div className="sc-weekday-row">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="sc-weekday">{w}</span>
        ))}
      </div>

      <div className={`sc-grid${loadingDates ? " sc-grid--loading" : ""}`}>
        {cells.map((cell, idx) => {
          if (!cell.inMonth) {
            return <span key={idx} className="sc-day sc-day--outside" />;
          }
          const isFuture = cell.dateStr > todayYmd;
          const isCommitted = committedDates.has(cell.dateStr);
          const isSelected = selectedDate === cell.dateStr;
          const isToday = cell.dateStr === todayYmd;
          const disabled = isFuture || isCommitted;

          return (
            <button
              key={idx}
              type="button"
              className={[
                "sc-day",
                disabled ? "sc-day--disabled" : "sc-day--pending",
                isSelected ? "sc-day--selected" : "",
                isToday ? "sc-day--today" : "",
              ].filter(Boolean).join(" ")}
              disabled={disabled}
              title={isCommitted ? "Already committed" : isFuture ? "Future date" : undefined}
              onClick={() => onSelectDate(cell.dateStr)}
            >
              {cell.dayNum}
              {isCommitted && <FiLock className="sc-day-lock" />}
            </button>
          );
        })}
      </div>

      <div className="sc-legend">
        <span className="sc-legend-item"><span className="sc-legend-swatch sc-legend-swatch--pending" /> Pending</span>
        <span className="sc-legend-item"><span className="sc-legend-swatch sc-legend-swatch--committed" /> Committed</span>
      </div>

      {selectedDate && (
        <button type="button" className="active-date-btn sc-active-date-btn" onClick={onShowActiveDate}>
          Show Active Date
        </button>
      )}
    </div>
  );
}

const ShopSale = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [emailBody, setEmailBody]               = useState("");
  const [targetDate, setTargetDate]             = useState(null);
  const [emailReceivedDate, setEmailReceivedDate] = useState(null);
  const [isCommitted, setIsCommitted]           = useState(false);
  const [committedMessage, setCommittedMessage] = useState("");
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState("");
  const [selectedDate, setSelectedDate]         = useState("");

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  useEffect(() => { fetchActiveReport(); }, []);

  const resetState = () => {
    setLoading(true);
    setError("");
    setEmailBody("");
    setIsCommitted(false);
    setCommittedMessage("");
    setTargetDate(null);
    setEmailReceivedDate(null);
  };

  const applyResult = (data) => {
    if (data.isCommitted) {
      setIsCommitted(true);
      setCommittedMessage(data.message || "Values are already committed.");
      return;
    }
    setTargetDate(data.targetDate ?? null);
    if (data.email?.date) {
      const parsed = new Date(data.email.date);
      if (!isNaN(parsed)) setEmailReceivedDate(parsed.toISOString().split("T")[0]);
    }
    setEmailBody(data.email?.body ?? "");
  };

  const fetchActiveReport = async () => {
    resetState();
    try {
      const [emailRes, summaryRes] = await Promise.all([
        fetch(`${SUMMARY_URL}/zreport-email`, { headers: authHeaders() }),
        fetch(`${SUMMARY_URL}/today`,          { headers: authHeaders() }),
      ]);

      // If the day is already committed per Summary/today, show committed state
      // regardless of what zreport-email returns (the two can be out of sync)
      if (summaryRes.ok) {
        const summary = await summaryRes.json();
        if (summary.isCommitted) {
          setIsCommitted(true);
          setCommittedMessage("Values are already committed.");
          return;
        }
      }

      if (emailRes.status === 400) {
        const body = await emailRes.json().catch(() => ({}));
        setError(body.message || "No Z-report email found.");
        return;
      }
      if (!emailRes.ok) { setError("Failed to load Z-report."); return; }
      applyResult(await emailRes.json());
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const fetchReportByDate = async (dateStr) => {
    resetState();
    try {
      const res = await fetch(
        `${SUMMARY_URL}/zreport-email/by-date?date=${dateStr}`,
        { headers: authHeaders() }
      );
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        setError(body.message || "No Z-report email found for this date.");
        return;
      }
      if (!res.ok) { setError("Failed to load Z-report."); return; }
      applyResult(await res.json());
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDate = (dateStr) => {
    setSelectedDate(dateStr);
    if (dateStr) fetchReportByDate(dateStr);
  };

  const handleRefresh = () => {
    if (selectedDate) fetchReportByDate(selectedDate);
    else fetchActiveReport();
  };

  const clearDateSelection = () => {
    setSelectedDate("");
    fetchActiveReport();
  };

  const formatDate = (dateStr) =>
    dateStr
      ? new Date(dateStr).toLocaleDateString("en-GB", {
          day: "2-digit", month: "short", year: "numeric",
        })
      : "";

  const subtitle = isCommitted
    ? "Values are committed"
    : emailReceivedDate
    ? `Z-report received ${formatDate(emailReceivedDate)} — pending commit`
    : targetDate
    ? `Showing report for ${formatDate(targetDate)} — pending commit`
    : selectedDate
    ? `Showing report for ${formatDate(selectedDate)}`
    : "Latest report imported from Gmail";

  return (
    <motion.div
      className="shop-sale-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="report-container">

        <button className="back-button" onClick={() => navigate(-1)}>
          <FiArrowLeft /> Back
        </button>

        <div className="report-header">
          <h1>Z-Report Viewer</h1>
          <p>{subtitle}</p>

          <button className="refresh-btn" onClick={handleRefresh}>
            <FiRefreshCw /> Refresh Report
          </button>
        </div>

        <ShopSaleCalendar
          token={user?.token}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          onShowActiveDate={clearDateSelection}
        />

        {loading && (
          <div className="loading-container">
            <p>Loading report...</p>
          </div>
        )}

        {!loading && isCommitted && (
          <div className="committed-notice">
            <FiCheckCircle /> {committedMessage}
          </div>
        )}

        {!loading && error && (
          <div className="error-container"><FiAlertCircle /> {error}</div>
        )}

        {!loading && !isCommitted && !error && emailBody && (
          <div className="report-card">
            <pre className="report-content">{emailBody}</pre>
          </div>
        )}

        {!loading && !isCommitted && !error && !emailBody && (
          <div className="error-container">
            <FiAlertCircle /> No Z-report email found. Please ensure the plain-text Z-report has been received.
          </div>
        )}

      </div>
    </motion.div>
  );
};

export default ShopSale;
