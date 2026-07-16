import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Package } from '@/icons/mfgIcons.js';
import { productRequirement } from '@/api/productRequirement';
import { workstations } from '@/api/workstations';
import { PageLoader } from '@/components/MfgPageLoader';
import { EmptyState } from '@/components/MfgEmptyState';
import { Field } from '@/components/MfgFormField';
import { MfgButton } from '@/components/MfgPageLayout.jsx';
import { dispatchManufacturingDashboardRefresh } from '../utils/dashboardEvents.js';
import { notifySalesDashboardRefresh } from '../../sales/lib/productDevEvents.js';

function buildFormFromOpp(opp) {
  if (!opp) {
    return {
      can_manufacture: '',
      workstation: '',
      tool_name: '',
      raw_material: '',
      option_delivery_date: '',
      notes: '',
    };
  }
  return {
    can_manufacture: opp.pd_can_manufacture || '',
    workstation: opp.pd_workstation || '',
    tool_name: opp.pd_tool_name || '',
    raw_material: opp.pd_raw_material || '',
    option_delivery_date: opp.pd_option_delivery_date || '',
    notes: opp.pd_review_notes || '',
  };
}

export default function ProductRequirementReviewPanel({ opportunityId, onUpdated, onClose }) {
  const [opp, setOpp] = useState(null);
  const [form, setForm] = useState(buildFormFromOpp(null));
  const [wsOptions, setWsOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const loadWorkstations = useCallback(async () => {
    try {
      const rows = await workstations.list({ active_only: 1 });
      setWsOptions(Array.isArray(rows) ? rows : rows?.items || []);
    } catch {
      setWsOptions([]);
    }
  }, []);

  const load = useCallback(async () => {
    if (!opportunityId) {
      setOpp(null);
      setForm(buildFormFromOpp(null));
      return;
    }
    setLoading(true);
    try {
      const data = await productRequirement.get(opportunityId);
      setOpp(data);
      setForm(buildFormFromOpp(data));
    } catch {
      setOpp(null);
    } finally {
      setLoading(false);
    }
  }, [opportunityId]);

  useEffect(() => {
    loadWorkstations();
  }, [loadWorkstations]);

  useEffect(() => {
    load();
  }, [load]);

  const setCanManufacture = (value) => {
    setForm((prev) => ({
      ...prev,
      can_manufacture: value,
      ...(value === 'No'
        ? {
            workstation: '',
            tool_name: '',
            raw_material: '',
            option_delivery_date: '',
          }
        : {}),
    }));
  };

  const save = async () => {
    if (!opportunityId) return;
    if (!form.can_manufacture) {
      toast.error('Answer whether we can make this product.');
      return;
    }
    if (form.can_manufacture === 'No') {
      toast.error('Use Reject when the product cannot be manufactured.');
      return;
    }
    if (!form.workstation || !form.tool_name?.trim() || !form.raw_material?.trim() || !form.option_delivery_date) {
      toast.error('Fill machine, tool, raw material, and proposed delivery date.');
      return;
    }
    setSaving(true);
    try {
      const result = await productRequirement.saveReview(opportunityId, form);
      toast.success(result?.message || 'Manufacturing review saved.');
      await load();
      onUpdated?.();
      dispatchManufacturingDashboardRefresh();
      notifySalesDashboardRefresh();
    } catch {
      /* toast from mfgCall */
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (!opportunityId) return;
    setApproving(true);
    try {
      const result = await productRequirement.approve(opportunityId);
      toast.success(result?.message || 'Product development approved.');
      onUpdated?.();
      dispatchManufacturingDashboardRefresh();
      notifySalesDashboardRefresh();
      onClose?.();
    } catch {
      /* toast from mfgCall */
    } finally {
      setApproving(false);
    }
  };

  const reject = async ({ saveCannotManufacture = false } = {}) => {
    if (!opportunityId) return;
    if (!window.confirm('Reject this product development request?')) return;
    setRejecting(true);
    try {
      if (saveCannotManufacture) {
        await productRequirement.saveReview(opportunityId, {
          can_manufacture: 'No',
          notes: form.notes || '',
        });
      }
      const result = await productRequirement.reject(opportunityId);
      toast.success(result?.message || 'Product development rejected.');
      onUpdated?.();
      dispatchManufacturingDashboardRefresh();
      notifySalesDashboardRefresh();
      onClose?.();
    } catch {
      /* toast from mfgCall */
    } finally {
      setRejecting(false);
    }
  };

  if (!opportunityId) {
    return (
      <div className="mfg-npr-panel mfg-npr-panel--empty">
        <EmptyState
          icon={Package}
          title="Select a requirement"
          description="Choose a pending new product request from the list to complete the manufacturing check."
        />
      </div>
    );
  }

  if (loading) return <PageLoader label="Loading product requirement…" />;

  if (!opp) {
    return (
      <div className="mfg-npr-panel mfg-npr-panel--empty">
        <EmptyState icon={Package} title="Could not load opportunity" />
      </div>
    );
  }

  const product = opp.effective_product_code || opp.product_request || opp.product_code || '—';
  const devStatus = opp.product_dev_status || '';
  const canSave = Boolean(opp.can_save_product_dev_review);
  const canApprove = Boolean(opp.can_approve_product_dev);
  const canReject = Boolean(opp.can_reject_product_dev);
  const reviewComplete = Boolean(opp.pd_review_complete);
  const canMake = form.can_manufacture;
  const showYesDetails = canMake === 'Yes';
  const showNoReject = canMake === 'No';

  return (
    <div className="mfg-npr-panel">
      <div className="mfg-npr-panel__head">
        <div>
          <p className="mfg-npr-panel__id">{opp.name}</p>
          <h3 className="mfg-npr-panel__title">{opp.opportunity_name || opp.name}</h3>
          <p className="mfg-npr-panel__meta">
            {opp.party_label || opp.party_name || 'Customer'}
            {' · '}
            Product: <strong>{product}</strong>
            {devStatus ? ` · Status: ${devStatus}` : ''}
          </p>
        </div>
        {reviewComplete ? (
          <span className="mfg-npr-panel__badge mfg-npr-panel__badge--ok">
            <CheckCircle2 size={14} /> Review complete
          </span>
        ) : (
          <span className="mfg-npr-panel__badge">Review pending</span>
        )}
      </div>

      <div className="mfg-npr-gate">
        <p className="mfg-npr-gate__label">Can we make this product?</p>
        <div className="mfg-npr-gate__options" role="radiogroup" aria-label="Can we make this product?">
          <label className="mfg-npr-gate__option">
            <input
              type="radio"
              name="can_manufacture"
              value="Yes"
              checked={canMake === 'Yes'}
              disabled={!canSave}
              onChange={() => setCanManufacture('Yes')}
            />
            <span>Yes — we can manufacture</span>
          </label>
          <label className="mfg-npr-gate__option">
            <input
              type="radio"
              name="can_manufacture"
              value="No"
              checked={canMake === 'No'}
              disabled={!canSave}
              onChange={() => setCanManufacture('No')}
            />
            <span>No — cannot manufacture</span>
          </label>
        </div>
      </div>

      {showYesDetails ? (
        <div className="mfg-npr-plan">
          <Field label="Which machine will manufacture this product?" required>
            <select
              className="input mfg-toolbar__select"
              disabled={!canSave}
              value={form.workstation}
              onChange={(e) => setForm((prev) => ({ ...prev, workstation: e.target.value }))}
            >
              <option value="">Select workstation…</option>
              {wsOptions.map((ws) => (
                <option key={ws.name} value={ws.name}>
                  {ws.workstation_name || ws.name}
                  {ws.workstation_type ? ` (${ws.workstation_type})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Which tool will be used for this product?" required>
            <input
              className="pm-input"
              disabled={!canSave}
              value={form.tool_name}
              placeholder="e.g. Broaching tool BT-12"
              onChange={(e) => setForm((prev) => ({ ...prev, tool_name: e.target.value }))}
            />
          </Field>
          <Field label="Raw material" required>
            <textarea
              className="pm-input"
              rows={2}
              disabled={!canSave}
              value={form.raw_material}
              placeholder="Material grade, size, source…"
              onChange={(e) => setForm((prev) => ({ ...prev, raw_material: e.target.value }))}
            />
          </Field>
          <Field label="Proposed delivery date" required>
            <input
              className="pm-input"
              type="date"
              disabled={!canSave}
              value={form.option_delivery_date}
              onChange={(e) => setForm((prev) => ({ ...prev, option_delivery_date: e.target.value }))}
            />
          </Field>
        </div>
      ) : null}

      <Field label="Review notes">
        <textarea
          className="pm-input mfg-npr-panel__notes"
          rows={3}
          disabled={!canSave}
          value={form.notes}
          onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
        />
      </Field>

      {!canSave && devStatus === 'Pending' ? (
        <p className="mfg-npr-panel__perm-hint">
          Only Production Head or Engineering Head can save the manufacturing review.
        </p>
      ) : null}

      <div className="mfg-npr-panel__actions">
        {onClose ? (
          <MfgButton variant="secondary" onClick={onClose}>
            Close
          </MfgButton>
        ) : null}
        {showYesDetails && canSave ? (
          <MfgButton onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save review'}
          </MfgButton>
        ) : null}
        {showNoReject && canReject ? (
          <MfgButton variant="danger" onClick={() => reject({ saveCannotManufacture: true })} disabled={rejecting}>
            {rejecting ? 'Rejecting…' : 'Reject'}
          </MfgButton>
        ) : null}
        {showYesDetails && canReject ? (
          <MfgButton variant="secondary" onClick={() => reject()} disabled={rejecting}>
            {rejecting ? 'Rejecting…' : 'Reject'}
          </MfgButton>
        ) : null}
        {showYesDetails && canApprove ? (
          <MfgButton onClick={approve} disabled={approving}>
            {approving ? 'Approving…' : 'Approve & notify Sales'}
          </MfgButton>
        ) : null}
      </div>
    </div>
  );
}
