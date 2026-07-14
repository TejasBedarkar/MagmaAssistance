import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, LineChart, Line, AreaChart, Area, Legend,
} from 'recharts';
import {
  AlertCircle, AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck,
  ClipboardList, Download, Factory, FileBarChart, FileCheck, Printer,
  TrendingUp, Truck, Wrench,
} from '@/icons/mfgIcons.js';
import MfgKpiStat from '@/components/MfgKpiStat';
import { reports, workOrders } from '@/api';
import { useAuth, ROLES } from '@/hooks/manufacturingAuth';
import { PageLoader, InlineLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { fmtDate, fmtNumber, fmtPct, fmtDuration, fmtDateTime } from '@/utils/format';
import { generateReportPdf, generateCombinedReportPdf } from '@/utils/reportPdf';
import { mfgPath } from '../paths.js';
import { getReportChartColors } from '../utils/themeTokens.js';
import { Field } from '@/components/MfgFormField';
import MfgCombobox from '@/components/MfgCombobox';
import {
  ChartLegend,
  CHART_THEME,
  DarkChartTooltip,
  MfgPanel,
} from '@/components/MfgDashboardLayout.jsx';
import {
  MfgButton,
  MfgPage,
  MfgPageHeader,
  MfgTableCard,
  MfgTd,
  MfgTh,
  MfgTableHead,
  MfgToolbar,
} from '@/components/MfgPageLayout.jsx';
import { getWorkOrderStatusChartColor } from '../utils/chartColors.js';

const TABS = [
  { id: 'closure', label: 'Closure', icon: FileCheck, roles: [ROLES.PRODUCTION_HEAD, ROLES.SUPERVISOR] },
  { id: 'production', label: 'Production Summary', icon: Factory, roles: [ROLES.PRODUCTION_HEAD, ROLES.SUPERVISOR] },
  { id: 'qc', label: 'Quality', icon: CheckCircle2, roles: [ROLES.QC_INSPECTOR, ROLES.PRODUCTION_HEAD, ROLES.SUPERVISOR] },
  { id: 'delivery', label: 'Delivery Performance', icon: Truck, roles: [ROLES.DISPATCH_COORDINATOR, ROLES.PRODUCTION_HEAD] },
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: Wrench,
    roles: [ROLES.MAINTENANCE_TECHNICIAN, ROLES.PRODUCTION_HEAD, ROLES.SUPERVISOR],
  },
];

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── PDF model builders (shared by on-screen reports and combined export) ──
function buildClosureModel(data) {
  const wo = data?.work_order;
  if (!wo) return null;
  const m = data.metrics || {};
  return {
    title: 'Work Order Closure Report',
    subtitle: `${wo.name} · ${wo.customer_name || '—'} · ${wo.deliverable || '—'}`,
    kpis: [
      { label: 'Planned Qty', value: fmtNumber(m.planned_qty) },
      { label: 'Produced', value: fmtNumber(m.produced) },
      { label: 'Yield', value: fmtPct(m.yield_pct) },
      { label: 'Scrap Qty', value: fmtNumber(m.scrap) },
      { label: 'QC Failures', value: fmtNumber(m.qc_failures) },
      { label: 'Rework Hours', value: fmtNumber(m.rework_hours, 1) },
      { label: 'Machine Cost (₹)', value: fmtNumber(m.machine_cost_total, 2) },
      { label: 'Cycle Time (days)', value: fmtNumber(m.total_days) },
      { label: 'Status', value: wo.status || '—' },
    ],
    tables: [
      {
        title: 'Job Cards',
        head: ['Job Card', 'Operation', 'Workstation', 'Operator', 'Planned', 'Actual', 'Scrap'],
        empty: 'No job cards',
        body: (data.job_cards || []).map((j) => [
          j.name, j.operation || '—', j.workstation || '—', j.operator || '—',
          fmtNumber(j.planned_qty), fmtNumber(j.actual_qty), fmtNumber(j.scrap_qty),
        ]),
      },
      {
        title: 'Quality Inspections',
        head: ['Inspection', 'Stage', 'Result', 'Inspector', 'Inspected On'],
        empty: 'No inspections',
        body: (data.inspections || []).map((q) => [
          q.name, q.stage || '—', q.result || '—', q.inspector || '—', fmtDate(q.inspected_on),
        ]),
      },
      {
        title: 'Dispatch & Delivery',
        head: ['Dispatch Note', 'Vehicle', 'Destination', 'Date', 'Status'],
        empty: 'No dispatch notes',
        body: (data.dispatch_notes || []).map((d) => [
          d.name, d.vehicle_no || '—', d.destination || '—', fmtDate(d.dispatch_date), d.status || '—',
        ]),
      },
      {
        title: 'Material Consumption',
        head: ['Material', 'Planned', 'Actual', 'Balance', 'Excess'],
        empty: 'No material consumption recorded',
        body: (data.material_consumption || []).map((m) => [
          m.item_name || m.item_code || '—',
          fmtNumber(m.total_planned),
          fmtNumber(m.total_actual),
          fmtNumber(m.total_balance),
          fmtNumber(m.total_variance),
        ]),
      },
    ],
  };
}

