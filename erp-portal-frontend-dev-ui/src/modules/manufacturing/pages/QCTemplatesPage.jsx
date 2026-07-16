import { useEffect, useMemo, useState } from 'react';
import usePagedRows from '../../../common/hooks/usePagedRows.js';
import toast from 'react-hot-toast';
import {
  Plus, Sparkles, ClipboardCheck, GripVertical, X,
  Eye, Pencil, Copy, GitBranchPlus, Trash2,
} from '@/icons/mfgIcons.js';
import { quality, workOrders } from '@/api';
import { useAuth, ROLES } from '@/hooks/manufacturingAuth';
import { PageLoader } from '@/components/MfgPageLoader';
import MfgCombobox from '@/components/MfgCombobox';
import { EmptyState } from '@/components/MfgEmptyState';
import Modal, { MfgModalFooter, MfgDangerModalFooter } from '@/components/Modal';
import { Field } from '@/components/MfgFormField';
import { StatusBadge } from '@/components/StatusBadge';
import {
  MfgButton,
  MfgListPagination,
  MfgIconButton,
  MfgIconButtonGroup,
  MfgPage,
  MfgPageHeader,
  MfgPanelCard,
  MfgTableCard,
  MfgTd,
  MfgTh,
  MfgTableHead,
} from '@/components/MfgPageLayout.jsx';
import { fmtDateTime } from '@/utils/format';

const PAGE_SIZE = 25;

const QC_STAGE_OPTIONS = ['In-Process', 'Final'];

const emptyTemplate = {
  template_name: '',
  qc_stage: 'Final',
  description: '',
  is_active: true,
  parameters: [{ parameter_name: '', unit: '', min_value: '', max_value: '', inspection_method: '', is_mandatory: true }],
};

