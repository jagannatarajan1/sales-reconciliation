import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/Dashboard.css';

const API = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const LOCKABLE_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 9]);

const menuItems = [
  { id: 1,  name: 'Shop Sale',             icon: '🛍️', path: '/shop-sale',                desc: 'Record daily shop sales',          color: '#3b82f6' },
  { id: 2,  name: 'Credit Card Banking',   icon: '💳', path: '/credit-card-banking',       desc: 'Manage card transactions',         color: '#8b5cf6' },
  { id: 3,  name: 'Cash Banking',          icon: '💵', path: '/cash-banking',              desc: 'Cash float & safe drops',          color: '#10b981' },
  { id: 4,  name: 'Deductions',            icon: '📉', path: '/deductions',                desc: 'Cashback, payouts & vouchers',     color: '#f59e0b' },
  { id: 5,  name: 'Instant Lottery',       icon: '📦', path: '/instant-lottery-inventory', desc: 'Scratch card inventory & sales',   color: '#7c3aed' },
  { id: 6,  name: 'Lottery',               icon: '🎰', path: '/lottery',                   desc: 'Daily lottery value entry',        color: '#ec4899' },
  { id: 7,  name: 'Paypoint',               icon: '🎲', path: '/Paypoint',                   desc: 'Paypoint machine values',          color: '#06b6d4' },
  { id: 9,  name: 'Summary',              icon: '📊', path: '/summary',                  desc: 'Reconciliation overview',          color: '#14b8a6' },
  { id: 10, name: 'Commit Day',            icon: '✅', path: '/commit',                    desc: "Finalise & lock today's data",     color: '#ef4444' },
];

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const getInitials = (nameOrEmail = '') =>
  nameOrEmail.split(/[\s@]/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

export const Dashboard = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isCommitted, setIsCommitted] = useState(false);
  const [committedAt, setCommittedAt] = useState(null);

  useEffect(() => {
    if (!user?.token) return;
    fetch(`${API}/Summary/today`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.isCommitted) {
          setIsCommitted(true);
          setCommittedAt(data.committedAt ?? null);
        }
      })
      .catch(() => {});
  }, [user?.token]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const fmtDateTime = (str) => str
    ? new Date(str).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  const todayLong = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const displayName = user?.name || user?.email || 'User';
  const initials = getInitials(displayName);

  return (
    <div className="dashboard-wrapper">

      {/* ── Navbar ── */}
      <nav className="dashboard-navbar">
        <div className="navbar-left">
          <div className="navbar-logo">SR</div>
          <div>
            <div className="navbar-brand">Sales Reconciliation</div>
            <div className="navbar-sub">Daily Operations</div>
          </div>
        </div>
        <div className="navbar-right">
          <span className="navbar-date">{todayLong}</span>
          <div className="nav-divider" />
          <div className="user-avatar">{initials}</div>
          <span className="user-greeting">{displayName}</span>
          <button onClick={handleLogout} className="logout-btn">Sign out</button>
        </div>
      </nav>

      {/* ── Main ── */}
      <div className="dashboard-main">

        {/* Hero */}
        <div className="dashboard-hero">
          <h1 className="dashboard-greeting">{getGreeting()}, {displayName.split(' ')[0]} 👋</h1>
          <p className="dashboard-subline">{todayLong} · Select a module to get started</p>
        </div>

        {/* Lock banner */}
        {isCommitted && (
          <div className="dashboard-lock-banner">
            <span>🔒</span>
            Today's reconciliation was committed{committedAt ? ` at ${fmtDateTime(committedAt)}` : ''}. Data entry modules are locked until tomorrow.
          </div>
        )}

        {/* Card grid */}
        <div className="menu-grid">
          {menuItems.map((item) => {
            const locked = isCommitted && LOCKABLE_IDS.has(item.id);
            return (
              <button
                key={item.id}
                className={`menu-card${locked ? ' menu-card--locked' : ''}`}
                style={{ '--card-accent': item.color, '--card-accent-bg': item.color + '18' }}
                onClick={locked ? undefined : () => navigate(item.path)}
                disabled={locked}
                title={locked ? 'Locked — today is already committed' : item.desc}
              >
                {locked && <span className="card-lock">🔒</span>}
                <div className="card-icon-wrap">
                  <span className="card-icon">{item.icon}</span>
                </div>
                <div className="card-body">
                  <div className="card-name">{item.name}</div>
                  <div className="card-desc">{item.desc}</div>
                </div>
                <span className="card-arrow">→</span>
              </button>
            );
          })}
        </div>

      </div>
    </div>
  );
};
