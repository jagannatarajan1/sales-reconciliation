import { AnimatePresence, motion } from 'framer-motion';
import { FiAlertTriangle } from 'react-icons/fi';
import { Button } from './Button';
import './ui.css';

// Shared confirmation modal for destructive actions (§15/F) — replaces the
// native window.confirm(...) calls scattered across the app so every
// confirmation looks and behaves the same, and matches the app's design
// system instead of the browser's native dialog chrome.
export const ConfirmDialog = ({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}) => (
  <AnimatePresence>
    {open && (
      <motion.div
        className="ui-confirm-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={loading ? undefined : onCancel}
      >
        <motion.div
          className="ui-confirm-modal"
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          role="alertdialog"
          aria-modal="true"
        >
          <div className={`ui-confirm-icon ui-confirm-icon--${variant}`}>
            <FiAlertTriangle />
          </div>
          <h3 className="ui-confirm-title">{title}</h3>
          {message && <p className="ui-confirm-message">{message}</p>}
          <div className="ui-confirm-actions">
            <Button variant="secondary" onClick={onCancel} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button variant={variant} onClick={onConfirm} loading={loading}>
              {confirmLabel}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
