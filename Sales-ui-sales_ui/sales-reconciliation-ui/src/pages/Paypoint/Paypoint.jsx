import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiCalendar, FiCheckCircle, FiAlertTriangle } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import "./Paypoint.css";

const API_BASE    = import.meta.env.VITE_API_URL || "https://localhost:7276/api";
const SUMMARY_URL = `${API_BASE}/Summary`;
const PAYPOINT_URL = `${API_BASE}/paypoint`;

export const Paypoint = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [record, setRecord]             = useState(null);
  const [paypointValue, setPaypointValue] = useState("");
  const [editingId, setEditingId]       = useState(null);
  const [activeDate, setActiveDate]     = useState(null);
  const [isCommitted, setIsCommitted]   = useState(false);
  const [isPendingAdminReview, setIsPendingAdminReview] = useState(false);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const { showToast } = useToast();

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [paypointRes, summaryRes] = await Promise.all([
        fetch(PAYPOINT_URL, { headers: authHeaders() }),
        fetch(`${SUMMARY_URL}/today`, { headers: authHeaders() }),
      ]);

      if (summaryRes.ok) {
        const s = await summaryRes.json();
        setActiveDate(s.date ?? null);
        setIsCommitted(s.isCommitted ?? false);
        setIsPendingAdminReview(s.isPendingAdminReview ?? false);
      }

      if (paypointRes.ok) {
        const text = await paypointRes.text();
        const data = text ? JSON.parse(text) : null;
        setRecord(data);
        setEditingId(data?.id ?? null);
        setPaypointValue(data?.paypointValue ? String(data.paypointValue) : "");
      } else if (paypointRes.status === 404) {
        setRecord(null);
        setEditingId(null);
        setPaypointValue("");
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
    if (!paypointValue) {
      showToast("Please enter a Paypoint Value", "error");
      return;
    }

    const url    = editingId ? `${PAYPOINT_URL}/${editingId}` : PAYPOINT_URL;
    const method = editingId ? "PUT" : "POST";

    setSaving(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ paypointValue: Number(paypointValue) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const result = await res.json();
      setRecord(result);
      setEditingId(result.id);
      setPaypointValue(result.paypointValue ? String(result.paypointValue) : "");
      showToast(editingId ? "Paypoint updated successfully" : "Paypoint saved successfully");
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
          <h1 className="page-title">Paypoint Management</h1>
          <span className="page-date-chip">
            <FiCalendar /> {fmtDate(activeDateStr ?? new Date().toISOString())}
          </span>
        </div>

        {isYesterday && (
          <div className="date-banner">
            <span className="date-banner__icon">{isCommitted ? <FiCheckCircle /> : <FiAlertTriangle />}</span>
            Showing {fmtDate(activeDateStr)} data — {isCommitted ? 'committed' : 'not yet committed'}
          </div>
        )}

        <div className="form-card">
          <div className="form-group">
            <label>Paypoint Value</label>
            <input
              type="number"
              placeholder="Enter Paypoint Value"
              value={paypointValue}
              readOnly={isLocked}
              onChange={isLocked ? undefined : (e) => setPaypointValue(e.target.value)}
            />
          </div>

          <button className="save-btn" onClick={handleSave} disabled={saving || isLocked}>
            {saving ? "Saving…" : editingId ? "Update Value" : "Save Value"}
          </button>
        </div>
      </div>
    </motion.div>
  );
};
