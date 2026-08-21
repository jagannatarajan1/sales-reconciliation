import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiCamera, FiFilter, FiImage, FiTrash2, FiX,
  FiChevronLeft, FiChevronRight, FiRefreshCw, FiUser, FiClock,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SHIFT_LABELS } from '../../constants/photoSections';
import './AdminSessionPhotos.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';
const PHOTOS_URL = `${API_BASE}/admin/session-photos`;

const PAGE_SIZE = 24;

const fmtDate = (str) =>
  new Date(`${str}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });

const fmtWhen = (value) =>
  new Date(value).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

const fmtBytes = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const AdminSessionPhotos = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sections, setSections] = useState([]);
  const [uploaders, setUploaders] = useState([]);

  // Draft filter state (what the inputs show) vs applied (what the last
  // request used). Filters fire on Apply, matching AdminReconciliation.
  const [draft, setDraft] = useState({ section: '', userId: '', shift: '', fromDate: '', toDate: '' });
  const [applied, setApplied] = useState({ section: '', userId: '', shift: '', fromDate: '', toDate: '' });
  const [filterError, setFilterError] = useState('');

  const [lightbox, setLightbox] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Guards against a slow earlier response overwriting a newer one when the
  // filters change quickly (same approach as useSupplierPayoutData).
  const requestIdRef = useRef(0);
  const objectUrlsRef = useRef([]);

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${user.token}` }),
    [user.token]
  );

  const trackUrl = useCallback((url) => {
    objectUrlsRef.current.push(url);
    return url;
  }, []);

  const revokeAll = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, []);

  // Photos are never publicly reachable, so an <img src> cannot load one
  // directly — fetch with the token and hand the tile an object URL.
  const fetchImage = useCallback(
    async (id, size) => {
      try {
        const res = await fetch(`${PHOTOS_URL}/${id}/file${size === 'thumb' ? '?size=thumb' : ''}`, {
          headers: authHeaders(),
        });
        if (!res.ok) return null;
        return trackUrl(URL.createObjectURL(await res.blob()));
      } catch {
        return null;
      }
    },
    [authHeaders, trackUrl]
  );

  // Filter options, loaded once.
  useEffect(() => {
    const run = async () => {
      try {
        const [sectionRes, uploaderRes] = await Promise.all([
          fetch(`${PHOTOS_URL}/sections`, { headers: authHeaders() }),
          fetch(`${PHOTOS_URL}/uploaders`, { headers: authHeaders() }),
        ]);
        if (sectionRes.ok) setSections((await sectionRes.json()).sections ?? []);
        if (uploaderRes.ok) setUploaders((await uploaderRes.json()).uploaders ?? []);
      } catch {
        /* filters degrade to free-form; the list still works */
      }
    };
    run();
  }, [authHeaders]);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (applied.section) params.set('section', applied.section);
      if (applied.userId) params.set('userId', applied.userId);
      if (applied.shift) params.set('shift', applied.shift);
      if (applied.fromDate) params.set('fromDate', applied.fromDate);
      if (applied.toDate) params.set('toDate', applied.toDate);

      const res = await fetch(`${PHOTOS_URL}?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || 'Failed to load photos');
      }
      const data = await res.json();

      // A newer request has already been issued — drop this response.
      if (requestId !== requestIdRef.current) return;

      revokeAll();
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);

      // Thumbnails only. Full-resolution images load on demand in the viewer.
      const withThumbs = await Promise.all(
        (data.items ?? []).map(async (item) => ({
          ...item,
          thumbObjectUrl: item.thumbnailUrl ? await fetchImage(item.id, 'thumb') : null,
        }))
      );
      if (requestId !== requestIdRef.current) return;
      setItems(withThumbs);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message || 'Failed to load photos');
      setItems([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [page, applied, authHeaders, fetchImage, revokeAll]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => revokeAll, [revokeAll]);

  const applyFilters = () => {
    if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) {
      setFilterError('From Date cannot be later than To Date.');
      return;
    }
    setFilterError('');
    setPage(1);
    setApplied({ ...draft });
  };

  const clearFilters = () => {
    const empty = { section: '', userId: '', shift: '', fromDate: '', toDate: '' };
    setDraft(empty);
    setApplied(empty);
    setFilterError('');
    setPage(1);
  };

  const openLightbox = async (photo) => {
    setLightbox({ ...photo, fullUrl: null });
    const fullUrl = await fetchImage(photo.id);
    setLightbox((current) => (current && current.id === photo.id ? { ...current, fullUrl } : current));
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`${PHOTOS_URL}/${pendingDelete.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || 'Delete failed');
      }
      setPendingDelete(null);
      showToast('Photo deleted', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const hasFilters = Object.values(applied).some(Boolean);

  return (
    <motion.div
      className="asp-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <button className="asp-back-btn" onClick={() => navigate('/admin/dashboard')}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div className="asp-page-header">
        <h1 className="asp-page-title"><FiCamera /> Session Photos</h1>
        <p className="asp-page-sub">
          Photo evidence attached by staff, newest first. Each photo shows the user and the
          session — date and shift — it was filed against.
        </p>
      </div>

      <div className="asp-filters">
        <div className="asp-filter">
          <label htmlFor="asp-user">User</label>
          <select
            id="asp-user"
            value={draft.userId}
            onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))}
          >
            <option value="">All users</option>
            {uploaders.map((u) => (
              <option key={u.userId} value={u.userId}>{u.name} ({u.photoCount})</option>
            ))}
          </select>
        </div>

        <div className="asp-filter">
          <label htmlFor="asp-section">Section</label>
          <select
            id="asp-section"
            value={draft.section}
            onChange={(e) => setDraft((d) => ({ ...d, section: e.target.value }))}
          >
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="asp-filter">
          <label htmlFor="asp-shift">Shift</label>
          <select
            id="asp-shift"
            value={draft.shift}
            onChange={(e) => setDraft((d) => ({ ...d, shift: e.target.value }))}
          >
            <option value="">All shifts</option>
            <option value="FULL_DAY">Full day</option>
            <option value="DAY">Day</option>
            <option value="NIGHT">Night</option>
          </select>
        </div>

        <div className="asp-filter">
          <label htmlFor="asp-from">From</label>
          <input
            id="asp-from"
            type="date"
            value={draft.fromDate}
            onChange={(e) => setDraft((d) => ({ ...d, fromDate: e.target.value }))}
          />
        </div>

        <div className="asp-filter">
          <label htmlFor="asp-to">To</label>
          <input
            id="asp-to"
            type="date"
            value={draft.toDate}
            onChange={(e) => setDraft((d) => ({ ...d, toDate: e.target.value }))}
          />
        </div>

        <div className="asp-filter-actions">
          <button type="button" className="asp-btn asp-btn--primary" onClick={applyFilters}>
            <FiFilter /> Apply
          </button>
          <button type="button" className="asp-btn" onClick={clearFilters} disabled={!hasFilters}>
            Clear
          </button>
        </div>
      </div>

      {filterError && <div className="asp-alert asp-alert--warn">{filterError}</div>}
      {error && <div className="asp-alert asp-alert--error">{error}</div>}

      <div className="asp-summary">
        {loading ? 'Loading…' : `${total} photo${total === 1 ? '' : 's'}${hasFilters ? ' matching filters' : ''}`}
      </div>

      {loading ? (
        <div className="asp-center"><FiRefreshCw className="asp-spin" /> Loading photos…</div>
      ) : items.length === 0 ? (
        <div className="asp-empty">
          <FiImage />
          <p>{hasFilters ? 'No photos match these filters.' : 'No session photos have been uploaded yet.'}</p>
        </div>
      ) : (
        <>
          <div className="asp-grid">
            {items.map((photo) => (
              <figure key={photo.id} className="asp-card">
                <button
                  type="button"
                  className="asp-card__btn"
                  onClick={() => openLightbox(photo)}
                  aria-label={`Open photo ${photo.originalFilename}`}
                >
                  {photo.thumbObjectUrl ? (
                    <img
                      src={photo.thumbObjectUrl}
                      alt={photo.originalFilename}
                      className="asp-card__img"
                      loading="lazy"
                    />
                  ) : (
                    <span className="asp-card__fallback">Preview unavailable</span>
                  )}
                </button>

                <figcaption className="asp-card__meta">
                  <span className="asp-card__section">{photo.sectionLabel}</span>
                  <span className="asp-card__row">
                    <FiUser aria-hidden="true" />
                    {photo.uploadedByName ?? `User ${photo.uploadedByUserId}`}
                  </span>
                  <span className="asp-card__row">
                    <FiClock aria-hidden="true" />
                    {fmtDate(photo.date)} · {SHIFT_LABELS[photo.shift] ?? photo.shift}
                  </span>
                  <span className="asp-card__sub">
                    Uploaded {fmtWhen(photo.createdAt)} · {fmtBytes(photo.fileSize)}
                    {photo.source === 'camera' ? ' · camera' : ''}
                  </span>
                </figcaption>

                <button
                  type="button"
                  className="asp-card__del"
                  onClick={() => setPendingDelete(photo)}
                  aria-label={`Delete photo ${photo.originalFilename}`}
                >
                  <FiTrash2 />
                </button>
              </figure>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="asp-pager">
              <button
                type="button"
                className="asp-pager-btn"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <FiChevronLeft />
              </button>
              <span className="asp-pager-status">Page {page} of {totalPages}</span>
              <button
                type="button"
                className="asp-pager-btn"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <FiChevronRight />
              </button>
            </div>
          )}
        </>
      )}

      {lightbox && (
        <div className="asp-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <button
            type="button"
            className="asp-lightbox__close"
            onClick={() => setLightbox(null)}
            aria-label="Close photo"
          >
            <FiX />
          </button>
          {lightbox.fullUrl ? (
            <img
              src={lightbox.fullUrl}
              alt={lightbox.originalFilename}
              className="asp-lightbox__img"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="asp-lightbox__loading"><FiRefreshCw className="asp-spin" /> Loading photo…</div>
          )}
          <div className="asp-lightbox__meta" onClick={(e) => e.stopPropagation()}>
            <strong>{lightbox.sectionLabel}</strong>
            <span>{lightbox.uploadedByName ?? `User ${lightbox.uploadedByUserId}`}</span>
            <span>{fmtDate(lightbox.date)} · {SHIFT_LABELS[lightbox.shift] ?? lightbox.shift}</span>
            <span>Uploaded {fmtWhen(lightbox.createdAt)}</span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this photo?"
        message="The photo and its stored file will be permanently removed. This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </motion.div>
  );
};
