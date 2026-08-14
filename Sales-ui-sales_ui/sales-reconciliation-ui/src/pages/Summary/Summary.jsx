import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiCreditCard,
  FiDollarSign,
  FiTrendingDown,
  FiPackage,
  FiFileText,
  FiCircle,
  FiBarChart2,
  FiArrowLeft,
  FiUsers,
  FiEdit2,
  FiX,
} from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import { isWithinTolerance } from "../../constants";
import "./Summary.css";

const API_BASE = import.meta.env.VITE_API_URL || "https://localhost:7276/api";
const SUMMARY_URL = `${API_BASE}/Summary`;

const SECTIONS = [
  {
    label: "Credit Card Banking",
    icon: FiCreditCard,
    color: "blue",
    type: "creditCard",
  },
  {
    label: "Cash Banking",
    icon: FiDollarSign,
    color: "green",
    fields: [
      {
        key: "lastSafe",
        label: "Last Safe",
        currency: "£",
        placeholder: "Enter Last Safe amount",
      },
      {
        key: "safeDropAmount",
        label: "Safe Drop Amount",
        currency: "£",
        placeholder: "Enter Safe Drop Amount",
      },
      {
        key: "cash",
        label: "Cash (Total)",
        currency: "£",
        readOnly: true,
        isTotal: true,
        placeholder: "Auto-calculated",
      },
    ],
  },
  {
    label: "Deductions",
    icon: FiTrendingDown,
    color: "orange",
    fields: [
      { key: "cashback", label: "Cashback" },
      { key: "paypointPayout", label: "Paypoint Payout" },
      { key: "instantLotteryPayout", label: "Instant Lottery Payout" },
      { key: "lotteryPayout", label: "Lottery Payout" },
      { key: "newsVoucher", label: "News Voucher" },
      { key: "ddPoint", label: "DD Point" },
    ],
  },
  {
    label: "Instant Lottery Inventory",
    icon: FiPackage,
    color: "purple",
    redirectPath: "/instant-lottery-inventory",
    fields: [
      {
        key: "instantLotteryTotalCount",
        label: "Total Scratch Cards Sold",
        readOnly: true,
        note: "Auto-calculated from inventory",
        currency: "#",
        placeholder: "Auto-calculated",
      },
      {
        key: "instantLotteryTotalSales",
        label: "Total Sales",
        readOnly: true,
        note: "Auto-calculated from inventory",
        placeholder: "Auto-calculated",
      },
    ],
  },
  {
    label: "Supplier Payout",
    icon: FiFileText,
    color: "rose",
    redirectPath: "/deductions",
    fields: [
      {
        key: "supplierInvoicesTotal",
        label: "Supplier Payout",
        readOnly: true,
        note: "Auto-calculated from invoices entered in Deductions",
        placeholder: "Auto-calculated",
      },
    ],
  },
  {
    label: "Lottery Management",
    icon: FiCircle,
    color: "gold",
    fields: [{ key: "lotteryValue", label: "Lottery Value" }],
  },
  {
    label: "Paypoint Management",
    icon: FiCircle,
    color: "teal",
    fields: [{ key: "paypointValue", label: "Paypoint Value" }],
  },
];

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
  },
};

const EDITABLE_KEYS = [
  "cashback",
  "paypointPayout",
  "instantLotteryPayout",
  "lotteryPayout",
  "newsVoucher",
  "ddPoint",
  "lotteryValue",
  "paypointValue",
];

const READ_ONLY_KEYS = [
  "instantLotteryTotalSales",
  "instantLotteryTotalCount",
  "supplierInvoicesTotal",
];

const blankCCRow = () => ({
  id: 0,
  manualCardAmount: "",
  cardAmount: "",
  createdDate: null,
});

const defaultForm = () =>
  Object.fromEntries([...EDITABLE_KEYS, ...READ_ONLY_KEYS].map((k) => [k, ""]));

