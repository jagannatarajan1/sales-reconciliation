import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './AdminSuppliers.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

export const AdminSuppliers = () => {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const [toast, setToast]         = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [newName, setNewName]     = useState('');
  const [adding, setAdding]       = useState(false);
  const [confirmId, setConfirmId] = useState(null); // inline delete confirm
  const [deletingId, setDeletingId] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/Suppliers`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      setSuppliers(await res.json());
    } catch {
      showToast('Failed to load suppliers', 'error');
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  const handleAdd = async () => {
    if (!newName.trim()) {
      showToast('Please enter a supplier name', 'error');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE}/Suppliers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error();
      setNewName('');
      showToast(`"${newName.trim()}" added successfully`);
      fetchSuppliers();
    } catch {
      showToast('Failed to add supplier', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, name) => {
    setDeletingId(id);
    try {
      const res = await fetch(`${API_BASE}/Suppliers/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      showToast(`"${name}" deleted`);
      setConfirmId(null);
      fetchSuppliers();
    } catch {
      showToast('Failed to delete supplier', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="sup-page">

      {toast && (
        <div className={`sup-toast sup-toast--${toast.type}`}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          {toast.message}
        </div>
      )}

      <button className="sup-back-btn" onClick={() => navigate('/admin/dashboard')}>
        ← Back to Dashboard
      </button>

      {/* ── Add supplier panel ── */}
      <div className="sup-panel">
        <div className="sup-panel-header">
          <h2 className="sup-panel-title">➕ Add Supplier</h2>
          <p className="sup-panel-sub">Add a new supplier to the list used when staff enter invoices</p>
        </div>

        <div className="sup-add-row">
          <input
            className="sup-input"
            type="text"
            placeholder="Supplier name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            maxLength={120}
          />
          <button
            className="sup-add-btn"
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
          >
            {adding ? <span className="sup-btn-spinner" /> : null}
            {adding ? 'Adding…' : 'Add Supplier'}
          </button>
        </div>
      </div>

      {/* ── Existing suppliers panel ── */}
      <div className="sup-panel">
        <div className="sup-panel-header">
          <h2 className="sup-panel-title">🏪 Existing Suppliers</h2>
          <p className="sup-panel-sub">
            {suppliers.length > 0
              ? `${suppliers.length} supplier${suppliers.length !== 1 ? 's' : ''} registered`
              : 'No suppliers added yet'}
          </p>
        </div>

        {loading ? (
          <div className="sup-center">
            <div className="sup-spinner" />
            <p>Loading suppliers…</p>
          </div>
        ) : suppliers.length === 0 ? (
          <div className="sup-empty">
            <div className="sup-empty-icon">🏪</div>
            <p>No suppliers yet. Add one above.</p>
          </div>
        ) : (
          <div className="sup-list">
            {suppliers.map((s) => (
              <div key={s.id} className="sup-row">
                <div className="sup-row-name">
                  <span className="sup-row-icon">🏢</span>
                  <span>{s.name}</span>
                </div>

                {confirmId === s.id ? (
                  /* inline delete confirmation */
                  <div className="sup-confirm">
                    <span className="sup-confirm-text">Delete "{s.name}"?</span>
                    <button
                      className="sup-confirm-yes"
                      onClick={() => handleDelete(s.id, s.name)}
                      disabled={deletingId === s.id}
                    >
                      {deletingId === s.id ? '…' : 'Yes, delete'}
                    </button>
                    <button
                      className="sup-confirm-no"
                      onClick={() => setConfirmId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="sup-delete-btn"
                    onClick={() => setConfirmId(s.id)}
                    title={`Delete ${s.name}`}
                  >
                    🗑 Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
