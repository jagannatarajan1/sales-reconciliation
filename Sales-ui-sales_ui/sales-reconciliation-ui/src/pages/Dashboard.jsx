import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FiShoppingBag, FiCreditCard, FiDollarSign, FiTrendingDown, FiPackage,
  FiCircle, FiBarChart2, FiCheckCircle, FiLock, FiClipboard,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import '../styles/Dashboard.css';

const API = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const LOCKABLE_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 9]);

const menuItems = [
  { id: 1,  name: 'Shop Sale',             icon: FiShoppingBag,  path: '/shop-sale',                desc: 'Record daily shop sales',          color: '#3b82f6' },
  { id: 2,  name: 'Credit Card Banking',   icon: FiCreditCard,   path: '/credit-card-banking',       desc: 'Manage card transactions',         color: '#8b5cf6' },
  { id: 3,  name: 'Cash Banking',          icon: FiDollarSign,   path: '/cash-banking',              desc: 'Cash float & safe drops',          color: '#10b981' },
  { id: 4,  name: 'Deductions',            icon: FiTrendingDown, path: '/deductions',                desc: 'Cashback, payouts & vouchers',     color: '#f59e0b' },
  { id: 5,  name: 'Instant Lottery',       icon: FiPackage,      path: '/instant-lottery-inventory', desc: 'Scratch card inventory & sales',   color: '#7c3aed' },
  { id: 6,  name: 'Lottery',               icon: FiCircle,       path: '/lottery',                   desc: 'Daily lottery value entry',        color: '#ec4899' },
  { id: 7,  name: 'Paypoint',               icon: FiCircle,       path: '/Paypoint',                   desc: 'Paypoint machine values',          color: '#06b6d4' },
  { id: 9,  name: 'Summary',              icon: FiBarChart2,    path: '/summary',                  desc: 'Reconciliation overview',          color: '#14b8a6' },
  { id: 10, name: 'Commit Day',            icon: FiCheckCircle,  path: '/commit',                    desc: "Finalise & lock today's data",     color: '#ef4444' },
  // Never locked by today's commit — this reviews already-committed history,
  // exactly the data that only exists once a day has been committed.
  { id: 11, name: 'Reconciliation Review', icon: FiClipboard,   path: '/reconciliation-review',     desc: 'Review status & download reports', color: '#0ea5e9' },
];

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } },
};

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
    <motion.div
      className="dashboard-wrapper"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >

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
            <FiLock />
            Today's reconciliation was committed{committedAt ? ` at ${fmtDateTime(committedAt)}` : ''}. Data entry modules are locked until tomorrow.
          </div>
        )}

        {/* Card grid */}
        <motion.div className="menu-grid" variants={gridVariants} initial="hidden" animate="visible">
          {menuItems.map((item) => {
            const locked = isCommitted && LOCKABLE_IDS.has(item.id);
            const Icon = item.icon;
            return (
              <motion.button
                key={item.id}
                className={`menu-card${locked ? ' menu-card--locked' : ''}`}
                style={{ '--card-accent': item.color, '--card-accent-bg': item.color + '18' }}
                onClick={locked ? undefined : () => navigate(item.path)}
                disabled={locked}
                title={locked ? 'Locked — today is already committed' : item.desc}
                variants={cardVariants}
                whileHover={locked ? undefined : { y: -6 }}
                whileTap={locked ? undefined : { scale: 0.98 }}
              >
                {locked && <span className="card-lock"><FiLock size={12} /></span>}
                <div className="card-icon-wrap">
                  <Icon className="card-icon" size={22} />
                </div>
                <div className="card-body">
                  <div className="card-name">{item.name}</div>
                  <div className="card-desc">{item.desc}</div>
                </div>
                <span className="card-arrow">→</span>
              </motion.button>
            );
          })}
        </motion.div>

      </div>
    </motion.div>
  );
};
