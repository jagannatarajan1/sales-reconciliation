import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FiCamera,
  FiImage,
  FiTrash2,
  FiUpload,
  FiX,
  FiRefreshCw,
  FiZoomIn,
  FiRotateCw,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useToast } from './ui/Toast';
import { ConfirmDialog } from './ui/ConfirmDialog';
import './PhotoAttachments.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';
const ATTACHMENTS_URL = `${API_BASE}/attachments`;

const MAX_FILES_PER_UPLOAD = 10;
// Long edge, in px, that camera captures and picked photos are reduced to
// before upload. Large enough to read a printed receipt, small enough that a
// day's evidence does not fill the VPS disk.
const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.85;

const formatBytes = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatWhen = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Shrinks an image in a canvas before it leaves the device. A modern phone
// photo is 3–8MB; this typically lands under 400KB with no meaningful loss of
// legibility for receipts and till rolls. Formats the browser cannot decode
// (HEIC on most desktops) fall through and upload untouched — the API accepts
// them, it just cannot preview them client-side.
const downscaleImage = (file) =>
  new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') {
      resolve(file);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { width, height } = img;
      const longEdge = Math.max(width, height);

      if (longEdge <= MAX_IMAGE_EDGE && file.size < 1024 * 1024) {
        resolve(file);
        return;
      }

      const scale = Math.min(1, MAX_IMAGE_EDGE / longEdge);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file);
            return;
          }
          const renamed = file.name.replace(/\.[^.]+$/, '') || 'photo';
          resolve(new File([blob], `${renamed}.jpg`, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });

