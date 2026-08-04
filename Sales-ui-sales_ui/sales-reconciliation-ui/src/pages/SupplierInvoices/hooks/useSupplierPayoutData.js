import { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

// Range-scoped invoice fetch backing the Payout Report. A monotonically
// increasing request id guards against an in-flight request for a stale
// range overwriting the result of a range change that happened after it.
export function useSupplierPayoutData({ token, fromDate, toDate }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!token || !fromDate || !toDate) return;

    const run = async () => {
      const id = ++requestId.current;
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ fromDate, toDate });
        const res = await fetch(`${API_BASE}/suppliers/invoices?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (id !== requestId.current) return;

        if (res.status === 404) {
          setInvoices([]);
        } else if (!res.ok) {
          throw new Error();
        } else {
          setInvoices(await res.json());
        }
        setLastUpdated(new Date());
      } catch {
        if (id === requestId.current) {
          setError('Failed to load the supplier payout report for this range.');
          setInvoices([]);
        }
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    };

    run();
  }, [token, fromDate, toDate]);

  return { invoices, loading, error, lastUpdated };
}
