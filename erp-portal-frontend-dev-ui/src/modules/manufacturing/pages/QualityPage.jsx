import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import { CheckCircle2, Check, X as XIcon, Eye } from '@/icons/mfgIcons.js';
import toast from 'react-hot-toast';
import { quality } from '@/api';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import Modal, { MfgModalCloseFooter, MfgModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import { fmtDateTime } from '@/utils/format';
import {
  MfgButton,
  MfgListPagination,
  MfgPage,
  MfgPageHeader,
  MfgRowLink,
  MfgSegmentTabs,
  MfgTableCard,
  MfgTd,
  MfgTh,
  MfgTableHead,
} from '@/components/MfgPageLayout.jsx';
import { mfgPath } from '../paths.js';

const PAGE_SIZE = 25;

const TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'failed', label: 'Failed' },
];

function paramHasSpec(p) {
  return p.min_value != null && p.max_value != null && p.min_value !== '' && p.max_value !== '';
}

function resultFromMeasured(p) {
  const value = parseFloat(p.measured_value);
  if (p.measured_value === '' || p.measured_value == null || Number.isNaN(value)) {
    return '';
  }
  if (!paramHasSpec(p)) {
    return p.result || '';
  }
  return value >= Number(p.min_value) && value <= Number(p.max_value) ? 'Pass' : 'Fail';
}

