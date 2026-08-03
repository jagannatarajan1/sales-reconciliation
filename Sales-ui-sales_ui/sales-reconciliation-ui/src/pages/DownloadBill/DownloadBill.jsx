import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiArrowLeft, FiFileText, FiChevronRight } from 'react-icons/fi';
import './DownloadBill.css';

// Middle step of Dashboard → Reconciliation Review → Download Bill →
// Sales Reconciliation. Sales Reconciliation is currently the only report
// under Download Bill; this stays a distinct step (rather than folding
// straight into Sales Reconciliation) so the menu structure has somewhere
// to grow if another downloadable report is added later.
export const DownloadBill = () => {
  const navigate = useNavigate();

  return (
    <motion.div
      className="db-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="db-container">
        <button className="db-back" onClick={() => navigate('/reconciliation-review')}>
          <FiArrowLeft /> Back to Reconciliation Review
        </button>

        <p className="db-breadcrumb">Reconciliation Review / Download Bill</p>
        <h1 className="db-title"><FiFileText className="db-title-icon" /> Download Bill</h1>
        <p className="db-subtitle">
          Choose a report to view or download.
        </p>

        <button
          className="db-nav-card"
          onClick={() => navigate('/reconciliation-review/download-bill/sales-reconciliation')}
        >
          <span className="db-nav-card-icon"><FiFileText /></span>
          <span className="db-nav-card-body">
            <span className="db-nav-card-title">Sales Reconciliation</span>
            <span className="db-nav-card-desc">
              View committed reconciliation reports, filter by date, and download as PDF or Excel
            </span>
          </span>
          <FiChevronRight className="db-nav-card-arrow" />
        </button>
      </div>
    </motion.div>
  );
};
