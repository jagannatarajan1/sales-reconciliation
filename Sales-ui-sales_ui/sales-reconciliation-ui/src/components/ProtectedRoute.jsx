import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DASHBOARD_BY_ROLE = { admin: '/admin/dashboard', user: '/dashboard' };

// Mirrors the backend's hasPermission(): admin passes only if the module key
// is in their permissions array, user never passes an admin-module
// permission check.
const meetsPermission = (user, requiredPermission) => {
  if (!requiredPermission) return true;
  if (user.role === 'admin') return (user.permissions ?? []).includes(requiredPermission);
  return false;
};

export const ProtectedRoute = ({ children, requiredRole = null, requiredPermission = null }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Exact match only — an admin session is never treated as satisfying a
  // "user" route (or vice versa). Since the two applications are otherwise
  // completely separate, an authenticated-but-wrong-role visitor is sent to
  // *their own* dashboard rather than a dead-end page.
  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to={DASHBOARD_BY_ROLE[user.role] ?? '/unauthorized'} replace />;
  }

  if (!meetsPermission(user, requiredPermission)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};
