import { useEffect, useMemo, useState } from 'react';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import toast from 'react-hot-toast';
import {
  CalendarDays, CheckCircle2, Clock, Factory, Pencil, Pause, Play, Plus, Trash2, Wrench,
} from '@/icons/mfgIcons.js';
import MfgKpiStat from '@/components/MfgKpiStat';
import { workstations, maintenance } from '@/api';
import { useAuth, ROLES, RoleGate } from '@/hooks/manufacturingAuth';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import Modal, { MfgModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import MfgCombobox from '@/components/MfgCombobox';
import { StatusBadge } from '@/components/StatusBadge';
import {
  MfgButton,
  MfgIconButton,
  MfgIconButtonGroup,
  MfgListPagination,
  MfgPage,
  MfgPageHeader,
  MfgTableCard,
  MfgTd,
  MfgTh,
  MfgTableHead,
  MfgToolbar,
} from '@/components/MfgPageLayout.jsx';

const PAGE_SIZE = 25;

const TYPES = ['CNC', 'Lathe', 'Milling', 'Drilling', 'Grinding', 'Welding', 'Assembly', 'Painting', 'Packaging', 'Testing', 'Other'];

const TYPE_FILTER_ITEMS = [
  { value: 'all', label: 'All Types' },
  ...TYPES.map((t) => ({ value: t, label: t })),
];

const STATUS_FILTER_ITEMS = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const WORKING_DAYS_ITEMS = [
  { value: 'Mon-Fri', label: 'Mon–Fri' },
  { value: 'Mon-Sat', label: 'Mon–Sat' },
  { value: 'All Days', label: 'All Days' },
  { value: 'Custom', label: 'Custom' },
];

const FREQ_TYPE_ITEMS = [
  { value: 'Days', label: 'Days' },
  { value: 'Weeks', label: 'Weeks' },
  { value: 'Months', label: 'Months' },
];

const PM_PRIORITY_ITEMS = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
];

const defaultScheduleForm = {
  task: '',
  frequency_type: 'Days',
  frequency_value: '30',
  last_done: '',
  priority: 'Medium',
};