function buildProductionModel(data) {
  if (!data) return null;
  return {
    title: 'Production Summary',
    subtitle: `Period: ${fmtDate(data.from_date)} – ${fmtDate(data.to_date)}`,
    kpis: [
      { label: 'Orders Completed', value: fmtNumber(data.total_orders_completed) },
      { label: 'Units Produced', value: fmtNumber(data.total_units_produced) },
      { label: 'Average Yield', value: fmtPct(data.avg_yield_pct) },
    ],
    tables: [
      {
        title: 'Work Orders by Status',
        head: ['Status', 'Count'],
        empty: 'No work orders in range',
        body: (data.by_status || []).map((s) => [s.status, fmtNumber(s.cnt)]),
      },
      {
        title: 'Top Workstations',
        head: ['Workstation', 'Units Completed', 'Job Count'],
        empty: 'No completed jobs in range',
        body: (data.top_workstations || []).map((w) => [
          w.workstation, fmtNumber(w.total_qty), fmtNumber(w.job_count),
        ]),
      },
      {
        title: 'Daily Output',
        head: ['Date', 'Units'],
        empty: 'No output in range',
        body: (data.daily_output || []).map((d) => [fmtDate(d.date), fmtNumber(d.units)]),
      },
    ],
  };
}

function buildQCModel(data) {
  if (!data) return null;
  return {
    title: 'Quality Report',
    subtitle: `Period: ${fmtDate(data.from_date)} – ${fmtDate(data.to_date)}`,
    kpis: [
      { label: 'Total Inspections', value: fmtNumber(data.total_inspections) },
      { label: 'Passed', value: fmtNumber(data.passed) },
      { label: 'Failed', value: fmtNumber(data.failed) },
      { label: 'Pass Rate', value: fmtPct(data.pass_rate_pct) },
    ],
    tables: [
      {
        title: 'Failures by Stage',
        head: ['Stage', 'Fail Count'],
        empty: 'No failures in range',
        body: (data.fails_by_stage || []).map((s) => [s.stage, fmtNumber(s.fail_count)]),
      },
      {
        title: 'Common Defects',
        head: ['Defect', 'Count'],
        empty: 'No defects recorded',
        body: (data.common_defects || []).map((d) => [d.defect, fmtNumber(d.cnt)]),
      },
      {
        title: 'Recent Failures',
        head: ['Inspection', 'Work Order', 'Stage', 'Date'],
        empty: 'No failures in range',
        body: (data.recent_fails || []).map((f) => [
          f.inspection, f.work_order, f.stage || '—', fmtDate(f.date),
        ]),
      },
    ],
  };
}

function fmtMinutes(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return '—';
  return fmtDuration(Math.round(Number(minutes) * 60));
}

function buildDeliveryModel(data) {
  if (!data) return null;
  return {
    title: 'Delivery Performance',
    subtitle: `Period: ${fmtDate(data.from_date)} – ${fmtDate(data.to_date)}`,
    kpis: [
      { label: 'Total Delivered', value: fmtNumber(data.total_delivered) },
      { label: 'On Time', value: fmtNumber(data.on_time) },
      { label: 'Late', value: fmtNumber(data.late) },
      { label: 'Partial', value: fmtNumber(data.partial) },
      { label: 'On-Time %', value: fmtPct(data.on_time_pct) },
      { label: 'Avg Delivery Days', value: fmtNumber(data.avg_delivery_days, 1) },
    ],
    tables: [
      {
        title: 'Deliveries by Customer',
        head: ['Customer', 'Delivered', 'Late'],
        empty: 'No deliveries in range',
        body: (data.by_customer || []).map((c) => [
          c.customer, fmtNumber(c.delivered_count), fmtNumber(c.late_count),
        ]),
      },
    ],
  };
}

