import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./Lottery.css";

const API_BASE     = import.meta.env.VITE_API_URL || "https://localhost:7276/api";
const SUMMARY_URL  = `${API_BASE}/Summary`;
const LOTTERY_URL  = `${API_BASE}/lottery`;

export const Lottery = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [record, setRecord]           = useState(null);
  const [lotteryValue, setLotteryValue] = useState("");
  const [editingId, setEditingId]     = useState(null);
  const [activeDate, setActiveDate]   = useState(null);
  const [isCommitted, setIsCommitted] = useState(false);
  const [isPendingAdminReview, setIsPendingAdminReview] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState(null);

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [lotteryRes, summaryRes] = await Promise.all([
        fetch(LOTTERY_URL, { headers: authHeaders() }),
        fetch(`${SUMMARY_URL}/today`, { headers: authHeaders() }),
      ]);

      if (summaryRes.ok) {
        const s = await summaryRes.json();
        setActiveDate(s.date ?? null);
        setIsCommitted(s.isCommitted ?? false);
        setIsPendingAdminReview(s.isPendingAdminReview ?? false);
      }

      if (lotteryRes.ok) {
        const text = await lotteryRes.text();
        const data = text ? JSON.parse(text) : null;
        setRecord(data);
        setEditingId(data?.id ?? null);
        setLotteryValue(data?.lotteryValue ? String(data.lotteryValue) : "");
      } else if (lotteryRes.status === 404) {
        setRecord(null);
        setEditingId(null);
        setLotteryValue("");
      } else {
        showToast("Failed to load data", "error");
      }
    } catch {
      showToast("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!lotteryValue) {
      showToast("Please enter a Lottery Value", "error");
      return;
    }

    const url    = editingId ? `${LOTTERY_URL}/${editingId}` : LOTTERY_URL;
    const method = editingId ? "PUT" : "POST";

    setSaving(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ lotteryValue: Number(lotteryValue) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const result = await res.json();
      setRecord(result);
      setEditingId(result.id);
      setLotteryValue(result.lotteryValue ? String(result.lotteryValue) : "");
      showToast(editingId ? "Lottery updated successfully" : "Lottery saved successfully");
    } catch {
      showToast("Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  };

  const todayStr      = new Date().toISOString().split("T")[0];
  const activeDateStr = activeDate ? activeDate.split("T")[0] : null;
  const isYesterday   = activeDateStr && activeDateStr !== todayStr;
  const isLocked      = isCommitted || isPendingAdminReview;
  const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  if (loading) {
    return (
      <div className="page-container">
        <h2>Loading...</h2>
      </div>
    );  
  }

  return (
    <div className="page-container">
      {toast && (
        <div className={`lottery-toast lottery-toast--${toast.type}`}>
          {toast.type === "success" ? "✓" : "✕"} {toast.message}
        </div>
      )}

      <button className="back-button" onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className="page-content">
        <div className="page-title-row">
          <h1 className="page-title">Lottery Management</h1>
          <span className="page-date-chip">
            📅 {fmtDate(activeDateStr ?? new Date().toISOString())}
          </span>
        </div>

        {isYesterday && (
          <div className="date-banner">
            <span className="date-banner__icon">{isCommitted ? '✅' : '⚠️'}</span>
            Showing {fmtDate(activeDateStr)} data — {isCommitted ? 'committed' : 'not yet committed'}
          </div>
        )}

        <div className="form-card">
          <div className="form-group">
            <label>Lottery Value</label>
            <input
              type="number"
              placeholder="Enter Lottery Value"
              value={lotteryValue}
              readOnly={isLocked}
              onChange={isLocked ? undefined : (e) => setLotteryValue(e.target.value)}
            />
          </div>

          <button className="save-btn" onClick={handleSave} disabled={saving || isLocked}>
            {saving ? "Saving…" : editingId ? "Update Value" : "Save Value"}
          </button>
        </div>
      </div>
    </div>
  );
};
