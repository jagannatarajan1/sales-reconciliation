import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { ReconciliationHeader } from './components/ReconciliationHeader';
import { KPISection } from './components/KPISection';
import { FilterToolbar } from './components/FilterToolbar';
import { ReconciliationTable } from './components/ReconciliationTable';
import { Pagination } from './components/Pagination';
import { DetailsDrawer } from './components/DetailsDrawer';
import { DocumentViewer } from './components/DocumentViewer';
import { SummaryPanel } from './components/SummaryPanel';
import { EmptyState } from './components/EmptyState';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { useReconciliationRecords } from './hooks/useReconciliationRecords';
import { fetchDay, submitRecord, bulkApprove, downloadBillPdf } from './api';
import { API_BASE, daysAgoStr, todayStr, downloadBlob } from './utils';
import './AdminReconciliation.css';

const PAGE_SIZE = 25;

const DEFAULT_FILTERS = {
  fromDate: daysAgoStr(89),
  toDate: todayStr(),
  status: 'all',
  variance: 'all',
  search: '',
};

export const AdminReconciliation = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast: notify } = useToast();
  const showToast = useCallback((message, type = 'success') => notify(message, type), [notify]);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState({ sortBy: 'date', sortDir: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Map());
  const [drawerDate, setDrawerDate] = useState(null);
  const [documentsDate, setDocumentsDate] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);

  // Debounce free-text search so every keystroke doesn't fire a request.
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput }));
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const { items, total, kpis, loading, error, lastUpdated, reload } = useReconciliationRecords({
    token: user?.token, filters, sort, page, pageSize: PAGE_SIZE,
  });

  useEffect(() => {
    if (error) showToast(error, 'error');
  }, [error, showToast]);

  const handleFilterChange = (key, value) => {
    if (key === 'search') { setSearchInput(value); return; }
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchInput('');
    setPage(1);
  };

  const handleSortChange = (key) => {
    setSort((prev) => (prev.sortBy === key ? { sortBy: key, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc' } : { sortBy: key, sortDir: 'desc' }));
  };

  const handleToggleSelect = (date) => {
    const row = items.find((r) => r.date === date);
    if (!row) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(date)) next.delete(date); else next.set(date, row);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    const selectable = items.filter((r) => r.status !== 'uncommitted');
    const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.date));
    setSelected((prev) => {
      const next = new Map(prev);
      if (allSelected) {
        selectable.forEach((r) => next.delete(r.date));
      } else {
        selectable.forEach((r) => next.set(r.date, r));
      }
      return next;
    });
  };

  const handleQuickApprove = async (date) => {
    try {
      const detail = await fetchDay(user.token, date);
      await submitRecord(user.token, {
        date,
        manualCardAmount: detail.manualCardAmount, cardAmount: detail.cardAmount,
        lastSafe: detail.lastSafe, safeDropAmount: detail.safeDropAmount,
        cashback: detail.cashback, paypointPayout: detail.paypointPayout,
        instantLotteryPayout: detail.instantLotteryPayout, lotteryPayout: detail.lotteryPayout,
        newsVoucher: detail.newsVoucher, ddPoint: detail.ddPoint,
        supplierInvoicesTotal: detail.supplierInvoicesTotal,
        lotteryValue: detail.lotteryValue, paypointValue: detail.paypointValue,
        summaryTotal: detail.summaryTotal, zReportTotal: detail.zReportTotal,
        difference: detail.difference, adminNotes: detail.adminNotes || '',
      });
      showToast(`${date} approved`);
      reload();
    } catch {
      showToast('Failed to approve this record', 'error');
    }
  };

  const handleApproveSelected = async () => {
    const dates = Array.from(selected.values())
      .filter((r) => r.status === 'needs_review' || r.status === 'auto_matched')
      .map((r) => r.date);
    if (dates.length === 0) return;
    setBulkApproving(true);
    try {
      const result = await bulkApprove(user.token, dates);
      showToast(`Approved ${result.approved} record${result.approved === 1 ? '' : 's'}`);
      setSelected(new Map());
      reload();
    } catch {
      showToast('Failed to approve selected records', 'error');
    } finally {
      setBulkApproving(false);
    }
  };

  const handleDownloadBill = async (date) => {
    try {
      const blob = await downloadBillPdf(user.token, date);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `reconciliation-report-${date}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showToast('Download started');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const params = new URLSearchParams({ startDate: filters.fromDate, endDate: filters.toDate });
      await downloadBlob(`${API_BASE}/admin/reports/download-pdf?${params}`, user.token, `reconciliation-reports-${filters.fromDate}-to-${filters.toDate}.pdf`);
      showToast('Download started');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadExcel = async () => {
    setDownloadingExcel(true);
    try {
      const params = new URLSearchParams({ startDate: filters.fromDate, endDate: filters.toDate });
      await downloadBlob(`${API_BASE}/admin/reports/download-excel?${params}`, user.token, `sales-reconciliation-${filters.fromDate}-to-${filters.toDate}.xlsx`);
      showToast('Download started');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDownloadingExcel(false);
    }
  };

  // Exports the date span covering the current selection (the export
  // endpoints take a date range, not an arbitrary list of dates) — exact
  // for a contiguous selection, a superset for a scattered one.
  const handleExportSelected = async () => {
    const dates = Array.from(selected.keys()).sort();
    if (dates.length === 0) return;
    const from = dates[0];
    const to = dates[dates.length - 1];
    try {
      const params = new URLSearchParams({ startDate: from, endDate: to });
      await downloadBlob(`${API_BASE}/admin/reports/download-pdf?${params}`, user.token, `reconciliation-reports-${from}-to-${to}.pdf`);
      showToast('Download started');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handlePrint = () => window.print();

  const selectedRows = useMemo(() => Array.from(selected.values()), [selected]);

  return (
    <motion.div
      className="rc-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="rc-container">
        <ReconciliationHeader
          onBack={() => navigate('/admin/dashboard')}
          onRefresh={reload}
          refreshing={loading}
          lastUpdated={lastUpdated}
        />

        <KPISection kpis={kpis} loading={loading && items.length === 0} />

        <FilterToolbar
          filters={{ ...filters, search: searchInput }}
          onFilterChange={handleFilterChange}
          onReset={handleReset}
          onDownloadPdf={handleDownloadPdf}
          onDownloadExcel={handleDownloadExcel}
          onPrint={handlePrint}
          downloadingPdf={downloadingPdf}
          downloadingExcel={downloadingExcel}
          loading={loading}
        />

        {loading ? (
          <LoadingSkeleton variant="rows" count={10} />
        ) : items.length === 0 ? (
          <EmptyState variant={filters.search ? 'noSearchResults' : 'noRecords'} />
        ) : (
          <>
            <ReconciliationTable
              items={items}
              selected={selected}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onRowClick={setDrawerDate}
              sort={sort}
              onSortChange={handleSortChange}
              search={filters.search}
              onView={setDrawerDate}
              onApprove={handleQuickApprove}
              onDownloadBill={handleDownloadBill}
              onViewDocuments={setDocumentsDate}
            />
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </div>

      <DetailsDrawer
        date={drawerDate}
        token={user?.token}
        onClose={() => setDrawerDate(null)}
        onSaved={reload}
        onDownloadBill={handleDownloadBill}
        onViewDocuments={setDocumentsDate}
        showToast={showToast}
      />

      <DocumentViewer
        date={documentsDate}
        token={user?.token}
        onClose={() => setDocumentsDate(null)}
        onDownloadBill={handleDownloadBill}
      />

      <SummaryPanel
        selectedRows={selectedRows}
        onApproveSelected={handleApproveSelected}
        onExportSelected={handleExportSelected}
        onClear={() => setSelected(new Map())}
        approving={bulkApproving}
      />
    </motion.div>
  );
};

export default AdminReconciliation;
