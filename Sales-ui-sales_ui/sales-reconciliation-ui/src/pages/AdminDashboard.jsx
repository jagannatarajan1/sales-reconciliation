import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import '../styles/AdminDashboard.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

// Kept as a plain top-level function (not inline in the component) so a full-page
// navigation away from the app isn't mistaken by the linter for a React render-time mutation.
const navigateBrowserTo = (url) => {
  window.location.href = url;
};

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const getInitials = (nameOrEmail = '') =>
  nameOrEmail.split(/[\s@]/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

const cards = [
  {
    icon: '👤',
    title: 'Register User / Admin',
    desc: 'Create a new user or admin account',
    label: 'Register Account',
    path: '/admin/register',
    color: '#3b82f6',
  },
  {
    icon: '🔑',
    title: 'Reset Password',
    desc: 'Change the password for any account',
    label: 'Reset Password',
    path: '/admin/change-password',
    color: '#8b5cf6',
  },
  {
    icon: '📊',
    title: 'Sales Reconciliation',
    desc: 'Review and submit pending staff reconciliations',
    label: 'Pending Reconciliation',
    path: '/admin/reconciliation',
    color: '#10b981',
  },
  {
    icon: '📈',
    title: 'Reports',
    desc: 'Date-wise history, Z-Report comparison and variance',
    label: 'View Reports',
    path: '/admin/reports',
    color: '#f59e0b',
  },
  {
    icon: '🎰',
    title: 'Reset Scratch Cards',
    desc: 'Manage scratch card status and forced open values',
    label: 'Reset Scratch Cards',
    path: '/admin/scratch-cards',
    color: '#ec4899',
  },
  {
    icon: '🏪',
    title: 'Suppliers',
    desc: 'Add and remove suppliers for staff invoice entry',
    label: 'Manage Suppliers',
    path: '/admin/suppliers',
    color: '#06b6d4',
  },
  {
    icon: '🧾',
    title: 'Supplier Payout',
    desc: 'Date-wise view of all invoices entered by staff',
    label: 'View Invoices',
    path: '/admin/supplier-invoices',
    color: '#14b8a6',
  },
  {
    icon: '📅',
    title: 'Reset Commit Date',
    desc: 'Override the active working date for staff users',
    label: 'Reset Commit Date',
    path: '/admin/reset-commit-date',
    color: '#ef4444',
  },
  {
    icon: '📧',
    title: 'Connect Gmail',
    desc: 'Connect the shop mailbox so daily Z-report emails show up automatically',
    label: 'Connect Gmail',
    path: `${API_BASE}/gmail/connect`,
    color: '#6366f1',
    external: true,
  },
];

export const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [gmailStatus, setGmailStatus] = useState(null);

  useEffect(() => {
    if (!user?.token) return;
    fetch(`${API_BASE}/gmail/status`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setGmailStatus(data))
      .catch(() => setGmailStatus(null));
  }, [user]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleConnectGmail = () => {
    fetch(`${API_BASE}/gmail/connect`, {
      headers: { Authorization: `Bearer ${user?.token}` },
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.url) {
          alert(data.message || 'Could not start the Gmail connection. Please try again.');
          return;
        }
        navigateBrowserTo(data.url);
      })
      .catch(() => {
        alert('Could not reach the server to start the Gmail connection.');
      });
  };

  const gmailCardDesc = (card) => {
    if (!card.external) return card.desc;
    if (gmailStatus?.isConnected) return `Connected as ${gmailStatus.emailAddress}`;
    return card.desc;
  };

  const displayName = user?.name || user?.email || 'Admin';
  const initials    = getInitials(displayName);
  const todayLong   = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });

  return (
    <div className="adm-wrapper">

      {/* ── Navbar ── */}
      <nav className="adm-navbar">
        <div className="adm-navbar-left">
          <div className="adm-navbar-logo">SR</div>
          <div>
            <div className="adm-navbar-brand">Sales Reconciliation</div>
            <div className="adm-navbar-sub">Admin Panel</div>
          </div>
        </div>
        <div className="adm-navbar-right">
          <span className="adm-navbar-date">{todayLong}</span>
          <div className="adm-nav-divider" />
          <div className="adm-user-avatar">{initials}</div>
          <span className="adm-user-name">{displayName}</span>
          <span className="adm-admin-badge">Admin</span>
          <button onClick={handleLogout} className="adm-logout-btn">Sign out</button>
        </div>
      </nav>

      {/* ── Main ── */}
      <div className="adm-main">

        {/* Hero */}
        <div className="adm-hero">
          <h1 className="adm-greeting">{getGreeting()}, {displayName.split(' ')[0]} 👋</h1>
          <p className="adm-subline">{todayLong} · Admin Control Panel</p>
        </div>

        {/* Card grid */}
        <div className="adm-grid">
          {cards.map((card) => (
            <button
              key={card.title}
              className="adm-card"
              style={{ '--adm-accent': card.color, '--adm-accent-bg': card.color + '18' }}
              onClick={() => (card.external ? handleConnectGmail() : navigate(card.path))}
            >
              <div className="adm-card-icon-wrap">
                <span className="adm-card-icon">{card.icon}</span>
              </div>
              <div className="adm-card-body">
                <div className="adm-card-name">{card.title}</div>
                <div className="adm-card-desc">{gmailCardDesc(card)}</div>
              </div>
              <span className="adm-card-arrow">→</span>
            </button>
          ))}
        </div>

      </div>
    </div>
  );
};
