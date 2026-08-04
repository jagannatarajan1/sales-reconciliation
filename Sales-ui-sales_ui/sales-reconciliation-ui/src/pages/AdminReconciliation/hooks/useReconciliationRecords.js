import { useState, useEffect, useCallback, useRef } from 'react';
import { RECONCILIATION_URL } from '../utils';

const EMPTY_KPIS = {
  totalReports: 0, pendingReview: 0, matched: 0, varianceFound: 0, completedToday: 0, totalVarianceAmount: 0,
};

// Backs the table + KPI cards. All filtering, sorting and pagination happen
// server-side (GET /admin/reconciliation/records) — this hook just tracks
// the request params and the last response, with a request-id guard so a
// slow, stale request can't clobber a faster, newer one.
export function useReconciliationRecords({ token, filters, sort, page, pageSize }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState(EMPTY_KPIS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filters.fromDate) params.set('fromDate', filters.fromDate);
      if (filters.toDate) params.set('toDate', filters.toDate);
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.variance && filters.variance !== 'all') params.set('variance', filters.variance);
      if (filters.search) params.set('search', filters.search);
      params.set('sortBy', sort.sortBy);
      params.set('sortDir', sort.sortDir);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await fetch(`${RECONCILIATION_URL}/records?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setKpis(data.kpis ?? EMPTY_KPIS);
      setLastUpdated(new Date());
    } catch {
      if (id === requestId.current) {
        setError('Failed to load reconciliation records.');
        setItems([]);
        setTotal(0);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [
    token, filters.fromDate, filters.toDate, filters.status, filters.variance, filters.search,
    sort.sortBy, sort.sortDir, page, pageSize,
  ]);

  useEffect(() => {
    const run = async () => { await load(); };
    run();
  }, [load]);

  return { items, total, kpis, loading, error, lastUpdated, reload: load };
}
