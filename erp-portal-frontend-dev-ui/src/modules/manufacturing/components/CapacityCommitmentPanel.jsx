import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList } from '@/icons/mfgIcons.js';
import { capacityCommitment } from '@/api';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { useAuth, ROLES } from '@/hooks/manufacturingAuth';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function Field({ label, children }) {
  return (
    <label className="mfg-cap-commit__field">
      <span className="mfg-cap-commit__label">{label}</span>
      {children}
    </label>
  );
}

function alertClass(status) {
  if (status === 'available') return 'mfg-cap-commit-alert--ok';
  if (status === 'next_slot') return 'mfg-cap-commit-alert--warn';
  return 'mfg-cap-commit-alert--error';
}

function scheduleFromDetail(data) {
  const committed = data?.commitment || {};
  const slotSchedule = data?.slot_schedule || {};
  const scheduleReady = Boolean(slotSchedule.schedule_ready);
  return {
    production_start_date:
      committed.production_start_date
      || slotSchedule.production_start_date
      || '',
    production_completion_estimate:
      committed.production_completion_estimate
      || slotSchedule.production_completion_estimate
      || '',
    machine_allocation: (() => {
      if (Array.isArray(committed.machine_allocation) && committed.machine_allocation.length) {
        return committed.machine_allocation;
      }
      if (Array.isArray(slotSchedule.machine_allocation) && slotSchedule.machine_allocation.length) {
        return slotSchedule.machine_allocation;
      }
      return [];
    })(),
    capacity_available_confirmed: Boolean(
      committed.capacity_available_confirmed
      || scheduleReady
      || slotSchedule.capacity_available,
    ),
  };
}

