import { useCallback, useEffect, useMemo, useState } from 'react';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import toast from 'react-hot-toast';
import {
  Activity, AlertCircle, CheckCircle2, Clock, Eye, FileCheck, Package, Play, Plus, Trash2,
  UserPlus, Wrench,
} from '@/icons/mfgIcons.js';
import { fmtDateTime, fmtCurrency, fmtNumber } from '@/utils/format';
import MfgKpiStat from '@/components/MfgKpiStat';
import { maintenance } from '@/api';
import { useAuth, ROLES } from '@/hooks/manufacturingAuth';
import BreakdownReportModal from '@/components/BreakdownReportModal';
import { PageLoader, InlineLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { PriorityBadge, StatusBadge, MaintenanceTypeBadge } from '@/components/StatusBadge';
import Modal, { MfgDangerModalFooter, MfgModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import MfgCombobox from '@/components/MfgCombobox';
import {
  MfgButton,
  MfgIconButton,
  MfgIconButtonGroup,
  MfgListPagination,
  MfgPage,
  MfgPageHeader,
  MfgSegmentTabs,
  MfgTableCard,
  MfgTd,
  MfgTh,
  MfgTableHead,
  MfgToolbar,
} from '@/components/MfgPageLayout.jsx';

const PAGE_SIZE = 25;

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'Open', label: 'Open' },
  { id: 'Assigned', label: 'Assigned' },
  { id: 'In Repair', label: 'In Repair' },
  { id: 'Resolved', label: 'Resolved' },
  { id: 'Closed', label: 'Closed' },
];

const TYPE_TABS = [
  { id: 'all', label: 'All types' },
  { id: 'Breakdown', label: 'Breakdown' },
  { id: 'Preventive', label: 'Preventive' },
];

const RE_REPAIR_MARKER = 'Re-repair reason (operator):';
const SPARE_VISIBLE_STATUSES = new Set(['Open', 'Assigned', 'In Repair', 'Resolved']);

const ROOT_CAUSE_OPTIONS = [
  '',
  'Bearing Wear',
  'Cooling Fan Weak',
  'Belt Wear',
  'Oil Leakage',
  'Electrical Short',
  'Sensor Failure',
  'Software Fault',
  'Operator Error',
  'Material Contamination',
  'Overload',
  'Other',
];

const ROOT_CAUSE_ITEMS = ROOT_CAUSE_OPTIONS.filter(Boolean).map((opt) => ({
  value: opt,
  label: opt,
}));

const EMPTY_CLOSE_FORM = {
  rootCause: '',
  rootCauseNote: '',
  correctiveAction: '',
  suggestFrequencyChange: false,
  newFrequencyValue: '',
};

function linkedScheduleFrequencyValue(ticket) {
  const freq = Number(ticket?.linked_schedule_frequency);
  return freq > 0 ? String(freq) : '';
}

function CorrectiveActionPanel({ ticket }) {
  if (ticket?.status !== 'Closed') return null;

  const rootCause = String(ticket.root_cause || '').trim();
  const rootCauseNote = String(ticket.root_cause_note || '').trim();
  const corrective = String(ticket.corrective_action || '').trim();
  const pmNote = String(ticket.pm_freq_change_note || '').trim();
  const showRoot = Boolean(rootCause);
  const showCorrective = Boolean(corrective);
  const showPm = Boolean(ticket.frequency_change_applied && pmNote);

  if (!showRoot && !showCorrective && !showPm) return null;

  const rootDisplay = rootCause === 'Other' && rootCauseNote
    ? `${rootCause} — ${rootCauseNote}`
    : rootCause;

  return (
    <section className="mfg-maint-corrective" aria-label="Root cause and correction">
      <h3 className="mfg-maint-corrective__title">Root Cause &amp; Correction</h3>
      {showRoot ? (
        <div className="mfg-maint-corrective__row">
          <span className="mfg-maint-corrective__label">Root Cause</span>
          <span className="mfg-maint-corrective__value">{rootDisplay}</span>
        </div>
      ) : null}
      {showCorrective ? (
        <div className="mfg-maint-corrective__row">
          <span className="mfg-maint-corrective__label">Corrective</span>
          <span className="mfg-maint-corrective__value">{corrective}</span>
        </div>
      ) : null}
      {showPm ? (
        <div className="mfg-maint-corrective__row">
          <span className="mfg-maint-corrective__label">PM Freq change</span>
          <span className="mfg-maint-corrective__value">
            {pmNote.replace(/^[^:]+:\s*/, '')}
            {' '}
            <span className="mfg-maint-corrective__chip">Applied</span>
          </span>
        </div>
      ) : null}
    </section>
  );
}

function spareStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'issued') return 'mfg-maint-spares-chip--issued';
  if (s === 'pr raised') return 'mfg-maint-spares-chip--pr';
  return 'mfg-maint-spares-chip--requested';
}

function SpareStatusChip({ status }) {
  return (
    <span className={`mfg-maint-spares-chip ${spareStatusClass(status)}`}>
      {status || 'Requested'}
    </span>
  );
}

