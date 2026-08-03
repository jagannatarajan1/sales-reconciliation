import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Role hierarchy: admin > user. A route requiring "user" is satisfied by
// any authenticated role.
const ROLE_RANK = { user: 1, admin: 2 };

const meetsRole = (userRole, requiredRole) => {
  if (!requiredRole) return true;
  const userRank = ROLE_RANK[userRole] ?? 0;
  const requiredRank = ROLE_RANK[requiredRole] ?? 0;
  return userRank >= requiredRank;
};

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

  if (!meetsRole(user.role, requiredRole)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (!meetsPermission(user, requiredPermission)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};