// Live camera capture. Kept in a modal rather than an inline preview so the
// viewfinder can be full-bleed on a phone, which is where this is actually
// used — a staff member photographing a receipt at the till.
const CameraCapture = ({ open, onCapture, onClose }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [starting, setStarting] = useState(true);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stop();
      return undefined;
    }

    let cancelled = false;
    setStarting(true);
    setError(null);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        // The modal can close while getUserMedia is still resolving; without
        // this the camera light stays on with no way to turn it off.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStarting(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setStarting(false);
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow camera permission for this site, or use "Choose file" instead.'
            : 'No camera is available on this device. Use "Choose file" instead.'
        );
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, facingMode, stop]);

  const handleShutter = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        onCapture(new File([blob], `camera-${stamp}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="pa-camera-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="pa-camera-modal"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Take a photo"
          >
            <div className="pa-camera-head">
              <span>Take a photo</span>
              <button type="button" className="pa-icon-btn" onClick={onClose} aria-label="Close camera">
                <FiX />
              </button>
            </div>

            <div className="pa-camera-stage">
              {error ? (
                <div className="pa-camera-error">{error}</div>
              ) : (
                <>
                  <video ref={videoRef} autoPlay playsInline muted className="pa-camera-video" />
                  {starting && <div className="pa-camera-hint">Starting camera…</div>}
                </>
              )}
            </div>

            {!error && (
              <div className="pa-camera-actions">
                <button
                  type="button"
                  className="pa-camera-flip"
                  onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
                  aria-label="Switch camera"
                >
                  <FiRotateCw />
                </button>
                <button
                  type="button"
                  className="pa-shutter"
                  onClick={handleShutter}
                  disabled={starting}
                  aria-label="Capture photo"
                >
                  <span className="pa-shutter__inner" />
                </button>
                <span className="pa-camera-spacer" />
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Full-size viewer for a stored photo.
const Lightbox = ({ photo, onClose }) => (
  <AnimatePresence>
    {photo && (
      <motion.div
        className="pa-lightbox"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
      >
        <button type="button" className="pa-lightbox__close" onClick={onClose} aria-label="Close photo">
          <FiX />
        </button>
        <motion.img
          src={photo.objectUrl}
          alt={photo.fileName}
          className="pa-lightbox__img"
          initial={{ scale: 0.94 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0.94 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
        />
        <div className="pa-lightbox__meta">
          {photo.fileName}
          {photo.uploadedByName ? ` · ${photo.uploadedByName}` : ''}
          {` · ${formatWhen(photo.createdAt)}`}
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);

/**
 * Photo evidence for one page (and optionally one row within it).
 *
 * Images are fetched with the auth header and held as object URLs, because an
 * <img src> cannot carry a bearer token and the files must not be publicly
 * reachable.
 *
 * @param section   one of PHOTO_SECTIONS — must match the backend's list
 * @param date      YYYY-MM-DD, normally the page's active date. Omit for
 *                  catalogue sections, which are addressed by entityId alone
 * @param entityId  optional row scope within the section
 * @param readOnly  hides upload/delete (committed days, view-only roles)
 * @param title     heading text
 * @param compact   denser layout for use inside table rows and cards
 */
const PhotoAttachments = ({
  section,
  date,
  entityId = null,
  readOnly = false,
  title = 'Photos',
  description = 'Attach a photo from your camera or a file on this device.',
  compact = false,
}) => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  // Tracks every object URL handed to an <img> so they can be revoked on
  // unmount or reload; without this each refresh leaks the decoded bitmaps.
  const objectUrlsRef = useRef([]);

  const token = user?.token;

  const releaseObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, []);

  const load = useCallback(async () => {
    // Catalogue sections (Scratch Cards) pass no date — they are addressed by
    // entityId and the backend lists them across every day.
    if (!token || !section) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({ section });
      if (date) params.set('date', date);
      if (entityId != null && entityId !== '') params.set('entityId', String(entityId));

      const res = await fetch(`${ATTACHMENTS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load photos');

      const rows = await res.json();

      // Pull the bytes for each row with the bearer token attached, then swap
      // the whole set at once so the grid never flashes half-loaded.
      const withBlobs = await Promise.all(
        rows.map(async (row) => {
          try {
            const fileRes = await fetch(`${API_BASE}/attachments/${row.id}/file`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!fileRes.ok) return { ...row, objectUrl: null };
            const blob = await fileRes.blob();
            return { ...row, objectUrl: URL.createObjectURL(blob) };
          } catch {
            return { ...row, objectUrl: null };
          }
        })
      );

      releaseObjectUrls();
      objectUrlsRef.current = withBlobs.map((p) => p.objectUrl).filter(Boolean);
      setPhotos(withBlobs);
    } catch {
      showToast('Failed to load photos', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, date, section, entityId, releaseObjectUrls, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => releaseObjectUrls, [releaseObjectUrls]);

  const uploadFiles = async (files, source) => {
    const list = Array.from(files ?? []).filter(Boolean);
    if (list.length === 0) return;

    if (list.length > MAX_FILES_PER_UPLOAD) {
      showToast(`You can upload at most ${MAX_FILES_PER_UPLOAD} photos at a time`, 'error');
      return;
    }

    const notImages = list.filter((f) => f.type && !f.type.startsWith('image/'));
    if (notImages.length > 0) {
      showToast('Only image files can be attached', 'error');
      return;
    }

    setUploading(true);
    try {
      const prepared = await Promise.all(list.map(downscaleImage));

      const form = new FormData();
      form.append('section', section);
      if (date) form.append('date', date);
      form.append('source', source);
      if (entityId != null && entityId !== '') form.append('entityId', String(entityId));
      prepared.forEach((file) => form.append('photos', file, file.name));

      const res = await fetch(ATTACHMENTS_URL, {
        method: 'POST',
        // No Content-Type header — the browser must set the multipart
        // boundary itself.
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || 'Upload failed');
      }

      showToast(prepared.length === 1 ? 'Photo added' : `${prepared.length} photos added`);
      await load();
    } catch (err) {
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleCapture = async (file) => {
    setCameraOpen(false);
    await uploadFiles([file], 'camera');
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`${ATTACHMENTS_URL}/${pendingDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || 'Delete failed');
      }
      showToast('Photo deleted');
      setPendingDelete(null);
      await load();
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Browsers without getUserMedia (older in-app webviews) still get a camera
  // via the file input's capture attribute, which opens the native camera app.
  const canUseLiveCamera =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

  const openCamera = () => {
    if (canUseLiveCamera) setCameraOpen(true);
    else cameraInputRef.current?.click();
  };

  return (
    <section className={`pa-block ${compact ? 'pa-block--compact' : ''}`}>
      <header className="pa-head">
        <div className="pa-head__text">
          <h3 className="pa-title">
            <FiImage aria-hidden="true" /> {title}
            {photos.length > 0 && <span className="pa-count">{photos.length}</span>}
          </h3>
          {!compact && <p className="pa-description">{readOnly ? 'Photos are locked for this date.' : description}</p>}
        </div>

        {!readOnly && (
          <div className="pa-actions">
            <button type="button" className="pa-btn pa-btn--camera" onClick={openCamera} disabled={uploading}>
              <FiCamera /> Take photo
            </button>
            <button
              type="button"
              className="pa-btn pa-btn--file"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <FiUpload /> Choose file
            </button>
          </div>
        )}
      </header>

      {/* Gallery picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="pa-hidden-input"
        onChange={(e) => {
          uploadFiles(e.target.files, 'file');
          e.target.value = '';
        }}
      />
      {/* Native camera fallback where getUserMedia is unavailable */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="pa-hidden-input"
        onChange={(e) => {
          uploadFiles(e.target.files, 'camera');
          e.target.value = '';
        }}
      />

      {uploading && (
        <div className="pa-status">
          <FiRefreshCw className="pa-spin" /> Uploading…
        </div>
      )}

      {loading ? (
        <div className="pa-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="pa-thumb pa-thumb--skeleton" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        <p className="pa-empty">
          {readOnly ? 'No photos were attached for this date.' : 'No photos yet.'}
        </p>
      ) : (
        <div className="pa-grid">
          {photos.map((photo) => (
            <motion.figure
              key={photo.id}
              className="pa-thumb"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18 }}
            >
              {photo.objectUrl ? (
                <button
                  type="button"
                  className="pa-thumb__open"
                  onClick={() => setLightbox(photo)}
                  aria-label={`View ${photo.fileName}`}
                >
                  <img src={photo.objectUrl} alt={photo.fileName} loading="lazy" />
                  <span className="pa-thumb__zoom">
                    <FiZoomIn />
                  </span>
                </button>
              ) : (
                // HEIC and friends: stored fine, just not renderable here.
                <div className="pa-thumb__fallback">
                  <FiImage />
                  <span>Preview unavailable</span>
                </div>
              )}

              <figcaption className="pa-thumb__meta">
                <span className="pa-thumb__name" title={photo.fileName}>
                  {photo.fileName}
                </span>
                <span className="pa-thumb__sub">
                  {photo.source === 'camera' ? 'Camera' : 'File'} · {formatBytes(photo.sizeBytes)}
                </span>
                {photo.uploadedByName && <span className="pa-thumb__sub">{photo.uploadedByName}</span>}
              </figcaption>

              {!readOnly && (
                <button
                  type="button"
                  className="pa-thumb__delete"
                  onClick={() => setPendingDelete(photo)}
                  aria-label={`Delete ${photo.fileName}`}
                >
                  <FiTrash2 />
                </button>
              )}
            </motion.figure>
          ))}
        </div>
      )}

      <CameraCapture open={cameraOpen} onCapture={handleCapture} onClose={() => setCameraOpen(false)} />
      <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this photo?"
        message={pendingDelete ? `"${pendingDelete.fileName}" will be permanently removed.` : ''}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
};

export default PhotoAttachments;
