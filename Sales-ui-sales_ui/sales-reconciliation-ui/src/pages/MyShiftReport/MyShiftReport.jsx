import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiAlertCircle, FiRefreshCw, FiClock, FiGrid, FiFileText, FiTrash2, FiPackage, FiInfo,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { fmtGBP, fmtCount, fmtShopTime, DEPT_CATEGORY_LABEL } from '../../utils/tillReportFormat';
import './MyShiftReport.css';

// ─────────────────────────────────────────────────────────────────────────
// Frontend for GET /api/Summary/my-shift-report — the staff-facing "see my
// own shift's full till report" page (departments, VAT, tender, voids,
// every product — the same depth admins get on the Till Report Check page,
// see AdminTillReconciliation.jsx). Deliberately has NO date/shift picker:
// this always shows the current session's shift only, which the backend
// derives from server-side session context, never from anything this page
// could send. That absence is itself a visible reinforcement of the
// security boundary — there is nowhere on this page to even ask for another
// shift's or another date's figures.
//
// This is a single report's OWN contents, never a comparison. There is no
// Day+Night-vs-Z checking here (that stays admin-only) — no s1/s2/expected/
// actual/variance/status columns anywhere on this page, unlike the admin
// comparison tables.
// ─────────────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const SHIFT_LABEL = { DAY: 'Day Shift', NIGHT: 'Night Shift', FULL_DAY: 'Today' };

