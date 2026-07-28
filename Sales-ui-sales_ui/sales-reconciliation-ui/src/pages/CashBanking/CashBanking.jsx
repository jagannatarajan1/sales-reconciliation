import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./CashBanking.css";

const SUMMARY_URL = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/Summary`;

const PRESERVE_KEYS = [
  "cashback",
  "paypointPayout",
  "instantLotteryPayout",
  "lotteryPayout",
  "newsVoucher",
  "ddPoint",
  "lotteryValue",
  "paypointValue",
];

export const CashBanking = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [lastSafe, setLastSafe]             = useState("");
  const [safeDropAmount, setSafeDropAmount] = useState("");
  const [preserved, setPreserved]           = useState({});
  const [ccEntries, setCcEntries]           = useState([]);
  const [activeDate, setActiveDate]         = useState(null);
  const [isCommitted, setIsCommitted]       = useState(false);
  const [isPendingAdminReview, setIsPendingAdminReview] = useState(false);
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [toast, setToast]                   = useState(null);

  const cash = (() => {
    const ls = parseFloat(lastSafe);
    const sd = parseFloat(safeDropAmount);
    if (isNaN(ls) && isNaN(sd)) return "";
    return ((isNaN(ls) ? 0 : ls) + (isNaN(sd) ? 0 : sd)).toFixed(2);
  })();

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => { loadToday(); }, []);

  const loadToday = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SUMMARY_URL}/today`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setActiveDate(data.date ?? null);
        setIsCommitted(data.isCommitted ?? false);
        setIsPendingAdminReview(data.isPendingAdminReview ?? false);
        setLastSafe(data.lastSafe       ? String(data.lastSafe)       : "");
        setSafeDropAmount(data.safeDropAmount ? String(data.safeDropAmount) : "");
        setPreserved(Object.fromEntries(PRESERVE_KEYS.map((k) => [k, data[k] ?? 0])));
        setCcEntries(Array.isArray(data.creditCardEntries) ? data.creditCardEntries : []);
      } else if (res.status !== 404) {
        showToast("Failed to load data", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (lastSafe === "") {
      showToast("Please enter Last Safe amount", "error");
      return;
    }
    if (safeDropAmount === "") {
      showToast("Please enter Safe Drop Amount", "error");
      return;
    }
    if (parseFloat(lastSafe) < 0 || parseFloat(safeDropAmount) < 0) {
      showToast("Values cannot be negative", "error");
      return;
    }

    const body = {
      ...preserved,
      lastSafe:       parseFloat(lastSafe)       || 0,
      safeDropAmount: parseFloat(safeDropAmount) || 0,
      creditCardEntries: ccEntries.map(({ id, manualCardAmount, cardAmount }) => ({
        id,
        manualCardAmount: parseFloat(manualCardAmount) || 0,
        cardAmount:       parseFloat(cardAmount)       || 0,
      })),
    };

    setSaving(true);
    try {
      const res = await fetch(SUMMARY_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast("Saved successfully");
      } else {
        const err = await res.text();
        showToast(`Save failed: ${err}`, "error");
      }
    } catch {
      showToast("Network error saving", "error");
    } finally {
      setSaving(false);
    }
  };

  const todayStr = new Date().toISOString().split("T")[0];
  const activeDateStr = activeDate ? activeDate.split("T")[0] : null;
  const isYesterday = activeDateStr && activeDateStr !== todayStr;
  const isLocked = isCommitted || isPendingAdminReview;
  const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const displayDate = activeDateStr ? fmtDate(activeDateStr) : fmtDate(new Date());

  return (
    <div className="cb-page">
      {toast && (
        <div className={`cb-toast cb-toast--${toast.type}`}>
          <span className="cb-toast-icon">{toast.type === "success" ? "✓" : "✕"}</span>
          {toast.message}
        </div>
      )}

      <button className="cb-back-btn" onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className="cb-page-content">
        <div className="cb-page-header">
          <h1>Cash Banking</h1>
          <span className="cb-date-badge">{displayDate}</span>
        </div>

        {isYesterday && (
          <div className="date-banner">
            <span className="date-banner__icon">{isCommitted ? '✅' : '⚠️'}</span>
            Showing {fmtDate(activeDateStr)} data — {isCommitted ? 'committed' : 'not yet committed'}
          </div>
        )}

        {loading ? (
          <div className="cb-loading">
            <div className="cb-spinner" />
            <span>Loading…</span>
          </div>
        ) : (
          <>
            <div className="cb-form-group">
              <label className="cb-form-label">Last Safe (£)</label>
              <div className="cb-input-wrap">
                <span className="cb-currency">£</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Enter Last Safe amount"
                  value={lastSafe}
                  className="cb-input"
                  readOnly={isLocked}
                  onChange={isLocked ? undefined : (e) => setLastSafe(e.target.value)}
                />
              </div>
            </div>

            <div className="cb-form-group">
              <label className="cb-form-label">Safe Drop Amount (£)</label>
              <div className="cb-input-wrap">
                <span className="cb-currency">£</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Enter Safe Drop Amount"
                  value={safeDropAmount}
                  className="cb-input"
                  readOnly={isLocked}
                  onChange={isLocked ? undefined : (e) => setSafeDropAmount(e.target.value)}
                />
              </div>
            </div>

            <div className="cb-form-group">
              <label className="cb-form-label cb-form-label--total">
                Cash — Total (£)
              </label>
              <div className="cb-input-wrap cb-input-wrap--total">
                <span className="cb-currency cb-currency--total">£</span>
                <input
                  type="number"
                  readOnly
                  placeholder="Auto-calculated"
                  value={cash}
                  className="cb-input cb-input--total"
                />
              </div>
              <p className="cb-total-note">Auto-calculated: Last Safe + Safe Drop Amount</p>
            </div>

            <button
              className="cb-submit-btn"
              onClick={handleSave}
              disabled={saving || isLocked}
            >
              {saving ? (
                <><span className="cb-btn-spinner" /> Saving…</>
              ) : (
                "Save"
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
