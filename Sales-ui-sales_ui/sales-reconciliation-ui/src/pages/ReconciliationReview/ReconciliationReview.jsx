import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiArrowLeft, FiClipboard, FiFileText, FiChevronRight } from 'react-icons/fi';
import { ReconciliationPortal } from '../../components/ReconciliationPortal/ReconciliationPortal';
import './ReconciliationReview.css';

// User-facing hub: Dashboard → Reconciliation Review → Download Bill →
// Sales Reconciliation. This page shows yesterday's reconciliation status
// at a glance (ReconciliationPortal, previously built but unrouted) and
// hands off to Download Bill for viewing/downloading the full report
// history.
export const ReconciliationReview = () => {
  const navigate = useNavigate();

  return (
    <motion.div
      className="rr-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="rr-container">
        <button className="rr-back" onClick={() => navigate('/dashboard')}>
          <FiArrowLeft /> Back to Dashboard
        </button>

        <h1 className="rr-title"><FiClipboard className="rr-title-icon" /> Reconciliation Review</h1>
        <p className="rr-subtitle">
          Check yesterday's reconciliation status, or go to Download Bill to view and download
          committed Sales Reconciliation reports.
        </p>

        <ReconciliationPortal />

        <button className="rr-nav-card" onClick={() => navigate('/reconciliation-review/download-bill')}>
          <span className="rr-nav-card-icon"><FiFileText /></span>
          <span className="rr-nav-card-body">
            <span className="rr-nav-card-title">Download Bill</span>
            <span className="rr-nav-card-desc">View and download your committed Sales Reconciliation reports</span>
          </span>
          <FiChevronRight className="rr-nav-card-arrow" />
        </button>
      </div>
    </motion.div>
  );
};
