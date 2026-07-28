import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from "../../context/AuthContext";
import "./Deductions.css";

const API = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

function useToast() {
  const [toast, setToast] = useState(null);
  const show = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };
  return [toast, show];
}

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

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch(`${API}/Deduction/today`, { headers: authHeader(token) })
      .then(safeJson) // ✅ replaces r => r.status === 404 || !r.ok ? null : r.json()
      .then(data => {
        if (data) setValues(Object.fromEntries(FIELDS.map(f => [f.key, data[f.key] ? String(data[f.key]) : ''])));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const total = FIELDS.reduce((s, f) => s + Number(values[f.key] || 0), 0);

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
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="ded-loading">Loading…</div>;
  if (error)   return <div className="ded-loading" style={{ color: '#dc2626' }}>⚠ {error}</div>;

  return (
    <div className="ded-section">
      <h2 className="ded-section-title">Deductions</h2>
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
                    readOnly={isLocked}
                    onChange={isLocked ? undefined : e => setValues({ ...values, [f.key]: e.target.value })}
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
      <div className="ded-actions">
        <button className="ded-save-btn" onClick={save} disabled={saving || isLocked}>
          {saving ? 'Saving…' : 'Save Deductions'}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   B. SUPPLIER INVOICES
══════════════════════════════════ */
const blankInvoiceRow = () => ({ id: Date.now(), supplierId: '', invoiceNo: '', value: '' });

function SupplierInvoices({ token, showToast, isLocked }) {
  const [suppliers, setSuppliers] = useState([]);
  const [invoices, setInvoices]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [rows, setRows]           = useState([blankInvoiceRow()]);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
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
  }, [token]);

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
      if (!res.ok) throw new Error('Failed to delete');
      setInvoices(prev => prev.filter(i => i.id !== id));
      showToast('Invoice deleted');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const grandTotal =
    invoices.reduce((s, i) => s + Number(i.value || 0), 0) +
    rows.reduce((s, r) => s + Number(r.value || 0), 0);

  if (loading) return <div className="ded-loading">Loading…</div>;
  if (error)   return <div className="ded-loading" style={{ color: '#dc2626' }}>⚠ {error}</div>;

  return (
    <div className="ded-section">
      <h2 className="ded-section-title">Supplier Payout</h2>
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
                <td>{inv.supplierName}</td>
                <td>{inv.invoiceNo}</td>
                <td>£{Number(inv.value).toFixed(2)}</td>
                <td>
                  <button className="ded-del-btn" onClick={() => deleteInvoice(inv.id)} disabled={isLocked}>✕</button>
                </td>
              </tr>
            ))}
            {rows.map(row => (
              <tr key={row.id} className="ded-new-row">
                <td>
                  <select
                    className="ded-input"
                    value={row.supplierId}
                    disabled={isLocked}
                    onChange={isLocked ? undefined : e => updateRow(row.id, 'supplierId', e.target.value)}
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
                    readOnly={isLocked}
                    onChange={isLocked ? undefined : e => updateRow(row.id, 'invoiceNo', e.target.value)}
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
                    readOnly={isLocked}
                    onChange={isLocked ? undefined : e => updateRow(row.id, 'value', e.target.value)}
                  />
                </td>
                <td>
                  <button className="ded-del-btn" onClick={() => removeRow(row.id)} disabled={isLocked}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="ded-total-label">Grand Total</td>
              <td className="ded-total-value">${grandTotal.toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="ded-actions">
        <button className="ded-add-btn" onClick={addRow} disabled={isLocked}>+ Add Row</button>
        {rows.length > 0 && (
          <button className="ded-save-btn" onClick={saveRows} disabled={saving || isLocked}>
            {saving ? 'Saving…' : 'Save Invoices'}
          </button>
        )}
      </div>
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
  const [toast, showToast] = useToast();
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

  const activeDateStr = activeDate ? activeDate.split('T')[0] : null;
  const isLocked = isCommitted || isPendingAdminReview;

  const displayDate = fmtDate(activeDate ?? new Date().toISOString());

  if (!user || !user.token) {
    return <div className="ded-loading">Authenticating…</div>;
  }

  return (
    <div className="ded-page">
      <button className="ded-back-btn" onClick={() => navigate(-1)}>← Back</button>

      <div className="ded-content">
        <div className="ded-title-row">
          <h1 className="ded-page-title">Deductions</h1>
          <span className="ded-date-chip">📅 {displayDate}</span>
        </div>
        <DeductionsGrid   token={user.token} showToast={showToast} isLocked={isLocked} />
        <SupplierInvoices token={user.token} showToast={showToast} isLocked={isLocked} />
      </div>

      {toast && <div className={`ded-toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  );
};
