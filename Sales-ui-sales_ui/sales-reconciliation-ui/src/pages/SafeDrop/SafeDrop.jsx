import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiArrowLeft, FiTrash2 } from "react-icons/fi";
import "./SafeDrop.css";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";

const BASE_URL = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/SafeDrop`;

export const SafeDrop = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [record, setRecord] = useState(null);
  const [lastSafe, setLastSafe] = useState("");
  const [safeDropAmount, setSafeDropAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cash =
    lastSafe !== "" && safeDropAmount !== ""
      ? (parseFloat(lastSafe) + parseFloat(safeDropAmount)).toFixed(2)
      : "";

  useEffect(() => {
    loadToday();
  }, []);

  const authHeaders = () => ({
    Authorization: `Bearer ${user.token}`,
  });

  const loadToday = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/today`, {
        headers: authHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setRecord(data);
        setLastSafe(String(data.lastSafe));
        setSafeDropAmount(String(data.safeDropAmount));
      } else if (response.status === 404) {
        setRecord(null);
        setLastSafe("");
        setSafeDropAmount("");
      }
    } catch (error) {
      console.error("Load error:", error);
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

    try {
      const response = await fetch(BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          lastSafe: parseFloat(lastSafe),
          safeDropAmount: parseFloat(safeDropAmount),
        }),
      });

      if (response.ok) {
        showToast("Saved successfully");
        loadToday();
      } else {
        const err = await response.text();
        showToast(`Save failed: ${err}`, "error");
      }
    } catch (error) {
      console.error("Save error:", error);
    }
  };

  const handleDelete = async () => {
    if (!record) return;
    setDeleting(true);
    try {
      const response = await fetch(`${BASE_URL}/today`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (response.ok) {
        setRecord(null);
        setLastSafe("");
        setSafeDropAmount("");
        showToast("Safe Drop record deleted");
      } else {
        showToast("Delete failed", "error");
      }
    } catch (error) {
      console.error("Delete error:", error);
      showToast("Network error deleting", "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

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
        <div className="safe-drop-header">
          <h1>Safe Drop</h1>
          <span className="safe-drop-date">{today}</span>
        </div>

        {loading ? (
          <p className="safe-drop-loading">Loading...</p>
        ) : (
          <>
            <div className="table-container">
              <table className="safe-drop-grid">
                <thead>
                  <tr>
                    <th>Last Safe (£)</th>
                    <th>Safe Drop Amount (£)</th>
                    <th>Cash (£)</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Enter Last Safe amount"
                        value={lastSafe}
                        onChange={(e) => setLastSafe(e.target.value)}
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Enter Safe Drop Amount"
                        value={safeDropAmount}
                        onChange={(e) => setSafeDropAmount(e.target.value)}
                      />
                    </td>

                    <td>
                      <input
                        type="text"
                        readOnly
                        value={cash}
                        placeholder="—"
                        className="cash-computed"
                      />
                    </td>

                    <td className="action-cell">
                      <button className="save-btn" onClick={handleSave}>
                        Save
                      </button>

                      {record && (
                        <button className="delete-btn" onClick={() => setConfirmDelete(true)}>
                          <FiTrash2 />
                        </button>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {record && (
              <div className="safe-drop-meta">
                <span>
                  Last saved:{" "}
                  {new Date(record.updatedAt ?? record.createdAt).toLocaleString(
                    "en-GB"
                  )}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Safe Drop record?"
        message="Are you sure you want to delete today's Safe Drop record?"
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </motion.div>
  );
};
