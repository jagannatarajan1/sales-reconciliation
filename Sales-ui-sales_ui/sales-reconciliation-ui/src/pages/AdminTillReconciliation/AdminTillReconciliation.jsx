import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiCalendar, FiChevronLeft, FiChevronRight, FiChevronDown, FiChevronUp,
  FiCheckCircle, FiXCircle, FiAlertTriangle, FiAlertCircle, FiClock, FiInfo, FiRefreshCw,
  FiGrid, FiFileText, FiCreditCard, FiBarChart2, FiTrendingDown, FiTrash2, FiPackage,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { Badge } from '../../components/ui/Badge';
import { fmtGBP, fmtCount, pad2, fmtShopTime, DEPT_CATEGORY_LABEL } from '../../utils/tillReportFormat';
import './AdminTillReconciliation.css';

// ─────────────────────────────────────────────────────────────────────────
// Frontend for GET /api/admin/till-reports/reconcile/:date (see
// Sales-api/src/lib/tillReportReconciliation.ts for the ReconcileDayResult
// shape this renders). This is a NEW, separate, read-only check — it asks
// "does the till's own Day+Night data add up to its own end-of-day (Z)
// data", not the existing till-vs-staff-banking check that
// AdminReconciliation.jsx's ShiftBreakdownPanel/ar-xvz-summary already
// cover. Nothing here writes anything; every comparison is exact (no £5
// tolerance), matching the backend's "same machine, three views of the same
// data" reasoning.
//
// The end user is a small shop owner, not a technical admin, so every enum
// value the backend returns (LOTTERY_GROUP, DATA_MISSING, PASS/FAIL, ...) is
// translated to plain English before it reaches JSX -- see the *_LABEL /
// *_META maps below. Raw enum strings should never render verbatim.
// ─────────────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

/* -- Formatting helpers ---------------------------------------------------
   fmtGBP/fmtCount/pad2/fmtShopTime (which itself uses fmtMinutesOfDay
   internally)/DEPT_CATEGORY_LABEL now live in utils/tillReportFormat.js
   (imported above) so the staff-facing MyShiftReport page can share the
   exact same formatting. Everything below is comparison-specific (signed
   variance, date-picker navigation) and stays local to this admin-only
   page. */

const fmtSignedGBP = (val) => {
  if (val === null || val === undefined) return '—';
  const n = Number(val);
  if (Number.isNaN(n)) return '—';
  if (n === 0) return '£0.00';
  return `${n > 0 ? '+' : '−'}£${Math.abs(n).toFixed(2)}`;
};

const fmtSignedCount = (val) => {
  if (val === null || val === undefined) return '—';
  if (val === 0) return '0';
  return val > 0 ? `+${val}` : `${val}`;
};

