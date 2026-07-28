import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiCheckCircle, FiMail, FiAlertCircle } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import "./Commit.css";

const SUMMARY_URL = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/Summary`;

export const Commit = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading]           = useState(true);
  const [isCommitted, setIsCommitted]   = useState(false);
  const [committedAt, setCommittedAt]   = useState(null);
  const [committedMsg, setCommittedMsg] = useState("");
  const [targetDate, setTargetDate]     = useState(null);
  const [emailError, setEmailError]     = useState("");
  const [committed, setCommitted]       = useState(false);
  const [committing, setCommitting]     = useState(false);
  const [errorMsg, setErrorMsg]           = useState("");
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [alreadyAttempted, setAlreadyAttempted] = useState(false);

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    setErrorMsg("");
    setEmailError("");
    try {
      const [emailRes, summaryRes] = await Promise.all([
        fetch(`${SUMMARY_URL}/zreport-email`, { headers: authHeaders() }),
        fetch(`${SUMMARY_URL}/today`,         { headers: authHeaders() }),
      ]);

      if (summaryRes.ok) {
        const summary = await summaryRes.json();
        setCommittedAt(summary.committedAt ?? null);
      }

      if (emailRes.status === 400) {
        setEmailError("No Z-report email found. Please ensure the plain-text Z-report has been received.");
        return;
      }
      if (!emailRes.ok) {
        setEmailError("Failed to check Z-report email.");
        return;
      }

      const emailData = await emailRes.json();
      setIsCommitted(emailData.isCommitted ?? false);
      const date = emailData.targetDate ?? null;
      setTargetDate(date);

      if (emailData.isCommitted) {
        setCommittedMsg(
          emailData.message || "Today's values are already committed. Next Z-report available tomorrow."
        );
      } else if (emailData.isPendingAdminReview) {
        // Backend says this date already exceeded £5.00 and is locked pending admin review —
        // authoritative and shared across every user/device, unlike a local flag would be.
        setLimitExceeded(true);
        setAlreadyAttempted(true);
        setErrorMsg(emailData.message || "");
      }
    } catch {
      setErrorMsg("Network error loading data.");
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    setErrorMsg("");
    setCommitting(true);
    try {
      const res = await fetch(`${SUMMARY_URL}/commit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body:    JSON.stringify({ summaryTotal: 0, zReportTotal: 0, difference: 0 }),
      });
      if (res.ok) {
        const result = await res.json();
        setCommitted(true);
        setCommittedAt(result.committedAt ?? new Date().toISOString());
        setTimeout(() => navigate('/dashboard'), 2000);
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.message ?? "Commit failed.";
        setErrorMsg(msg);
        setLimitExceeded(true);
      }
    } catch {
      setErrorMsg("Network error during commit.");
      setLimitExceeded(true);
    } finally {
      setCommitting(false);
    }
  };

  const formatDate = (dateStr) =>
    dateStr
      ? new Date(dateStr).toLocaleDateString("en-GB", {
          weekday: "long", day: "2-digit", month: "long", year: "numeric",
        })
      : "";

  const formatDateTime = (dateStr) =>
    new Date(dateStr).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <motion.div
      className="commit-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <button className="commit-back-btn" onClick={() => navigate(-1)}>
        <FiArrowLeft /> Back
      </button>

      <div className="commit-header">
        <div className="commit-title-wrap">
          <span className="commit-icon"><FiCheckCircle /></span>
          <div>
            <h1 className="commit-title">Commit Transactions</h1>
            <p className="commit-subtitle">End-of-day reconciliation</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="commit-loading">
          <div className="commit-spinner" />
          <span>Loading…</span>
        </div>
      ) : (
        <div className="commit-card">

          {/* ── Already committed ── */}
          {isCommitted && (
            <>
              <div className="commit-done-badge">
                <FiCheckCircle /> Committed successfully
                {committedAt && (
                  <span className="commit-done-time">{formatDateTime(committedAt)}</span>
                )}
              </div>
              <div className="commit-email-sent"><FiMail /> Notification email sent</div>
              <p className="commit-committed-note">{committedMsg}</p>
            </>
          )}

          {/* ── No Z-report email ── */}
          {!isCommitted && emailError && (
            <div className="commit-error-msg"><FiAlertCircle /> {emailError}</div>
          )}

          {/* ── Ready to commit ── */}
          {!isCommitted && !emailError && (
            <>
              {targetDate && (
                <div className="commit-date-block">
                  <span className="commit-date-label">Committing for</span>
                  <span className="commit-date-value">{formatDate(targetDate)}</span>
                </div>
              )}

              {errorMsg && (
                <div className="commit-error-msg"><FiAlertCircle /> {errorMsg}</div>
              )}

              {committed ? (
                <div className="commit-done-badge">
                  <FiCheckCircle /> Committed successfully
                  {committedAt && (
                    <span className="commit-done-time">{formatDateTime(committedAt)}</span>
                  )}
                </div>
              ) : (
                <button
                  className={`commit-btn ${limitExceeded ? "commit-btn--red" : "commit-btn--green"}`}
                  onClick={handleCommit}
                  disabled={committing || committed || limitExceeded}
                >
                  {committing
                    ? <><span className="commit-btn-spinner" /> Committing…</>
                    : alreadyAttempted
                      ? "Already Attempted — Commit Locked for This Date"
                      : limitExceeded
                        ? "Commit Blocked — Exceeds £5.00 Limit"
                        : "Confirm Commit"
                  }
                </button>
              )}
            </>
          )}

        </div>
      )}
    </motion.div>
  );
};
