import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import {
  FiShield, FiZap, FiBarChart2, FiMail, FiLock,
  FiEye, FiEyeOff, FiAlertTriangle, FiArrowRight, FiArrowLeft, FiRefreshCw,
} from 'react-icons/fi';
import '../styles/Login.css';

const RESEND_COOLDOWN_SECONDS = 30;

export const Login = () => {
  const navigate = useNavigate();
  const { login, verifyOtp, resendOtp } = useAuth();

  // One page, two steps — 'credentials' is the only thing ever shown for a
  // user account (the backend never returns otpRequired for one). 'otp'
  // only appears after the backend itself has identified the account as an
  // admin; nothing about which step to show is decided on the frontend.
  const [step, setStep] = useState('credentials');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [otpSessionId, setOtpSessionId] = useState(null);
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [expirySeconds, setExpirySeconds] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef(null);

  useEffect(() => {
    if (step !== 'otp') return undefined;
    const id = setInterval(() => {
      setExpirySeconds((s) => Math.max(s - 1, 0));
      setResendCooldown((s) => Math.max(s - 1, 0));
    }, 1000);
    return () => clearInterval(id);
  }, [step]);

  useEffect(() => {
    if (step === 'otp') codeInputRef.current?.focus();
  }, [step]);

  const handleCredentialsSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!email || !password) throw new Error('Please fill in all fields');
      if (!email.includes('@')) throw new Error('Please enter a valid email');

      const result = await login(email, password);

      if (result.otpRequired) {
        setOtpSessionId(result.otpSessionId);
        setMaskedEmail(result.maskedEmail);
        setExpirySeconds(result.expiresInSeconds);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setCode('');
        setOtpError('');
        setAttemptsRemaining(null);
        setStep('otp');
      } else {
        navigate(result.user.role === 'admin' ? '/admin/dashboard' : '/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    if (expirySeconds <= 0) {
      setOtpError('This code has expired. Request a new one below.');
      return;
    }
    setOtpError('');
    setVerifying(true);
    try {
      if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code from your email');
      await verifyOtp(otpSessionId, code);
      navigate('/admin/dashboard');
    } catch (err) {
      const remaining = err.response?.data?.attemptsRemaining;
      if (remaining !== undefined) setAttemptsRemaining(remaining);
      setOtpError(err.response?.data?.message || err.message || 'Verification failed. Please try again.');
      setCode('');
      codeInputRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setOtpError('');
    try {
      const result = await resendOtp(otpSessionId);
      setExpirySeconds(result.expiresInSeconds);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setAttemptsRemaining(null);
      setCode('');
    } catch (err) {
      setOtpError(err.response?.data?.message || err.message || 'Failed to resend code.');
      const retryAfter = err.response?.data?.retryAfterSeconds;
      if (retryAfter) setResendCooldown(retryAfter);
    } finally {
      setResending(false);
    }
  };

  const backToCredentials = () => {
    setStep('credentials');
    setOtpSessionId(null);
    setCode('');
    setOtpError('');
    setAttemptsRemaining(null);
  };

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    setError('');
  };

  const fmtTimer = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
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

          {step === 'credentials' ? (
            <>
              <div className="login-form-header">
                <div className="login-form-logo-sm">SR</div>
                <h2 className="login-form-title">Welcome back</h2>
                <p className="login-form-sub">Sign in to continue to your dashboard</p>
              </div>

              <form onSubmit={handleCredentialsSubmit} className="login-form">
                {error && <div className="login-alert login-alert--error">{error}</div>}

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
                    />
                    <button
                      type="button"
                      className="login-pwd-toggle"
                      onClick={() => setShowPwd((v) => !v)}
                      tabIndex={-1}
                      aria-label={showPwd ? 'Hide password' : 'Show password'}
                    >
                      {showPwd ? <FiEyeOff /> : <FiEye />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="login-submit-btn" disabled={loading}>
                  {loading ? <span className="login-btn-spinner" /> : null}
                  {loading ? 'Signing in…' : <>Sign In <FiArrowRight /></>}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="login-form-header">
                <div className="login-form-icon"><FiShield /></div>
                <h2 className="login-form-title">Verify it's you</h2>
                <p className="login-form-sub">
                  We've sent a 6-digit code to <strong>{maskedEmail}</strong>
                </p>
              </div>

              <form onSubmit={handleOtpSubmit} className="login-form">
                {otpError && (
                  <div className="login-alert login-alert--error">
                    <div className="login-alert-row">
                      <FiAlertTriangle className="login-alert-icon" />
                      <span>{otpError}</span>
                    </div>
                    {attemptsRemaining !== null && attemptsRemaining > 0 && (
                      <div className="login-otp-attempts">
                        {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining before this code is locked.
                      </div>
                    )}
                  </div>
                )}

                <div className="login-field">
                  <label className="login-label" htmlFor="otp-code">Verification Code</label>
                  <input
                    id="otp-code"
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="login-otp-input"
                    placeholder="000000"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  <div className="login-otp-meta">
                    <span className={expirySeconds <= 30 ? 'login-otp-expiry login-otp-expiry--warn' : 'login-otp-expiry'}>
                      {expirySeconds > 0 ? `Expires in ${fmtTimer(expirySeconds)}` : 'Code expired'}
                    </span>
                    <button
                      type="button"
                      className="login-otp-resend"
                      onClick={handleResend}
                      disabled={resendCooldown > 0 || resending}
                    >
                      <FiRefreshCw className={resending ? 'login-otp-resend-spin' : ''} />
                      {resending ? 'Sending…' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                    </button>
                  </div>
                </div>

                <button type="submit" className="login-submit-btn" disabled={verifying || code.length !== 6}>
                  {verifying ? <span className="login-btn-spinner" /> : null}
                  {verifying ? 'Verifying…' : <>Verify &amp; Sign In <FiArrowRight /></>}
                </button>

                <button type="button" className="login-back-link" onClick={backToCredentials}>
                  <FiArrowLeft /> Back to login
                </button>
              </form>
            </>
          )}

        </div>
      </div>

    </motion.div>
  );
};
