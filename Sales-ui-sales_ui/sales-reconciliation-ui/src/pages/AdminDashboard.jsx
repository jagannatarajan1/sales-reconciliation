import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiBarChart2,
  FiCalendar,
  FiCamera,
  FiCheckSquare,
  FiClipboard,
  FiFileText,
  FiMail,
  FiRotateCcw,
  FiShoppingBag,
  FiUsers,
} from 'react-icons/fi';
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

// Mirrors the backend's hasPermission()/requirePermission() rule exactly.
const hasPermission = (user, moduleKey) => {
  if (!moduleKey) return true;
  return user?.role === 'admin' && (user?.permissions ?? []).includes(moduleKey);
};

const cards = [
  {
    icon: FiUsers,
    title: 'User Management',
    desc: 'Create, edit, disable, and reset passwords for user/admin accounts',
    label: 'Manage Users',
    path: '/admin/users',
    color: '#3b82f6',
    permission: 'userManagement',
  },
  {
    icon: FiBarChart2,
    title: 'Reconciliation Review',
    desc: 'Review and submit uncommitted data; browse committed records',
    label: 'Review Reconciliation',
    path: '/admin/reconciliation',
    color: '#10b981',
  },
  {
    icon: FiClipboard,
    title: 'Z Reports',
    desc: 'Browse Z-report emails over a date range — view, download, print',
    label: 'View Z Reports',
    path: '/admin/z-reports',
    color: '#0ea5e9',
    permission: 'reports',
  },
  {
    icon: FiCheckSquare,
    title: 'Till Report Check',
    desc: 'Checks that the day and night shift reports add up to the end-of-day report, penny for penny',
    label: 'Check Till Reports',
    path: '/admin/till-reconciliation',
    color: '#22c55e',
    permission: 'reports',
  },
  {
    icon: FiCamera,
    title: 'Session Photos',
    desc: 'Browse photo evidence attached by staff, by user, session and date',
    label: 'View Session Photos',
    path: '/admin/session-photos',
    color: '#8b5cf6',
    permission: 'sessionPhotos',
  },
  {
    icon: FiRotateCcw,
    title: 'Reset Scratch Cards',
    desc: 'Manage scratch card status and forced open values',
    label: 'Reset Scratch Cards',
    path: '/admin/scratch-cards',
    color: '#ec4899',
  },
  {
    icon: FiShoppingBag,
    title: 'Suppliers',
    desc: 'Add and remove suppliers for user invoice entry',
    label: 'Manage Suppliers',
    path: '/admin/suppliers',
    color: '#06b6d4',
  },
  {
    icon: FiFileText,
    title: 'Supplier Payout',
    desc: 'Date-wise view of all invoices entered by users',
    label: 'View Invoices',
    path: '/admin/supplier-invoices',
    color: '#14b8a6',
  },
  {
    icon: FiCalendar,
    title: 'Reset Commit Date',
    desc: 'Override the active working date for users',
    label: 'Reset Commit Date',
    path: '/admin/reset-commit-date',
    color: '#ef4444',
  },
  {
    icon: FiMail,
    title: 'Connect Gmail',
    desc: 'Connect the shop mailbox so daily Z-report emails show up automatically',
    label: 'Connect Gmail',
    path: `${API_BASE}/gmail/connect`,
    color: '#6366f1',
    external: true,
  },
];

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } },
};

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
        <motion.div
          className="adm-grid"
          variants={gridVariants}
          initial="hidden"
          animate="visible"
        >
          {cards.filter((card) => hasPermission(user, card.permission)).map((card) => {
            const Icon = card.icon;
            return (
              <motion.button
                key={card.title}
                className="adm-card"
                style={{ '--adm-accent': card.color, '--adm-accent-bg': card.color + '18' }}
                onClick={() => (card.external ? handleConnectGmail() : navigate(card.path))}
                variants={cardVariants}
                whileHover={{ y: -6 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="adm-card-icon-wrap">
                  <Icon className="adm-card-icon" size={22} />
                </div>
                <div className="adm-card-body">
                  <div className="adm-card-name">{card.title}</div>
                  <div className="adm-card-desc">{gmailCardDesc(card)}</div>
                </div>
                <span className="adm-card-arrow">→</span>
              </motion.button>
            );
          })}
        </motion.div>

      </div>
    </div>
  );
};
