import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiArrowLeft, FiRotateCcw, FiClipboard, FiPlus, FiX,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import './ScratchCards.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const fmtGBP = (val) => {
  if (val == null) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : `£${n.toFixed(2)}`;
};

const SCRATCH_CARD_ORDER_KEY = 'scratch-card-display-order';

const readStoredCardOrder = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SCRATCH_CARD_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const writeStoredCardOrder = (ids) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SCRATCH_CARD_ORDER_KEY, JSON.stringify(ids));
  window.dispatchEvent(new Event('scratch-card-order-updated'));
};

const getOrderedCards = (cards) => {
  const order = readStoredCardOrder();
  const orderMap = new Map(order.map((id, index) => [String(id), index]));

  return [...cards].sort((a, b) => {
    const aKey = String(a.id ?? '');
    const bKey = String(b.id ?? '');
    const aOrder = orderMap.get(aKey);
    const bOrder = orderMap.get(bKey);

    if (aOrder === undefined && bOrder === undefined) return 0;
    if (aOrder === undefined) return 1;
    if (bOrder === undefined) return -1;
    return aOrder - bOrder;
  });
};

/* ── Inline "Set Open Value" popover ───────────────────────────────── */
function OpenValuePopover({ cardId, onSet, onClose, busy }) {
  const [custom, setCustom] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    /* focus custom input after preset buttons */
  }, []);

  const submit = (val) => {
    if (val === '' || val === null || val === undefined) return;
    onSet(cardId, String(val));
  };

  return (
    <div className="sc-popover">
      <span className="sc-popover-label">Set open value:</span>

      <div className="sc-popover-presets">
        <button
          className="sc-preset-btn"
          onClick={() => submit('0000')}
          disabled={busy}
        >0000</button>
        <button
          className="sc-preset-btn"
          onClick={() => submit('1000')}
          disabled={busy}
        >1000</button>
      </div>

      <div className="sc-popover-custom">
        <input
          ref={inputRef}
          className="sc-custom-input"
          type="number"
          placeholder="Custom…"
          min={0}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit(custom)}
          autoFocus
        />
        <button
          className="sc-custom-set-btn"
          onClick={() => submit(custom)}
          disabled={busy || !custom.trim()}
        >
          {busy ? '…' : 'Set'}
        </button>
      </div>

      <button className="sc-popover-cancel" onClick={onClose} disabled={busy}>
        <FiX />
      </button>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────── */
