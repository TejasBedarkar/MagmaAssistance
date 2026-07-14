import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { maintenance } from '@/api';
import { useAuth } from '@/hooks/manufacturingAuth';
import Modal, { MfgModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import MfgCombobox from '@/components/MfgCombobox';

const BREAKDOWN_REASONS = [
  'Machine Downtime',
  'Operator Issue',
  'Sensor Alert',
  'Other',
];

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const defaultForm = {
  workstation: '',
  breakdown_reason: 'Machine Downtime',
  description: '',
  priority: 'High',
  work_order: '',
  job_card: '',
};

const EMPTY_INITIAL = {};

export default function BreakdownReportModal({
  open,
  onClose,
  onSuccess,
  initialValues = EMPTY_INITIAL,
}) {
  const { lookups } = useAuth();
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const workstationItems = useMemo(
    () => (lookups?.workstations || []).map((ws) => ({
      value: ws.name || ws.workstation_name,
      label: ws.workstation_name || ws.name,
    })),
    [lookups?.workstations],
  );
  const breakdownReasonItems = useMemo(
    () => BREAKDOWN_REASONS.map((reason) => ({ value: reason, label: reason })),
    [],
  );
  const priorityItems = useMemo(
    () => PRIORITIES.map((p) => ({ value: p, label: p })),
    [],
  );

  useEffect(() => {
    if (!open) return;
    setForm({
      ...defaultForm,
      workstation: initialValues.workstation || '',
      work_order: initialValues.work_order || '',
      job_card: initialValues.job_card || '',
      description: initialValues.description || '',
      breakdown_reason: initialValues.breakdown_reason || 'Machine Downtime',
      priority: initialValues.priority || 'High',
    });
  }, [
    open,
    initialValues.workstation,
    initialValues.work_order,
    initialValues.job_card,
    initialValues.description,
    initialValues.breakdown_reason,
    initialValues.priority,
  ]);

  const canSubmit = Boolean(form.workstation && form.breakdown_reason);

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const result = await maintenance.reportBreakdown({
        workstation: form.workstation,
        breakdown_reason: form.breakdown_reason,
        description: form.description || undefined,
        work_order: form.work_order || undefined,
        job_card: form.job_card || undefined,
        priority: form.priority,
      });
      if (result?.existing) {
        toast.success('Open ticket already exists for this workstation');
      } else {
        toast.success('Breakdown reported');
      }
      if (result?.job_card?.status === 'Paused') {
        toast.success(
          result.job_card.action === 'updated'
            ? 'Job pause reason updated'
            : 'Job paused for maintenance',
        );
      }
      onSuccess?.(result);
      onClose();
    } catch {
      /* toast from API client */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report Breakdown"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          submitLabel="Report Breakdown"
          canSubmit={canSubmit}
        />
      )}
    >
      <div className="mfg-wo-modal-form mfg-breakdown-form">
        <Field label="Workstation" required>
          <MfgCombobox
            value={form.workstation}
            onChange={(value) => setForm((prev) => ({ ...prev, workstation: value }))}
            items={workstationItems}
            placeholder="Select workstation…"
            disabled={Boolean(initialValues.workstation)}
            placement="below"
          />
        </Field>
        <div className="mfg-wo-modal-form__row-2">
          <Field label="Breakdown reason" required>
            <MfgCombobox
              value={form.breakdown_reason}
              onChange={(breakdown_reason) => setForm((prev) => ({ ...prev, breakdown_reason: breakdown_reason || BREAKDOWN_REASONS[0] }))}
              items={breakdownReasonItems}
              placeholder="Select reason…"
              placement="below"
            />
          </Field>
          <Field label="Priority" required>
            <MfgCombobox
              value={form.priority}
              onChange={(priority) => setForm((prev) => ({ ...prev, priority: priority || PRIORITIES[2] }))}
              items={priorityItems}
              placeholder="Select priority…"
              placement="below"
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            className="pm-input"
            rows={3}
            placeholder="What happened on the shop floor?"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          />
        </Field>
        {form.work_order ? (
          <p className="mfg-wo-modal-form__lead">
            Linked work order: <strong>{form.work_order}</strong>
            {form.job_card ? (
              <>
                {' · '}
                Job card: <strong>{form.job_card}</strong>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
