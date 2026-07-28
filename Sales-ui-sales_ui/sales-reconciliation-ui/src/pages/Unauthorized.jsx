import { Link } from 'react-router-dom';
import '../styles/Auth.css';

export const Unauthorized = () => {
  return (
    <div className="auth-container">
      <div className="auth-card error-card">
        <div className="auth-header">
          <h1>Access Denied</h1>
          <p>Unauthorized</p>
        </div>

        <div className="error-content">
          <p>You don't have permission to access this page.</p>
          <p>Please login with the appropriate role to access this resource.</p>
        </div>

        <div className="auth-footer">
          <Link to="/login" className="btn btn-primary">
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
};
