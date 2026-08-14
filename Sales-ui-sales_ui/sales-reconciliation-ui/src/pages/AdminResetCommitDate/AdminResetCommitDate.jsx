import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiCheckCircle, FiXCircle, FiCalendar } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import "./AdminResetCommitDate.css";

const BASE = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/admin/active-date`;

export const AdminResetCommitDate = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [selectedDate, setSelectedDate]     = useState("");
  const [selectedShift, setSelectedShift]   = useState("auto"); // 'auto' | 'DAY' | 'NIGHT'
  const [currentOverride, setCurrentOverride] = useState(null); // { hasOverride, activeDate, activeShift, setAt }
  const [loadingOverride, setLoadingOverride] = useState(true);
  const [saving, setSaving]         = useState(false);
  const [message, setMessage]       = useState(null); // { type: "success"|"error", text }

  const authHeaders = () => ({
    Authorization: `Bearer ${user.token}`,
    "Content-Type": "application/json",
  });

  const todayStr = new Date().toISOString().split("T")[0];

  useEffect(() => {
    fetchOverride();
  }, []);

  const fetchOverride = async () => {
    setLoadingOverride(true);
    try {
      const res = await fetch(BASE, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setCurrentOverride(data);
        setSelectedShift(data.activeShift ?? "auto");
      }
    } finally {
      setLoadingOverride(false);
    }
  };

  const handleSet = async () => {
    if (!selectedDate) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(BASE, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          activeDate: selectedDate,
          activeShift: selectedShift === "auto" ? null : selectedShift,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message });
        fetchOverride();
      } else {
        setMessage({ type: "error", text: data.message || "Failed to set date." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(BASE, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      setMessage({ type: res.ok ? "success" : "error", text: data.message });
      if (res.ok) {
        setCurrentOverride(null);
        setSelectedDate("");
        fetchOverride();
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";

  return (
    <motion.div
      className="arc-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="arc-container">
        <button className="arc-back" onClick={() => navigate("/admin/dashboard")}>
          <FiArrowLeft /> Back to Dashboard
        </button>

        <h1 className="arc-title"><FiCalendar className="arc-title-icon" /> Reset Commit Date</h1>
        <p className="arc-subtitle">
          Override the active working date for the whole shop. All staff will see this date
          as their current session until it's committed.
        </p>

        {/* Current override info */}
        <div className="arc-card">
          <label className="arc-label">Current Active Date Override</label>
          {loadingOverride ? (
            <p className="arc-hint">Checking…</p>
          ) : currentOverride?.hasOverride ? (
            <div className="arc-override-active">
              <span className="arc-override-badge">Override active</span>
              <span>
                Active date is set to <strong>{formatDate(currentOverride.activeDate)}</strong>
                {currentOverride.setAt && ` (set ${formatDate(currentOverride.setAt)})`}
                {currentOverride.activeShift && (
                  <> — shift forced to <strong>{currentOverride.activeShift === "NIGHT" ? "Night" : "Day"}</strong></>
                )}
              </span>
              <button
                className="arc-btn arc-btn-danger"
                onClick={handleClear}
                disabled={saving}
              >
                {saving ? "Clearing…" : "Clear Override"}
              </button>
            </div>
          ) : (
            <p className="arc-hint">No override — the shop is on automatic date logic.</p>
          )}
        </div>

        {/* Set new date */}
        <div className="arc-card">
          <label className="arc-label">Set New Active Date</label>
          <div className="arc-row">
            <input
              type="date"
              className="arc-date-input"
              value={selectedDate}
              max={todayStr}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <button
              className="arc-btn arc-btn-primary"
              onClick={handleSet}
              disabled={saving || !selectedDate}
            >
              {saving ? "Saving…" : "Set Date"}
            </button>
          </div>
          <p className="arc-hint">
            All staff will see this date as their active commit date immediately after saving.
          </p>

          <label className="arc-label arc-label--shift">Shift</label>
          <div className="arc-shift-toggle">
            {[
              { value: "auto", label: "Auto" },
              { value: "DAY", label: "Day" },
              { value: "NIGHT", label: "Night" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`arc-shift-btn${selectedShift === opt.value ? " arc-shift-btn--active" : ""}`}
                onClick={() => setSelectedShift(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="arc-hint">
            Auto derives the shift from the clock. Day/Night forces it — e.g. for night staff still
            finishing entries after the cutoff has rolled into the next shift.
          </p>
        </div>

        {/* Feedback */}
        {message && (
          <div className={`arc-message arc-message--${message.type}`}>
            {message.type === "success" ? <FiCheckCircle /> : <FiXCircle />}
            {message.text}
          </div>
        )}
      </div>
    </motion.div>
  );
};
