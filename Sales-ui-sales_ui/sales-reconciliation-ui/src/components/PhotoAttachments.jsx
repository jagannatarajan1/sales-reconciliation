import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FiCamera,
  FiCheck,
  FiImage,
  FiTrash2,
  FiX,
  FiRefreshCw,
  FiZoomIn,
  FiRotateCw,
  FiAlertTriangle,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { useToast } from './ui/Toast';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { SHIFT_LABELS } from '../constants/photoSections';
import './PhotoAttachments.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';
const PHOTOS_URL = `${API_BASE}/session-photos`;

const MAX_FILES_PER_UPLOAD = 10;
// Long edge, in px, that camera captures and picked photos are reduced to
// before upload. Large enough to read a printed receipt, small enough that a
// day's evidence does not fill the VPS disk. The server enforces its own
// limit regardless — this only saves upload time on mobile data.
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
// (HEIC on most desktops) fall through and upload untouched — the server
// re-encodes everything anyway.
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

// Turns a getUserMedia rejection into something a staff member can act on.
// The distinction matters: "blocked" needs a browser permission change,
// "no camera" needs the file picker instead, and "in use" usually means
// another tab or app has the device.
const cameraErrorMessage = (err) => {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow camera permission for this site in your browser settings, or use "Choose file" instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. Use "Choose file" instead.';
    case 'NotReadableError':
      return 'The camera is already in use by another app or tab. Close it and try again, or use "Choose file".';
    default:
      return 'The camera could not be started. Use "Choose file" instead.';
  }
};

