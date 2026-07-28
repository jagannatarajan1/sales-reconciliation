import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiUserPlus, FiArrowLeft } from 'react-icons/fi';
import { Button } from '../components/ui/Button';
import '../styles/AuthNotice.css';

export const Register = () => {
  const navigate = useNavigate();

  return (
    <motion.div
      className="notice-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="notice-card">
        <div className="notice-icon-wrap">
          <FiUserPlus />
        </div>
        <h1 className="notice-title">Registration Restricted</h1>
        <p className="notice-subtitle">Account creation is managed by administrators only</p>

        <div className="notice-body">
          <p>New accounts can only be created by an admin.</p>
          <p>Please contact your system administrator to get access.</p>
        </div>

        <Button variant="primary" icon={<FiArrowLeft />} onClick={() => navigate('/login')}>
          Back to Login
        </Button>
      </div>
    </motion.div>
  );
};
