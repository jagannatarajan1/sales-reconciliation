import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export const UserDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="dashboard-container">
      <nav className="navbar">
        <div className="navbar-brand">
          <h2>Sales Reconciliation - User Dashboard</h2>
        </div>
        <div className="navbar-menu">
          <span className="user-info">Welcome, {user?.email}</span>
          <button onClick={handleLogout} className="btn btn-danger">
            Logout
          </button>
        </div>
      </nav>

      <div className="dashboard-content">
        <div className="welcome-section">
          <h1>Welcome to Your Dashboard</h1>
          <p>Hello, {user?.name || user?.email}!</p>
          <p>You are logged in as a <strong>{user?.role}</strong></p>
        </div>

        <div className="dashboard-grid">
          <div className="card">
            <h3>My Orders</h3>
            <p>View and track your orders</p>
            <button className="btn btn-secondary">View Orders</button>
          </div>

          <div className="card">
            <h3>My Profile</h3>
            <p>Manage your account details</p>
            <button className="btn btn-secondary">Edit Profile</button>
          </div>

          <div className="card">
            <h3>Sales History</h3>
            <p>View your sales reconciliation history</p>
            <button className="btn btn-secondary">View History</button>
          </div>

          <div className="card">
            <h3>Reports</h3>
            <p>Generate and download reports</p>
            <button className="btn btn-secondary">Generate Report</button>
          </div>
        </div>
      </div>
    </div>
  );
};
