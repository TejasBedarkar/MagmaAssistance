import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from 'recharts';
import {
  Activity, AlertCircle, AlertTriangle, CalendarDays, CheckCircle2,
  ClipboardCheck, ClipboardList, Package, Truck, Factory,
  ListChecks, Plus, Wrench,
} from '@/icons/mfgIcons.js';
import MfgKpiStat from '@/components/MfgKpiStat';
import { dashboard, production } from '@/api';
import { useAuth, ROLES, RoleGate } from '@/hooks/manufacturingAuth';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge';
import Modal, { MfgDangerModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import MfgCombobox from '@/components/MfgCombobox';
import {
  ActivityFeed,
  CHART_THEME,
  DarkChartTooltip,
  DashboardHero,
  KpiStrip,
  MfgPanel,
} from '@/components/MfgDashboardLayout.jsx';
import { fmtDateTime, fmtPct } from '@/utils/format';
import { getWorkOrderStatusChartColor } from '../utils/chartColors.js';
import { mfgPath } from '../paths.js';
import { MFG_PRODUCT_DEV_DASHBOARD_REFRESH } from '../utils/dashboardEvents.js';

const CAPA_ROOT_CAUSE_OPTIONS = [
  'Machine Calibration',
  'Material Spillage / Wastage',
  'Operator Error',
  'Poor Material Quality',
  'Rework / Reprocessing',
  'Setup / Startup Loss',
  'Measurement Error',
  'Tool Wear',
  'Other',
];

const CAPA_ROOT_CAUSE_ITEMS = CAPA_ROOT_CAUSE_OPTIONS.map((opt) => ({
  value: opt,
  label: opt,
}));

const EMPTY_EXCESS_REVIEW = {
  rootCause: '',
  rootCauseNote: '',
  correctiveAction: '',
  preventiveAction: '',
};

function useDashboardData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await dashboard.getMyDashboard();
      setData(d);
      setUpdated(new Date().toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onRefresh = () => {
      load();
    };
    window.addEventListener(MFG_PRODUCT_DEV_DASHBOARD_REFRESH, onRefresh);
    return () => window.removeEventListener(MFG_PRODUCT_DEV_DASHBOARD_REFRESH, onRefresh);
  }, [load]);

  return { data, loading, updated, reload: load };
}

export default function DashboardPage() {
  const { role } = useAuth();
  const { data, loading, updated, reload } = useDashboardData();

  if (loading && !data) return <PageLoader label="Loading manufacturing dashboard…" />;
  if (!data) return <EmptyState icon={Activity} title="No dashboard data" />;

  const variant = data.role || role;
  const common = { updated, loading, onRefresh: reload };

  return (
    <div className="pm-page mfg-dash">
      {variant === ROLES.PRODUCTION_HEAD && (
        <ProductionHeadView data={data} roleLabel={ROLES.PRODUCTION_HEAD} {...common} />
      )}
      {variant === ROLES.SUPERVISOR && (
        <SupervisorView data={data} roleLabel={ROLES.SUPERVISOR} {...common} />
      )}
      {variant === ROLES.OPERATOR && (
        <OperatorView data={data} roleLabel={ROLES.OPERATOR} {...common} />
      )}
      {variant === ROLES.QC_INSPECTOR && (
        <QCView data={data} roleLabel={ROLES.QC_INSPECTOR} {...common} />
      )}
      {variant === ROLES.STORE_KEEPER && (
        <StoreKeeperView data={data} roleLabel={ROLES.STORE_KEEPER} {...common} />
      )}
      {variant === ROLES.DISPATCH_COORDINATOR && (
        <DispatchView data={data} roleLabel={ROLES.DISPATCH_COORDINATOR} {...common} />
      )}
      {variant === ROLES.MAINTENANCE_TECHNICIAN && (
        <MaintenanceTechnicianView
          data={data}
          roleLabel={ROLES.MAINTENANCE_TECHNICIAN}
          {...common}
        />
      )}
      {!Object.values(ROLES).includes(variant) && (
        <ProductionHeadView data={data} roleLabel="Operations" {...common} />
      )}
    </div>
  );
}

