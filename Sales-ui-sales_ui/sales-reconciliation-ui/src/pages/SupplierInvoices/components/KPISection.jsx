import { FiBriefcase, FiFileText, FiDollarSign, FiTrendingUp } from 'react-icons/fi';
import { fmtGBP } from '../utils';
import { LoadingSkeleton } from './LoadingSkeleton';

export function KPISection({ kpis, loading }) {
  if (loading) return <LoadingSkeleton variant="kpi" />;

  const cards = [
    { key: 'suppliers', icon: <FiBriefcase />, label: 'Total Suppliers', value: kpis.totalSuppliers },
    { key: 'invoices', icon: <FiFileText />, label: 'Total Invoices', value: kpis.totalInvoices },
    { key: 'total', icon: <FiDollarSign />, label: 'Grand Total', value: fmtGBP(kpis.grandTotal), primary: true },
    { key: 'avg', icon: <FiTrendingUp />, label: 'Average Invoice', value: fmtGBP(kpis.avgInvoice) },
  ];

  return (
    <div className="sp-kpi-grid">
      {cards.map((c) => (
        <div key={c.key} className={`sp-kpi-card${c.primary ? ' sp-kpi-card--primary' : ''}`}>
          <span className="sp-kpi-icon">{c.icon}</span>
          <div className="sp-kpi-text">
            <span className="sp-kpi-label">{c.label}</span>
            <span className="sp-kpi-value">{c.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
