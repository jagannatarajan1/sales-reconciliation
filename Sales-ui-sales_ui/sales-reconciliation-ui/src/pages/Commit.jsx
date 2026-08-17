import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiCheckCircle, FiMail, FiAlertCircle } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import PhotoAttachments from "../components/PhotoAttachments";
import { PHOTO_SECTIONS } from "../constants/photoSections";
import "./Commit.css";

const API_BASE = import.meta.env.VITE_API_URL || "https://localhost:7276/api";
const SUMMARY_URL = `${API_BASE}/Summary`;

// ── Summary <-> Commit relationship ──────────────────────────────────────
// Summary.jsx and Commit.jsx are independent Dashboard entries (Dashboard.jsx
// links to both separately) — there is no wizard-style forward navigation
// between them by default. Summary has a "Proceed to Commit" button that
// passes staffNotes via router state as a convenience, but Commit.jsx must
// also work when reached directly from the Dashboard, so it owns its own
// copy of the field (pre-filled from location.state when present).
export const Commit = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [loading, setLoading]           = useState(true);
  const [isCommitted, setIsCommitted]   = useState(false);
  const [committedAt, setCommittedAt]   = useState(null);
  const [committedMsg, setCommittedMsg] = useState("");
  const [targetDate, setTargetDate]     = useState(null);
  const [committed, setCommitted]       = useState(false);
  const [committing, setCommitting]     = useState(false);
  const [errorMsg, setErrorMsg]           = useState("");
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [alreadyAttempted, setAlreadyAttempted] = useState(false);
  // Commit is only offered once the day's Z-Report has arrived. The same rule
  // is enforced by POST /Summary/commit — this is the pre-flight so the user
  // sees why the button is unavailable instead of being refused on click.
  const [zReportAvailable, setZReportAvailable] = useState(true);
  const [zReportMessage, setZReportMessage]     = useState("");

  // If Summary passed staffNotes through (already filled in there), pre-fill
  // this page's textarea with it.
  const passedState = location.state || {};
  const [staffNotes, setStaffNotes] = useState(() => passedState.staffNotes || "");

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    setErrorMsg("");
    setZReportMessage("");
    try {
      const [summaryRes, zReportRes] = await Promise.all([
        fetch(`${SUMMARY_URL}/today`,          { headers: authHeaders() }),
        fetch(`${SUMMARY_URL}/zreport-status`, { headers: authHeaders() }),
      ]);

      if (!summaryRes.ok) {
        setErrorMsg("Failed to load today's data.");
        return;
      }

      const summary = await summaryRes.json();
      setCommittedAt(summary.committedAt ?? null);
      setIsCommitted(summary.isCommitted ?? false);
      setTargetDate(summary.date ?? null);

      if (summary.isCommitted) {
        setCommittedMsg("Today's values are already committed. Next Z-report available tomorrow.");
        return;
      }

      if (summary.isPendingAdminReview) {
        // Backend says this date already exceeded £5.00 and is locked pending admin review —
        // authoritative and shared across every user/device, unlike a local flag would be.
        setLimitExceeded(true);
        setAlreadyAttempted(true);
      }

      if (zReportRes.ok) {
        const status = await zReportRes.json();
        setZReportAvailable(status.available ?? false);
        if (!status.available) setZReportMessage(status.message || "");
      } else {
        setZReportAvailable(false);
        setZReportMessage("Failed to check whether the Z Report is available for this date.");
      }
    } catch {
      setErrorMsg("Network error loading data.");
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    // Belt-and-braces: the button is already disabled without a Z Report, so
    // reaching here means the state changed under us.
    if (!zReportAvailable) return;

    setErrorMsg("");
    setCommitting(true);
    try {
      const res = await fetch(`${SUMMARY_URL}/commit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body:    JSON.stringify({
          staffNotes: staffNotes.trim(),
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setCommitted(true);
        setCommittedAt(result.committedAt ?? new Date().toISOString());
        setTimeout(() => navigate('/dashboard'), 2000);
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.message ?? "Commit failed.";

        // A missing Z Report is its own outcome — the day is simply not ready
        // yet, so surface it as such instead of as the £5.00 variance lock.
        if (errData.zReportAvailable === false) {
          setZReportAvailable(false);
          setZReportMessage(msg);
        } else {
          setErrorMsg(msg);
          setLimitExceeded(true);
        }
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

          {/* ── Ready to commit ── */}
          {!isCommitted && (
            <>
              {/* Z Report missing — commit stays blocked until it arrives */}
              {!zReportAvailable && (
                <div className="commit-error-msg"><FiAlertCircle /> {zReportMessage}</div>
              )}

              {targetDate && (
                <div className="commit-date-block">
                  <span className="commit-date-label">Committing for</span>
                  <span className="commit-date-value">{formatDate(targetDate)}</span>
                </div>
              )}

              {errorMsg && (
                <div className="commit-error-msg"><FiAlertCircle /> {errorMsg}</div>
              )}

              {!committed && (
                <div className="commit-staff-section">
                  <div className="commit-field commit-field--notes">
                    <label className="commit-label">Staff Notes (optional)</label>
                    <textarea
                      className="commit-textarea"
                      rows={3}
                      placeholder="Anything the admin should know about today…"
                      value={staffNotes}
                      onChange={(e) => setStaffNotes(e.target.value)}
                    />
                  </div>
                </div>
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
                  className={`commit-btn ${limitExceeded || !zReportAvailable ? "commit-btn--red" : "commit-btn--green"}`}
                  onClick={handleCommit}
                  disabled={committing || committed || limitExceeded || !zReportAvailable}
                >
                  {committing
                    ? <><span className="commit-btn-spinner" /> Committing…</>
                    : !zReportAvailable
                      ? "Commit Blocked — Z Report Not Available"
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

          {targetDate && (
            <PhotoAttachments
              section={PHOTO_SECTIONS.commit}
              date={String(targetDate).split("T")[0]}
              // Once the day is committed the evidence freezes with it — the
              // backend enforces the same rule, this just hides the controls.
              readOnly={isCommitted || committed}
              title="Supporting Photos"
              description="Attach any photo the admin should see with this commit, from your camera or a file on this device."
            />
          )}

        </div>
      )}
    </motion.div>
  );
};
