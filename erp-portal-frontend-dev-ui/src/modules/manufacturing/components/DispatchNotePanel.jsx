import { useEffect, useState } from 'react';
import { ChevronRight, FileCheck, Pencil } from '@/icons/mfgIcons.js';
import toast from 'react-hot-toast';
import { dispatch } from '@/api';
import { StatusBadge } from '@/components/StatusBadge';
import { fmtDate } from '@/utils/format';
import Modal, { MfgModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import PhoneCountryInput from '@/components/PhoneCountryInput';
import PackingVerifyModal from '@/components/PackingVerifyModal';
import { MfgButton } from '@/components/MfgPageLayout.jsx';

const NEXT_LABELS = {
  'Packing Pending': 'Mark Packed',
  Packed: 'Mark Dispatch Note Created',
  'Dispatch Note Created': 'Mark Logistics Booked',
  'Logistics Booked': 'Mark Dispatched',
  Dispatched: 'Mark POD Received',
};

export default function DispatchNotePanel({
  note,
  onUpdated,
  onUploadPod,
  compact = false,
}) {
  const [advancing, setAdvancing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [packingOpen, setPackingOpen] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [pickList, setPickList] = useState([]);
  const [pickLoading, setPickLoading] = useState(false);

  useEffect(() => {
    if (!note?.name) {
      setPickList([]);
      return undefined;
    }
    let cancelled = false;
    setPickLoading(true);
    dispatch.getPickList(note.name)
      .then((rows) => {
        if (!cancelled) setPickList(rows || []);
      })
      .catch(() => {
        if (!cancelled) setPickList([]);
      })
      .finally(() => {
        if (!cancelled) setPickLoading(false);
      });
    return () => { cancelled = true; };
  }, [note?.name]);

  if (!note) return null;

  const needsPackingChecklist = note.status === 'Packing Pending'
    || note.requires_packing_checklist;

  const advance = async () => {
    if (needsPackingChecklist) {
      setPackingOpen(true);
      return;
    }
    setAdvancing(true);
    try {
      await dispatch.advance(note.name);
      toast.success('Status updated');
      onUpdated?.();
    } finally {
      setAdvancing(false);
    }
  };

  const openEdit = () => {
    setEditForm({
      vehicle_no: note.vehicle_no || '',
      transporter: note.transporter || '',
      driver_phone: note.driver_phone || '',
      delivery_address: note.destination || note.delivery_address || '',
      tracking_no: note.tracking_no || '',
      eway_bill_no: note.eway_bill_no || '',
      remarks: note.remarks || '',
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await dispatch.updateLogistics(note.name, editForm);
      toast.success('Logistics updated');
      setEditOpen(false);
      onUpdated?.();
    } finally {
      setSaving(false);
    }
  };

  const isTerminal = ['POD Received', 'Closed', 'Cancelled'].includes(note.status);
  const nextLabel = note.next_action_label || NEXT_LABELS[note.status];
  const canPod = note.can_upload_pod ?? note.status === 'Dispatched';
  const vehicleLine = [note.vehicle_no || 'No vehicle', note.transporter || 'No transporter']
    .filter(Boolean)
    .join(' · ');
  const fgDeducted = note.fg_deducted === 1 || note.fg_deducted === true;

  const formatWarehouse = (row) => {
    if (!row.warehouse) return null;
    const parts = [row.warehouse];
    if (row.rack || row.bin) {
      parts.push([row.rack, row.bin].filter(Boolean).join(' / '));
    }
    return parts;
  };

  return (
    <>
      <article className={`mfg-dispatch-card card${compact ? ' mfg-dispatch-card--compact' : ''}`}>
        <div className="mfg-dispatch-card__head">
          <p className="mfg-dispatch-card__id">{note.name}</p>
          <div className="mfg-dispatch-card__badges">
            <StatusBadge status={note.status} />
            {fgDeducted ? (
              <span className="mfg-dispatch-card__fg-deducted mfg-dispatch-card__fg-deducted--yes">
                FG Deducted
              </span>
            ) : (
              <span className="mfg-dispatch-card__fg-deducted">Not yet deducted</span>
            )}
            {(note.dn_status === 'Created' || note.delivery_note_ref) && (
              <span className="mfg-dispatch-card__invoiced" title={note.delivery_note_ref || 'Delivery Note created'}>
                DN ✓{note.delivery_note_ref ? ` ${note.delivery_note_ref}` : ''}
              </span>
            )}
            {note.is_overdue && (
              <span className="mfg-dispatch-card__overdue">Overdue delivery</span>
            )}
          </div>
        </div>

        <div className="mfg-dispatch-card__body">
          <h3 className="mfg-dispatch-card__title">{vehicleLine}</h3>
          <dl className="mfg-dispatch-card__meta">
            {note.driver_phone && (
              <div className="mfg-dispatch-card__meta-row">
                <dt>Driver</dt>
                <dd>
                  <a href={`tel:${note.driver_phone}`} className="mfg-dispatch-card__link">
                    {note.driver_phone}
                  </a>
                </dd>
              </div>
            )}
            <div className="mfg-dispatch-card__meta-row">
              <dt>Address</dt>
              <dd>{note.destination || note.delivery_address || '—'}</dd>
            </div>
            {note.tracking_no && (
              <div className="mfg-dispatch-card__meta-row">
                <dt>Tracking</dt>
                <dd>{note.tracking_no}</dd>
              </div>
            )}
            <div className="mfg-dispatch-card__meta-row">
              <dt>Dispatch date</dt>
              <dd>{fmtDate(note.dispatch_date)}</dd>
            </div>
          </dl>
        </div>

        <section className="mfg-dispatch-pick" aria-label="Pick list">
          <div className="mfg-dispatch-pick__head">
            <h4 className="mfg-dispatch-pick__title">Pick List — where to pick FG from</h4>
            <p className="mfg-dispatch-pick__subtitle">Reserved from Finished Goods warehouse</p>
          </div>
          {pickLoading && pickList.length === 0 ? (
            <p className="mfg-dispatch-pick__loading">Loading pick list…</p>
          ) : pickList.length === 0 ? (
            <p className="mfg-dispatch-pick__empty">No packed items on this dispatch note.</p>
          ) : (
            <>
              <div className="mfg-dispatch-pick__cols" aria-hidden="true">
                <span>Item</span>
                <span>From warehouse</span>
                <span>Batch</span>
                <span>Qty</span>
              </div>
              <ul className="mfg-dispatch-pick__list">
                {pickList.map((row, idx) => {
                  const whParts = formatWarehouse(row);
                  return (
                    <li key={`${row.item_code}-${idx}`} className="mfg-dispatch-pick__row">
                      <div className="mfg-dispatch-pick__item">
                        <span className="mfg-dispatch-pick__item-code">{row.item_code || '—'}</span>
                        {row.item_name && (
                          <span className="mfg-dispatch-pick__item-name">{row.item_name}</span>
                        )}
                      </div>
                      <div className="mfg-dispatch-pick__warehouse">
                        {whParts ? (
                          <>
                            <span>{whParts[0]}</span>
                            {whParts[1] && (
                              <span className="mfg-dispatch-pick__bin">{whParts[1]}</span>
                            )}
                          </>
                        ) : (
                          <span className="mfg-dispatch-pick__chip mfg-dispatch-pick__chip--warn">
                            Warehouse missing — set FG Warehouse on the Work Order
                          </span>
                        )}
                      </div>
                      <div className="mfg-dispatch-pick__batch">{row.batch_no || '—'}</div>
                      <div className="mfg-dispatch-pick__qty">
                        {row.qty ?? '—'}{row.uom ? ` ${row.uom}` : ''}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {!isTerminal && (
          <div className="mfg-dispatch-card__actions">
            {nextLabel && (
              <MfgButton size="sm" onClick={advance} disabled={advancing}>
                <ChevronRight size={16} aria-hidden />
                {advancing ? 'Updating…' : nextLabel}
              </MfgButton>
            )}
            <MfgButton size="sm" variant="secondary" onClick={openEdit}>
              <Pencil size={16} aria-hidden />
              Edit logistics
            </MfgButton>
            {canPod && onUploadPod && (
              <MfgButton
                size="sm"
                variant="secondary"
                className="mfg-btn--success"
                onClick={() => onUploadPod(note)}
              >
                <FileCheck size={16} aria-hidden />
                Upload POD
              </MfgButton>
            )}
          </div>
        )}

        {note.packing_verified && note.status !== 'Packing Pending' && (
          <p className="mfg-dispatch-card__notice mfg-dispatch-card__notice--success">
            Packing verified
            {note.packing_verified_by ? ` by ${note.packing_verified_by}` : ''}.
          </p>
        )}

        {note.status === 'POD Received' && (
          <p className="mfg-dispatch-card__notice mfg-dispatch-card__notice--success">
            Delivery confirmed — work order should be Delivered.
          </p>
        )}
      </article>

      <PackingVerifyModal
        open={packingOpen}
        onClose={() => setPackingOpen(false)}
        dispatchNoteName={note.name}
        onVerified={onUpdated}
      />

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit logistics — ${note.name}`}
        footer={(
          <MfgModalFooter
            onCancel={() => setEditOpen(false)}
            onSubmit={saveEdit}
            saving={saving}
            submitLabel="Save"
          />
        )}
      >
        <div className="space-y-3">
          <Field label="Vehicle No">
            <input className="input" value={editForm.vehicle_no}
              onChange={(e) => setEditForm({ ...editForm, vehicle_no: e.target.value })} />
          </Field>
          <Field label="Transporter">
            <input className="input" value={editForm.transporter}
              onChange={(e) => setEditForm({ ...editForm, transporter: e.target.value })} />
          </Field>
          <Field label="Driver Phone">
            <PhoneCountryInput
              value={editForm.driver_phone}
              onChange={(driver_phone) => setEditForm({ ...editForm, driver_phone })}
            />
          </Field>
          <Field label="Tracking No">
            <input className="input" value={editForm.tracking_no}
              onChange={(e) => setEditForm({ ...editForm, tracking_no: e.target.value })} />
          </Field>
          <Field label="E-Way Bill">
            <input className="input" value={editForm.eway_bill_no}
              onChange={(e) => setEditForm({ ...editForm, eway_bill_no: e.target.value })} />
          </Field>
          <Field label="Delivery Address">
            <textarea className="input" rows={2} value={editForm.delivery_address}
              onChange={(e) => setEditForm({ ...editForm, delivery_address: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
