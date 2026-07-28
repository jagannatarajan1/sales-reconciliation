import { useNavigate } from 'react-router-dom';
import '../styles/Auth.css';

export const Register = () => {
  const navigate = useNavigate();

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>Registration Restricted</h1>
          <p>Account creation is managed by administrators only</p>
        </div>

        <div style={{ textAlign: 'center', padding: '20px 0', color: '#555', lineHeight: 1.7 }}>
          <p>New accounts can only be created by an admin.</p>
          <p>Please contact your system administrator to get access.</p>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => navigate('/login')}
          style={{ marginTop: '10px' }}
        >
          Back to Login
        </button>
      </div>
    </div>
  );
};