export default function QualityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'failed' ? 'failed' : 'pending';

  const [pending, setPending] = useState([]);
  const [failed, setFailed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState({
    open: false, item: null, result: '', remarks: '', parameters: [], loadingDetails: false,
  });
  const [viewFail, setViewFail] = useState({
    open: false, item: null, details: null, loading: false,
  });
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([quality.listPending(), quality.listFailed()])
      .then(([pendingRows, failedRows]) => {
        setPending(pendingRows || []);
        setFailed(failedRows || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const activeRows = tab === 'failed' ? failed : pending;
  const { page, setPage, totalPages, pageRows, total, resetPage } = usePagedRows(activeRows, PAGE_SIZE);

  useEffect(() => {
    resetPage();
  }, [tab, resetPage]);

  const setTab = (id) => {
    if (id === 'failed') {
      setSearchParams({ tab: 'failed' });
    } else {
      setSearchParams({});
    }
  };

  const openDecision = async (item) => {
    setDecision({
      open: true, item, result: '', remarks: '', parameters: [], loadingDetails: true,
    });
    try {
      const details = await quality.getInspectionDetails(item.name);
      const rows = (details.parameters || []).map((p) => ({
        parameter_name: p.parameter_name,
        unit: p.unit,
        min_value: p.min_value,
        max_value: p.max_value,
        inspection_method: p.inspection_method || '',
        measured_value: p.measured_value != null && p.measured_value !== '' ? String(p.measured_value) : '',
        result: '',
      }));
      setDecision((prev) => ({ ...prev, parameters: rows, loadingDetails: false }));
    } catch {
      setDecision((prev) => ({ ...prev, loadingDetails: false }));
    }
  };

  const openFailView = async (item) => {
    setViewFail({ open: true, item, details: null, loading: true });
    try {
      const details = await quality.getInspectionDetails(item.name);
      setViewFail({ open: true, item, details, loading: false });
    } catch {
      setViewFail({ open: false, item: null, details: null, loading: false });
    }
  };

  const closeDecision = () => {
    if (submitting) return;
    setDecision({
      open: false, item: null, result: '', remarks: '', parameters: [], loadingDetails: false,
    });
  };

  const setParamMeasured = (idx, value) => {
    setDecision((prev) => {
      const next = [...prev.parameters];
      const row = { ...next[idx], measured_value: value };
      row.result = resultFromMeasured(row);
      next[idx] = row;
      return { ...prev, parameters: next };
    });
  };

  const setParamResult = (idx, value) => {
    setDecision((prev) => {
      const next = [...prev.parameters];
      next[idx] = { ...next[idx], result: value };
      return { ...prev, parameters: next };
    });
  };

  const canSubmitDecision = !decision.loadingDetails && (
    decision.parameters.length === 0
      ? Boolean(decision.result)
      : decision.parameters.every((p) => {
        if (paramHasSpec(p)) {
          const value = parseFloat(p.measured_value);
          return p.measured_value !== '' && !Number.isNaN(value) && (p.result === 'Pass' || p.result === 'Fail');
        }
        return p.result === 'Pass' || p.result === 'Fail';
      })
  );

  const submitDecision = async () => {
    if (!decision.item?.name) return;
    setSubmitting(true);
    try {
      const hasParams = decision.parameters.length > 0;
      const hasUnselected = decision.parameters.some((p) => {
        if (paramHasSpec(p)) {
          const value = parseFloat(p.measured_value);
          return p.measured_value === '' || Number.isNaN(value) || !p.result;
        }
        return !p.result;
      });
      if (hasParams && hasUnselected) {
        toast.error('Enter measured values and confirm Pass/Fail for all parameters');
        return;
      }
      const hasFail = decision.parameters.some((p) => p.result === 'Fail');
      const overallResult = hasParams ? (hasFail ? 'Fail' : 'Pass') : decision.result;
      const paramsPayload = decision.parameters.map((p) => ({
        parameter_name: p.parameter_name,
        result: p.result,
        ...(p.measured_value !== '' ? { measured_value: parseFloat(p.measured_value) } : {}),
      }));
      await quality.submitResult(
        decision.item.name,
        paramsPayload,
        overallResult,
        decision.remarks || '',
      );
      toast.success(`Inspection marked ${overallResult}`);
      closeDecision();
      load();
    } catch (err) {
      toast.error(err?.message || 'Failed to submit QC result');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MfgPage className="mfg-quality">
      <MfgPageHeader
        title="Quality Inspections"
        subtitle="Pending sign-off and failed inspection follow-up"
      />

      <MfgSegmentTabs tabs={TABS} active={tab} onChange={setTab} />

      {loading ? (
        <PageLoader />
      ) : activeRows.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={tab === 'failed' ? 'No failed inspections' : 'No pending inspections'}
          description={
            tab === 'failed'
              ? 'Failed inspections will appear here after a Fail result is recorded.'
              : 'New inspections awaiting Pass/Fail will appear in this queue.'
          }
        />
      ) : (
        <MfgTableCard>
          <table>
            <MfgTableHead>
              <MfgTh>Inspection</MfgTh>
              <MfgTh>Work Order</MfgTh>
              <MfgTh>Stage</MfgTh>
              {tab === 'failed' ? <MfgTh>Defect</MfgTh> : null}
              <MfgTh>{tab === 'failed' ? 'Inspected' : 'Inspector'}</MfgTh>
              {tab === 'pending' ? <MfgTh>Created</MfgTh> : null}
              <MfgTh>Status</MfgTh>
              <MfgTh align="right">Actions</MfgTh>
            </MfgTableHead>
            <tbody>
              {pageRows.map((q) => (
                <tr key={q.name}>
                  <MfgTd className="mfg-row-link--mono">{q.name}</MfgTd>
                  <MfgTd>
                    <MfgRowLink to={mfgPath(`/work-orders/${q.work_order}`)} mono>
                      {q.work_order}
                    </MfgRowLink>
                  </MfgTd>
                  <MfgTd><span className="badge-blue">{q.stage}</span></MfgTd>
                  {tab === 'failed' ? (
                    <MfgTd className="mfg-td-muted">{q.defect_type || 'Unspecified'}</MfgTd>
                  ) : null}
                  <MfgTd className="mfg-td-muted">
                    {tab === 'failed'
                      ? fmtDateTime(q.inspection_date || q.creation)
                      : q.inspector}
                  </MfgTd>
                  {tab === 'pending' ? (
                    <MfgTd className="mfg-td-muted">{fmtDateTime(q.creation)}</MfgTd>
                  ) : null}
                  <MfgTd><StatusBadge status={q.status} /></MfgTd>
                  <MfgTd align="right">
                    {tab === 'pending' ? (
                      <MfgButton variant="accent" size="sm" onClick={() => openDecision(q)}>
                        <CheckCircle2 size={16} /> Inspect
                      </MfgButton>
                    ) : (
                      <MfgButton variant="secondary" size="sm" onClick={() => openFailView(q)}>
                        <Eye size={16} /> View
                      </MfgButton>
                    )}
                  </MfgTd>
                </tr>
              ))}
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
      )}

      <Modal
        open={decision.open}
        onClose={closeDecision}
        title="Submit QC Result"
        footer={(
          <MfgModalFooter
            onCancel={closeDecision}
            onSubmit={submitDecision}
            saving={submitting}
            submitLabel="Submit Result"
            canSubmit={canSubmitDecision}
          />
        )}
      >
        <div className="mfg-wo-modal-form mfg-qc-result-form">
          <div className="mfg-qc-result-form__head">
            <p className="mfg-qc-result-form__id">{decision.item?.name}</p>
            <p className="mfg-qc-result-form__lead">
              Enter reading — auto Pass/Fail from spec · override if needed
            </p>
          </div>

          {decision.loadingDetails ? (
            <p className="mfg-wo-modal-form__hint">Loading inspection checklist…</p>
          ) : decision.parameters.length > 0 ? (
            <div className="mfg-qc-param-table">
              <div className="mfg-qc-param-table__head">
                <span>Parameter</span>
                <span>Spec</span>
                <span>Measured</span>
                <span>Result</span>
              </div>
              {decision.parameters.map((p, idx) => {
                const rowState = p.result === 'Pass'
                  ? 'is-pass'
                  : p.result === 'Fail'
                    ? 'is-fail'
                    : 'is-pending';
                return (
                  <div
                    key={`${p.parameter_name}-${idx}`}
                    className={`mfg-qc-param-table__row ${rowState}`}
                  >
                    <div className="mfg-qc-param-table__name-col">
                      <span className="mfg-qc-param-table__name">{p.parameter_name}</span>
                      {p.inspection_method ? (
                        <span className="mfg-qc-param-table__method">
                          🔧 {p.inspection_method}
                        </span>
                      ) : null}
                    </div>
                    <span className="mfg-qc-param-table__spec">
                      {paramHasSpec(p)
                        ? `${p.min_value}–${p.max_value}${p.unit ? ` ${p.unit}` : ''}`
                        : '—'}
                    </span>
                    {paramHasSpec(p) ? (
                      <div className="mfg-qc-measure-field__wrap mfg-qc-param-table__measure">
                        <input
                          type="number"
                          step="any"
                          className="pm-input pm-input--no-spinner mfg-qc-measure-field__input"
                          placeholder="—"
                          value={p.measured_value}
                          onChange={(e) => setParamMeasured(idx, e.target.value)}
                          aria-label={`Measured value for ${p.parameter_name}`}
                        />
                        {p.unit ? (
                          <span className="mfg-qc-measure-field__unit">{p.unit}</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="mfg-qc-param-table__na">—</span>
                    )}
                    <div
                      className="mfg-qc-param-table__result"
                      role="group"
                      aria-label={`Result for ${p.parameter_name}`}
                    >
                      <button
                        type="button"
                        onClick={() => setParamResult(idx, 'Pass')}
                        className={`mfg-qc-segment__btn mfg-qc-segment__btn--pass${
                          p.result === 'Pass' ? ' is-selected' : ''
                        }`}
                        aria-pressed={p.result === 'Pass'}
                      >
                        <Check size={11} aria-hidden />
                        Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => setParamResult(idx, 'Fail')}
                        className={`mfg-qc-segment__btn mfg-qc-segment__btn--fail${
                          p.result === 'Fail' ? ' is-selected' : ''
                        }`}
                        aria-pressed={p.result === 'Fail'}
                      >
                        <XIcon size={11} aria-hidden />
                        Fail
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mfg-wo-modal-form__hint">
              No parameter checklist found in this inspection.
            </p>
          )}

          <div className="mfg-qc-result-form__remarks">
            <Field label="Remarks">
              <textarea
                rows={2}
                className="pm-input mfg-qc-result-form__textarea"
                placeholder="Optional remarks"
                value={decision.remarks}
                onChange={(e) => setDecision((prev) => ({ ...prev, remarks: e.target.value }))}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={viewFail.open}
        onClose={() => setViewFail({ open: false, item: null, details: null, loading: false })}
        title="Failed Inspection Details"
        wide
        footer={(
          <MfgModalCloseFooter
            onClose={() => setViewFail({ open: false, item: null, details: null, loading: false })}
          />
        )}
      >
        {viewFail.loading ? (
          <p className="mfg-wo-modal-form__hint">Loading…</p>
        ) : viewFail.details ? (
          <div className="mfg-wo-modal-form mfg-qc-result-form">
            <div className="mfg-qc-result-form__head">
              <p className="mfg-qc-result-form__id">{viewFail.details.name}</p>
              <p className="mfg-qc-result-form__lead">
                Work order <strong>{viewFail.details.work_order}</strong>
                {' · '}
                Defect: <strong>{viewFail.details.defect_type || 'Unspecified'}</strong>
              </p>
            </div>
            <div className="mfg-qc-checklist">
              <div className="mfg-qc-checklist__head">
                <span>Parameter</span>
                <span>Measured / Result</span>
              </div>
              {(viewFail.details.parameters || []).map((p, idx) => (
                <div key={`${p.parameter_name}-${idx}`} className="mfg-qc-checklist__row">
                  <span className="mfg-qc-checklist__label">
                    {p.parameter_name}
                    {p.unit ? ` (${p.unit})` : ''}
                    {p.min_value != null && p.max_value != null
                      ? ` — ${p.min_value}–${p.max_value}`
                      : ''}
                  </span>
                  <span className={`mfg-qc-fail-view__result mfg-qc-fail-view__result--${(p.result || 'pending').toLowerCase()}`}>
                    {p.measured_value != null && p.measured_value !== '' ? `${p.measured_value} · ` : ''}
                    {p.result || '—'}
                  </span>
                </div>
              ))}
            </div>
            {viewFail.details.remarks ? (
              <p className="mfg-wo-modal-form__hint">{viewFail.details.remarks}</p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </MfgPage>
  );
}
