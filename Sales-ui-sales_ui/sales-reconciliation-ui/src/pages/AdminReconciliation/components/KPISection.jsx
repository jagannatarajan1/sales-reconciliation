import {
  FiFileText, FiAlertCircle, FiCheckCircle, FiTrendingUp, FiCalendar, FiDollarSign,
} from 'react-icons/fi';
import { fmtGBP } from '../utils';
import { LoadingSkeleton } from './LoadingSkeleton';

export function KPISection({ kpis, loading }) {
  if (loading) return <LoadingSkeleton variant="kpi" />;

  const cards = [
    { key: 'total', icon: <FiFileText />, label: 'Total Reports', value: kpis.totalReports },
    { key: 'pending', icon: <FiAlertCircle />, label: 'Pending Review', value: kpis.pendingReview, tone: kpis.pendingReview > 0 ? 'danger' : undefined },
    { key: 'matched', icon: <FiCheckCircle />, label: 'Matched', value: kpis.matched, tone: 'success' },
    { key: 'variance', icon: <FiTrendingUp />, label: 'Variance Found', value: kpis.varianceFound },
    { key: 'today', icon: <FiCalendar />, label: 'Completed Today', value: kpis.completedToday },
    { key: 'amount', icon: <FiDollarSign />, label: 'Total Variance Amount', value: fmtGBP(kpis.totalVarianceAmount), primary: true },
  ];

  return (
    <div className="rc-kpi-grid">
      {cards.map((c) => (
        <div
          key={c.key}
          className={`rc-kpi-card${c.primary ? ' rc-kpi-card--primary' : ''}${c.tone ? ` rc-kpi-card--${c.tone}` : ''}`}
        >
          <span className="rc-kpi-icon">{c.icon}</span>
          <div className="rc-kpi-text">
            <span className="rc-kpi-label">{c.label}</span>
            <span className="rc-kpi-value">{c.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
