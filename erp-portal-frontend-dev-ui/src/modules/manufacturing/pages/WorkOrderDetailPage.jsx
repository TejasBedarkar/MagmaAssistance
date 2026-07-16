import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, Package, CalendarDays, Factory,
  CheckCircle2, Truck, FileCheck, AlertCircle, Plus, Trash2,
} from '@/icons/mfgIcons.js';
import toast from 'react-hot-toast';
import {
  workOrders, capacity, materials, production, quality, workstations,
} from '@/api';
import { useAuth, ROLES, RoleGate } from '@/hooks/manufacturingAuth';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { StatusBadge, PriorityBadge } from '@/components/StatusBadge';
import MaterialCheckPanel from '@/components/MaterialCheckPanel';
import WorkOrderComments from '@/components/WorkOrderComments';
import { mfgPath } from '../paths.js';
import DispatchCreateModal from '@/components/DispatchCreateModal';
import DispatchNotePanel from '@/components/DispatchNotePanel';
import PODUploadModal from '@/components/PODUploadModal';
import Modal, { MfgModalFooter, MfgDangerModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import MfgCombobox from '@/components/MfgCombobox';
import { fmtDate, fmtDateTime, fmtPct, fmtCurrency } from '@/utils/format';
import { refreshPortalNotifications } from '../../../common/utils/portalNotifications.js';
import {
  MfgButton,
  MfgIconButton,
  MfgPage,
  MfgTableCard,
  MfgTd,
  MfgTh,
  MfgTableHead,
} from '@/components/MfgPageLayout.jsx';

const PIPELINE = [
  { key: 'Draft', label: 'Draft', icon: Package, matches: ['Received'] },
  { key: 'Planning', label: 'Planning', icon: CalendarDays, matches: ['Under Review', 'Material Pending', 'Scheduled'] },
  { key: 'Production', label: 'Production', icon: Factory, matches: ['In Production'] },
  { key: 'Quality', label: 'Quality', icon: CheckCircle2, matches: ['QC Pending'] },
  { key: 'Dispatch', label: 'Dispatch', icon: Truck, matches: ['Ready for Dispatch', 'Dispatched'] },
  { key: 'Delivered', label: 'Delivered', icon: FileCheck, matches: ['Delivered'] },
  { key: 'Closed', label: 'Closed', icon: CheckCircle2, matches: ['Closed'] },
];

function getPipelineIdx(status) {
  return PIPELINE.findIndex((p) => p.matches.includes(status));
}

const isReadyToResumeReason = (reason = '') => /ready to resume|machine repaired/i.test(String(reason));

function ExcessCapaPanel({ job }) {
  const status = String(job?.excess_approval_status || '').trim();
  if (!status || status === 'Pending') return null;

  const rootCause = String(job.capa_root_cause || '').trim();
  const rootNote = String(job.capa_root_cause_note || '').trim();
  const corrective = String(job.capa_corrective_action || '').trim();
  const preventive = String(job.capa_preventive_action || '').trim();
  const rootDisplay = rootCause === 'Other' && rootNote
    ? `${rootCause} — ${rootNote}`
    : rootCause;

  return (
    <div className="mfg-excess-capa-read" aria-label="Excess consumption CAPA">
      {rootCause ? (
        <p className="mfg-excess-capa-read__line">
          <span className="mfg-excess-capa-read__icon" aria-hidden>🎯</span>
          <span className="mfg-excess-capa-read__label">Root Cause:</span>
          {rootDisplay}
        </p>
      ) : null}
      {corrective ? (
        <p className="mfg-excess-capa-read__line">
          <span className="mfg-excess-capa-read__icon" aria-hidden>🔧</span>
          <span className="mfg-excess-capa-read__label">Corrective:</span>
          {corrective}
        </p>
      ) : null}
      {preventive ? (
        <p className="mfg-excess-capa-read__line">
          <span className="mfg-excess-capa-read__icon" aria-hidden>🛡️</span>
          <span className="mfg-excess-capa-read__label">Preventive:</span>
          {preventive}
        </p>
      ) : null}
      <p className="mfg-excess-capa-read__status">
        <StatusBadge status={status} />
        {status === 'Approved' && job.capa_approved_by ? (
          <span className="mfg-excess-capa-read__meta"> by {job.capa_approved_by}</span>
        ) : null}
        {status === 'Rejected' && job.capa_rejection_reason ? (
          <span className="mfg-excess-capa-read__meta"> — {job.capa_rejection_reason}</span>
        ) : null}
      </p>
    </div>
  );
}

const EMPTY_STATUS_BLOCK = {
  open: false,
  kind: 'missing',
  title: '',
  message: '',
  hint: '',
  inspectionName: '',
};

function getFinalQcBlockState(inspections = []) {
  const finalRows = (inspections || []).filter((q) => q.stage === 'Final');
  const hasPass = finalRows.some(
    (q) => q.qc_status === 'QC Pass' || q.result === 'Pass',
  );
  if (hasPass) return null;

  const awaiting = finalRows.find(
    (q) => q.qc_status === 'Inspection Pending' || q.qc_status === 'In Inspection',
  );
  if (awaiting) {
    return {
      kind: 'awaiting',
      title: 'Waiting for QC inspector',
      message: (
        `Final inspection ${awaiting.name} has been created, but the QC inspector `
        + 'has not submitted results yet.'
      ),
      hint: (
        'Please wait until the QC inspector completes the Final QC inspection '
        + 'and submits a passing result before moving to Ready for Dispatch.'
      ),
      inspectionName: awaiting.name,
    };
  }

  const failed = finalRows.find((q) => q.qc_status === 'QC Fail' || q.result === 'Fail');
  if (failed) {
    return {
      kind: 'failed',
      title: 'Final QC failed',
      message: (
        `Final inspection ${failed.name} did not pass. Resolve the failure before `
        + 'moving to Ready for Dispatch.'
      ),
      hint: 'Review the failed inspection and complete rework or submit a new Final QC after fixes.',
      inspectionName: failed.name,
    };
  }

  return {
    kind: 'missing',
    title: 'Final QC required',
    message: 'No Final QC inspection exists for this work order yet.',
    hint: (
      'Create a Final QC inspection for this work order, then wait for the QC inspector '
      + 'to submit a passing result.'
    ),
    inspectionName: '',
  };
}

function finalQcBlockFromError(message, inspections = []) {
  const fromData = getFinalQcBlockState(inspections);
  if (fromData) {
    return { ...fromData, message: message || fromData.message };
  }
  if ((message || '').includes('Waiting for QC inspector')) {
    return {
      kind: 'awaiting',
      title: 'Waiting for QC inspector',
      message,
      hint: (
        'Please wait until the QC inspector completes the Final QC inspection '
        + 'and submits a passing result before moving to Ready for Dispatch.'
      ),
      inspectionName: '',
    };
  }
  return {
    kind: 'missing',
    title: 'Final QC required',
    message: message || 'Final QC is required before Ready for Dispatch.',
    hint: (
      'Create a Final QC inspection for this work order, then wait for the QC inspector '
      + 'to submit a passing result.'
    ),
    inspectionName: '',
  };
}

export default function WorkOrderDetailPage() {
  const { name } = useParams();
  const navigate = useNavigate();
  const { lookups, hasRole, reload } = useAuth();
  const canTransitionStatus = hasRole(ROLES.PRODUCTION_HEAD);
  const canManagePlanning = hasRole(ROLES.PRODUCTION_HEAD, ROLES.SUPERVISOR);
  const canManageMaterials = hasRole(ROLES.PRODUCTION_HEAD, ROLES.STORE_KEEPER, ROLES.SUPERVISOR);
  const canManageProduction = hasRole(ROLES.PRODUCTION_HEAD, ROLES.SUPERVISOR);
  const canManageQC = hasRole(ROLES.PRODUCTION_HEAD, ROLES.QC_INSPECTOR);
  const canManageDispatch = hasRole(ROLES.PRODUCTION_HEAD, ROLES.DISPATCH_COORDINATOR);
  const isDispatchOnlyView = hasRole(ROLES.DISPATCH_COORDINATOR) && !hasRole(ROLES.PRODUCTION_HEAD);
  const [podNote, setPodNote] = useState(null);
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // 'capacity' | 'material' | 'schedule' | 'job' | 'qc' | 'dispatch' | 'pod' | 'delete'
  const [deleting, setDeleting] = useState(false);
  const [inspectionDelete, setInspectionDelete] = useState({
    open: false,
    name: '',
    reason: '',
    deleting: false,
  });
  const [transitions, setTransitions] = useState([]);
  const [applyingStatus, setApplyingStatus] = useState('');
  const [acknowledging, setAcknowledging] = useState(false);
  const [statusBlockModal, setStatusBlockModal] = useState(EMPTY_STATUS_BLOCK);
  const [qcInitialStage, setQcInitialStage] = useState(null);
  const isSupervisor = hasRole(ROLES.SUPERVISOR);

  const closeStatusBlockModal = () => setStatusBlockModal(EMPTY_STATUS_BLOCK);

  const openFinalQcFromBlock = () => {
    closeStatusBlockModal();
    setQcInitialStage('Final');
    setModal('qc');
  };

  const load = async () => {
    setLoading(true);
    try {
      const [data, allowed] = await Promise.all([
        workOrders.get(name),
        workOrders.getAllowedTransitions(name),
      ]);
      setWo(data);
      setTransitions(allowed || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [name]);

  const acknowledgeReview = async () => {
    if (acknowledging || wo?.supervisor_reviewed) return;
    setAcknowledging(true);
    try {
      await workOrders.acknowledgeReview(name);
      toast.success('Review acknowledged');
      refreshPortalNotifications();
      await load();
    } finally {
      setAcknowledging(false);
    }
  };

  const changeStatus = async (newStatus) => {
    if (!newStatus || applyingStatus) return;
    if (newStatus === 'Ready for Dispatch') {
      const block = getFinalQcBlockState(wo?.quality_inspections);
      if (block) {
        setStatusBlockModal({ open: true, ...block });
        return;
      }
    }
    setApplyingStatus(newStatus);
    try {
      await workOrders.updateStatus(name, newStatus, undefined, { silent: true });
      toast.success(`Status → ${newStatus}`);
      refreshPortalNotifications();
      await load();
    } catch (err) {
      const msg = err?.message || 'Failed to update status';
      if (
        msg.includes('Waiting for QC inspector')
        || msg.includes('Final QC')
        || msg.includes('No Final QC')
      ) {
        setStatusBlockModal({
          open: true,
          ...finalQcBlockFromError(msg, wo?.quality_inspections),
        });
      } else {
        toast.error(msg);
      }
    } finally {
      setApplyingStatus('');
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await workOrders.remove(name);
      toast.success(`Work order ${name} deleted`);
      navigate(mfgPath('/work-orders'), { replace: true });
    } catch {
      /* toast from API client */
    } finally {
      setDeleting(false);
      setModal(null);
    }
  };

  const openDeleteInspection = (inspectionName) => {
    setInspectionDelete({ open: true, name: inspectionName, reason: '', deleting: false });
  };

  const confirmDeleteInspection = async () => {
    if (!inspectionDelete.reason.trim()) {
      toast.error('Please enter delete reason');
      return;
    }
    setInspectionDelete((prev) => ({ ...prev, deleting: true }));
    try {
      await quality.deleteInspection(inspectionDelete.name, inspectionDelete.reason.trim());
      toast.success(`Inspection ${inspectionDelete.name} deleted`);
      setInspectionDelete({ open: false, name: '', reason: '', deleting: false });
      load();
    } finally {
      setInspectionDelete((prev) => ({ ...prev, deleting: false }));
    }
  };

  if (loading) return <PageLoader />;
  if (!wo) return <EmptyState icon={AlertCircle} title="Work order not found" />;

  const currentIdx = getPipelineIdx(wo.status);
  const productionProgress = Math.min(100, wo.live_progress ?? wo.progress ?? 0);
  const productionDone = productionProgress >= 100;

  return (
    <MfgPage className="mfg-wo-detail">
      <Link to={mfgPath('/work-orders')} className="mfg-wo-back">
        <ArrowLeft size={16} /> Back to Work Orders
      </Link>

      <header className="mfg-wo-header">
        <div>
          <div className="mfg-wo-header__id-row">
            <p className="mfg-wo-header__id">{wo.name}</p>
            <PriorityBadge priority={wo.priority} />
          </div>
          <h1 className="mfg-wo-header__title">
            {wo.item_code}
            <span> · {wo.qty} units</span>
          </h1>
          <p className="mfg-wo-header__sub">
            For <strong>{wo.customer}</strong> · Due {fmtDate(wo.expected_delivery_date)}
            {wo.custom_sales_order || wo.sales_order ? (
              <>
                {" · "}
                Sales Order{" "}
                <Link to={`/sales/orders?open=${encodeURIComponent(wo.custom_sales_order || wo.sales_order)}`} className="mfg-wo-header__so-link">
                  {wo.custom_sales_order || wo.sales_order}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="mfg-wo-header__actions">
          <RoleGate allow={[ROLES.PRODUCTION_HEAD]}>
            {!['Closed', 'Delivered'].includes(wo.status) && (
              <MfgIconButton
                icon={Trash2}
                label="Delete work order"
                variant="danger"
                onClick={() => setModal('delete')}
              />
            )}
          </RoleGate>
          <div
            className="mfg-wo-status-flow"
            role={canTransitionStatus && transitions.length > 0 ? 'group' : undefined}
            aria-label={
              canTransitionStatus && transitions.length > 0
                ? `Status: ${wo.status}. Select next status.`
                : undefined
            }
          >
            <StatusBadge status={wo.status} />
            {canTransitionStatus && transitions.length > 0 && (
              <>
                <span className="mfg-wo-status-flow__arrow" aria-hidden>→</span>
                {transitions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="mfg-wo-status-btn"
                    disabled={!!applyingStatus}
                    onClick={() => changeStatus(t)}
                    title={`Move to ${t}`}
                  >
                    <StatusBadge status={applyingStatus === t ? 'Updating…' : t} />
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </header>

      {wo.pricing ? (
        <section className="card mfg-wo-pricing" aria-label="Price breakdown">
          <div className="mfg-wo-pricing__head">
            <h2 className="mfg-wo-pricing__title">Price breakdown</h2>
            <p className="mfg-wo-pricing__total">
              Total <strong>{fmtCurrency(wo.pricing.total_amount, wo.pricing.currency)}</strong>
            </p>
          </div>
          <div className="mfg-wo-pricing__rows">
            <div className="mfg-wo-pricing__row">
              <div>
                <span className="mfg-wo-pricing__label">Product</span>
                <span className="mfg-wo-pricing__meta">
                  {wo.pricing.product_label || wo.item_code}
                  {' · '}
                  {wo.pricing.product_qty ?? wo.qty} units
                </span>
              </div>
              <span className="mfg-wo-pricing__value">
                {fmtCurrency(wo.pricing.product_amount, wo.pricing.currency)}
              </span>
            </div>
            {(wo.pricing.subproducts?.length > 0 || wo.pricing.subproduct_amount > 0) ? (
              <div className="mfg-wo-pricing__subblock">
                <div className="mfg-wo-pricing__row mfg-wo-pricing__row--subtotal">
                  <span className="mfg-wo-pricing__label">Sub-products (BOM)</span>
                  <span className="mfg-wo-pricing__value">
                    {fmtCurrency(wo.pricing.subproduct_amount, wo.pricing.currency)}
                  </span>
                </div>
                <ul className="mfg-wo-pricing__sublist">
                  {(wo.pricing.subproducts || []).map((row) => (
                    <li key={row.item_code} className="mfg-wo-pricing__subitem">
                      <span>
                        {row.item_name || row.item_code}
                        <span className="mfg-wo-pricing__meta">
                          {' · '}
                          {row.required_qty} qty
                        </span>
                      </span>
                      <span>{fmtCurrency(row.amount, wo.pricing.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mfg-wo-pricing__row mfg-wo-pricing__row--grand">
              <span className="mfg-wo-pricing__label">Grand total</span>
              <span className="mfg-wo-pricing__value">
                {fmtCurrency(wo.pricing.total_amount, wo.pricing.currency)}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {/* Pipeline — simplified for dispatch coordinator */}
      {!isDispatchOnlyView ? (
      <>
      <div className="card mfg-wo-pipeline">
        <div className="mfg-wo-pipeline__track">
          {PIPELINE.map((step, idx) => {
            const Icon = step.icon;
            const done = idx < currentIdx;
            const active = idx === currentIdx;
            const iconClass = active
              ? 'mfg-wo-pipeline__icon mfg-wo-pipeline__icon--active'
              : done
                ? 'mfg-wo-pipeline__icon mfg-wo-pipeline__icon--done'
                : 'mfg-wo-pipeline__icon mfg-wo-pipeline__icon--pending';
            return (
              <div key={step.key} className="mfg-wo-pipeline__segment">
                <div className={`mfg-wo-pipeline__step${active ? ' mfg-wo-pipeline__step--active' : ''}`}>
                  <div className="mfg-wo-pipeline__icon-ring">
                    <div className={iconClass}>
                      <Icon size={20} />
                    </div>
                  </div>
                  <p className={`mfg-wo-pipeline__label${active ? ' mfg-wo-pipeline__label--active' : ''}`}>
                    {step.label}
                  </p>
                </div>
                {idx < PIPELINE.length - 1 && (
                  <div
                    className={done ? 'mfg-wo-pipeline__connector mfg-wo-pipeline__connector--done' : 'mfg-wo-pipeline__connector'}
                    aria-hidden
                  >
                    <ChevronRight size={18} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mfg-wo-pipeline__footer">
          <div className="mfg-wo-pipeline__progress-head">
            <span>Production Progress</span>
            <strong>{fmtPct(productionProgress)}</strong>
          </div>
          <div className="mfg-progress">
            <div className="mfg-progress__track">
              <div
                className="mfg-progress__fill"
                style={{ width: `${productionProgress}%` }}
              />
            </div>
          </div>
          <p className="mfg-mc-notice mfg-mc-notice--info mfg-mc-notice--flush">
            <strong>Overall workflow:</strong> {wo.status}
            {productionDone && !['QC Pending', 'Ready for Dispatch', 'Dispatched', 'Delivered', 'Closed'].includes(wo.status) && (
              <span className="mfg-wo-notice-sub">
                Production is complete — move to QC Pending when ready.
              </span>
            )}
          </p>
        </div>
      </div>

      <WorkOrderComments
        workOrder={name}
        comments={wo.comments || []}
        onUpdated={load}
        review={{
          show: wo.status === 'Under Review' || !!wo.supervisor_reviewed,
          reviewed: !!wo.supervisor_reviewed,
          reviewedBy: wo.supervisor_reviewed_by,
          reviewedOn: wo.supervisor_reviewed_on,
          canAcknowledge: isSupervisor && wo.status === 'Under Review' && !wo.supervisor_reviewed,
          onAcknowledge: acknowledgeReview,
          acknowledging,
        }}
      />
      </>
      ) : (
        <div className="card mfg-wo-section">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="mfg-wo-linked-card__label">Dispatch View</p>
              <p className="mfg-wo-dispatch-view__status">
                Current status: <strong>{wo.status}</strong>
              </p>
            </div>
            <StatusBadge status={wo.status} />
          </div>
          {wo.quality_inspections?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-steel-100">
              <p className="text-xs font-semibold text-steel-700 mb-2">QC Summary</p>
              <ul className="space-y-1">
                {wo.quality_inspections.map((q) => (
                  <li key={q.name} className="text-xs text-steel-600 flex items-center gap-2">
                    <span className="font-mono">{q.name}</span>
                    <span className="badge-blue">{q.stage}</span>
                    <StatusBadge status={q.result} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Linked records — each role sees only their sections */}
      {!isDispatchOnlyView && (
      <div className="mfg-wo-linked-grid grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(canManagePlanning || canManageProduction) && (
          <WorkOrderPlanPair
            wo={wo}
            canManagePlanning={canManagePlanning}
            canManageProduction={canManageProduction}
            onCapacityCreate={() => setModal('capacity')}
            onScheduleCreate={() => setModal('schedule')}
            onJobCreate={() => setModal('job')}
          />
        )}
        {canManageMaterials && (
          wo.material_check ? (
            <div className="card mfg-wo-section lg:col-span-2">
              <MaterialCheckPanel
                materialCheckName={wo.material_check}
                workOrder={name}
                onUpdated={load}
                compactHeader
              />
            </div>
          ) : (
            <LinkedCard
              title="Material Check"
              value={wo.material_check}
              onCreate={() => setModal('material')}
              canCreate={hasRole(ROLES.PRODUCTION_HEAD, ROLES.STORE_KEEPER)}
            />
          )
        )}
      </div>
      )}

      {!isDispatchOnlyView && canManageQC && (
        <section className="card mfg-wo-section">
          <div className="mfg-wo-section__head">
            <h3 className="mfg-wo-section__title">Quality Inspections</h3>
            <MfgButton variant="secondary" size="sm" onClick={() => { setQcInitialStage(null); setModal('qc'); }}>
              <Plus size={16} /> Add Inspection
            </MfgButton>
          </div>
          {wo.quality_inspections?.length === 0 ? (
            <p className="mfg-wo-linked-card__empty">No inspections yet</p>
          ) : (
            <MfgTableCard>
              <table>
                <MfgTableHead>
                  <MfgTh>Inspection</MfgTh>
                  <MfgTh>Stage</MfgTh>
                  <MfgTh>Result</MfgTh>
                  <MfgTh>Inspected</MfgTh>
                  <MfgTh align="right">Actions</MfgTh>
                </MfgTableHead>
                <tbody>
                  {wo.quality_inspections.map((q) => (
                    <tr key={q.name}>
                      <MfgTd className="mfg-row-link--mono">{q.name}</MfgTd>
                      <MfgTd><span className="badge-blue">{q.stage}</span></MfgTd>
                      <MfgTd>
                        <StatusBadge status={q.qc_status || q.result || 'Pending'} />
                      </MfgTd>
                      <MfgTd className="mfg-td-muted">{fmtDateTime(q.inspected_on)}</MfgTd>
                      <MfgTd align="right">
                        <MfgIconButton
                          icon={Trash2}
                          label="Delete inspection"
                          variant="danger"
                          onClick={() => openDeleteInspection(q.name)}
                        />
                      </MfgTd>
                    </tr>
                  ))}
                </tbody>
              </table>
            </MfgTableCard>
          )}
        </section>
      )}

      {canManageDispatch && (
        <section className="mfg-wo-dispatch space-y-4">
          <div className="mfg-wo-section__head">
            <h3 className="mfg-wo-section__title">Dispatch Notes</h3>
            {wo.status === 'Ready for Dispatch' && !wo.dispatch_notes?.some(
              (n) => !['POD Received', 'Closed', 'Cancelled'].includes(n.status),
            ) && (
              <MfgButton size="sm" onClick={() => setModal('dispatch')}>
                <Truck size={16} /> Create Dispatch Note
              </MfgButton>
            )}
          </div>

          {wo.dispatch_notes?.length === 0 ? (
            <div className="card mfg-wo-section">
              <p className="mfg-wo-linked-card__empty">No dispatch notes yet.</p>
              {wo.status !== 'Ready for Dispatch' && (
                <p className="mfg-mc-notice mfg-mc-notice--warn mfg-mc-notice--flush-sm">
                  Work order must be Ready for Dispatch before creating a note.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {wo.dispatch_notes.map((n) => (
                <DispatchNotePanel
                  key={n.name}
                  note={n}
                  onUpdated={load}
                  onUploadPod={(note) => setPodNote(note)}
                />
              ))}
            </div>
          )}

          {wo.pod && (
            <div className="card mfg-wo-section">
              <h3 className="mfg-wo-section__title">Proof of Delivery</h3>
              <p className="mfg-wo-dispatch-status">
                {wo.pod.name} · Received by {wo.pod.received_by} · {fmtDate(wo.pod.received_date)}
              </p>
              <div className="mfg-wo-dispatch-badge"><StatusBadge status={wo.pod.delivery_status} /></div>
            </div>
          )}
        </section>
      )}

      {/* Modals */}
      {canManagePlanning && (
        <CapacityModal open={modal === 'capacity'} onClose={() => setModal(null)} workOrder={name} lookups={lookups} onCreated={load} onWorkstationCreated={reload} />
      )}
      {canManageMaterials && (
        <MaterialModal
          open={modal === 'material'}
          onClose={() => setModal(null)}
          workOrder={name}
          woItems={wo?.bom_items || wo?.items || []}
          onCreated={load}
        />
      )}
      {canManageProduction && (
        <>
          <ScheduleModal open={modal === 'schedule'} onClose={() => setModal(null)} workOrder={name} onCreated={load} />
          <JobCardModal open={modal === 'job'} onClose={() => setModal(null)} workOrder={name} lookups={lookups} onCreated={load} />
        </>
      )}
      {canManageQC && (
        <QCModal
          open={modal === 'qc'}
          onClose={() => {
            setQcInitialStage(null);
            setModal(null);
          }}
          workOrder={name}
          initialStage={qcInitialStage}
          onCreated={load}
        />
      )}
      {canManageDispatch && (
        <>
          <DispatchCreateModal
            open={modal === 'dispatch'}
            onClose={() => setModal(null)}
            workOrder={name}
            onCreated={load}
          />
          <PODUploadModal
            open={!!podNote || modal === 'pod'}
            onClose={() => { setPodNote(null); setModal(null); }}
            workOrder={name}
            defaultDispatchNote={podNote?.name}
            dispatchNotes={wo.dispatch_notes || []}
            onUploaded={load}
          />
        </>
      )}

      <Modal
        open={modal === 'delete'}
        onClose={() => !deleting && setModal(null)}
        title="Delete work order?"
        footer={(
          <MfgDangerModalFooter
            onCancel={() => setModal(null)}
            onConfirm={confirmDelete}
            saving={deleting}
            confirmLabel="Delete permanently"
          />
        )}
      >
        <div className="mfg-modal-confirm">
          <p className="mfg-modal-confirm__lead">
            This will permanently delete <strong>{name}</strong> and all linked capacity
            plans, material checks, schedules, job cards, QC records, and dispatch notes.
          </p>
          <p className="mfg-modal-confirm__warn">This action cannot be undone.</p>
        </div>
      </Modal>

      <Modal
        open={inspectionDelete.open}
        onClose={() => !inspectionDelete.deleting && setInspectionDelete({ open: false, name: '', reason: '', deleting: false })}
        title="Delete QC Inspection?"
        footer={(
          <MfgDangerModalFooter
            onCancel={() => setInspectionDelete({ open: false, name: '', reason: '', deleting: false })}
            onConfirm={confirmDeleteInspection}
            saving={inspectionDelete.deleting}
            confirmLabel="Delete inspection"
            canConfirm={Boolean(inspectionDelete.reason.trim())}
          />
        )}
      >
        <div className="mfg-modal-confirm">
          <p className="mfg-modal-confirm__lead">
            Inspection <strong>{inspectionDelete.name}</strong> will be permanently deleted.
          </p>
          <Field label="Reason for delete" required>
            <textarea
              rows={3}
              className="pm-input"
              value={inspectionDelete.reason}
              onChange={(e) => setInspectionDelete((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder="Enter reason (e.g., duplicate inspection created by mistake)"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={statusBlockModal.open}
        onClose={closeStatusBlockModal}
        title={statusBlockModal.title || 'Final QC required'}
        footer={(
          <>
            <MfgButton variant="secondary" onClick={closeStatusBlockModal}>
              Close
            </MfgButton>
            {statusBlockModal.kind === 'missing' && canManageQC ? (
              <MfgButton onClick={openFinalQcFromBlock}>
                Add Final QC
              </MfgButton>
            ) : null}
            {statusBlockModal.kind === 'awaiting' ? (
              <MfgButton onClick={() => {
                closeStatusBlockModal();
                navigate(mfgPath('/quality'));
              }}
              >
                Go to Quality
              </MfgButton>
            ) : null}
          </>
        )}
      >
        <div className="mfg-modal-confirm">
          <p className="mfg-modal-confirm__lead">{statusBlockModal.message}</p>
          {statusBlockModal.inspectionName ? (
            <p className="mfg-modal-confirm__hint">
              Inspection: <strong>{statusBlockModal.inspectionName}</strong>
            </p>
          ) : null}
          <p className="mfg-modal-confirm__hint">{statusBlockModal.hint}</p>
        </div>
      </Modal>
    </MfgPage>
  );
}

function WorkOrderPlanPair({
  wo,
  canManagePlanning,
  canManageProduction,
  onCapacityCreate,
  onScheduleCreate,
  onJobCreate,
}) {
  const capacityRef = useRef(null);
  const scheduleRef = useRef(null);
  const [rowHeight, setRowHeight] = useState(null);

  const readNaturalCardHeight = (peerEl) => {
    const card = peerEl?.firstElementChild;
    if (!card) return 0;
    return Math.max(card.scrollHeight, card.getBoundingClientRect().height);
  };

  const syncRowHeight = () => {
    const heights = [
      readNaturalCardHeight(capacityRef.current),
      readNaturalCardHeight(scheduleRef.current),
    ].filter((height) => height > 0);
    if (!heights.length) return;
    const next = Math.max(...heights);
    setRowHeight((prev) => (prev === next ? prev : next));
  };

  useLayoutEffect(() => {
    syncRowHeight();
    const observer = new ResizeObserver(syncRowHeight);
    [capacityRef.current, scheduleRef.current].forEach((node) => {
      if (node) observer.observe(node);
      node?.firstElementChild && observer.observe(node.firstElementChild);
    });
    window.addEventListener('resize', syncRowHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncRowHeight);
    };
  }, [
    wo?.capacity_plan,
    wo?.production_schedule,
    wo?.capacity_plan_details,
    wo?.production_schedule_details,
    canManagePlanning,
    canManageProduction,
  ]);

  const peerStyle = rowHeight ? { height: rowHeight } : undefined;

  return (
    <div className="mfg-wo-plan-pair lg:col-span-2">
      {canManagePlanning && (
        <div ref={capacityRef} className="mfg-wo-plan-pair__peer" style={peerStyle}>
          <LinkedCard
            title="Capacity Plan"
            value={wo.capacity_plan}
            onCreate={onCapacityCreate}
            className="mfg-wo-plan-pair__card"
            metaItems={
              wo.capacity_plan_details
                ? [
                    { label: 'Status', value: wo.capacity_plan_details.capacity_status || 'Draft', badge: true },
                    ...(wo.capacity_plan_details.workstation
                      ? [{ label: 'Workstation', value: wo.capacity_plan_details.workstation }]
                      : []),
                    { label: 'From', value: fmtDateTime(wo.capacity_plan_details.planned_start) },
                    { label: 'To', value: fmtDateTime(wo.capacity_plan_details.planned_end) },
                    { label: 'Hours', value: wo.capacity_plan_details.total_planned_hours || 0 },
                  ]
                : []
            }
          />
        </div>
      )}
      {canManageProduction && (
        <div ref={scheduleRef} className="mfg-wo-plan-pair__peer" style={peerStyle}>
          <LinkedCard
            title="Production Schedule"
            value={wo.production_schedule}
            onCreate={onScheduleCreate}
            className="mfg-wo-plan-pair__card"
            metaItems={
              wo.production_schedule_details
                ? [
                    { label: 'Status', value: wo.production_schedule_details.status || 'Draft', badge: true },
                    { label: 'Date', value: fmtDate(wo.production_schedule_details.schedule_date) },
                    {
                      label: 'Sequence',
                      value: `${wo.production_schedule_details.sequence_no || 1} · Priority ${wo.production_schedule_details.priority_score ?? 0}`,
                    },
                  ]
                : []
            }
          />
        </div>
      )}
      {canManageProduction && (
        <section
          className="card mfg-wo-section mfg-wo-plan-pair__jobs"
          style={peerStyle}
        >
          <div className="mfg-wo-section__head">
            <h3 className="mfg-wo-section__title">Job Cards</h3>
            <MfgButton variant="secondary" size="sm" onClick={onJobCreate}>
              <Plus size={16} /> Add
            </MfgButton>
          </div>
          {wo.job_cards?.length === 0 ? (
            <>
              <p className="mfg-wo-linked-card__empty">No job cards yet</p>
              <div className="mfg-wo-plan-pair__jobs-spacer" aria-hidden />
            </>
          ) : (
            <>
              <div className="mfg-wo-job-list-scroll">
                <ul className="mfg-wo-job-list">
                  {wo.job_cards.map((jc) => (
                    <li key={jc.name}>
                      <div className="mfg-wo-job-list__content">
                        <span className="mfg-wo-job-list__id">{jc.name}</span>
                        <span className="mfg-wo-job-list__meta">
                          {jc.workstation} · {jc.operator}
                        </span>
                        {jc.status === 'Paused' && jc.downtime_reason ? (
                          <span className={`mfg-wo-job-list__reason${isReadyToResumeReason(jc.downtime_reason) ? ' mfg-wo-job-list__reason--ok' : ''}`}>
                            {isReadyToResumeReason(jc.downtime_reason)
                              ? `Machine status: ${jc.downtime_reason}`
                              : `Pause reason: ${jc.downtime_reason}`}
                          </span>
                        ) : null}
                        {jc.excess_approval_status === 'Pending' ? (
                          <span className="mfg-wo-job-list__reason mfg-wo-job-list__reason--warn">
                            Excess consumption pending Production Head approval
                          </span>
                        ) : null}
                        <ExcessCapaPanel job={jc} />
                      </div>
                      <StatusBadge status={jc.status} />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mfg-wo-plan-pair__jobs-spacer" aria-hidden />
            </>
          )}
        </section>
      )}
    </div>
  );
}

function LinkedCard({ title, value, onCreate, canCreate = true, className = '', metaItems = [] }) {
  return (
    <div className={`card mfg-wo-linked-card ${className}`.trim()}>
      <div className="mfg-wo-linked-card__inner">
        <div>
          <p className="mfg-wo-linked-card__label">{title}</p>
          <p className={`mfg-wo-linked-card__value${value ? '' : ' mfg-wo-linked-card__empty'}`}>
            {value || 'Not created'}
          </p>
          {value && metaItems.length > 0 ? (
            <div className="mfg-wo-linked-card__meta">
              {metaItems
                .filter((item) => item?.value != null && item?.value !== '')
                .map((item) => (
                <p key={`${item.label}-${item.value}`} className="mfg-wo-linked-card__meta-line">
                  <span className="mfg-wo-linked-card__meta-label">{item.label}:</span>
                  {item.badge ? (
                    <StatusBadge status={item.value} />
                  ) : (
                    <span className="mfg-wo-linked-card__meta-value">{item.value}</span>
                  )}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        {!value && canCreate && (
          <MfgButton size="sm" onClick={onCreate}>
            <Plus size={16} /> Create
          </MfgButton>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Modals
// ──────────────────────────────────────────────────────────

function toDatetimeLocalValue(value) {
  if (!value) return '';
  return String(value).trim().replace(' ', 'T').slice(0, 16);
}

function CapacityModal({ open, onClose, workOrder, lookups, onCreated, onWorkstationCreated }) {
  const [form, setForm] = useState({ planned_start: '', planned_end: '', total_planned_hours: 0, workstation: '' });
  const [saving, setSaving] = useState(false);
  const [creatingWs, setCreatingWs] = useState(false);
  const [findingSlot, setFindingSlot] = useState(false);
  const [conflict, setConflict] = useState(null);

  const workstationItems = useMemo(
    () => (lookups.workstations || []).map((ws) => ({
      value: ws.name,
      label: `${ws.workstation_name} (${ws.workstation_type})`,
    })),
    [lookups.workstations],
  );

  useEffect(() => {
    if (!form.workstation || !form.planned_start || !form.planned_end) {
      setConflict(null);
      return;
    }
    capacity.checkConflicts(form.workstation, form.planned_start, form.planned_end)
      .then(setConflict)
      .catch(() => setConflict(null));
  }, [form.workstation, form.planned_start, form.planned_end]);

  const canSubmit = Boolean(
    form.planned_start
    && form.planned_end
    && (lookups.workstations.length === 0 || form.workstation)
    && !conflict?.has_conflict,
  );

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const { workstation, ...planForm } = form;
      const selectedShift = lookups.shifts?.[0]?.name;
      const resources = workstation && selectedShift ? [{
        workstation,
        shift: selectedShift,
        planned_date: form.planned_start?.slice(0, 10),
        planned_hours: Number(form.total_planned_hours) || 1,
      }] : [];
      await capacity.createPlan(
        { work_order: workOrder, ...planForm, resources },
        { silent: true },
      );
      toast.success('Capacity Plan created');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Could not create capacity plan.');
    } finally { setSaving(false); }
  };

  const createWorkstation = async () => {
    setCreatingWs(true);
    try {
      await capacity.createDefaultWorkstation({ workstation_type: 'CNC', capacity_per_shift: 8 });
      await onWorkstationCreated?.();
      toast.success('Default workstation created');
    } finally {
      setCreatingWs(false);
    }
  };

  const findNextSlot = async () => {
    if (!form.workstation) {
      toast.error('Select a workstation first.');
      return;
    }
    setFindingSlot(true);
    try {
      const hours = Number(form.total_planned_hours) || 8;
      const slot = await capacity.suggestNextSlot({
        workstation: form.workstation,
        hours,
        after_datetime: form.planned_start || undefined,
      }, { silent: true });
      setForm((prev) => ({
        ...prev,
        planned_start: toDatetimeLocalValue(slot.planned_start),
        planned_end: toDatetimeLocalValue(slot.planned_end),
        total_planned_hours: hours,
      }));
      toast.success(
        `Next slot on ${slot.workstation_name}: ${fmtDateTime(slot.planned_start)} → ${fmtDateTime(slot.planned_end)}`,
      );
    } catch (err) {
      toast.error(err?.message || 'Could not find an available slot.');
    } finally {
      setFindingSlot(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Create Capacity Plan"
      size="lg"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          canSubmit={canSubmit}
        />
      )}
    >
      <div className="mfg-wo-modal-form mfg-capacity-plan-form">
        <div className="mfg-wo-modal-form__row-2">
          <Field label="Planned Start" required>
            <input
              type="datetime-local"
              className="pm-input mfg-wo-modal-form__datetime"
              value={form.planned_start}
              onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
            />
          </Field>
          <Field label="Planned End" required>
            <input
              type="datetime-local"
              className="pm-input mfg-wo-modal-form__datetime"
              value={form.planned_end}
              onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
            />
          </Field>
        </div>
        <div className="mfg-wo-modal-form__row-2">
          <Field label="Total Planned Hours">
            <input
              type="number"
              min="0"
              step="any"
              className="pm-input pm-input--no-spinner"
              value={form.total_planned_hours}
              onChange={(e) => setForm({ ...form, total_planned_hours: e.target.value })}
            />
          </Field>
          {lookups.workstations.length > 0 ? (
            <Field label="Workstation">
              <MfgCombobox
                value={form.workstation}
                onChange={(workstation) => setForm({ ...form, workstation })}
                items={workstationItems}
                placeholder="Select workstation…"
                placement="below"
                maxMenuHeight={220}
              />
            </Field>
          ) : (
            <div className="mfg-wo-modal-form__spacer" aria-hidden="true" />
          )}
        </div>
        {form.workstation ? (
          <div className="mfg-capacity-plan-form__slot-action">
            <MfgButton
              variant="secondary"
              size="sm"
              onClick={findNextSlot}
              disabled={findingSlot || saving}
            >
              {findingSlot ? 'Finding slot…' : 'Find next available slot'}
            </MfgButton>
            <p className="mfg-wo-modal-form__hint">
              Uses selected workstation and planned hours to suggest the next free booking window.
            </p>
          </div>
        ) : null}
        {lookups.workstations.length === 0 ? (
          <div className="mfg-wo-modal-form__alert mfg-wo-modal-form__alert--warn">
            <p className="mfg-wo-modal-form__alert-text">
              No active workstation found. Create one here to continue.
            </p>
            <MfgButton
              variant="secondary"
              size="sm"
              onClick={createWorkstation}
              disabled={creatingWs}
            >
              {creatingWs ? 'Creating…' : 'Create Default CNC Workstation'}
            </MfgButton>
          </div>
        ) : (
          <p className="mfg-wo-modal-form__hint mfg-capacity-plan-form__avail">
            <span className="mfg-capacity-plan-form__avail-dot" aria-hidden />
            <span>
              {lookups.workstations.length} workstation{lookups.workstations.length === 1 ? '' : 's'} available.
            </span>
          </p>
        )}
        {conflict?.has_conflict ? (
          <div className="mfg-wo-modal-form__alert mfg-wo-modal-form__alert--danger">
            <p className="mfg-wo-modal-form__alert-text">
              Machine is already booked for the selected dates. Choose different dates or another workstation.
            </p>
            <ul className="mfg-capacity-plan-form__conflict-list">
              {(conflict.conflicts || []).map((row) => (
                <li key={row.plan || `${row.work_order}-${row.planned_start}`}>
                  Plan <strong>{row.plan || '—'}</strong>
                  {' · '}
                  WO <strong>{row.work_order || '—'}</strong>
                  {' · '}
                  {fmtDateTime(row.planned_start)} → {fmtDateTime(row.planned_end)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function MaterialCheckAvailHint({ availableQty, extraFree, loading, fromBom }) {
  if (loading || !fromBom) return null;
  const reserved = Number(availableQty) || 0;
  const extra = Number(extraFree) || 0;
  if (extra > 0) {
    return (
      <span className="mfg-mc-create__chip mfg-mc-create__chip--success">
        +{extra.toLocaleString('en-IN')} free in stock
      </span>
    );
  }
  if (reserved <= 0) {
    return (
      <span className="mfg-mc-create__chip mfg-mc-create__chip--warn">
        Reservation missing
      </span>
    );
  }
  return null;
}

function MaterialModal({ open, onClose, workOrder, woItems = [], onCreated }) {
  const { hasRole } = useAuth();
  const isStoreKeeper = hasRole(ROLES.STORE_KEEPER) && !hasRole(ROLES.PRODUCTION_HEAD);
  const [items, setItems] = useState([{
    item_code: '', item_name: '', required_qty: 0, available_qty: 0, extra_free: 0, fromBom: false,
  }]);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const bom = (woItems || []).filter((it) => String(it.item_code || '').trim());
    if (!bom.length) {
      setItems([{
        item_code: '', item_name: '', required_qty: 0, available_qty: 0, extra_free: 0, fromBom: false,
      }]);
      return undefined;
    }

    let cancelled = false;
    setPrefillLoading(true);
    (async () => {
      let prefillRows = [];
      if (workOrder) {
        try {
          const data = await materials.getPrefill(workOrder);
          prefillRows = Array.isArray(data) ? data : [];
        } catch {
          prefillRows = [];
        }
      }
      if (cancelled) return;
      const byCode = new Map(prefillRows.map((row) => [row.item_code, row]));
      setItems(
        bom.map((it) => {
          const prefill = byCode.get(it.item_code) || {};
          return {
            item_code: it.item_code,
            item_name: (prefill.item_name || it.item_name || it.item_code || '').trim(),
            required_qty: Number(it.required_qty) || 0,
            available_qty: Number(prefill.available_qty) || 0,
            extra_free: Number(prefill.extra_free) || 0,
            fromBom: true,
          };
        }),
      );
      setPrefillLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, woItems, workOrder]);

  const updateItem = (idx, k, v) => {
    const next = [...items];
    next[idx] = { ...next[idx], [k]: v };
    setItems(next);
  };

  const hasBomPrefill = items.some((it) => it.fromBom);
  const payloadItems = items
    .filter((it) => String(it.item_code || '').trim())
    .map(({ item_code, required_qty, available_qty }) => ({
      item_code: String(item_code).trim(),
      required_qty: Number(required_qty) || 0,
      available_qty: Number(available_qty) || 0,
    }));
  const canSubmit = payloadItems.length > 0;
  const showAddItem = !isStoreKeeper || !hasBomPrefill;
  const bomLines = items.filter((it) => it.fromBom);
  const allReserved = hasBomPrefill
    && !prefillLoading
    && bomLines.length > 0
    && bomLines.every((it) => Number(it.available_qty) > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await materials.create({ work_order: workOrder, items: payloadItems });
      toast.success('Material Check created');
      onCreated();
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Create Material Check"
      size="lg"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          canSubmit={canSubmit}
        />
      )}
    >
      <div className="mfg-mc-create">
        <p className="mfg-mc-create__subtitle">Verify BOM availability for this Work Order.</p>

        {hasBomPrefill ? (
          <div className="mfg-mc-create__summary" aria-label="Material check summary">
            {workOrder ? (
              <span className="mfg-mc-create__summary-pill mfg-mc-create__summary-pill--neutral">
                Work Order: {workOrder}
              </span>
            ) : null}
            <span className="mfg-mc-create__summary-pill mfg-mc-create__summary-pill--neutral">
              Items: {bomLines.length}
            </span>
            {!prefillLoading ? (
              <span
                className={`mfg-mc-create__summary-pill ${
                  allReserved
                    ? 'mfg-mc-create__summary-pill--success'
                    : 'mfg-mc-create__summary-pill--warn'
                }`}
              >
                {allReserved ? 'All reserved' : 'Reservation incomplete'}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="mfg-mc-create__empty-note">
            {isStoreKeeper
              ? 'No BOM lines on this work order yet. Ask Production Head to add materials first.'
              : 'Add BOM line items required for this work order.'}
          </p>
        )}

        <div className="mfg-mc-create__panel">
          {hasBomPrefill ? (
            <div className="mfg-mc-create__cols" aria-hidden="true">
              <span>Item</span>
              <span>Required</span>
              <span>Available</span>
            </div>
          ) : null}
          {items.map((it, idx) => (
            <div key={`${it.item_code}-${idx}`} className="mfg-mc-create__row">
              {it.fromBom ? (
                <div className="mfg-mc-create__grid">
                  <div className="mfg-mc-create__item-cell">
                    <span className="mfg-mc-create__item-code">{it.item_code}</span>
                    {it.item_name && it.item_name !== it.item_code ? (
                      <span className="mfg-mc-create__item-name">{it.item_name}</span>
                    ) : null}
                  </div>
                  <div className="mfg-mc-create__qty-cell mfg-mc-create__qty-cell--required">
                    <span className="mfg-mc-create__col-label">Required</span>
                    <input
                      type="text"
                      readOnly
                      tabIndex={-1}
                      className="pm-input mfg-mc-create__qty-input mfg-mc-create__qty-input--readonly"
                      value={Number(it.required_qty).toLocaleString('en-IN')}
                      aria-label={`Required qty for ${it.item_code}`}
                    />
                  </div>
                  <div className="mfg-mc-create__avail-cell">
                    <span className="mfg-mc-create__col-label">Available</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0"
                      className="pm-input pm-input--no-spinner mfg-mc-create__qty-input mfg-mc-create__avail-input"
                      value={prefillLoading ? '' : it.available_qty}
                      disabled={prefillLoading}
                      onChange={(e) => updateItem(idx, 'available_qty', Number(e.target.value))}
                      aria-label={`Available qty for ${it.item_code}`}
                    />
                    <MaterialCheckAvailHint
                      availableQty={it.available_qty}
                      extraFree={it.extra_free}
                      loading={prefillLoading}
                      fromBom
                    />
                  </div>
                </div>
              ) : (
                <div className="mfg-mc-create__grid mfg-mc-create__grid--manual">
                  <label className="mfg-mc-create__field">
                    <span className="mfg-mc-create__col-label">Item code</span>
                    <input
                      placeholder="e.g. RM-001"
                      className="pm-input"
                      value={it.item_code}
                      onChange={(e) => updateItem(idx, 'item_code', e.target.value)}
                    />
                  </label>
                  <label className="mfg-mc-create__field">
                    <span className="mfg-mc-create__col-label">Required</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="pm-input mfg-mc-create__qty-input"
                      value={it.required_qty}
                      onChange={(e) => updateItem(idx, 'required_qty', Number(e.target.value))}
                    />
                  </label>
                  <label className="mfg-mc-create__field">
                    <span className="mfg-mc-create__col-label">Available</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="pm-input mfg-mc-create__qty-input mfg-mc-create__avail-input"
                      value={it.available_qty}
                      onChange={(e) => updateItem(idx, 'available_qty', Number(e.target.value))}
                    />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>

        {showAddItem ? (
          <MfgButton
            variant="secondary"
            size="sm"
            className="mfg-mc-create__add"
            onClick={() => setItems([...items, {
              item_code: '', item_name: '', required_qty: 0, available_qty: 0, extra_free: 0, fromBom: false,
            }])}
          >
            <Plus size={14} aria-hidden /> Add item
          </MfgButton>
        ) : null}
      </div>
    </Modal>
  );
}

function ScheduleModal({ open, onClose, workOrder, onCreated }) {
  const [form, setForm] = useState({ schedule_date: '', sequence_no: 1, priority_score: 50 });
  const [saving, setSaving] = useState(false);

  const canSubmit = Boolean(form.schedule_date);

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await production.createSchedule({ work_order: workOrder, ...form });
      toast.success('Schedule created');
      onCreated();
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Create Production Schedule"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          canSubmit={canSubmit}
        />
      )}
    >
      <div className="mfg-wo-modal-form mfg-schedule-form">
        <Field label="Schedule Date" required>
          <input
            type="date"
            className="pm-input mfg-wo-modal-form__date"
            value={form.schedule_date}
            onChange={(e) => setForm({ ...form, schedule_date: e.target.value })}
          />
        </Field>
        <div className="mfg-wo-modal-form__row-2">
          <Field label="Sequence No">
            <input
              type="number"
              min="1"
              className="pm-input"
              value={form.sequence_no}
              onChange={(e) => setForm({ ...form, sequence_no: Number(e.target.value) })}
            />
          </Field>
          <Field label="Priority Score (0–100)">
            <input
              type="number"
              min="0"
              max="100"
              className="pm-input"
              value={form.priority_score}
              onChange={(e) => setForm({ ...form, priority_score: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function JobCardModal({ open, onClose, workOrder, lookups, onCreated }) {
  const [form, setForm] = useState({
    workstation: '', operator: '', operation: '', target_qty: 1,
    planned_start: '', planned_end: '',
  });
  const [saving, setSaving] = useState(false);
  const [altSuggestion, setAltSuggestion] = useState(null);
  const workstationItems = useMemo(
    () => (lookups.workstations || []).map((w) => ({
      value: w.name,
      label: `${w.workstation_name} (${w.workstation_type})`,
    })),
    [lookups.workstations],
  );

  useEffect(() => {
    if (!open || !form.workstation) {
      setAltSuggestion(null);
      return undefined;
    }
    let cancelled = false;
    workstations.suggestAlternative(form.workstation)
      .then((alt) => { if (!cancelled) setAltSuggestion(alt || null); })
      .catch(() => { if (!cancelled) setAltSuggestion(null); });
    return () => { cancelled = true; };
  }, [open, form.workstation]);

  const canSubmit =
    form.workstation &&
    form.operator.trim() &&
    form.operation.trim() &&
    form.target_qty >= 1 &&
    form.planned_start &&
    form.planned_end;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await production.createJobCard({ work_order: workOrder, ...form });
      toast.success('Job Card created');
      onCreated();
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Create Job Card"
      size="lg"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          canSubmit={canSubmit}
        />
      )}
    >
      <div className="mfg-wo-modal-form mfg-job-card-form">
        <Field label="Workstation" required>
          <MfgCombobox
            value={form.workstation}
            onChange={(workstation) => setForm({ ...form, workstation })}
            items={workstationItems}
            placeholder="Select workstation..."
            placement="below"
          />
        </Field>
        {altSuggestion ? (
          <div className="mfg-alert-banner" role="status">
            <AlertCircle size={16} aria-hidden />
            <span>
              Workstation is inactive. Suggested alternative:{' '}
              <button
                type="button"
                className="mfg-row-link"
                onClick={() => setForm({ ...form, workstation: altSuggestion.name })}
              >
                {altSuggestion.workstation_name}
              </button>
            </span>
          </div>
        ) : null}
        <Field label="Operator (email)" required>
          <MfgCombobox
            value={form.operator}
            onChange={(operator) => setForm({ ...form, operator })}
            options={lookups.operators || []}
            placeholder="Select operator or type email…"
          />
        </Field>
        <Field label="Operation Name" required>
          <input
            className="pm-input"
            placeholder="e.g., Turning, Milling, Drilling"
            value={form.operation}
            onChange={(e) => setForm({ ...form, operation: e.target.value })}
          />
        </Field>
        <div className="mfg-job-card-form__schedule">
          <Field label="Target Qty" required>
            <input
              type="number"
              min="1"
              className="pm-input pm-input--no-spinner"
              value={form.target_qty}
              onChange={(e) => setForm({ ...form, target_qty: Number(e.target.value) })}
            />
          </Field>
          <Field label="Planned Start" required>
            <input
              type="datetime-local"
              className="pm-input mfg-job-card-form__datetime"
              value={form.planned_start}
              onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
            />
          </Field>
          <Field label="Planned End" required>
            <input
              type="datetime-local"
              className="pm-input mfg-job-card-form__datetime"
              value={form.planned_end}
              onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function QCModal({ open, onClose, workOrder, onCreated, initialStage = null }) {
  const [form, setForm] = useState({ stage: 'In-Process', template: '' });
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [templates, setTemplates] = useState([]);

  const stageItems = useMemo(
    () => ['Incoming', 'In-Process', 'Final'].map((stage) => ({ value: stage, label: stage })),
    [],
  );

  const templateItems = useMemo(
    () => templates.map((t) => ({
      value: t.name,
      label: t.template_name || t.name,
    })),
    [templates],
  );

  useEffect(() => {
    if (!open) return;
    setForm({ stage: initialStage || 'In-Process', template: '' });
    setSuggestion(null);
  }, [open, initialStage]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      quality.getTemplates(form.stage),
      quality.suggestTemplate(workOrder, form.stage),
    ])
      .then(([list, res]) => {
        const stageTemplates = list || [];
        setTemplates(stageTemplates);
        setSuggestion(res || null);
        if (res?.template?.name) {
          const exists = stageTemplates.some((t) => t.name === res.template.name);
          if (!exists) {
            setTemplates((prev) => [...prev, res.template]);
          }
          setForm((prev) => ({ ...prev, template: res.template.name }));
        } else if (stageTemplates.length === 1) {
          setForm((prev) => ({ ...prev, template: stageTemplates[0].name }));
        } else {
          setForm((prev) => ({ ...prev, template: '' }));
        }
      })
      .catch(() => setSuggestion(null));
  }, [open, workOrder, form.stage]);

  const canSubmit = Boolean(form.template);
  const selectedTemplate = templates.find((t) => t.name === form.template);

  const submit = async () => {
    if (!canSubmit) {
      toast.error('QC Template is required');
      return;
    }
    setSaving(true);
    try {
      await quality.createInspection({ work_order: workOrder, ...form });
      toast.success('QC Inspection created');
      onCreated();
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Create QC Inspection"
      footer={(
        <MfgModalFooter
          onCancel={onClose}
          onSubmit={submit}
          saving={saving}
          canSubmit={canSubmit}
        />
      )}
    >
      <div className="mfg-wo-modal-form mfg-qc-inspection-form">
        <div className="mfg-qc-inspection-form__fields">
          <Field label="Stage" required>
            <MfgCombobox
              value={form.stage}
              onChange={(stage) => {
                const next = stage || 'In-Process';
                setForm((prev) => ({ ...prev, stage: next, template: '' }));
              }}
              items={stageItems}
              placeholder="Select stage…"
              placement="below"
            />
          </Field>
          <Field label="QC Template" required>
            <MfgCombobox
              value={form.template}
              onChange={(template) => setForm((prev) => ({ ...prev, template: template || '' }))}
              items={templateItems}
              placeholder="Select template…"
              placement="below"
              disabled={templateItems.length === 0}
            />
          </Field>
        </div>
        {suggestion?.template?.name ? (
          <div className="mfg-wo-modal-form__alert mfg-wo-modal-form__alert--success">
            <p className="mfg-wo-modal-form__alert-text">
              Suggested template:{' '}
              <strong>{suggestion.template.template_name}</strong>
              {suggestion.reason ? (
                <span className="mfg-qc-inspection-form__reason"> ({suggestion.reason})</span>
              ) : null}
            </p>
          </div>
        ) : form.template && selectedTemplate ? (
          <div className="mfg-wo-modal-form__alert mfg-wo-modal-form__alert--success">
            <p className="mfg-wo-modal-form__alert-text">
              Selected template: <strong>{selectedTemplate.template_name}</strong>
            </p>
          </div>
        ) : templates.length > 0 ? (
          <div className="mfg-wo-modal-form__alert">
            <p className="mfg-wo-modal-form__alert-text">
              Select a QC template for this stage.
            </p>
          </div>
        ) : (
          <div className="mfg-wo-modal-form__alert mfg-wo-modal-form__alert--warn">
            <p className="mfg-wo-modal-form__alert-text">
              No active QC template found for this stage.
            </p>
            <p className="mfg-wo-modal-form__hint">
              Go to QC Templates, create or activate a template for this stage, then try again.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