export const Summary = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form, setForm] = useState(defaultForm());
  const [safeData, setSafeData] = useState({
    lastSafe: "",
    safeDropAmount: "",
  });
  const [ccEntries, setCcEntries] = useState([blankCCRow()]);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const [isCommitted, setIsCommitted] = useState(false);
  const [isPendingAdminReview, setIsPendingAdminReview] = useState(false);
  const [departmentTotal, setDepartmentTotal] = useState(null);
  const [shiftLabel, setShiftLabel] = useState(null);
  const [shiftReportTotal, setShiftReportTotal] = useState(null);
  const [shiftReportCount, setShiftReportCount] = useState(0);

  // Staff Notes — free-text, per-day, persisted on DailySummary; carried
  // forward to the Commit page via router state when the user proceeds.
  const [staffNotes, setStaffNotes] = useState("");

  // ── Explicit edit mode (§8) — page opens read-only; the pencil "Edit"
  // button reveals Save/Cancel and makes the saved-data fields editable.
  // Cancel re-fetches from the server (loadToday) to discard any unsaved
  // in-progress changes rather than just hiding the fields.
  const [isEditing, setIsEditing] = useState(false);

  const isLocked = isCommitted || isPendingAdminReview;
  const fieldsDisabled = isLocked || !isEditing;

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  const cashTotal = (() => {
    const ls = parseFloat(safeData.lastSafe);
    const sd = parseFloat(safeData.safeDropAmount);
    if (isNaN(ls) && isNaN(sd)) return "";
    return ((isNaN(ls) ? 0 : ls) + (isNaN(sd) ? 0 : sd)).toFixed(2);
  })();

  useEffect(() => {
    loadToday();
  }, []);

  const loadToday = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SUMMARY_URL}/today`, {
        headers: authHeaders(),
      });

      if (res.ok) {
        const data = await res.json();
        setDate(data.date ?? "");
        setIsCommitted(data.isCommitted ?? false);
        setIsPendingAdminReview(data.isPendingAdminReview ?? false);
        setDepartmentTotal(
          typeof data.departmentTotal === "number" ? data.departmentTotal : null,
        );
        setShiftLabel(data.shiftLabel ?? null);
        setShiftReportTotal(typeof data.shiftReportTotal === "number" ? data.shiftReportTotal : null);
        setShiftReportCount(data.shiftReportCount ?? 0);
        // Staff Notes (C-revised) — persisted per-day on DailySummary, loaded
        // here so it round-trips through Save like every other field. Only
        // overwritten from the server on load; typing then hitting Save is
        // still what actually persists it.
        setStaffNotes(data.staffNotes ?? "");

        if (!data.hasTodayData) {
          // Fresh day — no data entered yet for the active date.
          setCcEntries([blankCCRow()]);
          setSafeData({ lastSafe: "", safeDropAmount: "" });
          setForm(defaultForm());
        } else {
          // Credit card entries — a saved 0 shows as blank so the placeholder
          // ("Enter Manual Card Amount" / "Enter Card Amount") shows through.
          const entries =
            Array.isArray(data.creditCardEntries) &&
            data.creditCardEntries.length > 0
              ? data.creditCardEntries.map((e) => ({
                  id: e.id,
                  manualCardAmount: e.manualCardAmount
                    ? String(e.manualCardAmount)
                    : "",
                  cardAmount: e.cardAmount ? String(e.cardAmount) : "",
                  createdDate: e.createdDate ?? null,
                }))
              : [blankCCRow()];
          setCcEntries(entries);

          // Cash banking — same treatment for Last Safe / Safe Drop Amount.
          setSafeData({
            lastSafe: data.lastSafe ? String(data.lastSafe) : "",
            safeDropAmount: data.safeDropAmount
              ? String(data.safeDropAmount)
              : "",
          });

          // Remaining fields — a saved 0 (or missing value) is treated as blank so the
          // "Auto-calculated" / "Enter ..." placeholder shows through instead of a literal "0".
          setForm(
            Object.fromEntries(
              [...EDITABLE_KEYS, ...READ_ONLY_KEYS].map((k) => {
                const v = data[k];
                return [k, v ? String(v) : ""];
              }),
            ),
          );
        }
      } else if (res.status !== 404) {
        showToast("Failed to load summary", "error");
      }
    } catch {
      showToast("Network error loading summary", "error");
    } finally {
      setLoading(false);
    }
  };

  // ── Credit card table handlers ───────────────────────────
  const handleCCChange = (index, key, value) => {
    setCcEntries((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  };

  // ── Other field handler ──────────────────────────────────
  const handleChange = (key, value) => {
    if (key === "lastSafe" || key === "safeDropAmount") {
      setSafeData((prev) => ({ ...prev, [key]: value }));
    } else {
      setForm((prev) => ({ ...prev, [key]: value }));
    }
  };

  // ── Save ─────────────────────────────────────────────────
  const handleSave = async () => {
    const body = {
      ...Object.fromEntries(
        EDITABLE_KEYS.map((k) => [k, parseFloat(form[k]) || 0]),
      ),
      lastSafe: parseFloat(safeData.lastSafe) || 0,
      safeDropAmount: parseFloat(safeData.safeDropAmount) || 0,
      staffNotes: staffNotes.trim(),
      creditCardEntries: ccEntries.map((row) => ({
        id: row.id,
        manualCardAmount: parseFloat(row.manualCardAmount) || 0,
        cardAmount: parseFloat(row.cardAmount) || 0,
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
        showToast("Summary saved successfully");
        setIsEditing(false);
      } else {
        const err = await res.text();
        showToast(`Save failed: ${err}`, "error");
      }
    } catch {
      showToast("Network error saving summary", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Cancel edit ───────────────────────────────────────────
  // Discards any unsaved in-progress changes by re-fetching the last-saved
  // values from the server (rather than merely hiding the fields), then
  // returns the page to read-only.
  const handleCancelEdit = () => {
    setIsEditing(false);
    loadToday();
  };

  // ── Proceed to Commit ────────────────────────────────────
  // Summary and Commit are independent Dashboard entries, not a wizard —
  // there's no existing state-passing between them. This carries staffNotes
  // forward via router state as a convenience; Commit.jsx re-collects it
  // itself so direct navigation to /commit still works.
  const handleProceedToCommit = () => {
    navigate("/commit", {
      state: { staffNotes: staffNotes.trim() },
    });
  };

  // ── Live summary total (recalculates on every field change) ──
  // Matches the backend's actual formula (SummaryService.GetZReportComparisonAsync /
  // AdminReconciliation's computeSummaryTotal): every field is summed as entered, including
  // both card amounts. Deduction fields carry their own sign (negative = an actual
  // deduction), so they're added, never subtracted — subtracting an already-negative
  // value would double it back the wrong way.
  const manualCardTotal = ccEntries.reduce(
    (s, r) => s + (parseFloat(r.manualCardAmount) || 0),
    0,
  );
  const ccTotal = ccEntries.reduce(
    (s, r) => s + (parseFloat(r.cardAmount) || 0),
    0,
  );
  const cashNum = parseFloat(cashTotal) || 0;
  const ilsNum = parseFloat(form.instantLotteryTotalSales) || 0;
  const lotteryNum = parseFloat(form.lotteryValue) || 0;
  const paypointNum = parseFloat(form.paypointValue) || 0;
  const supplierNum = parseFloat(form.supplierInvoicesTotal) || 0;
  const deductionsNum =
    (parseFloat(form.cashback) || 0) +
    (parseFloat(form.paypointPayout) || 0) +
    (parseFloat(form.instantLotteryPayout) || 0) +
    (parseFloat(form.lotteryPayout) || 0) +
    (parseFloat(form.newsVoucher) || 0) +
    (parseFloat(form.ddPoint) || 0);
  const incomeNum =
    manualCardTotal +
    ccTotal +
    cashNum +
    ilsNum +
    lotteryNum +
    paypointNum +
    supplierNum;
  const liveSummaryTotal = incomeNum + deductionsNum;

  // Staff total vs. the till's own reported total, when today's Z-Report
  // email has been read (see /Summary/today's departmentTotal field).
  const hasDepartmentTotal = typeof departmentTotal === "number";
  const variance = hasDepartmentTotal
    ? liveSummaryTotal - departmentTotal
    : null;
  const varianceInTolerance = hasDepartmentTotal && isWithinTolerance(variance);

  const fmt = (n) => `£${n.toFixed(2)}`;

  const displayDate = date
    ? new Date(date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

  const fieldValue = (key) => {
    if (key === "lastSafe") return safeData.lastSafe;
    if (key === "safeDropAmount") return safeData.safeDropAmount;
    if (key === "cash") return cashTotal;
    return form[key];
  };

  return (
    <motion.div
      className="summary-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <button className="summary-back-btn" onClick={() => navigate(-1)}>
        <FiArrowLeft /> Back
      </button>

      <div className="summary-header">
        <div className="summary-title-wrap">
          <span className="summary-icon">
            <FiBarChart2 />
          </span>
          <div>
            <h1 className="summary-title">Summary</h1>
            <p className="summary-subtitle">Daily reconciliation overview</p>
          </div>
        </div>
        <div className="summary-header-actions">
          <div className="summary-date-chip">{displayDate}</div>
          {!isLocked && !isEditing && (
            <button
              type="button"
              className="summary-edit-toggle-btn"
              onClick={() => setIsEditing(true)}
              title="Edit this summary"
            >
              <FiEdit2 /> Edit
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="summary-loading-wrap">
          <div className="summary-spinner" />
          <span>Loading today's summary…</span>
        </div>
      ) : (
        <>
          <motion.div
            className="summary-cards-grid"
            variants={gridVariants}
            initial="hidden"
            animate="visible"
          >
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <motion.div
                  key={section.label}
                  className={`summary-card summary-card--${section.color}`}
                  variants={cardVariants}
                  whileHover={{ y: -4 }}
                >
                  <div className="summary-card-header">
                    <span className="summary-card-icon">
                      <Icon />
                    </span>
                    <span className="summary-card-title">{section.label}</span>
                  </div>

                  {/* ── Credit Card Banking — same field-row style as the Credit Card Banking page ── */}
                  {section.type === "creditCard" ? (
                    <div className="summary-card-body">
                      {ccEntries.map((row, i) => (
                        <div className="summary-cc-entry" key={i}>
                          {ccEntries.length > 1 && (
                            <p className="summary-cc-entry-label">
                              Entry {i + 1}
                            </p>
                          )}

                          <div className="summary-field">
                            <label className="summary-field-label">
                              Manual Card Amount
                            </label>
                            <div className="summary-input-wrap">
                              <span className="summary-currency">£</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Enter Manual Card Amount"
                                value={row.manualCardAmount}
                                className="summary-input"
                                readOnly={fieldsDisabled}
                                onChange={
                                  fieldsDisabled
                                    ? undefined
                                    : (e) =>
                                        handleCCChange(
                                          i,
                                          "manualCardAmount",
                                          e.target.value,
                                        )
                                }
                              />
                            </div>
                          </div>

                          <div className="summary-field">
                            <label className="summary-field-label">
                              Card Amount
                            </label>
                            <div className="summary-input-wrap">
                              <span className="summary-currency">£</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Enter Card Amount"
                                value={row.cardAmount}
                                className="summary-input"
                                readOnly={fieldsDisabled}
                                onChange={
                                  fieldsDisabled
                                    ? undefined
                                    : (e) =>
                                        handleCCChange(
                                          i,
                                          "cardAmount",
                                          e.target.value,
                                        )
                                }
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* ── All other sections — field rows ── */
                    <div className="summary-card-body">
                      {section.fields.map((field) => (
                        <div
                          className={`summary-field${field.isTotal ? " summary-field--total" : ""}`}
                          key={field.key}
                        >
                          <label className="summary-field-label">
                            {field.label}
                            {field.note && (
                              <span className="summary-field-note">
                                {field.note}
                              </span>
                            )}
                          </label>
                          <div
                            className={`summary-input-wrap${
                              field.readOnly
                                ? " summary-input-wrap--readonly"
                                : ""
                            }${field.isTotal ? " summary-input-wrap--total" : ""}`}
                          >
                            <span className="summary-currency">
                              {field.currency ?? "£"}
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder={
                                field.placeholder ?? `Enter ${field.label}`
                              }
                              value={fieldValue(field.key)}
                              disabled={field.readOnly || fieldsDisabled}
                              className="summary-input"
                              onChange={
                                field.readOnly || fieldsDisabled
                                  ? undefined
                                  : (e) =>
                                      handleChange(field.key, e.target.value)
                              }
                            />
                          </div>
                        </div>
                      ))}
                      {section.redirectPath && (
                        <button
                          className={`summary-redirect-btn summary-redirect-btn--${section.color}`}
                          onClick={() => navigate(section.redirectPath)}
                        >
                          Edit in {section.label} →
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>

          {/* ── Shift (hidden entirely until the feature is live for this shop) ── */}
          {shiftLabel && (
            <div className="summary-total-panel summary-shift-panel">
              <div className="summary-total-panel__title">{shiftLabel}</div>
              <div className="summary-total-panel__rows">
                <div className="summary-total-panel__row">
                  <span>Till X-Report Total (this shift)</span>
                  <span className={shiftReportTotal == null ? "summary-total-panel__row--muted" : ""}>
                    {shiftReportTotal != null ? fmt(shiftReportTotal) : "Not yet received"}
                  </span>
                </div>
                {shiftReportCount > 1 && (
                  <div className="summary-shift-reprint-note">
                    {shiftReportCount} X-Reports found for this shift — totals summed
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Live Summary Total ── */}
          <div className="summary-total-panel">
            <div className="summary-total-panel__title">Summary Total</div>
            <div className="summary-total-panel__rows">
              <div className="summary-total-panel__row">
                <span>Credit Card</span>
                <span>{fmt(manualCardTotal + ccTotal)}</span>
              </div>
              <div className="summary-total-panel__row">
                <span>Cash</span>
                <span>{fmt(cashNum)}</span>
              </div>
              <div className="summary-total-panel__row">
                <span>Instant Lottery Sales</span>
                <span>{fmt(ilsNum)}</span>
              </div>
              <div className="summary-total-panel__row">
                <span>Lottery</span>
                <span>{fmt(lotteryNum)}</span>
              </div>
              <div className="summary-total-panel__row">
                <span>Paypoint</span>
                <span>{fmt(paypointNum)}</span>
              </div>
              <div className="summary-total-panel__row">
                <span>Supplier Payout</span>
                <span>{fmt(supplierNum)}</span>
              </div>
              <div className="summary-total-panel__row">
                <span>Total Deductions</span>
                <span>{fmt(deductionsNum)}</span>
              </div>
              <div className="summary-total-panel__row summary-total-panel__row--staff-total">
                <span>Staff Total</span>
                <span>{fmt(liveSummaryTotal)}</span>
              </div>
              <div className="summary-total-panel__row summary-total-panel__row--department-total">
                <span>Z-Report Total (full day)</span>
                <span className={hasDepartmentTotal ? "" : "summary-total-panel__row--muted"}>
                  {hasDepartmentTotal ? fmt(departmentTotal) : "Not yet received"}
                </span>
              </div>
              <div className="summary-total-panel__row">
                <span>Variance</span>
                <span
                  className={
                    !hasDepartmentTotal
                      ? "summary-total-panel__row--muted"
                      : varianceInTolerance
                        ? "summary-total-panel__row--ok"
                        : "summary-total-panel__row--warn"
                  }
                >
                  {hasDepartmentTotal ? fmt(variance) : "—"}
                </span>
              </div>
            </div>
            <div className="summary-total-panel__net">
              <span>Net Summary Total</span>
              <span
                className={
                  liveSummaryTotal < 0
                    ? "summary-total-panel__net-val--neg"
                    : ""
                }
              >
                {fmt(liveSummaryTotal)}
              </span>
            </div>
          </div>

          {/* ── Staff Notes ── */}
          <div className="summary-total-panel summary-staff-panel">
            <div className="summary-total-panel__title">
              <FiUsers /> Staff Notes
            </div>
            <div className="summary-staff-panel__body">
              <div className="summary-field summary-staff-field summary-staff-field--notes">
                <label className="summary-field-label">Staff Notes (optional)</label>
                <textarea
                  className="summary-staff-notes"
                  rows={3}
                  placeholder="Anything the admin should know about today…"
                  value={staffNotes}
                  disabled={fieldsDisabled}
                  onChange={(e) => setStaffNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="summary-footer">
            {isLocked ? (
              <button className="summary-save-btn" disabled>
                {isCommitted ? "Already Committed" : "Locked — Awaiting Admin Review"}
              </button>
            ) : isEditing ? (
              <>
                <button
                  className="summary-save-btn"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <span className="btn-spinner" /> Saving…
                    </>
                  ) : (
                    "Save Summary"
                  )}
                </button>
                <button
                  className="summary-cancel-btn"
                  onClick={handleCancelEdit}
                  disabled={saving}
                >
                  <FiX /> Cancel
                </button>
              </>
            ) : null}
            <button
              className="summary-commit-btn"
              onClick={handleProceedToCommit}
              disabled={isLocked}
            >
              Proceed to Commit →
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
};
