import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiRefreshCw, FiAlertCircle, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import "./ShopSale.css";

const SUMMARY_URL = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/Summary`;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHIFT_META = {
  DAY: { label: "Day Shift", icon: "☀" },
  NIGHT: { label: "Night Shift", icon: "🌙" },
};

const STATUS_LABEL = { OK: "OK", VARIANCE: "Variance", RESOLVED: "Resolved", PENDING: "Pending" };

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (year, month, day) => `${year}-${pad2(month + 1)}-${pad2(day)}`;
const fmtGBP = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? "£0.00" : `£${n.toFixed(2)}`;
};

// ── Shift Reconciliation calendar ───────────────────────────────────────
// Full month grid. Every in-month, non-future date is selectable — unlike
// the old committed/uncommitted gate this page used to enforce, this is a
// read-only status view, so past (including already-committed) dates stay
// visible and browsable. Each cell shows two small dots for that date's
// DAY/NIGHT status, sourced from GET /Summary/shift-calendar — a staff-safe
// endpoint that never computes or returns a Z-Report figure (see
// getStatusCalendar/toStaffStatusDto server-side).
function ShopSaleCalendar({ token, selectedDate, onSelectDate, onShowActiveDate }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [statusByDate, setStatusByDate] = useState(new Map());
  const [loadingDates, setLoadingDates] = useState(false);

  const todayYmd = ymd(today.getFullYear(), today.getMonth(), today.getDate());
  const isCurrentMonthView = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  useEffect(() => {
    if (!token) return;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const fromDate = ymd(viewYear, viewMonth, 1);
    const toDate = ymd(viewYear, viewMonth, daysInMonth);

    setLoadingDates(true);
    fetch(`${SUMMARY_URL}/shift-calendar?fromDate=${fromDate}&toDate=${toDate}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : { dates: [] }))
      .then((data) => {
        const map = new Map();
        (Array.isArray(data.dates) ? data.dates : []).forEach((d) => map.set(d.date, d));
        setStatusByDate(map);
      })
      .catch(() => setStatusByDate(new Map()))
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
          const isSelected = selectedDate === cell.dateStr;
          const isToday = cell.dateStr === todayYmd;
          const status = statusByDate.get(cell.dateStr);

          return (
            <button
              key={idx}
              type="button"
              className={[
                "sc-day",
                isFuture ? "sc-day--disabled" : "sc-day--pending",
                isSelected ? "sc-day--selected" : "",
                isToday ? "sc-day--today" : "",
              ].filter(Boolean).join(" ")}
              disabled={isFuture}
              title={isFuture ? "Future date" : undefined}
              onClick={() => onSelectDate(cell.dateStr)}
            >
              <span>{cell.dayNum}</span>
              {status && (
                <span className="sc-day-dots">
                  <span className={`sc-dot sc-dot--${(status.dayStatus || "pending").toLowerCase()}`} title={`Day: ${STATUS_LABEL[status.dayStatus] ?? status.dayStatus}`} />
                  <span className={`sc-dot sc-dot--${(status.nightStatus || "pending").toLowerCase()}`} title={`Night: ${STATUS_LABEL[status.nightStatus] ?? status.nightStatus}`} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="sc-legend">
        <span className="sc-legend-item"><span className="sc-dot sc-dot--ok" /> OK</span>
        <span className="sc-legend-item"><span className="sc-dot sc-dot--variance" /> Variance</span>
        <span className="sc-legend-item"><span className="sc-dot sc-dot--pending" /> Pending</span>
      </div>
      <p className="sc-legend-note">Each date shows Day / Night shift status.</p>

      {selectedDate && (
        <button type="button" className="active-date-btn sc-active-date-btn" onClick={onShowActiveDate}>
          Show Active Date
        </button>
      )}
    </div>
  );
}

// Read-only per-shift card. Deliberately renders only fields staff are
// allowed to see (see StaffShiftDto server-side) — no admin name, no edit
// reason, no reprint count, and never a Z-Report figure anywhere.
function ShiftStatusCard({ shift, data }) {
  const meta = SHIFT_META[shift];

  if (!data || !data.hasEntries) {
    return (
      <div className="ss-shift-card">
        <div className="ss-shift-card-header">
          <span className="ss-shift-card-icon">{meta.icon}</span>
          <span className="ss-shift-card-title">{meta.label}</span>
          <span className="ss-status-pill ss-status-pill--pending">Pending</span>
        </div>
        <p className="ss-shift-card-empty">
          {data?.originalTotal != null
            ? "X-Report received — enter your shift figures in Summary."
            : "Awaiting the till's X-Report for this shift."}
        </p>
      </div>
    );
  }

  const hasAdjustment = data.adminEditedTotal != null;
  const statusKey = (data.finalStatus || "PENDING").toLowerCase();

  return (
    <div className="ss-shift-card">
      <div className="ss-shift-card-header">
        <span className="ss-shift-card-icon">{meta.icon}</span>
        <span className="ss-shift-card-title">{meta.label}</span>
        <span className={`ss-status-pill ss-status-pill--${statusKey}`}>
          {STATUS_LABEL[data.finalStatus] ?? "Pending"}
        </span>
      </div>
      <div className="ss-shift-card-rows">
        <div className="ss-shift-card-row">
          <span>Original X Report</span>
          <span>{data.originalTotal != null ? fmtGBP(data.originalTotal) : "—"}</span>
        </div>
        <div className="ss-shift-card-row">
          <span>Staff Entered{data.staffEnteredByName ? ` — ${data.staffEnteredByName}` : ""}</span>
          <span>{data.staffEnteredTotal != null ? fmtGBP(data.staffEnteredTotal) : "—"}</span>
        </div>
        <div className="ss-shift-card-row">
          <span>Original Difference</span>
          <span>{data.originalDifference != null ? fmtGBP(data.originalDifference) : "—"}</span>
        </div>
        {hasAdjustment && (
          <>
            <div className="ss-shift-card-divider" />
            <div className="ss-shift-card-row">
              <span>Admin Adjustment</span>
              <span>{fmtGBP(data.adminEditedTotal)}</span>
            </div>
          </>
        )}
        <div className="ss-shift-card-row ss-shift-card-row--final">
          <span>Final Approved Value</span>
          <span>{data.finalTotal != null ? fmtGBP(data.finalTotal) : "—"}</span>
        </div>
        <div className="ss-shift-card-row">
          <span>Final Difference</span>
          <span>{data.finalDifference != null ? fmtGBP(data.finalDifference) : "—"}</span>
        </div>
      </div>
    </div>
  );
}

const ShopSale = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [viewDate, setViewDate]         = useState(null);
  const [shifts, setShifts]             = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState("");
  const [selectedDate, setSelectedDate] = useState("");

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  useEffect(() => { loadShiftStatus(""); }, []);

  const loadShiftStatus = async (dateStr) => {
    setLoading(true);
    setError("");
    try {
      const url = dateStr
        ? `${SUMMARY_URL}/shift-status?date=${dateStr}`
        : `${SUMMARY_URL}/shift-status`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) {
        setError("Failed to load shift reconciliation.");
        return;
      }
      const data = await res.json();
      setViewDate(data.date ?? dateStr);
      setShifts(Array.isArray(data.shifts) ? data.shifts : []);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDate = (dateStr) => {
    setSelectedDate(dateStr);
    loadShiftStatus(dateStr);
  };

  const handleRefresh = () => loadShiftStatus(selectedDate);

  const clearDateSelection = () => {
    setSelectedDate("");
    loadShiftStatus("");
  };

  const formatDate = (dateStr) =>
    dateStr
      ? new Date(dateStr).toLocaleDateString("en-GB", {
          weekday: "long", day: "2-digit", month: "long", year: "numeric",
        })
      : "";

  const dayData = shifts.find((s) => s.shift === "DAY");
  const nightData = shifts.find((s) => s.shift === "NIGHT");

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
          <h1>Shift Reconciliation</h1>
          <p>{viewDate ? formatDate(viewDate) : "Loading…"}</p>

          <button className="refresh-btn" onClick={handleRefresh}>
            <FiRefreshCw /> Refresh
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
            <p>Loading shift reconciliation…</p>
          </div>
        )}

        {!loading && error && (
          <div className="error-container"><FiAlertCircle /> {error}</div>
        )}

        {!loading && !error && (
          <div className="ss-shift-cards">
            <ShiftStatusCard shift="DAY" data={dayData} />
            <ShiftStatusCard shift="NIGHT" data={nightData} />
          </div>
        )}

      </div>
    </motion.div>
  );
};

export default ShopSale;
