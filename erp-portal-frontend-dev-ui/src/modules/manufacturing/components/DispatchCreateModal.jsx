import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { dispatch } from '@/api';
import Modal, { MfgModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import PhoneCountryInput from '@/components/PhoneCountryInput';

const emptyForm = {
  vehicle_no: '',
  transporter: '',
  driver_phone: '',
  delivery_address: '',
  tracking_no: '',
  eway_bill_no: '',
};

export default function DispatchCreateModal({
  open,
  onClose,
  workOrder,
  workOrderHint,
  onCreated,
}) {
  const [form, setForm] = useState(emptyForm);
  const [shipItems, setShipItems] = useState([]);
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !workOrder) return undefined;

    let cancelled = false;
    setForm(emptyForm);
    setShipItems([]);
    setDefaultsLoading(true);

    (async () => {
      try {
        const defaults = await dispatch.getCreateDefaults(workOrder);
        if (cancelled) return;
        const eway = (defaults?.eway_bill_no || '').trim();
        setForm((prev) => ({
          ...prev,
          eway_bill_no: eway || prev.eway_bill_no,
        }));
        setShipItems(Array.isArray(defaults?.items) ? defaults.items : []);
      } catch {
        if (!cancelled) setShipItems([]);
      } finally {
        if (!cancelled) setDefaultsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, workOrder]);

  const submit = async () => {
    if (!workOrder) {
      toast.error('Work order is required');
      return;
    }
    if (!form.delivery_address?.trim()) {
      toast.error('Delivery address is required');
      return;
    }
    setSaving(true);
    try {
      const payload = { work_order: workOrder, ...form };
      if (shipItems.length) {
        payload.items = shipItems.map((row) => ({
          item_code: row.item_code,
          item_name: row.item_name,
          packed_qty: row.packed_qty ?? row.qty,
          uom: row.uom || 'Nos',
        }));
      }
      await dispatch.create(payload);
      toast.success('Dispatch note created');
      onCreated?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Dispatch Note"
      size="lg"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          submitLabel="Create Note"
          savingLabel="Creating…"
        />
      )}
    >
      <div className="mfg-wo-modal-form mfg-dispatch-create-form">
        {workOrder && (
          <div className="mfg-dispatch-create-form__wo">
            <p className="mfg-dispatch-create-form__wo-id">{workOrder}</p>
            {workOrderHint ? (
              <p className="mfg-dispatch-create-form__wo-meta">{workOrderHint.replace(/^ · /, '')}</p>
            ) : null}
          </div>
        )}

        <section className="mfg-dispatch-create-form__items" aria-label="Finished goods to dispatch">
          <div className="mfg-dispatch-create-form__items-head">
            <h3 className="mfg-dispatch-create-form__items-title">Finished goods to ship</h3>
            <p className="mfg-dispatch-create-form__items-subtitle">
              Auto-filled from this work order&apos;s deliverable
            </p>
          </div>

          {defaultsLoading ? (
            <p className="mfg-dispatch-create-form__items-loading">Loading items…</p>
          ) : shipItems.length === 0 ? (
            <p className="mfg-dispatch-create-form__items-empty">
              No finished goods found on this work order — set deliverable and quantity first.
            </p>
          ) : (
            <>
              <div className="mfg-dispatch-create-form__items-cols" aria-hidden="true">
                <span>Item</span>
                <span>From warehouse</span>
                <span>Qty</span>
              </div>
              <ul className="mfg-dispatch-create-form__items-list">
                {shipItems.map((row) => (
                  <li key={row.item_code} className="mfg-dispatch-create-form__items-row">
                    <div className="mfg-dispatch-create-form__item-cell">
                      <span className="mfg-dispatch-create-form__item-code">{row.item_code}</span>
                      {row.item_name && row.item_name !== row.item_code ? (
                        <span className="mfg-dispatch-create-form__item-name">{row.item_name}</span>
                      ) : null}
                    </div>
                    <div className="mfg-dispatch-create-form__warehouse-cell">
                      {row.warehouse ? (
                        <span>{row.warehouse}</span>
                      ) : (
                        <span className="mfg-dispatch-pick__chip mfg-dispatch-pick__chip--warn">
                          Warehouse missing — set FG Warehouse on the Work Order
                        </span>
                      )}
                    </div>
                    <div className="mfg-dispatch-create-form__qty-cell">
                      {row.packed_qty ?? row.qty}{row.uom ? ` ${row.uom}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className="mfg-dispatch-create-form__grid">
          <Field label="Vehicle No">
            <input
              className="pm-input"
              placeholder="MH-12-AB-1234"
              value={form.vehicle_no}
              onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })}
            />
          </Field>
          <Field label="Transporter">
            <input
              className="pm-input"
              placeholder="VRL Logistics"
              value={form.transporter}
              onChange={(e) => setForm({ ...form, transporter: e.target.value })}
            />
          </Field>
          <Field label="Tracking No">
            <input
              className="pm-input"
              placeholder="Optional tracking number"
              value={form.tracking_no}
              onChange={(e) => setForm({ ...form, tracking_no: e.target.value })}
            />
          </Field>
          <Field label="E-Way Bill No">
            <input
              className="pm-input mfg-input--readonly"
              placeholder="Entered by Finance before dispatch"
              value={form.eway_bill_no}
              readOnly
              aria-readonly="true"
            />
          </Field>
        </div>

        <Field label="Driver Phone">
          <PhoneCountryInput
            value={form.driver_phone}
            onChange={(driver_phone) => setForm({ ...form, driver_phone })}
          />
        </Field>

        <Field label="Delivery Address" required>
          <textarea
            className="pm-input mfg-dispatch-create-form__address"
            rows={3}
            placeholder="Customer plant / gate address"
            value={form.delivery_address}
            onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}