function buildMaintenanceModel(data) {
  if (!data) return null;
  return {
    title: 'Maintenance Report',
    subtitle: `Period: ${fmtDate(data.from_date)} – ${fmtDate(data.to_date)}`,
    kpis: [
      { label: 'Total Tickets', value: fmtNumber(data.total_tickets) },
      { label: 'Closed', value: fmtNumber(data.closed_tickets) },
      { label: 'Open', value: fmtNumber(data.open_tickets) },
      { label: 'MTTR', value: fmtMinutes(data.mttr_minutes) },
      { label: 'Avg Repair Time', value: fmtMinutes(data.avg_repair_minutes) },
      { label: 'Total Downtime', value: fmtMinutes(data.total_downtime_minutes) },
    ],
    tables: [
      {
        title: 'Tickets by Status',
        head: ['Status', 'Count'],
        empty: 'No tickets in range',
        body: (data.by_status || []).map((s) => [s.status, fmtNumber(s.cnt)]),
      },
      {
        title: 'Breakdown Reasons',
        head: ['Reason', 'Count'],
        empty: 'No breakdowns in range',
        body: (data.by_reason || []).map((r) => [r.reason, fmtNumber(r.cnt)]),
      },
      {
        title: 'Downtime by Workstation',
        head: ['Workstation', 'Tickets', 'Downtime'],
        empty: 'No workstation data in range',
        body: (data.by_workstation || []).map((w) => [
          w.workstation,
          fmtNumber(w.ticket_count),
          fmtMinutes(w.downtime_minutes),
        ]),
      },
      {
        title: 'Recent Tickets',
        head: ['Ticket', 'Workstation', 'Reason', 'Status', 'Reported On', 'Downtime'],
        empty: 'No tickets in range',
        body: (data.recent_tickets || []).map((t) => [
          t.ticket,
          t.workstation || '—',
          t.reason || '—',
          t.status || '—',
          fmtDateTime(t.reported_on),
          fmtMinutes(t.downtime_minutes),
        ]),
      },
    ],
  };
}

const REPORT_FETCHERS = {
  production: (from, to) => reports.production(from, to).then(buildProductionModel),
  qc: (from, to) => reports.qc(from, to).then(buildQCModel),
  delivery: (from, to) => reports.delivery(from, to).then(buildDeliveryModel),
  maintenance: (from, to) => reports.maintenance(from, to).then(buildMaintenanceModel),
};

