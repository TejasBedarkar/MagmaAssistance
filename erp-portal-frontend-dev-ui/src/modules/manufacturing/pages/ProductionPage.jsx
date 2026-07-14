import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import { Play, Pause, CheckCircle2, Factory, Package, Wrench } from '@/icons/mfgIcons.js';
import BreakdownReportModal from '@/components/BreakdownReportModal';
import toast from 'react-hot-toast';
import { production } from '@/api';
import { useAuth, ROLES } from '@/hooks/manufacturingAuth';
import Modal, { MfgModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { fmtDateTime } from '@/utils/format';
import {
  MfgButton,
  MfgListPagination,
  MfgPage,
  MfgPageHeader,
  MfgRowLink,
} from '@/components/MfgPageLayout.jsx';
import { mfgPath } from '../paths.js';

const PAGE_SIZE = 25;

const emptyMaterialRow = () => ({
  item_code: '',
  item_name: '',
  planned_qty: 0,
  actual_qty: 0,
  uom: '',
  capa_reason: '',
  already_recorded: false,
  pendingReturn: false,
});

function materialBalance(planned, actual) {
  const p = Number(planned) || 0;
  const a = Number(actual) || 0;
  return Math.max(p - a, 0);
}

function materialVariance(planned, actual) {
  const p = Number(planned) || 0;
  const a = Number(actual) || 0;
  return Math.max(a - p, 0);
}

function buildMaterialsPayload(rows) {
  return rows
    .filter((row) => String(row.item_code || row.item_name || '').trim())
    .map((row) => ({
      item_code: String(row.item_code || row.item_name).trim(),
      item_name: String(row.item_name || row.item_code).trim(),
      planned_qty: Number(row.planned_qty) || 0,
      actual_qty: Number(row.actual_qty) || 0,
      uom: row.uom || '',
      capa_reason: row.capa_reason || '',
    }));
}

function materialsValid(rows) {
  for (const row of rows) {
    const code = String(row.item_code || row.item_name || '').trim();
    if (!code) continue;
    if (materialVariance(row.planned_qty, row.actual_qty) > 0 && !String(row.capa_reason || '').trim()) {
      return false;
    }
  }
  return true;
}

const ACTION_TOAST = {
  start: 'Job started',
  resume: 'Job resumed',
};

const isReadyToResumeReason = (reason = '') => /ready to resume|machine repaired/i.test(String(reason));

function ProdActionButton({ variant = 'primary', icon: Icon, children, onClick }) {
  const variantClass =
    variant === 'secondary'
      ? 'mfg-prod-action--secondary'
      : variant === 'accent'
        ? 'mfg-prod-action--accent'
        : 'mfg-prod-action--primary';
  return (
    <button type="button" className={`mfg-prod-action ${variantClass}`} onClick={onClick}>
      {Icon ? <Icon size={16} aria-hidden /> : null}
      <span>{children}</span>
    </button>
  );
}

export default function ProductionPage() {
  const { hasRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusJob = searchParams.get('job');
  const isSupervisorView = hasRole(ROLES.SUPERVISOR, ROLES.PRODUCTION_HEAD);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState({ type: null, job: null });
  const [pauseReason, setPauseReason] = useState('');
  const [actualQty, setActualQty] = useState('');
  const [scrapQty, setScrapQty] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [breakdownJob, setBreakdownJob] = useState(null);
  const [materialRows, setMaterialRows] = useState([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [skipMaterials, setSkipMaterials] = useState(false);

  const loadPlannedMaterials = useCallback((jobCard) => {
    if (!jobCard?.name) {
      setMaterialRows([]);
      return;
    }
    setMaterialsLoading(true);
    production.getPlannedMaterials(jobCard.name)
      .then((rows) => {
        setMaterialRows((rows || []).map((row) => ({
          ...row,
          actual_qty: row.actual_qty ?? row.planned_qty ?? 0,
          capa_reason: row.capa_reason || '',
          pendingReturn: row.consumption_status === 'Returned',
        })));
        setSkipMaterials(false);
      })
      .catch(() => setMaterialRows([]))
      .finally(() => setMaterialsLoading(false));
  }, []);

  const load = () => {
    setLoading(true);
    const loader = isSupervisorView ? production.listTeamJobs : production.listMyJobs;
    loader().then(setJobs).finally(() => setLoading(false));
  };

  useEffect(load, [isSupervisorView]);

  const focusJobFound = useMemo(
    () => Boolean(focusJob && jobs.some((job) => job.name === focusJob)),
    [focusJob, jobs],
  );

  const visibleJobs = useMemo(
    () => (focusJobFound ? jobs.filter((job) => job.name === focusJob) : jobs),
    [focusJob, focusJobFound, jobs],
  );

  const { page, setPage, totalPages, pageRows, total } = usePagedRows(visibleJobs, PAGE_SIZE);

  const clearFocusJob = () => setSearchParams({});

  const openDialog = (type, job) => {
    setDialog({ type, job });
    if (type === 'pause') setPauseReason('');
    if (type === 'complete' || type === 'updateQty') {
      setActualQty(String(job?.actual_qty ?? job?.planned_qty ?? ''));
      setScrapQty(String(job?.scrap_qty ?? 0));
    }
    if (type === 'complete') {
      loadPlannedMaterials(job);
    } else {
      setMaterialRows([]);
      setSkipMaterials(false);
    }
  };

  const closeDialog = () => {
    if (submitting) return;
    setDialog({ type: null, job: null });
    setMaterialRows([]);
    setSkipMaterials(false);
  };

  const updateMaterialRow = (index, patch) => {
    setMaterialRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addMaterialRow = () => {
    setMaterialRows((rows) => [...rows, emptyMaterialRow()]);
    setSkipMaterials(false);
  };

  const handleReturnMaterial = async (index) => {
    const row = materialRows[index];
    if (!row || !dialog.job) return;
    const balance = materialBalance(row.planned_qty, row.actual_qty);
    if (balance <= 0) return;

    if (row.already_recorded) {
      try {
        await production.returnUnused(dialog.job.name, row.item_code, balance);
        updateMaterialRow(index, { pendingReturn: true, consumption_status: 'Returned' });
        toast.success(`Returned ${balance} ${row.uom || ''}`.trim());
      } catch {
        /* toast from API */
      }
      return;
    }

    updateMaterialRow(index, { pendingReturn: true });
    toast.success('Return will be recorded after job completion');
  };

  const act = async (action, job) => {
    try {
      if (action === 'start') await production.startJob(job.name);
      if (action === 'resume') await production.resumeJob(job.name);
      toast.success(ACTION_TOAST[action] || `Job ${action}d`);
      load();
    } catch {
      /* toast from API client */
    }
  };

  const submitDialog = async () => {
    if (!dialog.job) return;
    setSubmitting(true);
    try {
      if (dialog.type === 'pause') {
        if (!pauseReason.trim()) return;
        await production.pauseJob(dialog.job.name, pauseReason.trim());
        toast.success('Job paused');
      } else if (dialog.type === 'updateQty') {
        if (!actualQty.trim()) return;
        await production.updateJobQty(
          dialog.job.name,
          Number(actualQty),
          Number(scrapQty || 0)
        );
        toast.success('Quantity updated');
      } else if (dialog.type === 'complete') {
        if (!actualQty.trim()) return;
        const payloadRows = skipMaterials ? [] : buildMaterialsPayload(materialRows);
        if (!skipMaterials && payloadRows.length && !materialsValid(materialRows)) {
          toast.error('Excess reason is required when actual usage exceeds planned');
          return;
        }

        const result = await production.completeJob(
          dialog.job.name,
          Number(actualQty),
          Number(scrapQty || 0),
          undefined,
          payloadRows.length ? payloadRows : undefined,
        );

        const pendingReturns = materialRows.filter(
          (row) => row.pendingReturn && materialBalance(row.planned_qty, row.actual_qty) > 0,
        );
        for (const row of pendingReturns) {
          try {
            await production.returnUnused(
              dialog.job.name,
              row.item_code,
              materialBalance(row.planned_qty, row.actual_qty),
            );
          } catch {
            /* optional ledger update */
          }
        }

        if (result?.consumption_pending) {
          toast.success('Job completed — material usage not recorded');
        } else if (
          result?.has_excess
          || (!skipMaterials && materialRows.some(
            (row) => materialVariance(row.planned_qty, row.actual_qty) > 0,
          ))
        ) {
          toast.success('Excess consumption recorded — sent to Production Head for approval.');
        } else {
          toast.success('Job completed');
        }
      }
      closeDialog();
      load();
    } catch {
      /* toast from API client */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MfgPage className="mfg-production">
      <MfgPageHeader
        title={isSupervisorView ? 'Production — Team Jobs' : 'Production — My Jobs'}
        subtitle={
          isSupervisorView
            ? 'Track all operator jobs across shop floor'
            : 'Start, update quantity, pause, resume, and complete job cards'
        }
      />

      {loading ? (
        <PageLoader />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={Factory}
          title={isSupervisorView ? 'No jobs created yet' : 'No jobs assigned'}
        />
      ) : (
        <>
        {focusJobFound ? (
          <div className="mfg-prod-focus-banner" role="status">
            <span>
              Showing <strong>{focusJob}</strong>
            </span>
            <MfgButton variant="secondary" size="sm" onClick={clearFocusJob}>
              View all jobs
            </MfgButton>
          </div>
        ) : null}
        <div className="mfg-prod-grid">
          {pageRows.map((j) => (
            <article
              key={j.name}
              id={`job-${j.name}`}
              className="mfg-prod-card card"
            >
              <div className="mfg-prod-card__head">
                <p className="mfg-prod-card__id">{j.name}</p>
                <StatusBadge status={j.status} />
              </div>

              <div className="mfg-prod-card__body">
                <h3 className="mfg-prod-card__title">{j.operation}</h3>
                <p className="mfg-prod-card__meta">
                  <MfgRowLink to={mfgPath(`/work-orders/${j.work_order}`)} mono>
                    {j.work_order}
                  </MfgRowLink>
                  <span className="mfg-prod-card__dot" aria-hidden>
                    ·
                  </span>
                  <span>{j.workstation}</span>
                  {isSupervisorView && j.operator ? (
                    <>
                      <span className="mfg-prod-card__dot" aria-hidden>
                        ·
                      </span>
                      <span>{j.operator}</span>
                    </>
                  ) : null}
                </p>
              </div>

              <div className="mfg-prod-card__stats">
                <span>
                  Planned: <strong>{j.planned_qty}</strong>
                  <span className="mfg-prod-card__sep" aria-hidden>
                    ·
                  </span>
                  Actual: <strong>{j.actual_qty || 0}</strong>
                </span>
                <span>{fmtDateTime(j.planned_start)}</span>
              </div>
              {j.status === 'Paused' && j.downtime_reason ? (
                <p className={`mfg-prod-card__downtime${isReadyToResumeReason(j.downtime_reason) ? ' mfg-prod-card__downtime--ok' : ''}`}>
                  {isReadyToResumeReason(j.downtime_reason) ? (
                    <>Machine status: <strong>{j.downtime_reason}</strong></>
                  ) : (
                    <>Pause reason: <strong>{j.downtime_reason}</strong></>
                  )}
                </p>
              ) : null}

              {!isSupervisorView && ['Open', 'In Progress', 'Paused'].includes(j.status) ? (
                <div className="mfg-prod-card__actions">
                  {j.status === 'Open' && (
                    <ProdActionButton icon={Play} onClick={() => act('start', j)}>
                      Start
                    </ProdActionButton>
                  )}
                  {j.status === 'In Progress' && (
                    <>
                      <ProdActionButton
                        variant="secondary"
                        icon={Pause}
                        onClick={() => openDialog('pause', j)}
                      >
                        Pause
                      </ProdActionButton>
                      <ProdActionButton
                        variant="secondary"
                        icon={Wrench}
                        onClick={() => setBreakdownJob(j)}
                      >
                        Breakdown
                      </ProdActionButton>
                      <ProdActionButton
                        variant="accent"
                        icon={Package}
                        onClick={() => openDialog('updateQty', j)}
                      >
                        Update
                      </ProdActionButton>
                      <ProdActionButton
                        icon={CheckCircle2}
                        onClick={() => openDialog('complete', j)}
                      >
                        Complete
                      </ProdActionButton>
                    </>
                  )}
                  {j.status === 'Paused' && (
                    <>
                      <ProdActionButton icon={Play} onClick={() => act('resume', j)}>
                        Resume
                      </ProdActionButton>
                      <ProdActionButton
                        variant="accent"
                        icon={Package}
                        onClick={() => openDialog('updateQty', j)}
                      >
                        Update
                      </ProdActionButton>
                    </>
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        <MfgListPagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
        </>
      )}

      <Modal
        open={dialog.type === 'pause'}
        onClose={closeDialog}
        title="Pause Job"
        footer={(
          <MfgModalFooter
            onCancel={closeDialog}
            onSubmit={submitDialog}
            saving={submitting}
            submitLabel="Pause Job"
            canSubmit={Boolean(pauseReason.trim())}
          />
        )}
      >
        <div className="mfg-wo-modal-form">
          <Field label="Pause reason" required>
            <input
              className="pm-input"
              placeholder="e.g., Machine Breakdown, Material Wait"
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={dialog.type === 'updateQty'}
        onClose={closeDialog}
        title="Update Quantity"
        footer={(
          <MfgModalFooter
            onCancel={closeDialog}
            onSubmit={submitDialog}
            saving={submitting}
            submitLabel="Save"
            canSubmit={Boolean(actualQty.trim())}
          />
        )}
      >
        <div className="mfg-wo-modal-form mfg-wo-modal-form--complete">
          <div className="mfg-qty-modal__stats">
            <span>Planned <strong>{dialog.job?.planned_qty ?? '—'}</strong></span>
            <span>Current <strong>{dialog.job?.actual_qty || 0}</strong></span>
          </div>
          <div className="mfg-wo-modal-form__row-2 mfg-wo-modal-form__row-2--compact">
            <Field label="Produced qty" required>
              <input
                type="number"
                min="0"
                max={dialog.job?.planned_qty || undefined}
                className="pm-input pm-input--no-spinner mfg-wo-modal-form__input-num"
                value={actualQty}
                onChange={(e) => setActualQty(e.target.value)}
              />
            </Field>
            <Field label="Scrap qty">
              <input
                type="number"
                min="0"
                className="pm-input pm-input--no-spinner mfg-wo-modal-form__input-num"
                value={scrapQty}
                onChange={(e) => setScrapQty(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={dialog.type === 'complete'}
        onClose={closeDialog}
        title="Complete Job"
        footer={(
          <MfgModalFooter
            onCancel={closeDialog}
            onSubmit={submitDialog}
            saving={submitting}
            submitLabel="Complete Job"
            canSubmit={
              Boolean(actualQty.trim())
              && (skipMaterials || materialsValid(materialRows))
            }
          />
        )}
      >
        <div className="mfg-wo-modal-form mfg-wo-modal-form--complete">
          <p className="mfg-wo-modal-form__lead">
            Confirm output and material usage before closing this job.
          </p>

          <div className="mfg-wo-modal-form__row-2 mfg-wo-modal-form__row-2--compact">
            <Field label="Produced qty" required>
              <input
                type="number"
                min="0"
                max={dialog.job?.planned_qty || undefined}
                className="pm-input pm-input--no-spinner mfg-wo-modal-form__input-num"
                value={actualQty}
                onChange={(e) => setActualQty(e.target.value)}
              />
            </Field>
            <Field label="Scrap qty">
              <input
                type="number"
                min="0"
                className="pm-input pm-input--no-spinner mfg-wo-modal-form__input-num"
                value={scrapQty}
                onChange={(e) => setScrapQty(e.target.value)}
              />
            </Field>
          </div>

          <div className="mfg-job-complete-materials">
            <div className="mfg-job-complete-materials__head">
              <h3 className="mfg-job-complete-materials__title">Material used</h3>
              {materialRows.length > 0 ? (
                <button
                  type="button"
                  className="mfg-job-complete-materials__skip"
                  onClick={() => setSkipMaterials((v) => !v)}
                >
                  {skipMaterials ? 'Record materials' : 'Skip'}
                </button>
              ) : null}
            </div>

            {materialsLoading ? (
              <p className="mfg-job-complete-materials__hint">Loading planned materials…</p>
            ) : skipMaterials ? (
              <p className="mfg-job-complete-materials__hint mfg-job-complete-materials__hint--warn">
                Material usage will not be recorded.
              </p>
            ) : materialRows.length === 0 ? (
              <div className="mfg-job-complete-materials__empty">
                <p>No planned materials — skip or add manually.</p>
                <MfgButton type="button" variant="secondary" size="sm" onClick={addMaterialRow}>
                  Add row
                </MfgButton>
              </div>
            ) : (
              <div className="mfg-job-complete-materials__list">
                <div className="mfg-job-complete-materials__list-head" aria-hidden="true">
                  <span>Material</span>
                  <span>Pln</span>
                  <span>Act</span>
                  <span>Δ</span>
                  <span />
                </div>
                {materialRows.map((row, index) => {
                  const balance = materialBalance(row.planned_qty, row.actual_qty);
                  const variance = materialVariance(row.planned_qty, row.actual_qty);
                  const isExcess = variance > 0;
                  return (
                    <div
                      key={`${row.item_code || 'row'}-${index}`}
                      className={`mfg-job-complete-materials__row${isExcess ? ' mfg-job-complete-materials__row--excess' : ''}`}
                    >
                      <div className="mfg-job-complete-materials__cell mfg-job-complete-materials__cell--name">
                        {!row.item_code && !row.already_recorded ? (
                          <div className="mfg-job-complete-materials__manual">
                            <input
                              className="pm-input mfg-job-complete-materials__name-input"
                              placeholder="Material"
                              value={row.item_name || ''}
                              onChange={(e) => updateMaterialRow(index, {
                                item_name: e.target.value,
                                item_code: e.target.value,
                              })}
                            />
                          </div>
                        ) : (
                          <div className="mfg-job-complete-materials__material">
                            <span className="mfg-job-complete-materials__material-label">
                              {row.item_name || row.item_code || '—'}
                            </span>
                            {row.item_code && row.item_name && row.item_code !== row.item_name ? (
                              <span className="mfg-job-complete-materials__code">{row.item_code}</span>
                            ) : null}
                          </div>
                        )}
                        {isExcess ? (
                          <input
                            className="pm-input mfg-job-complete-materials__capa"
                            placeholder="Excess reason (required)"
                            value={row.capa_reason || ''}
                            onChange={(e) => updateMaterialRow(index, { capa_reason: e.target.value })}
                          />
                        ) : null}
                      </div>
                      <div className="mfg-job-complete-materials__cell mfg-job-complete-materials__cell--num">
                        {!row.item_code && !row.already_recorded ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            className="pm-input pm-input--no-spinner mfg-job-complete-materials__qty"
                            placeholder="0"
                            value={row.planned_qty ?? ''}
                            onChange={(e) => updateMaterialRow(index, { planned_qty: e.target.value })}
                          />
                        ) : (
                          <span className="mfg-job-complete-materials__static-num">
                            {Number(row.planned_qty) || 0}
                          </span>
                        )}
                      </div>
                      <div className="mfg-job-complete-materials__cell mfg-job-complete-materials__cell--num">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="pm-input pm-input--no-spinner mfg-job-complete-materials__qty"
                          value={row.actual_qty ?? ''}
                          onChange={(e) => updateMaterialRow(index, { actual_qty: e.target.value })}
                        />
                      </div>
                      <div className="mfg-job-complete-materials__cell mfg-job-complete-materials__cell--delta">
                        {balance > 0 ? (
                          <span className="mfg-job-complete-materials__balance" title="Unused balance">
                            +{balance}
                          </span>
                        ) : null}
                        {variance > 0 ? (
                          <span className="mfg-job-complete-materials__variance" title="Over planned">
                            +{variance}
                          </span>
                        ) : null}
                        {!balance && !variance ? (
                          <span className="mfg-job-complete-materials__ok">✓</span>
                        ) : null}
                      </div>
                      <div className="mfg-job-complete-materials__cell mfg-job-complete-materials__cell--action">
                        {balance > 0 ? (
                          <button
                            type="button"
                            className={`mfg-job-complete-materials__return${row.pendingReturn ? ' is-active' : ''}`}
                            onClick={() => handleReturnMaterial(index)}
                            disabled={row.pendingReturn}
                          >
                            {row.pendingReturn ? 'Ret.' : 'Return'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <BreakdownReportModal
        open={Boolean(breakdownJob)}
        onClose={() => setBreakdownJob(null)}
        onSuccess={() => load()}
        initialValues={breakdownJob ? {
          workstation: breakdownJob.workstation,
          work_order: breakdownJob.work_order,
          job_card: breakdownJob.name,
        } : {}}
      />
    </MfgPage>
  );
}
