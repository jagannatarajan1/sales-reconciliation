import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiTrash2 } from "react-icons/fi";
import "./SafeDrop.css";
import { useAuth } from "../../context/AuthContext";

const BASE_URL = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/SafeDrop`;

export const SafeDrop = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [record, setRecord] = useState(null);
  const [lastSafe, setLastSafe] = useState("");
  const [safeDropAmount, setSafeDropAmount] = useState("");
  const [loading, setLoading] = useState(true);

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
      alert("Please enter Last Safe amount");
      return;
    }
    if (safeDropAmount === "") {
      alert("Please enter Safe Drop Amount");
      return;
    }
    if (parseFloat(lastSafe) < 0 || parseFloat(safeDropAmount) < 0) {
      alert("Values cannot be negative");
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
        alert("Saved Successfully");
        loadToday();
      } else {
        const err = await response.text();
        alert(`Save failed: ${err}`);
      }
    } catch (error) {
      console.error("Save error:", error);
    }
  };

  const handleDelete = async () => {
    if (!record) return;

    const confirmDelete = window.confirm(
      "Are you sure you want to delete today's Safe Drop record?"
    );
    if (!confirmDelete) return;

    try {
      const response = await fetch(`${BASE_URL}/today`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      if (response.ok) {
        setRecord(null);
        setLastSafe("");
        setSafeDropAmount("");
      } else {
        alert("Delete failed");
      }
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="page-container">
      <button className="back-button" onClick={() => navigate(-1)}>
        ← Back
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
                        <button className="delete-btn" onClick={handleDelete}>
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
    </div>
  );
};