function AddSpareModal({
  open, onClose, ticket, onSuccess,
}) {
  const [itemCode, setItemCode] = useState('');
  const [requiredQty, setRequiredQty] = useState(1);
  const [warehouse, setWarehouse] = useState('');
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [stockHint, setStockHint] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItemCode('');
    setRequiredQty(1);
    setWarehouse(ticket?.spare_warehouse || '');
    setStockHint(null);
    maintenance.getAddSpareOptions(ticket?.name)
      .then((data) => {
        setProducts(data?.items || []);
        setWarehouses(data?.warehouses || []);
        setWarehouse(data?.spare_warehouse || ticket?.spare_warehouse || '');
      })
      .catch(() => {
        toast.error('Could not load spare parts catalog.');
        setProducts([]);
        setWarehouses([]);
      });
  }, [open, ticket?.name, ticket?.spare_warehouse]);

  useEffect(() => {
    if (!open || !itemCode || !warehouse) {
      setStockHint(null);
      return;
    }
    maintenance.getSpareStockHint(itemCode, warehouse, requiredQty)
      .then((data) => {
        setStockHint({
          available: Number(data?.available_qty ?? 0),
          estCost: Number(data?.est_cost ?? 0),
        });
      })
      .catch(() => {
        const product = products.find((p) => p.item_code === itemCode);
        const rate = Number(product?.standard_rate || 0);
        setStockHint({ available: 0, estCost: rate * Number(requiredQty || 0) });
      });
  }, [open, itemCode, warehouse, requiredQty, products]);

  const productItems = useMemo(
    () => (products || []).map((p) => ({
      value: p.item_code,
      label: `${p.item_code} — ${p.item_name || p.name || ''}`,
    })),
    [products],
  );

  const submit = async () => {
    if (!itemCode || !warehouse || !requiredQty) return;
    setSaving(true);
    try {
      await maintenance.addSpare(ticket.name, itemCode, requiredQty, warehouse);
      toast.success('Spare added to ticket');
      onSuccess?.();
      onClose();
    } catch {
      /* toast from API */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Add spare part"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          submitLabel="Add to ticket"
          canSubmit={Boolean(itemCode && warehouse && Number(requiredQty) > 0)}
        />
      )}
    >
      <div className="mfg-wo-modal-form">
        <Field label="Item code" required>
          <MfgCombobox
            value={itemCode}
            onChange={setItemCode}
            items={productItems}
            placeholder="Search spare item…"
          />
        </Field>
        <Field label="Required qty" required>
          <input
            type="number"
            className="pm-input"
            min="0.01"
            step="any"
            value={requiredQty}
            onChange={(e) => setRequiredQty(e.target.value)}
          />
        </Field>
        <Field label="Warehouse" required>
          <select
            className="pm-input"
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
          >
            <option value="">Select warehouse…</option>
            {warehouses.map((w) => (
              <option key={w.name} value={w.name}>{w.name}</option>
            ))}
          </select>
        </Field>
        {stockHint ? (
          <p className="mfg-maint-spares-hint">
            In stock: {fmtNumber(stockHint.available, 0)} units · Est cost {fmtCurrency(stockHint.estCost)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function IssueSparesConfirmModal({
  open, onClose, ticket, onSuccess,
}) {
  const [saving, setSaving] = useState(false);
  const pending = useMemo(
    () => (ticket?.spare_items || []).filter((r) => r.status === 'Requested'),
    [ticket?.spare_items],
  );
  const totalCost = pending.reduce((sum, r) => sum + Number(r.line_cost || 0), 0);

  const submit = async () => {
    if (!ticket?.name) return;
    setSaving(true);
    try {
      await maintenance.issueSpares(ticket.name);
      toast.success('Spares issued');
      onSuccess?.();
      onClose();
    } catch {
      /* toast from API */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Issue spare parts?"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          submitLabel="Issue spares"
          canSubmit={pending.length > 0}
        />
      )}
    >
      <div className="mfg-modal-confirm">
        <p className="mfg-modal-confirm__lead">
          The following requested spares will be deducted from stock immediately:
        </p>
        <ul className="mfg-modal-confirm__list">
          {pending.map((row) => (
            <li key={row.item_code}>
              <strong>{row.item_code}</strong>
              {' · '}
              {fmtNumber(row.required_qty, 0)} × {fmtCurrency(row.unit_cost)}
              {' = '}
              {fmtCurrency(row.line_cost)}
            </li>
          ))}
        </ul>
        <p className="mfg-modal-confirm__warn">
          Total: {fmtCurrency(totalCost)}. Stock will be deducted immediately.
        </p>
      </div>
    </Modal>
  );
}

function SparePartsPanel({
  ticket, canEdit, onRefresh, onAddSpare, onIssueSpares,
}) {
  const [laborHours, setLaborHours] = useState('');
  const [laborRate, setLaborRate] = useState('');
  const [savingLabor, setSavingLabor] = useState(false);
  const [busyItem, setBusyItem] = useState(null);

  useEffect(() => {
    setLaborHours(String(ticket?.labor_hours ?? 0));
    setLaborRate(String(ticket?.labor_rate ?? 100));
  }, [ticket?.labor_hours, ticket?.labor_rate, ticket?.name]);

  const saveLabor = async () => {
    setSavingLabor(true);
    try {
      await maintenance.updateLabor(ticket.name, laborHours, laborRate);
      toast.success('Labor updated');
      onRefresh?.();
    } catch {
      /* toast from API */
    } finally {
      setSavingLabor(false);
    }
  };

  const createPr = async (itemCode) => {
    setBusyItem(itemCode);
    try {
      await maintenance.createPrForSpare(ticket.name, itemCode);
      toast.success('Purchase request created');
      onRefresh?.();
    } catch {
      /* toast from API */
    } finally {
      setBusyItem(null);
    }
  };

  const spareItems = ticket?.spare_items || [];
  const pendingRequested = spareItems.filter((r) => r.status === 'Requested');
  const showIssueAll = canEdit && pendingRequested.length > 0 && !ticket?.spares_issued;

  return (
    <section className="mfg-maint-spares" aria-label="Spare parts">
      <div className="mfg-maint-spares__header">
        <h3 className="mfg-maint-spares__title">
          <Package size={18} aria-hidden />
          Spare Parts
        </h3>
        {canEdit ? (
          <MfgButton size="sm" onClick={onAddSpare}>
            Add spare
          </MfgButton>
        ) : null}
      </div>

      {spareItems.length === 0 ? (
        <p className="mfg-maint-spares-hint">No spare parts added yet.</p>
      ) : (
        <table className="mfg-maint-spares-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Req</th>
              <th>Stock</th>
              <th>Cost</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {spareItems.map((row) => {
              const stockOk = Number(row.available_qty) >= Number(row.required_qty);
              const isRequested = row.status === 'Requested';
              const showCreatePr = canEdit && (
                (isRequested && !stockOk) || row.status === 'PR Raised'
              );
              return (
                <tr key={row.item_code}>
                  <td>
                    <div className="mfg-maint-spares-item__code">{row.item_code}</div>
                    <div className="mfg-maint-spares-item__name">{row.item_name}</div>
                  </td>
                  <td>{fmtNumber(row.required_qty, 0)}</td>
                  <td>
                    <span className={stockOk ? 'mfg-maint-spares-stock--ok' : 'mfg-maint-spares-stock--low'}>
                      {fmtNumber(row.available_qty, 0)}
                    </span>
                  </td>
                  <td>{fmtCurrency(row.line_cost)}</td>
                  <td><SpareStatusChip status={row.status} /></td>
                  <td>
                    {canEdit && isRequested && stockOk ? (
                      <MfgButton
                        size="sm"
                        variant="secondary"
                        disabled={Boolean(ticket?.spares_issued)}
                        onClick={onIssueSpares}
                      >
                        Issue
                      </MfgButton>
                    ) : null}
                    {showCreatePr ? (
                      <MfgButton
                        size="sm"
                        variant="secondary"
                        disabled={busyItem === row.item_code}
                        onClick={() => createPr(row.item_code)}
                      >
                        Create PR
                      </MfgButton>
                    ) : null}
                    {row.status === 'Issued' ? (
                      <SpareStatusChip status="Issued" />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showIssueAll ? (
        <div style={{ marginTop: 12 }}>
          <MfgButton variant="primary" onClick={onIssueSpares}>
            Issue all requested spares
          </MfgButton>
        </div>
      ) : null}

      {canEdit ? (
        <div className="mfg-maint-labor">
          <div className="mfg-maint-labor__head">
            <Clock size={16} aria-hidden />
            <span>Labor</span>
          </div>
          <div className="mfg-maint-labor__row">
            <Field label="Hours">
              <input
                type="number"
                className="pm-input"
                min="0"
                step="0.25"
                value={laborHours}
                onChange={(e) => setLaborHours(e.target.value)}
              />
            </Field>
            <Field label="Rate/Hr">
              <input
                type="number"
                className="pm-input"
                min="0"
                step="1"
                value={laborRate}
                onChange={(e) => setLaborRate(e.target.value)}
              />
            </Field>
            <div className="mfg-maint-labor__action">
              <MfgButton size="sm" disabled={savingLabor} onClick={saveLabor}>
                Save labor
              </MfgButton>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mfg-maint-spares__footer">
        <div className="mfg-maint-spares__footer-row">
          <span>Spare cost</span>
          <span>{fmtCurrency(ticket?.spare_cost)}</span>
        </div>
        <div className="mfg-maint-spares__footer-row">
          <span>
            Labor ({fmtNumber(ticket?.labor_hours, 1)}h × {fmtCurrency(ticket?.labor_rate)})
          </span>
          <span>{fmtCurrency(ticket?.labor_cost)}</span>
        </div>
        <div className="mfg-maint-spares__footer-row mfg-maint-spares__footer-row--total">
          <span>Total</span>
          <span>{fmtCurrency(ticket?.maintenance_cost)}</span>
        </div>
      </div>
    </section>
  );
}

function splitResolutionNotes(notes) {
  const text = String(notes || '').trim();
  if (!text) return { resolution: '', extractedReason: null };
  const idx = text.toLowerCase().indexOf(RE_REPAIR_MARKER.toLowerCase());
  if (idx === -1) return { resolution: text, extractedReason: null };
  return {
    resolution: text.slice(0, idx).trim().replace(/[:\-\s]+$/, ''),
    extractedReason: text.slice(idx + RE_REPAIR_MARKER.length).trim() || null,
  };
}

function TicketDetail({ label, value, mono }) {
  return (
    <div className="mfg-detail-field">
      <p className="mfg-detail-field__label">{label}</p>
      <div className={mono ? 'mfg-detail-field__value mfg-detail-field__value--mono' : 'mfg-detail-field__value'}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function maintenanceLogActionClass(action) {
  return String(action || 'update')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function MaintenanceActivityLog({ logs }) {
  return (
    <aside className="mfg-maint-view__log-panel" aria-label="Activity log">
      <p className="mfg-detail-field__label">Activity log</p>
      <ol className="mfg-maint-log-timeline">
        {logs.map((log, idx) => {
          const actionClass = maintenanceLogActionClass(log.action);
          const isLast = idx === logs.length - 1;
          return (
            <li
              key={`${log.timestamp}-${idx}`}
              className={`mfg-maint-log-timeline__item${isLast ? ' is-last' : ''}`}
            >
              <span
                className={`mfg-maint-log-timeline__dot mfg-maint-log-timeline__dot--${actionClass}`}
                aria-hidden
              />
              <div className="mfg-maint-log-timeline__body">
                <div className="mfg-maint-log-timeline__head">
                  <span className={`mfg-maint-log-timeline__action mfg-maint-log-timeline__action--${actionClass}`}>
                    {log.action}
                  </span>
                  <time className="mfg-maint-log-timeline__time" dateTime={log.timestamp}>
                    {fmtDateTime(log.timestamp)}
                  </time>
                </div>
                {log.note ? <p className="mfg-maint-log-timeline__note">{log.note}</p> : null}
                {log.user ? <p className="mfg-maint-log-timeline__user">{log.user}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function TicketActions({ ticket, onAction, busy }) {
  const { hasRole } = useAuth();
  const isTech = hasRole(ROLES.MAINTENANCE_TECHNICIAN, ROLES.PRODUCTION_HEAD);
  const isOperator = hasRole(ROLES.OPERATOR, ROLES.SUPERVISOR, ROLES.PRODUCTION_HEAD);
  const status = ticket.status;

  const showAssign = isTech && status === 'Open';
  const showStart = isTech && status === 'Assigned';
  const showDelete = isTech && (status === 'Open' || status === 'Assigned');
  const showResolve = isTech && status === 'In Repair';
  const showClose = isOperator && status === 'Resolved';
  const showReopen = isOperator && status === 'Resolved';

  return (
    <MfgIconButtonGroup>
      <MfgIconButton
        icon={Eye}
        label="View ticket"
        variant="primary"
        disabled={busy}
        onClick={() => onAction('view', ticket)}
      />
      {showAssign ? (
        <MfgIconButton
          icon={UserPlus}
          label="Assign to me"
          variant="primary"
          disabled={busy}
          onClick={() => onAction('assign', ticket)}
        />
      ) : null}
      {showStart ? (
        <MfgIconButton
          icon={Play}
          label="Start repair"
          variant="primary"
          disabled={busy}
          onClick={() => onAction('start', ticket)}
        />
      ) : null}
      {showResolve ? (
        <MfgIconButton
          icon={FileCheck}
          label="Mark resolved"
          variant="primary"
          disabled={busy}
          onClick={() => onAction('resolve', ticket)}
        />
      ) : null}
      {showDelete ? (
        <MfgIconButton
          icon={Trash2}
          label="Delete ticket"
          variant="danger"
          disabled={busy}
          onClick={() => onAction('delete', ticket)}
        />
      ) : null}
      {showReopen ? (
        <MfgIconButton
          icon={Wrench}
          label="Send for re-repair"
          variant="secondary"
          disabled={busy}
          onClick={() => onAction('reopen', ticket)}
        />
      ) : null}
      {showClose ? (
        <MfgIconButton
          icon={CheckCircle2}
          label="Close ticket"
          variant="success"
          disabled={busy}
          onClick={() => onAction('close', ticket)}
        />
      ) : null}
    </MfgIconButtonGroup>
  );
}

export default function MaintenancePage() {
  const { hasRole } = useAuth();
  const canReport = hasRole(
    ROLES.OPERATOR,
    ROLES.SUPERVISOR,
    ROLES.PRODUCTION_HEAD,
  );
  const canViewActivityLog = hasRole(ROLES.PRODUCTION_HEAD, ROLES.MAINTENANCE_TECHNICIAN);
  const canManageSpares = hasRole(
    ROLES.MAINTENANCE_TECHNICIAN,
    ROLES.PRODUCTION_HEAD,
    ROLES.SUPERVISOR,
  );

  const [tab, setTab] = useState('all');
  const [typeTab, setTypeTab] = useState('all');
  const [tickets, setTickets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState({
    open: false,
    ticket: null,
    notes: '',
    mode: 'resolve',
    ...EMPTY_CLOSE_FORM,
  });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, ticket: null });
  const [viewDialog, setViewDialog] = useState({ open: false, loading: false, data: null });
  const [addSpareOpen, setAddSpareOpen] = useState(false);
  const [issueSparesOpen, setIssueSparesOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters = tab === 'all' ? {} : { status: tab };
      if (typeTab !== 'all') filters.maintenance_type = typeTab;
      const [list, sum] = await Promise.all([
        maintenance.list(filters),
        maintenance.summary(),
      ]);
      setTickets(list || []);
      setSummary(sum || {});
    } finally {
      setLoading(false);
    }
  }, [tab, typeTab]);

  useEffect(() => { load(); }, [load]);

  const { page, setPage, totalPages, pageRows, total } = usePagedRows(tickets, PAGE_SIZE);

  const kpis = useMemo(() => ([
    { label: 'Open queue', value: summary?.open_total ?? 0, tone: 'orange', icon: Wrench },
    { label: 'This month cost', value: fmtCurrency(summary?.month_maintenance_cost ?? 0), tone: 'purple', icon: Activity },
    { label: 'Spare stock alerts', value: summary?.spare_low_alerts?.length ?? 0, tone: 'red', icon: AlertCircle },
    { label: 'Preventive due (7d)', value: summary?.preventive_due_this_week ?? 0, tone: 'blue', icon: Activity },
  ]), [summary?.open_total, summary?.month_maintenance_cost, summary?.spare_low_alerts, summary?.preventive_due_this_week]);

  const closeViewDialog = () => setViewDialog({ open: false, loading: false, data: null });

  const openViewDialog = async (ticket) => {
    setViewDialog({ open: true, loading: true, data: null });
    try {
      const data = await maintenance.get(ticket.name);
      setViewDialog({ open: true, loading: false, data });
    } catch {
      closeViewDialog();
    }
  };

  const refreshViewTicket = async () => {
    if (!viewDialog.data?.name) return;
    setViewDialog((prev) => ({ ...prev, loading: true }));
    try {
      const data = await maintenance.get(viewDialog.data.name);
      setViewDialog({ open: true, loading: false, data });
      load();
    } catch {
      setViewDialog((prev) => ({ ...prev, loading: false }));
    }
  };

  const runAction = async (type, ticket) => {
    if (type === 'view') {
      openViewDialog(ticket);
      return;
    }
    if (type === 'resolve' || type === 'close' || type === 'reopen') {
      if (type === 'close') {
        try {
          const detail = await maintenance.get(ticket.name);
          setActionDialog({
            open: true,
            ticket: detail,
            notes: '',
            mode: type,
            ...EMPTY_CLOSE_FORM,
            newFrequencyValue: linkedScheduleFrequencyValue(detail),
          });
        } catch {
          /* toast from API */
        }
        return;
      }
      setActionDialog({
        open: true, ticket, notes: '', mode: type, ...EMPTY_CLOSE_FORM,
      });
      return;
    }
    if (type === 'delete') {
      setDeleteDialog({ open: true, ticket });
      return;
    }
    setBusyId(ticket.name);
    try {
      if (type === 'assign') {
        await maintenance.assign(ticket.name);
        toast.success('Ticket assigned');
      } else if (type === 'start') {
        await maintenance.startRepair(ticket.name);
        toast.success('Repair started');
      }
      load();
    } catch {
      /* toast from API */
    } finally {
      setBusyId(null);
    }
  };

  const submitAction = async () => {
    if (!actionDialog.ticket) return;
    setBusyId(actionDialog.ticket.name);
    try {
      if (actionDialog.mode === 'resolve') {
        await maintenance.resolve(actionDialog.ticket.name, actionDialog.notes || undefined);
        toast.success('Ticket marked resolved');
      } else if (actionDialog.mode === 'reopen') {
        await maintenance.reopen(actionDialog.ticket.name, actionDialog.notes || undefined);
        toast.success('Ticket sent back to repair');
      } else {
        await maintenance.close(
          actionDialog.ticket.name,
          actionDialog.notes || undefined,
          {
            root_cause: actionDialog.rootCause || undefined,
            root_cause_note: actionDialog.rootCause === 'Other'
              ? (actionDialog.rootCauseNote || undefined)
              : undefined,
            corrective_action: actionDialog.correctiveAction || undefined,
            suggest_frequency_change: actionDialog.suggestFrequencyChange ? 1 : 0,
            new_frequency_value: actionDialog.suggestFrequencyChange
              ? actionDialog.newFrequencyValue
              : undefined,
          },
        );
        toast.success('Ticket closed');
      }
      setActionDialog({
        open: false, ticket: null, notes: '', mode: 'resolve', ...EMPTY_CLOSE_FORM,
      });
      load();
    } catch {
      /* toast from API */
    } finally {
      setBusyId(null);
    }
  };

  const submitDelete = async () => {
    if (!deleteDialog.ticket) return;
    setBusyId(deleteDialog.ticket.name);
    try {
      await maintenance.delete(deleteDialog.ticket.name);
      toast.success('Ticket deleted');
      setDeleteDialog({ open: false, ticket: null });
      load();
    } catch {
      /* toast from API */
    } finally {
      setBusyId(null);
    }
  };

  const viewTicket = viewDialog.data;
  const { resolution: displayResolution, extractedReason } = splitResolutionNotes(
    viewTicket?.resolution_notes,
  );
  const reRepairReason = String(
    viewTicket?.re_repair_reason || extractedReason || '',
  ).trim();
  const showViewActivityLog = Boolean(
    viewTicket && canViewActivityLog && (viewTicket.maintenance_logs || []).length > 0,
  );
  const showSparePanel = Boolean(
    viewTicket && SPARE_VISIBLE_STATUSES.has(viewTicket.status),
  );
  const isReasonRequired = actionDialog.mode === 'reopen';
  const closeTicket = actionDialog.mode === 'close' ? actionDialog.ticket : null;
  const hasLinkedSchedule = Boolean(closeTicket?.linked_schedule);
  const pmFreqValue = String(actionDialog.newFrequencyValue ?? '').trim();
  const pmFreqInvalid = actionDialog.mode === 'close'
    && actionDialog.suggestFrequencyChange
    && (!pmFreqValue || Number(pmFreqValue) <= 0);
  const canSubmitAction = (!isReasonRequired || Boolean((actionDialog.notes || '').trim()))
    && !pmFreqInvalid;

  return (
    <MfgPage className="mfg-maintenance">
      <MfgPageHeader
        title="Maintenance"
        subtitle="Report breakdowns, assign technicians, and track machine repairs"
        actions={canReport ? (
          <MfgButton icon={Plus} onClick={() => setReportOpen(true)}>
            Report breakdown
          </MfgButton>
        ) : null}
      />

      <div className="mfg-kpi-stats mfg-kpi-stats--4">
        {kpis.map((kpi) => (
          <MfgKpiStat
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            tone={kpi.tone}
            icon={kpi.icon}
          />
        ))}
      </div>

      <MfgToolbar className="mfg-maint-toolbar">
        <MfgSegmentTabs tabs={TYPE_TABS} value={typeTab} onChange={setTypeTab} />
        <MfgSegmentTabs tabs={STATUS_TABS} value={tab} onChange={setTab} />
      </MfgToolbar>

      {loading ? (
        <PageLoader />
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No maintenance tickets"
          description={canReport ? 'Report a machine breakdown to create the first ticket.' : 'No tickets match this filter.'}
          action={canReport ? (
            <MfgButton icon={Plus} onClick={() => setReportOpen(true)}>
              Report breakdown
            </MfgButton>
          ) : null}
        />
      ) : (
        <>
          <MfgTableCard className="mfg-maint-table-card">
            <table className="mfg-maint-table">
              <colgroup>
                <col className="mfg-maint-col mfg-maint-col--ticket" />
                <col className="mfg-maint-col mfg-maint-col--type" />
                <col className="mfg-maint-col mfg-maint-col--workstation" />
                <col className="mfg-maint-col mfg-maint-col--reason" />
                <col className="mfg-maint-col mfg-maint-col--badge" />
                <col className="mfg-maint-col mfg-maint-col--badge" />
                <col className="mfg-maint-col mfg-maint-col--technician" />
                <col className="mfg-maint-col mfg-maint-col--downtime" />
                <col className="mfg-maint-col mfg-maint-col--actions" />
              </colgroup>
              <MfgTableHead>
                <MfgTh>Ticket</MfgTh>
                <MfgTh>Type</MfgTh>
                <MfgTh>Workstation</MfgTh>
                <MfgTh>Reason / Task</MfgTh>
                <MfgTh>Priority</MfgTh>
                <MfgTh>Status</MfgTh>
                <MfgTh>Technician</MfgTh>
                <MfgTh>Downtime</MfgTh>
                <MfgTh>Actions</MfgTh>
              </MfgTableHead>
              <tbody>
                {pageRows.map((ticket) => (
                  <tr key={ticket.name}>
                    <MfgTd className="mfg-maint-cell mfg-maint-cell--ticket">
                      {ticket.ticket_no || ticket.name}
                    </MfgTd>
                    <MfgTd className="mfg-maint-cell mfg-maint-cell--badge">
                      <MaintenanceTypeBadge type={ticket.maintenance_type} />
                    </MfgTd>
                    <MfgTd className="mfg-maint-cell">{ticket.workstation}</MfgTd>
                    <MfgTd className="mfg-maint-cell">
                      {ticket.maintenance_type === 'Preventive'
                        ? (ticket.schedule_task || ticket.description || ticket.breakdown_reason)
                        : ticket.breakdown_reason}
                    </MfgTd>
                    <MfgTd className="mfg-maint-cell mfg-maint-cell--badge">
                      <PriorityBadge priority={ticket.priority} />
                    </MfgTd>
                    <MfgTd className="mfg-maint-cell mfg-maint-cell--badge">
                      <StatusBadge status={ticket.status} />
                    </MfgTd>
                    <MfgTd className="mfg-maint-cell mfg-maint-cell--technician">
                      {ticket.assigned_technician || '—'}
                    </MfgTd>
                    <MfgTd className="mfg-maint-cell mfg-maint-cell--downtime">
                      {ticket.downtime_minutes ? `${ticket.downtime_minutes} min` : '—'}
                    </MfgTd>
                    <MfgTd className="mfg-maint-cell mfg-maint-cell--actions">
                      <TicketActions
                        ticket={ticket}
                        onAction={runAction}
                        busy={busyId === ticket.name}
                      />
                    </MfgTd>
                  </tr>
                ))}
              </tbody>
            </table>
          </MfgTableCard>
          <MfgListPagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}

      <BreakdownReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onSuccess={() => load()}
      />

      <Modal
        open={viewDialog.open}
        onClose={closeViewDialog}
        title={viewTicket?.ticket_no || viewTicket?.name || 'Maintenance ticket'}
        wide
      >
        {viewDialog.loading ? (
          <InlineLoader label="Loading ticket details…" />
        ) : viewTicket ? (
          <div className={`mfg-maint-view${showViewActivityLog ? ' mfg-maint-view--split' : ''}`}>
            <div className="mfg-maint-view__details">
              <div className="mfg-detail-grid">
                <TicketDetail label="Type" value={<MaintenanceTypeBadge type={viewTicket.maintenance_type} />} />
                <TicketDetail label="Workstation" value={viewTicket.workstation} />
                <TicketDetail label="Status" value={<StatusBadge status={viewTicket.status} />} />
                <TicketDetail label="Priority" value={<PriorityBadge priority={viewTicket.priority} />} />
                <TicketDetail
                  label={viewTicket.maintenance_type === 'Preventive' ? 'Scheduled task' : 'Breakdown reason'}
                  value={
                    viewTicket.maintenance_type === 'Preventive'
                      ? (viewTicket.schedule_task || viewTicket.description)
                      : viewTicket.breakdown_reason
                  }
                />
                <TicketDetail label="Technician" value={viewTicket.assigned_technician} />
                <TicketDetail label="Reported by" value={viewTicket.reported_by} />
                <TicketDetail label="Reported on" value={fmtDateTime(viewTicket.reported_on)} />
                <TicketDetail label="Downtime" value={viewTicket.downtime_minutes ? `${viewTicket.downtime_minutes} min` : '—'} />
                <TicketDetail label="Work order" value={viewTicket.work_order} mono />
                <TicketDetail label="Job card" value={viewTicket.job_card} mono />
              </div>
              {viewTicket.description ? (
                <div className="mfg-maint-view__section">
                  <p className="mfg-detail-field__label">Description</p>
                  <p className="mfg-maint-view__text">{viewTicket.description}</p>
                </div>
              ) : null}
              {displayResolution ? (
                <div className="mfg-maint-view__section">
                  <p className="mfg-detail-field__label">Resolution notes</p>
                  <p className="mfg-maint-view__text">{displayResolution}</p>
                </div>
              ) : null}
              <CorrectiveActionPanel ticket={viewTicket} />
              {reRepairReason ? (
                <div className="mfg-maint-view__section mfg-maint-view__section--compact">
                  <p className="mfg-detail-field__label">Additional repair reason</p>
                  <p className="mfg-maint-view__text">{reRepairReason}</p>
                </div>
              ) : null}
              {showSparePanel ? (
                <SparePartsPanel
                  ticket={viewTicket}
                  canEdit={canManageSpares}
                  onRefresh={refreshViewTicket}
                  onAddSpare={() => setAddSpareOpen(true)}
                  onIssueSpares={() => setIssueSparesOpen(true)}
                />
              ) : null}
            </div>
            {showViewActivityLog ? (
              <MaintenanceActivityLog logs={viewTicket.maintenance_logs} />
            ) : null}
          </div>
        ) : null}
      </Modal>

      <AddSpareModal
        open={addSpareOpen}
        onClose={() => setAddSpareOpen(false)}
        ticket={viewTicket}
        onSuccess={refreshViewTicket}
      />

      <IssueSparesConfirmModal
        open={issueSparesOpen}
        onClose={() => setIssueSparesOpen(false)}
        ticket={viewTicket}
        onSuccess={refreshViewTicket}
      />

      <Modal
        open={deleteDialog.open}
        onClose={() => !busyId && setDeleteDialog({ open: false, ticket: null })}
        title="Delete maintenance ticket?"
        footer={(
          <MfgDangerModalFooter
            onCancel={() => setDeleteDialog({ open: false, ticket: null })}
            onConfirm={submitDelete}
            saving={Boolean(busyId)}
            confirmLabel="Delete permanently"
          />
        )}
      >
        <div className="mfg-modal-confirm">
          <p className="mfg-modal-confirm__lead">
            Delete ticket <strong>{deleteDialog.ticket?.ticket_no || deleteDialog.ticket?.name}</strong>
            {deleteDialog.ticket?.workstation ? (
              <>
                {' · '}
                {deleteDialog.ticket.workstation}
              </>
            ) : null}
            ?
          </p>
          <p className="mfg-modal-confirm__warn">This action cannot be undone.</p>
        </div>
      </Modal>

      <Modal
        open={actionDialog.open}
        onClose={() => !busyId && setActionDialog({
          open: false, ticket: null, notes: '', mode: 'resolve', ...EMPTY_CLOSE_FORM,
        })}
        title={
          actionDialog.mode === 'resolve'
            ? 'Mark maintenance resolved'
            : actionDialog.mode === 'reopen'
              ? 'Send ticket for re-repair'
              : 'Close maintenance ticket'
        }
        footer={(
          <MfgModalFooter
            onCancel={() => setActionDialog({
              open: false, ticket: null, notes: '', mode: 'resolve', ...EMPTY_CLOSE_FORM,
            })}
            onSubmit={submitAction}
            saving={Boolean(busyId)}
            submitLabel={
              actionDialog.mode === 'resolve'
                ? 'Mark resolved'
                : actionDialog.mode === 'reopen'
                  ? 'Send to repair'
                  : 'Close ticket'
            }
            canSubmit={canSubmitAction}
          />
        )}
      >
        <div className={`mfg-wo-modal-form${actionDialog.mode === 'close' ? ' mfg-maint-close-form' : ''}`}>
          {actionDialog.mode === 'close' ? (
            <div className="mfg-maint-close-form__meta">
              <span className="mfg-maint-close-form__ticket">{actionDialog.ticket?.name}</span>
              <span className="mfg-maint-close-form__sep" aria-hidden>·</span>
              <span>{actionDialog.ticket?.workstation}</span>
            </div>
          ) : (
            <p className="mfg-wo-modal-form__lead">
              Ticket <strong>{actionDialog.ticket?.name}</strong>
              {' · '}
              {actionDialog.ticket?.workstation}
            </p>
          )}
          <Field
            label={
              actionDialog.mode === 'resolve'
                ? 'Repair notes'
                : actionDialog.mode === 'reopen'
                  ? 'Reason for re-repair'
                  : 'Closure notes'
            }
            required={isReasonRequired}
          >
            <textarea
              className={`pm-input${actionDialog.mode === 'close' ? ' mfg-maint-close-form__textarea' : ''}`}
              rows={actionDialog.mode === 'close' ? 2 : 3}
              value={actionDialog.notes}
              onChange={(e) => setActionDialog((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder={
                actionDialog.mode === 'resolve'
                  ? 'What was repaired?'
                  : actionDialog.mode === 'reopen'
                    ? 'Why are you sending this ticket back to repair?'
                    : 'Any final closure note'
              }
            />
          </Field>
          {actionDialog.mode === 'close' ? (
            <section className="mfg-maint-close-corrective" aria-label="Corrective action">
              <h4 className="mfg-maint-close-corrective__heading">Corrective Action</h4>
              <div className={`mfg-maint-close-form__grid${actionDialog.rootCause === 'Other' ? ' mfg-maint-close-form__grid--other' : ''}`}>
                <Field label="Root Cause">
                  <MfgCombobox
                    id="close-root-cause"
                    value={actionDialog.rootCause}
                    onChange={(val) => setActionDialog((prev) => ({
                      ...prev,
                      rootCause: val,
                      rootCauseNote: val === 'Other' ? prev.rootCauseNote : '',
                    }))}
                    items={ROOT_CAUSE_ITEMS}
                    placeholder="Select root cause…"
                    placement="auto"
                  />
                </Field>
                {actionDialog.rootCause === 'Other' ? (
                  <Field label="Specify other">
                    <input
                      type="text"
                      className="pm-input"
                      value={actionDialog.rootCauseNote}
                      onChange={(e) => setActionDialog((prev) => ({
                        ...prev,
                        rootCauseNote: e.target.value,
                      }))}
                      placeholder="Describe root cause"
                    />
                  </Field>
                ) : null}
              </div>
              <Field label="Corrective Action Taken">
                <textarea
                  className="pm-input mfg-maint-close-form__textarea"
                  rows={2}
                  value={actionDialog.correctiveAction}
                  onChange={(e) => setActionDialog((prev) => ({
                    ...prev,
                    correctiveAction: e.target.value,
                  }))}
                  placeholder="What was done to prevent recurrence?"
                />
              </Field>
              <div className="mfg-maint-close-form__pm">
                <label className={`mfg-maint-close-corrective__check${hasLinkedSchedule ? '' : ' is-disabled'}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(actionDialog.suggestFrequencyChange)}
                    disabled={!hasLinkedSchedule}
                    onChange={(e) => setActionDialog((prev) => {
                      const checked = e.target.checked;
                      const next = { ...prev, suggestFrequencyChange: checked };
                      if (checked && !String(prev.newFrequencyValue ?? '').trim()) {
                        next.newFrequencyValue = linkedScheduleFrequencyValue(prev.ticket);
                      }
                      return next;
                    })}
                  />
                  <span>Adjust PM schedule frequency</span>
                </label>
                <div className="mfg-maint-close-form__pm-slot">
                  {!hasLinkedSchedule ? (
                    <p className="mfg-maint-close-corrective__hint mfg-maint-close-corrective__hint--warn">
                      No PM schedule linked — cannot tune frequency.
                    </p>
                  ) : actionDialog.suggestFrequencyChange ? (
                    <div className="mfg-maint-close-form__pm-inline">
                      <div className="mfg-maint-close-form__pm-days">
                        <label className="mfg-maint-close-form__pm-inline-label" htmlFor="pm-freq-days">
                          Days
                        </label>
                        <input
                          id="pm-freq-days"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className="pm-input pm-input--no-spinner mfg-maint-close-form__freq-input"
                          min="1"
                          step="1"
                          value={actionDialog.newFrequencyValue}
                          onChange={(e) => setActionDialog((prev) => ({
                            ...prev,
                            newFrequencyValue: e.target.value,
                          }))}
                          placeholder=""
                          aria-invalid={pmFreqInvalid || undefined}
                        />
                      </div>
                      {pmFreqInvalid ? (
                        <p className="mfg-maint-close-corrective__hint mfg-maint-close-corrective__hint--warn">
                          Enter a valid day count
                        </p>
                      ) : null}
                      <span className="mfg-maint-close-corrective__schedule-chip">
                        {closeTicket?.linked_schedule_label || closeTicket?.linked_schedule}
                      </span>
                    </div>
                  ) : (
                    <p className="mfg-maint-close-corrective__hint">
                      Updates the linked PM interval after close.
                    </p>
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </Modal>
    </MfgPage>
  );
}
