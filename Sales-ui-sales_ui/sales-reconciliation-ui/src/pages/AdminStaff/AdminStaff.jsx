import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiArrowLeft, FiPlus, FiUser, FiUserX, FiRotateCcw } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Button } from '../../components/ui/Button';
import './AdminStaff.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
};

export const AdminStaff = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast: notify } = useToast();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const showToast = (message, type = 'success') => notify(message, type);
  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/staff`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      setStaff(await res.json());
    } catch {
      showToast('Failed to load staff', 'error');
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  const handleAdd = async () => {
    if (!newName.trim()) {
      showToast('Please enter a staff name', 'error');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error();
      setNewName('');
      showToast(`"${newName.trim()}" added successfully`);
      fetchStaff();
    } catch {
      showToast('Failed to add staff', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (s) => {
    setBusyId(s.id);
    try {
      const res = await fetch(`${API_BASE}/staff/${s.id}/toggle`, {
        method: 'PUT',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error();
      showToast(`"${s.name}" ${s.isActive ? 'deactivated' : 'reactivated'}`);
      fetchStaff();
    } catch {
      showToast('Failed to update staff', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id, name) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE}/staff/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error();
      showToast(`"${name}" deleted`);
      setConfirmId(null);
      fetchStaff();
    } catch {
      showToast('Failed to delete staff', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <motion.div
      className="stf-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >

      <button className="stf-back-btn" onClick={() => navigate('/admin/dashboard')}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      {/* ── Add staff panel ── */}
      <div className="stf-panel">
        <div className="stf-panel-header">
          <h2 className="stf-panel-title"><FiPlus /> Add Staff</h2>
          <p className="stf-panel-sub">Add a name to the list staff pick from when committing a day</p>
        </div>

        <div className="stf-add-row">
          <input
            className="stf-input"
            type="text"
            placeholder="Staff name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            maxLength={120}
          />
          <Button
            variant="primary"
            className="stf-add-btn"
            onClick={handleAdd}
            loading={adding}
            disabled={!newName.trim()}
            icon={<FiPlus />}
          >
            {adding ? 'Adding…' : 'Add Staff'}
          </Button>
        </div>
      </div>

      {/* ── Existing staff panel ── */}
      <div className="stf-panel">
        <div className="stf-panel-header">
          <h2 className="stf-panel-title"><FiUser /> Staff List</h2>
          <p className="stf-panel-sub">
            {staff.length > 0
              ? `${staff.length} staff name${staff.length !== 1 ? 's' : ''}`
              : 'No staff added yet'}
          </p>
        </div>

        {loading ? (
          <div className="stf-center">
            <div className="stf-spinner" />
            <p>Loading staff…</p>
          </div>
        ) : staff.length === 0 ? (
          <div className="stf-empty">
            <div className="stf-empty-icon"><FiUser /></div>
            <p>No staff yet. Add one above.</p>
          </div>
        ) : (
          <motion.div className="stf-list" variants={gridVariants} initial="hidden" animate="visible">
            {staff.map((s) => (
              <motion.div key={s.id} className="stf-row" variants={rowVariants}>
                <div className="stf-row-name">
                  <span className="stf-row-icon"><FiUser /></span>
                  <span>{s.name}</span>
                  <span className={`stf-status-badge ${s.isActive ? 'stf-status-badge--active' : 'stf-status-badge--inactive'}`}>
                    {s.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="stf-row-actions">
                  <button
                    className="stf-toggle-btn"
                    disabled={busyId === s.id}
                    onClick={() => handleToggle(s)}
                    title={s.isActive ? 'Deactivate' : 'Reactivate'}
                  >
                    {s.isActive ? <FiUserX /> : <FiRotateCcw />} {s.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>

                  {confirmId === s.id ? (
                    <div className="stf-confirm">
                      <span className="stf-confirm-text">Delete "{s.name}"?</span>
                      <Button
                        variant="danger"
                        onClick={() => handleDelete(s.id, s.name)}
                        loading={busyId === s.id}
                        className="stf-confirm-yes"
                      >
                        Yes, delete
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmId(null)}
                        className="stf-confirm-no"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="stf-delete-btn"
                      onClick={() => setConfirmId(s.id)}
                      title={`Delete ${s.name}`}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

    </motion.div>
  );
};