export const ScratchCards = () => {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const { showToast } = useToast();
  const [cards, setCards]       = useState([]);
  const [loading, setLoading]   = useState(true);

  /* Popover state */
  const [popoverId, setPopoverId]   = useState(null);
  const [settingId, setSettingId]   = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  /* Add-form state */
  const [newCardNo, setNewCardNo] = useState('');
  const [newPrice,  setNewPrice]  = useState('');
  const [adding, setAdding]       = useState(false);
  const [draggedCardId, setDraggedCardId] = useState(null);

  const fetchCards = useCallback(async (options = {}) => {
    const { silent = false } = options;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/lottery/scratch-cards`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      setCards(getOrderedCards(await res.json()));
    } catch {
      if (!silent) {
        showToast('Failed to load scratch cards', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  /* ── Set open value ── */
  const handleSetOpenValue = async (id, value) => {
    setSettingId(id);
    try {
      const res = await fetch(`${API_BASE}/admin/lottery/scratch-cards/${id}/open-value`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ openValue: parseInt(value, 10) }),
      });
      if (!res.ok) throw new Error();
      setPopoverId(null);
      showToast(`Open value set to ${value}`);
      fetchCards();
    } catch {
      showToast('Failed to set open value', 'error');
    } finally {
      setSettingId(null);
    }
  };

  /* ── Toggle active/inactive ── */
  const handleToggle = async (id, currentlyActive) => {
    setTogglingId(id);
    try {
      const res = await fetch(`${API_BASE}/admin/lottery/scratch-cards/${id}/toggle`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) throw new Error();
      showToast(currentlyActive ? 'Card deactivated' : 'Card activated');
      fetchCards();
    } catch {
      showToast('Failed to update status', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  /* ── Reorder scratch cards ── */
  const handleSwapCards = (sourceId, targetId) => {
    if (!sourceId || !targetId || String(sourceId) === String(targetId)) return;

    setCards((prev) => {
      const current = [...prev];
      const sourceIndex = current.findIndex((card) => String(card.id) === String(sourceId));
      const targetIndex = current.findIndex((card) => String(card.id) === String(targetId));
      if (sourceIndex < 0 || targetIndex < 0) return prev;

      const next = [...current];
      [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
      writeStoredCardOrder(next.map((card) => String(card.id)));
      return next;
    });
  };

  const handleRowDrop = (targetId) => {
    if (!isAdmin || !draggedCardId || String(draggedCardId) === String(targetId)) {
      setDraggedCardId(null);
      return;
    }

    handleSwapCards(draggedCardId, targetId);
    setDraggedCardId(null);
  };

  /* ── Delete scratch card ── */
  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this scratch card?')) return;

    setDeletingId(id);
    try {
      const res = await fetch(`${API_BASE}/admin/lottery/scratch-cards/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user.token}` },
      });

      let backendMessage = 'Failed to delete scratch card';
      const responseText = await res.text();
      if (responseText) {
        try {
          const parsed = JSON.parse(responseText);
          backendMessage = parsed.message || parsed.error || parsed.title || backendMessage;
        } catch {
          backendMessage = responseText;
        }
      }

      if (!res.ok) throw new Error(backendMessage);

      const remainingOrder = readStoredCardOrder().filter((cardId) => String(cardId) !== String(id));
      writeStoredCardOrder(remainingOrder);
      setCards((prev) => prev.filter((card) => String(card.id) !== String(id)));
      showToast('Scratch card deleted successfully');
      await fetchCards({ silent: true });
    } catch (error) {
      showToast(error.message || 'Failed to delete scratch card', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  /* ── Add new scratch card ── */
  const handleAdd = async () => {
    if (!newCardNo.trim()) { showToast('Enter a scratch card number', 'error'); return; }
    if (!newPrice || parseFloat(newPrice) <= 0) { showToast('Enter a valid price', 'error'); return; }
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE}/admin/lottery/scratch-cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ scratchCardNo: newCardNo.trim(), price: parseFloat(newPrice) }),
      });
      if (!res.ok) throw new Error();
      showToast(`Scratch card "${newCardNo.trim()}" added`);
      setNewCardNo('');
      setNewPrice('');
      fetchCards();
    } catch {
      showToast('Failed to add scratch card', 'error');
    } finally {
      setAdding(false);
    }
  };

  const isAdmin = user?.role === 'admin';

  return (
    <motion.div
      className="sc-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
    >

      <button className="sc-back-btn" onClick={() => navigate('/admin/dashboard')}>
        <FiArrowLeft /> Back to Dashboard
      </button>

      {/* ── Page title ── */}
      <div className="sc-page-header">
        <h1 className="sc-page-title"><FiRotateCcw /> Reset Scratch Cards</h1>
        <p className="sc-page-sub">
          Manage scratch card status and set forced open values for the staff lottery portal.
        </p>
      </div>

      {/* ── Section 1: Existing scratch cards ── */}
      <div className="sc-panel">
        <div className="sc-panel-header">
          <h2 className="sc-panel-title"><FiClipboard /> Existing Scratch Cards</h2>
          <p className="sc-panel-sub">
            Inactive cards are hidden from staff but manageable here. Open Value resets automatically after staff saves. Drag a row onto another row to swap their positions.
          </p>
        </div>

        {loading ? (
          <div className="sc-center">
            <div className="sc-spinner" />
            <p>Loading scratch cards…</p>
          </div>
        ) : cards.length === 0 ? (
          <div className="sc-empty">
            <div className="sc-empty-icon"><FiRotateCcw /></div>
            <p>No scratch cards yet. Add one below.</p>
          </div>
        ) : (
          <div className="sc-table-wrap">
            <table className="sc-table">
              <thead>
                <tr>
                  <th>Scratch Card No</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Open Value</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr
                    key={card.id}
                    className={`${card.isActive ? '' : 'sc-row--inactive'} ${draggedCardId === card.id ? 'sc-row--dragging' : ''}`}
                    draggable={isAdmin}
                    onDragStart={() => setDraggedCardId(card.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleRowDrop(card.id)}
                    onDragEnd={() => setDraggedCardId(null)}
                  >

                    {/* Scratch card number */}
                    <td className="sc-td-cardno">
                      {isAdmin && (
                        <span className="sc-drag-handle" title="Drag to swap position">⋮⋮</span>
                      )}
                      <span className="sc-card-no">{card.scratchCardNo || '—'}</span>
                    </td>

                    {/* Price */}
                    <td className="sc-td-price">{fmtGBP(card.price)}</td>

                    {/* Status badge */}
                    <td>
                      {card.isActive
                        ? <span className="sc-badge sc-badge--active">Active</span>
                        : <span className="sc-badge sc-badge--inactive">Inactive</span>}
                    </td>

                    {/* Open value */}
                    <td className="sc-td-openval">
                      {card.forcedOpenNo != null && card.forcedOpenNo !== ''
                        ? <span className="sc-openval">{card.forcedOpenNo}</span>
                        : <span className="sc-openval-none">—</span>}
                    </td>

                    {/* Actions */}
                    <td className="sc-td-actions">
                      <div className="sc-actions-wrap">

                        {isAdmin && (
                          <span className="sc-drag-hint"></span>
                        )}

                        {/* Set open value */}
                        {popoverId === card.id ? (
                          <OpenValuePopover
                            cardId={card.id}
                            onSet={handleSetOpenValue}
                            onClose={() => setPopoverId(null)}
                            busy={settingId === card.id}
                          />
                        ) : (
                          <button
                            className="sc-action-btn sc-action-btn--open"
                            onClick={() => setPopoverId(card.id)}
                          >
                            Set Open Value
                          </button>
                        )}

                        {/* Activate / Deactivate */}
                        <button
                          className={`sc-action-btn ${card.isActive ? 'sc-action-btn--deactivate' : 'sc-action-btn--activate'}`}
                          onClick={() => handleToggle(card.id, card.isActive)}
                          disabled={togglingId === card.id}
                        >
                          {togglingId === card.id
                            ? '…'
                            : card.isActive ? 'Deactivate' : 'Activate'}
                        </button>

                        {isAdmin && (
                          <button
                            className="sc-action-btn sc-action-btn--delete"
                            onClick={() => handleDelete(card.id)}
                            disabled={deletingId === card.id}
                          >
                            {deletingId === card.id ? '…' : 'Delete'}
                          </button>
                        )}

                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 2: Add new scratch card ── */}
      <div className="sc-panel">
        <div className="sc-panel-header">
          <h2 className="sc-panel-title"><FiPlus /> Add New Scratch Card</h2>
          <p className="sc-panel-sub">New cards are active by default and visible to staff immediately.</p>
        </div>

        <div className="sc-add-form">
          <div className="sc-field">
            <label className="sc-label">Scratch Card No</label>
            <input
              className="sc-input"
              type="text"
              placeholder="e.g. SC-001"
              value={newCardNo}
              onChange={(e) => setNewCardNo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>

          <div className="sc-field">
            <label className="sc-label">Price per ticket (£)</label>
            <input
              className="sc-input sc-input--price"
              type="number"
              placeholder="e.g. 1.00"
              min={0.01}
              step={0.01}
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>

          <button
            className="sc-add-btn"
            onClick={handleAdd}
            disabled={adding || !newCardNo.trim() || !newPrice}
          >
            {adding ? <><span className="sc-btn-spinner" /> Adding…</> : <><FiPlus /> Add Scratch Card</>}
          </button>
        </div>
      </div>

    </motion.div>
  );
};
