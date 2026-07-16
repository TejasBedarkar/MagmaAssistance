import { useEffect, useState } from 'react';
import { Check } from '@/icons/mfgIcons.js';
import toast from 'react-hot-toast';
import { dispatch } from '@/api';
import Modal, { MfgModalFooter } from '@/components/Modal';

const FALLBACK_ITEMS = [
  { id: 'qty_match', label: 'Packed quantity matches dispatch note / work order qty' },
  { id: 'full_material', label: 'Full material packed — nothing left behind on shop floor' },
  { id: 'labels_ok', label: 'Item labels, batch no. and box marking verified' },
  { id: 'no_damage', label: 'No visible damage on packed cartons / pallets' },
  { id: 'seal_ok', label: 'Boxes sealed, strapped and ready for loading' },
];

export default function PackingVerifyModal({
  open,
  onClose,
  dispatchNoteName,
  onVerified,
}) {
  const [items, setItems] = useState([]);
  const [checked, setChecked] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    dispatch.getPackingChecklist()
      .then((list) => {
        const rows = list?.length ? list : FALLBACK_ITEMS;
        setItems(rows);
        setChecked(Object.fromEntries(rows.map((r) => [r.id, false])));
      })
      .catch(() => {
        setItems(FALLBACK_ITEMS);
        setChecked(Object.fromEntries(FALLBACK_ITEMS.map((r) => [r.id, false])));
      })
      .finally(() => setLoading(false));
  }, [open]);

  const toggle = (id) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const allChecked = items.length > 0 && items.every((item) => checked[item.id]);

  const submit = async () => {
    if (!allChecked) {
      toast.error('Please tick all packing checklist items');
      return;
    }
    const payload = items.map((item) => ({
      id: item.id,
      label: item.label,
      checked: !!checked[item.id],
    }));
    setSubmitting(true);
    try {
      await dispatch.advance(dispatchNoteName, payload);
      toast.success('Marked as Packed');
      onVerified?.();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Packing verification"
      size="lg"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={submitting}
          submitLabel="Confirm & Mark Packed"
          canSubmit={!loading && allChecked}
        />
      )}
    >
      <div className="mfg-packing-verify">
        <p className="mfg-packing-verify__lead">
          Dispatch note <strong>{dispatchNoteName}</strong>
          {' '}— verify full material is packed before moving to <strong>Packed</strong>.
        </p>

        {loading ? (
          <p className="mfg-packing-verify__loading">Loading checklist…</p>
        ) : (
          <ul className="mfg-packing-checklist">
            {items.map((item) => {
              const isOn = !!checked[item.id];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => toggle(item.id)}
                    className={`mfg-packing-checklist__item${isOn ? ' mfg-packing-checklist__item--checked' : ''}`}
                  >
                    <span className="mfg-packing-checklist__box" aria-hidden="true">
                      {isOn ? <Check size={13} strokeWidth={3} /> : null}
                    </span>
                    <span className="mfg-packing-checklist__label">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!allChecked && !loading ? (
          <p className="mfg-packing-verify__hint">
            All items must be ticked to confirm full packing.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