export default function ReportsPage() {
  const { hasRole, role } = useAuth();

  const visibleTabs = useMemo(
    () => TABS.filter((t) => hasRole(...t.roles)),
    [hasRole]
  );

  const [active, setActive] = useState(null);
  const modelRef = useRef(null);
  const [canExport, setCanExport] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    if (visibleTabs.length && !visibleTabs.some((t) => t.id === active)) {
      setActive(visibleTabs[0].id);
    }
  }, [visibleTabs, active]);

  // Reset the export model whenever the active report changes; the newly
  // mounted report registers its own model once its data is ready.
  useEffect(() => {
    modelRef.current = null;
    setCanExport(false);
  }, [active]);

  const handleModel = useCallback((model) => {
    modelRef.current = model;
    setCanExport(!!model);
  }, []);

  const handleDownloadPdf = useCallback(() => {
    if (!modelRef.current) {
      toast.error('Nothing to export yet');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      generateReportPdf(modelRef.current, `${active}-report-${stamp}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to generate PDF');
    }
  }, [active]);

  // Aggregate (date-range) reports this role can access — used for "Download All".
  const aggregateIds = useMemo(
    () => visibleTabs.map((t) => t.id).filter((id) => id in REPORT_FETCHERS),
    [visibleTabs]
  );
  const canDownloadAll = visibleTabs.length > 1;

  const handleDownloadAll = useCallback(async () => {
    if (downloadingAll) return;
    const from = isoDaysAgo(30);
    const to = isoDaysAgo(0);
    setDownloadingAll(true);
    try {
      const fetched = await Promise.all(
        aggregateIds.map((id) => REPORT_FETCHERS[id](from, to))
      );
      const models = [];
      // Include the currently selected closure report, when viewing it.
      if (active === 'closure' && modelRef.current) models.push(modelRef.current);
      fetched.forEach((m) => { if (m) models.push(m); });
      if (!models.length) {
        toast.error('No data available to export');
        return;
      }
      generateCombinedReportPdf(
        models,
        `all-reports-${to}`,
        `Operations Report — ${role || 'All Roles'}`
      );
    } catch (err) {
      toast.error(err?.message || 'Failed to generate combined PDF');
    } finally {
      setDownloadingAll(false);
    }
  }, [aggregateIds, active, role, downloadingAll]);

  if (!visibleTabs.length) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="No reports available"
        description="Your role does not have access to any reports."
      />
    );
  }

  return (
    <MfgPage>
      <MfgPageHeader
        title="Reports"
        subtitle="Role-based analytics across production, quality, delivery, and maintenance"
        actions={(
          <div className="mfg-report-header-actions">
            <MfgButton
              variant="secondary"
              className="mfg-btn-icon"
              onClick={handleDownloadPdf}
              disabled={!canExport}
            >
              <Printer size={16} aria-hidden /> Download PDF
            </MfgButton>
            {canDownloadAll ? (
              <MfgButton
                className="mfg-btn-icon"
                onClick={handleDownloadAll}
                disabled={downloadingAll}
                title="Download all reports your role can access"
              >
                {downloadingAll ? <InlineLoader size={16} /> : <Download size={16} aria-hidden />}
                {downloadingAll ? 'Preparing…' : 'Download All'}
              </MfgButton>
            ) : null}
          </div>
        )}
      />

      <ReportTabBar tabs={visibleTabs} active={active} onChange={setActive} />

      <div className="mfg-report-body">
        {active === 'closure' && <ClosureReport onModel={handleModel} />}
        {active === 'production' && <ProductionReport onModel={handleModel} />}
        {active === 'qc' && <QCReport onModel={handleModel} />}
        {active === 'delivery' && <DeliveryReport onModel={handleModel} />}
        {active === 'maintenance' && <MaintenanceReport onModel={handleModel} />}
      </div>
    </MfgPage>
  );
}

// ──────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────
function ReportTabBar({ tabs, active, onChange }) {
  return (
    <div className="mfg-report-tabs no-print" role="tablist" aria-label="Report type">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? 'mfg-report-tab is-active' : 'mfg-report-tab'}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={16} aria-hidden />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DateRangeBar({ from, to, onFrom, onTo, onApply, loading }) {
  return (
    <MfgToolbar className="mfg-report-filters no-print">
      <div className="mfg-report-filters__fields">
        <Field label="From">
          <input
            type="date"
            className="pm-input"
            value={from}
            max={to}
            onChange={(e) => onFrom(e.target.value)}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            className="pm-input"
            value={to}
            min={from}
            onChange={(e) => onTo(e.target.value)}
          />
        </Field>
      </div>
      <MfgButton className="mfg-btn-icon mfg-report-filters__apply" onClick={onApply} disabled={loading}>
        {loading ? <InlineLoader size={16} /> : <CalendarDays size={16} aria-hidden />}
        Apply
      </MfgButton>
    </MfgToolbar>
  );
}

function ReportSectionHead({ title, subtitle }) {
  return (
    <div className="mfg-report-section-head">
      <h2 className="mfg-report-section-head__title">{title}</h2>
      {subtitle ? <p className="mfg-report-section-head__sub">{subtitle}</p> : null}
    </div>
  );
}

const CHART_AXIS_TICK = { fill: CHART_THEME.tick, fontSize: 11 };
const CHART_AXIS = { axisLine: false, tickLine: false };

function BarChartTooltip() {
  return (
    <Tooltip
      content={<DarkChartTooltip />}
      cursor={{ fill: CHART_THEME.cursorFill }}
    />
  );
}

function PieChartTooltip() {
  return <Tooltip content={<DarkChartTooltip />} />;
}

function ChartCard({ title, children, empty, legend }) {
  return (
    <MfgPanel title={title} className="mfg-report-chart">
      {empty ? (
        <div className="mfg-report-chart__empty">No data for selected range</div>
      ) : (
        <>
          <div className="mfg-chart-wrap">{children}</div>
          {legend?.length ? <ChartLegend items={legend} /> : null}
        </>
      )}
    </MfgPanel>
  );
}

function TableCard({ title, headers, rows, render, empty }) {
  return (
    <MfgTableCard>
      <div className="mfg-report-table__head">
        <h3 className="mfg-report-table__title">{title}</h3>
      </div>
      {!rows || rows.length === 0 ? (
        <div className="mfg-report-table__empty">{empty}</div>
      ) : (
        <div className="mfg-report-table__scroll">
          <table>
            <MfgTableHead>
              {headers.map((h) => (
                <MfgTh key={h}>{h}</MfgTh>
              ))}
            </MfgTableHead>
            <tbody>{rows.map(render)}</tbody>
          </table>
        </div>
      )}
    </MfgTableCard>
  );
}

function useDateRange() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  return { from, to, setFrom, setTo };
}

// ──────────────────────────────────────────────────────────
// 1) Closure Report
// ──────────────────────────────────────────────────────────
function ClosureReport({ onModel }) {
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    workOrders.list({ limit: 200 })
      .then((rows) => { if (!cancelled) setList(rows || []); })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, []);

  const loadReport = useCallback((wo) => {
    if (!wo) { setData(null); return; }
    setLoading(true);
    reports.closure(wo)
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const onSelect = (value) => {
    setSelected(value);
    loadReport(value);
  };

  const metrics = data?.metrics || {};

  const woOptions = useMemo(
    () => (list || []).map((w) => ({
      value: w.name,
      label: `${w.name} — ${w.customer || '—'} (${w.status})`,
    })),
    [list],
  );

  useEffect(() => {
    onModel(buildClosureModel(data));
  }, [data, onModel]);

  return (
    <>
      <ReportSectionHead
        title="Work Order Closure Report"
        subtitle="Per-order production, quality, and delivery summary"
      />

      <MfgToolbar className="mfg-report-filters no-print">
        <div className="mfg-report-filters__wo">
          <Field label="Work Order">
            <MfgCombobox
              value={selected}
              onChange={onSelect}
              items={woOptions}
              placeholder={loadingList ? 'Loading…' : 'Search or select a work order…'}
              disabled={loadingList}
              maxMenuHeight={200}
            />
          </Field>
        </div>
      </MfgToolbar>

      {loading ? (
        <PageLoader label="Building closure report…" />
      ) : !data?.work_order ? (
        <EmptyState icon={FileCheck} title="Select a work order"
                    description="Choose a work order above to view its closure report." />
      ) : (
        <div className="mfg-report-stack">
          <div className="card p-5">
            <div className="mfg-detail-grid">
              <Detail label="Work Order" value={data.work_order.name} mono />
              <Detail label="Customer" value={data.work_order.customer_name} />
              <Detail label="Deliverable" value={data.work_order.deliverable} />
              <Detail label="Status" value={<StatusBadge status={data.work_order.status} />} />
            </div>
          </div>

          <div className="mfg-kpi-stats">
            <MfgKpiStat label="Planned Qty" value={fmtNumber(metrics.planned_qty)} tone="blue" icon={ClipboardList} />
            <MfgKpiStat label="Produced" value={fmtNumber(metrics.produced)} tone="green" icon={Factory} />
            <MfgKpiStat label="Yield" value={fmtPct(metrics.yield_pct)} tone="amber" icon={TrendingUp} />
            <MfgKpiStat label="Cycle Time" value={`${fmtNumber(metrics.total_days)}d`} tone="purple" icon={CalendarDays} />
            <MfgKpiStat label="Scrap Qty" value={fmtNumber(metrics.scrap)} tone="red" icon={AlertTriangle} />
            <MfgKpiStat label="QC Failures" value={fmtNumber(metrics.qc_failures)} tone="orange" icon={AlertCircle} />
            <MfgKpiStat label="Rework Hours" value={fmtNumber(metrics.rework_hours, 1)} tone="blue" icon={Wrench} />
            <MfgKpiStat label="Machine Cost (₹)" value={fmtNumber(metrics.machine_cost_total, 2)} tone="purple" icon={Factory} />
          </div>

          <TableCard title="Job Cards"
                     headers={['Job Card', 'Operation', 'Workstation', 'Operator', 'Planned', 'Actual', 'Scrap']}
                     rows={data.job_cards}
                     empty="No job cards"
                     render={(j) => (
                       <tr key={j.name}>
                         <MfgTd className="mfg-td--mono">{j.name}</MfgTd>
                         <MfgTd>{j.operation || '—'}</MfgTd>
                         <MfgTd>{j.workstation || '—'}</MfgTd>
                         <MfgTd>{j.operator || '—'}</MfgTd>
                         <MfgTd>{fmtNumber(j.planned_qty)}</MfgTd>
                         <MfgTd>{fmtNumber(j.actual_qty)}</MfgTd>
                         <MfgTd>{fmtNumber(j.scrap_qty)}</MfgTd>
                       </tr>
                     )} />

          <TableCard title="Quality Inspections"
                     headers={['Inspection', 'Stage', 'Result', 'Inspector', 'Inspected On']}
                     rows={data.inspections}
                     empty="No inspections"
                     render={(q) => (
                       <tr key={q.name}>
                         <MfgTd className="mfg-td--mono">{q.name}</MfgTd>
                         <MfgTd><span className="badge-blue">{q.stage}</span></MfgTd>
                         <MfgTd><StatusBadge status={q.result} /></MfgTd>
                         <MfgTd>{q.inspector || '—'}</MfgTd>
                         <MfgTd>{fmtDate(q.inspected_on)}</MfgTd>
                       </tr>
                     )} />

          <TableCard title="Dispatch & Delivery"
                     headers={['Dispatch Note', 'Vehicle', 'Destination', 'Date', 'Status']}
                     rows={data.dispatch_notes}
                     empty="No dispatch notes"
                     render={(d) => (
                       <tr key={d.name}>
                         <MfgTd className="mfg-td--mono">{d.name}</MfgTd>
                         <MfgTd>{d.vehicle_no || '—'}</MfgTd>
                         <MfgTd>{d.destination || '—'}</MfgTd>
                         <MfgTd>{fmtDate(d.dispatch_date)}</MfgTd>
                         <MfgTd><StatusBadge status={d.status} /></MfgTd>
                       </tr>
                     )} />

          <TableCard title="Material Consumption"
                     headers={['Material', 'Planned', 'Actual', 'Balance', 'Excess']}
                     rows={data.material_consumption}
                     empty="No material consumption recorded"
                     render={(m) => (
                       <tr key={m.item_code}>
                         <MfgTd>{m.item_name || m.item_code || '—'}</MfgTd>
                         <MfgTd>{fmtNumber(m.total_planned)}</MfgTd>
                         <MfgTd>{fmtNumber(m.total_actual)}</MfgTd>
                         <MfgTd>{fmtNumber(m.total_balance)}</MfgTd>
                         <MfgTd>{fmtNumber(m.total_variance)}</MfgTd>
                       </tr>
                     )} />
        </div>
      )}
    </>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div className="mfg-detail-field">
      <p className="mfg-detail-field__label">{label}</p>
      <div className={mono ? 'mfg-detail-field__value mfg-detail-field__value--mono' : 'mfg-detail-field__value'}>
        {value ?? '—'}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// 2) Production Summary
// ──────────────────────────────────────────────────────────
function ProductionReport({ onModel }) {
  const { from, to, setFrom, setTo } = useDateRange();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    reports.production(from, to)
      .then(setData)
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    onModel(buildProductionModel(data));
  }, [data, onModel]);

  const statusChart = (data?.by_status || []).map((s, i) => ({
    name: s.status,
    value: s.cnt,
    fill: getWorkOrderStatusChartColor(s.status, i),
  }));
  const dailyChart = (data?.daily_output || []).map((d) => ({
    ...d,
    dateLabel: fmtDate(d.date),
  }));
  const chartColors = getReportChartColors();

  return (
    <>
      <ReportSectionHead
        title="Production Summary"
        subtitle={`Output and yield from ${fmtDate(from)} to ${fmtDate(to)}`}
      />
      <DateRangeBar from={from} to={to} onFrom={setFrom} onTo={setTo}
                    onApply={load} loading={loading} />

      {loading ? (
        <PageLoader label="Crunching production numbers…" />
      ) : (
        <div className="mfg-report-stack">
          <div className="mfg-kpi-stats">
            <MfgKpiStat label="Orders Completed" value={fmtNumber(data.total_orders_completed)} tone="blue" icon={CheckCircle2} />
            <MfgKpiStat label="Units Produced" value={fmtNumber(data.total_units_produced)} tone="green" icon={Factory} />
            <MfgKpiStat label="Average Yield" value={fmtPct(data.avg_yield_pct)} tone="amber" icon={TrendingUp} />
          </div>

          <div className="mfg-report-charts">
            <ChartCard title="Work Orders by Status" empty={statusChart.length === 0}>
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
                    {statusChart.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <PieChartTooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Daily Output" empty={dailyChart.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyChart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                  <XAxis dataKey="dateLabel" tick={CHART_AXIS_TICK} {...CHART_AXIS} />
                  <YAxis tick={CHART_AXIS_TICK} {...CHART_AXIS} allowDecimals={false} />
                  <BarChartTooltip />
                  <Line
                    type="monotone"
                    dataKey="units"
                    name="Units"
                    stroke={chartColors.line}
                    strokeWidth={2}
                    dot={{ r: 3, fill: chartColors.line }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <TableCard title="Top Workstations"
                     headers={['Workstation', 'Units Completed', 'Job Count']}
                     rows={data.top_workstations}
                     empty="No completed jobs in range"
                     render={(w) => (
                       <tr key={w.workstation}>
                         <MfgTd>{w.workstation}</MfgTd>
                         <MfgTd>{fmtNumber(w.total_qty)}</MfgTd>
                         <MfgTd>{fmtNumber(w.job_count)}</MfgTd>
                       </tr>
                     )} />
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────
// 3) QC Report
// ──────────────────────────────────────────────────────────
function QCReport({ onModel }) {
  const { from, to, setFrom, setTo } = useDateRange();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    reports.qc(from, to)
      .then(setData)
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    onModel(buildQCModel(data));
  }, [data, onModel]);

  const chartColors = getReportChartColors();
  const failsChart = (data?.fails_by_stage || []).map((s) => ({
    name: s.stage,
    stage: s.stage,
    fail_count: s.fail_count,
    fill: chartColors.barFail,
  }));

  return (
    <>
      <ReportSectionHead
        title="Quality Report"
        subtitle={`Inspection outcomes from ${fmtDate(from)} to ${fmtDate(to)}`}
      />
      <DateRangeBar from={from} to={to} onFrom={setFrom} onTo={setTo}
                    onApply={load} loading={loading} />

      {loading ? (
        <PageLoader label="Analysing inspections…" />
      ) : (
        <div className="mfg-report-stack">
          <div className="mfg-kpi-stats">
            <MfgKpiStat label="Inspections" value={fmtNumber(data.total_inspections)} tone="blue" icon={ClipboardCheck} />
            <MfgKpiStat label="Passed" value={fmtNumber(data.passed)} tone="green" icon={CheckCircle2} />
            <MfgKpiStat label="Failed" value={fmtNumber(data.failed)} tone="red" icon={AlertTriangle} />
            <MfgKpiStat label="Pass Rate" value={fmtPct(data.pass_rate_pct)} tone="amber" icon={TrendingUp} />
          </div>

          <div className="mfg-report-charts">
            <ChartCard title="Failures by Stage" empty={failsChart.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={failsChart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                  <XAxis dataKey="stage" tick={CHART_AXIS_TICK} {...CHART_AXIS} />
                  <YAxis tick={CHART_AXIS_TICK} {...CHART_AXIS} allowDecimals={false} />
                  <BarChartTooltip />
                  <Bar dataKey="fail_count" name="Failures" fill={chartColors.barFail} radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Common Defects" empty={(data.common_defects || []).length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.common_defects} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis type="number" tick={CHART_AXIS_TICK} {...CHART_AXIS} allowDecimals={false} />
                  <YAxis type="category" dataKey="defect" width={120} tick={CHART_AXIS_TICK} {...CHART_AXIS} />
                  <BarChartTooltip />
                  <Bar dataKey="cnt" name="Count" fill={chartColors.barWarn} radius={[0, 6, 6, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <TableCard title="Recent Failures"
                     headers={['Inspection', 'Work Order', 'Stage', 'Date']}
                     rows={data.recent_fails}
                     empty="No failures in range"
                     render={(f) => (
                       <tr key={f.inspection}>
                         <MfgTd className="mfg-td--mono">{f.inspection}</MfgTd>
                         <MfgTd>
                           <Link to={mfgPath(`/work-orders/${f.work_order}`)} className="mfg-row-link">
                             {f.work_order}
                           </Link>
                         </MfgTd>
                         <MfgTd><span className="badge-blue">{f.stage}</span></MfgTd>
                         <MfgTd>{fmtDate(f.date)}</MfgTd>
                       </tr>
                     )} />
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────
// 4) Delivery Performance
// ──────────────────────────────────────────────────────────
function DeliveryReport({ onModel }) {
  const { from, to, setFrom, setTo } = useDateRange();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    reports.delivery(from, to)
      .then(setData)
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    onModel(buildDeliveryModel(data));
  }, [data, onModel]);

  const chartColors = getReportChartColors();
  const splitChart = data ? [
    { name: 'On Time', value: data.on_time, fill: chartColors.onTime },
    { name: 'Late', value: data.late, fill: chartColors.late },
  ] : [];
  const hasSplit = data && data.total_delivered > 0;
  const customerChart = (data?.by_customer || []).slice(0, 8);

  return (
    <>
      <ReportSectionHead
        title="Delivery Performance"
        subtitle={`Deliveries from ${fmtDate(from)} to ${fmtDate(to)}`}
      />
      <DateRangeBar from={from} to={to} onFrom={setFrom} onTo={setTo}
                    onApply={load} loading={loading} />

      {loading ? (
        <PageLoader label="Measuring delivery performance…" />
      ) : (
        <div className="mfg-report-stack">
          <div className="mfg-kpi-stats">
            <MfgKpiStat label="Delivered" value={fmtNumber(data.total_delivered)} tone="blue" icon={Truck} />
            <MfgKpiStat label="On Time" value={fmtNumber(data.on_time)} tone="green" icon={CheckCircle2} />
            <MfgKpiStat label="Late" value={fmtNumber(data.late)} tone="red" icon={AlertTriangle} />
            <MfgKpiStat label="On-Time %" value={fmtPct(data.on_time_pct)} tone="amber" icon={TrendingUp} />
            <MfgKpiStat label="Avg Days" value={fmtNumber(data.avg_delivery_days, 1)} tone="purple" icon={CalendarDays} />
          </div>

          <div className="mfg-report-charts">
            <ChartCard title="On Time vs Late" empty={!hasSplit}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={splitChart}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={3}
                    stroke="transparent"
                  >
                    {splitChart.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <PieChartTooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Deliveries by Customer"
                       empty={customerChart.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={customerChart}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 4, bottom: 0 }}
                  barCategoryGap="18%"
                  barGap={4}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis type="number" tick={CHART_AXIS_TICK} {...CHART_AXIS} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="customer"
                    width={132}
                    tick={CHART_AXIS_TICK}
                    {...CHART_AXIS}
                  />
                  <BarChartTooltip />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="square"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: CHART_THEME.tick, paddingBottom: 4 }}
                  />
                  <Bar
                    dataKey="delivered_count"
                    name="Delivered"
                    fill={chartColors.barPrimary}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={12}
                  />
                  <Bar
                    dataKey="late_count"
                    name="Late"
                    fill={chartColors.late}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={12}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <TableCard title="By Customer"
                     headers={['Customer', 'Delivered', 'Late']}
                     rows={data.by_customer}
                     empty="No deliveries in range"
                     render={(c) => (
                       <tr key={c.customer}>
                         <MfgTd>{c.customer}</MfgTd>
                         <MfgTd>{fmtNumber(c.delivered_count)}</MfgTd>
                         <MfgTd>{fmtNumber(c.late_count)}</MfgTd>
                       </tr>
                     )} />
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────
// 5) Maintenance Report
// ──────────────────────────────────────────────────────────
const REASON_CHART_COLORS = ['#38bdf8', '#f87171', '#fbbf24', '#818cf8', '#4ade80'];

function MaintenanceReport({ onModel }) {
  const { from, to, setFrom, setTo } = useDateRange();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    reports.maintenance(from, to)
      .then((res) => setData(res || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    onModel(buildMaintenanceModel(data));
  }, [data, onModel]);

  const chartColors = getReportChartColors();
  const reasonChart = (data?.by_reason || []).map((r, i) => ({
    name: r.reason,
    reason: r.reason,
    cnt: r.cnt,
    fill: REASON_CHART_COLORS[i % REASON_CHART_COLORS.length],
  }));
  const workstationChart = data?.by_workstation || [];
  const dailyChart = (data?.daily_tickets || []).map((d) => ({
    date: fmtDate(d.date),
    tickets: d.tickets,
  }));

  return (
    <>
      <ReportSectionHead
        title="Maintenance Report"
        subtitle={`Breakdowns and repair performance from ${fmtDate(from)} to ${fmtDate(to)}`}
      />
      <DateRangeBar from={from} to={to} onFrom={setFrom} onTo={setTo}
                    onApply={load} loading={loading} />

      {loading ? (
        <PageLoader label="Analysing maintenance data…" />
      ) : !data ? (
        <p className="mfg-wo-linked-card__empty">Unable to load maintenance report. Check permissions or try again.</p>
      ) : (
        <div className="mfg-report-stack">
          <div className="mfg-kpi-stats">
            <MfgKpiStat label="Tickets" value={fmtNumber(data.total_tickets)} tone="blue" icon={ClipboardList} />
            <MfgKpiStat label="Closed" value={fmtNumber(data.closed_tickets)} tone="green" icon={CheckCircle2} />
            <MfgKpiStat label="Open" value={fmtNumber(data.open_tickets)} tone="amber" icon={AlertCircle} />
            <MfgKpiStat label="MTTR" value={fmtMinutes(data.mttr_minutes)} tone="purple" icon={Wrench} />
            <MfgKpiStat label="Total Downtime" value={fmtMinutes(data.total_downtime_minutes)} tone="red" icon={AlertTriangle} />
          </div>

          <div className="mfg-report-charts">
            <ChartCard title="Breakdown Reasons" empty={reasonChart.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={reasonChart}
                    dataKey="cnt"
                    nameKey="reason"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={3}
                    stroke="transparent"
                  >
                    {reasonChart.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <PieChartTooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Downtime by Workstation" empty={workstationChart.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={workstationChart}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 4, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis type="number" tick={CHART_AXIS_TICK} {...CHART_AXIS} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="workstation"
                    width={132}
                    tick={CHART_AXIS_TICK}
                    {...CHART_AXIS}
                  />
                  <BarChartTooltip />
                  <Bar
                    dataKey="downtime_minutes"
                    name="Downtime (min)"
                    fill={chartColors.barFail}
                    radius={[0, 6, 6, 0]}
                    maxBarSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {dailyChart.length > 0 ? (
            <ChartCard title="Daily Breakdowns" empty={dailyChart.length === 0}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyChart} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mfgMaintDailyBreakdownFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.line} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={chartColors.line} stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                  <XAxis dataKey="date" tick={CHART_AXIS_TICK} {...CHART_AXIS} />
                  <YAxis tick={CHART_AXIS_TICK} {...CHART_AXIS} allowDecimals={false} />
                  <BarChartTooltip />
                  <Area
                    type="monotone"
                    dataKey="tickets"
                    name="Tickets"
                    stroke={chartColors.line}
                    strokeWidth={2}
                    fill="url(#mfgMaintDailyBreakdownFill)"
                    dot={{ r: 3, fill: chartColors.line, strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: chartColors.line }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : null}

          <TableCard title="Recent Tickets"
                     headers={['Ticket', 'Workstation', 'Reason', 'Status', 'Reported On', 'Downtime']}
                     rows={data.recent_tickets}
                     empty="No tickets in range"
                     render={(t) => (
                       <tr key={t.ticket}>
                         <MfgTd className="mfg-td--mono">{t.ticket}</MfgTd>
                         <MfgTd>{t.workstation || '—'}</MfgTd>
                         <MfgTd>{t.reason || '—'}</MfgTd>
                         <MfgTd><StatusBadge status={t.status} /></MfgTd>
                         <MfgTd>{fmtDateTime(t.reported_on)}</MfgTd>
                         <MfgTd>{fmtMinutes(t.downtime_minutes)}</MfgTd>
                       </tr>
                     )} />
        </div>
      )}
    </>
  );
}