function parseTimeParts(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function toTimeInput(value) {
  const parts = parseTimeParts(value);
  if (!parts) return '08:00';
  const hh = String(parts.hours).padStart(2, '0');
  const mm = String(parts.minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fromTimeInput(value) {
  const parts = parseTimeParts(value);
  if (!parts) return '08:00:00';
  const hh = String(parts.hours).padStart(2, '0');
  const mm = String(parts.minutes).padStart(2, '0');
  return `${hh}:${mm}:00`;
}

function effectiveCapacity(base, efficiencyPct) {
  const baseN = Number(base) || 0;
  const eff = Number(efficiencyPct ?? 100) || 100;
  return Math.round(baseN * (eff / 100) * 100) / 100;
}

function formatUtilHeader(dateStr) {
  if (!dateStr) return 'Load';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'Load';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function efficiencyBadgeClass(pct) {
  const n = Number(pct ?? 100);
  return n >= 95 && n <= 105 ? 'badge-green' : 'badge-amber';
}

const defaultForm = {
  workstation_name: '',
  workstation_type: 'CNC',
  capacity_per_shift: 8,
  is_active: true,
  location: '',
  hourly_rate: 0,
  working_hours_start: '08:00',
  working_hours_end: '17:00',
  working_days: 'Mon-Fri',
  time_efficiency_pct: 100,
  setup_minutes: 15,
  cleanup_minutes: 10,
  alternative_workstation: '',
};

function rowToForm(row) {
  return {
    workstation_name: row.workstation_name || '',
    workstation_type: row.workstation_type || 'CNC',
    capacity_per_shift: row.capacity_per_shift || 1,
    is_active: !!row.is_active,
    location: row.location || '',
    hourly_rate: Number(row.hourly_rate || row.cost_per_hour || 0),
    working_hours_start: toTimeInput(row.working_hours_start),
    working_hours_end: toTimeInput(row.working_hours_end),
    working_days: row.working_days || 'Mon-Fri',
    time_efficiency_pct: Number(row.time_efficiency_pct ?? 100),
    setup_minutes: Number(row.setup_minutes ?? 15),
    cleanup_minutes: Number(row.cleanup_minutes ?? 10),
    alternative_workstation: row.alternative_workstation || '',
  };
}

function formToPayload(form) {
  const parseNum = (value, fallback = 0) => {
    const n = Number(String(value ?? '').trim());
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    ...form,
    capacity_per_shift: parseNum(form.capacity_per_shift, 1),
    time_efficiency_pct: parseNum(form.time_efficiency_pct, 100),
    setup_minutes: parseNum(form.setup_minutes, 0),
    cleanup_minutes: parseNum(form.cleanup_minutes, 0),
    hourly_rate: parseNum(form.hourly_rate, 0),
    working_hours_start: fromTimeInput(form.working_hours_start),
    working_hours_end: fromTimeInput(form.working_hours_end),
    alternative_workstation: form.alternative_workstation || undefined,
    cost_per_hour: parseNum(form.hourly_rate, 0),
  };
}

export default function WorkstationsPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.PRODUCTION_HEAD, ROLES.SUPERVISOR);
  const [rows, setRows] = useState([]);
  const [utilRows, setUtilRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('all');
  const [utilDate, setUtilDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scheduleWs, setScheduleWs] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(defaultScheduleForm);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const canManagePm = hasRole(ROLES.MAINTENANCE_TECHNICIAN, ROLES.PRODUCTION_HEAD);

  const load = async (targetDate = utilDate) => {
    setLoading(true);
    try {
      const [list, util] = await Promise.all([
        workstations.list(),
        workstations.utilization(targetDate),
      ]);
      setRows(list || []);
      setUtilRows(util?.rows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(utilDate); /* eslint-disable-next-line */ }, [utilDate]);

  const utilizationByName = useMemo(
    () => Object.fromEntries(utilRows.map((r) => [r.name, r])),
    [utilRows],
  );

  const alternativeItems = useMemo(
    () => [
      { value: '', label: 'None' },
      ...rows
        .filter((r) => r.name !== editing?.name)
        .map((r) => ({
          value: r.name,
          label: `${r.workstation_name} (${r.workstation_type})`,
        })),
    ],
    [rows, editing],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const bySearch = !q || r.workstation_name?.toLowerCase().includes(q) || r.location?.toLowerCase().includes(q);
      const byType = typeFilter === 'all' || r.workstation_type === typeFilter;
      const byActive = activeFilter === 'all' ||
        (activeFilter === 'active' && !!r.is_active) ||
        (activeFilter === 'inactive' && !r.is_active);
      return bySearch && byType && byActive;
    });
  }, [rows, search, typeFilter, activeFilter]);

  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(filteredRows, PAGE_SIZE);

  useEffect(() => {
    resetPage();
  }, [search, typeFilter, activeFilter, resetPage]);

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm);
    setModal('form');
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm(rowToForm(row));
    setModal('form');
  };

  const submit = async () => {
    setSaving(true);
    try {
      const payload = formToPayload(form);
      if (editing) {
        await workstations.update(editing.name, payload);
        toast.success('Workstation updated');
      } else {
        await workstations.create(payload);
        toast.success('Workstation created');
      }
      setModal(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row) => {
    if (!row.is_active && row.under_maintenance) {
      toast.error(`Cannot activate while ${row.maintenance_ticket || 'maintenance'} is open`);
      return;
    }
    try {
      await workstations.setActive(row.name, !row.is_active);
      toast.success(`Workstation ${row.is_active ? 'deactivated' : 'activated'}`);
      await load();
    } catch {
      /* toast from API */
    }
  };

  const deleteWorkstation = async (row) => {
    if (!window.confirm(`Delete workstation "${row.workstation_name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await workstations.remove(row.name);
      toast.success('Workstation deleted');
      await load();
    } catch {
      /* toast from API */
    }
  };

  const loadSchedules = async (workstationName) => {
    setScheduleLoading(true);
    try {
      const rows = await maintenance.listSchedules(workstationName);
      setSchedules(rows || []);
    } catch {
      setSchedules([]);
    } finally {
      setScheduleLoading(false);
    }
  };

  const openSchedules = async (row) => {
    setScheduleWs(row);
    setScheduleForm(defaultScheduleForm);
    setModal('schedules');
    await loadSchedules(row.name);
  };

  const submitSchedule = async () => {
    if (!scheduleWs?.name || !scheduleForm.task.trim()) {
      toast.error('Task is required');
      return;
    }
    setScheduleSaving(true);
    try {
      await maintenance.createSchedule({
        workstation: scheduleWs.name,
        task: scheduleForm.task.trim(),
        frequency_type: scheduleForm.frequency_type,
        frequency_value: Number(scheduleForm.frequency_value) || 30,
        last_done: scheduleForm.last_done || undefined,
        priority: scheduleForm.priority,
      });
      toast.success('Maintenance schedule added');
      setModal('schedules');
      setScheduleForm(defaultScheduleForm);
      await loadSchedules(scheduleWs.name);
    } finally {
      setScheduleSaving(false);
    }
  };

  const deactivateSchedule = async (scheduleName) => {
    try {
      await maintenance.deleteSchedule(scheduleName);
      toast.success('Schedule deactivated');
      if (scheduleWs?.name) await loadSchedules(scheduleWs.name);
    } catch {
      /* toast from API */
    }
  };

  if (loading) return <PageLoader />;

  if (!canManage) {
    return <EmptyState icon={Wrench} title="Workstation master is available only for Production Head/Supervisor" />;
  }

  const fullyBooked = filteredRows.filter(
    (r) => utilizationByName[r.name]?.availability === 'Fully Booked',
  ).length;

  return (
    <MfgPage className="mfg-workstations">
      <MfgPageHeader
        title="Workstations"
        subtitle="Master setup, capacity, efficiency, cost, and daily utilization"
        actions={(
          <MfgButton onClick={openCreate}>
            <Plus size={16} /> Add Workstation
          </MfgButton>
        )}
      />

      <div className="mfg-kpi-stats mfg-kpi-stats--3">
        <MfgKpiStat label="Total" value={filteredRows.length} tone="blue" icon={Factory} />
        <MfgKpiStat
          label="Active"
          value={filteredRows.filter((r) => r.is_active).length}
          tone="green"
          icon={CheckCircle2}
        />
        <MfgKpiStat
          label={`Fully booked (${utilDate})`}
          value={fullyBooked}
          tone="amber"
          icon={CalendarDays}
        />
      </div>

      <MfgToolbar className="mfg-toolbar--grid">
        <input
          className="input"
          placeholder="Search workstation / location"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPage();
          }}
        />
        <MfgCombobox
          value={typeFilter}
          onChange={(next) => {
            setTypeFilter(next || 'all');
            resetPage();
          }}
          items={TYPE_FILTER_ITEMS}
          placeholder="All Types"
        />
        <MfgCombobox
          value={activeFilter}
          onChange={(next) => {
            setActiveFilter(next || 'all');
            resetPage();
          }}
          items={STATUS_FILTER_ITEMS}
          placeholder="All Status"
        />
        <input
          type="date"
          className="input"
          value={utilDate}
          onChange={(e) => setUtilDate(e.target.value)}
          aria-label="Utilization date"
        />
      </MfgToolbar>

      <MfgTableCard className="mfg-ws-table-card">
        <table className="mfg-ws-table">
          <colgroup>
            <col className="mfg-ws-col mfg-ws-col--name" />
            <col className="mfg-ws-col mfg-ws-col--type" />
            <col className="mfg-ws-col mfg-ws-col--cap" />
            <col className="mfg-ws-col mfg-ws-col--status" />
            <col className="mfg-ws-col mfg-ws-col--load" />
            <col className="mfg-ws-col mfg-ws-col--actions" />
          </colgroup>
          <MfgTableHead>
            <MfgTh>Workstation</MfgTh>
            <MfgTh align="center">Type</MfgTh>
            <MfgTh align="center">Cap/shift</MfgTh>
            <MfgTh align="center">Status</MfgTh>
            <MfgTh align="center">{formatUtilHeader(utilDate)}</MfgTh>
            <MfgTh align="center" className="mfg-ws-th-actions">Actions</MfgTh>
          </MfgTableHead>
          <tbody>
            {pageRows.map((r) => {
              const util = utilizationByName[r.name];
              const booked = util?.booked_hours ?? 0;
              const pct = util?.utilization_pct ?? 0;
              const eff = Number(r.time_efficiency_pct ?? 100);
              const cost = Number(r.hourly_rate || r.cost_per_hour || 0);
              const effective = r.effective_capacity_per_shift ?? effectiveCapacity(r.capacity_per_shift, eff);
              return (
                <tr key={r.name}>
                  <MfgTd className="mfg-ws-workstation-cell">
                    <div className="mfg-ws-name-row">
                      <span className="mfg-row-primary">{r.workstation_name}</span>
                      {r.location ? (
                        <span className="mfg-ws-location">{r.location}</span>
                      ) : null}
                    </div>
                    <div className="mfg-ws-meta">
                      <span className={`mfg-ws-meta__badge ${efficiencyBadgeClass(eff)}`}>
                        {eff}%
                      </span>
                      <span className="mfg-ws-meta__badge badge-blue">
                        ₹{cost.toLocaleString('en-IN')}/hr
                      </span>
                    </div>
                  </MfgTd>
                  <MfgTd align="center" className="mfg-ws-cell-compact">{r.workstation_type}</MfgTd>
                  <MfgTd align="center" className="mfg-ws-cell-compact">
                    <span className="mfg-row-value">{r.capacity_per_shift || 0}</span>
                    <span className="mfg-ws-inline-muted">→ {effective}</span>
                  </MfgTd>
                  <MfgTd align="center" className="mfg-ws-cell-compact">
                    <div className="mfg-ws-status-badges">
                      <StatusBadge status={r.is_active ? 'Active' : 'Inactive'} />
                      {r.under_maintenance ? (
                        <StatusBadge status="Under Maintenance" />
                      ) : null}
                    </div>
                  </MfgTd>
                  <MfgTd align="center" className="mfg-ws-cell-compact">
                    <span className="mfg-row-value">{booked}/{r.capacity_per_shift || 0}</span>
                    <span className="mfg-ws-inline-muted">{pct}% · {util?.availability || 'Free'}</span>
                  </MfgTd>
                  <MfgTd align="center" className="mfg-ws-actions-cell">
                    <MfgIconButtonGroup className="mfg-ws-actions">
                      <MfgIconButton
                        icon={Clock}
                        label="Preventive maintenance schedules"
                        variant="secondary"
                        onClick={() => openSchedules(r)}
                      />
                      <MfgIconButton
                        icon={Pencil}
                        label="Edit workstation"
                        variant="secondary"
                        onClick={() => openEdit(r)}
                      />
                      <MfgIconButton
                        icon={r.is_active ? Pause : Play}
                        label={r.is_active ? 'Deactivate workstation' : 'Activate workstation'}
                        variant={r.is_active ? 'secondary' : 'success'}
                        disabled={!r.is_active && !!r.under_maintenance}
                        onClick={() => toggleActive(r)}
                      />
                      {!r.is_active ? (
                        <MfgIconButton
                          icon={Trash2}
                          label="Delete workstation"
                          variant="danger"
                          onClick={() => deleteWorkstation(r)}
                        />
                      ) : null}
                    </MfgIconButtonGroup>
                  </MfgTd>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <MfgTd colSpan={6} className="mfg-td--empty">
                  No workstations matched current filters.
                </MfgTd>
              </tr>
            )}
          </tbody>
        </table>
        <MfgListPagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </MfgTableCard>

      <Modal
        open={modal === 'form'}
        onClose={() => !saving && setModal(null)}
        title={editing ? 'Edit Workstation' : 'Create Workstation'}
        footer={(
          <MfgModalFooter
            onCancel={() => setModal(null)}
            onSubmit={submit}
            saving={saving}
            submitLabel={editing ? 'Update' : 'Create'}
          />
        )}
      >
        <div className="mfg-wo-modal-form mfg-workstation-form">
          <Field label="Workstation Name" required>
            <input
              className="pm-input"
              value={form.workstation_name}
              onChange={(e) => setForm({ ...form, workstation_name: e.target.value })}
              placeholder="e.g. CNC-1"
            />
          </Field>

          <div className="mfg-wo-modal-form__row-2">
            <Field label="Type" required>
              <MfgCombobox
                value={form.workstation_type}
                onChange={(workstation_type) => setForm({
                  ...form,
                  workstation_type: workstation_type || TYPES[0],
                })}
                options={TYPES}
                placeholder="Select type…"
              />
            </Field>
            <Field label="Capacity / Shift" required>
              <input
                type="text"
                inputMode="numeric"
                className="pm-input"
                value={form.capacity_per_shift}
                onChange={(e) => setForm({ ...form, capacity_per_shift: e.target.value })}
                placeholder="8"
              />
            </Field>
          </div>

          <div className="mfg-wo-modal-form__row-2 mfg-ws-form-row--align-end">
            <Field label="Location">
              <input
                className="pm-input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Shop floor zone"
              />
            </Field>
            <label className="mfg-ws-form-active mfg-checkbox-label">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Is Active
            </label>
          </div>

          <p className="mfg-ws-form-section-title">Working Hours &amp; Cost</p>

          <div className="mfg-wo-modal-form__row-2">
            <Field label="Shift Start">
              <input
                type="time"
                className="pm-input mfg-wo-modal-form__datetime"
                value={form.working_hours_start}
                onChange={(e) => setForm({ ...form, working_hours_start: e.target.value })}
              />
            </Field>
            <Field label="Shift End">
              <input
                type="time"
                className="pm-input mfg-wo-modal-form__datetime"
                value={form.working_hours_end}
                onChange={(e) => setForm({ ...form, working_hours_end: e.target.value })}
              />
            </Field>
          </div>

          <div className="mfg-wo-modal-form__row-2">
            <Field label="Working Days">
              <MfgCombobox
                value={form.working_days}
                onChange={(working_days) => setForm({ ...form, working_days: working_days || 'Mon-Fri' })}
                items={WORKING_DAYS_ITEMS}
                placeholder="Mon–Fri"
              />
            </Field>
            <Field label="Time Efficiency (%)">
              <input
                type="text"
                inputMode="decimal"
                className="pm-input"
                value={form.time_efficiency_pct}
                onChange={(e) => setForm({ ...form, time_efficiency_pct: e.target.value })}
                placeholder="100"
              />
            </Field>
          </div>

          <div className="mfg-wo-modal-form__row-2">
            <Field label="Setup (min)">
              <input
                type="text"
                inputMode="numeric"
                className="pm-input"
                value={form.setup_minutes}
                onChange={(e) => setForm({ ...form, setup_minutes: e.target.value })}
                placeholder="15"
              />
            </Field>
            <Field label="Cleanup (min)">
              <input
                type="text"
                inputMode="numeric"
                className="pm-input"
                value={form.cleanup_minutes}
                onChange={(e) => setForm({ ...form, cleanup_minutes: e.target.value })}
                placeholder="10"
              />
            </Field>
          </div>

          <div className="mfg-wo-modal-form__row-2">
            <Field label="Cost / Hour (₹)">
              <input
                type="text"
                inputMode="decimal"
                className="pm-input"
                value={form.hourly_rate}
                onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })}
                placeholder="0"
              />
            </Field>
            <Field label="Alternative WS">
              <MfgCombobox
                value={form.alternative_workstation}
                onChange={(alternative_workstation) => setForm({
                  ...form,
                  alternative_workstation: alternative_workstation || '',
                })}
                items={alternativeItems}
                placeholder="None"
              />
            </Field>
          </div>

          <p className="mfg-wo-modal-form__hint">
            Effective capacity:{' '}
            <strong>
              {effectiveCapacity(form.capacity_per_shift, form.time_efficiency_pct)} units/shift
            </strong>
          </p>
        </div>
      </Modal>

      <Modal
        open={modal === 'schedules'}
        onClose={() => !scheduleSaving && setModal(null)}
        title={scheduleWs ? `PM Schedules — ${scheduleWs.workstation_name}` : 'PM Schedules'}
        wide
        footer={canManagePm ? (
          <MfgModalFooter
            onCancel={() => setModal(null)}
            onSubmit={() => setModal('schedule-add')}
            submitLabel="+ Add Schedule"
            saving={false}
          />
        ) : (
          <MfgModalFooter
            onCancel={() => setModal(null)}
            onSubmit={() => setModal(null)}
            submitLabel="Close"
          />
        )}
      >
        {scheduleLoading ? (
          <p className="mfg-wo-modal-form__hint">Loading schedules…</p>
        ) : schedules.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No preventive schedules"
            description="Add a recurring maintenance task for this workstation."
          />
        ) : (
          <div className="mfg-pm-schedule-list">
            <table className="mfg-pm-schedule-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Frequency</th>
                  <th>Next due</th>
                  <th>Priority</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {schedules.map((sch) => (
                  <tr key={sch.name}>
                    <td>{sch.task}</td>
                    <td>{sch.frequency_label}</td>
                    <td>
                      <span className={sch.is_due ? 'mfg-pm-due' : ''}>
                        {sch.is_due ? '⏰ ' : ''}
                        {sch.next_due || '—'}
                      </span>
                    </td>
                    <td>{sch.priority}</td>
                    <td>
                      {canManagePm ? (
                        <MfgButton
                          variant="ghost"
                          size="sm"
                          onClick={() => deactivateSchedule(sch.name)}
                        >
                          Deactivate
                        </MfgButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <Modal
        open={modal === 'schedule-add'}
        onClose={() => !scheduleSaving && setModal('schedules')}
        title="Add maintenance schedule"
        footer={(
          <RoleGate allow={[ROLES.MAINTENANCE_TECHNICIAN, ROLES.PRODUCTION_HEAD]}>
            <MfgModalFooter
              onCancel={() => setModal('schedules')}
              onSubmit={submitSchedule}
              saving={scheduleSaving}
              submitLabel="Save schedule"
            />
          </RoleGate>
        )}
      >
        <div className="mfg-wo-modal-form">
          <Field label="Workstation">
            <input className="pm-input" value={scheduleWs?.workstation_name || ''} readOnly />
          </Field>
          <Field label="Task" required>
            <input
              className="pm-input"
              value={scheduleForm.task}
              onChange={(e) => setScheduleForm({ ...scheduleForm, task: e.target.value })}
              placeholder="e.g. Lubrication"
            />
          </Field>
          <div className="mfg-wo-modal-form__row-2">
            <Field label="Frequency type">
              <MfgCombobox
                value={scheduleForm.frequency_type}
                onChange={(frequency_type) => setScheduleForm({
                  ...scheduleForm,
                  frequency_type: frequency_type || 'Days',
                })}
                items={FREQ_TYPE_ITEMS}
              />
            </Field>
            <Field label="Every" required>
              <input
                type="text"
                inputMode="numeric"
                className="pm-input"
                value={scheduleForm.frequency_value}
                onChange={(e) => setScheduleForm({ ...scheduleForm, frequency_value: e.target.value })}
              />
            </Field>
          </div>
          <div className="mfg-wo-modal-form__row-2">
            <Field label="Last done">
              <input
                type="date"
                className="pm-input mfg-wo-modal-form__datetime"
                value={scheduleForm.last_done}
                onChange={(e) => setScheduleForm({ ...scheduleForm, last_done: e.target.value })}
              />
            </Field>
            <Field label="Priority">
              <MfgCombobox
                value={scheduleForm.priority}
                onChange={(priority) => setScheduleForm({
                  ...scheduleForm,
                  priority: priority || 'Medium',
                })}
                items={PM_PRIORITY_ITEMS}
              />
            </Field>
          </div>
        </div>
      </Modal>
    </MfgPage>
  );
}
