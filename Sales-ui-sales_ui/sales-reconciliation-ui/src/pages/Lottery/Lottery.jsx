import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiCalendar, FiEdit2, FiX } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import { ShiftBanner } from "../../components/ShiftBanner";
import "./Lottery.css";
import PhotoAttachments from "../../components/PhotoAttachments";
import { PHOTO_SECTIONS } from "../../constants/photoSections";

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
  const [shift, setShift]             = useState(null);
  const [shiftLabel, setShiftLabel]   = useState(null);
  const [shiftCutoff, setShiftCutoff] = useState(null);
  const [shiftSource, setShiftSource] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [isEditing, setIsEditing]     = useState(false);
  const { showToast } = useToast();

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

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
        setShift(s.shift ?? null);
        setShiftLabel(s.shiftLabel ?? null);
        setShiftCutoff(s.shiftCutoff ?? null);
        setShiftSource(s.shiftSource ?? null);
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
      setIsEditing(false);
    } catch {
      showToast("Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  };

  // Cancel discards unsaved changes by re-fetching from the server.
  const handleCancelEdit = () => {
    setIsEditing(false);
    fetchAll();
  };

  const todayStr      = new Date().toISOString().split("T")[0];
  const activeDateStr = activeDate ? activeDate.split("T")[0] : null;
  const isYesterday   = activeDateStr && activeDateStr !== todayStr;
  const isLocked      = isCommitted || isPendingAdminReview;
  const fieldsDisabled = isLocked || !isEditing;
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
    <motion.div
      className="page-container"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <button className="back-button" onClick={() => navigate(-1)}>
        <FiArrowLeft /> Back
      </button>

      <div className="page-content">
        <div className="page-title-row">
          <h1 className="page-title">Lottery Management</h1>
          <div className="page-header-actions">
            <span className="page-date-chip">
              <FiCalendar /> {fmtDate(activeDateStr ?? new Date().toISOString())}
            </span>
            {!isLocked && !isEditing && (
              <button type="button" className="page-edit-btn" onClick={() => setIsEditing(true)}>
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

        <div className="form-card">
          <div className="form-group">
            <label>Lottery Value</label>
            <input
              type="number"
              placeholder="Enter Lottery Value"
              value={lotteryValue}
              readOnly={fieldsDisabled}
              onChange={fieldsDisabled ? undefined : (e) => setLotteryValue(e.target.value)}
            />
          </div>

          {isEditing && !isLocked && (
            <div className="form-actions-row">
              <button className="save-btn" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save" : "Save Value"}
              </button>
              <button className="cancel-btn" onClick={handleCancelEdit} disabled={saving}>
                <FiX /> Cancel
              </button>
            </div>
          )}
        </div>

        <PhotoAttachments
          section={PHOTO_SECTIONS.lottery}
          readOnly={isLocked}
          title="Lottery Photos"
          description="Attach a photo of the lottery terminal report from your camera or a file on this device."
        />
      </div>
    </motion.div>
  );
};
