import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ui/Toast';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminRegister } from './pages/AdminRegister';
import { AdminChangePassword } from './pages/AdminChangePassword';
import { Unauthorized } from './pages/Unauthorized';
import { Dashboard } from './pages/Dashboard';
import ShopSale from './pages/ShopSale/ShopSale';
import { CreditCardBanking } from './pages/CreditCardBanking/CreditCardBanking';
import { CashBanking } from './pages/CashBanking/CashBanking';
import { Deductions } from './pages/Deductions/Deductions';
import { InstantLotteryInventory } from './pages/InstantLotteryInventory/InstantLotteryInventory';
import { Lottery } from './pages/Lottery/Lottery';
import { Summary } from './pages/Summary/Summary';
import { Paypoint } from './pages/Paypoint/Paypoint';
import { Commit } from './pages/Commit';
import { AdminReconciliation } from './pages/AdminReconciliation/AdminReconciliation';
import { Reports } from './pages/Reports/Reports';
import { AdminSuppliers } from './pages/AdminSuppliers/AdminSuppliers';
import { SupplierInvoices } from './pages/SupplierInvoices/SupplierInvoices';
import { ScratchCards } from './pages/ScratchCards/ScratchCards';
import { AdminResetCommitDate } from './pages/AdminResetCommitDate/AdminResetCommitDate';
import './App.css';

function App() {
  return (
    <Router>
      <AuthProvider>
      <ToastProvider>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          {/* Protected User Routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requiredRole="user">
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Protected User Sub-Routes */}
          <Route
            path="/shop-sale"
            element={
              <ProtectedRoute requiredRole="user">
                <ShopSale />
              </ProtectedRoute>
            }
          />
          <Route
            path="/credit-card-banking"
            element={
              <ProtectedRoute requiredRole="user">
                <CreditCardBanking />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cash-banking"
            element={
              <ProtectedRoute requiredRole="user">
                <CashBanking />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deductions"
            element={
              <ProtectedRoute requiredRole="user">
                <Deductions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/instant-lottery-inventory"
            element={
              <ProtectedRoute requiredRole="user">
                <InstantLotteryInventory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lottery"
            element={
              <ProtectedRoute requiredRole="user">
                <Lottery />
              </ProtectedRoute>
            }
          />
          <Route
            path="/summary"
            element={
              <ProtectedRoute requiredRole="user">
                <Summary />
              </ProtectedRoute>
            }
          />
          <Route
            path="/Paypoint"
            element={
              <ProtectedRoute requiredRole="user">
                <Paypoint />
              </ProtectedRoute>
            }
          />
          <Route
            path="/commit"
            element={
              <ProtectedRoute requiredRole="user">
                <Commit />
              </ProtectedRoute>
            }
          />

          {/* Protected Admin Routes */}
          <Route
            path="/admin/reports"
            element={
              <ProtectedRoute requiredRole="admin">
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reconciliation"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminReconciliation />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/register"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminRegister />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/change-password"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminChangePassword />
              </ProtectedRoute>
            }
          />

          {/* Supplier Invoices — staff route (also navigable from admin dashboard) */}
          <Route
            path="/supplier-invoices"
            element={
              <ProtectedRoute requiredRole="user">
                <SupplierInvoices />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/suppliers"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminSuppliers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/supplier-invoices"
            element={
              <ProtectedRoute requiredRole="admin">
                <SupplierInvoices />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/scratch-cards"
            element={
              <ProtectedRoute requiredRole="admin">
                <ScratchCards />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reset-commit-date"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminResetCommitDate />
              </ProtectedRoute>
            }
          />

          {/* Default Route */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ToastProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