export default function CapacityCommitmentPanel({ quotation, onCommitted, onClose }) {
  const { role, isAdministrator } = useAuth();
  const canCommit = role === ROLES.PRODUCTION_HEAD || isAdministrator;

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    production_start_date: '',
    production_completion_estimate: '',
    machine_allocation: [],
    capacity_available_confirmed: false,
  });

  const load = useCallback(async () => {
    if (!quotation) {
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      const data = await capacityCommitment.getDetail(quotation);
      if (data?.status !== 'success') {
        toast.error(data?.message || 'Could not load quotation detail.');
        setDetail(null);
        return;
      }
      setDetail(data);
      setForm(scheduleFromDetail(data));
    } catch (err) {
      toast.error(err?.message || 'Could not load quotation detail.');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [quotation]);

  useEffect(() => {
    load();
  }, [load]);

  const allocation = Array.isArray(form.machine_allocation) ? form.machine_allocation : [];
  const allocationOverloaded = allocation.some(
    (row) => Number(row.capacity_hours || 0) > 0
      && Number(row.allocated_hours || 0) > Number(row.capacity_hours || 0),
  );

  const machineAlerts = Array.isArray(detail?.machine_alerts)
    ? detail.machine_alerts
    : (Array.isArray(detail?.capacity_check?.machine_alerts) ? detail.capacity_check.machine_alerts : []);

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateAllocationHours = (idx, value) => {
    const next = allocation.map((row, i) => (
      i === idx ? { ...row, allocated_hours: Number(value) || 0 } : row
    ));
    setField('machine_allocation', next);
  };

  const onSave = async () => {
    if (!quotation) return;
    setBusy(true);
    try {
      const result = await capacityCommitment.commit({
        name: quotation,
        production_start_date: form.production_start_date,
        production_completion_estimate: form.production_completion_estimate,
        machine_allocation: form.machine_allocation,
        capacity_available_confirmed: form.capacity_available_confirmed ? 1 : 0,
      });
      if (result?.status !== 'success') {
        toast.error(result?.message || 'Could not commit capacity.');
        return;
      }
      const sync = result?.capacity_plan_sync;
      if (sync?.status === 'success') {
        toast.success(sync.message || 'Production capacity committed and capacity plan synced.');
      } else if (sync?.status === 'pending') {
        toast.success('Production capacity committed. Capacity plan will sync when a work order exists.');
      } else if (sync?.status === 'partial' || sync?.status === 'error') {
        toast.success('Production capacity committed.');
        toast.error(sync?.message || 'Could not fully sync MFG capacity plan.');
      } else {
        toast.success('Production capacity committed.');
      }
      onCommitted?.();
      await load();
    } catch (err) {
      toast.error(err?.message || 'Could not commit capacity.');
    } finally {
      setBusy(false);
    }
  };

  const summaryLine = useMemo(() => {
    if (!detail?.items?.length) return '';
    return detail.items
      .slice(0, 3)
      .map((it) => `${it.item_code} ×${it.qty}`)
      .join(', ');
  }, [detail]);

  if (!quotation) {
    return (
      <div className="mfg-cap-commit-panel mfg-cap-commit-panel--empty">
        <EmptyState
          icon={ClipboardList}
          title="Select a quotation"
          description="Choose a quotation from the list to review capacity and commit production dates."
        />
      </div>
    );
  }

  if (loading && !detail) {
    return (
      <div className="mfg-cap-commit-panel">
        <PageLoader label="Loading quotation capacity…" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mfg-cap-commit-panel mfg-cap-commit-panel--empty">
        <EmptyState icon={ClipboardList} title="Quotation not found" />
      </div>
    );
  }

  const committed = Boolean(detail.commitment?.capacity_committed);
  const planStatus = detail.delivery_plan_status || detail.planning?.delivery_plan_status || '';
  const requiredHours = Number(
    detail?.slot_schedule?.required_hours
    || detail?.capacity_check?.total_required_hours
    || 0,
  );
  const needsCommit = machineAlerts.some((row) => row.status !== 'available')
    || !detail?.slot_schedule?.capacity_available;

  return (
    <div className="mfg-cap-commit-panel">
      <div className="mfg-cap-commit-panel__head">
        <div>
          <p className="mfg-cap-commit-panel__id">{quotation}</p>
          <p className="mfg-cap-commit-panel__meta">
            {detail.party_name || '—'}
            {planStatus ? ` · Plan: ${planStatus}` : ''}
            {summaryLine ? ` · ${summaryLine}` : ''}
          </p>
        </div>
        <div className="mfg-cap-commit-panel__head-actions">
          {onClose ? (
            <button type="button" className="pm-btn pm-btn-sm pm-btn-ghost" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>

      {machineAlerts.length ? (
        <div className="mfg-cap-commit-alerts" role="status" aria-live="polite">
          <p className="mfg-cap-commit-alerts__title">Machine capacity</p>
          {machineAlerts.map((row, idx) => (
            <div
              key={`${row.workstation || row.machine}-${idx}`}
              className={`mfg-cap-commit-alert ${alertClass(row.status)}`}
            >
              <p className="mfg-cap-commit-alert__machine">
                {row.workstation_name || row.machine || 'Machine'}
                {requiredHours > 0 ? ` · ${requiredHours.toFixed(1)}h required` : ''}
              </p>
              <p className="mfg-cap-commit-alert__message">{row.message}</p>
              {(row.scheduled_start_date || row.scheduled_end_date) ? (
                <p className="mfg-cap-commit-alert__slot">
                  Production window: {row.scheduled_start_date || '—'}
                  {row.scheduled_end_date ? ` → ${row.scheduled_end_date}` : ''}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mfg-cap-commit" role="region" aria-label="Production capacity commitment">
        <p className="mfg-cap-commit__title">Production schedule</p>

        {committed ? (
          <p className="mfg-cap-commit__ok">Manufacturing capacity already committed on this quotation.</p>
        ) : null}

        {!committed && needsCommit ? (
          <p className="mfg-cap-commit__hint mfg-cap-commit__hint--warn">
            Capacity is tight on the requested date. Review the suggested production window and commit.
          </p>
        ) : null}

        <label className="mfg-cap-commit__check">
          <input
            type="checkbox"
            checked={Boolean(form.capacity_available_confirmed)}
            disabled={!canCommit || busy || committed}
            onChange={(e) => setField('capacity_available_confirmed', e.target.checked)}
          />
          Capacity available for this quantity
          {allocationOverloaded ? ' (override — allocation exceeds machine capacity)' : ''}
        </label>

        <div className="mfg-cap-commit__dates">
          <Field label="Production start date">
            <input
              className="pm-input"
              type="date"
              min={today()}
              value={form.production_start_date || ''}
              disabled={!canCommit || busy || committed}
              onChange={(e) => setField('production_start_date', e.target.value)}
            />
          </Field>
          <Field label="Production completion date">
            <input
              className="pm-input"
              type="date"
              min={form.production_start_date || today()}
              value={form.production_completion_estimate || ''}
              disabled={!canCommit || busy || committed}
              onChange={(e) => setField('production_completion_estimate', e.target.value)}
            />
          </Field>
        </div>

        {allocation.length ? (
          <table className="mfg-cap-commit-table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              {allocation.map((row, idx) => (
                <tr key={`${row.machine || row.workstation}-${idx}`}>
                  <td>{row.machine || row.workstation || row.workstation_name}</td>
                  <td>
                    {canCommit && !committed ? (
                      <input
                        className="pm-input pm-input--compact"
                        type="number"
                        min="0"
                        step="0.1"
                        value={row.allocated_hours ?? ''}
                        disabled={busy}
                        onChange={(e) => updateAllocationHours(idx, e.target.value)}
                      />
                    ) : (
                      Number(row.allocated_hours || 0).toFixed(1)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className="mfg-cap-commit__actions">
          {canCommit && !committed ? (
            <>
              <button
                type="button"
                className="pm-btn pm-btn-ghost"
                disabled={busy}
                onClick={() => load()}
              >
                Recalculate slots
              </button>
              <button
                type="button"
                className="pm-btn pm-btn-primary"
                disabled={
                  busy
                  || !form.production_start_date
                  || !form.production_completion_estimate
                  || !allocation.length
                  || (allocationOverloaded && !form.capacity_available_confirmed)
                }
                onClick={onSave}
              >
                {busy ? 'Saving…' : 'Commit production capacity'}
              </button>
            </>
          ) : (
            <span className="mfg-cap-commit__perm-hint">
              {committed
                ? 'Capacity commitment is complete.'
                : 'Only Production Head can commit capacity.'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
