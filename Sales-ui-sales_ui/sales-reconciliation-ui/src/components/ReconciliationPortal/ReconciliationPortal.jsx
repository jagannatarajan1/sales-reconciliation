import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FiCalendar, FiCreditCard, FiDollarSign, FiTrendingDown,
  FiPackage, FiAward, FiTarget, FiBarChart2,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import './ReconciliationPortal.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const fmtGBP = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? '£0.00' : `£${n.toFixed(2)}`;
};

const SECTIONS = [
  {
    title: 'Credit Card',
    color: 'blue',
    icon: FiCreditCard,
    fields: [
      { label: 'Manual Card Amount', key: 'manualCardAmount', monetary: true },
      { label: 'Card Amount', key: 'cardAmount', monetary: true },
    ],
  },
  {
    title: 'Cash',
    color: 'green',
    icon: FiDollarSign,
    fields: [
      { label: 'Last Safe', key: 'lastSafe', monetary: true },
      { label: 'Safe Drop Amount', key: 'safeDropAmount', monetary: true },
      { label: 'Cash', key: 'cash', monetary: true },
    ],
  },
  {
    title: 'Deductions',
    color: 'orange',
    icon: FiTrendingDown,
    fields: [
      { label: 'Cashback', key: 'cashback', monetary: true },
      { label: 'Paypoint Payout', key: 'paypointPayout', monetary: true },
      { label: 'Instant Lottery Payout', key: 'instantLotteryPayout', monetary: true },
      { label: 'Lottery Payout', key: 'lotteryPayout', monetary: true },
      { label: 'News Voucher', key: 'newsVoucher', monetary: true },
      { label: 'DD Point', key: 'dDPoint', monetary: true },
    ],
  },
  {
    title: 'Instant Lottery',
    color: 'purple',
    icon: FiPackage,
    fields: [
      { label: 'Total Count', key: 'instantLotteryTotalCount', monetary: false },
      { label: 'Total Sales', key: 'instantLotteryTotalSales', monetary: true },
    ],
  },
  {
    title: 'Lottery',
    color: 'gold',
    icon: FiAward,
    fields: [
      { label: 'Lottery Value', key: 'lotteryValue', monetary: true },
    ],
  },
  {
    title: 'Paypoint',
    color: 'teal',
    icon: FiTarget,
    fields: [
      { label: 'Paypoint Value', key: 'paypointValue', monetary: true },
    ],
  },
  {
    title: 'Totals',
    color: 'rose',
    icon: FiBarChart2,
    fields: [
      { label: 'Summary Total', key: 'summaryTotal', monetary: true },
      { label: 'Z-Report Total', key: 'zReportTotal', monetary: true },
      { label: 'Difference', key: 'difference', monetary: true },
    ],
  },
];

export const ReconciliationPortal = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchPortal = async () => {
      try {
        const res = await fetch(`${API_BASE}/Summary/reconciliation/portal`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        setData(json.hasReconciliation ? json : null);
      } catch {
        setError("Could not load yesterday's reconciliation.");
      } finally {
        setLoading(false);
      }
    };
    fetchPortal();
  }, [user.token]);

  return (
    <motion.div
      className="rp-container"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="rp-heading">
        <FiCalendar />
        <h2>Yesterday&#39;s Reconciliation</h2>
      </div>

      {loading ? (
        <div className="rp-center">
          <div className="rp-spinner" />
          <span>Loading…</span>
        </div>
      ) : error ? (
        <div className="rp-notice rp-notice--error">{error}</div>
      ) : !data ? (
        <div className="rp-notice">
          No reconciliation available yet for yesterday. Check back later.
        </div>
      ) : (
        <div className="rp-card">
          <div className="rp-meta">
            <span className="rp-badge rp-badge--date">
              {new Date(data.date).toLocaleDateString('en-GB', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              })}
            </span>
            {data.submittedAt && (
              <span className="rp-badge rp-badge--submitted">
                Submitted: {new Date(data.submittedAt).toLocaleString('en-GB')}
              </span>
            )}
          </div>

          <div className="rp-grid">
            {SECTIONS.map((section) => {
              const SectionIcon = section.icon;
              return (
                <motion.div
                  key={section.title}
                  className={`rp-section rp-section--${section.color}`}
                  whileHover={{ y: -3, boxShadow: 'var(--shadow-md)' }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                >
                  <div className="rp-section-header">
                    <SectionIcon className="rp-section-icon" />
                    <span>{section.title}</span>
                  </div>
                  <div className="rp-section-body">
                    {section.fields.map((field) => (
                      <div key={field.key} className="rp-row">
                        <span className="rp-row-label">{field.label}</span>
                        <span className="rp-row-value">
                          {field.monetary
                            ? fmtGBP(data[field.key])
                            : (data[field.key] ?? '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {data.adminNotes && (
            <div className="rp-notes">
              <span className="rp-notes-label">Admin Notes</span>
              <p className="rp-notes-text">{data.adminNotes}</p>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};