export default function QCTemplatesPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.QC_INSPECTOR, ROLES.PRODUCTION_HEAD);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [formMode, setFormMode] = useState('create');
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftForm, setDraftForm] = useState({ work_order: '', stage: 'Final' });
  const [woOptions, setWoOptions] = useState([]);
  const [form, setForm] = useState(emptyTemplate);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [data, woList] = await Promise.all([
        quality.listTemplates(),
        workOrders.list({ limit: 200 }),
      ]);
      setTemplates(data || []);
      setWoOptions((woList || []).filter((w) => !!w.name));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const woComboboxItems = useMemo(
    () => woOptions.map((wo) => ({
      value: wo.name,
      label: `${wo.name} — ${wo.item_code || wo.item_name || '—'} · ${wo.status}`,
    })),
    [woOptions],
  );

  const addParam = () => {
    setForm((prev) => ({ ...prev, parameters: [...prev.parameters, { parameter_name: '', unit: '', min_value: '', max_value: '', inspection_method: '', is_mandatory: true }] }));
  };

  const removeParam = (idx) => {
    setForm((prev) => {
      if (prev.parameters.length <= 1) return prev;
      return {
        ...prev,
        parameters: prev.parameters.filter((_, i) => i !== idx),
      };
    });
  };

  const updateParam = (idx, key, value) => {
    setForm((prev) => {
      const next = [...prev.parameters];
      next[idx] = { ...next[idx], [key]: value };
      return { ...prev, parameters: next };
    });
  };

  const moveParam = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx == null || toIdx == null) return;
    setForm((prev) => {
      const next = [...prev.parameters];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, parameters: next };
    });
  };

  const saveTemplate = async () => {
    setSaving(true);
    try {
      if (formMode === 'edit' && editingTemplate?.name) {
        await quality.updateTemplate(editingTemplate.name, form);
        toast.success('QC template updated');
      } else {
        await quality.createTemplate(form);
        toast.success('QC template created');
      }
      setModalOpen(false);
      setFormMode('create');
      setEditingTemplate(null);
      setForm(emptyTemplate);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const generateDraft = async () => {
    if (!draftForm.work_order.trim()) {
      toast.error('Enter work order id');
      return;
    }
    setDrafting(true);
    try {
      const res = await quality.generateTemplateDraft(draftForm.work_order.trim(), draftForm.stage);
      if (res?.template?.name) {
        toast.success(res.created ? 'AI draft template generated' : 'Existing template matched');
        await load();
      }
    } finally {
      setDrafting(false);
    }
  };

  const openTemplateDetails = async (name) => {
    setLoadingDetails(true);
    setViewModalOpen(true);
    try {
      const data = await quality.getTemplateDetails(name);
      setSelectedTemplate(data);
    } finally {
      setLoadingDetails(false);
    }
  };

  const openCreateTemplate = () => {
    setFormMode('create');
    setEditingTemplate(null);
    setForm(emptyTemplate);
    setModalOpen(true);
  };

  const openEditTemplate = async (name) => {
    const data = await quality.getTemplateDetails(name);
    setFormMode('edit');
    setEditingTemplate(data);
    setForm({
      template_name: data.template_name,
      qc_stage: data.qc_stage,
      description: data.description || '',
      is_active: !!data.is_active,
      parameters: (data.parameters || []).map((p) => ({
        parameter_name: p.parameter_name || '',
        unit: p.unit || '',
        min_value: p.min_value ?? '',
        max_value: p.max_value ?? '',
        inspection_method: p.inspection_method || '',
        is_mandatory: p.is_mandatory != null ? !!p.is_mandatory : true,
      })),
    });
    setModalOpen(true);
  };

  const duplicateTemplate = async (tpl) => {
    await quality.duplicateTemplate(tpl.name);
    toast.success('Template duplicated');
    await load();
  };

  const createVersion = async (tpl) => {
    await quality.createTemplateVersion(tpl.name);
    toast.success('New version created (previous deactivated)');
    await load();
  };

  const confirmDeleteTemplate = (tpl) => {
    setTemplateToDelete(tpl);
    setDeleteModalOpen(true);
  };

  const deleteTemplate = async () => {
    if (!templateToDelete) return;
    setDeleting(true);
    try {
      await quality.deleteTemplate(templateToDelete.name);
      toast.success('QC template deleted');
      setDeleteModalOpen(false);
      setTemplateToDelete(null);
      await load();
    } finally {
      setDeleting(false);
    }
  };

  const toggleActive = async (tpl) => {
    try {
      const details = await quality.getTemplateDetails(tpl.name);
      await quality.updateTemplate(tpl.name, {
        template_name: details.template_name,
        qc_stage: details.qc_stage,
        description: details.description || '',
        is_active: !details.is_active,
        parameters: (details.parameters || []).map((p) => ({
          parameter_name: p.parameter_name || '',
          unit: p.unit || '',
          min_value: p.min_value ?? '',
          max_value: p.max_value ?? '',
          inspection_method: p.inspection_method || '',
          is_mandatory: p.is_mandatory,
        })),
      });
      toast.success(details.is_active ? 'Template deactivated' : 'Template activated');
      await load();
    } catch {
      /* toast from API */
    }
  };

  const { page, setPage, totalPages, pageRows, total } = usePagedRows(templates, PAGE_SIZE);

  if (loading) return <PageLoader />;
  if (!canManage) {
    return <EmptyState icon={ClipboardCheck} title="QC Templates are available for QC Inspector/Production Head only" />;
  }

  return (
    <MfgPage className="mfg-qc-templates">
      <MfgPageHeader
        title="QC Templates"
        subtitle="Create item-wise quality check templates and generate AI drafts"
        actions={(
          <MfgButton onClick={openCreateTemplate}>
            <Plus size={16} /> Add Template
          </MfgButton>
        )}
      />

      <MfgPanelCard title="Generate AI Draft Template">
        <div className="mfg-draft-form">
          <div className="mfg-draft-grid">
            <div className="mfg-draft-grid__wo">
              <MfgCombobox
                value={draftForm.work_order}
                onChange={(work_order) => setDraftForm((prev) => ({ ...prev, work_order }))}
                items={woComboboxItems}
                placeholder={loading ? 'Loading…' : 'Type or select Work Order…'}
                disabled={loading}
                maxMenuHeight={240}
                placement="below"
              />
            </div>
            <div className="mfg-draft-grid__stage">
              <MfgCombobox
                value={draftForm.stage}
                onChange={(stage) => setDraftForm((prev) => ({ ...prev, stage: stage || 'Final' }))}
                options={QC_STAGE_OPTIONS}
                placeholder="Select stage"
                placement="below"
              />
            </div>
            <div className="mfg-draft-grid__action">
              <MfgButton onClick={generateDraft} disabled={drafting}>
                <Sparkles size={16} /> {drafting ? 'Generating…' : 'Generate Draft'}
              </MfgButton>
            </div>
          </div>
          <p className="mfg-form-hint">
            Type to search work order id, then pick from suggestions.
          </p>
        </div>
      </MfgPanelCard>

      <MfgTableCard>
        <table>
          <MfgTableHead>
            <MfgTh align="center">Template</MfgTh>
            <MfgTh align="center">Stage</MfgTh>
            <MfgTh align="center">Status</MfgTh>
            <MfgTh align="center">Modified</MfgTh>
            <MfgTh align="center">
              <span className="mfg-qc-actions-head">Actions</span>
            </MfgTh>
          </MfgTableHead>
          <tbody>
            {pageRows.map((t) => (
              <tr key={t.name}>
                <MfgTd align="left" className="mfg-qc-template-cell">
                  <p className="mfg-row-primary">{t.template_name}</p>
                  <p className="mfg-row-link--mono mfg-row-id-muted">{t.name}</p>
                </MfgTd>
                <MfgTd align="center">{t.qc_stage}</MfgTd>
                <MfgTd align="center"><StatusBadge status={t.is_active ? 'Active' : 'Inactive'} /></MfgTd>
                <MfgTd align="center" className="mfg-td-muted">{fmtDateTime(t.modified)}</MfgTd>
                <MfgTd align="center">
                  <MfgIconButtonGroup className="mfg-qc-actions">
                    <MfgIconButton icon={Eye} label="View Parameters" onClick={() => openTemplateDetails(t.name)} variant="primary" />
                    <MfgIconButton icon={Pencil} label="Edit Template" onClick={() => openEditTemplate(t.name)} />
                    <MfgIconButton icon={Copy} label="Duplicate Template" onClick={() => duplicateTemplate(t)} />
                    <MfgIconButton icon={GitBranchPlus} label="Create New Version" onClick={() => createVersion(t)} />
                    <MfgButton
                      variant="secondary"
                      size="sm"
                      className="mfg-qc-actions__toggle"
                      onClick={() => toggleActive(t)}
                      title={t.is_active ? 'Deactivate template' : 'Activate template'}
                    >
                      {t.is_active ? 'Deactivate' : 'Activate'}
                    </MfgButton>
                    <MfgIconButton icon={Trash2} label="Delete Template" onClick={() => confirmDeleteTemplate(t)} variant="danger" />
                  </MfgIconButtonGroup>
                </MfgTd>
              </tr>
            ))}
          </tbody>
        </table>
        {templates.length > 0 ? (
          <MfgListPagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        ) : null}
      </MfgTableCard>

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={formMode === 'edit' ? 'Edit QC Template' : 'Create QC Template'}
        size="xl"
        footer={(
          <MfgModalFooter
            onCancel={() => setModalOpen(false)}
            onSubmit={saveTemplate}
            saving={saving}
            submitLabel={formMode === 'edit' ? 'Update Template' : 'Create Template'}
          />
        )}
      >
        <div className="mfg-qc-template-form">
          <Field label="Template Name" required>
            <input
              className="pm-input"
              value={form.template_name}
              onChange={(e) => setForm((prev) => ({ ...prev, template_name: e.target.value }))}
            />
          </Field>
          <div className="mfg-qc-fields-row">
            <Field label="Stage" required>
              <MfgCombobox
                value={form.qc_stage}
                onChange={(qc_stage) => setForm((prev) => ({ ...prev, qc_stage: qc_stage || 'Final' }))}
                options={QC_STAGE_OPTIONS}
                placeholder="Select stage"
                placement="below"
              />
            </Field>
            <Field label="Description">
              <input
                className="pm-input"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </Field>
          </div>
          <label className="mfg-qc-template-form__active">
            <input
              type="checkbox"
              checked={!!form.is_active}
              onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
            />
            <span>Active — show this template when creating QC inspections</span>
          </label>
          <div className="mfg-qc-params-block">
            <p className="mfg-qc-params-block__title">Parameters</p>
            <div className="mfg-qc-params-panel">
              <div className="mfg-qc-params-head mfg-qc-params-panel__head" aria-hidden="true">
                <span>#</span>
                <span />
                <span>Parameter</span>
                <span>Unit</span>
                <span>Min</span>
                <span>Max</span>
                <span>Method</span>
                <span>Mandatory</span>
                <span />
              </div>
              <div className="mfg-qc-params-scroll mfg-qc-params-scroll--rows-cap">
              {form.parameters.map((p, idx) => (
                <div
                  key={`${idx}-${p.parameter_name}`}
                  className={`mfg-qc-params-row${dragIndex === idx ? ' mfg-qc-params-row--drag' : ''}`}
                  draggable
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    moveParam(dragIndex, idx);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                >
                  <span className="mfg-qc-params-row__num">{idx + 1}</span>
                  <button
                    type="button"
                    className="mfg-qc-params-row__grip"
                    title="Drag to reorder"
                    aria-label={`Reorder parameter ${idx + 1}`}
                  >
                    <GripVertical size={14} />
                  </button>
                  <input
                    className="pm-input"
                    placeholder="Parameter name"
                    value={p.parameter_name}
                    onChange={(e) => updateParam(idx, 'parameter_name', e.target.value)}
                  />
                  <input
                    className="pm-input"
                    placeholder="Unit"
                    value={p.unit}
                    onChange={(e) => updateParam(idx, 'unit', e.target.value)}
                  />
                  <input
                    className="pm-input"
                    placeholder="Min"
                    value={p.min_value}
                    onChange={(e) => updateParam(idx, 'min_value', e.target.value)}
                  />
                  <input
                    className="pm-input"
                    placeholder="Max"
                    value={p.max_value}
                    onChange={(e) => updateParam(idx, 'max_value', e.target.value)}
                  />
                  <input
                    className="pm-input"
                    placeholder="Method (optional)"
                    value={p.inspection_method}
                    onChange={(e) => updateParam(idx, 'inspection_method', e.target.value)}
                  />
                  <label className="mfg-qc-params-row__mandatory">
                    <input
                      type="checkbox"
                      checked={!!p.is_mandatory}
                      onChange={(e) => updateParam(idx, 'is_mandatory', e.target.checked)}
                      aria-label={`Parameter ${idx + 1} mandatory`}
                    />
                  </label>
                  <button
                    type="button"
                    className="mfg-qc-params-row__remove pm-btn pm-btn-sm"
                    onClick={() => removeParam(idx)}
                    disabled={form.parameters.length <= 1}
                    title="Remove parameter"
                    aria-label={`Remove parameter ${idx + 1}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              </div>
            </div>
            <div className="mfg-qc-params-block__actions">
              <MfgButton size="sm" variant="secondary" onClick={addParam} className="mfg-qc-add-param-btn">
                <Plus size={14} aria-hidden /> Add Parameter
              </MfgButton>
              <p className="mfg-qc-params-block__hint">Drag rows using the grip icon to reorder parameters.</p>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={viewModalOpen}
        onClose={() => setViewModalOpen(false)}
        title={selectedTemplate ? `Template: ${selectedTemplate.template_name}` : 'Template Details'}
        size="xl"
      >
        {loadingDetails ? (
          <p className="text-sm text-steel-500">Loading template details…</p>
        ) : !selectedTemplate ? (
          <p className="text-sm text-steel-500">No template selected.</p>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-steel-600">
              Stage: <span className="font-medium text-steel-800">{selectedTemplate.qc_stage}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-steel-500">
                  <tr>
                    <th className="text-left py-2">Parameter</th>
                    <th className="text-left py-2">Unit</th>
                    <th className="text-left py-2">Min</th>
                    <th className="text-left py-2">Max</th>
                    <th className="text-left py-2">Method</th>
                    <th className="text-left py-2">Mandatory</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTemplate.parameters?.map((p, idx) => (
                    <tr key={`${p.parameter_name}-${idx}`} className="border-t border-steel-100">
                      <td className="py-2">{p.parameter_name}</td>
                      <td className="py-2">{p.unit || '—'}</td>
                      <td className="py-2">{p.min_value ?? '—'}</td>
                      <td className="py-2">{p.max_value ?? '—'}</td>
                      <td className="py-2">{p.inspection_method || '—'}</td>
                      <td className="py-2">{p.is_mandatory ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={() => !deleting && setDeleteModalOpen(false)}
        title="Delete QC Template?"
        footer={(
          <MfgDangerModalFooter
            onCancel={() => setDeleteModalOpen(false)}
            onConfirm={deleteTemplate}
            saving={deleting}
          />
        )}
      >
        <div className="mfg-modal-confirm">
          <p className="mfg-modal-confirm__lead">
            Delete template <strong>{templateToDelete?.template_name}</strong>?
          </p>
          <p className="mfg-modal-confirm__hint">
            Templates already used in inspections cannot be deleted.
          </p>
        </div>
      </Modal>
    </MfgPage>
  );
}
