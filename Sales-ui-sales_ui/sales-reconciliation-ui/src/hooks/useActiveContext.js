import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

// Thin wrapper around GET /Summary/today for pages that only need the
// active date/shift/commit-lock context, not the full daily-entry payload
// (those pages already fetch /Summary/today themselves and read the same
// fields directly off their existing response — see ShiftBanner's usage in
// CashBanking.jsx etc. for that pattern instead of this hook).
export const useActiveContext = () => {
  const { user } = useAuth();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/Summary/today`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error('Failed to load active date/shift');
      const data = await res.json();
      setContext({
        date: data.date ?? null,
        shift: data.shift ?? null,
        shiftLabel: data.shiftLabel ?? null,
        shiftSource: data.shiftSource ?? null,
        shiftCutoff: data.shiftCutoff ?? null,
        shiftReportTotal: data.shiftReportTotal ?? null,
        shiftReportCount: data.shiftReportCount ?? 0,
        isCommitted: data.isCommitted ?? false,
        isPendingAdminReview: data.isPendingAdminReview ?? false,
      });
    } catch (err) {
      setError(err.message || 'Failed to load active date/shift');
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  useEffect(() => {
    const run = async () => { await refresh(); };
    run();
  }, [refresh]);

  return { ...context, loading, error, refresh };
};