function ProductionHeadView({ data, roleLabel, updated, loading, onRefresh }) {
  const {
    kpis = {},
    by_status = [],
    by_priority = [],
    recent_activity = [],
    product_dev_alerts = {},
    capacity_commitment_alerts = {},
  } = data;
  const pdPending = product_dev_alerts?.pending_count ?? 0;
  const pdItems = Array.isArray(product_dev_alerts?.items) ? product_dev_alerts.items : [];
  const firstPdOpp = pdItems[0]?.opportunity;
  const ccPending = capacity_commitment_alerts?.pending_count ?? 0;
  const ccItems = Array.isArray(capacity_commitment_alerts?.items) ? capacity_commitment_alerts.items : [];
  const firstCcQuot = ccItems[0]?.quotation;
  const excessPending = kpis.pending_excess_approvals ?? 0;
  const statusChart = by_status.map((s, i) => ({
    name: s.status,
    value: s.cnt,
    fill: getWorkOrderStatusChartColor(s.status, i),
  }));
  const totalStatus = statusChart.reduce((n, s) => n + (s.value || 0), 0);

  return (
    <>
      <DashboardHero
        title="Manufacturing Control Center"
        subtitle="Executive overview of work orders, quality, and shop-floor throughput"
        roleLabel={roleLabel}
        updated={updated}
        loading={loading}
        onRefresh={onRefresh}
        action={(
          <RoleGate allow={[ROLES.PRODUCTION_HEAD]}>
            <Link to={mfgPath('/work-orders/new')} className="pm-btn pm-btn-primary">
              <Plus size={16} /> New work order
            </Link>
          </RoleGate>
        )}
      />

      {(kpis.overdue ?? 0) > 0 && (
        <div className="mfg-alert-banner" role="alert">
          <div>
            <strong>{kpis.overdue} overdue work order{kpis.overdue === 1 ? '' : 's'}</strong>
            <span> — Review capacity and dispatch dates on the shop floor.</span>
          </div>
          <Link to={mfgPath('/work-orders')} className="pm-btn pm-btn-sm">View orders</Link>
        </div>
      )}

      {pdPending > 0 && (
        <div className="mfg-alert-banner" role="alert">
          <div>
            <strong>
              {pdPending} new product{pdPending === 1 ? '' : 's'} awaiting review
            </strong>
            <span>
              {' '}
              — Sales requested Product Development.
              {pdItems[0]?.product ? ` (${pdItems[0].product})` : ''}
              {' '}
              Complete the manufacturing check on the opportunity.
            </span>
          </div>
          {firstPdOpp ? (
            <Link
              to={`${mfgPath('/new-product-requirement')}?open=${encodeURIComponent(firstPdOpp)}`}
              className="pm-btn pm-btn-sm"
            >
              Review now
            </Link>
          ) : null}
        </div>
      )}

      {ccPending > 0 && (
        <div className="mfg-alert-banner" role="alert">
          <div>
            <strong>
              {ccPending} quotation{ccPending === 1 ? '' : 's'} awaiting capacity commit
            </strong>
            <span>
              {' '}
              — Sales quotations need production dates and machine allocation.
              {ccItems[0]?.customer ? ` (${ccItems[0].customer})` : ''}
            </span>
          </div>
          {firstCcQuot ? (
            <Link
              to={`${mfgPath('/capacity-commitments')}?open=${encodeURIComponent(firstCcQuot)}`}
              className="pm-btn pm-btn-sm"
            >
              Commit capacity
            </Link>
          ) : null}
        </div>
      )}

      {excessPending > 0 && (
        <div className="mfg-alert-banner mfg-alert-banner--warn" role="alert">
          <div>
            <strong>
              {excessPending} excess consumption{excessPending === 1 ? '' : 's'} awaiting CAPA review
            </strong>
            <span> — Operators completed jobs with material over planned usage.</span>
          </div>
        </div>
      )}

      <KpiStrip>
        <div className="mfg-kpi-stats">
          <MfgKpiStat label="Active work orders" value={kpis.total_active} tone="blue" icon={ClipboardList} />
          <MfgKpiStat label="Overdue" value={kpis.overdue} tone="red" icon={AlertTriangle} />
          <MfgKpiStat label="Delivered this week" value={kpis.delivered_this_week} tone="green" icon={Truck} />
          <MfgKpiStat label="QC fail rate" value={fmtPct(kpis.qc_fail_rate_pct)} tone="amber" icon={AlertCircle} />
          <RoleGate allow={[ROLES.PRODUCTION_HEAD]}>
            <MfgKpiStat
              label="Excess approvals"
              value={excessPending}
              tone={excessPending > 0 ? 'orange' : 'green'}
              icon={AlertTriangle}
            />
          </RoleGate>
        </div>
      </KpiStrip>

      <RoleGate allow={[ROLES.PRODUCTION_HEAD]}>
        <ExcessApprovalsPanel pendingCount={excessPending} onRefresh={onRefresh} />
      </RoleGate>

      <div className="mfg-insights-grid">
        <MfgPanel title="Work orders by status" subtitle={totalStatus ? `${totalStatus} total in system` : 'No data'}>
          <div className="mfg-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusChart}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={3}
                  stroke="transparent"
                >
                  {statusChart.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<DarkChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </MfgPanel>

        <MfgPanel title="Open orders by priority" subtitle="Workload distribution">
          <div className="mfg-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={by_priority} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
                <XAxis dataKey="priority" tick={{ fill: CHART_THEME.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: CHART_THEME.tick, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<DarkChartTooltip />} cursor={{ fill: CHART_THEME.cursorFill }} />
                <Bar dataKey="cnt" fill={CHART_THEME.bar} radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </MfgPanel>

        <MfgPanel title="Recent activity" subtitle="Audit trail — last changes">
          <ActivityFeed
            items={recent_activity.map((a) => ({
              ...a,
              creation: fmtDateTime(a.creation),
            }))}
          />
        </MfgPanel>
      </div>
    </>
  );
}

function ExcessApprovalsPanel({ pendingCount, onRefresh }) {
  const [expanded, setExpanded] = useState(pendingCount > 0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(EMPTY_EXCESS_REVIEW);
  const [saving, setSaving] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await production.listPendingExcess();
      setItems(Array.isArray(rows) ? rows : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) loadItems();
  }, [expanded, loadItems]);

  useEffect(() => {
    if (pendingCount > 0) setExpanded(true);
  }, [pendingCount]);

  const openReview = async (jobCard) => {
    setSaving(true);
    try {
      const data = await production.getExcessDetail(jobCard);
      setDetail(data);
      setForm({
        rootCause: data?.capa_root_cause || '',
        rootCauseNote: data?.capa_root_cause_note || '',
        correctiveAction: data?.capa_corrective_action || '',
        preventiveAction: data?.capa_preventive_action || '',
      });
      setRejectMode(false);
      setRejectReason('');
      setReviewOpen(true);
    } catch {
      /* toast from API */
    } finally {
      setSaving(false);
    }
  };

  const closeReview = () => {
    if (saving) return;
    setReviewOpen(false);
    setDetail(null);
    setForm(EMPTY_EXCESS_REVIEW);
    setRejectMode(false);
    setRejectReason('');
  };

  const refreshAll = async () => {
    await loadItems();
    onRefresh?.();
  };

  const handleApprove = async () => {
    if (!detail?.name || !form.rootCause.trim()) {
      toast.error('Select a root cause before approving');
      return;
    }
    setSaving(true);
    try {
      await production.approveExcess(detail.name, {
        capa_root_cause: form.rootCause,
        capa_root_cause_note: form.rootCause === 'Other' ? form.rootCauseNote : undefined,
        capa_corrective_action: form.correctiveAction || undefined,
        capa_preventive_action: form.preventiveAction || undefined,
      });
      toast.success('Excess consumption approved');
      closeReview();
      await refreshAll();
    } catch {
      /* toast from API */
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!detail?.name) return;
    if (!rejectMode) {
      setRejectMode(true);
      return;
    }
    if (!rejectReason.trim()) {
      toast.error('Enter a rejection reason');
      return;
    }
    setSaving(true);
    try {
      await production.rejectExcess(detail.name, rejectReason.trim());
      toast.success('Excess consumption rejected');
      closeReview();
      await refreshAll();
    } catch {
      /* toast from API */
    } finally {
      setSaving(false);
    }
  };

  const canApprove = Boolean(form.rootCause.trim()) && !rejectMode;

  return (
    <>
      <MfgPanel
        title="Excess consumption approvals"
        subtitle="Review material over-consumption and record structured CAPA"
        flush
        headAction={(
          <button
            type="button"
            className="mfg-excess-approvals__toggle pm-btn pm-btn-sm"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Hide' : 'Show'}
            {pendingCount > 0 ? (
              <span className="mfg-excess-approvals__badge">{pendingCount}</span>
            ) : null}
          </button>
        )}
      >
        {!expanded ? (
          <div className="mfg-empty-panel">
            <p className="mfg-excess-approvals__collapsed">
              {pendingCount > 0
                ? `${pendingCount} job card${pendingCount === 1 ? '' : 's'} awaiting review`
                : 'No pending excess approvals'}
            </p>
          </div>
        ) : loading ? (
          <div className="mfg-empty-panel"><PageLoader label="Loading excess approvals…" /></div>
        ) : items.length === 0 ? (
          <div className="mfg-empty-panel">
            <EmptyState icon={CheckCircle2} title="No pending excess approvals" />
          </div>
        ) : (
          <div className="mfg-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job card</th>
                  <th>Product</th>
                  <th>Excess</th>
                  <th>Operator</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.name}>
                    <td className="font-mono mfg-dash-td-mono">
                      <Link to={mfgPath(`/work-orders/${row.work_order}`)}>{row.name}</Link>
                    </td>
                    <td>{row.product || '—'}</td>
                    <td>{row.excess_summary || '—'}</td>
                    <td>{row.operator || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="pm-btn pm-btn-sm pm-btn-primary"
                        onClick={() => openReview(row.name)}
                        disabled={saving}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MfgPanel>

      <Modal
        open={reviewOpen}
        onClose={closeReview}
        title="Review excess consumption"
        footer={rejectMode ? (
          <MfgDangerModalFooter
            onCancel={() => setRejectMode(false)}
            onConfirm={handleReject}
            saving={saving}
            confirmLabel="Confirm reject"
            cancelLabel="Back"
            canConfirm={Boolean(rejectReason.trim())}
            savingLabel="Rejecting…"
          />
        ) : (
          <div className="mfg-excess-review-footer">
            <button
              type="button"
              className="pm-btn pm-btn-secondary"
              onClick={closeReview}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pm-btn pm-btn-danger"
              onClick={handleReject}
              disabled={saving}
            >
              Reject
            </button>
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              onClick={handleApprove}
              disabled={saving || !canApprove}
            >
              Approve
            </button>
          </div>
        )}
      >
        {detail ? (
          <div className="mfg-excess-review">
            <div className="mfg-excess-review__meta">
              <span className="font-mono">{detail.name}</span>
              <span aria-hidden>·</span>
              <span>{detail.product || '—'}</span>
              <span aria-hidden>·</span>
              <span>Produced {detail.completed_qty || 0}</span>
            </div>
            <div className="mfg-table-wrap mfg-excess-review__table">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Planned</th>
                    <th>Actual</th>
                    <th>Variance</th>
                    <th>Operator reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.excess_materials || []).map((row) => (
                    <tr key={row.item_code}>
                      <td>{row.item_name || row.item_code}</td>
                      <td>{row.planned_qty}</td>
                      <td>{row.actual_qty}</td>
                      <td className="mfg-excess-review__variance">+{row.variance_qty}</td>
                      <td>{row.capa_reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rejectMode ? (
              <Field label="Rejection reason" required>
                <textarea
                  className="pm-input mfg-excess-review__textarea"
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Why is this excess not acceptable?"
                />
              </Field>
            ) : (
              <>
                <Field label="Root cause" required>
                  <MfgCombobox
                    items={CAPA_ROOT_CAUSE_ITEMS}
                    value={form.rootCause}
                    onChange={(value) => setForm((prev) => ({ ...prev, rootCause: value }))}
                    placeholder="Select root cause"
                  />
                </Field>
                {form.rootCause === 'Other' ? (
                  <Field label="Root cause note">
                    <input
                      className="pm-input"
                      value={form.rootCauseNote}
                      onChange={(e) => setForm((prev) => ({ ...prev, rootCauseNote: e.target.value }))}
                      placeholder="Describe root cause"
                    />
                  </Field>
                ) : null}
                <Field label="Corrective action (now)">
                  <textarea
                    className="pm-input mfg-excess-review__textarea"
                    rows={2}
                    value={form.correctiveAction}
                    onChange={(e) => setForm((prev) => ({ ...prev, correctiveAction: e.target.value }))}
                    placeholder="What was done to address this occurrence?"
                  />
                </Field>
                <Field label="Preventive action (future)">
                  <textarea
                    className="pm-input mfg-excess-review__textarea"
                    rows={2}
                    value={form.preventiveAction}
                    onChange={(e) => setForm((prev) => ({ ...prev, preventiveAction: e.target.value }))}
                    placeholder="How will recurrence be prevented?"
                  />
                </Field>
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function SupervisorView({ data, roleLabel, updated, loading, onRefresh }) {
  const { schedules_today = [], job_cards_today = [], active_downtimes = [] } = data;
  const activeJobs = job_cards_today.filter((j) => j.status === 'In Progress').length;
  const completed = job_cards_today.filter((j) => j.status === 'Completed').length;

  return (
    <>
      <DashboardHero
        title="Shop floor command"
        subtitle="Today's schedules, live job cards, and downtime alerts"
        roleLabel={roleLabel}
        updated={updated}
        loading={loading}
        onRefresh={onRefresh}
      />

      <KpiStrip>
        <div className="mfg-kpi-stats">
          <MfgKpiStat label="Schedules today" value={schedules_today.length} tone="blue" icon={CalendarDays} />
          <MfgKpiStat label="Active jobs" value={activeJobs} tone="amber" icon={Activity} />
          <MfgKpiStat label="Completed today" value={completed} tone="green" icon={CheckCircle2} />
          <MfgKpiStat label="Active downtimes" value={active_downtimes.length} tone="red" icon={Wrench} />
        </div>
      </KpiStrip>

      <MfgPanel
        title="Job cards — today"
        subtitle={`${job_cards_today.length} operation${job_cards_today.length === 1 ? '' : 's'} on the floor`}
        flush
        headAction={(
          <Link to={mfgPath('/production')} className="pm-btn pm-btn-sm">Open production</Link>
        )}
      >
        {job_cards_today.length === 0 ? (
          <div className="mfg-empty-panel">
            <EmptyState icon={Factory} title="No jobs scheduled" description="Schedules will appear when work orders are released." />
          </div>
        ) : (
          <div className="mfg-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th><th>Work order</th><th>Workstation</th>
                  <th>Operator</th><th>Operation</th><th>Qty</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {job_cards_today.map((j) => (
                  <tr key={j.name}>
                    <td className="font-mono mfg-dash-td-mono">{j.name}</td>
                    <td>
                      <Link to={mfgPath(`/work-orders/${j.work_order}`)}>{j.work_order}</Link>
                    </td>
                    <td>{j.workstation}</td>
                    <td>{j.operator}</td>
                    <td>{j.operation}</td>
                    <td>{j.actual_qty}/{j.planned_qty}</td>
                    <td><StatusBadge status={j.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MfgPanel>
    </>
  );
}

function OperatorView({ data, roleLabel, updated, loading, onRefresh }) {
  const { my_active_jobs = [], completed_today = 0 } = data;

  return (
    <>
      <DashboardHero
        title="My work center"
        subtitle="Job cards assigned to you — start, pause, or complete from production"
        roleLabel={roleLabel}
        updated={updated}
        loading={loading}
        onRefresh={onRefresh}
        action={(
          <Link to={mfgPath('/production')} className="pm-btn pm-btn-primary">
            <Factory size={16} /> Open production
          </Link>
        )}
      />

      <KpiStrip>
        <div className="mfg-kpi-stats">
          <MfgKpiStat label="Active jobs" value={my_active_jobs.length} tone="amber" icon={Factory} />
          <MfgKpiStat label="Completed today" value={completed_today} tone="green" icon={CheckCircle2} />
        </div>
      </KpiStrip>

      {my_active_jobs.length === 0 ? (
        <MfgPanel title="Job queue" subtitle="Waiting for supervisor assignment">
          <div className="mfg-empty-panel">
            <EmptyState
              icon={ListChecks}
              title="No active jobs"
              description="Your supervisor will release operations when materials and schedule are ready."
            />
          </div>
        </MfgPanel>
      ) : (
        <div className="mfg-dash-grid-2">
          {my_active_jobs.map((j) => {
            const pct = j.planned_qty
              ? Math.min(100, Math.round(((j.actual_qty || 0) / j.planned_qty) * 100))
              : 0;
            return (
              <Link
                key={j.name}
                to={mfgPath(`/production?job=${j.name}`)}
                className="mfg-job-card"
              >
                <div className="mfg-job-card__head">
                  <div className="mfg-job-card__head-main">
                    <p className="mfg-job-card__id">{j.name}</p>
                    <p className="mfg-job-card__operation">{j.operation}</p>
                  </div>
                  <StatusBadge status={j.status} />
                </div>
                <div className="mfg-job-card__grid">
                  <div className="mfg-job-card__stat">
                    <p className="mfg-job-card__stat-label">Workstation</p>
                    <p className="mfg-job-card__stat-value">{j.workstation}</p>
                  </div>
                  <div className="mfg-job-card__stat">
                    <p className="mfg-job-card__stat-label">Progress</p>
                    <p className="mfg-job-card__stat-value">{j.actual_qty || 0} / {j.planned_qty}</p>
                  </div>
                </div>
                <div className="mfg-job-card__progress">
                  <div className="mfg-job-card__progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <p className="mfg-job-card__foot">
                  Scheduled {fmtDateTime(j.planned_start)}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function QCView({ data, roleLabel, updated, loading, onRefresh }) {
  const {
    pending_inspections = [],
    awaiting_inspection = [],
    completed_today = 0,
    fails_today = 0,
    failed_today = [],
  } = data;

  const queueEmpty = pending_inspections.length === 0 && awaiting_inspection.length === 0;

  return (
    <>
      <DashboardHero
        title="Quality control desk"
        subtitle="Inspection queue, pass/fail metrics, and work-order traceability"
        roleLabel={roleLabel}
        updated={updated}
        loading={loading}
        onRefresh={onRefresh}
        action={(
          awaiting_inspection.length > 0 ? (
            <Link to={mfgPath('/work-orders')} className="pm-btn pm-btn-primary">
              <Plus size={16} /> Add inspection
            </Link>
          ) : (
            <Link to={mfgPath('/quality')} className="pm-btn pm-btn-primary">
              <CheckCircle2 size={16} /> Inspect now
            </Link>
          )
        )}
      />

      {awaiting_inspection.length > 0 && (
        <div className="mfg-alert-banner" role="alert">
          <div>
            <strong>{awaiting_inspection.length} work order{awaiting_inspection.length === 1 ? '' : 's'} need inspection setup</strong>
            <span> — Open the work order and add an In-Process inspection.</span>
          </div>
          <Link to={mfgPath('/work-orders')} className="pm-btn pm-btn-sm">Open work orders</Link>
        </div>
      )}

      {fails_today > 0 && (
        <div className="mfg-alert-banner" role="alert">
          <div>
            <strong>{fails_today} fail{fails_today === 1 ? '' : 's'} today</strong>
            <span> — Review rework and notify production supervisor.</span>
          </div>
          <Link to={mfgPath('/quality?tab=failed')} className="pm-btn pm-btn-sm">View failures</Link>
        </div>
      )}

      <KpiStrip>
        <div className="mfg-kpi-stats">
          <MfgKpiStat label="Awaiting inspection" value={awaiting_inspection.length} tone="amber" icon={ClipboardList} />
          <MfgKpiStat label="Pending inspections" value={pending_inspections.length} tone="amber" icon={ClipboardCheck} />
          <MfgKpiStat label="Completed today" value={completed_today} tone="green" icon={CheckCircle2} />
          <MfgKpiStat label="Fails today" value={fails_today} tone="red" icon={AlertTriangle} />
        </div>
      </KpiStrip>

      {awaiting_inspection.length > 0 ? (
        <MfgPanel
          title="Work orders awaiting inspection"
          subtitle="Add an In-Process inspection before Pass/Fail"
          flush
          headAction={(
            <span className="mfg-dash-role-pill mfg-dash-role-pill--warn">
              {awaiting_inspection.length} waiting
            </span>
          )}
        >
          <div className="mfg-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Work order</th><th>Customer</th><th>Item</th><th />
                </tr>
              </thead>
              <tbody>
                {awaiting_inspection.map((wo) => (
                  <tr key={wo.work_order}>
                    <td>
                      <Link to={mfgPath(`/work-orders/${wo.work_order}`)}>{wo.work_order}</Link>
                    </td>
                    <td>{wo.customer || '—'}</td>
                    <td>{wo.item_code || '—'}</td>
                    <td>
                      <Link to={mfgPath(`/work-orders/${wo.work_order}`)} className="pm-btn pm-btn-sm pm-btn-primary">
                        Add inspection
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MfgPanel>
      ) : null}

      <MfgPanel
        title="Inspection queue"
        subtitle={pending_inspections.length ? 'Oldest first — click work order to open' : 'Pass/Fail on created inspections'}
        flush
        headAction={pending_inspections.length ? (
          <span className="mfg-dash-role-pill mfg-dash-role-pill--warn">
            {pending_inspections.length} pending
          </span>
        ) : queueEmpty ? (
          <span className="mfg-dash-role-pill mfg-dash-role-pill--success">
            Clear
          </span>
        ) : null}
      >
        {pending_inspections.length === 0 ? (
          <div className="mfg-empty-panel">
            <EmptyState
              icon={CheckCircle2}
              title={awaiting_inspection.length ? 'No inspections in queue yet' : 'All caught up'}
              description={
                awaiting_inspection.length
                  ? 'Add an In-Process inspection on the work order first — then it appears here for Pass/Fail.'
                  : 'No inspections waiting in queue.'
              }
            />
          </div>
        ) : (
          <div className="mfg-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Inspection</th><th>Work order</th><th>Stage</th>
                  <th>Job card</th><th>Created</th><th />
                </tr>
              </thead>
              <tbody>
                {pending_inspections.map((q) => (
                  <tr key={q.name}>
                    <td className="font-mono mfg-dash-td-mono">{q.name}</td>
                    <td>
                      <Link to={mfgPath(`/work-orders/${q.work_order}`)}>{q.work_order}</Link>
                    </td>
                    <td><StatusBadge status={q.stage} /></td>
                    <td>{q.job_card || '—'}</td>
                    <td>{fmtDateTime(q.creation)}</td>
                    <td>
                      <Link to={mfgPath('/quality')} className="pm-btn pm-btn-sm pm-btn-primary">Inspect</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MfgPanel>

      {failed_today.length > 0 ? (
        <MfgPanel
          title="Failed today"
          subtitle="Review defect details and coordinate rework"
          flush
          headAction={(
            <Link to={mfgPath('/quality?tab=failed')} className="pm-btn pm-btn-sm">
              View all
            </Link>
          )}
        >
          <div className="mfg-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Inspection</th>
                  <th>Work order</th>
                  <th>Stage</th>
                  <th>Defect</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {failed_today.map((q) => (
                  <tr key={q.name}>
                    <td className="font-mono mfg-dash-td-mono">{q.name}</td>
                    <td>
                      <Link to={mfgPath(`/work-orders/${q.work_order}`)}>{q.work_order}</Link>
                    </td>
                    <td><StatusBadge status={q.stage} /></td>
                    <td>{q.defect_type || 'Unspecified'}</td>
                    <td>
                      <Link to={mfgPath('/quality?tab=failed')} className="pm-btn pm-btn-sm">Details</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MfgPanel>
      ) : null}
    </>
  );
}

function StoreKeeperView({ data, roleLabel, updated, loading, onRefresh }) {
  const {
    shortages = [],
    pending_checks = 0,
    pending_check_orders: pendingCheckOrders = [],
    stock_summary: stockSummary = {},
    stock_rows: stockRows = [],
    low_stock: lowStock = [],
    by_warehouse: byWarehouse = [],
  } = data;

  const [stockQuery, setStockQuery] = useState('');
  const q = stockQuery.trim().toLowerCase();
  const filteredStock = q
    ? stockRows.filter((r) => (
      String(r.item_code || '').toLowerCase().includes(q)
      || String(r.item_name || '').toLowerCase().includes(q)
      || String(r.warehouse || '').toLowerCase().includes(q)
    ))
    : stockRows;

  const money = (v) => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
  const num = (v) => (Number(v) || 0).toLocaleString('en-IN');

  return (
    <>
      <DashboardHero
        title="Materials & inventory"
        subtitle="Shortages, pending material checks, and work-order readiness"
        roleLabel={roleLabel}
        updated={updated}
        loading={loading}
        onRefresh={onRefresh}
        action={(
          <Link to={mfgPath('/materials')} className="pm-btn pm-btn-primary">
            <Package size={16} /> Material checks
          </Link>
        )}
      />

      <KpiStrip>
        <div className="mfg-kpi-stats">
          <MfgKpiStat label="Material shortages" value={shortages.length} tone="red" icon={Package} />
          <MfgKpiStat label="Pending checks" value={pending_checks} tone="amber" icon={ClipboardList} />
          <MfgKpiStat label="SKUs in stock" value={stockSummary.total_skus ?? 0} tone="blue" icon={Package} />
          <MfgKpiStat label="On-hand qty" value={num(stockSummary.total_qty)} tone="green" icon={Package} />
          <MfgKpiStat label="Stock value" value={money(stockSummary.total_value)} tone="purple" icon={ClipboardList} />
          <MfgKpiStat label="Low stock" value={stockSummary.low_stock_count ?? 0} tone="orange" icon={Package} />
        </div>
      </KpiStrip>

      {byWarehouse.length > 0 ? (
        <MfgPanel title="Stock by warehouse" subtitle="On-hand quantity and value per location" flush>
          <div className="mfg-wh-cards">
            {byWarehouse.map((w) => (
              <div key={w.warehouse || 'na'} className="mfg-wh-card">
                <div className="mfg-wh-card__name">{w.warehouse || '—'}</div>
                <div className="mfg-wh-card__qty">{num(w.qty)} <span>units</span></div>
                <div className="mfg-wh-card__meta">{money(w.value)} · {w.items} items</div>
              </div>
            ))}
          </div>
        </MfgPanel>
      ) : null}

      <MfgPanel title="Live stock" subtitle="What's in store — on-hand, reserved, available" flush>
        <div className="mfg-stock-toolbar">
          <input
            className="mfg-stock-search"
            type="text"
            placeholder="Search item or warehouse…"
            value={stockQuery}
            onChange={(e) => setStockQuery(e.target.value)}
          />
          <span className="mfg-stock-count">{filteredStock.length} of {stockRows.length}</span>
        </div>
        {filteredStock.length === 0 ? (
          <div className="mfg-empty-panel">
            <EmptyState icon={Package} title="No stock rows" description="No matching stock to show." />
          </div>
        ) : (
          <div className="mfg-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th><th>Warehouse</th>
                  <th className="mfg-num">On-hand</th>
                  <th className="mfg-num">Reserved</th>
                  <th className="mfg-num">Available</th>
                  <th className="mfg-num">Value</th>
                </tr>
              </thead>
              <tbody>
                {filteredStock.map((r) => (
                  <tr key={`${r.item_code}-${r.warehouse}`}>
                    <td>
                      <span className="font-mono mfg-dash-td-mono">{r.item_code}</span>
                      <span className="mfg-stock-name">{r.item_name}</span>
                    </td>
                    <td>{r.warehouse || '—'}</td>
                    <td className="mfg-num">{num(r.actual_qty)}</td>
                    <td className="mfg-num">{Number(r.reserved_qty) > 0 ? `🔒 ${num(r.reserved_qty)}` : '—'}</td>
                    <td className={`mfg-num${Number(r.available_qty) <= 0 ? ' mfg-neg' : ''}`}>{num(r.available_qty)}</td>
                    <td className="mfg-num">{money(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MfgPanel>

      {lowStock.length > 0 ? (
        <MfgPanel title="Low stock — reorder now" subtitle="Items below safety stock" flush>
          <div className="mfg-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th><th>Warehouse</th>
                  <th className="mfg-num">On-hand</th>
                  <th className="mfg-num">Safety</th>
                  <th className="mfg-num">Suggested</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((r) => (
                  <tr key={`${r.item_code}-${r.warehouse}`}>
                    <td>
                      <span className="font-mono mfg-dash-td-mono">{r.item_code}</span>
                      <span className="mfg-stock-name">{r.item_name}</span>
                    </td>
                    <td>{r.warehouse || '—'}</td>
                    <td className="mfg-num mfg-neg">{num(r.actual_qty)}</td>
                    <td className="mfg-num">{num(r.safety_stock)}</td>
                    <td className="mfg-num">+{num(r.suggested_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MfgPanel>
      ) : null}

      <MfgPanel
        title="Material checks to action"
        subtitle="Open the work order and run its material check"
        flush
      >
        {pendingCheckOrders.length === 0 ? (
          <div className="mfg-empty-panel">
            <EmptyState
              icon={ClipboardList}
              title="No pending material checks"
              description="No work orders are waiting for a store material check."
            />
          </div>
        ) : (
          <div className="mfg-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Work order</th><th>Product</th><th>Priority</th><th>Due</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingCheckOrders.map((o) => (
                  <tr key={o.name}>
                    <td className="font-mono mfg-dash-td-mono">{o.work_order}</td>
                    <td>{o.product || '—'}</td>
                    <td><PriorityBadge priority={o.priority} /></td>
                    <td>{o.expected_delivery_date || '—'}</td>
                    <td>
                      <Link
                        to={mfgPath(`/work-orders/${o.work_order}`)}
                        className="pm-btn pm-btn-ghost pm-btn-sm"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MfgPanel>

      <MfgPanel title="Shortage register" subtitle="Prioritize by due date" flush>
        {shortages.length === 0 ? (
          <div className="mfg-empty-panel">
            <EmptyState icon={Package} title="No shortages" description="All material checks are within availability." />
          </div>
        ) : (
          <div className="mfg-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Check</th><th>Work order</th><th>Priority</th><th>Due</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shortages.map((s) => (
                  <tr key={s.name}>
                    <td className="font-mono mfg-dash-td-mono">{s.name}</td>
                    <td><Link to={mfgPath(`/work-orders/${s.work_order}`)}>{s.work_order}</Link></td>
                    <td><PriorityBadge priority={s.priority} /></td>
                    <td>{s.expected_delivery_date || '—'}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MfgPanel>
    </>
  );
}

function MaintenanceTechnicianView({ data, roleLabel, updated, loading, onRefresh }) {
  const counts = data.counts || {};
  const openTickets = data.open_tickets || [];

  return (
    <>
      <DashboardHero
        title="Maintenance queue"
        subtitle="Open breakdown tickets — assign, repair, and close from the board"
        roleLabel={roleLabel}
        updated={updated}
        loading={loading}
        onRefresh={onRefresh}
        action={(
          <Link to={mfgPath('/maintenance')} className="pm-btn pm-btn-primary">
            <Wrench size={16} /> Maintenance board
          </Link>
        )}
      />

      <KpiStrip>
        <div className="mfg-kpi-stats">
          <MfgKpiStat
            label="Open queue"
            value={data.open_total ?? 0}
            tone="orange"
            icon={Wrench}
          />
          <MfgKpiStat
            label="Open"
            value={counts.Open ?? 0}
            tone="amber"
            icon={AlertCircle}
          />
          <MfgKpiStat
            label="Assigned"
            value={counts.Assigned ?? 0}
            tone="blue"
            icon={ClipboardList}
          />
          <MfgKpiStat
            label="In repair"
            value={counts['In Repair'] ?? 0}
            tone="purple"
            icon={Activity}
          />
        </div>
      </KpiStrip>

      <MfgPanel title="Active tickets" subtitle="Open, assigned, and in-repair breakdowns" flush>
        {openTickets.length === 0 ? (
          <div className="mfg-empty-panel">
            <EmptyState
              icon={Wrench}
              title="No open tickets"
              description="New breakdown reports from the shop floor will appear here."
            />
          </div>
        ) : (
          <ul className="divide-y mfg-dash-list">
            {openTickets.map((ticket) => (
              <li key={ticket.name} className="mfg-dash-list__item">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <Link
                      to={mfgPath('/maintenance')}
                      className="mfg-dash-list__title"
                    >
                      {ticket.ticket_no || ticket.name}
                    </Link>
                    <p className="mfg-dash-list__meta">
                      {ticket.workstation}
                      {' · '}
                      {ticket.breakdown_reason || 'Breakdown'}
                      {ticket.assigned_technician
                        ? ` · ${ticket.assigned_technician}`
                        : ''}
                    </p>
                  </div>
                  <div className="mfg-table-actions">
                    <PriorityBadge priority={ticket.priority} />
                    <StatusBadge status={ticket.status} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </MfgPanel>
    </>
  );
}

function DispatchView({ data, roleLabel, updated, loading, onRefresh }) {
  const { ready_to_dispatch = [], in_transit = [], delivered_today = 0 } = data;

  return (
    <>
      <DashboardHero
        title="Dispatch & logistics"
        subtitle="Ready to ship, in-transit tracking, and daily deliveries"
        roleLabel={roleLabel}
        updated={updated}
        loading={loading}
        onRefresh={onRefresh}
        action={(
          <Link to={mfgPath('/dispatch')} className="pm-btn pm-btn-primary">
            <Truck size={16} /> Dispatch board
          </Link>
        )}
      />

      <KpiStrip>
        <div className="mfg-kpi-stats">
          <MfgKpiStat label="Ready to dispatch" value={ready_to_dispatch.length} tone="orange" icon={Truck} />
          <MfgKpiStat label="In transit" value={in_transit.length} tone="purple" icon={Activity} />
          <MfgKpiStat label="Delivered today" value={delivered_today} tone="green" icon={CheckCircle2} />
        </div>
      </KpiStrip>

      <div className="mfg-dash-grid-2">
        <MfgPanel title="Ready to dispatch" subtitle="Confirm packing before dispatch note" flush>
          {ready_to_dispatch.length === 0 ? (
            <div className="mfg-empty-panel"><EmptyState icon={Truck} title="None pending" /></div>
          ) : (
            <ul className="divide-y mfg-dash-list">
              {ready_to_dispatch.map((w) => (
                <li key={w.name} className="mfg-dash-list__item">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <Link to={mfgPath(`/work-orders/${w.name}`)} className="mfg-dash-list__title">{w.name}</Link>
                      <p className="mfg-dash-list__meta">
                        {w.customer} · {w.item_code} · Qty {w.qty}
                      </p>
                    </div>
                    <div className="mfg-table-actions">
                      <PriorityBadge priority={w.priority} />
                      <Link to={mfgPath('/dispatch')} className="pm-btn pm-btn-sm pm-btn-primary">Dispatch</Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </MfgPanel>

        <MfgPanel title="In transit" subtitle="Active shipments" flush>
          {in_transit.length === 0 ? (
            <div className="mfg-empty-panel"><EmptyState icon={Activity} title="Nothing in transit" /></div>
          ) : (
            <ul className="divide-y mfg-dash-list">
              {in_transit.map((d) => (
                <li key={d.name} className="mfg-dash-list__item">
                  <p className="mfg-dash-list__id">{d.name}</p>
                  <p className="mfg-dash-list__subtitle">{d.destination}</p>
                  <p className="mfg-dash-list__meta">
                    Vehicle {d.vehicle_no || '—'}
                    {d.driver_phone ? ` · ${d.driver_phone}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </MfgPanel>
      </div>
    </>
  );
}