// businessDate strings are plain YYYY-MM-DD -- parsed with an explicit local
// midnight suffix so the shown weekday/date never shifts a day depending on
// the browser's timezone.
const fmtDateLong = (str) =>
  new Date(`${str}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

const todayStr = () => new Date().toISOString().split('T')[0];

const shiftDateStr = (dateStr, deltaDays) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
};

/* -- Plain-English label maps -------------------------------------------- */

const STATUS_META = {
  PASS: { label: 'Matches', variant: 'success', Icon: FiCheckCircle },
  FAIL: { label: 'Mismatch', variant: 'danger', Icon: FiXCircle },
  DATA_MISSING: { label: 'Missing data', variant: 'warning', Icon: FiAlertTriangle },
  NOT_APPLICABLE: { label: 'Not available yet', variant: 'neutral', Icon: FiClock },
  TIMING_EXCEPTION: { label: 'Printed late', variant: 'info', Icon: FiClock },
};

const CATEGORY_LABEL = {
  DEPARTMENT: 'Department',
  VAT: 'VAT',
  TENDER: 'Payment Type',
  TRANSACTION_COUNT: 'Transaction Count',
  INCOME_EXPENSE: 'Income / Expense',
  VOID: 'Voided Sale',
  PRODUCT: 'Product',
  TIMING: 'Report Timing',
};

const WAITING_LABEL = {
  DAY_X: 'the midday (Day) report',
  NIGHT_X: "this evening's (Night) report",
  Z: "tonight's end-of-day (Z) report",
};

const OVERALL_META = {
  RECONCILED: {
    tone: 'success', title: 'Fully Reconciled', Icon: FiCheckCircle,
    body: "Everything matches — the day and night shift reports add up exactly to tonight's end-of-day report.",
  },
  EXCEPTION: {
    tone: 'danger', title: 'Needs Attention', Icon: FiAlertTriangle,
    body: 'Some figures don’t add up between the shift reports and the end-of-day report. See the details below.',
  },
  WAITING_FOR_DAY_X: {
    tone: 'info', title: 'Waiting for the Day Report', Icon: FiClock,
    body: `Still waiting on ${WAITING_LABEL.DAY_X} for this date — nothing to check yet.`,
  },
  WAITING_FOR_NIGHT_X: {
    tone: 'info', title: 'Waiting for the Night Report', Icon: FiClock,
    body: `Still waiting on ${WAITING_LABEL.NIGHT_X} for this date — nothing to check yet.`,
  },
  WAITING_FOR_Z: {
    tone: 'info', title: 'Waiting for the End-of-Day Report', Icon: FiClock,
    body: `The day and night reports are both in — still waiting on ${WAITING_LABEL.Z} before this date can be checked.`,
  },
  WAITING_FOR_REPORTS: {
    tone: 'info', title: 'Waiting for Reports', Icon: FiClock,
    body: 'More than one report is still missing for this date — nothing to check yet.',
  },
};

const humanizeExceptionKey = (key) =>
  key.replace('(LOTTERY_GROUP)', '(Lottery & PayPoint)').replace('(MERCHANDISE)', '(Shop)');

/* -- Small shared pieces -------------------------------------------------- */

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? { label: status, variant: 'neutral', Icon: FiInfo };
  const Icon = meta.Icon;
  return (
    <Badge variant={meta.variant} className="tr-status-badge">
      <Icon size={12} /> {meta.label}
    </Badge>
  );
}

function OverallBanner({ status, waitingFor }) {
  const meta = OVERALL_META[status] ?? OVERALL_META.WAITING_FOR_REPORTS;
  const Icon = meta.Icon;
  const waitingList = status === 'WAITING_FOR_REPORTS' && waitingFor?.length
    ? waitingFor.map((w) => WAITING_LABEL[w] ?? w).join(' and ')
    : null;
  return (
    <div className={`tr-banner tr-banner--${meta.tone}`}>
      <div className="tr-banner-icon"><Icon size={28} /></div>
      <div>
        <div className="tr-banner-title">{meta.title}</div>
        <p className="tr-banner-body">
          {waitingList ? `Still waiting on ${waitingList} for this date — nothing to check yet.` : meta.body}
        </p>
      </div>
    </div>
  );
}

function PresenceChip({ label, presence }) {
  const ok = !!presence?.present;
  return (
    <div className={`tr-presence-chip${ok ? ' tr-presence-chip--ok' : ' tr-presence-chip--pending'}`}>
      {ok ? <FiCheckCircle /> : <FiClock />}
      <span>{label}</span>
      <span className="tr-presence-chip-status">
        {ok ? (presence.count > 1 ? `Received (${presence.count} copies)` : 'Received') : 'Not received yet'}
      </span>
    </div>
  );
}

/* -- Summary tiles (day-end headline numbers) ----------------------------- */

const sumDeptCategory = (lines, category) =>
  lines.filter((l) => l.category === category).reduce((s, l) => s + (l.actual ?? 0), 0);

function SummaryTiles({ categories }) {
  const deptLines = categories.department.lines;
  const shopSales = sumDeptCategory(deptLines, 'MERCHANDISE');
  const lotterySales = sumDeptCategory(deptLines, 'LOTTERY_GROUP');
  const voidCount = categories.void.tuples.reduce((s, t) => s + t.actualCount, 0);
  const voidValue = categories.void.tuples.reduce((s, t) => s + t.amount * t.actualCount, 0);
  const voidIssues =
    categories.void.summary.totalMissing + categories.void.summary.totalUnexpected + categories.void.summary.totalDuplicate;

  const tiles = [
    { label: 'Total Shop Sales', value: fmtGBP(shopSales), sub: 'Every department except Lottery & PayPoint', status: categories.department.status },
    { label: 'Lottery & PayPoint', value: fmtGBP(lotterySales), sub: 'Lottery and PayPoint sales', status: categories.department.status },
    { label: 'Grand Total', value: fmtGBP(categories.tender.grandTotal.actual), sub: 'All payment types combined', status: categories.tender.grandTotal.status },
    { label: 'Cash Taken', value: fmtGBP(categories.tender.cash.actual), status: categories.tender.cash.status },
    { label: 'Card Payments', value: fmtGBP(categories.tender.card.actual), status: categories.tender.card.status },
    { label: 'Manual Card Entries', value: fmtGBP(categories.tender.manualCard.actual), status: categories.tender.manualCard.status },
    { label: 'Transactions', value: fmtCount(categories.transactionCount.actual), status: categories.transactionCount.status },
    { label: 'Income / Expense', value: fmtGBP(categories.incomeExpense.actual), status: categories.incomeExpense.status },
    {
      label: 'Voided Sales',
      value: String(voidCount),
      sub: voidCount > 0 ? `${fmtGBP(voidValue)} total${voidIssues > 0 ? ` · ${voidIssues} need review` : ''}` : 'None recorded',
      status: categories.void.status,
    },
  ];

  return (
    <div className="tr-tiles">
      {tiles.map((t) => (
        <div key={t.label} className={`tr-tile${t.status && t.status !== 'PASS' ? ' tr-tile--flag' : ''}`}>
          <div className="tr-tile-label">{t.label}</div>
          <div className="tr-tile-value">{t.value}</div>
          {t.sub && <div className="tr-tile-sub">{t.sub}</div>}
          {t.status && t.status !== 'PASS' && (
            <div className="tr-tile-flag"><StatusBadge status={t.status} /></div>
          )}
        </div>
      ))}
    </div>
  );
}

/* -- Flat "what's wrong" exceptions list ----------------------------------- */

function ExceptionRow({ exc }) {
  const meta = STATUS_META[exc.status] ?? STATUS_META.FAIL;
  return (
    <li className={`tr-exc-row tr-exc-row--${meta.variant}`}>
      <div className="tr-exc-row-head">
        <span className="tr-exc-category">{CATEGORY_LABEL[exc.category] ?? exc.category}</span>
        <span className="tr-exc-name">{humanizeExceptionKey(exc.key)}</span>
        <StatusBadge status={exc.status} />
      </div>
      {exc.hint && <p className="tr-exc-hint">{exc.hint}</p>}
    </li>
  );
}

function ExceptionsPanel({ exceptions }) {
  const problems = exceptions.filter((e) => e.status !== 'TIMING_EXCEPTION');
  const timingNotes = exceptions.filter((e) => e.status === 'TIMING_EXCEPTION');
  if (problems.length === 0 && timingNotes.length === 0) return null;

  return (
    <div className="tr-exceptions">
      {problems.length > 0 && (
        <div className="tr-exc-block tr-exc-block--problems">
          <h3 className="tr-exc-heading"><FiAlertTriangle /> Problems Found ({problems.length})</h3>
          <ul className="tr-exc-list">
            {problems.map((e, i) => <ExceptionRow key={i} exc={e} />)}
          </ul>
        </div>
      )}
      {timingNotes.length > 0 && (
        <div className="tr-exc-block tr-exc-block--timing">
          <h3 className="tr-exc-heading"><FiClock /> Worth Knowing ({timingNotes.length})</h3>
          <ul className="tr-exc-list">
            {timingNotes.map((e, i) => <ExceptionRow key={i} exc={e} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

/* -- Row normalizers: turn each category's own shape into a common
   {key, extra, s1, s2, expected, actual, variance, status} row so most
   categories can share one table renderer. Void is different enough
   (matched-tuple counts, not a shift-split amount) that it gets its own
   table component instead of being forced into this shape. -------------- */

const normalizeDeptRows = (lines) =>
  lines.map((l) => ({
    key: l.key,
    extra: l.category ? DEPT_CATEGORY_LABEL[l.category] ?? l.category : null,
    s1: l.s1, s2: l.s2, expected: l.expected, actual: l.actual, variance: l.variance, status: l.status,
  }));

const normalizeProductRows = (lines) =>
  lines.map((l) => ({
    key: l.key,
    extra: l.extra || null,
    s1: l.s1, s2: l.s2, expected: l.expected, actual: l.actual, variance: l.variance, status: l.status,
  }));

// One primary row per VAT code (the gross/incl.-VAT figure, the one a shop
// owner actually recognises), plus indented sub-rows ONLY for whichever of
// the net/VAT-amount components didn't pass -- keeps a clean code fully
// collapsed while still surfacing exactly which figure is off for a FAIL.
const normalizeVatRows = (lines) => {
  const rows = [];
  for (const l of lines) {
    rows.push({
      key: `VAT ${l.vatCode}`,
      extra: 'total incl. VAT',
      s1: l.salesInVat.s1, s2: l.salesInVat.s2, expected: l.salesInVat.expected,
      actual: l.salesInVat.actual, variance: l.salesInVat.variance, status: l.status,
    });
    if (l.status !== 'PASS') {
      if (l.salesExVat.status !== 'PASS') {
        rows.push({ key: 'Net sales (before VAT)', indent: true, ...l.salesExVat });
      }
      if (l.vat.status !== 'PASS') {
        rows.push({ key: 'VAT amount', indent: true, ...l.vat });
      }
    }
  }
  return rows;
};

const normalizeSingleRows = (results) =>
  results.map((r) => ({
    key: r.label, s1: r.s1, s2: r.s2, expected: r.expected, actual: r.actual, variance: r.variance, status: r.status,
  }));

const normalizeVoidRows = (tuples) =>
  tuples.map((t) => ({
    key: t.type,
    time: fmtShopTime(t.occurredAt),
    amount: t.amount,
    expectedCount: t.expectedCount,
    actualCount: t.actualCount,
    status: t.status,
  }));

/* -- Table renderers -------------------------------------------------------- */

const formatCell = (val, unit) => (unit === 'count' ? fmtCount(val) : fmtGBP(val));
const formatVarianceCell = (val, unit) => (unit === 'count' ? fmtSignedCount(val) : fmtSignedGBP(val));

function ComparisonTable({ rows, unit = 'currency' }) {
  return (
    <div className="tr-table-wrap">
      <table className="tr-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Day Shift</th>
            <th>Night Shift</th>
            <th>Expected (Day + Night)</th>
            <th>Final Report (Z)</th>
            <th>Difference</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.key}-${i}`} className={`tr-row${r.status !== 'PASS' ? ' tr-row--flag' : ''}${r.indent ? ' tr-row--indent' : ''}`}>
              <td className="tr-row-name">
                {r.indent && <span className="tr-row-indent-arrow">↳</span>}
                {r.key}
                {r.extra ? <span className="tr-row-extra"> · {r.extra}</span> : null}
              </td>
              <td>{formatCell(r.s1, unit)}</td>
              <td>{formatCell(r.s2, unit)}</td>
              <td>{r.expected === null ? '—' : formatCell(r.expected, unit)}</td>
              <td>{formatCell(r.actual, unit)}</td>
              <td className="tr-cell-variance">{r.variance === null ? '—' : formatVarianceCell(r.variance, unit)}</td>
              <td><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VoidTable({ rows }) {
  return (
    <div className="tr-table-wrap">
      <table className="tr-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Amount</th>
            <th>Time</th>
            <th>Expected (Shift Reports)</th>
            <th>Found on Final Report</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`tr-row${r.status !== 'PASS' ? ' tr-row--flag' : ''}`}>
              <td className="tr-row-name">{r.key}</td>
              <td>{fmtGBP(r.amount)}</td>
              <td>{r.time}</td>
              <td>{r.expectedCount}</td>
              <td>{r.actualCount}</td>
              <td><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -- Collapsible per-category section --------------------------------------
   Rows that didn't PASS are always shown, with no expanding required --
   a busy shop owner should never have to hunt through 40 clean rows to
   find the 1 that matters. A fully-clean category collapses to a single
   "N/N matched" summary line; anything less than fully clean still keeps
   the matched rows tucked away behind "show all" unless expanded. -------- */

function CategorySection({ title, Icon, subtitle, rows, renderTable, extraContent }) {
  const [expanded, setExpanded] = useState(false);
  const table = renderTable ?? ((rowsToRender) => <ComparisonTable rows={rowsToRender} />);

  if (!rows || rows.length === 0) {
    return (
      <div className="tr-section">
        <div className="tr-section-header">
          <div className="tr-section-title"><Icon /> {title}</div>
          <span className="tr-section-meta">Nothing recorded for this date</span>
        </div>
        {extraContent}
      </div>
    );
  }

  const failRows = rows.filter((r) => r.status !== 'PASS');
  const passRows = rows.filter((r) => r.status === 'PASS');
  const allPass = failRows.length === 0;

  return (
    <div className="tr-section">
      <button type="button" className="tr-section-header tr-section-header--btn" onClick={() => setExpanded((e) => !e)}>
        <div className="tr-section-title"><Icon /> {title}</div>
        <div className="tr-section-meta">
          <span className={`tr-match-count${allPass ? ' tr-match-count--ok' : ''}`}>
            {passRows.length}/{rows.length} matched
          </span>
          {!allPass && (
            <span className="tr-match-issues">{failRows.length} need{failRows.length === 1 ? 's' : ''} a look</span>
          )}
          {expanded ? <FiChevronUp /> : <FiChevronDown />}
        </div>
      </button>
      {subtitle && <p className="tr-section-sub">{subtitle}</p>}
      {extraContent}

      {failRows.length > 0 && table(failRows)}

      {expanded && passRows.length > 0 && table(allPass ? rows : passRows)}

      {!expanded && (
        <p className="tr-section-collapsed-note">
          {allPass ? 'Click to see the full breakdown.' : `+ ${passRows.length} more that matched — click to show.`}
        </p>
      )}
    </div>
  );
}

/* -- Main page ---------------------------------------------------------- */

export const AdminTillReconciliation = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [selectedDate, setSelectedDate] = useState(() => todayStr());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const loadReconciliation = useCallback(async (dateStr) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/till-reports/reconcile/${dateStr}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Could not load the report check for this date.');
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setData(null);
      setError(e.message || 'Could not load the report check for this date. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  useEffect(() => {
    const run = async () => { await loadReconciliation(selectedDate); };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, user.token]);

  const goPrevDay = () => setSelectedDate((d) => shiftDateStr(d, -1));
  const goNextDay = () => setSelectedDate((d) => shiftDateStr(d, 1));
  const goToday = () => setSelectedDate(todayStr());

  const reportsComplete = !!data && (data.overallStatus === 'RECONCILED' || data.overallStatus === 'EXCEPTION');
  const isToday = selectedDate >= todayStr();

  return (
    <motion.div
      className="tr-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <button className="tr-back-btn" onClick={() => navigate('/admin/dashboard')}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="tr-page-header">
        <h1 className="tr-page-title"><FiBarChart2 /> Till Report Check</h1>
        <p className="tr-page-sub">
          Checks that the day and night shift reports add up to the end-of-day report — department by
          department, penny for penny.
        </p>
      </div>

      <div className="tr-date-picker">
        <button type="button" className="tr-date-nav-btn" onClick={goPrevDay} aria-label="Previous day">
          <FiChevronLeft />
        </button>
        <div className="tr-date-field">
          <FiCalendar />
          <input
            type="date"
            className="tr-date-input"
            value={selectedDate}
            max={todayStr()}
            onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
          />
        </div>
        <button type="button" className="tr-date-nav-btn" onClick={goNextDay} aria-label="Next day" disabled={isToday}>
          <FiChevronRight />
        </button>
        {!isToday && (
          <button type="button" className="tr-today-btn" onClick={goToday}>Today</button>
        )}
        <button
          type="button"
          className="tr-refresh-btn"
          onClick={() => loadReconciliation(selectedDate)}
          disabled={loading}
          aria-label="Refresh"
          title="Refresh"
        >
          <FiRefreshCw className={loading ? 'tr-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="tr-center">
          <div className="tr-spinner" />
          <p>Loading {fmtDateLong(selectedDate)}…</p>
        </div>
      ) : error ? (
        <div className="tr-error-panel" role="alert">
          <FiAlertCircle size={22} />
          <div>
            <p className="tr-error-title">Couldn&rsquo;t load this date</p>
            <p className="tr-error-message">{error}</p>
          </div>
          <button type="button" className="tr-retry-btn" onClick={() => loadReconciliation(selectedDate)}>
            <FiRefreshCw /> Try Again
          </button>
        </div>
      ) : data ? (
        <>
          <div className="tr-date-heading">{fmtDateLong(data.businessDate)}</div>

          <OverallBanner status={data.overallStatus} waitingFor={data.waitingFor} />

          <div className="tr-presence-row">
            <PresenceChip label="Day Report" presence={data.reportPresence.dayX} />
            <PresenceChip label="Night Report" presence={data.reportPresence.nightX} />
            <PresenceChip label="End-of-Day Report" presence={data.reportPresence.z} />
          </div>

          {data.timingExceptionCount > 0 && (
            <div className="tr-timing-note">
              <FiClock />
              <span>
                {data.timingExceptionCount === 1
                  ? 'One report was printed outside its usual time window today — it was still checked normally, see "Worth Knowing" below.'
                  : `${data.timingExceptionCount} reports were printed outside their usual time windows today — they were still checked normally, see "Worth Knowing" below.`}
              </span>
            </div>
          )}

          <ExceptionsPanel exceptions={data.exceptions} />

          {reportsComplete && (
            <>
              <SummaryTiles categories={data.categories} />

              <div className="tr-sections">
                <CategorySection
                  title="Departments"
                  Icon={FiGrid}
                  subtitle="Every department's sales, shift by shift."
                  rows={normalizeDeptRows(data.categories.department.lines)}
                />
                <CategorySection
                  title="VAT"
                  Icon={FiFileText}
                  subtitle="Tax breakdown by VAT rate."
                  rows={normalizeVatRows(data.categories.vat.lines)}
                />
                <CategorySection
                  title="Payment Types"
                  Icon={FiCreditCard}
                  subtitle="Cash, card, manual card and the grand total."
                  rows={normalizeSingleRows([
                    data.categories.tender.cash,
                    data.categories.tender.card,
                    data.categories.tender.manualCard,
                    data.categories.tender.grandTotal,
                  ])}
                />
                <CategorySection
                  title="Transaction Count"
                  Icon={FiBarChart2}
                  rows={normalizeSingleRows([data.categories.transactionCount])}
                />
                <CategorySection
                  title="Income / Expense"
                  Icon={FiTrendingDown}
                  rows={normalizeSingleRows([data.categories.incomeExpense])}
                />
                <CategorySection
                  title="Voided Sales"
                  Icon={FiTrash2}
                  subtitle="Every void/refund recorded on the shift reports, matched against the final report."
                  rows={normalizeVoidRows(data.categories.void.tuples)}
                  renderTable={(rows) => <VoidTable rows={rows} />}
                />
                <CategorySection
                  title="Products Sold"
                  Icon={FiPackage}
                  subtitle="Quantity sold per product, shift by shift."
                  rows={normalizeProductRows(data.categories.product.lines)}
                  extraContent={
                    data.categories.product.nearDuplicateWarnings.length > 0 && (
                      <div className="tr-note-box">
                        <FiInfo />
                        <div>
                          <strong>Possible duplicate product names</strong>
                          <ul>
                            {data.categories.product.nearDuplicateWarnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      </div>
                    )
                  }
                />
              </div>
            </>
          )}
        </>
      ) : null}
    </motion.div>
  );
};

export default AdminTillReconciliation;
