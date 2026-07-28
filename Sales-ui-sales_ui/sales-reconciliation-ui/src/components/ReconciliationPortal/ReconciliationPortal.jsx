import { useState, useEffect } from 'react';
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
    icon: '💳',
    fields: [
      { label: 'Manual Card Amount', key: 'manualCardAmount', monetary: true },
      { label: 'Card Amount', key: 'cardAmount', monetary: true },
    ],
  },
  {
    title: 'Cash',
    color: 'green',
    icon: '💵',
    fields: [
      { label: 'Last Safe', key: 'lastSafe', monetary: true },
      { label: 'Safe Drop Amount', key: 'safeDropAmount', monetary: true },
      { label: 'Cash', key: 'cash', monetary: true },
    ],
  },
  {
    title: 'Deductions',
    color: 'orange',
    icon: '📉',
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
    icon: '📦',
    fields: [
      { label: 'Total Count', key: 'instantLotteryTotalCount', monetary: false },
      { label: 'Total Sales', key: 'instantLotteryTotalSales', monetary: true },
    ],
  },
  {
    title: 'Lottery',
    color: 'gold',
    icon: '🎰',
    fields: [
      { label: 'Lottery Value', key: 'lotteryValue', monetary: true },
    ],
  },
  {
    title: 'Paypoint',
    color: 'teal',
    icon: '🎲',
    fields: [
      { label: 'Paypoint Value', key: 'paypointValue', monetary: true },
    ],
  },
  {
    title: 'Totals',
    color: 'rose',
    icon: '📊',
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
    <div className="rp-container">
      <div className="rp-heading">
        <span>📅</span>
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
            {SECTIONS.map((section) => (
              <div key={section.title} className={`rp-section rp-section--${section.color}`}>
                <div className="rp-section-header">
                  <span>{section.icon}</span>
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
              </div>
            ))}
          </div>

          {data.adminNotes && (
            <div className="rp-notes">
              <span className="rp-notes-label">Admin Notes</span>
              <p className="rp-notes-text">{data.adminNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
