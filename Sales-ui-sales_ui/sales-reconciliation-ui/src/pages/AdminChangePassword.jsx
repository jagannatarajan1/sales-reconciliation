import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/Auth.css';
import '../styles/AdminFormPage.css';
import './AdminChangePassword.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const matchesSearch = (row, query) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (row.name || '').toLowerCase().includes(needle) || (row.email || '').toLowerCase().includes(needle);
};

export const AdminChangePassword = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const formCardRef = useRef(null);

  const [activeTab, setActiveTab] = useState('users');

  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  /* ── Reset password form ── */
  const [form, setForm] = useState({
    accountType: 'user', email: '', newPassword: '', confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.email || !form.newPassword || !form.confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Please enter a valid email address');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (form.newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    const isAdmin = form.accountType === 'admin';
    const endpoint = isAdmin
      ? `${API_BASE}/AdminAuth/reset-password`
      : `${API_BASE}/Auth/reset-password`;
    const body = { email: form.email, newPassword: form.newPassword };

    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setSuccess(`Password updated for ${form.email}`);
        setForm({ accountType: form.accountType, email: '', newPassword: '', confirmPassword: '' });
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Password reset failed. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /* origin: 'admin' → dedicated Admin table (AdminAuth endpoints). 'user' → Users table
     (Auth/Users endpoints), including User rows whose role happens to be "admin". */
  const handleResetPasswordFor = (email, origin) => {
    setError('');
    setSuccess('');
    setForm({ accountType: origin === 'admin' ? 'admin' : 'user', email, newPassword: '', confirmPassword: '' });
    setActiveTab('reset');
    formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ── Registered users (Users table) ── */
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [userSearch, setUserSearch] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch(`${API_BASE}/Users?pageNumber=1&pageSize=1000`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUsers(data.items || []);
    } catch {
      showToast('Failed to load users', 'error');
    } finally {
      setLoadingUsers(false);
    }
  }, [user.token]);

  /* ── Registered admins (Admin table) ── */
  const [admins, setAdmins] = useState([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [adminSearch, setAdminSearch] = useState('');

  const fetchAdmins = useCallback(async () => {
    setLoadingAdmins(true);
    try {
      const res = await fetch(`${API_BASE}/AdminAuth?pageNumber=1&pageSize=1000`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAdmins(data.items || []);
    } catch {
      showToast('Failed to load admins', 'error');
    } finally {
      setLoadingAdmins(false);
    }
  }, [user.token]);

  useEffect(() => { fetchUsers(); fetchAdmins(); }, [fetchUsers, fetchAdmins]);

  /* role=user rows stay in the Users tab; role=admin rows (even though stored as a User row)
     move to the Admins tab, merged alongside the dedicated Admin-table accounts. */
  const userRows = users
    .filter((u) => (u.role || 'user') !== 'admin')
    .map((u) => ({ origin: 'user', id: u.userId, name: u.name, email: u.email, role: u.role, department: null, isActive: u.isActive }));

  const adminRows = [
    ...admins.map((a) => ({ origin: 'admin', id: a.adminId, name: a.name, email: a.email, role: a.role, department: a.department, isActive: a.isActive })),
    ...users
      .filter((u) => u.role === 'admin')
      .map((u) => ({ origin: 'user', id: u.userId, name: u.name, email: u.email, role: u.role, department: null, isActive: u.isActive })),
  ];

  const filteredUserRows = userRows.filter((r) => matchesSearch(r, userSearch));
  const filteredAdminRows = adminRows.filter((r) => matchesSearch(r, adminSearch));

  /* ── Row actions (shared across both tabs, dispatched by origin) ── */
  const [busyKey, setBusyKey] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editName, setEditName] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const refetch = (origin) => (origin === 'admin' ? fetchAdmins() : fetchUsers());
  const basePathFor = (origin) => (origin === 'admin' ? 'AdminAuth' : 'Users');

  const handleToggle = async (origin, id, currentlyActive) => {
    const key = `${origin}-${id}`;
    setBusyKey(key);
    try {
      const base = basePathFor(origin);
      const res = await fetch(
        currentlyActive ? `${API_BASE}/${base}/${id}` : `${API_BASE}/${base}/${id}/activate`,
        {
          method: currentlyActive ? 'DELETE' : 'PUT',
          headers: { Authorization: `Bearer ${user.token}` },
        }
      );
      if (!res.ok) throw new Error();
      showToast(currentlyActive ? 'Account deactivated' : 'Account activated');
      refetch(origin);
    } catch {
      showToast('Failed to update account status', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (origin, id, name) => {
    if (!window.confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    const key = `${origin}-${id}`;
    setBusyKey(key);
    try {
      const base = basePathFor(origin);
      const res = await fetch(`${API_BASE}/${base}/${id}/permanent`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      showToast('Account permanently deleted');
      refetch(origin);
    } catch {
      showToast('Failed to delete account', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const startEdit = (origin, id, currentName) => {
    setEditingKey(`${origin}-${id}`);
    setEditName(currentName || '');
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditName('');
  };

  const saveEdit = async (origin, id) => {
    const name = editName.trim();
    if (!name) {
      showToast('Name cannot be empty', 'error');
      return;
    }
    setEditBusy(true);
    try {
      const base = basePathFor(origin);
      const res = await fetch(`${API_BASE}/${base}/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      showToast('Name updated');
      setEditingKey(null);
      refetch(origin);
    } catch {
      showToast('Failed to update name', 'error');
    } finally {
      setEditBusy(false);
    }
  };

  const renderRow = (row) => {
    const key = `${row.origin}-${row.id}`;
    const isSelf = row.email && user?.email && row.email.toLowerCase() === user.email.toLowerCase();
    const isEditing = editingKey === key;
    const isBusy = busyKey === key;

    return (
      <tr key={key} className={row.isActive ? '' : 'rpu-row--inactive'}>
        <td>
          {isEditing ? (
            <input
              className="rpu-edit-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveEdit(row.origin, row.id)}
              autoFocus
            />
          ) : (
            <>
              {row.name || '—'}
              {isSelf && <span className="rpu-you-tag">You</span>}
            </>
          )}
        </td>
        <td>{row.email}</td>
        <td className="rpu-td-role">{row.role || 'user'}</td>
        <td>
          {row.isActive
            ? <span className="rpu-badge rpu-badge--active">Active</span>
            : <span className="rpu-badge rpu-badge--inactive">Inactive</span>}
        </td>
        <td className="rpu-td-actions">
          {isEditing ? (
            <div className="rpu-actions-wrap">
              <button className="rpu-action-btn rpu-action-btn--save" onClick={() => saveEdit(row.origin, row.id)} disabled={editBusy}>
                {editBusy ? '…' : 'Save'}
              </button>
              <button className="rpu-action-btn" onClick={cancelEdit} disabled={editBusy}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="rpu-actions-wrap">
              <button
                className="rpu-action-btn rpu-action-btn--edit"
                onClick={() => startEdit(row.origin, row.id, row.name)}
              >
                Edit
              </button>
              <button
                className="rpu-action-btn rpu-action-btn--reset"
                onClick={() => handleResetPasswordFor(row.email, row.origin)}
              >
                Reset Password
              </button>
              <button
                className={`rpu-action-btn ${row.isActive ? 'rpu-action-btn--deactivate' : 'rpu-action-btn--activate'}`}
                onClick={() => handleToggle(row.origin, row.id, row.isActive)}
                disabled={isSelf || isBusy}
              >
                {isBusy ? '…' : row.isActive ? 'Deactivate' : 'Activate'}
              </button>
              <button
                className="rpu-action-btn rpu-action-btn--delete"
                onClick={() => handleDelete(row.origin, row.id, row.name || row.email)}
                disabled={isSelf || isBusy}
              >
                {isBusy ? '…' : 'Delete'}
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="rpu-page">

      {toast && (
        <div className={`rpu-toast rpu-toast--${toast.type}`}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          {toast.message}
        </div>
      )}

      <button className="rpu-back-btn" onClick={() => navigate('/admin/dashboard')}>
        ← Back to Dashboard
      </button>

      <div className="rpu-page-header">
        <h1 className="rpu-page-title">👥 Manage Accounts</h1>
        <p className="rpu-page-sub">
          View every registered user and admin, reset a password, or control account access below.
        </p>
        <button className="rpu-add-btn" onClick={() => navigate('/admin/register')}>
          ➕ Add New User / Admin
        </button>
      </div>

      <div className="rpu-tabs">
        <button
          className={`rpu-tab ${activeTab === 'users' ? 'rpu-tab--active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          👤 Users
        </button>
        <button
          className={`rpu-tab ${activeTab === 'admins' ? 'rpu-tab--active' : ''}`}
          onClick={() => setActiveTab('admins')}
        >
          🛡️ Admins
        </button>
        <button
          className={`rpu-tab ${activeTab === 'reset' ? 'rpu-tab--active' : ''}`}
          onClick={() => setActiveTab('reset')}
        >
          🔑 Reset Password
        </button>
      </div>

      {activeTab === 'users' && (
        <div className="rpu-panel">
          <div className="rpu-panel-header">
            <h2 className="rpu-panel-title">👤 Registered Users</h2>
            <p className="rpu-panel-sub">Staff/normal user accounts. Deactivated accounts can't log in but stay listed here for reactivation.</p>
            <input
              className="rpu-search"
              type="text"
              placeholder="Search by name or email…"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
          </div>

          {loadingUsers ? (
            <div className="rpu-center">
              <div className="rpu-spinner" />
              <p>Loading users…</p>
            </div>
          ) : filteredUserRows.length === 0 ? (
            <div className="rpu-empty">
              <div className="rpu-empty-icon">👤</div>
              <p>{userSearch ? 'No users match your search.' : 'No registered users yet.'}</p>
            </div>
          ) : (
            <div className="rpu-table-wrap">
              <table className="rpu-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUserRows.map(renderRow)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'admins' && (
        <div className="rpu-panel">
          <div className="rpu-panel-header">
            <h2 className="rpu-panel-title">🛡️ Registered Admins</h2>
            <p className="rpu-panel-sub">Admin accounts. You can't deactivate or delete your own account from here.</p>
            <input
              className="rpu-search"
              type="text"
              placeholder="Search by name or email…"
              value={adminSearch}
              onChange={(e) => setAdminSearch(e.target.value)}
            />
          </div>

          {loadingAdmins ? (
            <div className="rpu-center">
              <div className="rpu-spinner" />
              <p>Loading admins…</p>
            </div>
          ) : filteredAdminRows.length === 0 ? (
            <div className="rpu-empty">
              <div className="rpu-empty-icon">🛡️</div>
              <p>{adminSearch ? 'No admins match your search.' : 'No registered admins yet.'}</p>
            </div>
          ) : (
            <div className="rpu-table-wrap">
              <table className="rpu-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAdminRows.map(renderRow)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'reset' && (
        <div className="admin-form-card rpu-reset-card" ref={formCardRef}>
          <div className="auth-header">
            <h2>Reset Password</h2>
            <p>Set a new password for any user or admin account</p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {error   && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <div className="form-group">
              <label htmlFor="accountType">Account Type</label>
              <select
                id="accountType"
                name="accountType"
                value={form.accountType}
                onChange={handleChange}
                className="form-input"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="email">
                {form.accountType === 'admin' ? 'Admin Email' : 'User Email'}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder={`Enter ${form.accountType === 'admin' ? 'admin' : 'user'} email address`}
                value={form.email}
                onChange={handleChange}
                className="form-input"
                required
              />
              <span className="form-hint">
                The email address registered with the {form.accountType === 'admin' ? 'admin' : 'user'} account
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                placeholder="Minimum 6 characters"
                value={form.newPassword}
                onChange={handleChange}
                className="form-input"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm New Password</label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                placeholder="Repeat new password"
                value={form.confirmPassword}
                onChange={handleChange}
                className="form-input"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Updating Password…' : 'Update Password'}
            </button>
          </form>
        </div>
      )}

    </div>
  );
};
