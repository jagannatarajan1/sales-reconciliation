import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiCheckCircle, FiMail, FiAlertCircle } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import "./Commit.css";

const API_BASE = import.meta.env.VITE_API_URL || "https://localhost:7276/api";
const SUMMARY_URL = `${API_BASE}/Summary`;

const SHIFTS = ["Morning", "Afternoon", "Evening", "Night"];
const OTHER_STAFF_VALUE = "__other__";

// ── Summary <-> Commit relationship ──────────────────────────────────────
// Summary.jsx and Commit.jsx are independent Dashboard entries (Dashboard.jsx
// links to both separately) — there is no wizard-style forward navigation
// between them by default. Summary now has a "Proceed to Commit" button that
// passes staffName/shift/staffNotes via router state as a convenience, but
// Commit.jsx must also work when reached directly from the Dashboard, so it
// owns its own copy of these fields (pre-filled from location.state when
// present) and is the page that actually enforces "staff name + shift
// required before commit" — this is the one place the POST /commit body is
// built, so it's the natural place to gate the button.
export const Commit = () => {
  const navigate = useNavigate();
  const location = useLocation();
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

  // If Summary passed a staffName through, default to the "Other" free-text
  // slot showing that name — once the staff list loads below, it's swapped
  // to the matching dropdown option if one exists.
  const passedState = location.state || {};
  const [staffList, setStaffList] = useState([]);
  const [staffName, setStaffName] = useState(() => (passedState.staffName ? OTHER_STAFF_VALUE : ""));
  const [staffNameOther, setStaffNameOther] = useState(() => passedState.staffName || "");
  const [shift, setShift] = useState(() => passedState.shift || "");
  const [staffNotes, setStaffNotes] = useState(() => passedState.staffNotes || "");

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  const resolvedStaffName = staffName === OTHER_STAFF_VALUE ? staffNameOther.trim() : staffName;
  const canCommit = !!resolvedStaffName && !!shift;

  const loadStaff = async () => {
    try {
      const res = await fetch(`${API_BASE}/staff`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const active = Array.isArray(data) ? data.filter((s) => s.isActive) : [];
      setStaffList(active);

      // If a name was passed in from Summary and it matches an active staff
      // entry exactly, switch the dropdown to that entry instead of "Other".
      if (passedState.staffName && active.some((s) => s.name === passedState.staffName)) {
        setStaffName(passedState.staffName);
        setStaffNameOther("");
      }
    } catch {
      // Non-fatal — the "Other" free-text option still works without the list.
    }
  };

  useEffect(() => { loadAll(); loadStaff(); }, []);

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
    if (!canCommit) {
      setErrorMsg("Staff name and shift are required before you can commit.");
      return;
    }
    setErrorMsg("");
    setCommitting(true);
    try {
      const res = await fetch(`${SUMMARY_URL}/commit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body:    JSON.stringify({
          staffName: resolvedStaffName,
          shift,
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

              {!committed && (
                <div className="commit-staff-section">
                  <div className="commit-field">
                    <label className="commit-label">Staff Name</label>
                    <select
                      className="commit-select"
                      value={staffName}
                      onChange={(e) => setStaffName(e.target.value)}
                    >
                      <option value="">Select staff…</option>
                      {staffList.map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                      <option value={OTHER_STAFF_VALUE}>Other (temporary staff)</option>
                    </select>
                  </div>

                  {staffName === OTHER_STAFF_VALUE && (
                    <div className="commit-field">
                      <label className="commit-label">Temporary Staff Name</label>
                      <input
                        className="commit-select"
                        type="text"
                        placeholder="Enter name"
                        value={staffNameOther}
                        onChange={(e) => setStaffNameOther(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="commit-field">
                    <label className="commit-label">Shift</label>
                    <select
                      className="commit-select"
                      value={shift}
                      onChange={(e) => setShift(e.target.value)}
                    >
                      <option value="">Select shift…</option>
                      {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

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
                  className={`commit-btn ${limitExceeded ? "commit-btn--red" : "commit-btn--green"}`}
                  onClick={handleCommit}
                  disabled={committing || committed || limitExceeded || !canCommit}
                  title={!canCommit ? "Select a staff name and shift first" : undefined}
                >
                  {committing
                    ? <><span className="commit-btn-spinner" /> Committing…</>
                    : alreadyAttempted
                      ? "Already Attempted — Commit Locked for This Date"
                      : limitExceeded
                        ? "Commit Blocked — Exceeds £5.00 Limit"
                        : !canCommit
                          ? "Select Staff Name & Shift to Continue"
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
