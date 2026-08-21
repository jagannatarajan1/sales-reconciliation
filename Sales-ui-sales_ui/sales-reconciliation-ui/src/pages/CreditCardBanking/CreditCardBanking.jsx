import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiEdit2, FiX } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import { ShiftBanner } from "../../components/ShiftBanner";
import "./CreditCardBanking.css";
import PhotoAttachments from "../../components/PhotoAttachments";
import { PHOTO_SECTIONS } from "../../constants/photoSections";

const SUMMARY_URL = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/Summary`;

const PRESERVE_KEYS = [
  "lastSafe",
  "safeDropAmount",
  "cashback",
  "paypointPayout",
  "instantLotteryPayout",
  "lotteryPayout",
  "newsVoucher",
  "ddPoint",
  "lotteryValue",
  "paypointValue",
];

const blankRow = () => ({ id: 0, manualCardAmount: "", cardAmount: "", createdDate: null });

export const CreditCardBanking = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [entries, setEntries]     = useState([blankRow()]);
  const [preserved, setPreserved] = useState({});
  const [activeDate, setActiveDate]   = useState(null);
  const [isCommitted, setIsCommitted] = useState(false);
  const [isPendingAdminReview, setIsPendingAdminReview] = useState(false);
  const [shift, setShift]             = useState(null);
  const [shiftLabel, setShiftLabel]   = useState(null);
  const [shiftCutoff, setShiftCutoff] = useState(null);
  const [shiftSource, setShiftSource] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]       = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { showToast } = useToast();

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

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
        setShift(data.shift ?? null);
        setShiftLabel(data.shiftLabel ?? null);
        setShiftCutoff(data.shiftCutoff ?? null);
        setShiftSource(data.shiftSource ?? null);

        const loaded =
          Array.isArray(data.creditCardEntries) && data.creditCardEntries.length > 0
            ? data.creditCardEntries.map((e) => ({
                id:               e.id,
                manualCardAmount: e.manualCardAmount ? String(e.manualCardAmount) : "",
                cardAmount:       e.cardAmount       ? String(e.cardAmount)       : "",
                createdDate:      e.createdDate ?? e.createdAt ?? null,
              }))
            : [blankRow()];

        setEntries(loaded);
        setPreserved(Object.fromEntries(PRESERVE_KEYS.map((k) => [k, data[k] ?? 0])));
      } else if (res.status !== 404) {
        showToast("Failed to load entries", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (index, key, value) => {
    setEntries((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  };

  const handleSave = async () => {
    const body = {
      ...preserved,
      creditCardEntries: entries.map(({ id, manualCardAmount, cardAmount }) => ({
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
        await loadToday();
        setIsEditing(false);
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

  // Cancel discards unsaved changes by re-fetching from the server.
  const handleCancelEdit = () => {
    setIsEditing(false);
    loadToday();
  };

  const todayStr = new Date().toISOString().split("T")[0];
  const activeDateStr = activeDate ? activeDate.split("T")[0] : null;
  const isYesterday = activeDateStr && activeDateStr !== todayStr;
  const isLocked = isCommitted || isPendingAdminReview;
  const fieldsDisabled = isLocked || !isEditing;
  const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const displayDate = activeDateStr ? fmtDate(activeDateStr) : fmtDate(new Date());

  return (
    <motion.div
      className="ccb-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <button className="ccb-back-btn" onClick={() => navigate(-1)}>
        <FiArrowLeft /> Back
      </button>

      <div className="ccb-page-content">
        <div className="ccb-page-header">
          <h1>Credit Card Banking</h1>
          <div className="ccb-header-actions">
            <span className="ccb-date-badge">{displayDate}</span>
            {!isLocked && !isEditing && (
              <button type="button" className="ccb-edit-btn" onClick={() => setIsEditing(true)}>
                <FiEdit2 /> Edit
              </button>
            )}
          </div>
        </div>

        {(isYesterday || shiftLabel) && (
          <ShiftBanner
            date={activeDateStr}
            isCommitted={isCommitted}
            shift={shift}
            shiftLabel={shiftLabel}
            shiftCutoff={shiftCutoff}
            shiftSource={shiftSource}
          />
        )}

        {loading ? (
          <div className="ccb-loading">
            <div className="ccb-spinner" />
            <span>Loading…</span>
          </div>
        ) : (
          <>
            {entries.map((row, i) => (
              <div className="ccb-entry" key={i}>
                {entries.length > 1 && <p className="ccb-entry-label">Entry {i + 1}</p>}

                <div className="ccb-form-group">
                  <label className="ccb-form-label">Manual Card Amount (£)</label>
                  <div className="ccb-input-wrap">
                    <span className="ccb-currency">£</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Enter Manual Card Amount"
                      value={row.manualCardAmount}
                      className="ccb-input"
                      readOnly={fieldsDisabled}
                      onChange={fieldsDisabled ? undefined : (e) => handleChange(i, "manualCardAmount", e.target.value)}
                    />
                  </div>
                </div>

                <div className="ccb-form-group">
                  <label className="ccb-form-label">Card Amount (£)</label>
                  <div className="ccb-input-wrap">
                    <span className="ccb-currency">£</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Enter Card Amount"
                      value={row.cardAmount}
                      className="ccb-input"
                      readOnly={fieldsDisabled}
                      onChange={fieldsDisabled ? undefined : (e) => handleChange(i, "cardAmount", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}

            {isEditing && !isLocked && (
              <div className="ccb-actions-row">
                <button
                  className="ccb-submit-btn"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <><span className="ccb-btn-spinner" /> Saving…</>
                  ) : (
                    "Save"
                  )}
                </button>
                <button className="ccb-cancel-btn" onClick={handleCancelEdit} disabled={saving}>
                  <FiX /> Cancel
                </button>
              </div>
            )}
          </>
        )}

        <PhotoAttachments
          section={PHOTO_SECTIONS.creditCardBanking}
          readOnly={isLocked}
          title="Credit Card Banking Photos"
          description="Attach a photo of the card terminal summary from your camera or a file on this device."
        />
      </div>
    </motion.div>
  );
};
