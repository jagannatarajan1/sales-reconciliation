import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiArrowLeft,
  FiCalendar,
  FiCheckCircle,
  FiAlertTriangle,
  FiAlertCircle,
} from "react-icons/fi";
import "./InstantLottertInventory.css";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";

const API_BASE = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/LotteryInstant`;
const SCRATCH_CARD_ORDER_KEY = "scratch-card-display-order";

const readStoredCardOrder = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SCRATCH_CARD_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const getOrderedItems = (items) => {
  const order = readStoredCardOrder();
  const orderMap = new Map(order.map((id, index) => [String(id), index]));

  return [...items].sort((a, b) => {
    const aKey = String(a.id ?? a.lotteryId ?? a.scratchCardNo ?? "");
    const bKey = String(b.id ?? b.lotteryId ?? b.scratchCardNo ?? "");
    const aOrder = orderMap.get(aKey);
    const bOrder = orderMap.get(bKey);

    if (aOrder === undefined && bOrder === undefined) return 0;
    if (aOrder === undefined) return 1;
    if (bOrder === undefined) return -1;
    return aOrder - bOrder;
  });
};

// Open No / Close No are ticket counters (whole numbers) — strip anything
// that isn't a digit so a decimal point (or pasted text) can never reach the
// backend, which rejects non-integer values with a raw JSON conversion error.
const toIntString = (v) => v.replace(/[^0-9]/g, "");

/* ══════════════════════════════════
   A. TODAY'S INVENTORY
══════════════════════════════════ */
function TodayInventory({ token, showToast, userRole, isLocked }) {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchInventory = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`${API_BASE}/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch inventory");
      const data = await res.json();
      setInventory(
        getOrderedItems(
          data.map((item) => ({
            inventoryId: item.id, // id>0 means today's row is already saved; 0 means unsaved
            lotteryId: item.lotteryId,
            scratchCardNo: item.scratchCardNo,
            price: item.price,
            openNo: item.openNo,
            // The backend has no way to represent "not yet entered" for Close No other
            // than 0 (it's a non-nullable int, and 0 is never a realistic real close
            // reading for a sequential ticket counter), so treat it as blank here too.
            closeNo: item.closeNo || "",
            totalSold: item.totalSold || 0,
            sales: item.sales || 0,
          })),
        ),
      );
    } catch (e) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  useEffect(() => {
    const handleOrderChanged = () => {
      fetchInventory();
    };

    window.addEventListener("scratch-card-order-updated", handleOrderChanged);
    window.addEventListener("storage", handleOrderChanged);
    return () => {
      window.removeEventListener(
        "scratch-card-order-updated",
        handleOrderChanged,
      );
      window.removeEventListener("storage", handleOrderChanged);
    };
  }, [fetchInventory]);

  const handlePrice = (i, v) => {
    const rows = [...inventory];
    rows[i].price = v;
    rows[i].sales = Number(rows[i].totalSold || 0) * Number(v || 0);
    setInventory(rows);
  };

  const handleOpen = (i, v) => {
    const rows = [...inventory];
    rows[i].openNo = v;
    if (rows[i].closeNo !== "" && rows[i].closeNo !== null) {
      // Abs, not clamp-to-0 — matches the backend, which treats Close No < Open No
      // as a valid miscount/re-open and takes the absolute difference. Abs also
      // never goes negative, so it avoids the old negative-flash while typing
      // without permanently zeroing out a legitimately lower final Close No.
      rows[i].totalSold = Math.abs(Number(rows[i].closeNo) - Number(v));
      rows[i].sales = rows[i].totalSold * Number(rows[i].price);
    }
    setInventory(rows);
  };

  const handleClose = (i, v) => {
    const rows = [...inventory];
    rows[i].closeNo = v;
    rows[i].totalSold =
      v === "" ? 0 : Math.abs(Number(v) - Number(rows[i].openNo));
    rows[i].sales = rows[i].totalSold * Number(rows[i].price);
    setInventory(rows);
  };

  const saveInventory = async () => {
    try {
      setSaving(true);
      const isCleared = (item) => item.closeNo === "" || item.closeNo === null;

      // Rows with a Close No to save.
      const toSave = inventory.filter((item) => !isCleared(item));
      // Rows that already have a saved record for today but were just cleared —
      // delete the record so they go back to their pre-save (blank) state, instead
      // of being silently skipped and then reappearing unchanged on refetch.
      const toDelete = inventory.filter(
        (item) => isCleared(item) && item.inventoryId,
      );

      if (!toSave.length && !toDelete.length) {
        showToast("Enter Close No for at least one row", "error");
        return;
      }

      for (const item of toSave) {
        const res = await fetch(API_BASE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            lotteryId: item.lotteryId,
            inventoryDate: new Date(),
            openNo: Number(item.openNo),
            closeNo: Number(item.closeNo),
          }),
        });
        if (!res.ok) throw new Error("Failed to save inventory");
      }

      for (const item of toDelete) {
        const res = await fetch(`${API_BASE}/today/${item.lotteryId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to clear inventory");
      }

      showToast("Inventory saved successfully");
      fetchInventory();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const grandSold = inventory.reduce((s, r) => s + Number(r.totalSold || 0), 0);
  const grandSales = inventory.reduce((s, r) => s + Number(r.sales || 0), 0);

  return (
    <>
      {/* Summary */}
      <div className="summary-bar">
        <div className="stat-card">
          <div className="stat-label">Lottery Types</div>
          <div className="stat-value primary">{inventory.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Sold</div>
          <div className="stat-value">{grandSold}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Sales</div>
          <div className="stat-value green">£{grandSales.toFixed(2)}</div>
        </div>
      </div>

      {loading && (
        <div className="loading-container">Loading today's inventory…</div>
      )}
      {error && (
        <div className="error-container">
          <FiAlertCircle /> {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="table-container">
            <table className="inventory-grid">
              <thead>
                <tr>
                  <th>Scratch Card No</th>
                  <th>Price (£)</th>
                  <th>Open No</th>
                  <th>Close No</th>
                  <th>Total Sold</th>
                  <th>Sales (£)</th>
                </tr>
              </thead>
              <tbody>
                {inventory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="no-data">
                      No active lotteries found.
                    </td>
                  </tr>
                ) : (
                  inventory.map((item, i) => (
                    <tr key={item.lotteryId}>
                      <td>{item.scratchCardNo}</td>
                      <td>
                        <input
                          className="close-input"
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.price}
                          readOnly={userRole === "user"}
                          onChange={
                            userRole === "user"
                              ? undefined
                              : (e) => handlePrice(i, e.target.value)
                          }
                          style={
                            userRole === "user"
                              ? {
                                  background: "#f9fafb",
                                  color: "#6b7280",
                                  cursor: "default",
                                }
                              : undefined
                          }
                          title={
                            userRole === "user"
                              ? "Auto-set from yesterday's close"
                              : undefined
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="close-input"
                          type="number"
                          min="0"
                          value={item.openNo}
                          readOnly={userRole === "user"}
                          onChange={
                            userRole === "user"
                              ? undefined
                              : (e) => handleOpen(i, e.target.value)
                          }
                          style={
                            userRole === "user"
                              ? {
                                  background: "#f9fafb",
                                  color: "#6b7280",
                                  cursor: "default",
                                }
                              : undefined
                          }
                          title={
                            userRole === "user"
                              ? "Auto-set from yesterday's close"
                              : undefined
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="close-input"
                          type="number"
                          min="0"
                          value={item.closeNo}
                          placeholder="Enter close"
                          readOnly={isLocked}
                          onChange={
                            isLocked
                              ? undefined
                              : (e) => handleClose(i, e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <span
                          className={`badge ${item.totalSold > 0 ? "badge-green" : "badge-gray"}`}
                        >
                          {item.totalSold}
                        </span>
                      </td>
                      <td>£{Number(item.sales).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="grand-total-label">
                    Grand Total
                  </td>
                  <td>{grandSold}</td>
                  <td>£{grandSales.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="button-container">
            <button
              className="save-button"
              onClick={saveInventory}
              disabled={saving || isLocked}
            >
              {saving ? "Saving…" : "Save Inventory"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/* ══════════════════════════════════
   ROOT
══════════════════════════════════ */
const SUMMARY_URL = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/Summary`;

export const InstantLotteryInventory = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [activeDate, setActiveDate] = useState(null);
  const [isCommitted, setIsCommitted] = useState(false);
  const [isPendingAdminReview, setIsPendingAdminReview] = useState(false);

  useEffect(() => {
    fetch(`${SUMMARY_URL}/today`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.date) setActiveDate(d.date);
        setIsCommitted(d?.isCommitted ?? false);
        setIsPendingAdminReview(d?.isPendingAdminReview ?? false);
      })
      .catch(() => {});
  }, [user.token]);

  const todayStr = new Date().toISOString().split("T")[0];
  const activeDateStr = activeDate ? activeDate.split("T")[0] : null;
  const isYesterday = activeDateStr && activeDateStr !== todayStr;
  const isLocked = isCommitted || isPendingAdminReview;
  const fmtDate = (d) =>
    new Date(d).toLocaleDateString("en-GB", {
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
        <div className="page-header">
          <div className="page-title-row">
            <h1>
              Instant Lottery <span>Inventory</span>
            </h1>
            <span className="page-date-chip">
              <FiCalendar />{" "}
              {fmtDate(activeDateStr ?? new Date().toISOString())}
            </span>
          </div>
        </div>

        {isYesterday && (
          <div className="date-banner">
            <span className="date-banner__icon">
              {isCommitted ? <FiCheckCircle /> : <FiAlertTriangle />}
            </span>
            Showing {fmtDate(activeDateStr)} data —{" "}
            {isCommitted ? "committed" : "not yet committed"}
          </div>
        )}

        <TodayInventory
          token={user.token}
          showToast={showToast}
          userRole={user.role}
          isLocked={isLocked}
        />
      </div>
    </motion.div>
  );
};
