import { useState, useEffect } from 'react';
import { FiX, FiDownload, FiMail } from 'react-icons/fi';
import { fetchZReport } from '../api';
import { fmtDateLong, fmtDateTime } from '../utils';
import { EmptyState } from './EmptyState';

// This system only ever has one real document per date — the Z-Report
// email and the bill generated from it — not a set of uploaded scans, so
// there's nothing to zoom, rotate, or page through. This shows what
// actually exists rather than building chrome around content that isn't
// there.
export function DocumentViewer({ date, token, onClose, onDownloadBill }) {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!date) return;
    const run = async () => {
      setLoading(true);
      setError('');
      setEmail(null);
      try {
        const data = await fetchZReport(token, date);
        setEmail(data);
      } catch {
        setError('No Z-Report email found for this date.');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [date, token]);

  if (!date) return null;

  return (
    <div className="rc-modal-overlay rc-no-print" onClick={onClose}>
      <div className="rc-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Documents">
        <div className="rc-modal-header">
          <h2 className="rc-modal-title"><FiMail aria-hidden="true" /> {fmtDateLong(date)}</h2>
          <button type="button" className="rc-icon-btn" onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div className="rc-modal-body">
          {loading ? (
            <div className="rc-center"><div className="rc-spinner" /><p>Loading Z-Report…</p></div>
          ) : error ? (
            <EmptyState variant="noDocuments" />
          ) : email ? (
            <>
              {email.receivedAt && <p className="rc-muted">Received {fmtDateTime(email.receivedAt)}</p>}
              <pre className="rc-doc-body">{email.body}</pre>
            </>
          ) : null}
        </div>

        <div className="rc-modal-footer">
          <button type="button" className="rc-btn rc-btn--secondary" onClick={() => onDownloadBill(date)}>
            <FiDownload /> Download Bill (PDF)
          </button>
          <button type="button" className="rc-btn rc-btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
