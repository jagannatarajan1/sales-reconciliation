import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiArrowLeft, FiUser, FiShield } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import '../styles/Auth.css';
import '../styles/AdminFormPage.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

export const AdminRegister = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '', role: 'user',
  });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const setRole = (role) => setForm((prev) => ({ ...prev, role }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (user?.role !== 'admin') {
      setError('Access denied. Only admins can register new accounts.');
      return;
    }

    if (!form.name || !form.email || !form.password || !form.confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      // Both roles go through the Users table (Auth/register) — it's the only
      // table /api/auth/login checks. The separate Admins table (AdminAuth/register)
      // isn't wired into login or into most admin-only business logic (which reads
      // the "Id" claim, not "adminId"), so accounts created there can never sign in.
      const res = await fetch(`${API_BASE}/Auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({
          name:     form.name,
          email:    form.email,
          password: form.password,
          role:     form.role,
        }),
      });

      if (res.ok) {
        setSuccess(
          `${form.role === 'admin' ? 'Admin' : 'User'} account created successfully for ${form.email}`
        );
        setForm({ name: '', email: '', password: '', confirmPassword: '', role: 'user' });
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Registration failed. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <motion.div
        className="admin-form-page"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="admin-form-card">
          <button className="admin-back-btn" onClick={() => navigate('/admin/dashboard')}>
            <FiArrowLeft /> Back to Dashboard
          </button>
          <div className="auth-header">
            <h1>Access Denied</h1>
            <p>Only admins can register new accounts.</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="admin-form-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="admin-form-card">
        <button className="admin-back-btn" onClick={() => navigate('/admin/dashboard')}>
          <FiArrowLeft /> Back to Dashboard
        </button>

        <div className="auth-header">
          <h1>Register Account</h1>
          <p>Create a new admin or user account</p>
        </div>

        <div className="admin-register-tabs">
          <button
            type="button"
            className={`admin-register-tab ${form.role === 'user' ? 'admin-register-tab--active' : ''}`}
            onClick={() => setRole('user')}
          >
            <FiUser /> User
          </button>
          <button
            type="button"
            className={`admin-register-tab ${form.role === 'admin' ? 'admin-register-tab--active' : ''}`}
            onClick={() => setRole('admin')}
          >
            <FiShield /> Admin
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error   && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input
              id="name"
              name="name"
              type="text"
              placeholder="Enter full name"
              value={form.name}
              onChange={handleChange}
              className="form-input"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="Enter email address"
              value={form.email}
              onChange={handleChange}
              className="form-input"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="Minimum 6 characters"
              value={form.password}
              onChange={handleChange}
              className="form-input"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              placeholder="Repeat password"
              value={form.confirmPassword}
              onChange={handleChange}
              className="form-input"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Creating Account…' : 'Create Account'}
          </button>
        </form>
      </div>
    </motion.div>
  );
};
