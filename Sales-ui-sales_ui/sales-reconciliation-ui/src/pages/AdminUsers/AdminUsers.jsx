import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiPlus, FiUsers, FiEdit2, FiTrash2, FiKey,
  FiUserCheck, FiUserX, FiX, FiShield,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { Button } from '../../components/ui/Button';
import './AdminUsers.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

// Keep in sync with Sales-api/src/lib/permissions.ts's PERMISSION_MODULES.
const PERMISSION_MODULES = [
  { key: 'sales', label: 'Sales' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'scratchCards', label: 'Scratch Cards' },
  { key: 'reports', label: 'Reports' },
  { key: 'userManagement', label: 'User Management' },
  { key: 'settings', label: 'Settings' },
  { key: 'lottery', label: 'Lottery' },
  { key: 'paypoint', label: 'PayPoint' },
  { key: 'commitHistory', label: 'Commit History' },
];

const ROLES = ['user', 'admin', 'superadmin'];

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
};

const blankForm = () => ({
  email: '', password: '', name: '', role: 'user', permissions: [],
});

export const AdminUsers = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast: notify } = useToast();
  const showToast = (message, type = 'success') => notify(message, type);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [formMode, setFormMode] = useState(null); // null | 'create' | 'edit'
  const [formTarget, setFormTarget] = useState(null); // user being edited
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);

  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const [busyId, setBusyId] = useState(null);

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/users?pageSize=200`, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers(Array.isArray(data.items) ? data.items : []);
    } catch {
      showToast('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openCreate = () => {
    setForm(blankForm());
    setFormTarget(null);
    setFormMode('create');
  };

  const openEdit = (u) => {
    setForm({
      email: u.email, password: '', name: u.name, role: u.role,
      permissions: Array.isArray(u.permissions) ? u.permissions : [],
    });
    setFormTarget(u);
    setFormMode('edit');
  };

  const closeForm = () => {
    setFormMode(null);
    setFormTarget(null);
  };

  const togglePermission = (key) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }));
  };

  const handleSaveForm = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      showToast('Name and email are required', 'error');
      return;
    }
    if (formMode === 'create' && form.password.trim().length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    setSaving(true);
    try {
      const body = {
        email: form.email.trim(),
        name: form.name.trim(),
        role: form.role,
        permissions: form.role === 'admin' ? form.permissions : [],
      };
      if (formMode === 'create') body.password = form.password;

      const url = formMode === 'create' ? `${API_BASE}/users` : `${API_BASE}/users/${formTarget.userId}`;
      const method = formMode === 'create' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Save failed');
      }

      showToast(formMode === 'create' ? 'User created successfully' : 'User updated successfully');
      closeForm();
      fetchUsers();
    } catch (e) {
      showToast(e.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u) => {
    if (u.userId === user.id) {
      showToast('You cannot disable your own account', 'error');
      return;
    }
    setBusyId(u.userId);
    try {
      const action = u.isActive ? 'disable' : 'enable';
      const res = await fetch(`${API_BASE}/users/${u.userId}/${action}`, {
        method: 'PUT',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Action failed');
      }
      showToast(`"${u.name}" ${action}d successfully`);
      fetchUsers();
    } catch (e) {
      showToast(e.message || 'Action failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (u) => {
    if (u.userId === user.id) {
      showToast('You cannot delete your own account', 'error');
      return;
    }
    if (!window.confirm(`Delete "${u.name}"? This account will no longer be able to log in.`)) return;

    setBusyId(u.userId);
    try {
      const res = await fetch(`${API_BASE}/users/${u.userId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Delete failed');
      }
      showToast(`"${u.name}" deleted`);
      fetchUsers();
    } catch (e) {
      showToast(e.message || 'Delete failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openResetPassword = (u) => {
    setResetTarget(u);
    setResetPassword('');
  };

  const handleResetPassword = async () => {
    if (resetPassword.trim().length < 6) {
      showToast('New password must be at least 6 characters', 'error');
      return;
    }
    setResetting(true);
    try {
      const res = await fetch(`${API_BASE}/users/${resetTarget.userId}/reset-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Reset failed');
      }
      showToast(`Password reset for "${resetTarget.name}" — relay it to them directly`);
      setResetTarget(null);
    } catch (e) {
      showToast(e.message || 'Reset failed', 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <motion.div
      className="au-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <button className="au-back-btn" onClick={() => navigate('/admin/dashboard')}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="au-panel">
        <div className="au-panel-header">
          <div>
            <h2 className="au-panel-title"><FiUsers /> User Management</h2>
            <p className="au-panel-sub">
              {users.length > 0
                ? `${users.length} account${users.length !== 1 ? 's' : ''}`
                : 'No accounts yet'}
            </p>
          </div>
          <Button variant="primary" icon={<FiPlus />} onClick={openCreate}>
            Create User
          </Button>
        </div>

        {loading ? (
          <div className="au-center">
            <div className="au-spinner" />
            <p>Loading users…</p>
          </div>
        ) : users.length === 0 ? (
          <div className="au-empty">
            <div className="au-empty-icon"><FiUsers /></div>
            <p>No users yet. Create one above.</p>
          </div>
        ) : (
          <motion.div className="au-list" variants={gridVariants} initial="hidden" animate="visible">
            {users.map((u) => (
              <motion.div key={u.userId} className="au-row" variants={rowVariants}>
                <div className="au-row-main">
                  <div className="au-row-name">
                    <span>{u.name}</span>
                    {u.userId === user.id && <span className="au-you-badge">You</span>}
                  </div>
                  <div className="au-row-email">{u.email}</div>
                </div>

                <span className={`au-role-badge au-role-badge--${u.role}`}>
                  {u.role === 'superadmin' && <FiShield />} {u.role}
                </span>

                <span className={`au-status-badge ${u.isActive ? 'au-status-badge--active' : 'au-status-badge--inactive'}`}>
                  {u.isActive ? 'Active' : 'Disabled'}
                </span>

                <div className="au-row-actions">
                  <button className="au-icon-btn" title="Edit" onClick={() => openEdit(u)}>
                    <FiEdit2 />
                  </button>
                  <button className="au-icon-btn" title="Reset password" onClick={() => openResetPassword(u)}>
                    <FiKey />
                  </button>
                  <button
                    className="au-icon-btn"
                    title={u.isActive ? 'Disable' : 'Enable'}
                    disabled={busyId === u.userId || u.userId === user.id}
                    onClick={() => handleToggleActive(u)}
                  >
                    {u.isActive ? <FiUserX /> : <FiUserCheck />}
                  </button>
                  <button
                    className="au-icon-btn au-icon-btn--danger"
                    title="Delete"
                    disabled={busyId === u.userId || u.userId === user.id}
                    onClick={() => handleDelete(u)}
                  >
                    <FiTrash2 />
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* ── Create/Edit modal ── */}
      {formMode && (
        <div className="au-overlay" onClick={closeForm}>
          <motion.div
            className="au-modal"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="au-modal-header">
              <h3>{formMode === 'create' ? 'Create User' : `Edit ${formTarget?.name}`}</h3>
              <button className="au-modal-close" onClick={closeForm}><FiX /></button>
            </div>

            <div className="au-modal-body">
              <div className="au-field">
                <label>Name</label>
                <input
                  className="au-input"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="au-field">
                <label>Email</label>
                <input
                  className="au-input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
              {formMode === 'create' && (
                <div className="au-field">
                  <label>Password</label>
                  <input
                    className="au-input"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder="At least 6 characters"
                  />
                </div>
              )}
              <div className="au-field">
                <label>Role</label>
                <select
                  className="au-input"
                  value={form.role}
                  onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {form.role === 'admin' && (
                <div className="au-field">
                  <label>Permissions</label>
                  <div className="au-permission-grid">
                    {PERMISSION_MODULES.map((m) => (
                      <label key={m.key} className="au-permission-item">
                        <input
                          type="checkbox"
                          checked={form.permissions.includes(m.key)}
                          onChange={() => togglePermission(m.key)}
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {form.role === 'user' && (
                <p className="au-hint">Users have no admin-module access — their access is simply being logged in.</p>
              )}
              {form.role === 'superadmin' && (
                <p className="au-hint">Superadmins always have full access to every module.</p>
              )}
            </div>

            <div className="au-modal-footer">
              <Button variant="secondary" onClick={closeForm}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveForm} loading={saving}>
                {formMode === 'create' ? 'Create' : 'Save Changes'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Reset password modal ── */}
      {resetTarget && (
        <div className="au-overlay" onClick={() => setResetTarget(null)}>
          <motion.div
            className="au-modal au-modal--sm"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="au-modal-header">
              <h3>Reset Password — {resetTarget.name}</h3>
              <button className="au-modal-close" onClick={() => setResetTarget(null)}><FiX /></button>
            </div>
            <div className="au-modal-body">
              <div className="au-field">
                <label>New password</label>
                <input
                  className="au-input"
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoFocus
                />
              </div>
              <p className="au-hint">There is no email flow — relay this password to the user directly.</p>
            </div>
            <div className="au-modal-footer">
              <Button variant="secondary" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleResetPassword} loading={resetting}>
                Reset Password
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};
