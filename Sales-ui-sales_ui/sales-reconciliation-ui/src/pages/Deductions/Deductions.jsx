import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiArrowLeft, FiCalendar, FiAlertCircle, FiPlus, FiX, FiEdit2, FiCheck, FiLock } from 'react-icons/fi';
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../components/ui/Toast";
import "./Deductions.css";

const API = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const authHeader = (token) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

// ✅ Safe JSON parser — prevents "Unexpected end of JSON input"
// when the server returns 200/204 with an empty body
const safeJson = async (res) => {
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  return JSON.parse(text);
};

const FIELDS = [
  { key: 'cashback',             label: 'Cashback' },
  { key: 'paypointPayout',       label: 'Paypoint Payout' },
  { key: 'instantLotteryPayout', label: 'Instant Lottery Payout' },
  { key: 'lotteryPayout',        label: 'Lottery Payout' },
  { key: 'newsVoucher',          label: 'News Voucher' },
  { key: 'ddPoint',              label: 'DD Point' },
];

/* ══════════════════════════════════
   A. DEDUCTIONS GRID
══════════════════════════════════ */
function DeductionsGrid({ token, showToast, isLocked }) {
  const empty = Object.fromEntries(FIELDS.map(f => [f.key, '']));
  const [values, setValues] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const load = () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    fetch(`${API}/Deduction/today`, { headers: authHeader(token) })
      .then(safeJson) // ✅ replaces r => r.status === 404 || !r.ok ? null : r.json()
      .then(data => {
        setValues(data
          ? Object.fromEntries(FIELDS.map(f => [f.key, data[f.key] ? String(data[f.key]) : '']))
          : empty);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = FIELDS.reduce((s, f) => s + Number(values[f.key] || 0), 0);
  const fieldsDisabled = isLocked || !isEditing;

  const save = async () => {
    try {
      setSaving(true);
      const res = await fetch(`${API}/Deduction`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(
          Object.fromEntries(FIELDS.map(f => [f.key, Number(values[f.key] || 0)]))
        ),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || 'Failed to save');
      }
      showToast('Deductions saved successfully');
      setIsEditing(false);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Cancel discards unsaved changes by re-fetching from the server.
  const cancelEdit = () => {
    setIsEditing(false);
    load();
  };

  if (loading) return <div className="ded-loading">Loading…</div>;
  if (error)   return <div className="ded-loading" style={{ color: '#dc2626' }}><FiAlertCircle /> {error}</div>;

  return (
    <div className="ded-section">
      <div className="ded-section-header-row">
        <h2 className="ded-section-title">Deductions</h2>
        {!isLocked && !isEditing && (
          <button type="button" className="ded-edit-btn" onClick={() => setIsEditing(true)}>
            <FiEdit2 /> Edit
          </button>
        )}
      </div>
      <div className="ded-table-wrap">
        <table className="ded-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Amount (£)</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(f => (
              <tr key={f.key}>
                <td className="ded-label">{f.label}</td>
                <td>
                  <input
                    className="ded-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={`Enter ${f.label}`}
                    value={values[f.key]}
                    readOnly={fieldsDisabled}
                    onChange={fieldsDisabled ? undefined : e => setValues({ ...values, [f.key]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="ded-total-label">Total</td>
              <td className="ded-total-value">£{total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {isEditing && !isLocked && (
        <div className="ded-actions">
          <button className="ded-save-btn" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Deductions'}
          </button>
          <button className="ded-cancel-btn" onClick={cancelEdit} disabled={saving}>
            <FiX /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════
   B. SUPPLIER INVOICES
══════════════════════════════════ */
const blankInvoiceRow = () => ({ id: Date.now(), supplierId: '', invoiceNo: '', value: '' });

// §2 — supplier invoices become read-only once the day is committed, unless
// an admin has reopened that specific date (see PUT /Suppliers/invoices/reopen/:date).
// This lock is entirely independent of isLocked (DailySummary.isCommitted /
// isPendingAdminReview, which is unused/always-false today) — it's driven by
// ReconciliationRecord.isStaffCommitted for the active date only.
function SupplierInvoices({ token, showToast, isLocked, activeDate }) {
  const [suppliers, setSuppliers] = useState([]);
  const [invoices, setInvoices]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [rows, setRows]           = useState([blankInvoiceRow()]);
  const [saving, setSaving]       = useState(false);
  const [isEditingRows, setIsEditingRows] = useState(false);
  const [invoiceLock, setInvoiceLock] = useState({ isStaffCommitted: false, editable: true });
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [editDraft, setEditDraft] = useState({ supplierId: '', invoiceNo: '', value: '' });
  const [savingEditId, setSavingEditId] = useState(null);

  const loadInvoices = () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      fetch(`${API}/Suppliers`, { headers: authHeader(token) }).then(safeJson), // ✅
      fetch(`${API}/Suppliers/invoices/today`, { headers: authHeader(token) }).then(safeJson), // ✅
    ])
      .then(([sup, inv]) => {
        setSuppliers(Array.isArray(sup) ? sup : []);
        setInvoices(Array.isArray(inv) ? inv : []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadInvoices(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token || !activeDate) return;
    const dateStr = activeDate.split('T')[0];
    fetch(`${API}/Suppliers/invoices/lock-status?date=${dateStr}`, { headers: authHeader(token) })
      .then(safeJson)
      .then(data => { if (data) setInvoiceLock(data); })
      .catch(() => {});
  }, [token, activeDate]);

  const invoicesLocked = isLocked || !invoiceLock.editable;

  const addRow = () =>
    setRows(prev => [...prev, blankInvoiceRow()]);

  const updateRow = (id, field, val) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));

  const removeRow = (id) =>
    setRows(prev => prev.filter(r => r.id !== id));

  const saveRows = async () => {
    const valid = rows.filter(r => r.supplierId && r.invoiceNo && r.value);
    if (!valid.length) { showToast('Fill in all fields for at least one row', 'error'); return; }
    try {
      setSaving(true);
      const saved = [];
      for (const row of valid) {
        const res = await fetch(`${API}/Suppliers/invoices`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            supplierId: Number(row.supplierId),
            invoiceNo:  row.invoiceNo,
            value:      Number(row.value),
          }),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || 'Failed to save invoice');
        }
        const created = await safeJson(res);
        const supplierName = suppliers.find(s => String(s.id) === String(row.supplierId))?.name || '';
        saved.push({
          id:           created?.id ?? row.id,
          supplierName: created?.supplierName ?? supplierName,
          invoiceNo:    created?.invoiceNo ?? row.invoiceNo,
          value:        created?.value ?? Number(row.value),
        });
      }

      // Show the newly saved invoices immediately — don't depend on the
      // /today refetch succeeding, so a save is never invisible in the UI.
      setInvoices(prev => [...prev, ...saved]);
      setRows([blankInvoiceRow()]);
      showToast('Invoices saved successfully');

      fetch(`${API}/Suppliers/invoices/today`, { headers: authHeader(token) })
        .then(safeJson)
        .then(inv => { if (Array.isArray(inv)) setInvoices(inv); })
        .catch(() => {});
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteInvoice = async (id) => {
    try {
      const res = await fetch(`${API}/Suppliers/invoices/${id}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || 'Failed to delete');
      }
      setInvoices(prev => prev.filter(i => i.id !== id));
      showToast('Invoice deleted');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // §2 — inline edit of an already-saved invoice's supplier/invoice no/value.
  const startEditInvoice = (inv) => {
    setEditingInvoiceId(inv.id);
    setEditDraft({
      supplierId: suppliers.find(s => s.name === inv.supplierName)?.id ?? '',
      invoiceNo: inv.invoiceNo,
      value: String(inv.value),
    });
  };

  const cancelEditInvoice = () => {
    setEditingInvoiceId(null);
    setEditDraft({ supplierId: '', invoiceNo: '', value: '' });
  };

  const saveEditInvoice = async (id) => {
    setSavingEditId(id);
    try {
      const res = await fetch(`${API}/Suppliers/invoices/${id}`, {
        method: 'PUT',
        headers: authHeader(token),
        body: JSON.stringify({
          supplierId: editDraft.supplierId ? Number(editDraft.supplierId) : undefined,
          invoiceNo: editDraft.invoiceNo,
          value: Number(editDraft.value) || 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || 'Failed to update invoice');
      }
      const updated = await safeJson(res);
      setInvoices(prev => prev.map(i => (i.id === id ? { ...i, ...updated } : i)));
      showToast('Invoice updated successfully');
      cancelEditInvoice();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSavingEditId(null);
    }
  };

  const grandTotal =
    invoices.reduce((s, i) => s + Number(i.value || 0), 0) +
    rows.reduce((s, r) => s + Number(r.value || 0), 0);

  if (loading) return <div className="ded-loading">Loading…</div>;
  if (error)   return <div className="ded-loading" style={{ color: '#dc2626' }}><FiAlertCircle /> {error}</div>;

  return (
    <div className="ded-section">
      <div className="ded-section-header-row">
        <h2 className="ded-section-title">Supplier Payout</h2>
        {!invoicesLocked && !isEditingRows && (
          <button type="button" className="ded-edit-btn" onClick={() => setIsEditingRows(true)}>
            <FiEdit2 /> Edit
          </button>
        )}
      </div>

      {invoiceLock.isStaffCommitted && !invoiceLock.editable && (
        <div className="ded-lock-banner">
          <FiLock /> This date has been committed — supplier invoices are read-only. Ask an admin to reopen this date to make changes.
        </div>
      )}

      <div className="ded-table-wrap">
        <table className="ded-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Invoice No</th>
              <th>Value (£)</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="ded-no-data">
                  No invoices yet. Click "+ Add Row" below.
                </td>
              </tr>
            )}
            {invoices.map(inv => (
              <tr key={inv.id}>
                {editingInvoiceId === inv.id ? (
                  <>
                    <td>
                      <select
                        className="ded-input"
                        value={editDraft.supplierId}
                        onChange={e => setEditDraft(d => ({ ...d, supplierId: e.target.value }))}
                      >
                        <option value="">— Select Supplier —</option>
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="ded-input"
                        type="text"
                        value={editDraft.invoiceNo}
                        onChange={e => setEditDraft(d => ({ ...d, invoiceNo: e.target.value }))}
                      />
                    </td>
                    <td>
                      <input
                        className="ded-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={editDraft.value}
                        onChange={e => setEditDraft(d => ({ ...d, value: e.target.value }))}
                      />
                    </td>
                    <td>
                      <button className="ded-icon-btn ded-icon-btn--ok" onClick={() => saveEditInvoice(inv.id)} disabled={savingEditId === inv.id} title="Save">
                        <FiCheck />
                      </button>
                      <button className="ded-icon-btn" onClick={cancelEditInvoice} disabled={savingEditId === inv.id} title="Cancel">
                        <FiX />
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{inv.supplierName}</td>
                    <td>{inv.invoiceNo}</td>
                    <td>£{Number(inv.value).toFixed(2)}</td>
                    <td>
                      {isEditingRows && !invoicesLocked ? (
                        <>
                          <button className="ded-icon-btn" onClick={() => startEditInvoice(inv)} title="Edit"><FiEdit2 /></button>
                          <button className="ded-del-btn" onClick={() => deleteInvoice(inv.id)} title="Delete"><FiX /></button>
                        </>
                      ) : invoicesLocked ? (
                        <span className="ded-locked-hint" title="Ask admin to reopen this date"><FiLock /></span>
                      ) : null}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {isEditingRows && !invoicesLocked && rows.map(row => (
              <tr key={row.id} className="ded-new-row">
                <td>
                  <select
                    className="ded-input"
                    value={row.supplierId}
                    onChange={e => updateRow(row.id, 'supplierId', e.target.value)}
                  >
                    <option value="">— Select Supplier —</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="ded-input"
                    type="text"
                    placeholder="Invoice No"
                    value={row.invoiceNo}
                    onChange={e => updateRow(row.id, 'invoiceNo', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="ded-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Value"
                    value={row.value}
                    onChange={e => updateRow(row.id, 'value', e.target.value)}
                  />
                </td>
                <td>
                  <button className="ded-del-btn" onClick={() => removeRow(row.id)}><FiX /></button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="ded-total-label">Grand Total</td>
              <td className="ded-total-value">£{grandTotal.toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {isEditingRows && !invoicesLocked && (
        <div className="ded-actions">
          <button className="ded-add-btn" onClick={addRow}><FiPlus /> Add Row</button>
          {rows.length > 0 && (
            <button className="ded-save-btn" onClick={saveRows} disabled={saving}>
              {saving ? 'Saving…' : 'Save Invoices'}
            </button>
          )}
          <button className="ded-cancel-btn" onClick={() => { setIsEditingRows(false); setRows([blankInvoiceRow()]); loadInvoices(); }}>
            <FiX /> Done
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════
   ROOT
══════════════════════════════════ */
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const Deductions = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [activeDate, setActiveDate]   = useState(null);
  const [isCommitted, setIsCommitted] = useState(false);
  const [isPendingAdminReview, setIsPendingAdminReview] = useState(false);

  useEffect(() => {
    if (!user?.token) return;
    fetch(`${API}/Summary/today`, { headers: authHeader(user.token) })
      .then(safeJson)
      .then((d) => {
        if (d?.date) setActiveDate(d.date);
        setIsCommitted(d?.isCommitted ?? false);
        setIsPendingAdminReview(d?.isPendingAdminReview ?? false);
      })
      .catch(() => {});
  }, [user?.token]);

  const isLocked = isCommitted || isPendingAdminReview;

  const displayDate = fmtDate(activeDate ?? new Date().toISOString());

  if (!user || !user.token) {
    return <div className="ded-loading">Authenticating…</div>;
  }

  return (
    <motion.div
      className="ded-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <button className="ded-back-btn" onClick={() => navigate(-1)}><FiArrowLeft /> Back</button>

      <div className="ded-content">
        <div className="ded-title-row">
          <h1 className="ded-page-title">Deductions</h1>
          <span className="ded-date-chip"><FiCalendar /> {displayDate}</span>
        </div>
        <DeductionsGrid   token={user.token} showToast={showToast} isLocked={isLocked} />
        <SupplierInvoices token={user.token} showToast={showToast} isLocked={isLocked} activeDate={activeDate ?? new Date().toISOString()} />
      </div>
    </motion.div>
  );
};
