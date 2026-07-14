import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { closure } from '@/api';
import { uploadFile } from '@/api/files';
import Modal, { MfgModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import FileDropZone from '@/components/FileDropZone';
import { MfgButton } from '@/components/MfgPageLayout.jsx';
import { revokeFilePreview } from '@/utils/filePreview';

export default function PODUploadModal({
  open,
  onClose,
  workOrder,
  dispatchNotes = [],
  defaultDispatchNote = '',
  onUploaded,
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    dispatch_note: '',
    received_by: '',
    received_date: today,
    delivery_status: 'Received',
    customer_remarks: '',
    received_qty: '',
    short_reason: '',
  });
  const [files, setFiles] = useState([]);
  const [woContext, setWoContext] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !workOrder) return;
    const note = defaultDispatchNote
      || dispatchNotes.find((n) => n.status === 'Dispatched' || n.can_upload_pod)?.name
      || dispatchNotes[0]?.name
      || '';
    setForm({
      dispatch_note: note,
      received_by: '',
      received_date: today,
      delivery_status: 'Received',
      customer_remarks: '',
      received_qty: '',
      short_reason: '',
    });
    setFiles([]);
    closure.getPodContext(workOrder)
      .then(setWoContext)
      .catch(() => setWoContext(null));
  }, [open, workOrder, defaultDispatchNote, dispatchNotes, today]);

  useEffect(() => () => {
    files.forEach((f) => {
      if (f.preview) revokeFilePreview(f.preview);
    });
  }, [files]);

  const isPartial = form.delivery_status === 'Partial';
  const orderQty = woContext?.qty ?? woContext?.quantity;
  const itemLabel = woContext?.item_code || woContext?.deliverable;
  const customerLabel = woContext?.customer || woContext?.customer_name;

  const submit = async () => {
    if (!form.dispatch_note) {
      toast.error('Select a dispatch note');
      return;
    }
    if (!form.received_by.trim()) {
      toast.error('Received by is required');
      return;
    }
    if (files.length === 0) {
      toast.error('Upload at least one POD file');
      return;
    }
    if (isPartial) {
      if (!form.received_qty && form.received_qty !== 0) {
        toast.error('Received Qty is required for partial delivery');
        return;
      }
      if (!form.short_reason.trim()) {
        toast.error('Short reason is required for partial delivery');
        return;
      }
    }

    setSaving(true);
    try {
      const uploaded = [];
      for (const item of files) {
        const fileUrl = await uploadFile(item.file);
        uploaded.push({
          file: fileUrl,
          attachment_type: item.attachment_type,
        });
      }

      await closure.uploadPod({
        work_order: workOrder,
        dispatch_note: form.dispatch_note,
        received_by: form.received_by,
        received_date: form.received_date,
        delivery_status: form.delivery_status,
        customer_remarks: form.customer_remarks,
        received_qty: isPartial ? form.received_qty : undefined,
        short_reason: isPartial ? form.short_reason : undefined,
        pod_attachment: uploaded[0]?.file,
        attachments: uploaded,
      });
      toast.success('POD uploaded — work order marked Delivered');
      onUploaded?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const dispatchedNotes = dispatchNotes.filter(
    (n) => n.status === 'Dispatched' || n.can_upload_pod,
  );
  const noteOptions = dispatchedNotes.length ? dispatchedNotes : dispatchNotes;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload Proof of Delivery"
      size="xl"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          submitLabel="Submit POD"
          savingLabel="Uploading…"
        />
      )}
    >
      <div className="mfg-wo-modal-form mfg-pod-upload-form">
        {(workOrder || woContext) && (
          <div className="mfg-pod-upload-form__wo">
            <p className="mfg-pod-upload-form__wo-id">{workOrder}</p>
            <p className="mfg-pod-upload-form__wo-meta">
              {[customerLabel, itemLabel, orderQty != null ? `Order qty: ${orderQty}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        )}

        <div className="mfg-pod-upload-form__layout">
          <div className="mfg-pod-upload-form__fields">
            <div className="mfg-pod-upload-form__grid">
              <Field label="Dispatch Note" required>
                <select
                  className="pm-input"
                  value={form.dispatch_note}
                  onChange={(e) => setForm({ ...form, dispatch_note: e.target.value })}
                >
                  <option value="">Select dispatch note…</option>
                  {noteOptions.map((n) => (
                    <option key={n.name} value={n.name}>
                      {n.name} ({n.status})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Delivery Status">
                <select
                  className="pm-input"
                  value={form.delivery_status}
                  onChange={(e) => setForm({ ...form, delivery_status: e.target.value })}
                >
                  <option>Received</option>
                  <option>Partial</option>
                  <option>Rejected</option>
                </select>
              </Field>

              <Field label="Received By" required>
                <input
                  className="pm-input"
                  placeholder="Customer representative name"
                  value={form.received_by}
                  onChange={(e) => setForm({ ...form, received_by: e.target.value })}
                />
              </Field>

              <Field label="Received Date" required>
                <input
                  type="date"
                  className="pm-input mfg-wo-modal-form__date"
                  value={form.received_date}
                  onChange={(e) => setForm({ ...form, received_date: e.target.value })}
                />
              </Field>
            </div>

            {isPartial && (
              <div className="mfg-wo-modal-form__alert mfg-wo-modal-form__alert--warn mfg-pod-upload-form__partial">
                <div className="mfg-pod-upload-form__grid mfg-pod-upload-form__partial-grid">
                  <Field label="Received Qty" required>
                    <input
                      type="number"
                      min="1"
                      max={orderQty ? orderQty - 1 : undefined}
                      className="pm-input"
                      placeholder={orderQty ? `Less than ${orderQty}` : 'e.g. 95'}
                      value={form.received_qty}
                      onChange={(e) => setForm({ ...form, received_qty: e.target.value })}
                    />
                  </Field>
                  <Field label="Short Reason" required>
                    <input
                      className="pm-input"
                      placeholder="e.g. 5 pcs damaged in transit"
                      value={form.short_reason}
                      onChange={(e) => setForm({ ...form, short_reason: e.target.value })}
                    />
                  </Field>
                </div>
                {orderQty && form.received_qty && (
                  <p className="mfg-wo-modal-form__hint mfg-pod-upload-form__shortage">
                    Shortage: {Math.max(0, Number(orderQty) - Number(form.received_qty))} pcs
                  </p>
                )}
              </div>
            )}

            <Field label="Customer Remarks">
              <textarea
                className="pm-input mfg-pod-upload-form__remarks"
                rows={2}
                placeholder="Optional notes from customer"
                value={form.customer_remarks}
                onChange={(e) => setForm({ ...form, customer_remarks: e.target.value })}
              />
            </Field>
          </div>

          <div className="mfg-pod-upload-form__files">
            <Field
              label="POD Files"
              required
              hint="Max 3 files — PDF or image"
            >
              <FileDropZone files={files} onChange={setFiles} compact />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  );
}