// Live camera capture. Kept in a modal rather than an inline preview so the
// viewfinder can be full-bleed on a phone, which is where this is actually
// used — a staff member photographing a receipt at the till.
//
// The shot is NOT sent straight to upload: it freezes into a preview first so
// a blurred or mis-framed photo can be retaken before anything leaves the
// device.
const CameraCapture = ({ onCapture, onClose }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const previewUrlRef = useRef(null);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [starting, setStarting] = useState(true);
  // { file, url } once a shot has been taken and is awaiting confirmation.
  const [captured, setCaptured] = useState(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Also resets the viewfinder state, because dropping `captured` re-runs the
  // effect that restarts the stream.
  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setCaptured(null);
    setStarting(true);
    setError(null);
  }, []);

  useEffect(() => {
    // Don't restart the stream while a capture is being reviewed — the
    // viewfinder is hidden and restarting would flash the camera light back on.
    if (captured) return undefined;

    let cancelled = false;

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
        setError(cameraErrorMessage(err));
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [facingMode, captured, stop]);

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
        const file = new File([blob], `camera-${stamp}.jpg`, { type: 'image/jpeg' });
        previewUrlRef.current = URL.createObjectURL(blob);
        setCaptured({ file, url: previewUrlRef.current });
        // Release the camera while the shot is being reviewed.
        stop();
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  };

  const confirmCapture = () => {
    if (!captured) return;
    const { file } = captured;
    clearPreview();
    onCapture(file);
  };

  return (
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
            aria-label={captured ? 'Check your photo' : 'Take a photo'}
          >
            <div className="pa-camera-head">
              <span>{captured ? 'Check your photo' : 'Take a photo'}</span>
              <button type="button" className="pa-icon-btn" onClick={onClose} aria-label="Close camera">
                <FiX />
              </button>
            </div>

            <div className="pa-camera-stage">
              {error ? (
                <div className="pa-camera-error">
                  <FiAlertTriangle aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : captured ? (
                <img src={captured.url} alt="Photo just taken" className="pa-camera-preview" />
              ) : (
                <>
                  <video ref={videoRef} autoPlay playsInline muted className="pa-camera-video" />
                  {starting && <div className="pa-camera-hint">Starting camera…</div>}
                </>
              )}
            </div>

            {!error && captured && (
              <div className="pa-camera-actions pa-camera-actions--review">
                <button type="button" className="pa-btn pa-btn--ghost" onClick={() => { clearPreview(); }}>
                  <FiRefreshCw /> Retake
                </button>
                <button type="button" className="pa-btn pa-btn--primary" onClick={confirmCapture}>
                  <FiCheck /> Use photo
                </button>
              </div>
            )}

            {!error && !captured && (
              <div className="pa-camera-actions">
                <button
                  type="button"
                  className="pa-camera-flip"
                  onClick={() => {
                    setStarting(true);
                    setError(null);
                    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'));
                  }}
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

            {error && (
              <div className="pa-camera-actions pa-camera-actions--review">
                <button type="button" className="pa-btn pa-btn--ghost" onClick={onClose}>Close</button>
              </div>
            )}
          </motion.div>
        </motion.div>
  );
};

// Full-size viewer. The full-resolution image is fetched only when opened —
// the grid itself never loads anything bigger than a thumbnail.
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
        {photo.fullUrl ? (
          <motion.img
            src={photo.fullUrl}
            alt={photo.originalFilename}
            className="pa-lightbox__img"
            initial={{ scale: 0.94 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.94 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="pa-lightbox__loading"><FiRefreshCw className="pa-spin" /> Loading photo…</div>
        )}
        <div className="pa-lightbox__meta">
          {photo.originalFilename}
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
 * The session a photo belongs to (date + shift) is decided by the server from
 * the active context — this component never sends one, so it cannot file a
 * photo against a session the user is not working.
 *
 * @param section   one of PHOTO_SECTIONS — must match the backend's list
 * @param entityId  optional row scope within the section; required for
 *                  catalogue sections (Scratch Cards)
 * @param readOnly  hides upload/delete (committed days, view-only roles)
 * @param title     heading text
 * @param compact   denser layout for use inside table rows and cards
 */
const PhotoAttachments = ({
  section,
  entityId = null,
  readOnly = false,
  title = 'Photos',
  description = 'Attach a photo from your camera or a file on this device.',
  compact = false,
}) => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [photos, setPhotos] = useState([]);
  const [session, setSession] = useState(null);
  const [serverLocked, setServerLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // Tiles for in-flight / failed uploads, so each photo shows its own state
  // rather than the whole block showing one spinner.
  const [pending, setPending] = useState([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef(null);
  // Every object URL handed to an <img>, so they can be revoked on reload and
  // unmount instead of leaking for the life of the page.
  const objectUrlsRef = useRef([]);

  const isLocked = readOnly || serverLocked;

  const trackUrl = useCallback((url) => {
    objectUrlsRef.current.push(url);
    return url;
  }, []);

  const revokeAll = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, []);

  // Fetches one protected image with the bearer token and returns an object
  // URL for it. Built from the id rather than the DTO's absolute path so it
  // works whether VITE_API_URL is an origin+/api or just /api. Returns null
  // rather than throwing so one broken tile cannot blank the whole grid.
  const fetchImage = useCallback(
    async (id, size) => {
      try {
        const res = await fetch(`${PHOTOS_URL}/${id}/file${size === 'thumb' ? '?size=thumb' : ''}`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (!res.ok) return null;
        return trackUrl(URL.createObjectURL(await res.blob()));
      } catch {
        return null;
      }
    },
    [user.token, trackUrl]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ section });
      if (entityId) params.set('entityId', String(entityId));

      const res = await fetch(`${PHOTOS_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error('Failed to load photos');

      const data = await res.json();
      revokeAll();

      setSession({ date: data.date, shift: data.shift });
      setServerLocked(!!data.isLocked);

      const items = Array.isArray(data.items) ? data.items : [];
      // Thumbnails only — the full image is fetched when a tile is opened.
      const withThumbs = await Promise.all(
        items.map(async (item) => ({
          ...item,
          thumbObjectUrl: item.thumbnailUrl ? await fetchImage(item.id, 'thumb') : null,
        }))
      );
      setPhotos(withThumbs);
    } catch {
      showToast('Failed to load photos', 'error');
    } finally {
      setLoading(false);
    }
  }, [section, entityId, user.token, fetchImage, revokeAll, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => revokeAll, [revokeAll]);

  const uploadFiles = useCallback(
    async (fileList, source) => {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      if (files.length > MAX_FILES_PER_UPLOAD) {
        showToast(`You can upload at most ${MAX_FILES_PER_UPLOAD} photos at a time`, 'error');
        return;
      }
      if (files.some((f) => f.type && !f.type.startsWith('image/'))) {
        showToast('Only image files can be attached', 'error');
        return;
      }

      const batchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPending((prev) => [
        ...prev,
        ...files.map((file, i) => ({
          key: `${batchId}-${i}`,
          batchId,
          name: file.name,
          status: 'uploading',
        })),
      ]);
      setUploading(true);

      try {
        const form = new FormData();
        form.append('section', section);
        if (entityId) form.append('entityId', String(entityId));
        form.append('source', source);
        for (const file of files) form.append('photos', await downscaleImage(file));

        const res = await fetch(PHOTOS_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${user.token}` },
          body: form,
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload.message || 'Upload failed');
        }

        setPending((prev) => prev.filter((p) => p.batchId !== batchId));
        showToast(files.length > 1 ? `${files.length} photos uploaded` : 'Photo uploaded', 'success');
        await load();
      } catch (err) {
        // Leave the failed tiles on screen with a retry affordance rather
        // than silently dropping the photo the user just took.
        setPending((prev) =>
          prev.map((p) =>
            p.batchId === batchId
              ? { ...p, status: 'failed', error: err.message || 'Upload failed' }
              : p
          )
        );
        showToast(err.message || 'Upload failed', 'error');
      } finally {
        setUploading(false);
      }
    },
    [section, entityId, user.token, load, showToast]
  );

  const handleCapture = useCallback(
    (file) => {
      setCameraOpen(false);
      uploadFiles([file], 'camera');
    },
    [uploadFiles]
  );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`${PHOTOS_URL}/${pendingDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user.token}` },
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

  const openLightbox = async (photo) => {
    setLightbox({ ...photo, fullUrl: null });
    const fullUrl = await fetchImage(photo.id);
    setLightbox((current) => (current && current.id === photo.id ? { ...current, fullUrl } : current));
  };

  // getUserMedia needs a secure context. Over plain HTTP (a LAN IP in
  // testing, say) the browser exposes no camera at all, so fall back to the
  // OS camera app via the file input's capture attribute.
  const canUseLiveCamera =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    window.isSecureContext;

  const openCamera = () => {
    if (canUseLiveCamera) setCameraOpen(true);
    else fileInputRef.current?.click();
  };

  return (
    <div className={`pa-block${compact ? ' pa-block--compact' : ''}`}>
      <div className="pa-head">
        <div>
          <h3 className="pa-title">{title}</h3>
          {!isLocked && <p className="pa-desc">{description}</p>}
          {isLocked && (
            <p className="pa-desc pa-desc--locked">
              This day has been committed — its photos can no longer be changed.
            </p>
          )}
        </div>

        {session && (
          <span className="pa-session" title="The session these photos belong to">
            {session.date}
            {session.shift ? ` · ${SHIFT_LABELS[session.shift] ?? session.shift}` : ''}
          </span>
        )}
      </div>

      {!isLocked && (
        <div className="pa-actions">
          <button type="button" className="pa-btn pa-btn--camera" onClick={openCamera} disabled={uploading}>
            <FiCamera /> Take photo
          </button>
          <button
            type="button"
            className="pa-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <FiImage /> Choose file
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="pa-file-input"
        onChange={(e) => {
          uploadFiles(e.target.files, canUseLiveCamera ? 'file' : 'camera');
          e.target.value = '';
        }}
      />

      {loading ? (
        <div className="pa-empty"><FiRefreshCw className="pa-spin" /> Loading photos…</div>
      ) : photos.length === 0 && pending.length === 0 ? (
        <div className="pa-empty">No photos attached yet.</div>
      ) : (
        <div className="pa-grid">
          {photos.map((photo) => (
            <figure key={photo.id} className="pa-tile">
              <button
                type="button"
                className="pa-tile__btn"
                onClick={() => openLightbox(photo)}
                aria-label={`Open ${photo.originalFilename}`}
              >
                {photo.thumbObjectUrl ? (
                  <img
                    src={photo.thumbObjectUrl}
                    alt={photo.originalFilename}
                    className="pa-tile__img"
                    loading="lazy"
                  />
                ) : (
                  <span className="pa-tile__fallback">Preview unavailable</span>
                )}
                <span className="pa-tile__zoom"><FiZoomIn /></span>
              </button>

              <figcaption className="pa-tile__meta">
                <span className="pa-tile__ok" title="Uploaded"><FiCheck /> Uploaded</span>
                <span>{formatBytes(photo.fileSize)}</span>
              </figcaption>

              {!isLocked && (
                <button
                  type="button"
                  className="pa-tile__del"
                  onClick={() => setPendingDelete(photo)}
                  aria-label={`Delete ${photo.originalFilename}`}
                >
                  <FiTrash2 />
                </button>
              )}
            </figure>
          ))}

          {pending.map((item) => (
            <figure key={item.key} className={`pa-tile pa-tile--${item.status}`}>
              <div className="pa-tile__pending">
                {item.status === 'uploading' ? (
                  <><FiRefreshCw className="pa-spin" /><span>Uploading…</span></>
                ) : (
                  <><FiAlertTriangle /><span>{item.error}</span></>
                )}
              </div>
              <figcaption className="pa-tile__meta">
                <span className="pa-tile__name">{item.name}</span>
                {item.status === 'failed' && (
                  <button
                    type="button"
                    className="pa-tile__retry"
                    onClick={() => setPending((prev) => prev.filter((p) => p.key !== item.key))}
                  >
                    Dismiss
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <AnimatePresence>
        {cameraOpen && (
          <CameraCapture onCapture={handleCapture} onClose={() => setCameraOpen(false)} />
        )}
      </AnimatePresence>
      <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this photo?"
        message="The photo will be permanently removed. This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

export default PhotoAttachments;
