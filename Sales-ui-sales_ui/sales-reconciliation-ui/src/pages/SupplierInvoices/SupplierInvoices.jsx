import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { ReportHeader } from './components/ReportHeader';
import { KPISection } from './components/KPISection';
import { ReportToolbar } from './components/ReportToolbar';
import { SupplierCard } from './components/SupplierCard';
import { DateCard } from './components/DateCard';
import { SummaryPanel } from './components/SummaryPanel';
import { EmptyState } from './components/EmptyState';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { useSupplierPayoutData } from './hooks/useSupplierPayoutData';
import { fmtDateMed, fmtTime, todayStr, daysAgoStr, groupInvoices, sumValue } from './utils';
import './SupplierInvoices.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

export const SupplierInvoices = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast: notify } = useToast();
  const showToast = useCallback((message, type = 'error') => notify(message, type), [notify]);

  const backPath = user?.role === 'admin' ? '/admin/dashboard' : '/dashboard';

  // Range defaults to the trailing 30 days so the dashboard opens with real
  // data to show rather than an empty single-day view.
  const [startDate, setStartDate] = useState(daysAgoStr(29));
  const [endDate, setEndDate] = useState(todayStr());
  const [appliedRange, setAppliedRange] = useState({ from: daysAgoStr(29), to: todayStr() });
  const [rangeError, setRangeError] = useState('');
  const [tab, setTab] = useState('supplier');
  const [search, setSearch] = useState('');
  const [expandedSuppliers, setExpandedSuppliers] = useState(new Set());
  const [expandedDates, setExpandedDates] = useState(new Set());
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  const { invoices, loading, error, lastUpdated } = useSupplierPayoutData({
    token: user?.token,
    fromDate: appliedRange.from,
    toDate: appliedRange.to,
  });

  useEffect(() => {
    if (error) showToast(error);
  }, [error, showToast]);

  const handleApplyRange = useCallback(() => {
    if (startDate && endDate && startDate > endDate) {
      setRangeError('End date cannot be earlier than start date.');
      return;
    }
    setRangeError('');
    setAppliedRange({ from: startDate, to: endDate });
    // A fresh range means the previous expand/collapse state no longer maps
    // to anything meaningful — start the new report collapsed.
    setExpandedSuppliers(new Set());
    setExpandedDates(new Set());
  }, [startDate, endDate]);

  const rangeLabel = `${fmtDateMed(appliedRange.from)} – ${fmtDateMed(appliedRange.to)}`;

  const kpis = useMemo(() => {
    const supplierSet = new Set(invoices.map((i) => i.supplierName || 'Unknown Supplier'));
    const grandTotal = sumValue(invoices);
    return {
      totalSuppliers: supplierSet.size,
      totalInvoices: invoices.length,
      grandTotal,
      avgInvoice: invoices.length ? grandTotal / invoices.length : 0,
    };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return invoices;
    return invoices.filter((inv) =>
      (inv.supplierName || '').toLowerCase().includes(term) ||
      String(inv.invoiceNo || '').toLowerCase().includes(term) ||
      (inv.enteredBy || '').toLowerCase().includes(term)
    );
  }, [invoices, search]);

  const supplierGroups = useMemo(() => {
    const map = groupInvoices(filteredInvoices, (i) => i.supplierName || 'Unknown Supplier');
    return Array.from(map.entries())
      .map(([name, rows]) => ({ key: name, name, invoices: rows, count: rows.length, total: sumValue(rows) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredInvoices]);

  const dateGroups = useMemo(() => {
    const map = groupInvoices(filteredInvoices, (i) => i.date);
    return Array.from(map.entries())
      .map(([date, rows]) => ({ key: date, date, invoices: rows, count: rows.length, total: sumValue(rows) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredInvoices]);

  const activeGroups = tab === 'date' ? dateGroups : supplierGroups;
  const expandedSet = tab === 'date' ? expandedDates : expandedSuppliers;
  const setExpandedSet = tab === 'date' ? setExpandedDates : setExpandedSuppliers;

  const toggleExpanded = useCallback((key) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, [setExpandedSet]);

  const downloadBlob = async (url, fallbackFileName) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${user.token}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Download failed.');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const fileName = match ? match[1] : fallbackFileName;

    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const params = new URLSearchParams({ fromDate: appliedRange.from, toDate: appliedRange.to, groupBy: tab });
      await downloadBlob(
        `${API_BASE}/suppliers/invoices/download-pdf?${params.toString()}`,
        `supplier-payout-${appliedRange.from}-to-${appliedRange.to}.pdf`,
      );
    } catch (e) {
      showToast(e.message);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadExcel = async () => {
    setDownloadingExcel(true);
    try {
      const params = new URLSearchParams({ fromDate: appliedRange.from, toDate: appliedRange.to, groupBy: tab });
      await downloadBlob(
        `${API_BASE}/suppliers/invoices/download-excel?${params.toString()}`,
        `supplier-payout-${appliedRange.from}-to-${appliedRange.to}.xlsx`,
      );
    } catch (e) {
      showToast(e.message);
    } finally {
      setDownloadingExcel(false);
    }
  };

  // Collapsed cards unmount their body entirely, so a printed page would be
  // missing data unless everything is expanded first.
  const handlePrint = () => {
    setExpandedSet(new Set(activeGroups.map((g) => g.key)));
    requestAnimationFrame(() => window.print());
  };

  const emptyVariant = invoices.length === 0 ? 'noInvoices' : 'noSearchResults';

  return (
    <motion.div
      className="sp-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="sp-container">
        <ReportHeader
          onBack={() => navigate(backPath)}
          rangeLabel={rangeLabel}
          lastUpdated={lastUpdated ? fmtTime(lastUpdated) : null}
        />

        <KPISection kpis={kpis} loading={loading} />

        <ReportToolbar
          tab={tab}
          onTabChange={setTab}
          startDate={startDate}
          endDate={endDate}
          onStartChange={setStartDate}
          onEndChange={setEndDate}
          onApply={handleApplyRange}
          rangeError={rangeError}
          search={search}
          onSearchChange={setSearch}
          onDownloadPdf={handleDownloadPdf}
          onDownloadExcel={handleDownloadExcel}
          onPrint={handlePrint}
          downloadingPdf={downloadingPdf}
          downloadingExcel={downloadingExcel}
          loading={loading}
        />

        <div className="sp-content">
          {loading ? (
            <LoadingSkeleton variant="cards" count={4} />
          ) : activeGroups.length === 0 ? (
            <EmptyState variant={emptyVariant} />
          ) : (
            <div className="sp-card-list">
              {activeGroups.map((group) => (
                tab === 'date' ? (
                  <DateCard
                    key={group.key}
                    group={group}
                    expanded={expandedSet.has(group.key)}
                    onToggle={() => toggleExpanded(group.key)}
                  />
                ) : (
                  <SupplierCard
                    key={group.key}
                    group={group}
                    expanded={expandedSet.has(group.key)}
                    onToggle={() => toggleExpanded(group.key)}
                  />
                )
              ))}
            </div>
          )}
        </div>
      </div>

      <SummaryPanel
        totalSuppliers={kpis.totalSuppliers}
        totalInvoices={kpis.totalInvoices}
        grandTotal={kpis.grandTotal}
        lastUpdated={lastUpdated ? fmtTime(lastUpdated) : null}
      />
    </motion.div>
  );
};
