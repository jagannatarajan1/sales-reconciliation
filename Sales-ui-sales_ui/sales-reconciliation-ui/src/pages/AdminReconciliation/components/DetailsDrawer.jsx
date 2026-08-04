import { useState, useEffect, useCallback } from 'react';
import {
  FiX, FiEdit2, FiDownload, FiFileText, FiCheckCircle, FiClock, FiUser,
} from 'react-icons/fi';
import { RecordGrid } from './RecordGrid';
import { StatusBadge } from './StatusBadge';
import { VarianceBadge } from './VarianceBadge';
import { ActivityTimeline } from './ActivityTimeline';
import { useRecordDetail } from '../hooks/useRecordDetail';
import { fetchAuditLog, submitRecord } from '../api';
import {
  fmtDateLong, fmtDateTime, itemToForm, computeSummaryTotal, VARIANCE_TOLERANCE,
} from '../utils';

const SHOP_NAME = 'Cheney Manor Stores';

export function DetailsDrawer({ date, token, onClose, onSaved, onDownloadBill, onViewDocuments, showToast }) {
  const { detail, loading, error, reload } = useRecordDetail({ token, date });
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    const run = async () => {
      setIsEditing(false);
      if (detail) setForm(itemToForm(detail));
    };
    run();
  }, [detail]);

  const loadAudit = useCallback(async () => {
    if (!date) return;
    setAuditLoading(true);
    try {
      setAuditEntries(await fetchAuditLog(token, date));
    } catch {
      setAuditEntries([]);
    } finally {
      setAuditLoading(false);
    }
  }, [token, date]);

  useEffect(() => {
    const run = async () => { await loadAudit(); };
    run();
  }, [loadAudit]);

  if (!date) return null;

  const computedCash = (parseFloat(form.lastSafe) || 0) + (parseFloat(form.safeDropAmount) || 0);
  const computedSummaryTotal = computeSummaryTotal(form);
  const computedDifference = Math.abs(computedSummaryTotal - (parseFloat(form.zReportTotal) || 0));

  const handleChange = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const buildSubmitBody = (f) => ({
    date,
    manualCardAmount: parseFloat(f.manualCardAmount) || 0,
    cardAmount: parseFloat(f.cardAmount) || 0,
    lastSafe: parseFloat(f.lastSafe) || 0,
    safeDropAmount: parseFloat(f.safeDropAmount) || 0,
    cashback: parseFloat(f.cashback) || 0,
    paypointPayout: parseFloat(f.paypointPayout) || 0,
    instantLotteryPayout: parseFloat(f.instantLotteryPayout) || 0,
    lotteryPayout: parseFloat(f.lotteryPayout) || 0,
    newsVoucher: parseFloat(f.newsVoucher) || 0,
    ddPoint: parseFloat(f.ddPoint) || 0,
    supplierInvoicesTotal: parseFloat(f.supplierInvoicesTotal) || 0,
    lotteryValue: parseFloat(f.lotteryValue) || 0,
    paypointValue: parseFloat(f.paypointValue) || 0,
    summaryTotal: computeSummaryTotal(f),
    zReportTotal: parseFloat(f.zReportTotal) || 0,
    difference: Math.abs(computeSummaryTotal(f) - (parseFloat(f.zReportTotal) || 0)),
    adminNotes: f.adminNotes || '',
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await submitRecord(token, buildSubmitBody(form));
      showToast(`${fmtDateLong(date)} saved successfully`);
      setIsEditing(false);
      await reload();
      loadAudit();
      onSaved?.();
    } catch {
      showToast('Failed to save changes', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      await submitRecord(token, buildSubmitBody(itemToForm(detail)));
      showToast(`${fmtDateLong(date)} approved`);
      await reload();
      loadAudit();
      onSaved?.();
    } catch {
      showToast('Failed to approve this record', 'error');
    } finally {
      setApproving(false);
    }
  };

  const canApprove = detail && (detail.status === 'needs_review' || detail.status === 'auto_matched');
  const varianceNote = detail
    ? Math.abs(detail.difference) === 0
      ? 'Staff total matches the Z-Report exactly.'
      : Math.abs(detail.difference) <= VARIANCE_TOLERANCE
        ? `Within the £${VARIANCE_TOLERANCE.toFixed(2)} tolerance — no admin action required.`
        : `Exceeds the £${VARIANCE_TOLERANCE.toFixed(2)} tolerance and needs admin review.`
    : '';

  return (
    <div className="rc-drawer-overlay rc-no-print" onClick={onClose}>
      <aside className="rc-drawer" onClick={(e) => e.stopPropagation()} aria-label="Reconciliation record details">
        <div className="rc-drawer-header">
          <div>
            <p className="rc-drawer-store"><FiUser aria-hidden="true" /> {SHOP_NAME}</p>
            <h2 className="rc-drawer-title">{fmtDateLong(date)}</h2>
            {detail && <StatusBadge status={detail.status} />}
          </div>
          <button type="button" className="rc-icon-btn rc-drawer-close" onClick={onClose} aria-label="Close details">
            <FiX />
          </button>
        </div>

        <div className="rc-drawer-body">
          {loading ? (
            <div className="rc-center"><div className="rc-spinner" /><p>Loading record…</p></div>
          ) : error ? (
            <div className="rc-notice">{error}</div>
          ) : detail ? (
            <>
              <div className="rc-drawer-totals">
                <div className="rc-drawer-total-item">
                  <span className="rc-field-label">Staff Total</span>
                  <span className="rc-drawer-total-value">£{(parseFloat(detail.summaryTotal) || 0).toFixed(2)}</span>
                </div>
                <div className="rc-drawer-total-item">
                  <span className="rc-field-label">Z-Report Total</span>
                  <span className="rc-drawer-total-value">£{(parseFloat(detail.zReportTotal) || 0).toFixed(2)}</span>
                </div>
                <div className="rc-drawer-total-item">
                  <span className="rc-field-label">Variance</span>
                  <VarianceBadge variance={detail.difference} />
                </div>
              </div>
              <p className="rc-variance-note">{varianceNote}</p>

              <div className="rc-audit-row">
                {detail.committedByName && (
                  <div className="rc-audit-item">
                    <span className="rc-field-label">Committed By</span>
                    <span>{detail.committedByName}{detail.committedAt ? ` · ${fmtDateTime(detail.committedAt)}` : ''}</span>
                  </div>
                )}
                {detail.adminSubmittedByName && (
                  <div className="rc-audit-item">
                    <span className="rc-field-label">Reviewed By</span>
                    <span>{detail.adminSubmittedByName}{detail.adminSubmittedAt ? ` · ${fmtDateTime(detail.adminSubmittedAt)}` : ''}</span>
                  </div>
                )}
                {!detail.committedByName && !detail.adminSubmittedByName && detail.lastEditedByName && (
                  <div className="rc-audit-item">
                    <span className="rc-field-label">Last Edited By</span>
                    <span>{detail.lastEditedByName}{detail.lastEditedAt ? ` · ${fmtDateTime(detail.lastEditedAt)}` : ''}</span>
                  </div>
                )}
              </div>

              <section className="rc-drawer-section">
                <h3 className="rc-drawer-section-title">Reconciliation Details</h3>
                <RecordGrid
                  editable={isEditing}
                  form={isEditing ? form : itemToForm(detail)}
                  computedCash={isEditing ? computedCash : (parseFloat(detail.lastSafe) || 0) + (parseFloat(detail.safeDropAmount) || 0)}
                  computedSummaryTotal={isEditing ? computedSummaryTotal : parseFloat(detail.summaryTotal) || 0}
                  computedDifference={isEditing ? computedDifference : Math.abs(detail.difference)}
                  onChange={handleChange}
                />
              </section>

              <section className="rc-drawer-section">
                <h3 className="rc-drawer-section-title">Staff Notes</h3>
                <p className="rc-notes-text">{detail.staffNotes || 'No staff notes for this date.'}</p>
              </section>

              <section className="rc-drawer-section">
                <h3 className="rc-drawer-section-title">Admin Notes</h3>
                {isEditing ? (
                  <textarea
                    className="rc-notes-input"
                    rows={3}
                    placeholder="Enter any notes about this reconciliation…"
                    value={form.adminNotes || ''}
                    onChange={(e) => handleChange('adminNotes', e.target.value)}
                  />
                ) : (
                  <p className="rc-notes-text">{detail.adminNotes || 'No admin notes yet.'}</p>
                )}
              </section>

              <section className="rc-drawer-section">
                <h3 className="rc-drawer-section-title">Documents</h3>
                <div className="rc-doc-actions">
                  <button type="button" className="rc-btn rc-btn--secondary" onClick={() => onViewDocuments(date)}>
                    <FiFileText /> View Z-Report
                  </button>
                  {detail.status !== 'uncommitted' && (
                    <button type="button" className="rc-btn rc-btn--secondary" onClick={() => onDownloadBill(date)}>
                      <FiDownload /> Download Bill (PDF)
                    </button>
                  )}
                </div>
              </section>

              <section className="rc-drawer-section">
                <h3 className="rc-drawer-section-title"><FiClock aria-hidden="true" /> Activity Timeline</h3>
                <ActivityTimeline entries={auditEntries} loading={auditLoading} />
              </section>
            </>
          ) : null}
        </div>

        {detail && (
          <div className="rc-drawer-footer">
            {isEditing ? (
              <>
                <button type="button" className="rc-btn rc-btn--primary" onClick={handleSave} disabled={saving}>
                  {saving && <span className="rc-btn-spinner" />} {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button type="button" className="rc-btn rc-btn--ghost" onClick={() => { setIsEditing(false); setForm(itemToForm(detail)); }} disabled={saving}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" className="rc-btn rc-btn--secondary" onClick={() => setIsEditing(true)}>
                  <FiEdit2 /> Edit
                </button>
                {canApprove && (
                  <button type="button" className="rc-btn rc-btn--primary" onClick={handleApprove} disabled={approving}>
                    {approving && <span className="rc-btn-spinner" />} {approving ? 'Approving…' : <><FiCheckCircle /> Approve</>}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
