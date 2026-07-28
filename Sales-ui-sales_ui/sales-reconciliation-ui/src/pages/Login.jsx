import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import {
  FiShield, FiZap, FiBarChart2, FiUser, FiMail, FiLock,
  FiEye, FiEyeOff, FiAlertTriangle, FiArrowRight,
} from 'react-icons/fi';
import '../styles/Login.css';

export const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail]                   = useState('');
  const [password, setPassword]             = useState('');
  const [role, setRole]                     = useState('user');
  const [error, setError]                   = useState('');
  const [loading, setLoading]               = useState(false);
  const [showPwd, setShowPwd]               = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [isLocked, setIsLocked]             = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLocked) return;
    setError('');
    setLoading(true);
    try {
      if (!email || !password) throw new Error('Please fill in all fields');
      if (!email.includes('@')) throw new Error('Please enter a valid email');
      await login(email, password, role);
      setAttemptsRemaining(null);
      setIsLocked(false);
      navigate(role === 'admin' ? '/admin/dashboard' : '/dashboard');
    } catch (err) {
      const remaining = err.response?.data?.attemptsRemaining;
      if (remaining !== undefined) {
        setAttemptsRemaining(remaining);
        if (remaining === 0) setIsLocked(true);
      }
      setError(err.response?.data?.message || err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    // Reset lockout tracking when the user types a different email
    setAttemptsRemaining(null);
    setIsLocked(false);
    setError('');
  };

  return (
    <motion.div
      className="login-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >

      {/* ══════════ LEFT — Brand panel ══════════ */}
      <div className="login-brand">
        <div className="login-blob login-blob--1" />
        <div className="login-blob login-blob--2" />
        <div className="login-blob login-blob--3" />

        <div className="login-brand-content">
          <div className="login-logo">SR</div>
          <h1 className="login-brand-title">Sales<br />Reconciliation</h1>
          <p className="login-brand-sub">
            Your all-in-one daily operations &amp; reconciliation platform
          </p>
          <div className="login-features">
            <div className="login-feature-chip">
              <span className="login-feature-icon"><FiShield /></span>
              <span>Secure Access</span>
            </div>
            <div className="login-feature-chip">
              <span className="login-feature-icon"><FiZap /></span>
              <span>Real-time Sync</span>
            </div>
            <div className="login-feature-chip">
              <span className="login-feature-icon"><FiBarChart2 /></span>
              <span>Smart Reports</span>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════ RIGHT — Form panel ══════════ */}
      <div className="login-form-panel">
        <div className="login-form-card">

          <div className="login-form-header">
            <div className="login-form-logo-sm">SR</div>
            <h2 className="login-form-title">Welcome back</h2>
            <p className="login-form-sub">Sign in to continue to your dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">

            {/* Locked state */}
            {isLocked ? (
              <div className="login-alert login-alert--locked">
                <div className="login-alert-title"><FiLock className="login-alert-icon" /> Account Locked</div>
                {role === 'admin'
                  ? 'Too many failed attempts. A temporary password has been sent to your email — please check your inbox and use it to log in.'
                  : 'Too many failed attempts. Your administrator has been notified and will reset your password shortly.'}
              </div>
            ) : attemptsRemaining !== null && attemptsRemaining <= 2 && attemptsRemaining > 0 ? (
              /* Warning countdown */
              <div className="login-alert login-alert--warning">
                <div className="login-alert-row">
                  <FiAlertTriangle className="login-alert-icon" />
                  <span>
                    <strong>{attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining</strong>
                    {' '}before your account is locked.
                  </span>
                </div>
              </div>
            ) : error ? (
              <div className="login-alert login-alert--error">{error}</div>
            ) : null}

            <div className="login-field">
              <label className="login-label">Sign in as</label>
              <div className="login-role-toggle">
                <button
                  type="button"
                  className={`login-role-btn${role === 'user' ? ' active' : ''}`}
                  onClick={() => setRole('user')}
                >
                  <FiUser className="login-role-icon" /> User
                </button>
                <button
                  type="button"
                  className={`login-role-btn${role === 'admin' ? ' active' : ''}`}
                  onClick={() => setRole('admin')}
                >
                  <FiShield className="login-role-icon" /> Admin
                </button>
              </div>
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="email">Email Address</label>
              <div className="login-input-wrap">
                <span className="login-input-icon"><FiMail /></span>
                <input
                  id="email"
                  type="email"
                  className="login-input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={handleEmailChange}
                  required
                  autoComplete="email"
                  disabled={isLocked}
                />
              </div>
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="password">Password</label>
              <div className="login-input-wrap">
                <span className="login-input-icon"><FiLock /></span>
                <input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  className="login-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={isLocked}
                />
                <button
                  type="button"
                  className="login-pwd-toggle"
                  onClick={() => setShowPwd(v => !v)}
                  tabIndex={-1}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className={`login-submit-btn${isLocked ? ' login-submit-btn--locked' : ''}`}
              disabled={loading || isLocked}
            >
              {loading ? <span className="login-btn-spinner" /> : null}
              {isLocked ? (
                <><FiLock /> Account Locked</>
              ) : loading ? (
                'Signing in…'
              ) : (
                <>Sign In <FiArrowRight /></>
              )}
            </button>
          </form>

        </div>
      </div>

    </motion.div>
  );
};
