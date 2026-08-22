import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiCheckCircle, FiMail, FiAlertCircle, FiFileText } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { VARIANCE_TOLERANCE } from "../constants";
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
  // Shift readiness — empty shifts array (feature not active yet, or no
  // shift data for today) simply hides the panel; nothing here blocks commit.
  // Never includes Z-Report data — this page is staff-facing and
  // GET /Summary/shift-status is Z-blind by design (see summary.routes.ts).
  const [shifts, setShifts] = useState([]);
  // The active shift's own sign-off, distinct from the day commit above.
  // Unlike the day commit this has no Z-Report gate — a shift is checked
  // against its own X-Report, which lands at the end of that shift, so the
  // morning shift can close out long before the Z-Report exists.
  const [activeShift, setActiveShift] = useState(null);
  const [shiftLabel, setShiftLabel] = useState(null);
  const [shiftCommitted, setShiftCommitted] = useState(false);
  const [shiftCommittedAt, setShiftCommittedAt] = useState(null);
  const [shiftCommitting, setShiftCommitting] = useState(false);
  const [shiftError, setShiftError] = useState("");

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
      const [summaryRes, zReportRes, shiftStatusRes] = await Promise.all([
        fetch(`${SUMMARY_URL}/today`,          { headers: authHeaders() }),
        fetch(`${SUMMARY_URL}/zreport-status`, { headers: authHeaders() }),
        fetch(`${SUMMARY_URL}/shift-status`,   { headers: authHeaders() }),
      ]);

      if (shiftStatusRes.ok) {
        const shiftStatus = await shiftStatusRes.json();
        setShifts(Array.isArray(shiftStatus.shifts) ? shiftStatus.shifts : []);
      }

      if (!summaryRes.ok) {
        setErrorMsg("Failed to load today's data.");
        return;
      }

      const summary = await summaryRes.json();
      setCommittedAt(summary.committedAt ?? null);
      setActiveShift(summary.shift ?? null);
      setShiftLabel(summary.shiftLabel ?? null);
      setShiftCommitted(summary.isShiftCommitted ?? false);
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

  const fmtGBP = (val) => {
    const n = parseFloat(val);
    return isNaN(n) ? "£0.00" : `£${n.toFixed(2)}`;
  };

  const SHIFT_LABEL = { DAY: "Day Shift", NIGHT: "Night Shift" };
  const dayShift = shifts.find((s) => s.shift === "DAY");
  const nightShift = shifts.find((s) => s.shift === "NIGHT");

  // Shift Readiness value: which figure to show and how to label its
  // provenance. Priority: admin adjustment > staff entry > raw till figure >
  // nothing entered yet. A closed shift (Issue D) or the other shift's
  // withheld money (isOwnShift false) short-circuits straight to "—"
  // regardless of the above — there is nothing to show either way.
  const shiftReadinessValue = (s) => {
    if (s.closed || s.isOwnShift === false) {
      return { value: "—", sublabel: null, muted: false };
    }
    if (s.adminEditedTotal != null) {
      return { value: fmtGBP(s.adminEditedTotal), sublabel: "Admin adjusted", muted: false };
    }
    if (s.staffEnteredTotal != null) {
      return { value: fmtGBP(s.staffEnteredTotal), sublabel: "You entered", muted: false };
    }
    if (s.originalTotal != null) {
      return { value: fmtGBP(s.originalTotal), sublabel: "Till says — not yet entered", muted: true };
    }
    return { value: "Pending", sublabel: null, muted: false };
  };

  // Status pill: closed always wins (Issue D) — otherwise unchanged from the
  // finalStatus this row already carried.
  const shiftReadinessPill = (s) => {
    if (s.closed) return { key: "closed", label: "Closed" };
    if (s.finalStatus === "VARIANCE") return { key: "variance", label: "Variance" };
    if (s.finalStatus === "RESOLVED") return { key: "resolved", label: "Resolved" };
    if (s.finalStatus === "OK") return { key: "ok", label: "OK" };
    return { key: "pending", label: "Pending" };
  };

  const handleShiftCommit = async () => {
    setShiftError("");
    setShiftCommitting(true);
    try {
      const res = await fetch(`${SUMMARY_URL}/shift-commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ staffNotes: staffNotes.trim() }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        setShiftCommitted(true);
        setShiftCommittedAt(result.committedAt ?? new Date().toISOString());
      } else {
        setShiftError(result.message ?? "Could not commit this shift.");
      }
    } catch {
      setShiftError("Network error while committing the shift.");
    } finally {
      setShiftCommitting(false);
    }
  };

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
      ) : isCommitted ? (
        /* ── Already committed ── short-circuits the whole card, unchanged */
        <div className="commit-card">
          <div className="commit-done-badge">
            <FiCheckCircle /> Committed successfully
            {committedAt && (
              <span className="commit-done-time">{formatDateTime(committedAt)}</span>
            )}
          </div>
          <div className="commit-email-sent"><FiMail /> Notification email sent</div>
          <p className="commit-committed-note">{committedMsg}</p>
        </div>
      ) : (
        <>
          {/* ── "Your Shift" card — the per-shift sign-off. Deliberately has
              no relationship to zReportAvailable anywhere below: that gate
              belongs entirely to the End of Day Commit card next. ── */}
          <div className="commit-card commit-card--shift">
            <div className="commit-section-head">
              <h2 className="commit-section-heading">Your Shift</h2>
              <p className="commit-section-subtitle">
                Submitting your shift is never blocked by the Z Report — that only affects
                End of Day Commit below.
              </p>
            </div>

            {/* Shift readiness — only rendered once there is actual shift
                data to show; stays invisible entirely until that feature
                is live, same as every other shift UI in this app. */}
            {(dayShift || nightShift) && (
              <div className="commit-shift-readiness">
                <div className="commit-shift-readiness-title">Shift Readiness</div>
                <div className="commit-shift-rows">
                  {[dayShift, nightShift].filter(Boolean).map((s) => {
                    const { value, sublabel, muted } = shiftReadinessValue(s);
                    const pill = shiftReadinessPill(s);
                    return (
                      <div key={s.shift} className="commit-shift-row">
                        <span className="commit-shift-row-label">{SHIFT_LABEL[s.shift]}</span>
                        <span className="commit-shift-row-values">
                          <span
                            className={`commit-shift-row-value${muted ? " commit-shift-row-value--muted" : ""}`}
                          >
                            {value}
                          </span>
                          {sublabel && (
                            <span className="commit-shift-row-sublabel">{sublabel}</span>
                          )}
                        </span>
                        <span className={`commit-shift-row-pill commit-shift-row-pill--${pill.key}`}>
                          {pill.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Per-shift sign-off. Only offered when a real shift is active
                (never for the legacy FULL_DAY bucket) and while the day is
                still open. Deliberately independent of zReportAvailable —
                that gate belongs to the day commit further down. */}
            {activeShift && activeShift !== "FULL_DAY" && !isCommitted && (
              <div className={`commit-shift-commit${shiftCommitted ? " commit-shift-commit--done" : ""}`}>
                <div className="commit-shift-commit-head">
                  <span className="commit-shift-commit-title">
                    {shiftLabel || "This shift"}
                  </span>
                  {shiftCommitted && (
                    <span className="commit-shift-commit-badge">
                      <FiCheckCircle /> Submitted
                    </span>
                  )}
                </div>

                {shiftCommitted ? (
                  <p className="commit-shift-commit-note">
                    Your shift has been submitted to the admin and its figures are now locked.
                    {shiftCommittedAt ? ` Submitted ${formatDate(shiftCommittedAt)}.` : ""}
                  </p>
                ) : (
                  <>
                    <p className="commit-shift-commit-note">
                      Submit this shift once you have finished entering its figures. You do not
                      need to wait for the Z Report — your shift is checked against its own
                      X Report. The day is committed separately at the end.
                    </p>
                    {shiftError && (
                      <div className="commit-error-msg"><FiAlertCircle /> {shiftError}</div>
                    )}
                    <button
                      type="button"
                      className="commit-shift-commit-btn"
                      onClick={handleShiftCommit}
                      disabled={shiftCommitting}
                    >
                      {shiftCommitting ? "Submitting…" : `Submit ${shiftLabel || "shift"}`}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Issue B — link to the staff's own full till report. Same
                guard as the sign-off block above (a real, non-FULL_DAY
                shift); the report itself is never gated by Z Report or
                closure, only this link's visibility follows the same
                "is there an active shift" rule the rest of the card uses. */}
            {activeShift && activeShift !== "FULL_DAY" && (
              <button
                type="button"
                className="commit-shift-report-link"
                onClick={() => navigate("/my-shift-report")}
              >
                <FiFileText /> View my shift's full till report
              </button>
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
          </div>

          {/* ── "End of Day Commit" card — the day-level commit, gated on
              zReportAvailable. The Z-missing banner and the day-level
              errorMsg both live here now: neither one has anything to do
              with the shift sign-off in the card above. ── */}
          <div className="commit-card commit-card--day-commit">
            <h2 className="commit-section-heading">End of Day Commit</h2>

            {/* Z Report missing — day commit stays blocked until it arrives.
                Copy is explicit that this never touches shift submission. */}
            {!zReportAvailable && (
              <div className="commit-error-msg">
                <FiAlertCircle />
                {(zReportMessage
                  || "The Z Report hasn't arrived yet for this date — End of Day Commit isn't available until it does.")
                  + " This does not affect your shift submission above."}
              </div>
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
                        ? `Commit Blocked — Exceeds £${VARIANCE_TOLERANCE.toFixed(2)} Limit`
                        : "Confirm Commit"
                }
              </button>
            )}
          </div>
        </>
      )}

      <PhotoAttachments
        section={PHOTO_SECTIONS.commit}
        // Once the day is committed the evidence freezes with it — the backend
        // enforces the same rule, this just hides the controls.
        readOnly={isCommitted || committed}
        title="Supporting Photos"
        description="Attach any photo the admin should see with this commit, from your camera or a file on this device."
      />
    </motion.div>
  );
};
