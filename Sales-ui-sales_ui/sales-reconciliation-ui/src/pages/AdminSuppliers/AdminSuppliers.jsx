import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiArrowLeft, FiPlus, FiShoppingBag, FiBriefcase, FiTrash2, FiEdit2, FiCheck, FiX } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Button } from '../../components/ui/Button';
import './AdminSuppliers.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
};

export const AdminSuppliers = () => {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const { showToast: notify } = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [newName, setNewName]     = useState('');
  const [adding, setAdding]       = useState(false);
  const [confirmId, setConfirmId] = useState(null); // inline delete confirm
  const [deletingId, setDeletingId] = useState(null);
  const [editingId, setEditingId] = useState(null); // §11 — inline supplier edit
  const [editName, setEditName] = useState('');
  const [savingEditId, setSavingEditId] = useState(null);

  const showToast = (message, type = 'success') => notify(message, type);

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

  // §11 — edit an existing supplier's name via PUT /Suppliers/:id.
  const startEdit = (s) => {
    setEditingId(s.id);
    setEditName(s.name);
    setConfirmId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveEdit = async (id) => {
    if (!editName.trim()) {
      showToast('Supplier name cannot be empty', 'error');
      return;
    }
    setSavingEditId(id);
    try {
      const res = await fetch(`${API_BASE}/Suppliers/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to update supplier');
      }
      showToast(`Supplier updated to "${editName.trim()}"`);
      cancelEdit();
      fetchSuppliers();
    } catch (e) {
      showToast(e.message || 'Failed to update supplier', 'error');
    } finally {
      setSavingEditId(null);
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
    <motion.div
      className="sup-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >

      <button className="sup-back-btn" onClick={() => navigate('/admin/dashboard')}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      {/* ── Add supplier panel ── */}
      <div className="sup-panel">
        <div className="sup-panel-header">
          <h2 className="sup-panel-title"><FiPlus /> Add Supplier</h2>
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
          <Button
            variant="primary"
            className="sup-add-btn"
            onClick={handleAdd}
            loading={adding}
            disabled={!newName.trim()}
            icon={<FiPlus />}
          >
            {adding ? 'Adding…' : 'Add Supplier'}
          </Button>
        </div>
      </div>

      {/* ── Existing suppliers panel ── */}
      <div className="sup-panel">
        <div className="sup-panel-header">
          <h2 className="sup-panel-title"><FiShoppingBag /> Existing Suppliers</h2>
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
            <div className="sup-empty-icon"><FiShoppingBag /></div>
            <p>No suppliers yet. Add one above.</p>
          </div>
        ) : (
          <motion.div className="sup-list" variants={gridVariants} initial="hidden" animate="visible">
            {suppliers.map((s) => (
              <motion.div key={s.id} className="sup-row" variants={rowVariants}>
                {editingId === s.id ? (
                  <div className="sup-edit-row">
                    <input
                      className="sup-input sup-edit-input"
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit(s.id)}
                      maxLength={120}
                      autoFocus
                    />
                    <Button variant="primary" onClick={() => saveEdit(s.id)} loading={savingEditId === s.id} icon={<FiCheck />}>
                      Save
                    </Button>
                    <Button variant="secondary" onClick={cancelEdit} disabled={savingEditId === s.id} icon={<FiX />}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="sup-row-name">
                      <span className="sup-row-icon"><FiBriefcase /></span>
                      <span>{s.name}</span>
                    </div>

                    {confirmId === s.id ? (
                      /* inline delete confirmation */
                      <div className="sup-confirm">
                        <span className="sup-confirm-text">Delete "{s.name}"?</span>
                        <Button
                          variant="danger"
                          onClick={() => handleDelete(s.id, s.name)}
                          loading={deletingId === s.id}
                          className="sup-confirm-yes"
                        >
                          Yes, delete
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setConfirmId(null)}
                          className="sup-confirm-no"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="sup-row-actions">
                        <button
                          className="sup-edit-btn"
                          onClick={() => startEdit(s)}
                          title={`Edit ${s.name}`}
                        >
                          <FiEdit2 /> Edit
                        </button>
                        <button
                          className="sup-delete-btn"
                          onClick={() => setConfirmId(s.id)}
                          title={`Delete ${s.name}`}
                        >
                          <FiTrash2 /> Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

    </motion.div>
  );
};
