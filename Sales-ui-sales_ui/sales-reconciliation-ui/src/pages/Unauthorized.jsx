import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiShieldOff, FiArrowLeft } from 'react-icons/fi';
import { Button } from '../components/ui/Button';
import '../styles/AuthNotice.css';

export const Unauthorized = () => {
  const navigate = useNavigate();

  return (
    <motion.div
      className="notice-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="notice-card">
        <div className="notice-icon-wrap notice-icon-wrap--danger">
          <FiShieldOff />
        </div>
        <h1 className="notice-title">Access Denied</h1>
        <p className="notice-subtitle">Unauthorized</p>

        <div className="notice-body">
          <p>You don&#39;t have permission to access this page.</p>
          <p>Please login with the appropriate role to access this resource.</p>
        </div>

        <div className="notice-footer">
          <Button variant="primary" icon={<FiArrowLeft />} onClick={() => navigate('/login')}>
            Back to Login
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
