import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchDay } from '../api';

// Powers the Details Drawer — fetches the full editable record for whichever
// date is currently open. Set `date` to null to close/clear.
export function useRecordDetail({ token, date }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async (forDate) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const data = await fetchDay(token, forDate);
      if (id === requestId.current) setDetail(data);
    } catch {
      if (id === requestId.current) setError('Failed to load this record.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const run = async () => {
      if (!date || !token) {
        setDetail(null);
        return;
      }
      await load(date);
    };
    run();
  }, [date, token, load]);

  const reload = useCallback(() => {
    if (date) load(date);
  }, [date, load]);

  return { detail, loading, error, reload };
}
