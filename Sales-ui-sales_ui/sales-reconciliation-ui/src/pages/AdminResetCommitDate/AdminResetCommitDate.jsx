import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./AdminResetCommitDate.css";

const BASE = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/admin/active-date`;

export const AdminResetCommitDate = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [selectedDate, setSelectedDate]     = useState("");
  const [currentOverride, setCurrentOverride] = useState(null); // { hasOverride, activeDate, setAt }
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
      if (res.ok) setCurrentOverride(await res.json());
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
        body: JSON.stringify({ activeDate: selectedDate }),
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
    <div className="arc-page">
      <div className="arc-container">
        <button className="arc-back" onClick={() => navigate("/admin/dashboard")}>
          ← Back to Dashboard
        </button>

        <h1 className="arc-title">Reset Commit Date</h1>
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
        </div>

        {/* Feedback */}
        {message && (
          <div className={`arc-message arc-message--${message.type}`}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
};