function DepartmentTable({ rows }) {
  return (
    <div className="msr-table-wrap">
      <table className="msr-table">
        <thead>
          <tr>
            <th>Department</th>
            <th>Category</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="msr-row-name">{r.name}</td>
              <td>{DEPT_CATEGORY_LABEL[r.category] ?? r.category}</td>
              <td>{fmtGBP(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VatTable({ rows }) {
  return (
    <div className="msr-table-wrap">
      <table className="msr-table">
        <thead>
          <tr>
            <th>VAT Code</th>
            <th>Net Sales (Ex VAT)</th>
            <th>VAT Amount</th>
            <th>Total (Inc VAT)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="msr-row-name">{r.code}</td>
              <td>{fmtGBP(r.salesExVat)}</td>
              <td>{fmtGBP(r.vat)}</td>
              <td>{fmtGBP(r.salesInVat)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VoidTable({ rows }) {
  return (
    <div className="msr-table-wrap">
      <table className="msr-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Time</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="msr-row-name">{r.type}</td>
              <td>{fmtShopTime(r.occurredAt)}</td>
              <td>{fmtGBP(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductTable({ rows }) {
  return (
    <div className="msr-table-wrap">
      <table className="msr-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Department</th>
            <th>Quantity Sold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="msr-row-name">{r.productName}</td>
              <td>{r.departmentName}</td>
              <td>{fmtCount(r.salesQuantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, Icon, subtitle, rows, children }) {
  return (
    <div className="msr-section">
      <div className="msr-section-header">
        <div className="msr-section-title"><Icon /> {title}</div>
        {rows && <span className="msr-section-meta">{rows.length} {rows.length === 1 ? 'line' : 'lines'}</span>}
      </div>
      {subtitle && <p className="msr-section-sub">{subtitle}</p>}
      {rows && rows.length === 0 ? (
        <p className="msr-section-empty">Nothing recorded for this shift.</p>
      ) : (
        children
      )}
    </div>
  );
}

export const MyShiftReport = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/Summary/my-shift-report`, { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Could not load your shift report.');
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setData(null);
      setError(e.message || 'Could not load your shift report. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  useEffect(() => {
    const run = async () => { await load(); };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  const shiftLabel = data?.shift ? (SHIFT_LABEL[data.shift] ?? 'Your Shift') : 'Your Shift';

  return (
    <motion.div
      className="msr-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <button className="msr-back-btn" onClick={() => navigate(-1)}>
        <FiArrowLeft /> Back
      </button>

      <div className="msr-page-header">
        <h1 className="msr-page-title"><FiFileText /> My Shift Report</h1>
        <p className="msr-page-sub">
          The full till report for {shiftLabel.toLowerCase()} — departments, VAT, payments, voided sales
          and every product sold. This always shows your current shift only.
        </p>
      </div>

      {loading ? (
        <div className="msr-center">
          <div className="msr-spinner" />
          <p>Loading your shift report…</p>
        </div>
      ) : error ? (
        <div className="msr-error-panel" role="alert">
          <FiAlertCircle size={22} />
          <div>
            <p className="msr-error-title">Couldn&rsquo;t load your report</p>
            <p className="msr-error-message">{error}</p>
          </div>
          <button type="button" className="msr-retry-btn" onClick={load}>
            <FiRefreshCw /> Try Again
          </button>
        </div>
      ) : data && data.available === false ? (
        <div className="msr-info-panel">
          <FiInfo size={22} />
          <div>
            <p className="msr-info-title">Not available right now</p>
            <p className="msr-info-message">{data.message}</p>
          </div>
        </div>
      ) : data && data.hasReport === false ? (
        <div className="msr-info-panel">
          <FiClock size={22} />
          <div>
            <p className="msr-info-title">No report yet</p>
            <p className="msr-info-message">{data.message}</p>
            <p className="msr-info-hint">
              This page updates automatically once the till has sent its report for your shift — check back
              a little later, or refresh below.
            </p>
          </div>
          <button type="button" className="msr-retry-btn" onClick={load}>
            <FiRefreshCw /> Refresh
          </button>
        </div>
      ) : data && data.hasReport === true ? (
        <>
          {data.reportCount > 1 && (
            <div className="msr-note-box">
              <FiInfo />
              <span>
                Your till printed {data.reportCount} reports for this shift — the figures below are the
                combined total of all of them.
              </span>
            </div>
          )}

          <div className="msr-tiles">
            <div className="msr-tile">
              <div className="msr-tile-label">Cash</div>
              <div className="msr-tile-value">{fmtGBP(data.totals.cash)}</div>
            </div>
            <div className="msr-tile">
              <div className="msr-tile-label">Card</div>
              <div className="msr-tile-value">{fmtGBP(data.totals.card)}</div>
            </div>
            <div className="msr-tile">
              <div className="msr-tile-label">Manual Card</div>
              <div className="msr-tile-value">{fmtGBP(data.totals.manualCard)}</div>
            </div>
            <div className="msr-tile msr-tile--highlight">
              <div className="msr-tile-label">Grand Total</div>
              <div className="msr-tile-value">{fmtGBP(data.totals.grandTotal)}</div>
            </div>
            <div className="msr-tile">
              <div className="msr-tile-label">Transactions</div>
              <div className="msr-tile-value">{fmtCount(data.totals.transactionCount)}</div>
            </div>
            <div className="msr-tile">
              <div className="msr-tile-label">Income / Expense</div>
              <div className="msr-tile-value">{fmtGBP(data.totals.incomeExpenseTotal)}</div>
            </div>
          </div>

          <div className="msr-sections">
            <Section title="Departments" Icon={FiGrid} subtitle="Every department's sales for this shift." rows={data.departments}>
              <DepartmentTable rows={data.departments} />
            </Section>

            <Section title="VAT" Icon={FiFileText} subtitle="Tax breakdown by VAT rate." rows={data.vat}>
              <VatTable rows={data.vat} />
            </Section>

            <Section title="Voided Sales" Icon={FiTrash2} subtitle="Every void/refund recorded on this shift's report." rows={data.voids}>
              <VoidTable rows={data.voids} />
            </Section>

            <Section title="Products Sold" Icon={FiPackage} subtitle="Quantity sold per product for this shift." rows={data.products}>
              <ProductTable rows={data.products} />
            </Section>
          </div>
        </>
      ) : null}
    </motion.div>
  );
};

export default MyShiftReport;
